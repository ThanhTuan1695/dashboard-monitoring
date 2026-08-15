const { snmpProbe } = require('../../monitoring/discovery/snmpProbe');
const { counter64ToNumber } = require('../../monitoring/discovery/snmpCounters');
const { readEntityMib } = require('../../monitoring/discovery/entityMib');
const { createRequestQueue } = require('../../monitoring/discovery/requestQueue');
const { walkTable: tableColumns } = require('../../monitoring/discovery/snmpTableWalk');

function ifStatusToString(status) {
  if (status === 1) return 'up';
  if (status === 2) return 'down';
  if (status === 3) return 'testing';
  return 'unknown';
}

/**
 * The always-available fallback: any vendor speaking standard MIB-II SNMP
 * gets hostname/uptime/interfaces from here, and any vendor additionally
 * implementing ENTITY-MIB/ENTITY-SENSOR-MIB (a broad set — Cisco, Juniper,
 * Arista, HP, Dell, ...) also gets real chassis model/serial/firmware and
 * fan/PSU/temperature status, auto-detected rather than hardcoded to one
 * vendor. CPU/memory/HA/sessions/alarms/license still need vendor-specific
 * MIBs this pass doesn't implement, so those fields stay `null`/`[]` rather
 * than guessed. Every SNMP call is routed through a per-connector queue —
 * see requestQueue.js — so concurrent connector-method calls (mergeFromConnector's
 * Promise.all) never turn into concurrent table walks against the same device.
 */
function createGenericSnmpConnector({ host, timeoutMs = 3000, ...credentials } = {}) {
  const enqueue = createRequestQueue();
  let sysPromise = null;
  let entityPromise = null;

  const getSys = () => {
    if (!sysPromise) sysPromise = enqueue(() => snmpProbe(host, credentials, timeoutMs));
    return sysPromise;
  };
  const getEntity = () => {
    if (!entityPromise) entityPromise = enqueue(() => readEntityMib(tableColumns, host, credentials, timeoutMs));
    return entityPromise;
  };

  return {
    name: 'generic-snmp',

    async getDeviceInfo() {
      const sys = await getSys();
      if (!sys.reachable) return null;
      const entity = await getEntity();
      return {
        hostname: sys.sysName,
        vendor: null,
        product: null,
        model: entity.chassis?.model ?? null,
        serial: entity.chassis?.serial ?? null,
        version: entity.chassis?.version ?? null,
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
      return enqueue(async () => {
        // ifTable (name/admin/oper status) and ifXTable (64-bit octet counters + high-speed,
        // needed for accurate throughput on >4Gbps links) are two separate SNMP tables sharing
        // the same ifIndex — walked separately, then merged by index.
        const ifTable = await tableColumns(host, credentials, '1.3.6.1.2.1.2.2', [2, 7, 8], timeoutMs);
        if (!ifTable) return [];
        const ifXTable = await tableColumns(host, credentials, '1.3.6.1.2.1.31.1.1', [6, 10, 15], timeoutMs);
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

    async getEnvironment() {
      const entity = await getEntity();
      return entity.environment;
    },
  };
}

module.exports = { createGenericSnmpConnector };
