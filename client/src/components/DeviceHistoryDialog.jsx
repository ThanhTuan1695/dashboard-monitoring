import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Spinner } from '@adminlte/react';
import { useBootstrapModal } from '../hooks/useBootstrapModal';
import { getDeviceHistory } from '../api/devices';
import { statusColors } from '../theme';

const MODAL_ID = 'device-history-modal';

const RANGES = [
  { key: '24h', label: '24h', days: 1 },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
];

const LEGEND = [
  { status: 'up', label: 'Up', icon: 'bi-check-circle-fill' },
  { status: 'down', label: 'Down', icon: 'bi-x-circle-fill' },
  { status: 'unknown', label: 'Unknown', icon: 'bi-question-circle-fill' },
];

function formatDuration(ms) {
  const hours = ms / (60 * 60 * 1000);
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60000))}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

// Below 99.95% shows one decimal; above shows two, so "5 nines" reads as more than a flat "100%".
function formatPercent(p) {
  if (p === null || p === undefined) return '—';
  return `${p.toFixed(p >= 99.95 ? 2 : 1)}%`;
}

export default function DeviceHistoryDialog({ open, device, onClose }) {
  const [rangeKey, setRangeKey] = useState('7d');
  const range = RANGES.find((r) => r.key === rangeKey) || RANGES[1];

  useBootstrapModal(MODAL_ID, open, onClose);

  const historyQuery = useQuery({
    queryKey: ['device-history', device?._id, range.days],
    queryFn: () => getDeviceHistory(device._id, range.days),
    enabled: open && Boolean(device),
  });

  const segments = historyQuery.data?.timeline || [];
  const uptime = historyQuery.data?.uptime || {};

  return (
    <Modal
      id={MODAL_ID}
      title={`${device?.name || ''} — status history`}
      size="lg"
      centered
      footer={<Button theme="secondary" outline label="Close" data-bs-dismiss="modal" />}
    >
      <div className="d-flex gap-5 mb-4">
        {RANGES.map((r) => (
          <div key={r.key}>
            <h4 className="mb-0">{formatPercent(uptime[r.key])}</h4>
            <span className="text-secondary">Uptime ({r.label})</span>
          </div>
        ))}
      </div>

      <div className="d-flex justify-content-between align-items-center mb-2">
        <span className="text-secondary text-uppercase fs-7 fw-bold">Timeline</span>
        <div className="btn-group" role="group">
          {RANGES.map((r) => (
            <Button
              key={r.key}
              theme="primary"
              outline={rangeKey !== r.key}
              size="sm"
              label={r.label}
              onClick={() => setRangeKey(r.key)}
            />
          ))}
        </div>
      </div>

      {historyQuery.isLoading ? (
        <div className="d-flex justify-content-center py-4">
          <Spinner theme="primary" />
        </div>
      ) : historyQuery.isError ? (
        <p className="text-danger py-2">Couldn't load history for this device.</p>
      ) : segments.length === 0 ? (
        <p className="text-secondary text-center py-4">No history yet for this range.</p>
      ) : (
        <>
          <div className="d-flex rounded overflow-hidden border" style={{ height: 28 }}>
            {segments.map((seg, i) => {
              const ms = Math.max(1, new Date(seg.to).getTime() - new Date(seg.from).getTime());
              return (
                <div
                  key={i}
                  title={`${seg.status} — ${formatDuration(ms)} (${new Date(seg.from).toLocaleString()} → ${new Date(seg.to).toLocaleString()})`}
                  style={{
                    flexGrow: ms,
                    flexShrink: 0,
                    flexBasis: 0,
                    minWidth: 1,
                    backgroundColor: statusColors[seg.status] || statusColors.unknown,
                    borderRight: i < segments.length - 1 ? '2px solid var(--bs-body-bg)' : 'none',
                  }}
                />
              );
            })}
          </div>
          <div className="d-flex gap-3 mt-2">
            {LEGEND.map(({ status, label, icon }) => (
              <span key={status} className="text-secondary">
                <i className={`bi ${icon} me-1`} style={{ color: statusColors[status] }}></i>
                {label}
              </span>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
