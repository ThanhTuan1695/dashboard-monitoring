/**
 * Unit tests for the SNMP request queue — this is the root-cause fix for a
 * real bug observed against live hardware: two SNMP table walks issued
 * concurrently (e.g. ifTable + ifXTable, or getInterfaces + getDeviceInfo
 * via mergeFromConnector's Promise.all) came back corrupted/empty because
 * the embedded SNMP agent couldn't handle two simultaneous walks. Verifies
 * tasks enqueued through the same queue always run one at a time, in order,
 * regardless of how the caller schedules them (Promise.all included).
 */
const assert = require('assert');
const { createRequestQueue } = require('./src/monitoring/discovery/requestQueue');

function delay(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

async function main() {
  // --- Tasks enqueued together never overlap ---
  {
    const enqueue = createRequestQueue();
    let concurrent = 0;
    let maxConcurrent = 0;
    const runTracked = async (ms, value) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      const result = await delay(ms, value);
      concurrent -= 1;
      return result;
    };

    const results = await Promise.all([
      enqueue(() => runTracked(30, 'a')),
      enqueue(() => runTracked(10, 'b')),
      enqueue(() => runTracked(20, 'c')),
    ]);

    assert.strictEqual(maxConcurrent, 1, 'no two enqueued tasks should ever run concurrently, even when scheduled via Promise.all');
    assert.deepStrictEqual(results, ['a', 'b', 'c'], 'results preserve the order tasks were enqueued in, not completion order');
  }
  console.log('[test] OK: tasks scheduled concurrently via Promise.all still execute strictly one at a time');

  // --- A rejected task doesn't break the queue for subsequent tasks ---
  {
    const enqueue = createRequestQueue();
    const results = [];
    const p1 = enqueue(async () => {
      throw new Error('simulated SNMP timeout');
    }).catch((err) => {
      results.push(`caught: ${err.message}`);
    });
    const p2 = enqueue(async () => {
      results.push('second task ran');
      return 'ok';
    });

    await Promise.all([p1, p2]);
    assert.deepStrictEqual(results, ['caught: simulated SNMP timeout', 'second task ran']);
  }
  console.log('[test] OK: a rejected task is isolated to its own caller — the queue still runs later tasks');

  // --- Enqueuing after prior tasks have already settled still works (queue doesn't get "stuck") ---
  {
    const enqueue = createRequestQueue();
    await enqueue(() => delay(5, 'first'));
    const second = await enqueue(() => delay(5, 'second'));
    assert.strictEqual(second, 'second');
  }
  console.log('[test] OK: the queue keeps accepting new tasks after earlier ones have already completed');

  console.log('\n[test] ALL REQUEST QUEUE TESTS PASSED');
}

main().catch((err) => {
  console.error('[test] FAILED', err);
  process.exitCode = 1;
});
