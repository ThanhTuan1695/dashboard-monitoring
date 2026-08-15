const mongoose = require('mongoose');

// Holds only AES-256-GCM–encrypted secrets (see monitoring/services/credentialService.js)
// — the plaintext never touches the database, logs, or an API response.
// Device.monitor.credentialId references this by id only. Shared by every
// connector-monitored device type (firewall, switch, ...) — never duplicated
// per type, since the shape (device ref + type + encrypted payload) doesn't differ.
const EncryptedPayloadSchema = new mongoose.Schema(
  {
    iv: { type: String, required: true },
    ciphertext: { type: String, required: true },
    authTag: { type: String, required: true },
  },
  { _id: false }
);

const DeviceCredentialSchema = new mongoose.Schema(
  {
    device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true, index: true },
    type: { type: String, enum: ['api_token', 'username_password', 'snmp_v3', 'snmp_v2'], required: true },
    encrypted: { type: EncryptedPayloadSchema, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DeviceCredential', DeviceCredentialSchema);
