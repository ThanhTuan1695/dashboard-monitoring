/**
 * Default `monitor` config per device type, for the Phase 1 generic
 * ping/TCP/HTTP reachability check.
 *
 * Usage:
 *   - Frontend "Add Device" form: when the user picks a type, pre-fill the
 *     monitor fields from this map (still editable/overridable per device).
 *   - Backend: if a device is created without an explicit `monitor` block,
 *     fall back to these defaults based on `type`.
 */

const DEVICE_TYPES = ['firewall', 'switch', 'server', 'application', 'camera', 'other'];

const DEVICE_TYPE_DEFAULTS = {
  firewall: {
    method: 'tcp',
    port: 443,
    intervalSeconds: 60,
    timeoutMs: 3000,
    downAfterFailures: 2,
  },
  switch: {
    method: 'ping',
    intervalSeconds: 60,
    timeoutMs: 3000,
    downAfterFailures: 2,
  },
  server: {
    method: 'ping',
    intervalSeconds: 30,
    timeoutMs: 3000,
    downAfterFailures: 2,
  },
  application: {
    method: 'http',
    port: 443,
    httpPath: '/',
    intervalSeconds: 30,
    timeoutMs: 5000,
    downAfterFailures: 2,
  },
  camera: {
    method: 'tcp',
    port: 554,
    intervalSeconds: 60,
    timeoutMs: 3000,
    downAfterFailures: 3,
  },
  other: {
    method: 'ping',
    intervalSeconds: 60,
    timeoutMs: 3000,
    downAfterFailures: 2,
  },
};

/**
 * Returns a fresh copy of the default monitor config for a given device
 * type, falling back to `other` if the type is unrecognized.
 */
function getDefaultMonitorConfig(type) {
  const defaults = DEVICE_TYPE_DEFAULTS[type] || DEVICE_TYPE_DEFAULTS.other;
  return { ...defaults };
}

module.exports = { DEVICE_TYPES, DEVICE_TYPE_DEFAULTS, getDefaultMonitorConfig };
