import { useEffect, useState } from 'react';
import { AppContent, Card, Select, Button, Spinner, Table } from '@adminlte/react';
import { listAuditLog } from '../api/audit';

const ENTITY_TYPES = [
  { value: '', label: 'All entities' },
  { value: 'device', label: 'Device' },
  { value: 'user', label: 'User' },
];

function formatDetails(entry) {
  if (!entry.details) return '—';
  try {
    return JSON.stringify(entry.details);
  } catch {
    return '—';
  }
}

const COLUMNS = [
  { key: 'at', header: 'When', render: (e) => new Date(e.at).toLocaleString() },
  { key: 'actorUsername', header: 'Actor' },
  { key: 'action', header: 'Action' },
  { key: 'entity', header: 'Entity', render: (e) => `${e.entityType}: ${e.entityLabel || e.entityId}` },
  {
    key: 'details',
    header: 'Details',
    render: (e) => (
      <span className="d-inline-block text-truncate" style={{ maxWidth: 320 }} title={formatDetails(e)}>
        {formatDetails(e)}
      </span>
    ),
  },
];

export default function AuditLogPage() {
  const [entityType, setEntityType] = useState('');
  const [entries, setEntries] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadPage = async (before, replace) => {
    setLoading(true);
    setError('');
    try {
      const params = { limit: 50, ...(entityType && { entityType }), ...(before && { before }) };
      const data = await listAuditLog(params);
      setEntries((prev) => (replace ? data.entries : [...prev, ...data.entries]));
      setNextBefore(data.nextBefore);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPage(null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType]);

  return (
    <AppContent>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h3 mb-0">Audit log</h1>
        <div style={{ minWidth: 180 }}>
          <Select name="entityType" fgroupClass="mb-0" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            {ENTITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card>
        {error && <p className="text-danger p-3 mb-0">{error}</p>}
        {!error && entries.length === 0 && !loading && <p className="text-secondary text-center p-3 mb-0">No audit entries yet.</p>}
        {entries.length > 0 && <Table columns={COLUMNS} data={entries} rowKey={(e) => e._id} hover small responsive />}
      </Card>

      <div className="d-flex justify-content-center mt-3">
        {loading ? <Spinner theme="primary" /> : nextBefore && <Button theme="secondary" outline size="sm" label="Load more" onClick={() => loadPage(nextBefore, false)} />}
      </div>
    </AppContent>
  );
}
