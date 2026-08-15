/**
 * Serializes async calls through a single per-connector queue. Regardless of
 * how a caller (e.g. mergeFromConnector's Promise.all) schedules multiple
 * connector methods concurrently, the underlying SNMP requests against one
 * device never overlap — many embedded SNMP agents (firewalls/switches)
 * handle two simultaneous table walks poorly and return corrupted or empty
 * data for one of them (observed on real hardware: blank interface names
 * and every interface showing "down" when ifTable and ifXTable were walked
 * via Promise.all). Each connector instance creates its own queue, so this
 * never serializes requests across unrelated devices.
 */
function createRequestQueue() {
  let tail = Promise.resolve();
  return function enqueue(task) {
    const run = tail.then(task, task);
    tail = run.then(
      () => {},
      () => {}
    );
    return run;
  };
}

module.exports = { createRequestQueue };
