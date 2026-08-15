/**
 * Unit tests for the switch uplink-detection heuristic — a narrow, text-based
 * classifier (mirrors the firewall connector's `wan*` name pattern) that only
 * ever recognizes an explicit naming convention, never guesses from traffic
 * patterns or speed alone.
 */
const assert = require('assert');
const { classifyPort } = require('./src/switch/core/portClassification');

async function main() {
  assert.strictEqual(classifyPort('Uplink1'), 'UPLINK');
  assert.strictEqual(classifyPort('Te1/0/1-Core'), 'UPLINK');
  assert.strictEqual(classifyPort('to-dist-sw-01'), 'UPLINK');
  assert.strictEqual(classifyPort('wan'), 'UPLINK');
  assert.strictEqual(classifyPort('fw-uplink'), 'UPLINK');
  console.log('[test] OK: recognized uplink naming conventions classify as UPLINK');

  assert.strictEqual(classifyPort('Gi1/0/1'), 'NORMAL');
  assert.strictEqual(classifyPort('Te1/0/24'), 'NORMAL');
  assert.strictEqual(classifyPort(''), 'NORMAL');
  assert.strictEqual(classifyPort(null), 'NORMAL');
  assert.strictEqual(classifyPort(undefined), 'NORMAL');
  console.log('[test] OK: ordinary port names and missing input default to NORMAL, never guessed as UPLINK');

  console.log('\n[test] ALL SWITCH PORT CLASSIFICATION TESTS PASSED');
}

main().catch((err) => {
  console.error('[test] FAILED', err);
  process.exitCode = 1;
});
