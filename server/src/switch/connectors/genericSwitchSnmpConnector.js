const { snmpProbe } = require('../../monitoring/discovery/snmpProbe');
const { counter64ToNumber } = require('../../monitoring/discovery/snmpCounters');
const { readEntityMib } = require('../../monitoring/discovery/entityMib');
const { createRequestQueue } = require('../../monitoring/discovery/requestQueue');
const { walkTable: tableColumns } = require('../../monitoring/discovery/snmpTableWalk');
const { classifyPort } = require('../core/portClassification');

function ifStatusToString(status) {
  if (status === 1) return 'UP';
  if (status === 2) return 'DOWN';
  return 'UNKNOWN';
}

const IF_TABLE_OID = '1.3.6.1.2.1.2.2'; // IF-MIB ifTable
const IF_COLUMNS = { descr: 2, speed: 5, adminStatus: 7, operStatus: 8, inDiscards: 13, inErrors: 14, outDiscards: 19, outErrors: 20 };

// IF-MIB ifXTable — 64-bit octet counters (accurate for >~3.4Gbps links, unlike the 32-bit
// ifInOctets/ifOutOctets in ifTable, which wrap around too fast to be useful) and ifHighSpeed
// (Mbps directly, correct beyond ifSpeed's 4.3Gbps ceiling).
const IFX_TABLE_OID = '1.3.6.1.2.1.31.1.1';
const IFX_COLUMNS = { hcInOctets: 6, hcOutOctets: 10, highSpeed: 15 };

// RFC3621 POWER-ETHERNET-MIB — pethMainPseTable. Per-port power draw
// (pethPsePortPowerConsumption) is a vendor-optional extension in most real
// deployments, so this connector only reads the main-PSE-group totals
// (budget + consumption), which are the widely-implemented columns.
const PETH_MAIN_PSE_TABLE_OID = '1.3.6.1.2.1.105.1.3.1';
const PETH_MAIN_PSE_COLUMNS = { power: 2, consumptionPower: 4 };

/**
 * The always-available fallback (mirrors the firewall generic SNMP connector's
 * role): any switch speaking standard MIB-II/POWER-ETHERNET-MIB gets
 * hostname/uptime/interfaces/PoE-budget from here, and any switch additionally
 * implementing ENTITY-MIB/ENTITY-SENSOR-MIB (a broad set — Cisco, Juniper,
 * Arista, HP, Dell, ...) also gets real chassis model/serial/firmware and
 * fan/PSU/temperature status, auto-detected rather than hardcoded to one
 * vendor. Stack/LACP/STP/LLDP still need vendor-specific MIBs this pass
 * doesn't implement, so those fields stay `null`/`[]` rather than guessed.
 * Every SNMP call is routed through a per-connector queue — see
 * requestQueue.js — so concurrent connector-method calls (mergeFromConnector's
 * Promise.all) never turn into concurrent table walks against the same device.
 */
function createGenericSwitchSnmpConnector({ host, timeoutMs = 3000, ...credentials } = {}) {
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
    name: 'generic-switch-snmp',

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
        // ifTable and ifXTable share the same ifIndex but are two separate SNMP tables —
        // walked one after the other, not concurrently.
        const table = await tableColumns(host, credentials, IF_TABLE_OID, Object.values(IF_COLUMNS), timeoutMs);
        if (!table) return [];
        const xTable = await tableColumns(host, credentials, IFX_TABLE_OID, Object.values(IFX_COLUMNS), timeoutMs);
        return Object.keys(table).map((index) => {
          const row = table[index];
          const xRow = xTable?.[index];
          const name = row[IF_COLUMNS.descr] != null ? String(row[IF_COLUMNS.descr]) : `if${index}`;
          const highSpeed = xRow ? Number(xRow[IFX_COLUMNS.highSpeed]) : null;
          return {
            name,
            description: null,
            adminStatus: ifStatusToString(Number(row[IF_COLUMNS.adminStatus])),
            operStatus: ifStatusToString(Number(row[IF_COLUMNS.operStatus])),
            type: 'UNKNOWN',
            speedMbps: highSpeed > 0 ? highSpeed : row[IF_COLUMNS.speed] != null ? Math.round(Number(row[IF_COLUMNS.speed]) / 1_000_000) : null,
            duplex: null,
            vlan: null,
            nativeVlan: null,
            rxOctets: xRow ? counter64ToNumber(xRow[IFX_COLUMNS.hcInOctets]) : null,
            txOctets: xRow ? counter64ToNumber(xRow[IFX_COLUMNS.hcOutOctets]) : null,
            rxErrors: row[IF_COLUMNS.inErrors] != null ? Number(row[IF_COLUMNS.inErrors]) : null,
            txErrors: row[IF_COLUMNS.outErrors] != null ? Number(row[IF_COLUMNS.outErrors]) : null,
            rxDiscards: row[IF_COLUMNS.inDiscards] != null ? Number(row[IF_COLUMNS.inDiscards]) : null,
            txDiscards: row[IF_COLUMNS.outDiscards] != null ? Number(row[IF_COLUMNS.outDiscards]) : null,
            poe: { enabled: null, delivering: null, powerWatts: null },
            lacp: { enabled: null, bundle: null, state: null },
            criticality: classifyPort(name),
          };
        });
      });
    },

    async getStackStatus() {
      return null; // not derivable from standard MIB-II; needs a vendor-specific stack MIB
    },

    async getPoeStatus() {
      return enqueue(async () => {
        const table = await tableColumns(host, credentials, PETH_MAIN_PSE_TABLE_OID, Object.values(PETH_MAIN_PSE_COLUMNS), timeoutMs);
        if (!table) return null;
        const rows = Object.values(table);
        if (!rows.length) return null;

        // Sum across PSE groups when a switch reports more than one.
        let budgetWatts = 0;
        let usedWatts = 0;
        let sawAny = false;
        for (const row of rows) {
          const budget = row[PETH_MAIN_PSE_COLUMNS.power];
          const used = row[PETH_MAIN_PSE_COLUMNS.consumptionPower];
          if (budget != null) {
            budgetWatts += Number(budget);
            sawAny = true;
          }
          if (used != null) usedWatts += Number(used);
        }
        if (!sawAny) return null;

        return {
          supported: true,
          budgetWatts,
          usedWatts,
          utilizationPercent: budgetWatts > 0 ? Math.round((usedWatts / budgetWatts) * 100) : null,
        };
      });
    },

    async getLayer2Status() {
      return null; // STP/LACP state needs BRIDGE-MIB/IEEE8023-LAG-MIB walks, not implemented this pass
    },

    async getNeighbors() {
      return []; // LLDP-MIB topology discovery is staged later — capability recorded, no data source yet
    },

    async getAlarms() {
      return [];
    },

    async getEnvironment() {
      const entity = await getEntity();
      return entity.environment;
    },
  };
}

module.exports = { createGenericSwitchSnmpConnector };
