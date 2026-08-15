/**
 * Pure functions for turning a device's status-transition events into a
 * timeline of up/down/unknown segments and an uptime percentage. No DB
 * access here — callers fetch the events, these just do the math, which
 * keeps them trivially unit-testable.
 */

/**
 * Builds ordered segments covering [windowStart, windowEnd), clamped to not
 * start before the device existed. `events` need only be status transitions
 * for this device (order doesn't matter, they're sorted here).
 */
function buildTimeline(events, windowStart, windowEnd, deviceCreatedAt) {
  const effectiveStart = new Date(Math.max(new Date(windowStart).getTime(), new Date(deviceCreatedAt).getTime()));
  const end = new Date(windowEnd);
  if (effectiveStart >= end) return [];

  const sorted = events
    .map((e) => ({ status: e.status, at: new Date(e.at) }))
    .sort((a, b) => a.at - b.at);

  // Status effective at effectiveStart is whatever the last transition before
  // it set — or 'unknown' if the device hadn't transitioned yet.
  let initialStatus = 'unknown';
  for (const ev of sorted) {
    if (ev.at <= effectiveStart) initialStatus = ev.status;
  }

  const segments = [];
  let cursor = effectiveStart;
  let status = initialStatus;
  for (const ev of sorted) {
    if (ev.at <= effectiveStart || ev.at >= end) continue;
    segments.push({ status, from: cursor, to: ev.at });
    cursor = ev.at;
    status = ev.status;
  }
  segments.push({ status, from: cursor, to: end });
  return segments;
}

/** Reduces timeline segments to durations + an uptime %. Unknown time is excluded from the denominator. */
function computeUptime(segments) {
  let upMs = 0;
  let downMs = 0;
  let unknownMs = 0;
  for (const seg of segments) {
    const ms = seg.to.getTime() - seg.from.getTime();
    if (seg.status === 'up') upMs += ms;
    else if (seg.status === 'down') downMs += ms;
    else unknownMs += ms;
  }
  const knownMs = upMs + downMs;
  return { upMs, downMs, unknownMs, uptimePercent: knownMs > 0 ? (upMs / knownMs) * 100 : null };
}

module.exports = { buildTimeline, computeUptime };
