const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

if (!process.env.DEVICE_CREDENTIAL_KEY) {
  console.warn(
    '[monitoring] DEVICE_CREDENTIAL_KEY is not set — using an insecure default. Set it in your .env before storing real credentials.'
  );
}

// Accepts any-length input (a passphrase, not necessarily 32 raw bytes) and
// derives a fixed 32-byte key — same "warn but still run" posture as JWT_SECRET.
function getKey() {
  const material = process.env.DEVICE_CREDENTIAL_KEY || 'dev-only-insecure-device-credential-key';
  return crypto.createHash('sha256').update(material).digest();
}

/** Encrypts a plain object (e.g. { apiToken: '...' }) — never store the plaintext anywhere. */
function encrypt(plaintextObj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(plaintextObj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

/** Decrypts back to the original object. Throws if the key is wrong or the ciphertext was tampered with (GCM auth tag check). */
function decrypt(encrypted) {
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(encrypted.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, 'base64')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

module.exports = { encrypt, decrypt };
