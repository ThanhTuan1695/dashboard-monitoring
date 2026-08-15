/**
 * Unit tests for the down-alert gating logic — pure function, no DB, no
 * network (notifyStatusChange's actual HTTP POST is exercised in the
 * integration smoke test instead, against a local fake webhook receiver).
 */
const assert = require('assert');
const { shouldAlert } = require('./src/services/alerts');

async function main() {
  assert.strictEqual(shouldAlert('up', 'down'), true, 'up -> down should alert');
  assert.strictEqual(shouldAlert('unknown', 'down'), true, 'unknown -> down should alert (newly failing device)');
  console.log('[test] OK: transitions into down alert');

  assert.strictEqual(shouldAlert('down', 'up'), true, 'down -> up (recovery) should alert by default');
  assert.strictEqual(shouldAlert('down', 'up', { alertOnRecovery: false }), false, 'recovery alert should be suppressible');
  console.log('[test] OK: recovery alerting respects alertOnRecovery');

  assert.strictEqual(shouldAlert('unknown', 'up'), false, 'unknown -> up (first-ever success) is not a "recovery"');
  console.log('[test] OK: first successful check is not treated as a recovery');

  assert.strictEqual(shouldAlert('up', 'unknown'), false, 'transitions to/from unknown otherwise should never alert');
  assert.strictEqual(shouldAlert('down', 'unknown'), false);
  console.log('[test] OK: unknown transitions never alert');

  assert.strictEqual(shouldAlert('up', 'down', { alertsEnabled: false }), false, 'per-device mute should suppress all alerts');
  console.log('[test] OK: alertsEnabled: false mutes a device entirely');

  console.log('\n[test] ALL ALERT-GATING TESTS PASSED');
}

main().catch((err) => {
  console.error('[test] FAILED', err);
  process.exitCode = 1;
});
