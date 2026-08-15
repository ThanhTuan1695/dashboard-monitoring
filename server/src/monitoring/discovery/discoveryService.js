const { icmpProbe } = require('./icmpProbe');
const { tcpProbe, DEFAULT_PORTS } = require('./tcpProbe');
const { httpsFingerprint } = require('./httpsFingerprint');
const { snmpProbe } = require('./snmpProbe');
const { netconfProbe } = require('./netconfProbe');
const { fingerprint } = require('./vendorFingerprint');

const UNREACHABLE_HTTPS = { reachable: false, title: null, server: null, tlsSubject: null, tlsIssuer: null, evidence: [] };

/**
 * Safe, non-intrusive discovery (spec §11): connectivity + fingerprinting
 * only, IP address alone is enough. `snmpCredentials` is optional and only
 * ever used for a read of standard system OIDs — never a brute-force
 * attempt, never a write, never vulnerability scanning.
 */
async function discover(host, { snmp: snmpCredentials } = {}) {
  const [icmp, tcpResults, snmpResult, netconf] = await Promise.all([
    icmpProbe(host),
    tcpProbe(host, DEFAULT_PORTS),
    snmpProbe(host, snmpCredentials || {}),
    netconfProbe(host),
  ]);

  const openPorts = new Set(tcpResults.filter((p) => p.open).map((p) => p.port));
  const https = openPorts.has(443) || openPorts.has(8443) ? await httpsFingerprint(host, openPorts.has(443) ? 443 : 8443) : UNREACHABLE_HTTPS;

  const vendorFingerprint = fingerprint({ snmp: snmpResult, https });

  return {
    reachability: {
      icmp: icmp.reachable,
      tcp: tcpResults,
      https: https.reachable,
      snmp: snmpResult.reachable,
      netconf: netconf.available,
    },
    fingerprint: vendorFingerprint,
    // Only reachability-based capabilities — a real native-API capability (or
    // device-type-specific ones like firewall HA/license or switch stack/PoE)
    // is confirmed once a vendor connector actually authenticates and retrieves
    // that data, not from discovery alone ("something's listening on a management port").
    capabilities: {
      api: https.reachable,
      netconf: netconf.available,
      snmp: snmpResult.reachable,
      systemHealth: snmpResult.reachable || https.reachable,
      interfaces: snmpResult.reachable,
      alarms: false,
    },
    hostname: snmpResult.sysName || null,
    discoveredAt: new Date(),
  };
}

module.exports = { discover };
