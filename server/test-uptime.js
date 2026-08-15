/**
 * Unit tests for the uptime/timeline math — pure functions, no DB, no
 * network. This is the trickiest bit of the history feature (reconstructing
 * a continuous timeline from sparse transition events), so it's worth
 * verifying directly against hand-built event sequences.
 */
const assert = require('assert');
const { buildTimeline, computeUptime } = require('./src/services/uptime');

function hoursAgo(h, now) {
  return new Date(now.getTime() - h * 60 * 60 * 1000);
}

async function main() {
  const now = new Date('2026-01-08T00:00:00.000Z');
  const deviceCreatedAt = hoursAgo(48, now); // device has existed for the whole window below

  // Scenario 1: no events at all in a 24h window -> whole window is 'unknown', uptime null.
  {
    const windowStart = hoursAgo(24, now);
    const timeline = buildTimeline([], windowStart, now, deviceCreatedAt);
    assert.strictEqual(timeline.length, 1);
    assert.strictEqual(timeline[0].status, 'unknown');
    const { uptimePercent } = computeUptime(timeline);
    assert.strictEqual(uptimePercent, null, 'no known up/down time -> uptime is null, not 0');
  }
  console.log('[test] OK: empty history -> unknown timeline, null uptime');

  // Scenario 2: device came up 20h ago and has stayed up -> ~100% uptime over 24h (only known portion counts).
  {
    const windowStart = hoursAgo(24, now);
    const events = [{ status: 'up', at: hoursAgo(20, now) }];
    const timeline = buildTimeline(events, windowStart, now, deviceCreatedAt);
    assert.strictEqual(timeline.length, 2, 'should split into unknown-then-up segments');
    assert.strictEqual(timeline[0].status, 'unknown');
    assert.strictEqual(timeline[1].status, 'up');
    const { uptimePercent, upMs, downMs } = computeUptime(timeline);
    assert.strictEqual(downMs, 0);
    assert.strictEqual(uptimePercent, 100, 'all known time was up -> 100%');
    assert.strictEqual(upMs, 20 * 60 * 60 * 1000);
  }
  console.log('[test] OK: up the whole known window -> 100% uptime');

  // Scenario 3: up for 18h, down for 6h within a 24h window -> 75% uptime.
  {
    const windowStart = hoursAgo(24, now);
    const events = [
      { status: 'up', at: hoursAgo(24, now) }, // effectively the window start
      { status: 'down', at: hoursAgo(6, now) },
    ];
    const timeline = buildTimeline(events, windowStart, now, deviceCreatedAt);
    const { uptimePercent, upMs, downMs } = computeUptime(timeline);
    assert.strictEqual(upMs, 18 * 60 * 60 * 1000);
    assert.strictEqual(downMs, 6 * 60 * 60 * 1000);
    assert.strictEqual(uptimePercent, 75);
  }
  console.log('[test] OK: 18h up / 6h down -> 75% uptime');

  // Scenario 4: window starts before the device existed -> clamped to deviceCreatedAt.
  {
    const windowStart = hoursAgo(72, now); // device is only 48h old
    const events = [{ status: 'up', at: hoursAgo(40, now) }];
    const timeline = buildTimeline(events, windowStart, now, deviceCreatedAt);
    assert.strictEqual(
      timeline[0].from.getTime(),
      deviceCreatedAt.getTime(),
      'timeline should not extend before the device was created'
    );
  }
  console.log('[test] OK: window clamped to device creation time');

  // Scenario 5: flapping down -> up -> down within the window, multiple segments.
  {
    const windowStart = hoursAgo(10, now);
    const events = [
      { status: 'up', at: hoursAgo(10, now) },
      { status: 'down', at: hoursAgo(8, now) },
      { status: 'up', at: hoursAgo(5, now) },
      { status: 'down', at: hoursAgo(1, now) },
    ];
    const timeline = buildTimeline(events, windowStart, now, deviceCreatedAt);
    assert.strictEqual(timeline.length, 4);
    const { uptimePercent, upMs, downMs } = computeUptime(timeline);
    // up: [10->8]=2h + [5->1]=4h = 6h; down: [8->5]=3h + [1->now]=1h = 4h
    assert.strictEqual(upMs, 6 * 60 * 60 * 1000);
    assert.strictEqual(downMs, 4 * 60 * 60 * 1000);
    assert.strictEqual(uptimePercent, 60);
  }
  console.log('[test] OK: multiple flaps produce correct segment durations and uptime %');

  console.log('\n[test] ALL UPTIME/TIMELINE TESTS PASSED');
}

main().catch((err) => {
  console.error('[test] FAILED', err);
  process.exitCode = 1;
});
