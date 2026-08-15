import { Badge } from '@adminlte/react';

const CONFIG = {
  up: { label: 'Up', icon: 'bi-check-circle-fill', theme: 'success' },
  down: { label: 'Down', icon: 'bi-x-circle-fill', theme: 'danger' },
  unknown: { label: 'Unknown', icon: 'bi-question-circle-fill', theme: 'secondary' },
};

// Status is always shown as an icon + text label, never color alone (per the
// fixed status-palette accessibility rule).
export default function StatusChip({ status }) {
  const cfg = CONFIG[status] || CONFIG.unknown;
  return (
    <Badge theme={cfg.theme}>
      <i className={`bi ${cfg.icon} me-1`}></i>
      {cfg.label}
    </Badge>
  );
}
