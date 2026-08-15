// Maps raw FortiOS REST API v2 monitor-endpoint JSON to normalized partial
// fields. Pure functions (no HTTP) so they're testable in isolation.
//
// Implemented per FortiOS's publicly documented monitor-API conventions but
// unverified against a live FortiGate (no hardware in this environment, same
// caveat as the SNMP/ONVIF checks). HA role/peer detection in particular
// varies by FortiOS version and firmware — verify against the target unit's
// actual API responses before relying on it in production.

function parseStatus(raw) {
  const r = raw?.results;
  if (!r) return null;
  return {
    hostname: r.hostname || null,
    version: r.version || null,
    serial: r.serial || null,
    model: r.model_name || null,
  };
}

function parseResourceUsage(raw) {
  const results = raw?.results;
  if (!results) return { cpuPercent: null, memoryPercent: null, diskPercent: null };

  const pick = (key) => {
    const entry = results[key];
    if (!entry) return null;
    if (typeof entry.current === 'number') return entry.current;
    const values = entry.historical?.values;
    return Array.isArray(values) && values.length ? values[values.length - 1] : null;
  };

  return { cpuPercent: pick('cpu'), memoryPercent: pick('mem'), diskPercent: pick('disk') };
}

function parseInterfaces(raw) {
  const results = raw?.results;
  if (!Array.isArray(results)) return [];
  return results.map((iface) => ({
    name: iface.name || iface.interface || 'unknown',
    adminStatus: iface.status === 'up' ? 'up' : iface.status === 'down' ? 'down' : 'unknown',
    operStatus: iface.link === 'up' || iface.link === true ? 'up' : iface.link === 'down' || iface.link === false ? 'down' : 'unknown',
  }));
}

function parseHa(raw) {
  const results = raw?.results;
  if (!results) return null;
  const rows = Array.isArray(results) ? results : [results];
  if (rows.length === 0) return null;
  return {
    // A checksums response with >1 member implies HA is configured; role/peer-status/sync
    // need a version-specific HA status endpoint — left null pending verification.
    enabled: rows.length > 1,
    role: null,
    peerStatus: null,
    synchronized: null,
  };
}

function parseLicense(raw) {
  const r = raw?.results;
  if (!r) return null;
  return { status: r.status || null, expiresAt: r.expires || null };
}

module.exports = { parseStatus, parseResourceUsage, parseInterfaces, parseHa, parseLicense };
