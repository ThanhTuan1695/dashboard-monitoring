// The fields every device type's normalized health shape has in common —
// device identity, reachability, generic resource metrics, interfaces,
// alarms, capabilities, fingerprint, and per-metric source tracking.
// Device-type-specific groups (firewall's ha/license/securityServices,
// switch's stack/poe/environment/layer2/neighbors) are added on top of this
// by each type's own `emptyNormalizedHealth()` — see firewall/core/healthStatus.js
// and switch/core/healthStatus.js. Callers fill in only what they actually
// collected; never fabricate a value.
function emptyBaseNormalized(deviceId, ip) {
  return {
    device: { id: deviceId, ip, hostname: null, vendor: null, product: null, model: null, serial: null, version: null },
    connectivity: {
      icmp: null,
      https: null,
      api: null,
      netconf: null,
      snmp: null,
      managementStatus: 'unknown',
      latencyMs: null,
      lastSeen: null,
    },
    health: { cpuPercent: null, memoryPercent: null, diskPercent: null, uptimeSeconds: null, temperature: null, activeSessions: null },
    interfaces: [],
    alarms: [],
    // Only the capability flags discovery can actually determine (reachability-based).
    // Device-type-specific capabilities (firewall's ha/license/vpn/securityServices,
    // switch's stack/poe/lldp) are added by each type's own emptyNormalizedHealth()
    // and flipped true only once a connector actually retrieves that data.
    capabilities: {
      api: false,
      netconf: false,
      snmp: false,
      systemHealth: false,
      interfaces: false,
      alarms: false,
    },
    fingerprint: { vendor: null, product: null, confidence: 0, evidence: [] },
    // Per-metric source tracking — which channel actually produced each top-level group.
    sources: {},
  };
}

module.exports = { emptyBaseNormalized };
