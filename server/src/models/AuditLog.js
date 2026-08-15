const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Denormalized so the log stays readable after the actor's account is deleted.
  actorUsername: { type: String, required: true },
  action: { type: String, required: true }, // e.g. 'device.create', 'user.role-change'
  entityType: { type: String, enum: ['device', 'user', 'group'], required: true },
  entityId: { type: String },
  entityLabel: { type: String, default: '' }, // device name / username, for a readable log without joins
  details: { type: mongoose.Schema.Types.Mixed, default: null },
  at: { type: Date, default: Date.now },
});

AuditLogSchema.index({ at: -1 });
AuditLogSchema.index({ entityType: 1, at: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
