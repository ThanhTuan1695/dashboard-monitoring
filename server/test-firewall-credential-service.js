/**
 * Unit tests for the firewall credential encryption service (spec §38) —
 * round-trip correctness and tamper detection, no DB needed.
 */
const assert = require('assert');
const { encrypt, decrypt } = require('./src/monitoring/services/credentialService');

async function main() {
  const secret = { apiToken: 'super-secret-fortigate-token-12345' };
  const encrypted = encrypt(secret);

  assert.strictEqual(typeof encrypted.iv, 'string');
  assert.strictEqual(typeof encrypted.ciphertext, 'string');
  assert.strictEqual(typeof encrypted.authTag, 'string');
  assert(!encrypted.ciphertext.includes('super-secret'), 'ciphertext must not contain the plaintext');
  console.log('[test] OK: encrypt() produces an iv/ciphertext/authTag payload with no plaintext leakage');

  const decrypted = decrypt(encrypted);
  assert.deepStrictEqual(decrypted, secret);
  console.log('[test] OK: decrypt() round-trips back to the original object');

  // Tampering with the ciphertext must be detected (GCM auth tag mismatch), not silently accepted.
  {
    const tampered = { ...encrypted, ciphertext: Buffer.from('tampered-data-here').toString('base64') };
    assert.throws(() => decrypt(tampered), 'tampered ciphertext should fail to decrypt');
  }
  console.log('[test] OK: tampered ciphertext is rejected, not silently decrypted');

  // Different secrets encrypt to different ciphertexts (sanity check against a static/no-op cipher).
  {
    const encrypted2 = encrypt({ apiToken: 'a-completely-different-token' });
    assert.notStrictEqual(encrypted.ciphertext, encrypted2.ciphertext);
  }
  console.log('[test] OK: different secrets produce different ciphertexts');

  console.log('\n[test] ALL CREDENTIAL SERVICE TESTS PASSED');
}

main().catch((err) => {
  console.error('[test] FAILED', err);
  process.exitCode = 1;
});
