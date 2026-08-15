const { HealthStatus } = require('../../monitoring/core/healthStatus');
const { emptyBaseNormalized } = require('../../monitoring/core/normalizedBase');

const HEALTH_COMPONENT_KEYS = ['device', 'management', 'dataPlane', 'wan', 'ha', 'resources', 'securityServices', 'license'];

/** Firewall's normalized shape: the shared base plus HA/security-services/license groups. Never fabricate a value. */
function emptyNormalizedHealth(deviceId, ip) {
  const normalized = emptyBaseNormalized(deviceId, ip);
  normalized.ha = { enabled: null, role: null, peerStatus: null, synchronized: null };
  normalized.securityServices = { ips: null, antivirus: null, urlFilter: null, vpn: null };
  normalized.license = { status: null, expiresAt: null };
  normalized.capabilities.ha = false;
  normalized.capabilities.sessions = false;
  normalized.capabilities.license = false;
  normalized.capabilities.vpn = false;
  normalized.capabilities.securityServices = false;
  return normalized;
}

module.exports = { HealthStatus, HEALTH_COMPONENT_KEYS, emptyNormalizedHealth };
