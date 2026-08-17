const { snmpProbe } = require('../monitoring/discovery/snmpProbe');
const { readEntityMib } = require('../monitoring/discovery/entityMib');
const { walkTable } = require('../monitoring/discovery/snmpTableWalk');
const thresholds = require('../monitoring/core/thresholds');

const IF_TABLE_OID = '1.3.6.1.2.1.2.2'; // IF-MIB ifTable

/**
 * The plain 'snmp' check method (available to every device type, not just
 * firewall/switch) only ever confirmed reachability via one fixed OID. This
 * runs a broader, read-only collection alongside that check — sysDescr/
 * sysObjectID (already reachability-tested by snmpProbe), chassis model/
 * serial/firmware and interface count via the same ENTITY-MIB walk the
 * generic connectors use — so a plain SNMP device surfaces real information
 * too, not just up/down. Calls run sequentially, never concurrently, for the
 * same reason genericSnmpConnector.js's table walks do (see requestQueue.js's
 * comment): concurrent table walks against one device can return corrupted data.
 */
async function discover(device) {
  const host = device.ipAddress || device.hostname;
  const credentials = { community: device.monitor?.snmpCommunity, version: device.monitor?.snmpVersion, port: device.monitor?.port || 161 };
  const timeoutMs = device.monitor?.timeoutMs || 3000;

  const sys = await snmpProbe(host, credentials, timeoutMs);
  if (!sys.reachable) return null;

  const entity = await readEntityMib(walkTable, host, credentials, timeoutMs);
  const ifTable = await walkTable(host, credentials, IF_TABLE_OID, [2], timeoutMs);

  return {
    sysDescr: sys.sysDescr,
    sysObjectID: sys.sysObjectID,
    model: entity.chassis?.model ?? null,
    serial: entity.chassis?.serial ?? null,
    version: entity.chassis?.version ?? null,
    interfaceCount: ifTable ? Object.keys(ifTable).length : null,
    discoveredAt: new Date(),
  };
}

/**
 * Discovery and polling are separate cadences (same principle as the
 * firewall/switch connector pipeline) — re-running this full walk on every
 * ~30-60s poll would be wasteful, since sysDescr/model/serial/interface count
 * essentially never change. Only refreshes when missing or stale.
 */
async function ensureDiscovery(device, { force = false } = {}) {
  const stale = !device.snmpInfo?.discoveredAt || Date.now() - new Date(device.snmpInfo.discoveredAt).getTime() > thresholds.DISCOVERY_STALE_MS;
  if (!force && !stale) return null; // nothing to refresh
  return discover(device);
}

module.exports = { discover, ensureDiscovery };
