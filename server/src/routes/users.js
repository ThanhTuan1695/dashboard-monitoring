const express = require('express');
const User = require('../models/User');
const { hashPassword } = require('../services/auth');
const { requireAdmin } = require('../middleware/auth');
const { recordAudit } = require('../services/audit');
const { registerGroups } = require('../services/groupRegistry');

// All routes here are admin-only — user management, not device management.
function buildUsersRouter() {
  const router = express.Router();
  router.use(requireAdmin);

  router.get('/', async (_req, res) => {
    const users = await User.find({}, '-passwordHash').sort({ username: 1 });
    res.json(users);
  });

  router.post('/', async (req, res) => {
    try {
      const { username, password, email, role, groups } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: 'username and password are required' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'password must be at least 8 characters' });
      }

      const passwordHash = await hashPassword(password);
      const user = await User.create({
        username: String(username).toLowerCase().trim(),
        email: email || '',
        role: role === 'admin' ? 'admin' : 'operator',
        groups: Array.isArray(groups) ? groups.filter(Boolean) : [],
        passwordHash,
      });
      if (user.groups.length) await registerGroups(user.groups);
      await recordAudit({
        actor: req.user,
        action: 'user.create',
        entityType: 'user',
        entityId: user._id,
        entityLabel: user.username,
        details: { role: user.role, groups: user.groups },
      });
      res.status(201).json({ id: user._id, username: user.username, email: user.email, role: user.role, groups: user.groups });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: 'Username already exists' });
      res.status(400).json({ error: err.message });
    }
  });

  router.put('/:id', async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { email, role, password, groups } = req.body || {};
    if (email !== undefined) user.email = email;
    if (groups !== undefined) {
      user.groups = Array.isArray(groups) ? groups.filter(Boolean) : [];
      if (user.groups.length) await registerGroups(user.groups);
    }

    let roleChanged = false;
    if (role !== undefined && role !== user.role) {
      if (role !== 'admin' && role !== 'operator') {
        return res.status(400).json({ error: 'role must be admin or operator' });
      }
      if (user.role === 'admin' && role !== 'admin') {
        const adminCount = await User.countDocuments({ role: 'admin' });
        if (adminCount <= 1) return res.status(400).json({ error: 'Cannot demote the last remaining admin' });
      }
      const previousRole = user.role;
      user.role = role;
      roleChanged = true;
      await recordAudit({
        actor: req.user,
        action: 'user.role-change',
        entityType: 'user',
        entityId: user._id,
        entityLabel: user.username,
        details: { from: previousRole, to: role },
      });
    }

    let passwordReset = false;
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
      user.passwordHash = await hashPassword(password);
      passwordReset = true;
    }

    await user.save();

    if (passwordReset) {
      await recordAudit({
        actor: req.user,
        action: 'user.password-reset',
        entityType: 'user',
        entityId: user._id,
        entityLabel: user.username,
      });
    }
    if (!roleChanged && !passwordReset) {
      await recordAudit({
        actor: req.user,
        action: 'user.update',
        entityType: 'user',
        entityId: user._id,
        entityLabel: user.username,
        details: { email, groups: user.groups },
      });
    }

    res.json({ id: user._id, username: user.username, email: user.email, role: user.role, groups: user.groups });
  });

  router.delete('/:id', async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (req.user.sub === req.params.id) {
      return res.status(400).json({ error: "You can't delete your own account" });
    }
    if (user.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) return res.status(400).json({ error: 'Cannot delete the last remaining admin' });
    }

    await User.findByIdAndDelete(req.params.id);
    await recordAudit({
      actor: req.user,
      action: 'user.delete',
      entityType: 'user',
      entityId: req.params.id,
      entityLabel: user.username,
    });
    res.status(204).send();
  });

  return router;
}

module.exports = buildUsersRouter;
