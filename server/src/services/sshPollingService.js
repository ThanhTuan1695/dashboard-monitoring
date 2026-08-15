const DeviceCredential = require('../models/DeviceCredential');
const { decrypt } = require('../monitoring/services/credentialService');
const { sshCheck } = require('./checks');

/**
 * The 'ssh' monitor method confirms a real SSH login succeeds, not just that
 * port 22 is open — so unlike ping/tcp/http/snmp/onvif (which read plain
 * `device.monitor` fields), it needs a decrypted credential first. Kept as
 * its own tiny polling service (mirroring firewall/switchPollingService's
 * loadCredential pattern) rather than folded into checks.runCheck(), since
 * that function has no DB access.
 */
async function loadCredential(device) {
  const id = device.monitor?.credentialId;
  if (!id) return null;
  const doc = await DeviceCredential.findById(id);
  if (!doc || doc.type !== 'username_password') return null;
  try {
    return decrypt(doc.encrypted);
  } catch (err) {
    console.error('[ssh] failed to decrypt credential for device', device._id.toString(), err.message);
    return null;
  }
}

async function poll(device) {
  const credential = await loadCredential(device);
  if (!credential) {
    return { ok: false, latencyMs: null, error: 'No SSH username/password credential is set for this device' };
  }
  const port = device.monitor?.port || 22;
  const timeoutMs = device.monitor?.timeoutMs || 3000;
  return sshCheck(device.ipAddress || device.hostname, { username: credential.username, password: credential.password, port }, timeoutMs);
}

module.exports = { poll };
