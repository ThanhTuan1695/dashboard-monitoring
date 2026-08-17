// ENTITY-MIB (RFC 4133) + ENTITY-SENSOR-MIB (RFC 3433) — IETF-standard,
// vendor-agnostic tables most network vendors implement (Cisco, Juniper,
// Arista, HP, Dell, ...), unlike a vendor-specific environmental MIB (e.g.
// Cisco's own CISCO-ENVMON-MIB). Walking these once gets chassis
// model/serial/firmware AND fan/PSU/temperature sensor status for whichever
// vendor actually implements them — "whatever the device exposes" instead of
// a hardcoded per-vendor OID list. Returns null groups when the device
// doesn't implement these tables at all (common on cheaper/embedded
// switches) rather than guessing.
// net-snmp's tableColumns() appends ".1.<column>" itself, so this must be the
// entPhysicalTable OID (one level above entPhysicalEntry) — not the entry OID.
const ENT_PHYSICAL_TABLE_OID = '1.3.6.1.2.1.47.1.1.1';
const ENT_PHYSICAL_COLUMNS = { class: 5, hardwareRev: 8, firmwareRev: 9, softwareRev: 10, serialNum: 11, modelName: 13 };

// Same rule as above — this is entPhySensorTable, not entPhySensorEntry.
const ENT_SENSOR_TABLE_OID = '1.3.6.1.2.1.99.1.1';
const ENT_SENSOR_COLUMNS = { type: 1, operStatus: 5 };

// entPhysicalClass values (ENTITY-MIB).
const PHYSICAL_CLASS = { CHASSIS: 3, POWER_SUPPLY: 6, FAN: 7, SENSOR: 8 };
// entPhySensorType values (ENTITY-SENSOR-MIB) — only the one we act on.
const SENSOR_TYPE_CELSIUS = 8;
// entPhySensorOperStatus values (ENTITY-SENSOR-MIB).
const SENSOR_OPER_STATUS = { OK: 1, UNAVAILABLE: 2, NONOPERATIONAL: 3 };

function trimmedOrNull(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

/** Maps a sensor's reported operational status to our health-engine string states. `unavailable` yields null (no data), not a guessed failure. */
function sensorState(operStatus) {
  if (operStatus === SENSOR_OPER_STATUS.OK) return 'healthy';
  if (operStatus === SENSOR_OPER_STATUS.NONOPERATIONAL) return 'critical';
  return null;
}

/** Worst-wins aggregation across however many fan/PSU/temperature sensors a device reports. */
function worstState(states) {
  const valid = states.filter((s) => s !== null);
  if (!valid.length) return null;
  if (valid.includes('critical')) return 'critical';
  if (valid.includes('degraded')) return 'degraded';
  return 'healthy';
}

/**
 * `tableColumnsFn(host, credentials, oid, columns, timeoutMs)` is the
 * caller's own SNMP table-walk helper (each generic connector has one, tied
 * to its own session-creation logic) — passed in so this module stays free
 * of any net-snmp/session-creation concerns.
 */
async function readEntityMib(tableColumnsFn, host, credentials, timeoutMs) {
  const physicalTable = await tableColumnsFn(host, credentials, ENT_PHYSICAL_TABLE_OID, Object.values(ENT_PHYSICAL_COLUMNS), timeoutMs);
  if (!physicalTable) return { chassis: null, environment: null };

  const sensorTable = await tableColumnsFn(host, credentials, ENT_SENSOR_TABLE_OID, Object.values(ENT_SENSOR_COLUMNS), timeoutMs);

  let chassis = null;
  const fanStates = [];
  const psuStates = [];
  const tempStates = [];

  for (const [index, row] of Object.entries(physicalTable)) {
    const physClass = Number(row[ENT_PHYSICAL_COLUMNS.class]);

    if (physClass === PHYSICAL_CLASS.CHASSIS && !chassis) {
      chassis = {
        model: trimmedOrNull(row[ENT_PHYSICAL_COLUMNS.modelName]),
        serial: trimmedOrNull(row[ENT_PHYSICAL_COLUMNS.serialNum]),
        version: trimmedOrNull(row[ENT_PHYSICAL_COLUMNS.softwareRev]) || trimmedOrNull(row[ENT_PHYSICAL_COLUMNS.firmwareRev]),
      };
    }

    // entPhySensorTable augments entPhysicalTable — same index (entPhysicalIndex) in both.
    const sensorRow = sensorTable?.[index];
    if (!sensorRow) continue;
    const state = sensorState(Number(sensorRow[ENT_SENSOR_COLUMNS.operStatus]));
    if (state === null) continue;

    if (physClass === PHYSICAL_CLASS.FAN) fanStates.push(state);
    else if (physClass === PHYSICAL_CLASS.POWER_SUPPLY) psuStates.push(state);
    else if (physClass === PHYSICAL_CLASS.SENSOR && Number(sensorRow[ENT_SENSOR_COLUMNS.type]) === SENSOR_TYPE_CELSIUS) tempStates.push(state);
  }

  const environment = { fans: worstState(fanStates), powerSupplies: worstState(psuStates), temperature: worstState(tempStates) };
  return { chassis, environment };
}

module.exports = { readEntityMib };
