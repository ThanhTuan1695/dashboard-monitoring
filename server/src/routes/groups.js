const express = require('express');
const Group = require('../models/Group');
const Device = require('../models/Device');
const User = require('../models/User');
const { requireAdmin } = require('../middleware/auth');
const { syncGroupsFromUsage } = require('../services/groupRegistry');
const { recordAudit } = require('../services/audit');

// Admin-only — create/rename/delete groups, with cascading updates to any
// device/user that references the old name.
function buildGroupsRouter() {
  const router = express.Router();
  router.use(requireAdmin);

  // GET /api/groups — every registered group plus how many devices/users reference it.
  router.get('/', async (_req, res) => {
    await syncGroupsFromUsage();

    const [groups, deviceCounts, userCounts] = await Promise.all([
      Group.find().sort({ name: 1 }).lean(),
      Device.aggregate([{ $match: { group: { $ne: '' } } }, { $group: { _id: '$group', count: { $sum: 1 } } }]),
      User.aggregate([{ $unwind: '$groups' }, { $group: { _id: '$groups', count: { $sum: 1 } } }]),
    ]);
    const deviceCountByName = Object.fromEntries(deviceCounts.map((d) => [d._id, d.count]));
    const userCountByName = Object.fromEntries(userCounts.map((u) => [u._id, u.count]));

    res.json(
      groups.map((g) => ({
        ...g,
        deviceCount: deviceCountByName[g.name] || 0,
        userCount: userCountByName[g.name] || 0,
      }))
    );
  });

  router.post('/', async (req, res) => {
    try {
      const name = (req.body?.name || '').trim();
      const description = req.body?.description || '';
      if (!name) return res.status(400).json({ error: 'name is required' });

      const group = await Group.create({ name, description });
      await recordAudit({ actor: req.user, action: 'group.create', entityType: 'group', entityId: group._id, entityLabel: group.name });
      res.status(201).json({ ...group.toObject(), deviceCount: 0, userCount: 0 });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: 'A group with that name already exists' });
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const group = await Group.findById(req.params.id);
      if (!group) return res.status(404).json({ error: 'Group not found' });

      const { name, description } = req.body || {};
      if (description !== undefined) group.description = description;

      let cascade = null;
      const trimmedName = name !== undefined ? name.trim() : undefined;
      if (trimmedName && trimmedName !== group.name) {
        const clash = await Group.findOne({ name: trimmedName, _id: { $ne: group._id } });
        if (clash) return res.status(409).json({ error: 'A group with that name already exists' });

        const oldName = group.name;
        group.name = trimmedName;
        await group.save();

        const [deviceResult, userResult] = await Promise.all([
          Device.updateMany({ group: oldName }, { group: trimmedName }),
          User.updateMany({ groups: oldName }, { $set: { 'groups.$': trimmedName } }),
        ]);
        cascade = { devices: deviceResult.modifiedCount, users: userResult.modifiedCount };

        await recordAudit({
          actor: req.user,
          action: 'group.rename',
          entityType: 'group',
          entityId: group._id,
          entityLabel: `${oldName} → ${trimmedName}`,
          details: cascade,
        });
      } else {
        await group.save();
        await recordAudit({ actor: req.user, action: 'group.update', entityType: 'group', entityId: group._id, entityLabel: group.name });
      }

      res.json({ ...group.toObject(), cascade });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const [deviceResult, userResult] = await Promise.all([
      Device.updateMany({ group: group.name }, { group: '' }),
      User.updateMany({ groups: group.name }, { $pull: { groups: group.name } }),
    ]);
    await Group.findByIdAndDelete(group._id);

    await recordAudit({
      actor: req.user,
      action: 'group.delete',
      entityType: 'group',
      entityId: group._id,
      entityLabel: group.name,
      details: { devicesUnassigned: deviceResult.modifiedCount, usersUnassigned: userResult.modifiedCount },
    });

    res.json({ devicesUnassigned: deviceResult.modifiedCount, usersUnassigned: userResult.modifiedCount });
  });

  return router;
}

module.exports = buildGroupsRouter;
