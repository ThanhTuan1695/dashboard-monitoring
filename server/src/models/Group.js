const mongoose = require('mongoose');

// A lightweight registry for the group *names* that Device.group / User.groups
// already reference as plain strings — this model doesn't change how those
// fields work (still freeform strings, not a foreign key), it just gives
// admins a place to see/rename/delete them with cascading updates. See
// services/groupRegistry.js for how it stays in sync with usage.
const GroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Group', GroupSchema);
