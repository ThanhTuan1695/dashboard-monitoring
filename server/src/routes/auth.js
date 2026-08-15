const express = require('express');
const User = require('../models/User');
const { verifyPassword, signToken } = require('../services/auth');
const { requireAuth } = require('../middleware/auth');

function buildAuthRouter() {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const user = await User.findOne({ username: String(username).toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

    user.lastLoginAt = new Date();
    await user.save();

    const token = signToken(user);
    res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email, role: user.role },
    });
  });

  router.get('/me', requireAuth, async (req, res) => {
    const user = await User.findById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user._id, username: user.username, email: user.email, role: user.role });
  });

  return router;
}

module.exports = buildAuthRouter;
