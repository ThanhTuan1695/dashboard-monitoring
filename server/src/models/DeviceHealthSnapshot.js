const mongoose = require('mongoose');

// One document per poll: the full normalized health result plus the Health
// Engine's verdict. Shared by every connector-monitored device type (firewall,
// switch, ...) — `normalized`/`healthComponents` shapes differ per type, but
// that's exactly why they're stored as Mixed rather than a deeply-typed
// subschema: this data is only ever produced by our own normalizer, never
// accepted as external input, so strict per-type validation here would mostly
// just duplicate that code.
const DeviceHealthSnapshotSchema = new mongoose.Schema({
  device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true, index: true },
  normalized: { type: mongoose.Schema.Types.Mixed, required: true },
  // The DiscoveryResult used for this poll — kept alongside (not nested inside `normalized`)
  // so the polling service can check its own staleness without digging through the normalized shape.
  discovery: { type: mongoose.Schema.Types.Mixed, default: null },
  overallStatus: { type: String, enum: ['UNKNOWN', 'HEALTHY', 'DEGRADED', 'CRITICAL', 'OFFLINE'], required: true },
  healthComponents: { type: mongoose.Schema.Types.Mixed, default: {} },
  healthReasons: { type: [mongoose.Schema.Types.Mixed], default: [] },
  collectedAt: { type: Date, default: Date.now },
});

DeviceHealthSnapshotSchema.index({ device: 1, collectedAt: -1 });
// Keep ~180 days of snapshots, same retention posture as StatusEvent.
DeviceHealthSnapshotSchema.index({ collectedAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

module.exports = mongoose.model('DeviceHealthSnapshot', DeviceHealthSnapshotSchema);
