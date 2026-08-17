const { HealthStatus } = require('../../monitoring/core/healthStatus');
const thresholds = require('../../monitoring/core/thresholds');
const { evaluateOverall } = require('../../monitoring/health/healthEngineCore');
const { evaluateManagement, evaluateResources, evaluateEnvironment } = require('../../monitoring/health/commonEvaluators');

/**
 * OFFLINE only when *no* channel works — ICMP blocked alone must never mean
 * offline if e.g. HTTPS or SNMP still answers.
 */
function isOffline(n) {
  const c = n.connectivity;
  return !c.icmp && !c.https && !c.api && !c.snmp && !c.netconf;
}

/** UNKNOWN cases: reachable, but no real telemetry collected yet — e.g. credentials not provided. */
function hasInsufficientData(n) {
  const noResourceData = n.health.cpuPercent === null && n.health.memoryPercent === null && n.health.uptimeSeconds === null;
  const noInterfaceData = n.interfaces.length === 0;
  const noRealTelemetryChannel = n.connectivity.api !== true && n.connectivity.snmp !== true;
  return noResourceData && noInterfaceData && n.alarms.length === 0 && noRealTelemetryChannel;
}

function evaluateDevice(n) {
  const alarmReasons = n.alarms
    .filter((a) => a.severity === 'critical')
    .map((a) => ({ code: 'CRITICAL_ALARM', severity: 'critical', message: a.message || 'Critical switch alarm detected' }));
  return { status: alarmReasons.length ? HealthStatus.CRITICAL : HealthStatus.HEALTHY, reasons: alarmReasons };
}

/**
 * A normal, unused port being DOWN is expected and must not degrade switch
 * health — only ports classified UPLINK/CRITICAL matter here (spec's port
 * classification rule). "interfaces" as a whole component stays HEALTHY as
 * long as we have any interface data at all; the uplink-specific rule below
 * is what actually reacts to a down port.
 */
function evaluateInterfaces(n) {
  if (n.interfaces.length === 0) return { status: HealthStatus.UNKNOWN, reasons: [] };
  return { status: HealthStatus.HEALTHY, reasons: [] };
}

/**
 * Sole/primary uplink down -> CRITICAL; one of several uplinks down ->
 * DEGRADED — mirrors the firewall connector's WAN-interface rule exactly,
 * just keyed off the port classification (UPLINK/CRITICAL) instead of a
 * `wan*` name pattern.
 */
function evaluateUplinks(n) {
  const uplinks = n.interfaces.filter((i) => i.criticality === 'UPLINK' || i.criticality === 'CRITICAL');
  if (uplinks.length === 0) return { status: HealthStatus.UNKNOWN, reasons: [] };

  const down = uplinks.filter((i) => i.operStatus !== 'UP');
  if (down.length === 0) return { status: HealthStatus.HEALTHY, reasons: [] };

  const allDown = down.length === uplinks.length;
  const severity = allDown ? 'critical' : 'degraded';
  return {
    status: allDown ? HealthStatus.CRITICAL : HealthStatus.DEGRADED,
    reasons: down.map((i) => ({
      code: allDown ? 'UPLINK_DOWN' : 'UPLINK_DEGRADED',
      severity,
      message: `${i.criticality === 'UPLINK' ? 'Uplink' : 'Critical'} port ${i.name} is down`,
    })),
  };
}

function evaluateStack(n) {
  if (n.stack.enabled === null) return { status: HealthStatus.UNKNOWN, reasons: [] };
  if (!n.stack.enabled) return { status: HealthStatus.HEALTHY, reasons: [] };

  if (n.stack.status === 'CRITICAL') {
    return { status: HealthStatus.CRITICAL, reasons: [{ code: 'STACK_CRITICAL', severity: 'critical', message: 'Stack is in a critical state' }] };
  }
  const memberMissing = n.stack.expectedMembers !== null && n.stack.members !== null && n.stack.members < n.stack.expectedMembers;
  if (n.stack.status === 'DEGRADED' || memberMissing) {
    return { status: HealthStatus.DEGRADED, reasons: [{ code: 'STACK_MEMBER_DOWN', severity: 'degraded', message: 'One or more stack members are unavailable' }] };
  }
  return { status: HealthStatus.HEALTHY, reasons: [] };
}

/**
 * PoE budget thresholds — per spec, both the 80% and 95% tiers are DEGRADED
 * ("informational" at 80%, still DEGRADED and not CRITICAL at 95%). CRITICAL
 * is reserved for "budget exhausted AND expected devices can't get power",
 * which the generic SNMP connector can't detect (no concept of "expected
 * devices"), so it's never fabricated here.
 */
function evaluatePoe(n) {
  if (!n.poe.supported || n.poe.utilizationPercent === null) return { status: HealthStatus.UNKNOWN, reasons: [] };
  if (n.poe.utilizationPercent >= thresholds.POE_CRITICAL_PERCENT) {
    return { status: HealthStatus.DEGRADED, reasons: [{ code: 'POE_BUDGET_CRITICAL', severity: 'degraded', message: 'PoE budget usage is critically high' }] };
  }
  if (n.poe.utilizationPercent >= thresholds.POE_DEGRADED_PERCENT) {
    return { status: HealthStatus.DEGRADED, reasons: [{ code: 'POE_BUDGET_HIGH', severity: 'degraded', message: 'PoE budget usage is high' }] };
  }
  return { status: HealthStatus.HEALTHY, reasons: [] };
}

function evaluateLayer2(n) {
  if (n.layer2.stp === null && n.layer2.lacp === null) return { status: HealthStatus.UNKNOWN, reasons: [] };
  return { status: HealthStatus.HEALTHY, reasons: [] }; // no failure signal modeled yet for the generic connector
}

const OFFLINE_COMPONENTS = {
  device: HealthStatus.OFFLINE,
  management: HealthStatus.OFFLINE,
  interfaces: HealthStatus.UNKNOWN,
  uplinks: HealthStatus.UNKNOWN,
  stack: HealthStatus.UNKNOWN,
  environment: HealthStatus.UNKNOWN,
  poe: HealthStatus.UNKNOWN,
  layer2: HealthStatus.UNKNOWN,
  resources: HealthStatus.UNKNOWN,
};

const EVALUATORS = {
  device: evaluateDevice,
  management: evaluateManagement,
  interfaces: evaluateInterfaces,
  uplinks: evaluateUplinks,
  stack: evaluateStack,
  environment: evaluateEnvironment,
  poe: evaluatePoe,
  layer2: evaluateLayer2,
  resources: evaluateResources,
};

/** Health is calculated centrally, never inside a vendor connector — this just wires switch-specific rules into the shared state machine. */
class HealthEngine {
  evaluate(normalized) {
    return evaluateOverall({
      normalized,
      isOffline,
      offlineComponents: OFFLINE_COMPONENTS,
      hasInsufficientData,
      evaluators: EVALUATORS,
    });
  }
}

module.exports = { HealthEngine };
