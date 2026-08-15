const DeviceHealthSnapshot = require('../../models/DeviceHealthSnapshot');
const DeviceCredential = require('../../models/DeviceCredential');
const { discover } = require('../../monitoring/discovery/discoveryService');
const { collect } = require('../connectors/connectorManager');
const { HealthEngine } = require('../health/healthEngine');
const { HealthStatus } = require('../core/healthStatus');
const { decrypt } = require('../../monitoring/services/credentialService');
const thresholds = require('../../monitoring/core/thresholds');
const { computeInterfaceBandwidth } = require('../../monitoring/core/bandwidthCalculator');

const healthEngine = new HealthEngine();

async function loadCredential(device) {
  const id = device.monitor?.credentialId;
  if (!id) return null;
  const doc = await DeviceCredential.findById(id);
  if (!doc) return null;
  try {
    return { type: doc.type, ...decrypt(doc.encrypted) };
  } catch (err) {
    console.error('[switch] failed to decrypt credential for device', device._id.toString(), err.message);
    return null;
  }
}

function credentialToConnectorShape(cred) {
  if (!cred) return {};
  if (cred.type === 'api_token') return { apiToken: cred.apiToken };
  if (cred.type === 'snmp_v2' || cred.type === 'snmp_v3') {
    return {
      snmp: {
        community: cred.community,
        version: cred.type === 'snmp_v3' ? '3' : '2c',
        username: cred.username,
        authPassword: cred.authPassword,
        privPassword: cred.privPassword,
        authProtocol: cred.authProtocol,
        privProtocol: cred.privProtocol,
      },
    };
  }
  return {};
}

/** Discovery and polling are separate cadences — only re-discover if missing/stale or explicitly forced. */
async function ensureDiscovery(device, { force = false } = {}) {
  const latest = await DeviceHealthSnapshot.findOne({ device: device._id }, 'discovery collectedAt').sort({ collectedAt: -1 });
  const stale = !latest?.discovery || Date.now() - new Date(latest.collectedAt).getTime() > thresholds.DISCOVERY_STALE_MS;
  if (!force && !stale) return latest.discovery;

  const credential = await loadCredential(device);
  return discover(device.ipAddress, { ...credentialToConnectorShape(credential), managementPort: device.monitor?.port });
}

/**
 * One device's full cycle (the shared ConnectorManager.collect() pipeline,
 * plus persistence): discover-if-stale -> connector fallback chain -> Health
 * Engine -> snapshot. Returns the {ok,latencyMs,error} shape scheduler.js's
 * flap-damping loop already expects, so it plugs into the existing scheduler
 * unchanged — same backward-compatible mapping the firewall pipeline uses.
 */
async function poll(device, { forceDiscovery = false } = {}) {
  const discoveryResult = await ensureDiscovery(device, { force: forceDiscovery });
  const credential = await loadCredential(device);
  // No native switch vendor connector exists yet, so this always resolves to
  // null/'' today — kept for parity with the firewall pipeline and ready for
  // when a native connector (e.g. Cisco Catalyst) is added.
  const vendor = device.monitor?.vendor || discoveryResult?.fingerprint?.vendor || null;

  const normalized = await collect({
    deviceId: device._id.toString(),
    host: device.ipAddress,
    port: device.monitor?.port,
    vendor,
    credentials: credentialToConnectorShape(credential),
    discoveryResult,
  });

  // Bandwidth is a rate — derive it from this poll's byte counters vs the
  // previous poll's, never fabricated on the very first poll (nothing to diff against).
  const previous = await DeviceHealthSnapshot.findOne({ device: device._id }, 'normalized.interfaces collectedAt').sort({ collectedAt: -1 });
  const { interfaces, bandwidth } = computeInterfaceBandwidth(
    normalized.interfaces,
    previous?.normalized?.interfaces,
    previous?.collectedAt,
    new Date()
  );
  normalized.interfaces = interfaces;
  normalized.bandwidth = bandwidth;

  const evaluation = healthEngine.evaluate(normalized);

  await DeviceHealthSnapshot.create({
    device: device._id,
    normalized,
    discovery: discoveryResult,
    overallStatus: evaluation.status,
    healthComponents: evaluation.components,
    healthReasons: evaluation.reasons,
  });

  // Only OFFLINE maps to "down" on the existing simple chip — DEGRADED/CRITICAL
  // are still reachable, managed devices; that nuance lives in the Switch
  // Health panel, not the shared Up/Down status every device type relies on.
  const ok = evaluation.status !== HealthStatus.OFFLINE;
  return { ok, latencyMs: null, error: ok ? null : 'No usable monitoring channel is reachable' };
}

module.exports = { poll };
