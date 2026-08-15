import { Badge } from '@adminlte/react';

// Supported values: UNKNOWN / HEALTHY / DEGRADED / CRITICAL / OFFLINE. One
// component, reused everywhere a connector-monitored device's health is
// shown (firewall, switch, ...) — no dialog re-implements this
// state-to-color/icon/label mapping itself.
const CONFIG = {
  HEALTHY: { label: 'Healthy', icon: 'bi-check-circle-fill', theme: 'success' },
  DEGRADED: { label: 'Degraded', icon: 'bi-exclamation-triangle-fill', theme: 'warning' },
  CRITICAL: { label: 'Critical', icon: 'bi-x-octagon-fill', theme: 'danger' },
  OFFLINE: { label: 'Offline', icon: 'bi-plug-fill', theme: 'dark' },
  UNKNOWN: { label: 'Unknown', icon: 'bi-question-circle-fill', theme: 'secondary' },
};

export default function HealthStatusBadge({ status }) {
  const cfg = CONFIG[status] || CONFIG.UNKNOWN;
  return (
    <Badge theme={cfg.theme}>
      <i className={`bi ${cfg.icon} me-1`}></i>
      {cfg.label}
    </Badge>
  );
}
