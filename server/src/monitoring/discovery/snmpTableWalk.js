const { createSnmpSession } = require('./snmpSession');

/**
 * Shared SNMP table-walk helper — was previously duplicated identically in
 * both the firewall and switch generic SNMP connectors; hoisted here so a
 * third copy (for the plain 'snmp' check method's discovery pass) isn't
 * needed, and so a future fix only has to happen in one place.
 */
function walkTable(host, credentials, oid, columns, timeoutMs) {
  return new Promise((resolve) => {
    let snmp;
    try {
      snmp = require('net-snmp');
    } catch {
      resolve(null);
      return;
    }

    let session;
    try {
      session = createSnmpSession(snmp, host, credentials, { port: credentials.port || 161, timeout: timeoutMs, retries: 0 });
    } catch {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      session.close();
      resolve(value);
    };

    session.on('error', () => finish(null));
    session.tableColumns(oid, columns, 20, (err, table) => finish(err ? null : table));
  });
}

module.exports = { walkTable };
