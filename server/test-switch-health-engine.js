/**
 * Unit tests for the switch Health Engine — pure function, no DB/network.
 * Mirrors test-firewall-health-engine.js's coverage style: OFFLINE only when
 * every channel fails, UNKNOWN when reachable but telemetry-less, CPU/memory
 * thresholds, critical alarm -> CRITICAL, plus switch-specific rules (a
 * normal port going down must NOT degrade health, only uplink/critical
 * ports do; stack member loss -> DEGRADED; PoE budget high -> DEGRADED).
 */
const assert = require('assert');
const { HealthEngine } = require('./src/switch/health/healthEngine');
const { HealthStatus, emptyNormalizedHealth } = require('./src/switch/core/healthStatus');

const engine = new HealthEngine();

function baseline(overrides = {}) {
  const n = emptyNormalizedHealth('switch-1', '10.0.0.2');
  return { ...n, ...overrides };
}

function port(name, operStatus, criticality) {
  return { name, adminStatus: 'UP', operStatus, criticality };
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

  // --- NOT offline when ICMP is blocked but SNMP still answers ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: false, https: false, api: null, snmp: true, netconf: false, managementStatus: 'reachable' };
    const result = engine.evaluate(n);
    assert.notStrictEqual(result.status, HealthStatus.OFFLINE, 'ICMP blocked alone must never mean OFFLINE if another channel works');
  }
  console.log('[test] OK: ICMP blocked but SNMP reachable -> not OFFLINE');

  // --- UNKNOWN: reachable but no real telemetry (e.g. credentials not provided) ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, https: false, api: null, snmp: false, netconf: false };
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.UNKNOWN);
    assert(!result.reasons.some((r) => r.severity === 'critical'), 'missing credentials must never imply CRITICAL');
  }
  console.log('[test] OK: reachable with no telemetry -> UNKNOWN, never CRITICAL/OFFLINE');

  // --- HEALTHY: normal ports flapping down must not degrade health ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, snmp: true, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 18, memoryPercent: 40, uptimeSeconds: 12345 };
    n.interfaces = [port('uplink1', 'UP', 'UPLINK'), port('Gi1/0/2', 'DOWN', 'NORMAL'), port('Gi1/0/3', 'DOWN', 'NORMAL')];
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.HEALTHY);
    assert.strictEqual(result.reasons.length, 0);
  }
  console.log('[test] OK: unused/normal ports down -> still HEALTHY (only uplink/critical ports matter)');

  // --- CRITICAL: sole uplink down ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, snmp: true, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 10, memoryPercent: 10 };
    n.interfaces = [port('uplink1', 'DOWN', 'UPLINK')];
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.CRITICAL);
    assert(result.reasons.some((r) => r.code === 'UPLINK_DOWN'));
  }
  console.log('[test] OK: sole uplink down -> CRITICAL');

  // --- DEGRADED: one of two uplinks down ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, snmp: true, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 10, memoryPercent: 10 };
    n.interfaces = [port('uplink1', 'UP', 'UPLINK'), port('uplink2', 'DOWN', 'UPLINK')];
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.DEGRADED);
    assert(result.reasons.some((r) => r.code === 'UPLINK_DEGRADED'));
  }
  console.log('[test] OK: one of two uplinks down -> DEGRADED');

  // --- DEGRADED: CPU >= 85% ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, snmp: true, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 90, memoryPercent: 30 };
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.DEGRADED);
    assert(result.reasons.some((r) => r.code === 'CPU_HIGH'));
  }
  console.log('[test] OK: CPU at 90% -> DEGRADED');

  // --- CRITICAL: CPU >= 95% ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, snmp: true, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 97, memoryPercent: 30 };
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.CRITICAL);
    assert(result.reasons.some((r) => r.code === 'CPU_CRITICAL'));
  }
  console.log('[test] OK: CPU at 97% -> CRITICAL');

  // --- CRITICAL: a critical alarm always wins ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, snmp: true, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 10, memoryPercent: 10 };
    n.alarms = [{ severity: 'critical', message: 'PSU 1 failure' }];
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.CRITICAL);
    assert(result.reasons.some((r) => r.code === 'CRITICAL_ALARM'));
  }
  console.log('[test] OK: critical alarm -> CRITICAL regardless of other metrics');

  // --- DEGRADED: stack member missing ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, snmp: true, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 10, memoryPercent: 10 };
    n.stack = { enabled: true, technology: 'STACKWISE', status: null, members: 1, expectedMembers: 2, master: 'member-1' };
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.DEGRADED);
    assert(result.reasons.some((r) => r.code === 'STACK_MEMBER_DOWN'));
  }
  console.log('[test] OK: stack member unavailable (1/2) -> DEGRADED');

  // --- CRITICAL: stack reports a critical state ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, snmp: true, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 10, memoryPercent: 10 };
    n.stack = { enabled: true, technology: 'STACKWISE', status: 'CRITICAL', members: 1, expectedMembers: 2, master: null };
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.CRITICAL);
    assert(result.reasons.some((r) => r.code === 'STACK_CRITICAL'));
  }
  console.log('[test] OK: stack reports CRITICAL -> CRITICAL');

  // --- DEGRADED: PoE budget usage high ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, snmp: true, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 10, memoryPercent: 10 };
    n.poe = { supported: true, budgetWatts: 740, usedWatts: 630, utilizationPercent: 85 };
    const result = engine.evaluate(n);
    assert.strictEqual(result.status, HealthStatus.DEGRADED);
    assert(result.reasons.some((r) => r.code === 'POE_BUDGET_HIGH'));
  }
  console.log('[test] OK: PoE usage at 85% -> DEGRADED (never CRITICAL — spec reserves that for budget exhaustion we can\'t detect)');

  // --- UNKNOWN: PoE unsupported must never be reported as a failure ---
  {
    const n = baseline();
    n.connectivity = { ...n.connectivity, icmp: true, snmp: true, managementStatus: 'reachable' };
    n.health = { ...n.health, cpuPercent: 10, memoryPercent: 10 };
    const result = engine.evaluate(n);
    assert.strictEqual(result.components.poe, HealthStatus.UNKNOWN);
  }
  console.log('[test] OK: PoE not supported/collected -> UNKNOWN component, not a failure');

  console.log('\n[test] ALL SWITCH HEALTH ENGINE TESTS PASSED');
}

main().catch((err) => {
  console.error('[test] FAILED', err);
  process.exitCode = 1;
});
