const Device = require('../models/Device');
const User = require('../models/User');
const Group = require('../models/Group');

/**
 * Backfills the Group registry from whatever's already in use on devices/users
 * (freeform strings from before this registry existed). Idempotent — safe to
 * call on every GET /api/groups so the registry never drifts out of sync.
 */
async function syncGroupsFromUsage() {
  const [deviceGroups, userGroups] = await Promise.all([
    Device.distinct('group', { group: { $ne: '' } }),
    User.distinct('groups'),
  ]);
  await registerGroups([...deviceGroups, ...userGroups]);
}

/** Registers any new group names immediately as they're assigned, so they show up in the registry without waiting for a sync. */
async function registerGroups(names) {
  const clean = [...new Set((names || []).filter(Boolean))];
  if (clean.length === 0) return;

  const existing = new Set(await Group.distinct('name', { name: { $in: clean } }));
  const missing = clean.filter((n) => !existing.has(n));
  if (missing.length === 0) return;

  // Races with a concurrent insert of the same name are fine to ignore (unique index handles it).
  await Group.insertMany(
    missing.map((name) => ({ name })),
    { ordered: false }
  ).catch(() => {});
}

module.exports = { syncGroupsFromUsage, registerGroups };
