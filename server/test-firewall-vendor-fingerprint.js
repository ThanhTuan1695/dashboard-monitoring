/**
 * Unit tests for vendor confidence scoring (spec §13) — must return
 * `{vendor: null}` below the confidence threshold rather than guessing.
 */
const assert = require('assert');
const { fingerprint, CONFIDENCE_THRESHOLD } = require('./src/monitoring/discovery/vendorFingerprint');

async function main() {
  // Strong signal: SNMP sysDescr explicitly names FortiGate/FortiOS.
  {
    const result = fingerprint({
      snmp: { sysDescr: 'FortiGate-100F v7.4.8,build2599,231018 (GA.M)' },
      https: { title: 'FortiGate', server: null, tlsSubject: 'FortiGate' },
    });
    assert.strictEqual(result.vendor, 'fortinet');
    assert(result.product.includes('FortiGate'));
    assert(result.confidence >= CONFIDENCE_THRESHOLD);
    assert(result.evidence.length > 0);
  }
  console.log('[test] OK: strong FortiGate evidence -> high-confidence fortinet match');

  // No evidence at all -> unknown, never a guess.
  {
    const result = fingerprint({ snmp: {}, https: {} });
    assert.strictEqual(result.vendor, null);
    assert.strictEqual(result.product, null);
    assert.strictEqual(result.confidence, 0);
  }
  console.log('[test] OK: no evidence -> vendor null (never guesses)');

  // Weak/ambiguous evidence below threshold -> still unknown, but confidence reported.
  {
    const result = fingerprint({ snmp: {}, https: { server: 'nginx' } });
    assert.strictEqual(result.vendor, null);
    assert(result.confidence < CONFIDENCE_THRESHOLD);
  }
  console.log('[test] OK: unrelated evidence -> below threshold, vendor stays null');

  // A non-Fortinet sysDescr must not be mistaken for FortiGate.
  {
    const result = fingerprint({ snmp: { sysDescr: 'Cisco IOS Software, C2900 Software' }, https: {} });
    assert.strictEqual(result.vendor, null);
  }
  console.log('[test] OK: a different vendor\'s sysDescr does not match FortiGate');

  console.log('\n[test] ALL VENDOR FINGERPRINT TESTS PASSED');
}

main().catch((err) => {
  console.error('[test] FAILED', err);
  process.exitCode = 1;
});
