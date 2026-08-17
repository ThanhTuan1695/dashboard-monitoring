/**
 * Unit tests for the ENTITY-MIB/ENTITY-SENSOR-MIB parser — pure function, no
 * real device needed. Exercises chassis model/serial/firmware extraction and
 * fan/PSU/temperature sensor aggregation from fake table data shaped exactly
 * like what net-snmp's tableColumns() returns (an object keyed by index,
 * each value an object keyed by column number).
 */
const assert = require('assert');
const { readEntityMib } = require('./src/monitoring/discovery/entityMib');

// entPhysicalClass values used by the parser.
const CLASS = { CHASSIS: 3, POWER_SUPPLY: 6, FAN: 7, SENSOR: 8 };
// entPhySensorType values.
const SENSOR_TYPE = { CELSIUS: 8, OTHER: 1 };
// entPhySensorOperStatus values.
const OPER = { OK: 1, UNAVAILABLE: 2, NONOPERATIONAL: 3 };

function fakeTableColumns(responses) {
  let call = 0;
  return async (host, credentials, oid) => {
    const response = responses[call];
    call += 1;
    return response ? response[oid] ?? null : null;
  };
}

async function main() {
  // --- Device doesn't implement ENTITY-MIB at all ---
  {
    const tableColumnsFn = fakeTableColumns([{}]);
    const result = await readEntityMib(tableColumnsFn, '10.0.0.1', {}, 1000);
    assert.strictEqual(result.chassis, null);
    assert.strictEqual(result.environment, null);
  }
  console.log('[test] OK: device with no ENTITY-MIB support -> chassis/environment both null, never guessed');

  // --- Chassis model/serial/firmware extraction ---
  {
    const physicalTable = {
      1: { 5: CLASS.CHASSIS, 8: '1.0', 9: '2.1', 10: '3.4.5', 11: 'SN12345', 13: 'C1200-24T-4G' },
    };
    const tableColumnsFn = fakeTableColumns([
      { '1.3.6.1.2.1.47.1.1.1': physicalTable },
      { '1.3.6.1.2.1.99.1.1': {} }, // no sensors
    ]);
    const { chassis } = await readEntityMib(tableColumnsFn, '10.0.0.1', {}, 1000);
    assert.strictEqual(chassis.model, 'C1200-24T-4G');
    assert.strictEqual(chassis.serial, 'SN12345');
    assert.strictEqual(chassis.version, '3.4.5', 'prefers softwareRev over firmwareRev when both are present');
  }
  console.log('[test] OK: chassis model/serial/version extracted from the entPhysicalTable chassis entry');

  // --- Fan/PSU/temperature aggregation: all healthy ---
  {
    const physicalTable = {
      1: { 5: CLASS.CHASSIS, 13: 'Switch-X' },
      2: { 5: CLASS.FAN },
      3: { 5: CLASS.POWER_SUPPLY },
      4: { 5: CLASS.SENSOR },
    };
    const sensorTable = {
      2: { 1: SENSOR_TYPE.OTHER, 5: OPER.OK },
      3: { 1: SENSOR_TYPE.OTHER, 5: OPER.OK },
      4: { 1: SENSOR_TYPE.CELSIUS, 5: OPER.OK },
    };
    const tableColumnsFn = fakeTableColumns([
      { '1.3.6.1.2.1.47.1.1.1': physicalTable },
      { '1.3.6.1.2.1.99.1.1': sensorTable },
    ]);
    const { environment } = await readEntityMib(tableColumnsFn, '10.0.0.1', {}, 1000);
    assert.strictEqual(environment.fans, 'healthy');
    assert.strictEqual(environment.powerSupplies, 'healthy');
    assert.strictEqual(environment.temperature, 'healthy');
  }
  console.log('[test] OK: all sensors OK -> healthy for fans/PSU/temperature');

  // --- One fan nonoperational among two -> critical (worst-wins aggregation) ---
  {
    const physicalTable = {
      2: { 5: CLASS.FAN },
      3: { 5: CLASS.FAN },
    };
    const sensorTable = {
      2: { 1: SENSOR_TYPE.OTHER, 5: OPER.OK },
      3: { 1: SENSOR_TYPE.OTHER, 5: OPER.NONOPERATIONAL },
    };
    const tableColumnsFn = fakeTableColumns([
      { '1.3.6.1.2.1.47.1.1.1': physicalTable },
      { '1.3.6.1.2.1.99.1.1': sensorTable },
    ]);
    const { environment } = await readEntityMib(tableColumnsFn, '10.0.0.1', {}, 1000);
    assert.strictEqual(environment.fans, 'critical', 'one nonoperational fan among several -> the whole group reports critical');
  }
  console.log('[test] OK: one nonoperational fan among several -> critical (worst-wins aggregation)');

  // --- Sensor reports "unavailable" -> excluded, not treated as a failure ---
  {
    const physicalTable = {
      2: { 5: CLASS.FAN },
    };
    const sensorTable = {
      2: { 1: SENSOR_TYPE.OTHER, 5: OPER.UNAVAILABLE },
    };
    const tableColumnsFn = fakeTableColumns([
      { '1.3.6.1.2.1.47.1.1.1': physicalTable },
      { '1.3.6.1.2.1.99.1.1': sensorTable },
    ]);
    const { environment } = await readEntityMib(tableColumnsFn, '10.0.0.1', {}, 1000);
    assert.strictEqual(environment.fans, null, '"unavailable" is not present/no-data, not a guessed failure');
  }
  console.log('[test] OK: "unavailable" sensor status excluded from aggregation, never treated as a failure');

  // --- No physical entities are sensors at all -> null groups, not fabricated ---
  {
    const physicalTable = { 1: { 5: CLASS.CHASSIS, 13: 'Switch-X' } };
    const tableColumnsFn = fakeTableColumns([{ '1.3.6.1.2.1.47.1.1.1': physicalTable }, { '1.3.6.1.2.1.99.1.1': {} }]);
    const { environment } = await readEntityMib(tableColumnsFn, '10.0.0.1', {}, 1000);
    assert.strictEqual(environment.fans, null);
    assert.strictEqual(environment.powerSupplies, null);
    assert.strictEqual(environment.temperature, null);
  }
  console.log('[test] OK: chassis-only device (no fan/PSU/sensor entities) -> all environment groups null');

  console.log('\n[test] ALL ENTITY-MIB TESTS PASSED');
}

main().catch((err) => {
  console.error('[test] FAILED', err);
  process.exitCode = 1;
});
