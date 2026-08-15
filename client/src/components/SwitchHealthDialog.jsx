import { Modal, Button, Spinner, Alert, Badge } from '@adminlte/react';
import { useBootstrapModal } from '../hooks/useBootstrapModal';
import { useDeviceHealthPanel } from '../hooks/useDeviceHealthPanel';
import HealthStatusBadge from './HealthStatusBadge';
import DiscoveryResultCard from './DiscoveryResultCard';
import DeviceCredentialForm from './DeviceCredentialForm';

const MODAL_ID = 'switch-health-modal';

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
function fmtWatts(v) {
  return v === null || v === undefined ? '—' : `${v} W`;
}
function criticalityTheme(criticality) {
  if (criticality === 'UPLINK' || criticality === 'CRITICAL') return 'warning';
  if (criticality === 'IGNORED') return 'secondary';
  return 'light';
}

export default function SwitchHealthDialog({ open, device, onClose }) {
  useBootstrapModal(MODAL_ID, open, onClose);
  const panel = useDeviceHealthPanel(device, open);
  const { health, isLoading, discoverResult, error, discoverMutation, pollMutation, setCredMutation, deleteCredMutation } = panel;
  const normalized = health?.normalized;

  return (
    <Modal
      id={MODAL_ID}
      title={`${device?.name || ''} — Switch health`}
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

      {discoverResult && <DiscoveryResultCard result={discoverResult} unknownVendorLabel="Unknown Switch" />}

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

          {normalized.stack?.enabled !== null && (
            <>
              <h6 className="text-secondary">Stack / Virtual Chassis</h6>
              <table className="table table-sm">
                <tbody>
                  <tr>
                    <td>Enabled</td>
                    <td>{normalized.stack.enabled ? 'Yes' : 'No'}</td>
                  </tr>
                  {normalized.stack.enabled && (
                    <>
                      <tr>
                        <td>Technology</td>
                        <td>{normalized.stack.technology || '—'}</td>
                      </tr>
                      <tr>
                        <td>Members</td>
                        <td>
                          {normalized.stack.members ?? '—'} / {normalized.stack.expectedMembers ?? '—'}
                        </td>
                      </tr>
                      <tr>
                        <td>Master</td>
                        <td>{normalized.stack.master || '—'}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </>
          )}

          {normalized.poe?.supported && (
            <>
              <h6 className="text-secondary">PoE</h6>
              <table className="table table-sm">
                <tbody>
                  <tr>
                    <td>Budget</td>
                    <td>{fmtWatts(normalized.poe.budgetWatts)}</td>
                  </tr>
                  <tr>
                    <td>Used</td>
                    <td>{fmtWatts(normalized.poe.usedWatts)}</td>
                  </tr>
                  <tr>
                    <td>Utilization</td>
                    <td>{fmtPercent(normalized.poe.utilizationPercent)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}

          {(normalized.layer2?.stp !== null || normalized.layer2?.lacp !== null) && (
            <>
              <h6 className="text-secondary">Layer 2</h6>
              <table className="table table-sm">
                <tbody>
                  <tr>
                    <td>STP</td>
                    <td>{normalized.layer2.stp || '—'}</td>
                  </tr>
                  <tr>
                    <td>LACP</td>
                    <td>{normalized.layer2.lacp || '—'}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}

          {normalized.interfaces?.length > 0 && (
            <>
              <h6 className="text-secondary">Ports</h6>
              <div className="table-responsive">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Port</th>
                      <th>Status</th>
                      <th>Role</th>
                      <th>Speed</th>
                      <th>Errors</th>
                      <th>Discards</th>
                    </tr>
                  </thead>
                  <tbody>
                    {normalized.interfaces.map((iface) => (
                      <tr key={iface.name}>
                        <td>{iface.name}</td>
                        <td className={iface.operStatus === 'UP' ? 'text-success' : 'text-danger'}>{iface.operStatus}</td>
                        <td>
                          <Badge theme={criticalityTheme(iface.criticality)}>{iface.criticality}</Badge>
                        </td>
                        <td>{iface.speedMbps !== null ? `${iface.speedMbps} Mbps` : '—'}</td>
                        <td>{(iface.rxErrors ?? 0) + (iface.txErrors ?? 0)}</td>
                        <td>{(iface.rxDiscards ?? 0) + (iface.txDiscards ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
