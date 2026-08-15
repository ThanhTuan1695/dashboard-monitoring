/**
 * Unit test for the scheduler's flap-damping status logic, run directly
 * against MonitorScheduler#checkAndUpdate with a fake device + fake check
 * results (monkey-patching `runCheck`). No MongoDB or real network needed —
 * this isolates the "how many failures before we call it down" decision,
 * which is the trickiest bit of logic in the monitoring service.
 */
const assert = require('assert');
const checks = require('./src/services/checks');
const StatusEvent = require('./src/models/StatusEvent');
const alerts = require('./src/services/alerts');
const MonitorScheduler = require('./src/services/scheduler');

// No DB in this test — monkey-patch the history write the same way runCheck is mocked below.
const createdEvents = [];
StatusEvent.create = async (doc) => {
  createdEvents.push(doc);
  return doc;
};

// The actual send/no-send decision (shouldAlert) is covered by test-alerts.js —
// here we just confirm the scheduler calls notifyStatusChange on every transition.
const alertCalls = [];
alerts.notifyStatusChange = async (device, previousStatus, newStatus) => {
  alertCalls.push({ previousStatus, newStatus });
};

function makeFakeDevice(overrides = {}) {
  return {
    _id: { toString: () => 'device-1' },
    ipAddress: '10.0.0.1',
    monitor: { method: 'ping', downAfterFailures: 3, ...overrides.monitor },
    status: { current: 'unknown', consecutiveFailures: 0, latencyMs: null, lastError: null, ...overrides.status },
    save: async function () {}, // no-op, mimics Mongoose document.save()
  };
}

async function withMockedCheck(results, fn) {
  const original = checks.runCheck;
  let i = 0;
  checks.runCheck = async () => results[Math.min(i++, results.length - 1)];
  try {
    await fn();
  } finally {
    checks.runCheck = original;
  }
}

async function main() {
  const events = [];
  const fakeIo = { to: () => ({ emit: (name, payload) => events.push({ name, payload }) }) };
  const scheduler = new MonitorScheduler(fakeIo);
  scheduler.running = true; // allow tick logic paths if exercised

  // Scenario 1: unknown -> up on first success.
  {
    const device = makeFakeDevice();
    await withMockedCheck([{ ok: true, latencyMs: 5, error: null }], async () => {
      const { changed } = await scheduler.checkAndUpdate(device);
      assert.strictEqual(device.status.current, 'up');
      assert.strictEqual(changed, true);
    });
  }

  // Scenario 2: up -> stays up after a single failure (below downAfterFailures=3).
  {
    const device = makeFakeDevice({ status: { current: 'up', consecutiveFailures: 0 } });
    await withMockedCheck([{ ok: false, latencyMs: null, error: 'timeout' }], async () => {
      const { changed } = await scheduler.checkAndUpdate(device);
      assert.strictEqual(device.status.current, 'up', 'should not flip to down on a single blip');
      assert.strictEqual(device.status.consecutiveFailures, 1);
      assert.strictEqual(changed, false);
    });
  }

  // Scenario 3: up -> down after reaching downAfterFailures consecutive failures.
  {
    const device = makeFakeDevice({ status: { current: 'up', consecutiveFailures: 2 } }); // one more failure hits threshold=3
    await withMockedCheck([{ ok: false, latencyMs: null, error: 'timeout' }], async () => {
      const { changed } = await scheduler.checkAndUpdate(device);
      assert.strictEqual(device.status.current, 'down');
      assert.strictEqual(changed, true);
    });
  }

  // Scenario 4: down -> up immediately on next success (no damping needed to recover).
  {
    const device = makeFakeDevice({ status: { current: 'down', consecutiveFailures: 5 } });
    await withMockedCheck([{ ok: true, latencyMs: 8, error: null }], async () => {
      const { changed } = await scheduler.checkAndUpdate(device);
      assert.strictEqual(device.status.current, 'up');
      assert.strictEqual(device.status.consecutiveFailures, 0);
      assert.strictEqual(changed, true);
    });
  }

  console.log(`[test] emitted ${events.length} status-changed events (expected 3):`, events.map((e) => e.payload.status));
  assert.strictEqual(events.length, 3, 'events should fire only on the 3 scenarios where status actually changed');

  assert.strictEqual(createdEvents.length, 3, 'a StatusEvent should be recorded only on the 3 scenarios where status actually changed');
  assert.deepStrictEqual(
    createdEvents.map((e) => e.status),
    ['up', 'down', 'up'],
    'recorded StatusEvent statuses should match the transitions in order'
  );

  assert.strictEqual(alertCalls.length, 3, 'notifyStatusChange should be called once per transition (its own gating decides whether to actually send)');
  assert.deepStrictEqual(
    alertCalls,
    [
      { previousStatus: 'unknown', newStatus: 'up' },
      { previousStatus: 'up', newStatus: 'down' },
      { previousStatus: 'down', newStatus: 'up' },
    ],
    'notifyStatusChange should be called with the correct previous/new status pairs, in order'
  );

  console.log('\n[test] ALL SCHEDULER FLAP-DAMPING TESTS PASSED');
}

main().catch((err) => {
  console.error('[test] FAILED', err);
  process.exitCode = 1;
});
