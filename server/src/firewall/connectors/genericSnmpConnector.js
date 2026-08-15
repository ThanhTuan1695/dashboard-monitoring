const { snmpProbe } = require('../../monitoring/discovery/snmpProbe');
const { createSnmpSession } = require('../../monitoring/discovery/snmpSession');
const { counter64ToNumber } = require('../../monitoring/discovery/snmpCounters');

function ifStatusToString(status) {
  if (status === 1) return 'up';
  if (status === 2) return 'down';
  if (status === 3) return 'testing';
  return 'unknown';
}

function tableColumns(host, credentials, oid, columns, timeoutMs) {
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
      session = createSnmpSession(snmp, host, credentials, { timeout: timeoutMs, retries: 0 });
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

/**
 * The always-available fallback (spec §5/§21): any vendor speaking standard
 * MIB-II SNMP gets hostname/uptime/interfaces from here. No CPU/memory/HA/
 * sessions/alarms/license — those require vendor-specific MIBs this pass
 * doesn't implement, so those fields stay `null`/`[]` rather than guessed.
 */
function createGenericSnmpConnector({ host, timeoutMs = 3000, ...credentials } = {}) {
  let cachedSys = null;
  const getSys = async () => {
    if (!cachedSys) cachedSys = await snmpProbe(host, credentials, timeoutMs);
    return cachedSys;
  };

  return {
    name: 'generic-snmp',

    async getDeviceInfo() {
      const sys = await getSys();
      if (!sys.reachable) return null;
      return {
        hostname: sys.sysName,
        vendor: null,
        product: null,
        model: null,
        serial: null,
        version: null,
        uptimeSeconds: sys.sysUpTime !== null ? Math.floor(sys.sysUpTime / 100) : null, // sysUpTime (TimeTicks) is centiseconds
      };
    },

    async getSystemHealth() {
      const info = await this.getDeviceInfo();
      return {
        cpuPercent: null,
        memoryPercent: null,
        diskPercent: null,
        uptimeSeconds: info ? info.uptimeSeconds : null,
        temperature: null,
        activeSessions: null,
      };
    },

    async getInterfaces() {
      // ifTable (name/admin/oper status) and ifXTable (64-bit octet counters + high-speed,
      // needed for accurate throughput on >4Gbps links) are two separate SNMP tables sharing
      // the same ifIndex — walked separately, then merged by index. Walked one after the
      // other, not concurrently: many embedded SNMP agents (firewalls/switches) handle two
      // simultaneous table walks against the same session poorly and return corrupted or
      // empty data for one of them, so this trades a bit of extra latency for correctness.
      const ifTable = await tableColumns(host, credentials, '1.3.6.1.2.1.2.2', [2, 7, 8], timeoutMs);
      if (!ifTable) return [];
      const ifXTable = await tableColumns(host, credentials, '1.3.6.1.2.1.31.1.1.1', [6, 10, 15], timeoutMs);
      return Object.keys(ifTable).map((index) => {
        const row = ifTable[index];
        const xRow = ifXTable?.[index];
        const highSpeed = xRow ? Number(xRow[15]) : null;
        return {
          name: row[2] != null ? String(row[2]) : `if${index}`,
          adminStatus: ifStatusToString(Number(row[7])),
          operStatus: ifStatusToString(Number(row[8])),
          speedMbps: highSpeed > 0 ? highSpeed : null,
          rxOctets: xRow ? counter64ToNumber(xRow[6]) : null,
          txOctets: xRow ? counter64ToNumber(xRow[10]) : null,
        };
      });
    },

    async getHAStatus() {
      return null; // not derivable from standard MIB-II
    },

    async getSessions() {
      return null;
    },

    async getAlarms() {
      return [];
    },

    async getLicenseStatus() {
      return null;
    },
  };
}

module.exports = { createGenericSnmpConnector };
