import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Spinner } from '@adminlte/react';
import { useBootstrapModal } from '../hooks/useBootstrapModal';
import { getDeviceHistory } from '../api/devices';
import { statusColors } from '../theme';
import { describeCheck } from '../utils/describeCheck';
import StatusChip from './StatusChip';

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

function formatWhen(iso) {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString();
}

function hasDiscoveredInfo(snmpInfo) {
  if (!snmpInfo) return false;
  return Boolean(snmpInfo.sysDescr || snmpInfo.model || snmpInfo.serial || snmpInfo.version || snmpInfo.interfaceCount != null);
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
      {device && (
        <div className="card mb-3">
          <div className="card-body py-2">
            <div className="d-flex justify-content-between align-items-start">
              <div>
                <span className="text-secondary text-uppercase fs-7 fw-bold">Last check</span>
                <div className="mt-1">
                  <code className="fs-7">{describeCheck(device)}</code>
                </div>
              </div>
              <StatusChip status={device.status?.current} />
            </div>
            <div className="text-secondary fs-7 mt-2">
              Checked {formatWhen(device.status?.lastCheckedAt)}
              {device.status?.current === 'up' && device.status?.latencyMs != null && ` — ${Math.round(device.status.latencyMs)}ms`}
              {device.status?.current === 'down' && device.status?.lastError && ` — ${device.status.lastError}`}
            </div>
          </div>
        </div>
      )}

      {hasDiscoveredInfo(device?.snmpInfo) && (
        <div className="card mb-3">
          <div className="card-body py-2">
            <span className="text-secondary text-uppercase fs-7 fw-bold">Discovered info (via SNMP)</span>
            <table className="table table-sm mb-0 mt-1">
              <tbody>
                {device.snmpInfo.model && (
                  <tr>
                    <td className="text-secondary">Model</td>
                    <td>{device.snmpInfo.model}</td>
                  </tr>
                )}
                {device.snmpInfo.serial && (
                  <tr>
                    <td className="text-secondary">Serial</td>
                    <td>{device.snmpInfo.serial}</td>
                  </tr>
                )}
                {device.snmpInfo.version && (
                  <tr>
                    <td className="text-secondary">Firmware</td>
                    <td>{device.snmpInfo.version}</td>
                  </tr>
                )}
                {device.snmpInfo.interfaceCount != null && (
                  <tr>
                    <td className="text-secondary">Interfaces</td>
                    <td>{device.snmpInfo.interfaceCount}</td>
                  </tr>
                )}
                {device.snmpInfo.sysDescr && (
                  <tr>
                    <td className="text-secondary">sysDescr</td>
                    <td className="fs-7">{device.snmpInfo.sysDescr}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="text-secondary fs-7 mb-0 mt-1">Discovered {formatWhen(device.snmpInfo.discoveredAt)}</p>
          </div>
        </div>
      )}

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
