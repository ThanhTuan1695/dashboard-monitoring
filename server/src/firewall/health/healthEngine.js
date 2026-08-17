const { HealthStatus } = require('../../monitoring/core/healthStatus');
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
  const noHaData = n.ha.enabled === null;
  const noRealTelemetryChannel = n.connectivity.api !== true && n.connectivity.snmp !== true;
  return noResourceData && noHaData && n.alarms.length === 0 && noRealTelemetryChannel;
}

/**
 * No generic MIB tags an interface as "the WAN" — this heuristic (interfaces
 * named wan*) only actually fires for FortiGate's naming convention; any
 * other vendor's interfaces just leave this component UNKNOWN, never guessed.
 */
function evaluateWan(n) {
  const wanIfaces = n.interfaces.filter((i) => /^wan/i.test(i.name));
  if (wanIfaces.length === 0) return { status: HealthStatus.UNKNOWN, reasons: [] };

  const down = wanIfaces.filter((i) => i.operStatus !== 'up');
  if (down.length === 0) return { status: HealthStatus.HEALTHY, reasons: [] };

  const allDown = down.length === wanIfaces.length;
  const severity = allDown ? 'critical' : 'degraded';
  return {
    status: allDown ? HealthStatus.CRITICAL : HealthStatus.DEGRADED,
    reasons: down.map((i) => ({ code: allDown ? 'WAN_DOWN' : 'WAN_DEGRADED', severity, message: `WAN interface ${i.name} is down` })),
  };
}

function evaluateHa(n) {
  if (n.ha.enabled === null) return { status: HealthStatus.UNKNOWN, reasons: [] };
  if (!n.ha.enabled) return { status: HealthStatus.HEALTHY, reasons: [] };

  const reasons = [];
  if (n.ha.peerStatus === 'down') reasons.push({ code: 'HA_PEER_DOWN', severity: 'degraded', message: 'HA peer is down' });
  if (n.ha.synchronized === false) reasons.push({ code: 'HA_SYNC_PROBLEM', severity: 'degraded', message: 'HA synchronization problem' });
  return { status: reasons.length ? HealthStatus.DEGRADED : HealthStatus.HEALTHY, reasons };
}

function evaluateLicense(n) {
  if (n.license.status === null) return { status: HealthStatus.UNKNOWN, reasons: [] };
  if (/expiring|near/i.test(n.license.status)) {
    return { status: HealthStatus.DEGRADED, reasons: [{ code: 'LICENSE_NEAR_EXPIRY', severity: 'degraded', message: 'License is near expiration' }] };
  }
  return { status: HealthStatus.HEALTHY, reasons: [] };
}

function evaluateDevice(n) {
  const alarmReasons = n.alarms
    .filter((a) => a.severity === 'critical')
    .map((a) => ({ code: 'CRITICAL_ALARM', severity: 'critical', message: a.message || 'Critical firewall alarm detected' }));
  return { status: alarmReasons.length ? HealthStatus.CRITICAL : HealthStatus.HEALTHY, reasons: alarmReasons };
}

function evaluateDataPlane(n) {
  if (n.interfaces.length === 0) return { status: HealthStatus.UNKNOWN, reasons: [] };
  if (n.interfaces.every((i) => i.operStatus === 'up')) return { status: HealthStatus.HEALTHY, reasons: [] };
  return { status: HealthStatus.DEGRADED, reasons: [{ code: 'INTERFACE_DOWN', severity: 'degraded', message: 'One or more interfaces are down' }] };
}

const OFFLINE_COMPONENTS = {
  device: HealthStatus.OFFLINE,
  management: HealthStatus.OFFLINE,
  dataPlane: HealthStatus.UNKNOWN,
  wan: HealthStatus.UNKNOWN,
  ha: HealthStatus.UNKNOWN,
  environment: HealthStatus.UNKNOWN,
  resources: HealthStatus.UNKNOWN,
  securityServices: HealthStatus.UNKNOWN,
  license: HealthStatus.UNKNOWN,
};

const EVALUATORS = {
  device: evaluateDevice,
  management: evaluateManagement,
  dataPlane: evaluateDataPlane,
  wan: evaluateWan,
  ha: evaluateHa,
  environment: evaluateEnvironment,
  resources: evaluateResources,
  securityServices: () => ({ status: HealthStatus.UNKNOWN, reasons: [] }), // getSecurityServices not implemented this pass
  license: evaluateLicense,
};

/** Health is calculated centrally, never inside a vendor connector — this just wires firewall-specific rules into the shared state machine. */
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
