const express = require('express');
const { z } = require('zod');
const Device = require('../models/Device');
const StatusEvent = require('../models/StatusEvent');
const User = require('../models/User');
const DeviceCredential = require('../models/DeviceCredential');
const DeviceHealthSnapshot = require('../models/DeviceHealthSnapshot');
const { getDefaultMonitorConfig, DEVICE_TYPES } = require('../config/deviceTypeDefaults');
const { buildTimeline, computeUptime } = require('../services/uptime');
const { deviceVisibilityFilter, canAccessDevice } = require('../services/groupAccess');
const { recordAudit } = require('../services/audit');
const { registerGroups } = require('../services/groupRegistry');
const { discover } = require('../monitoring/discovery/discoveryService');
const { poll: pollFirewall } = require('../firewall/services/firewallPollingService');
const { poll: pollSwitch } = require('../switch/services/switchPollingService');
const { encrypt } = require('../monitoring/services/credentialService');

// The connector pipeline is shared, but which device types have one (and
// therefore accept /discover, /credential, /health, /poll) is a short,
// explicit list — adding a third type is just one more line here.
const CONNECTOR_POLLERS = { firewall: pollFirewall, switch: pollSwitch };

const DiscoverBodySchema = z
  .object({
    snmp: z
      .object({
        community: z.string().min(1).optional(),
        version: z.enum(['1', '2c', '3']).optional(),
        username: z.string().min(1).optional(),
        authPassword: z.string().min(1).optional(),
        privPassword: z.string().min(1).optional(),
        authProtocol: z.enum(['md5', 'sha']).optional(),
        privProtocol: z.enum(['des', 'aes']).optional(),
      })
      .optional(),
  })
  .optional();

// Credentials are optional and one of several shapes — a discriminated
// union so each type only accepts the fields it actually needs.
const DeviceCredentialBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('api_token'), apiToken: z.string().min(1) }),
  z.object({ type: z.literal('username_password'), username: z.string().min(1), password: z.string().min(1) }),
  z.object({ type: z.literal('snmp_v2'), community: z.string().min(1) }),
  z.object({
    type: z.literal('snmp_v3'),
    username: z.string().min(1),
    // net-snmp requires an auth/priv key of at least 8 characters (RFC3414) — validated
    // here rather than surfacing net-snmp's own session-creation error at poll time.
    authPassword: z.string().min(8),
    privPassword: z.string().min(8).optional(),
    authProtocol: z.enum(['md5', 'sha']).default('sha'),
    privProtocol: z.enum(['des', 'aes']).default('aes'),
  }),
]);

const UPTIME_WINDOWS = { '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000 };

function mergeFilter(base, extra) {
  if (!extra) return base;
  if (base.$or) {
    const { $or, ...rest } = base;
    return { ...rest, $and: [{ $or }, extra] };
  }
  return { ...base, ...extra };
}

/** Shared by the list and summary routes so tiles reflect whatever the table is currently filtered to. */
function buildQueryFilter({ type, status, group, q }) {
  const filter = {};
  if (type) filter.type = type;
  if (status) filter['status.current'] = status;
  if (group) filter.group = group;
  if (q) {
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { ipAddress: { $regex: q, $options: 'i' } },
      { hostname: { $regex: q, $options: 'i' } },
    ];
  }
  return filter;
}

