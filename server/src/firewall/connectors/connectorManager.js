const { collect: runConnectorPipeline } = require('../../monitoring/core/connectorManager');
const { createGenericSnmpConnector } = require('./genericSnmpConnector');
const { createFortiGateConnector } = require('./fortigate/fortiGateConnector');
const { emptyNormalizedHealth } = require('../core/healthStatus');

// FortiGate only this pass; other vendors plug in here later without touching
// anything in the shared connectorManager or React (the "pluggable connectors" goal).
const NATIVE_CONNECTORS = { fortinet: createFortiGateConnector };

/** Pulls every metric group off a connector and merges whatever it actually returned, tagging the source. */
async function mergeFromConnector(normalized, connector, sourceName) {
  const [info, health, interfaces, ha, sessions, alarms, license, environment] = await Promise.all([
    connector.getDeviceInfo(),
    connector.getSystemHealth(),
    connector.getInterfaces(),
    connector.getHAStatus(),
    connector.getSessions(),
    connector.getAlarms(),
    connector.getLicenseStatus(),
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
  if (ha) {
    Object.assign(normalized.ha, ha);
    normalized.capabilities.ha = true;
    normalized.sources.ha = sourceName;
  }
  if (sessions !== null && sessions !== undefined) {
    normalized.health.activeSessions = sessions;
    normalized.capabilities.sessions = true;
  }
  if (alarms?.length) {
    normalized.alarms = alarms;
    normalized.capabilities.alarms = true;
  }
  if (license) {
    Object.assign(normalized.license, license);
    normalized.capabilities.license = true;
    normalized.sources.license = sourceName;
  }
  if (environment) {
    Object.assign(normalized.environment, environment);
    normalized.sources.environment = sourceName;
  }
}

/** Thin firewall-specific wrapper over the shared fallback/merge pipeline (native API -> SNMP -> TCP/ICMP). */
function collect(args) {
  return runConnectorPipeline({
    ...args,
    emptyNormalized: emptyNormalizedHealth,
    nativeConnectors: NATIVE_CONNECTORS,
    createGenericSnmpConnector,
    mergeFromConnector,
  });
}

module.exports = { collect };
