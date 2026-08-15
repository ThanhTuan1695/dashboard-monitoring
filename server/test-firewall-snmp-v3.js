/**
 * Unit tests for the SNMPv3 credential -> net-snmp user mapping (see
 * discovery/snmpSecurity.js). Kept independent of net-snmp / a live agent —
 * these only check the pure {level, authProtocol, privProtocol} derivation
 * that createSnmpSession() then hands to snmp.createV3Session().
 */
const assert = require('assert');
const { SECURITY_LEVELS, resolveV3SecurityLevel, buildV3User } = require('./src/monitoring/discovery/snmpSecurity');

async function main() {
  // Username only -> no authentication, no encryption.
  {
    const level = resolveV3SecurityLevel({});
    assert.strictEqual(level, SECURITY_LEVELS.NO_AUTH_NO_PRIV);
    const user = buildV3User({ username: 'monitor' });
    assert.strictEqual(user.name, 'monitor');
    assert.strictEqual(user.level, 'noAuthNoPriv');
    assert.strictEqual(user.authProtocol, undefined, 'authProtocol must not be set without an auth password');
    assert.strictEqual(user.privProtocol, undefined);
  }
  console.log('[test] OK: username only -> noAuthNoPriv, no protocol fields set');

  // Auth password present, no priv password -> authNoPriv.
  {
    const level = resolveV3SecurityLevel({ authPassword: 'authpass1' });
    assert.strictEqual(level, SECURITY_LEVELS.AUTH_NO_PRIV);
    const user = buildV3User({ username: 'monitor', authPassword: 'authpass1' });
    assert.strictEqual(user.level, 'authNoPriv');
    assert.strictEqual(user.authProtocol, 'sha', 'defaults to SHA when not specified');
    assert.strictEqual(user.authKey, 'authpass1');
    assert.strictEqual(user.privProtocol, undefined, 'authNoPriv must not carry a priv protocol/key');
  }
  console.log('[test] OK: auth password without priv password -> authNoPriv, defaults to SHA');

  // Both present -> authPriv, with explicit protocol overrides honored.
  {
    const level = resolveV3SecurityLevel({ authPassword: 'authpass1', privPassword: 'privpass1' });
    assert.strictEqual(level, SECURITY_LEVELS.AUTH_PRIV);
    const user = buildV3User({
      username: 'monitor',
      authPassword: 'authpass1',
      privPassword: 'privpass1',
      authProtocol: 'md5',
      privProtocol: 'des',
    });
    assert.strictEqual(user.level, 'authPriv');
    assert.strictEqual(user.authProtocol, 'md5');
    assert.strictEqual(user.authKey, 'authpass1');
    assert.strictEqual(user.privProtocol, 'des');
    assert.strictEqual(user.privKey, 'privpass1');
  }
  console.log('[test] OK: auth + priv password -> authPriv, explicit protocol choices are honored');

  // Default protocols when both passwords are present but no protocol specified.
  {
    const user = buildV3User({ username: 'monitor', authPassword: 'authpass1', privPassword: 'privpass1' });
    assert.strictEqual(user.authProtocol, 'sha');
    assert.strictEqual(user.privProtocol, 'aes');
  }
  console.log('[test] OK: defaults to SHA/AES (the more secure options) when protocols are unspecified');

  console.log('\n[test] ALL SNMPv3 CREDENTIAL MAPPING TESTS PASSED');
}

main().catch((err) => {
  console.error('[test] FAILED', err);
  process.exitCode = 1;
});
