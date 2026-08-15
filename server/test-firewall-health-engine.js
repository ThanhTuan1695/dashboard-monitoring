/**
 * Unit tests for the firewall Health Engine — pure function, no DB/network.
 * Exercises the state rules from the spec (§17/§18): OFFLINE only when every
 * channel fails (never ICMP alone), UNKNOWN when reachable but telemetry-less,
 * CPU/memory thresholds, HA-peer-down -> DEGRADED, critical alarm -> CRITICAL,
 * API auth failure alone -> DEGRADED (not OFFLINE/CRITICAL).
 */
const assert = require('assert');
const { HealthEngine } = require('./src/firewall/health/healthEngine');
const { HealthStatus, emptyNormalizedHealth } = require('./src/firewall/core/healthStatus');

const engine = new HealthEngine();

function baseline(overrides = {}) {
  const n = emptyNormalizedHealth('device-1', '10.0.0.1');
  return { ...n, ...overrides };
}

async function main() {
  // --- OFFLINE ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: false, https: false, api: false, snmp: false, netconf: false };
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.OFFLINE);
    assert(result.reasons.some((r) => r.code === 'DEVICE_UNREACHABLE'));
  }
  console.log('[test] OK: every channel down -> OFFLINE');

  // --- NOT offline when ICMP is blocked but HTTPS/SNMP still answer (spec's explicit example) ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: false, https: true, api: null, snmp: false, netconf: false, managementStatus: 'reachable' };
    const result = engine.evaluate(n);
    assert.notStrictEqual(result.status, HealthStatus.OFFLINE, 'ICMP blocked alone must never mean OFFLINE if another channel works');
  }
  console.log('[test] OK: ICMP blocked but HTTPS reachable -> not OFFLINE');

  // --- UNKNOWN: reachable but no real telemetry (e.g. credentials not provided) ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, https: false, api: null, snmp: false, netconf: false };
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.UNKNOWN);
    assert(!result.reasons.some((r) => r.severity === 'critical'), 'missing credentials must never imply CRITICAL');
  }
  console.log('[test] OK: reachable with no telemetry -> UNKNOWN, never CRITICAL/OFFLINE');

  // --- HEALTHY ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, https: true, api: true, snmp: false, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 18, memoryPercent: 40, uptimeSeconds: 12345 };
    n.ha = { enabled: true, role: 'primary', peerStatus: 'healthy', synchronized: true };
    n.interfaces = [{ name: 'wan1', adminStatus: 'up', operStatus: 'up' }, { name: 'port1', adminStatus: 'up', operStatus: 'up' }];
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.HEALTHY);
    assert.strictEqual(result.reasons.length, 0);
  }
  console.log('[test] OK: everything nominal -> HEALTHY');

  // --- DEGRADED: API auth failed, but another channel (SNMP) is active ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, https: true, api: false, snmp: true, managementStatus: 'auth_failed' };
    n.health = { ...n.health, cpuPercent: 20, memoryPercent: 30, uptimeSeconds: 999 };
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.DEGRADED);
    assert(result.reasons.some((r) => r.code === 'API_UNAVAILABLE'));
  }
  console.log('[test] OK: API auth failure with SNMP fallback active -> DEGRADED, not OFFLINE');

  // --- DEGRADED: HA peer down ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, api: true, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 20, memoryPercent: 30 };
    n.ha = { enabled: true, role: 'primary', peerStatus: 'down', synchronized: true };
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.DEGRADED);
    assert(result.reasons.some((r) => r.code === 'HA_PEER_DOWN'));
  }
  console.log('[test] OK: HA peer down -> DEGRADED');

  // --- DEGRADED: CPU >= 85% ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, api: true, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 90, memoryPercent: 30 };
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.DEGRADED);
    assert(result.reasons.some((r) => r.code === 'CPU_HIGH'));
  }
  console.log('[test] OK: CPU at 90% -> DEGRADED');

  // --- CRITICAL: CPU >= 95% ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, api: true, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 97, memoryPercent: 30 };
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.CRITICAL);
    assert(result.reasons.some((r) => r.code === 'CPU_CRITICAL'));
  }
  console.log('[test] OK: CPU at 97% -> CRITICAL');

  // --- CRITICAL: a critical alarm always wins ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, api: true, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 10, memoryPercent: 10 };
    n.alarms = [{ severity: 'critical', message: 'Power supply failure' }];
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.CRITICAL);
    assert(result.reasons.some((r) => r.code === 'CRITICAL_ALARM'));
  }
  console.log('[test] OK: critical alarm -> CRITICAL regardless of other metrics');

  // --- CRITICAL: primary (sole) WAN interface down ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, api: true, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 10, memoryPercent: 10 };
    n.interfaces = [{ name: 'wan1', adminStatus: 'up', operStatus: 'down' }];
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.CRITICAL);
    assert(result.reasons.some((r) => r.code === 'WAN_DOWN'));
  }
  console.log('[test] OK: sole WAN interface down -> CRITICAL');

  // --- DEGRADED: secondary WAN down (one of two) ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, api: true, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 10, memoryPercent: 10 };
    n.interfaces = [
      { name: 'wan1', adminStatus: 'up', operStatus: 'up' },
      { name: 'wan2', adminStatus: 'up', operStatus: 'down' },
    ];
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.DEGRADED);
    assert(result.reasons.some((r) => r.code === 'WAN_DEGRADED'));
  }
  console.log('[test] OK: one of two WAN interfaces down -> DEGRADED');

  console.log('\n[test] ALL FIREWALL HEALTH ENGINE TESTS PASSED');
}

main().catch((err) => {
  console.error('[test] FAILED', err);
  process.exitCode = 1;
});
