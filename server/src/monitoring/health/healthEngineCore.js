const { HealthStatus } = require('../core/healthStatus');

const SEVERITY_RANK = { critical: 3, degraded: 2, healthy: 1, unknown: 0 };

function statusToSeverity(status) {
  if (status === HealthStatus.CRITICAL) return 'critical';
  if (status === HealthStatus.DEGRADED) return 'degraded';
  if (status === HealthStatus.HEALTHY) return 'healthy';
  return 'unknown';
}

/**
 * The state machine every device type's Health Engine wraps — health is
 * calculated centrally, never inside a connector, and never duplicated per
 * device type. OFFLINE short-circuits everything when no channel is
 * reachable (there's nothing to evaluate without connectivity); otherwise
 * every component evaluator runs, and overall = the worst component
 * severity, downgraded from HEALTHY to UNKNOWN when there's simply no real
 * telemetry yet (e.g. credentials not provided).
 *
 * `evaluators` is a map of componentKey -> (normalized) => {status, reasons}.
 */
function evaluateOverall({ normalized, isOffline, offlineComponents, hasInsufficientData, evaluators }) {
  if (isOffline(normalized)) {
    return {
      status: HealthStatus.OFFLINE,
      reasons: [{ code: 'DEVICE_UNREACHABLE', severity: 'critical', message: 'No usable monitoring channel is reachable' }],
      components: offlineComponents,
    };
  }

  const components = {};
  const reasons = [];
  for (const [key, evaluate] of Object.entries(evaluators)) {
    const result = evaluate(normalized);
    components[key] = result.status;
    reasons.push(...result.reasons);
  }

  const worstSeverity = Object.values(components).reduce((worst, status) => {
    const sev = statusToSeverity(status);
    return SEVERITY_RANK[sev] > SEVERITY_RANK[worst] ? sev : worst;
  }, 'unknown');

  if (worstSeverity === 'critical') return { status: HealthStatus.CRITICAL, reasons, components };
  if (worstSeverity === 'degraded') return { status: HealthStatus.DEGRADED, reasons, components };
  if (worstSeverity === 'healthy' && !hasInsufficientData(normalized)) return { status: HealthStatus.HEALTHY, reasons, components };
  return { status: HealthStatus.UNKNOWN, reasons, components };
}

module.exports = { evaluateOverall, statusToSeverity, SEVERITY_RANK };
