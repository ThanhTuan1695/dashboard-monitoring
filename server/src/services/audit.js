const AuditLog = require('../models/AuditLog');

/**
 * Fire-and-forget-ish audit write: awaited by callers (so ordering vs. the
 * response is predictable in tests), but a logging failure must never break
 * the underlying action, so errors are swallowed here rather than thrown.
 */
async function recordAudit({ actor, action, entityType, entityId, entityLabel = '', details = null }) {
  try {
    await AuditLog.create({
      actorId: actor?.sub || actor?._id || null,
      actorUsername: actor?.username || 'unknown',
      action,
      entityType,
      entityId: entityId ? String(entityId) : undefined,
      entityLabel,
      details,
    });
  } catch (err) {
    console.error('[audit] failed to record audit entry:', err.message);
  }
}

module.exports = { recordAudit };
