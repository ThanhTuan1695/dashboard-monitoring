import { Table, Button, Tooltip } from '@adminlte/react';
import StatusChip from './StatusChip';
import { DEVICE_TYPES } from '../config/deviceTypeDefaults';

const TYPE_LABELS = Object.fromEntries(DEVICE_TYPES.map((t) => [t.value, t.label]));

function formatLastChecked(iso) {
  if (!iso) return 'Never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  return `${Math.round(diffSec / 3600)}h ago`;
}

export default function DeviceTable({ devices, onEdit, onDelete, onCheckNow, onViewHistory, onViewDeviceHealth }) {
  const columns = [
    { key: 'status', header: 'Status', render: (d) => <StatusChip status={d.status?.current} /> },
    { key: 'name', header: 'Name' },
    { key: 'type', header: 'Type', render: (d) => TYPE_LABELS[d.type] || d.type },
    { key: 'ipAddress', header: 'IP / host' },
    { key: 'location', header: 'Location', render: (d) => d.location || '—' },
    { key: 'group', header: 'Group', render: (d) => d.group || '—' },
    { key: 'lastChecked', header: 'Last checked', render: (d) => formatLastChecked(d.status?.lastCheckedAt) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      render: (d) => (
        <div className="d-flex gap-1 justify-content-end">
          <Tooltip title="Check now">
            <Button theme="secondary" outline size="sm" icon="bi-arrow-clockwise" aria-label="Check now" onClick={() => onCheckNow(d)} />
          </Tooltip>
          <Tooltip title="Status history">
            <Button theme="secondary" outline size="sm" icon="bi-clock-history" aria-label="Status history" onClick={() => onViewHistory(d)} />
          </Tooltip>
          {(d.type === 'firewall' || d.type === 'switch') && d.monitor?.method === 'connector' && (
            <Tooltip title={d.type === 'firewall' ? 'Firewall health' : 'Switch health'}>
              <Button
                theme="secondary"
                outline
                size="sm"
                icon="bi-shield-check"
                aria-label={d.type === 'firewall' ? 'Firewall health' : 'Switch health'}
                onClick={() => onViewDeviceHealth(d)}
              />
            </Tooltip>
          )}
          <Tooltip title="Edit">
            <Button theme="secondary" outline size="sm" icon="bi-pencil" aria-label="Edit" onClick={() => onEdit(d)} />
          </Tooltip>
          <Tooltip title="Remove">
            <Button theme="danger" outline size="sm" icon="bi-trash" aria-label="Remove" onClick={() => onDelete(d)} />
          </Tooltip>
        </div>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      data={devices || []}
      rowKey={(d) => d._id}
      hover
      small
      responsive
      emptyMessage="No devices yet — add your first one to start monitoring."
    />
  );
}
