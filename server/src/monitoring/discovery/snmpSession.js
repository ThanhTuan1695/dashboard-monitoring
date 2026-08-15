const { buildV3User } = require('./snmpSecurity');

/**
 * Creates a v1/v2c/v3 net-snmp session from our own credential shape —
 * centralized so discovery's read-only probe and the generic SNMP connector
 * never diverge on how they interpret {community, version, username,
 * authPassword, privPassword, authProtocol, privProtocol}. `snmpModule` is
 * the already-`require()`'d `net-snmp` package, passed in so callers keep
 * control of the optional-dependency try/catch.
 */
function createSnmpSession(snmpModule, host, credentials = {}, options = {}) {
  const { community = 'public', version = '2c', username, authPassword, privPassword, authProtocol, privProtocol } = credentials;

  if (version === '3') {
    const user = buildV3User({ username, authPassword, privPassword, authProtocol, privProtocol });
    const v3User = {
      name: user.name,
      level: snmpModule.SecurityLevel[user.level],
      ...(user.authProtocol && { authProtocol: snmpModule.AuthProtocols[user.authProtocol], authKey: user.authKey }),
      ...(user.privProtocol && { privProtocol: snmpModule.PrivProtocols[user.privProtocol], privKey: user.privKey }),
    };
    return snmpModule.createV3Session(host, v3User, options);
  }

  return snmpModule.createSession(host, community, {
    ...options,
    version: version === '1' ? snmpModule.Version1 : snmpModule.Version2c,
  });
}

module.exports = { createSnmpSession };
