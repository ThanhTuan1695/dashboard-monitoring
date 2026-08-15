const mongoose = require('mongoose');
const { DEVICE_TYPES } = require('../config/deviceTypeDefaults');

const MonitorSchema = new mongoose.Schema(
  {
    method: {
      type: String,
      enum: ['ping', 'tcp', 'http', 'snmp', 'onvif', 'ssh', 'connector'],
      default: 'ping',
    },
    port: { type: Number },
    httpPath: { type: String },
    snmpCommunity: { type: String, default: 'public' },
    snmpVersion: { type: String, enum: ['1', '2c'], default: '2c' },
    snmpOid: { type: String, default: '1.3.6.1.2.1.1.3.0' },
    onvifPath: { type: String, default: '/onvif/device_service' },
    // 'ssh' method (any device type) and 'connector' method (the shared ConnectorManager/
    // vendor-connector pipeline, offered for type: 'firewall'/'switch') both reference the
    // same encrypted DeviceCredential doc, if any (credentials are optional).
    credentialId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeviceCredential', default: null },
    // '' = auto-detect via discovery fingerprinting (the default); an explicit value here
    // skips relying on confidence-scored fingerprinting and always tries that vendor's connector.
    // Only 'fortinet' (firewall) is implemented as a native connector so far — switches only
    // have the generic SNMP fallback today, so this stays '' for every switch device.
    vendor: { type: String, enum: ['', 'fortinet'], default: '' },
    intervalSeconds: { type: Number, default: 60, min: 5 },
    timeoutMs: { type: Number, default: 3000, min: 100 },
    downAfterFailures: { type: Number, default: 2, min: 1 },
  },
  { _id: false }
);

const StatusSchema = new mongoose.Schema(
  {
    current: {
      type: String,
      enum: ['up', 'down', 'unknown'],
      default: 'unknown',
    },
    lastCheckedAt: { type: Date, default: null },
    lastChangedAt: { type: Date, default: null },
    consecutiveFailures: { type: Number, default: 0 },
    latencyMs: { type: Number, default: null },
    lastError: { type: String, default: null },
  },
  { _id: false }
);

const DeviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: DEVICE_TYPES, required: true, default: 'other' },
    ipAddress: {
      type: String,
      required: true,
      trim: true,
      // Basic IPv4 shape check; hostnames are allowed too, so keep this loose.
    },
    hostname: { type: String, trim: true, default: '' },
    location: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    tags: { type: [String], default: [] },
    // Empty string = ungrouped, visible to every operator regardless of their `groups`.
    group: { type: String, trim: true, default: '' },
    // Per-device mute for the down-alert webhook (ALERT_WEBHOOK_URL) — doesn't affect monitoring itself.
    alertsEnabled: { type: Boolean, default: true },

    monitor: { type: MonitorSchema, default: () => ({}) },
    status: { type: StatusSchema, default: () => ({}) },
  },
  { timestamps: true }
);

DeviceSchema.index({ ipAddress: 1 });
DeviceSchema.index({ type: 1 });
DeviceSchema.index({ 'status.current': 1 });
DeviceSchema.index({ group: 1 });

module.exports = mongoose.model('Device', DeviceSchema);
