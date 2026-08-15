const { createSnmpSession } = require('./snmpSession');

// Discovery-only SNMP read of the standard system OIDs — not the monitoring
// connector itself (that's connectors/genericSnmpConnector.js). Read-only,
// never a write, per spec §11's "no intrusive probing" rule.
const OIDS = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysObjectID: '1.3.6.1.2.1.1.2.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  sysName: '1.3.6.1.2.1.1.5.0',
};

const EMPTY_RESULT = { reachable: false, sysDescr: null, sysObjectID: null, sysName: null, sysUpTime: null, error: null };

function snmpProbe(host, credentials = {}, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let snmp;
    try {
      snmp = require('net-snmp');
    } catch {
      resolve({ ...EMPTY_RESULT, error: 'net-snmp package not installed — run `npm install` in server/' });
      return;
    }

    let session;
    try {
      session = createSnmpSession(snmp, host, credentials, { port: credentials.port || 161, timeout: timeoutMs, retries: 0 });
    } catch (err) {
      resolve({ ...EMPTY_RESULT, error: err.message || 'Failed to create SNMP session' });
      return;
    }

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      session.close();
      resolve(result);
    };

    session.on('error', (err) => finish({ ...EMPTY_RESULT, error: err.message || 'SNMP session error' }));

    const keys = Object.keys(OIDS);
    session.get(Object.values(OIDS), (err, varbinds) => {
      if (err) {
        finish({ ...EMPTY_RESULT, error: err.message || 'SNMP request failed' });
        return;
      }
      const values = {};
      varbinds.forEach((vb, i) => {
        values[keys[i]] = snmp.isVarbindError(vb) ? null : String(vb.value);
      });
      finish({
        reachable: true,
        sysDescr: values.sysDescr || null,
        sysObjectID: values.sysObjectID || null,
        sysName: values.sysName || null,
        sysUpTime: values.sysUpTime ? Number(values.sysUpTime) : null,
        error: null,
      });
    });
  });
}

module.exports = { snmpProbe };
