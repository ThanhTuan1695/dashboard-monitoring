/**
 * Creates (or resets) an admin user. Needed because there's no public
 * registration endpoint — the first admin has to be created out of band.
 *
 * Usage: npm run seed:admin -- <username> <password> [email]
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const { hashPassword } = require('../services/auth');

async function main() {
  const [username, password, email] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage: npm run seed:admin -- <username> <password> [email]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }

  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/monitoring-dashboard';
  await mongoose.connect(MONGODB_URI);

  const passwordHash = await hashPassword(password);
  const normalizedUsername = username.toLowerCase().trim();
  const existing = await User.findOne({ username: normalizedUsername });

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.role = 'admin';
    if (email) existing.email = email;
    await existing.save();
    console.log(`Updated existing user "${normalizedUsername}" to admin with the new password.`);
  } else {
    await User.create({ username: normalizedUsername, passwordHash, role: 'admin', email: email || '' });
    console.log(`Created admin user "${normalizedUsername}".`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed:admin] failed:', err.message);
  process.exit(1);
});
