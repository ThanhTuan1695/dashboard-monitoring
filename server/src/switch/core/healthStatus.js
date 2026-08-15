const { HealthStatus } = require('../../monitoring/core/healthStatus');
const { emptyBaseNormalized } = require('../../monitoring/core/normalizedBase');

const HEALTH_COMPONENT_KEYS = ['device', 'management', 'interfaces', 'uplinks', 'stack', 'environment', 'poe', 'layer2', 'resources'];

/**
 * Switch's normalized shape: the shared base plus stack/environment/PoE/
 * layer2/neighbors groups. Never fabricate a value — the generic SNMP
 * connector leaves most of these `null`/`[]` since standard MIB-II alone
 * can't see stack technology, PSU/fan sensors, or LACP/STP state (those
 * need vendor-specific MIBs, not implemented this pass).
 */
function emptyNormalizedHealth(deviceId, ip) {
  const normalized = emptyBaseNormalized(deviceId, ip);
  normalized.stack = { enabled: null, technology: null, status: null, members: null, expectedMembers: null, master: null };
  normalized.environment = { powerSupplies: null, fans: null, temperature: null };
  normalized.poe = { supported: null, budgetWatts: null, usedWatts: null, utilizationPercent: null };
  normalized.layer2 = { stp: null, lacp: null };
  normalized.neighbors = [];
  normalized.capabilities.stack = false;
  normalized.capabilities.poe = false;
  normalized.capabilities.lldp = false;
  return normalized;
}

module.exports = { HealthStatus, HEALTH_COMPONENT_KEYS, emptyNormalizedHealth };
