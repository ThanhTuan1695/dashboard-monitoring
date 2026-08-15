// Mirrors server/src/config/deviceTypeDefaults.js — used to pre-fill the
// Add/Edit Device form when the user picks a type. The server re-applies
// its own defaults on create, so this is purely for a nicer UX (the form
// shows sensible values immediately instead of blank fields).

// `icon` is a bootstrap-icons class, shared by the sidebar nav and the device-form type dropdown.
// `navLabel` is the plural form used in the sidebar and per-type page heading.
export const DEVICE_TYPES = [
  { value: 'firewall', label: 'Firewall', navLabel: 'Firewalls', icon: 'bi-shield-lock' },
  { value: 'switch', label: 'Switch', navLabel: 'Switches', icon: 'bi-diagram-3' },
  { value: 'server', label: 'Server', navLabel: 'Servers', icon: 'bi-hdd-rack' },
  { value: 'application', label: 'Application', navLabel: 'Applications', icon: 'bi-window-stack' },
  { value: 'camera', label: 'Camera', navLabel: 'Cameras', icon: 'bi-camera-video' },
  { value: 'other', label: 'Other', navLabel: 'Other', icon: 'bi-question-circle' },
];

export const DEVICE_TYPE_DEFAULTS = {
  firewall: { method: 'tcp', port: 443, intervalSeconds: 60, timeoutMs: 3000, downAfterFailures: 2 },
  switch: { method: 'ping', intervalSeconds: 60, timeoutMs: 3000, downAfterFailures: 2 },
  server: { method: 'ping', intervalSeconds: 30, timeoutMs: 3000, downAfterFailures: 2 },
  application: { method: 'http', port: 443, httpPath: '/', intervalSeconds: 30, timeoutMs: 5000, downAfterFailures: 2 },
  camera: { method: 'tcp', port: 554, intervalSeconds: 60, timeoutMs: 3000, downAfterFailures: 3 },
  other: { method: 'ping', intervalSeconds: 60, timeoutMs: 3000, downAfterFailures: 2 },
};

export function getDefaultMonitorConfig(type) {
  return { ...(DEVICE_TYPE_DEFAULTS[type] || DEVICE_TYPE_DEFAULTS.other) };
}