function buildDevicesRouter(scheduler, io) {
  const router = express.Router();

  // Loads the full (live) user doc so group membership reflects the latest
  // admin-assigned groups without requiring the operator to re-log-in.
  router.use(async (req, res, next) => {
    const actingUser = await User.findById(req.user.sub, 'role groups username');
    if (!actingUser) return res.status(401).json({ error: 'User no longer exists' });
    req.actingUser = actingUser;
    next();
  });

  // GET /api/devices?type=&status=&group=&q=
  router.get('/', async (req, res) => {
    const filter = buildQueryFilter(req.query);
    const devices = await Device.find(mergeFilter(filter, deviceVisibilityFilter(req.actingUser))).sort({ name: 1 });
    res.json(devices);
  });

  // GET /api/devices/groups — distinct group names in use, for filter dropdowns / autocomplete.
  router.get('/groups', async (_req, res) => {
    const groups = await Device.distinct('group', { group: { $ne: '' } });
    res.json(groups.sort());
  });

  // GET /api/devices/summary?type=&status=&group=&q=  (kept under /devices to avoid an :id route collision)
  // Accepts the same filters as the list route so the tiles match a filtered view (e.g. "Cameras only").
  router.get('/summary', async (req, res) => {
    const filter = buildQueryFilter(req.query);
    const all = await Device.find(mergeFilter(filter, deviceVisibilityFilter(req.actingUser)), 'type status.current');
    const summary = { total: all.length, up: 0, down: 0, unknown: 0, byType: {} };
    for (const d of all) {
      const s = d.status?.current || 'unknown';
      summary[s] = (summary[s] || 0) + 1;
      summary.byType[d.type] = summary.byType[d.type] || { total: 0, up: 0, down: 0, unknown: 0 };
      summary.byType[d.type].total += 1;
      summary.byType[d.type][s] += 1;
    }
    res.json(summary);
  });

  router.get('/:id', async (req, res) => {
    const device = await Device.findById(req.params.id);
    if (!device || !canAccessDevice(req.actingUser, device)) {
      return res.status(404).json({ error: 'Device not found' });
    }
    res.json(device);
  });

  // GET /api/devices/:id/history?days=30 — status timeline + 24h/7d/30d uptime %.
  router.get('/:id/history', async (req, res) => {
    const device = await Device.findById(req.params.id);
    if (!device || !canAccessDevice(req.actingUser, device)) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const days = Math.min(180, Math.max(1, Number(req.query.days) || 30));
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);

    const events = await StatusEvent.find({ device: device._id, at: { $lte: windowEnd } }).lean();

    const timeline = buildTimeline(events, windowStart, windowEnd, device.createdAt);
    const uptime = {};
    for (const [key, ms] of Object.entries(UPTIME_WINDOWS)) {
      const start = new Date(windowEnd.getTime() - ms);
      uptime[key] = computeUptime(buildTimeline(events, start, windowEnd, device.createdAt)).uptimePercent;
    }

    res.json({ windowStart, windowEnd, timeline, uptime, currentStatus: device.status?.current || 'unknown' });
  });

  // POST /api/devices/:id/discover — runs discovery now: safe, non-intrusive connectivity +
  // vendor fingerprinting. Works with the device's saved IP alone; an optional `snmp` block in
  // the body lets the caller test a community/version before saving it as a credential.
  // Shared by every connector-capable device type — discovery itself has no device-type-specific logic.
  router.post('/:id/discover', async (req, res) => {
    const device = await Device.findById(req.params.id);
    if (!device || !canAccessDevice(req.actingUser, device)) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const parsed = DiscoverBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request body' });

    const discoveryResult = await discover(device.ipAddress, { ...(parsed.data || {}), managementPort: device.monitor?.port });
    res.json(discoveryResult);
  });

  // PUT /api/devices/:id/credential — set/replace the encrypted credential.
  // The secret is never echoed back; only `hasCredential`/`type` are ever exposed.
  router.put('/:id/credential', async (req, res) => {
    const device = await Device.findById(req.params.id);
    if (!device || !canAccessDevice(req.actingUser, device)) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const parsed = DeviceCredentialBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid credential payload' });

    const { type, ...secretFields } = parsed.data;
    const encrypted = encrypt(secretFields);

    if (device.monitor.credentialId) {
      await DeviceCredential.findByIdAndUpdate(device.monitor.credentialId, { type, encrypted });
    } else {
      const credential = await DeviceCredential.create({ device: device._id, type, encrypted });
      device.monitor.credentialId = credential._id;
      await device.save();
    }

    await recordAudit({
      actor: req.user,
      action: 'device.credential-set',
      entityType: 'device',
      entityId: device._id,
      entityLabel: device.name,
      details: { credentialType: type }, // never the secret itself
    });
    res.json({ hasCredential: true, type });
  });

  router.delete('/:id/credential', async (req, res) => {
    const device = await Device.findById(req.params.id);
    if (!device || !canAccessDevice(req.actingUser, device)) {
      return res.status(404).json({ error: 'Device not found' });
    }
    if (device.monitor.credentialId) {
      await DeviceCredential.findByIdAndDelete(device.monitor.credentialId);
      device.monitor.credentialId = null;
      await device.save();
      await recordAudit({
        actor: req.user,
        action: 'device.credential-removed',
        entityType: 'device',
        entityId: device._id,
        entityLabel: device.name,
      });
    }
    res.json({ hasCredential: false });
  });

  // GET /api/devices/:id/health — latest normalized snapshot for connector-monitored device types.
  router.get('/:id/health', async (req, res) => {
    const device = await Device.findById(req.params.id);
    if (!device || !canAccessDevice(req.actingUser, device)) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const snapshot = await DeviceHealthSnapshot.findOne({ device: device._id }).sort({ collectedAt: -1 });
    // hasCredential must not depend on a snapshot existing — a credential saved right after
    // device creation (before the scheduler's first poll or a manual Discover/Poll) would
    // otherwise appear unset until then, undermining the "add device + credential in one step" flow.
    if (!snapshot) return res.json({ hasCredential: Boolean(device.monitor.credentialId) });
    res.json({
      normalized: snapshot.normalized,
      overallStatus: snapshot.overallStatus,
      healthComponents: snapshot.healthComponents,
      healthReasons: snapshot.healthReasons,
      collectedAt: snapshot.collectedAt,
      hasCredential: Boolean(device.monitor.credentialId),
    });
  });

  // POST /api/devices/:id/poll — force a poll now, same pattern as /check-now.
  router.post('/:id/poll', async (req, res) => {
    const device = await Device.findById(req.params.id);
    if (!device || !canAccessDevice(req.actingUser, device)) {
      return res.status(404).json({ error: 'Device not found' });
    }
    if (device.monitor.method !== 'connector') {
      return res.status(400).json({ error: 'This device is not using the connector monitor method' });
    }
    const poll = CONNECTOR_POLLERS[device.type];
    if (!poll) {
      return res.status(400).json({ error: `No connector pipeline is available for device type "${device.type}"` });
    }
    try {
      await poll(device, { forceDiscovery: Boolean(req.query.forceDiscovery) });
      const snapshot = await DeviceHealthSnapshot.findOne({ device: device._id }).sort({ collectedAt: -1 });
      res.json({
        normalized: snapshot.normalized,
        overallStatus: snapshot.overallStatus,
        healthComponents: snapshot.healthComponents,
        healthReasons: snapshot.healthReasons,
        collectedAt: snapshot.collectedAt,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const body = req.body || {};
      if (!DEVICE_TYPES.includes(body.type)) {
        return res.status(400).json({ error: `type must be one of: ${DEVICE_TYPES.join(', ')}` });
      }
      const monitor = { ...getDefaultMonitorConfig(body.type), ...(body.monitor || {}) };
      const device = await Device.create({ ...body, monitor });
      if (device.group) await registerGroups([device.group]);
      scheduler.scheduleDevice(device._id.toString(), true);
      io.to('status').emit('device:created', device);
      await recordAudit({
        actor: req.user,
        action: 'device.create',
        entityType: 'device',
        entityId: device._id,
        entityLabel: device.name,
      });
      res.status(201).json(device);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const device = await Device.findById(req.params.id);
      if (!device || !canAccessDevice(req.actingUser, device)) {
        return res.status(404).json({ error: 'Device not found' });
      }

      const body = req.body || {};
      const fields = ['name', 'type', 'ipAddress', 'hostname', 'location', 'description', 'tags', 'group', 'alertsEnabled'];
      const changes = {};
      for (const f of fields) {
        if (body[f] !== undefined && JSON.stringify(body[f]) !== JSON.stringify(device[f])) {
          changes[f] = { from: device[f], to: body[f] };
        }
        if (body[f] !== undefined) device[f] = body[f];
      }
      if (body.monitor) device.monitor = { ...device.monitor.toObject(), ...body.monitor };

      await device.save();
      if (changes.group) await registerGroups([device.group]);
      scheduler.scheduleDevice(device._id.toString(), true); // re-arm with possibly new interval
      io.to('status').emit('device:updated', device);
      await recordAudit({
        actor: req.user,
        action: 'device.update',
        entityType: 'device',
        entityId: device._id,
        entityLabel: device.name,
        details: changes,
      });
      res.json(device);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    const existing = await Device.findById(req.params.id);
    if (!existing || !canAccessDevice(req.actingUser, existing)) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const device = await Device.findByIdAndDelete(req.params.id);
    scheduler.cancelDevice(req.params.id);
    await StatusEvent.deleteMany({ device: device._id });
    await DeviceHealthSnapshot.deleteMany({ device: device._id });
    if (device.monitor?.credentialId) await DeviceCredential.findByIdAndDelete(device.monitor.credentialId);
    io.to('status').emit('device:deleted', { deviceId: req.params.id });
    await recordAudit({
      actor: req.user,
      action: 'device.delete',
      entityType: 'device',
      entityId: device._id,
      entityLabel: device.name,
    });
    res.status(204).send();
  });

  router.post('/:id/check-now', async (req, res) => {
    try {
      const existing = await Device.findById(req.params.id);
      if (!existing || !canAccessDevice(req.actingUser, existing)) {
        return res.status(404).json({ error: 'Device not found' });
      }
      // `changed` status transitions are already broadcast by the scheduler
      // (device:status-changed); this event just refreshes latency/lastCheckedAt
      // for clients even when the status itself didn't flip.
      const { device, result } = await scheduler.checkNow(req.params.id);
      io.to('status').emit('device:updated', device);
      res.json({ device, result });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  return router;
}

module.exports = buildDevicesRouter;
