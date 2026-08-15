const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    email: { type: String, trim: true, lowercase: true, default: '' },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'operator'], default: 'operator' },
    // Restricts an operator to devices in these groups (plus any ungrouped device).
    // Empty array = no restriction configured, sees every device — so existing
    // operators aren't locked out the moment groups are introduced.
    groups: { type: [String], default: [] },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);
