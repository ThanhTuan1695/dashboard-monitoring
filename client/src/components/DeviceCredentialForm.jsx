import { Button, Input, Select } from '@adminlte/react';

const CRED_TYPES = [
  { value: 'api_token', label: 'API Token' },
  { value: 'username_password', label: 'Username / Password' },
  { value: 'snmp_v2', label: 'SNMP v2c Community' },
  { value: 'snmp_v3', label: 'SNMP v3' },
];

// Shared by every connector-monitored device type — the credential *shapes*
// (api_token/username_password/snmp_v2/snmp_v3) are generic to the shared
// DeviceCredential storage, not specific to firewalls or switches.
export default function DeviceCredentialForm({ hasCredential, credType, setCredType, credFields, setCredFields, setCredMutation, deleteCredMutation }) {
  return (
    <>
      <h6 className="text-secondary">Credentials {hasCredential ? '(configured)' : '(none — optional)'}</h6>
      <div className="row g-2 align-items-end mb-2">
        <div className="col-md-3">
          <Select
            name="credType"
            label="Type"
            fgroupClass="mb-0"
            value={credType}
            onChange={(e) => {
              setCredType(e.target.value);
              setCredFields({});
            }}
          >
            {CRED_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        {credType === 'api_token' && (
          <div className="col-md-6">
            <Input
              name="apiToken"
              label="API Token"
              type="password"
              fgroupClass="mb-0"
              value={credFields.apiToken || ''}
              onChange={(e) => setCredFields({ apiToken: e.target.value })}
            />
          </div>
        )}
        {credType === 'username_password' && (
          <>
            <div className="col-md-3">
              <Input
                name="deviceUsername"
                label="Username"
                fgroupClass="mb-0"
                value={credFields.username || ''}
                onChange={(e) => setCredFields((f) => ({ ...f, username: e.target.value }))}
              />
            </div>
            <div className="col-md-3">
              <Input
                name="devicePassword"
                label="Password"
                type="password"
                fgroupClass="mb-0"
                value={credFields.password || ''}
                onChange={(e) => setCredFields((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
          </>
        )}
        {credType === 'snmp_v2' && (
          <div className="col-md-6">
            <Input
              name="snmpCommunity2"
              label="Community"
              fgroupClass="mb-0"
              value={credFields.community || ''}
              onChange={(e) => setCredFields({ community: e.target.value })}
            />
          </div>
        )}
        {credType === 'snmp_v3' && (
          <>
            <div className="col-md-3">
              <Input
                name="snmpV3Username"
                label="Username"
                fgroupClass="mb-0"
                value={credFields.username || ''}
                onChange={(e) => setCredFields((f) => ({ ...f, username: e.target.value }))}
              />
            </div>
            <div className="col-md-3">
              <Input
                name="snmpAuthPassword"
                label="Auth Password"
                type="password"
                fgroupClass="mb-0"
                hint="At least 8 characters"
                value={credFields.authPassword || ''}
                onChange={(e) => setCredFields((f) => ({ ...f, authPassword: e.target.value }))}
              />
            </div>
            <div className="col-md-3">
              <Select
                name="snmpAuthProtocol"
                label="Auth Protocol"
                fgroupClass="mb-0"
                value={credFields.authProtocol || 'sha'}
                onChange={(e) => setCredFields((f) => ({ ...f, authProtocol: e.target.value }))}
              >
                <option value="sha">SHA</option>
                <option value="md5">MD5</option>
              </Select>
            </div>
            <div className="col-md-3">
              <Input
                name="snmpPrivPassword"
                label="Privacy Password (optional)"
                type="password"
                fgroupClass="mb-0"
                hint="Leave blank for authNoPriv; else 8+ characters"
                value={credFields.privPassword || ''}
                onChange={(e) => setCredFields((f) => ({ ...f, privPassword: e.target.value }))}
              />
            </div>
            {credFields.privPassword && (
              <div className="col-md-3">
                <Select
                  name="snmpPrivProtocol"
                  label="Privacy Protocol"
                  fgroupClass="mb-0"
                  value={credFields.privProtocol || 'aes'}
                  onChange={(e) => setCredFields((f) => ({ ...f, privProtocol: e.target.value }))}
                >
                  <option value="aes">AES</option>
                  <option value="des">DES</option>
                </Select>
              </div>
            )}
          </>
        )}
        <div className="col-md-2">
          <Button theme="primary" size="sm" label="Save" disabled={setCredMutation.isPending} onClick={() => setCredMutation.mutate()} />
        </div>
      </div>
      {hasCredential && (
        <Button
          theme="danger"
          outline
          size="sm"
          label="Remove credential"
          disabled={deleteCredMutation.isPending}
          onClick={() => deleteCredMutation.mutate()}
        />
      )}
    </>
  );
}
