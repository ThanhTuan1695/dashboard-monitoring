const mongoose = require('mongoose');

const HISTORY_RETENTION_DAYS = Number(process.env.HISTORY_RETENTION_DAYS || 180);

/**
 * One row per status *transition* (not per check) — flap-damped status
 * changes are already infrequent, so this scales far better than logging
 * every poll while still being enough to reconstruct an uptime timeline.
 */
const StatusEventSchema = new mongoose.Schema({
  device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true, index: true },
  previousStatus: { type: String, enum: ['up', 'down', 'unknown'], required: true },
  status: { type: String, enum: ['up', 'down', 'unknown'], required: true },
  at: { type: Date, default: Date.now },
});

StatusEventSchema.index({ device: 1, at: -1 });
StatusEventSchema.index({ at: 1 }, { expireAfterSeconds: HISTORY_RETENTION_DAYS * 24 * 60 * 60 });

module.exports = mongoose.model('StatusEvent', StatusEventSchema);
