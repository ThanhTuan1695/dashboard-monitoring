/**
 * Seeds a demo RBAC dataset: three groups, a couple of devices in each (so
 * there's something real for group-restricted operators to see or not see),
 * and one operator per group plus an unrestricted operator and a second
 * admin — enough to exercise every branch of the group-visibility rules in
 * services/groupAccess.js end to end without hand-creating it all via the UI.
 *
 * Idempotent: existing groups/devices are left alone (never overwritten);
 * existing users have their role/groups/password reset to the seed values,
 * same behavior as seed:admin, so this is always safe to re-run.
 *
 * Usage: npm run seed:demo
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Group = require('../models/Group');
const Device = require('../models/Device');
const User = require('../models/User');
const { hashPassword } = require('../services/auth');
const { getDefaultMonitorConfig } = require('../config/deviceTypeDefaults');

const SEED_PASSWORD = 'demo-password-123';

const GROUPS = [
  { name: 'headquarters', description: 'HQ network and servers' },
  { name: 'east-datacenter', description: 'East coast datacenter' },
  { name: 'west-datacenter', description: 'West coast datacenter' },
];

// RFC 5737 TEST-NET-3 — reserved/non-routable, so these "monitor" safely without
// ever reaching a real host. They'll show as down, which is expected for seed data.
const DEVICES = [
  { name: 'HQ Core Switch', type: 'switch', ipAddress: '203.0.113.10', group: 'headquarters' },
  { name: 'HQ File Server', type: 'server', ipAddress: '203.0.113.11', group: 'headquarters' },
  { name: 'East DC Firewall', type: 'firewall', ipAddress: '203.0.113.20', group: 'east-datacenter' },
  { name: 'East DC App Server', type: 'application', ipAddress: '203.0.113.21', group: 'east-datacenter' },
  { name: 'West DC Firewall', type: 'firewall', ipAddress: '203.0.113.30', group: 'west-datacenter' },
  { name: 'West DC App Server', type: 'application', ipAddress: '203.0.113.31', group: 'west-datacenter' },
];

// One operator per group (sees only that group + ungrouped devices), one admin
// (sees everything), and one unrestricted operator (empty groups = sees everything too).
const USERS = [
  { username: 'demo-admin', role: 'admin', groups: [] },
  { username: 'op-hq', role: 'operator', groups: ['headquarters'] },
  { username: 'op-east', role: 'operator', groups: ['east-datacenter'] },
  { username: 'op-west', role: 'operator', groups: ['west-datacenter'] },
  { username: 'op-all', role: 'operator', groups: [] },
];

async function main() {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/monitoring-dashboard';
  await mongoose.connect(MONGODB_URI);
  console.log(`[seed:demo] connected to ${MONGODB_URI}`);

  for (const g of GROUPS) {
    const existing = await Group.findOne({ name: g.name });
    if (existing) {
      console.log(`[seed:demo] group "${g.name}" already exists, leaving it as-is`);
    } else {
      await Group.create(g);
      console.log(`[seed:demo] created group "${g.name}"`);
    }
  }

  for (const d of DEVICES) {
    const existing = await Device.findOne({ name: d.name });
    if (existing) {
      console.log(`[seed:demo] device "${d.name}" already exists, leaving it as-is`);
      continue;
    }
    const monitor = getDefaultMonitorConfig(d.type);
    await Device.create({ ...d, monitor });
    console.log(`[seed:demo] created device "${d.name}" (${d.type}, group=${d.group})`);
  }

  const passwordHash = await hashPassword(SEED_PASSWORD);
  for (const u of USERS) {
    const existing = await User.findOne({ username: u.username });
    if (existing) {
      existing.role = u.role;
      existing.groups = u.groups;
      existing.passwordHash = passwordHash;
      await existing.save();
      console.log(`[seed:demo] updated user "${u.username}" (role=${u.role}, groups=${JSON.stringify(u.groups)})`);
    } else {
      await User.create({ username: u.username, role: u.role, groups: u.groups, passwordHash });
      console.log(`[seed:demo] created user "${u.username}" (role=${u.role}, groups=${JSON.stringify(u.groups)})`);
    }
  }

  console.log(`\n[seed:demo] Done. All seeded users share the password: ${SEED_PASSWORD} (change it — this is demo data)`);
  console.log('[seed:demo] Authorization matrix:');
  console.log('  demo-admin  -> admin, sees every device regardless of group');
  console.log('  op-hq       -> operator, sees only "headquarters" + ungrouped devices');
  console.log('  op-east     -> operator, sees only "east-datacenter" + ungrouped devices');
  console.log('  op-west     -> operator, sees only "west-datacenter" + ungrouped devices');
  console.log('  op-all      -> operator with no groups assigned (unrestricted), sees every device');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed:demo] failed:', err.message);
  process.exit(1);
});
