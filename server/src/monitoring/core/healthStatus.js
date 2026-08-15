// The five overall health states, shared by every device type's Health
// Engine (firewall, switch, ...) — a frozen object stands in for a
// TypeScript enum in this plain-JS codebase.
const HealthStatus = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  CRITICAL: 'CRITICAL',
  OFFLINE: 'OFFLINE',
});

module.exports = { HealthStatus };
