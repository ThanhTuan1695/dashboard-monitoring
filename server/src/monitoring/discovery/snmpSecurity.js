const SECURITY_LEVELS = { NO_AUTH_NO_PRIV: 'noAuthNoPriv', AUTH_NO_PRIV: 'authNoPriv', AUTH_PRIV: 'authPriv' };

/**
 * Pure mapping from our own snmp_v3 credential shape to net-snmp's
 * createV3Session() user object — kept free of the `net-snmp` module itself
 * (protocol/level names are plain strings here, resolved against
 * snmp.SecurityLevel/AuthProtocols/PrivProtocols only at session-creation time
 * in snmpSession.js) so this logic is testable without a live SNMPv3 agent.
 */
function resolveV3SecurityLevel({ authPassword, privPassword } = {}) {
  if (privPassword) return SECURITY_LEVELS.AUTH_PRIV;
  if (authPassword) return SECURITY_LEVELS.AUTH_NO_PRIV;
  return SECURITY_LEVELS.NO_AUTH_NO_PRIV;
}

function buildV3User({ username, authPassword, privPassword, authProtocol = 'sha', privProtocol = 'aes' } = {}) {
  const level = resolveV3SecurityLevel({ authPassword, privPassword });
  const user = { name: username, level };
  if (level !== SECURITY_LEVELS.NO_AUTH_NO_PRIV) {
    user.authProtocol = authProtocol;
    user.authKey = authPassword;
  }
  if (level === SECURITY_LEVELS.AUTH_PRIV) {
    user.privProtocol = privProtocol;
    user.privKey = privPassword;
  }
  return user;
}

module.exports = { SECURITY_LEVELS, resolveV3SecurityLevel, buildV3User };
