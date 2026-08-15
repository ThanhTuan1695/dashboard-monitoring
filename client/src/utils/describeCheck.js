// Describes, in plain text, exactly what the scheduler actually runs for a
// device's current monitor config — purely derived from `device.monitor`
// (same fields the backend check functions read), no extra API call needed.
// Mirrors each check function's real behavior in server/src/services/checks.js
// (and the connector pipeline for 'connector') so this never drifts into a
// generic "it pings the device" placeholder.
export function describeCheck(device) {
  const host = device?.ipAddress || device?.hostname || '(no address)';
  const m = device?.monitor || {};

  switch (m.method) {
    case 'tcp':
      return `TCP connect to ${host}:${m.port ?? '?'}`;
    case 'http': {
      const scheme = m.port === 443 ? 'https' : 'http';
      const path = m.httpPath && m.httpPath.startsWith('/') ? m.httpPath : `/${m.httpPath || ''}`;
      return `GET ${scheme}://${host}:${m.port ?? '?'}${path}`;
    }
    case 'snmp':
      return `SNMP GET ${m.snmpOid || '1.3.6.1.2.1.1.3.0'} (v${m.snmpVersion || '2c'}, community "${m.snmpCommunity || 'public'}") — ${host}:${m.port || 161}`;
    case 'onvif': {
      const path = m.onvifPath || '/onvif/device_service';
      return `POST http://${host}:${m.port || 80}${path} — ONVIF GetSystemDateAndTime (unauthenticated)`;
    }
    case 'ssh':
      return `SSH login attempt to ${host}:${m.port || 22} (stored username/password credential)`;
    case 'connector':
      return `Auto-discovery connector pipeline for ${host} — native vendor API → SNMP → TCP/ICMP fallback (see the shield icon for which channel actually answered)`;
    case 'ping':
    default:
      return `ICMP ping to ${host}`;
  }
}
