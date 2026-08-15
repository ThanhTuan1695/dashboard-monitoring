const { HealthStatus } = require('../core/healthStatus');
const thresholds = require('../core/thresholds');

/**
 * Component evaluators whose logic is identical across every device type —
 * hoisted here instead of copy-pasted into firewall/switch's health engines,
 * so a threshold or rule change never has to be made twice.
 */

/** Management channel health from the connectivity status ConnectorManager already computed. */
function evaluateManagement(n) {
  if (n.connectivity.managementStatus === 'auth_failed') {
    return {
      status: HealthStatus.DEGRADED,
      reasons: [{ code: 'API_UNAVAILABLE', severity: 'degraded', message: 'Native management API is unavailable; another monitoring channel is active' }],
    };
  }
  if (n.connectivity.managementStatus === 'reachable') return { status: HealthStatus.HEALTHY, reasons: [] };
  return { status: HealthStatus.UNKNOWN, reasons: [] };
}

/** CPU/memory/disk against the shared 85%/95% thresholds. */
function evaluateResources(n) {
  const reasons = [];
  const check = (value, degradedAt, criticalAt, label, code) => {
    if (value === null) return;
    if (value >= criticalAt) reasons.push({ code: `${code}_CRITICAL`, severity: 'critical', message: `${label} is above ${criticalAt}%` });
    else if (value >= degradedAt) reasons.push({ code: `${code}_HIGH`, severity: 'degraded', message: `${label} is above ${degradedAt}%` });
  };
  check(n.health.cpuPercent, thresholds.CPU_DEGRADED_PERCENT, thresholds.CPU_CRITICAL_PERCENT, 'CPU utilization', 'CPU');
  check(n.health.memoryPercent, thresholds.MEMORY_DEGRADED_PERCENT, thresholds.MEMORY_CRITICAL_PERCENT, 'Memory utilization', 'MEMORY');
  check(n.health.diskPercent, thresholds.DISK_DEGRADED_PERCENT, thresholds.DISK_CRITICAL_PERCENT, 'Disk utilization', 'DISK');

  if (reasons.some((r) => r.severity === 'critical')) return { status: HealthStatus.CRITICAL, reasons };
  if (reasons.length) return { status: HealthStatus.DEGRADED, reasons };
  if (n.health.cpuPercent === null && n.health.memoryPercent === null) return { status: HealthStatus.UNKNOWN, reasons: [] };
  return { status: HealthStatus.HEALTHY, reasons: [] };
}

module.exports = { evaluateManagement, evaluateResources };
