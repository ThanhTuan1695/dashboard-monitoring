/**
 * Unit tests for the bandwidth rate calculator (spec: bandwidth isn't a
 * single SNMP read, it's a diff between two consecutive polls' cumulative
 * byte counters over a known time interval) and the Counter64 buffer parser
 * net-snmp hands back for 64-bit octet counters.
 */
const assert = require('assert');
const { computeInterfaceBandwidth } = require('./src/monitoring/core/bandwidthCalculator');
const { counter64ToNumber } = require('./src/monitoring/discovery/snmpCounters');

async function main() {
  // --- counter64ToNumber ---
  {
    // 1,000,000 as a big-endian 8-byte buffer.
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(1_000_000n);
    assert.strictEqual(counter64ToNumber(buf), 1_000_000);
  }
  console.log('[test] OK: counter64ToNumber decodes a big-endian Buffer correctly');

  {
    assert.strictEqual(counter64ToNumber(null), null);
    assert.strictEqual(counter64ToNumber(undefined), null);
  }
  console.log('[test] OK: counter64ToNumber returns null for missing input, never throws');

  // --- computeInterfaceBandwidth ---

  // First-ever poll: no previous snapshot to diff against -> null, never fabricated.
  {
    const current = [{ name: 'Gi1/0/1', speedMbps: 1000, rxOctets: 5_000_000, txOctets: 2_000_000 }];
    const { interfaces, bandwidth } = computeInterfaceBandwidth(current, null, null, new Date());
    assert.strictEqual(interfaces[0].rxMbps, null);
    assert.strictEqual(interfaces[0].txMbps, null);
    assert.strictEqual(interfaces[0].utilizationPercent, null);
    assert.strictEqual(bandwidth.totalRxMbps, null);
    assert.strictEqual(bandwidth.totalTxMbps, null);
  }
  console.log('[test] OK: first poll (no prior snapshot) -> bandwidth stays null, never fabricated');

  // Normal case: 10,000,000 bytes received over 10 seconds -> 8 Mbps.
  {
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const t1 = new Date('2026-01-01T00:00:10.000Z');
    const previous = [{ name: 'Gi1/0/1', rxOctets: 0, txOctets: 0 }];
    const current = [{ name: 'Gi1/0/1', speedMbps: 1000, rxOctets: 10_000_000, txOctets: 1_250_000 }];
    const { interfaces, bandwidth } = computeInterfaceBandwidth(current, previous, t0, t1);
    assert.strictEqual(interfaces[0].rxMbps, 8, '10,000,000 bytes / 10s * 8 bits = 8 Mbps');
    assert.strictEqual(interfaces[0].txMbps, 1, '1,250,000 bytes / 10s * 8 bits = 1 Mbps');
    assert.strictEqual(interfaces[0].utilizationPercent, 1, 'max(8,1)/1000 * 100, rounded');
    assert.strictEqual(bandwidth.totalRxMbps, 8);
    assert.strictEqual(bandwidth.totalTxMbps, 1);
  }
  console.log('[test] OK: normal delta over a known interval computes correct Mbps and utilization%');

  // Counter reset (e.g. interface flapped/reboot): current < previous -> null, not a huge/negative number.
  {
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const t1 = new Date('2026-01-01T00:00:10.000Z');
    const previous = [{ name: 'Gi1/0/1', rxOctets: 10_000_000, txOctets: 0 }];
    const current = [{ name: 'Gi1/0/1', speedMbps: 1000, rxOctets: 500, txOctets: 0 }];
    const { interfaces } = computeInterfaceBandwidth(current, previous, t0, t1);
    assert.strictEqual(interfaces[0].rxMbps, null, 'a counter that went backwards must never produce a fabricated/negative rate');
  }
  console.log('[test] OK: counter reset (current < previous) -> null, never a garbage/negative rate');

  // Multiple interfaces: totals sum across all interfaces that have a valid rate.
  {
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const t1 = new Date('2026-01-01T00:00:01.000Z');
    const previous = [
      { name: 'Gi1/0/1', rxOctets: 0, txOctets: 0 },
      { name: 'Gi1/0/2', rxOctets: 0, txOctets: 0 },
    ];
    const current = [
      { name: 'Gi1/0/1', speedMbps: 1000, rxOctets: 125_000, txOctets: 0 }, // 1 Mbps
      { name: 'Gi1/0/2', speedMbps: 1000, rxOctets: 250_000, txOctets: 0 }, // 2 Mbps
    ];
    const { bandwidth } = computeInterfaceBandwidth(current, previous, t0, t1);
    assert.strictEqual(bandwidth.totalRxMbps, 3, 'total device bandwidth sums across all interfaces');
  }
  console.log('[test] OK: total device bandwidth sums per-interface rates correctly');

  // A brand-new interface with no counterpart in the previous poll -> null for that interface alone.
  {
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const t1 = new Date('2026-01-01T00:00:10.000Z');
    const previous = [{ name: 'Gi1/0/1', rxOctets: 0, txOctets: 0 }];
    const current = [
      { name: 'Gi1/0/1', speedMbps: 1000, rxOctets: 1_250_000, txOctets: 0 },
      { name: 'Gi1/0/2', speedMbps: 1000, rxOctets: 999, txOctets: 0 },
    ];
    const { interfaces } = computeInterfaceBandwidth(current, previous, t0, t1);
    const newIface = interfaces.find((i) => i.name === 'Gi1/0/2');
    assert.strictEqual(newIface.rxMbps, null, 'an interface with no prior counterpart must not get a fabricated rate');
  }
  console.log('[test] OK: interface with no prior counterpart (new/renamed) -> null, not guessed');

  console.log('\n[test] ALL BANDWIDTH CALCULATOR TESTS PASSED');
}

main().catch((err) => {
  console.error('[test] FAILED', err);
  process.exitCode = 1;
});
