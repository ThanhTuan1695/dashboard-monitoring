import { Modal, Button, Spinner, Alert } from '@adminlte/react';
import { useBootstrapModal } from '../hooks/useBootstrapModal';
import { useDeviceHealthPanel } from '../hooks/useDeviceHealthPanel';
import HealthStatusBadge from './HealthStatusBadge';
import DiscoveryResultCard from './DiscoveryResultCard';
import DeviceCredentialForm from './DeviceCredentialForm';

const MODAL_ID = 'firewall-health-modal';

function fmtTri(v) {
  return v === true ? 'Available' : v === false ? 'Unavailable' : 'Not configured';
}
function fmtPercent(v) {
  return v === null || v === undefined ? '—' : `${v}%`;
}
function fmtUptime(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}

export default function FirewallHealthDialog({ open, device, onClose }) {
  useBootstrapModal(MODAL_ID, open, onClose);
  const panel = useDeviceHealthPanel(device, open);
  const { health, isLoading, discoverResult, error, discoverMutation, pollMutation, setCredMutation, deleteCredMutation } = panel;
  const normalized = health?.normalized;

  return (
    <Modal
      id={MODAL_ID}
      title={`${device?.name || ''} — Firewall health`}
      size="lg"
      scrollable
      centered
      footer={<Button theme="secondary" outline label="Close" data-bs-dismiss="modal" />}
    >
      {error && <Alert theme="danger">{error}</Alert>}

      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <span className="text-secondary me-2">Overall</span>
          <HealthStatusBadge status={health?.overallStatus || 'UNKNOWN'} />
        </div>
        <div className="d-flex gap-2">
          <Button
            theme="secondary"
            outline
            size="sm"
            icon="bi-search"
            label={discoverMutation.isPending ? 'Discovering…' : 'Discover Device'}
            disabled={discoverMutation.isPending}
            onClick={() => discoverMutation.mutate()}
          />
          <Button
            theme="primary"
            size="sm"
            icon="bi-arrow-clockwise"
            label={pollMutation.isPending ? 'Polling…' : 'Poll now'}
            disabled={pollMutation.isPending}
            onClick={() => pollMutation.mutate()}
          />
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-3">
          <Spinner theme="primary" />
        </div>
      )}

      {discoverResult && <DiscoveryResultCard result={discoverResult} unknownVendorLabel="Unknown Firewall" />}

      {normalized && (
        <>
          <h6 className="text-secondary">Device</h6>
          <table className="table table-sm">
            <tbody>
              <tr>
                <td>Vendor</td>
                <td>{normalized.device.vendor || '—'}</td>
              </tr>
              <tr>
                <td>Product</td>
                <td>{normalized.device.product || '—'}</td>
              </tr>
              <tr>
                <td>Model</td>
                <td>{normalized.device.model || '—'}</td>
              </tr>
              <tr>
                <td>Version</td>
                <td>{normalized.device.version || '—'}</td>
              </tr>
              <tr>
                <td>Serial</td>
                <td>{normalized.device.serial || '—'}</td>
              </tr>
              <tr>
                <td>Hostname</td>
                <td>{normalized.device.hostname || '—'}</td>
              </tr>
            </tbody>
          </table>

          <h6 className="text-secondary">Connectivity</h6>
          <table className="table table-sm">
            <tbody>
              <tr>
                <td>Management</td>
                <td>{normalized.connectivity.managementStatus}</td>
              </tr>
              <tr>
                <td>HTTPS</td>
                <td>{fmtTri(normalized.connectivity.https)}</td>
              </tr>
              <tr>
                <td>Native API</td>
                <td>{fmtTri(normalized.connectivity.api)}</td>
              </tr>
              <tr>
                <td>SNMP</td>
                <td>{fmtTri(normalized.connectivity.snmp)}</td>
              </tr>
              <tr>
                <td>NETCONF</td>
                <td>{fmtTri(normalized.connectivity.netconf)}</td>
              </tr>
            </tbody>
          </table>

          <h6 className="text-secondary">Resources</h6>
          <table className="table table-sm">
            <tbody>
              <tr>
                <td>CPU</td>
                <td>{fmtPercent(normalized.health.cpuPercent)}</td>
              </tr>
              <tr>
                <td>Memory</td>
                <td>{fmtPercent(normalized.health.memoryPercent)}</td>
              </tr>
              <tr>
                <td>Uptime</td>
                <td>{fmtUptime(normalized.health.uptimeSeconds)}</td>
              </tr>
            </tbody>
          </table>

          {normalized.ha?.enabled !== null && (
            <>
              <h6 className="text-secondary">HA</h6>
              <table className="table table-sm">
                <tbody>
                  <tr>
                    <td>Enabled</td>
                    <td>{normalized.ha.enabled ? 'Yes' : 'No'}</td>
                  </tr>
                  {normalized.ha.enabled && (
                    <>
                      <tr>
                        <td>Role</td>
                        <td>{normalized.ha.role || '—'}</td>
                      </tr>
                      <tr>
                        <td>Peer</td>
                        <td>{normalized.ha.peerStatus || '—'}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </>
          )}

          {normalized.interfaces?.length > 0 && (
            <>
              <h6 className="text-secondary">Interfaces</h6>
              <table className="table table-sm">
                <tbody>
                  {normalized.interfaces.map((iface) => (
                    <tr key={iface.name}>
                      <td>{iface.name}</td>
                      <td className={iface.operStatus === 'up' ? 'text-success' : 'text-danger'}>{iface.operStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {health?.healthReasons?.length > 0 && (
            <>
              <h6 className="text-secondary">Health reasons</h6>
              <ul className="mb-0">
                {health.healthReasons.map((reason, i) => (
                  <li key={i}>{reason.message}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <hr />
      <DeviceCredentialForm
        hasCredential={health?.hasCredential}
        credType={panel.credType}
        setCredType={panel.setCredType}
        credFields={panel.credFields}
        setCredFields={panel.setCredFields}
        setCredMutation={setCredMutation}
        deleteCredMutation={deleteCredMutation}
      />
    </Modal>
  );
}
