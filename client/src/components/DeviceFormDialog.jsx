import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Input, Select, Textarea, InputSwitch } from '@adminlte/react';
import { useBootstrapModal } from '../hooks/useBootstrapModal';
import { DEVICE_TYPES, getDefaultMonitorConfig } from '../config/deviceTypeDefaults';
import { listGroups } from '../api/groups';

const MODAL_ID = 'device-form-modal';

const EMPTY = {
  name: '',
  type: 'server',
  ipAddress: '',
  hostname: '',
  location: '',
  description: '',
  group: '',
  alertsEnabled: true,
  monitor: getDefaultMonitorConfig('server'),
};

export default function DeviceFormDialog({ open, onClose, onSubmit, initialValue }) {
  const [form, setForm] = useState(EMPTY);
  // Kept separate from `form.monitor` — these go to the dedicated encrypted-credential
  // endpoint, never as a plain field on the device document itself.
  const [connectorApiToken, setConnectorApiToken] = useState('');
  const [sshUsername, setSshUsername] = useState('');
  const [sshPassword, setSshPassword] = useState('');
  const isEdit = Boolean(initialValue);
  const hasExistingCredential = isEdit && Boolean(initialValue?.monitor?.credentialId);

  useBootstrapModal(MODAL_ID, open, onClose);

  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: listGroups, enabled: open });

  useEffect(() => {
    if (initialValue) {
      setForm({
        name: initialValue.name || '',
        type: initialValue.type || 'server',
        ipAddress: initialValue.ipAddress || '',
        hostname: initialValue.hostname || '',
        location: initialValue.location || '',
        description: initialValue.description || '',
        group: initialValue.group || '',
        alertsEnabled: initialValue.alertsEnabled !== false,
        monitor: { ...getDefaultMonitorConfig(initialValue.type), ...initialValue.monitor },
      });
    } else {
      setForm(EMPTY);
    }
    setConnectorApiToken('');
    setSshUsername('');
    setSshPassword('');
  }, [initialValue, open]);

  const handleTypeChange = (type) => {
    setForm((f) => ({ ...f, type, monitor: getDefaultMonitorConfig(type) }));
  };

  const handleMonitorChange = (field, value) => {
    setForm((f) => ({ ...f, monitor: { ...f.monitor, [field]: value } }));
  };

  const handleMethodChange = (method) => {
    // Reset the port to the method's own default rather than `|| existing` —
    // otherwise switching from e.g. TCP/554 (a camera's RTSP default) to SNMP
    // or ONVIF silently keeps the previous method's port instead of 161/80.
    const methodDefaultPort = { snmp: 161, onvif: 80, ssh: 22, connector: 443 }[method];
    setForm((f) => ({
      ...f,
      monitor: {
        ...f.monitor,
        method,
        ...(methodDefaultPort && { port: methodDefaultPort }),
        ...(method === 'snmp' && {
          snmpCommunity: f.monitor.snmpCommunity || 'public',
          snmpVersion: f.monitor.snmpVersion || '2c',
          snmpOid: f.monitor.snmpOid || '1.3.6.1.2.1.1.3.0',
        }),
        ...(method === 'onvif' && {
          onvifPath: f.monitor.onvifPath || '/onvif/device_service',
        }),
      },
    }));
  };

  const canSubmit = form.name.trim() && form.ipAddress.trim();

  const handleSubmit = () => {
    if (!canSubmit) return;
    const isFortinetConnector = form.monitor.method === 'connector' && form.monitor.vendor === 'fortinet';
    const isSsh = form.monitor.method === 'ssh';
    let extra;
    if (isFortinetConnector && connectorApiToken) {
      extra = { connectorApiToken };
    } else if (isSsh && sshUsername && sshPassword) {
      extra = { sshUsername, sshPassword };
    }
    onSubmit(form, extra);
  };

  const needsPort = ['tcp', 'http', 'snmp', 'onvif', 'ssh', 'connector'].includes(form.monitor.method);
  const isSnmp = form.monitor.method === 'snmp';
  const isOnvif = form.monitor.method === 'onvif';
  const isSsh = form.monitor.method === 'ssh';
  const isConnector = form.monitor.method === 'connector';

  return (
    <Modal
      id={MODAL_ID}
      title={isEdit ? 'Edit device' : 'Add device'}
      size="lg"
      scrollable
      footer={
        <>
          <Button theme="secondary" outline label="Cancel" data-bs-dismiss="modal" />
          <Button theme="primary" label={isEdit ? 'Save changes' : 'Add device'} disabled={!canSubmit} onClick={handleSubmit} />
        </>
      }
    >
      <Input name="deviceName" label="Name" required fgroupClass="mb-3" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />

      <Select name="deviceType" label="Type" fgroupClass="mb-3" value={form.type} onChange={(e) => handleTypeChange(e.target.value)}>
        {DEVICE_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>

      <div className="row">
        <div className="col-6">
          <Input
            name="ipAddress"
            label="IP address / hostname"
            required
            placeholder="10.0.1.5"
            value={form.ipAddress}
            onChange={(e) => setForm((f) => ({ ...f, ipAddress: e.target.value }))}
          />
        </div>
        <div className="col-6">
          <Input
            name="location"
            label="Location (optional)"
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
          />
        </div>
      </div>

      <Select
        name="group"
        label="Group (optional)"
        fgroupClass="mb-1"
        value={form.group}
        onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
      >
        <option value="">— none —</option>
        {(groupsQuery.data || []).map((g) => (
          <option key={g._id} value={g.name}>
            {g.name}
          </option>
        ))}
        {form.group && !groupsQuery.data?.some((g) => g.name === form.group) && <option value={form.group}>{form.group}</option>}
      </Select>
      <p className="text-secondary fs-7 mb-3">
        Restricts visibility for operators assigned to this group. Need a new one? Create it on the <a href="/groups">Groups</a> page
        first.
      </p>

      <Textarea
        name="description"
        label="Description (optional)"
        rows={2}
        value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
      />

      <InputSwitch
        name="alertsEnabled"
        label="Send down/recovery alerts for this device"
        checked={form.alertsEnabled}
        onChange={(checked) => setForm((f) => ({ ...f, alertsEnabled: checked }))}
      />

      <hr />
      <h6 className="text-secondary">Monitoring config</h6>

      <div className="row">
        <div className="col-6">
          <Select name="checkMethod" label="Check method" value={form.monitor.method} onChange={(e) => handleMethodChange(e.target.value)}>
            <option value="ping">Ping (ICMP)</option>
            <option value="tcp">TCP port</option>
            <option value="http">HTTP(S)</option>
            <option value="snmp">SNMP</option>
            <option value="onvif">ONVIF (cameras)</option>
            <option value="ssh">SSH (confirm login)</option>
            {(form.type === 'firewall' || form.type === 'switch') && <option value="connector">Auto detect vendor</option>}
          </Select>
        </div>
        {needsPort && (
          <div className="col-6">
            <Input
              name="port"
              label="Port"
              type="number"
              value={form.monitor.port || ''}
              onChange={(e) => handleMonitorChange('port', Number(e.target.value))}
              hint={isConnector ? 'The admin GUI/API HTTPS port — change this if it was moved off 443 (e.g. FortiGate on 11443).' : undefined}
            />
          </div>
        )}
      </div>

      {isConnector && form.type === 'firewall' && (
        <div className="row">
          <div className="col-6">
            <Select
              name="deviceVendor"
              label="Vendor"
              value={form.monitor.vendor || ''}
              onChange={(e) => handleMonitorChange('vendor', e.target.value)}
            >
              <option value="">Auto-detect (recommended)</option>
              <option value="fortinet">FortiGate</option>
            </Select>
          </div>
          <div className="col-6">
            {form.monitor.vendor === 'fortinet' ? (
              <Input
                name="connectorApiToken"
                label={hasExistingCredential ? 'API Token (leave blank to keep current)' : 'API Token (optional)'}
                type="password"
                value={connectorApiToken}
                onChange={(e) => setConnectorApiToken(e.target.value)}
                hint="From the FortiGate GUI, an API-enabled admin account's token."
              />
            ) : (
              <p className="text-secondary fs-7 mt-4 pt-2">
                <i className="bi bi-info-circle me-1"></i>
                Save first, then use the shield icon to Discover and see what was found before adding credentials.
              </p>
            )}
          </div>
        </div>
      )}

      {isConnector && form.type === 'switch' && (
        <p className="text-secondary fs-7 mb-3">
          <i className="bi bi-info-circle me-1"></i>
          No native switch vendor connector yet — this uses SNMP for interfaces/PoE health. Save first, then use the shield icon to
          Discover and add SNMP credentials if the switch requires them.
        </p>
      )}

      {isSnmp && (
        <div className="row">
          <div className="col-6">
            <Select
              name="snmpVersion"
              label="SNMP version"
              value={form.monitor.snmpVersion || '2c'}
              onChange={(e) => handleMonitorChange('snmpVersion', e.target.value)}
            >
              <option value="1">v1</option>
              <option value="2c">v2c</option>
            </Select>
          </div>
          <div className="col-6">
            <Input
              name="snmpCommunity"
              label="Community string"
              value={form.monitor.snmpCommunity || 'public'}
              onChange={(e) => handleMonitorChange('snmpCommunity', e.target.value)}
            />
          </div>
          <div className="col-12">
            <Input
              name="snmpOid"
              label="OID"
              value={form.monitor.snmpOid || '1.3.6.1.2.1.1.3.0'}
              onChange={(e) => handleMonitorChange('snmpOid', e.target.value)}
              hint="Defaults to sysUpTime.0 — reachability only, no MIB-specific knowledge needed."
            />
          </div>
        </div>
      )}

      {isOnvif && (
        <Input
          name="onvifPath"
          label="ONVIF device service path"
          value={form.monitor.onvifPath || '/onvif/device_service'}
          onChange={(e) => handleMonitorChange('onvifPath', e.target.value)}
          hint="Uses an unauthenticated GetSystemDateAndTime call — reachability only, no camera credentials needed."
        />
      )}

      {isSsh && (
        <div className="row">
          <div className="col-6">
            <Input
              name="sshUsername"
              label="Username"
              value={sshUsername}
              onChange={(e) => setSshUsername(e.target.value)}
            />
          </div>
          <div className="col-6">
            <Input
              name="sshPassword"
              label={hasExistingCredential ? 'Password (leave blank to keep current)' : 'Password'}
              type="password"
              value={sshPassword}
              onChange={(e) => setSshPassword(e.target.value)}
            />
          </div>
          <div className="col-12">
            <p className="text-secondary fs-7 mb-0 mt-1">
              <i className="bi bi-info-circle me-1"></i>
              Attempts a real SSH login with these credentials — a failed login (wrong
              password, account locked, etc.) counts as "down," not just an unreachable port.
              Stored encrypted; never echoed back.
            </p>
          </div>
        </div>
      )}

      {form.monitor.method === 'http' && (
        <Input
          name="httpPath"
          label="Health path"
          placeholder="/health"
          value={form.monitor.httpPath || '/'}
          onChange={(e) => handleMonitorChange('httpPath', e.target.value)}
        />
      )}

      <div className="row">
        <div className="col-6">
          <Input
            name="intervalSeconds"
            label="Check interval (seconds)"
            type="number"
            value={form.monitor.intervalSeconds}
            onChange={(e) => handleMonitorChange('intervalSeconds', Number(e.target.value))}
          />
        </div>
        <div className="col-6">
          <Input
            name="downAfterFailures"
            label="Mark down after (consecutive failures)"
            type="number"
            value={form.monitor.downAfterFailures}
            onChange={(e) => handleMonitorChange('downAfterFailures', Number(e.target.value))}
          />
        </div>
      </div>
    </Modal>
  );
}
