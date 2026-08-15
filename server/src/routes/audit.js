const express = require('express');
const AuditLog = require('../models/AuditLog');
const { requireAdmin } = require('../middleware/auth');

// Admin-only — who changed what, across devices and users.
function buildAuditRouter() {
  const router = express.Router();
  router.use(requireAdmin);

  // GET /api/audit?entityType=&action=&before=&limit=
  // Cursor pagination on `before` (an ISO timestamp) since the log is append-only and sorted by `at` desc.
  router.get('/', async (req, res) => {
    const { entityType, action, before } = req.query;
    const filter = {};
    if (entityType) filter.entityType = entityType;
    if (action) filter.action = action;
    if (before) filter.at = { $lt: new Date(before) };

    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const entries = await AuditLog.find(filter).sort({ at: -1 }).limit(limit);
    res.json({
      entries,
      nextBefore: entries.length === limit ? entries[entries.length - 1].at : null,
    });
  });

  return router;
}

module.exports = buildAuditRouter;
