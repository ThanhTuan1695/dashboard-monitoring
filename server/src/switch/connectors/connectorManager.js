const { collect: runConnectorPipeline } = require('../../monitoring/core/connectorManager');
const { createGenericSwitchSnmpConnector } = require('./genericSwitchSnmpConnector');
const { emptyNormalizedHealth } = require('../core/healthStatus');

// No native switch vendor connector implemented yet (generic SNMP only this
// pass) — this stays empty until e.g. a Cisco Catalyst connector is added,
// at which point it plugs in here exactly like FortiGate does for firewalls,
// without touching the shared connectorManager or React.
const NATIVE_CONNECTORS = {};

/** Pulls every metric group off a connector and merges whatever it actually returned, tagging the source. */
async function mergeFromConnector(normalized, connector, sourceName) {
  const [info, health, interfaces, stack, poe, layer2, neighbors, alarms, environment] = await Promise.all([
    connector.getDeviceInfo(),
    connector.getSystemHealth(),
    connector.getInterfaces(),
    connector.getStackStatus(),
    connector.getPoeStatus(),
    connector.getLayer2Status(),
    connector.getNeighbors(),
    connector.getAlarms(),
    connector.getEnvironment(),
  ]);

  if (info) {
    normalized.device.hostname = info.hostname ?? normalized.device.hostname;
    normalized.device.model = info.model ?? normalized.device.model;
    normalized.device.serial = info.serial ?? normalized.device.serial;
    normalized.device.version = info.version ?? normalized.device.version;
    normalized.sources.device = sourceName;
  }
  if (health) {
    Object.assign(normalized.health, health);
    normalized.sources.health = sourceName;
  }
  if (interfaces?.length) {
    normalized.interfaces = interfaces;
    normalized.capabilities.interfaces = true;
    normalized.sources.interfaces = sourceName;
  }
  if (stack) {
    Object.assign(normalized.stack, stack);
    normalized.capabilities.stack = true;
    normalized.sources.stack = sourceName;
  }
  if (poe) {
    Object.assign(normalized.poe, poe);
    normalized.capabilities.poe = true;
    normalized.sources.poe = sourceName;
  }
  if (layer2) {
    Object.assign(normalized.layer2, layer2);
    normalized.sources.layer2 = sourceName;
  }
  if (neighbors?.length) {
    normalized.neighbors = neighbors;
    normalized.capabilities.lldp = true;
    normalized.sources.neighbors = sourceName;
  }
  if (alarms?.length) {
    normalized.alarms = alarms;
    normalized.capabilities.alarms = true;
  }
  if (environment) {
    Object.assign(normalized.environment, environment);
    normalized.sources.environment = sourceName;
  }
}

/** Thin switch-specific wrapper over the shared fallback/merge pipeline (native API -> SNMP -> TCP/ICMP). */
function collect(args) {
  return runConnectorPipeline({
    ...args,
    emptyNormalized: emptyNormalizedHealth,
    nativeConnectors: NATIVE_CONNECTORS,
    createGenericSnmpConnector: createGenericSwitchSnmpConnector,
    mergeFromConnector,
  });
}

module.exports = { collect };
