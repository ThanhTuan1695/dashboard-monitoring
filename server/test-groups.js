/**
 * Unit tests for operator device-group visibility rules — pure functions,
 * no DB needed.
 */
const assert = require('assert');
const { isRestrictedOperator, deviceVisibilityFilter, canAccessDevice } = require('./src/services/groupAccess');

async function main() {
  // Admins are never restricted, regardless of `groups`.
  assert.strictEqual(isRestrictedOperator({ role: 'admin', groups: ['siteA'] }), false);
  assert.strictEqual(deviceVisibilityFilter({ role: 'admin', groups: ['siteA'] }), null);
  assert.strictEqual(canAccessDevice({ role: 'admin', groups: [] }, { group: 'siteB' }), true);
  console.log('[test] OK: admins are unrestricted');

  // An operator with no groups assigned is unrestricted (backward-compat default).
  assert.strictEqual(isRestrictedOperator({ role: 'operator', groups: [] }), false);
  assert.strictEqual(deviceVisibilityFilter({ role: 'operator', groups: [] }), null);
  assert.strictEqual(canAccessDevice({ role: 'operator', groups: [] }, { group: 'siteB' }), true);
  console.log('[test] OK: operator with no groups assigned sees everything');

  // A restricted operator sees their groups + ungrouped devices, not other groups.
  const opA = { role: 'operator', groups: ['siteA'] };
  assert.strictEqual(isRestrictedOperator(opA), true);
  assert.deepStrictEqual(deviceVisibilityFilter(opA), { $or: [{ group: { $in: ['siteA'] } }, { group: '' }] });
  assert.strictEqual(canAccessDevice(opA, { group: 'siteA' }), true, 'own group is visible');
  assert.strictEqual(canAccessDevice(opA, { group: '' }), true, 'ungrouped devices are visible to everyone');
  assert.strictEqual(canAccessDevice(opA, {}), true, 'devices with no group field at all count as ungrouped');
  assert.strictEqual(canAccessDevice(opA, { group: 'siteB' }), false, 'other groups are not visible');
  console.log('[test] OK: restricted operator sees own group + ungrouped, not other groups');

  console.log('\n[test] ALL GROUP-ACCESS TESTS PASSED');
}

main().catch((err) => {
  console.error('[test] FAILED', err);
  process.exitCode = 1;
});
