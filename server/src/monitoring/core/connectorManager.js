/**
 * The only place that decides which monitoring source to use and falls back
 * (native API -> SNMP -> bare TCP/ICMP reachability) — vendor connectors
 * never manage their own fallback, and this logic is never duplicated per
 * device type. Firewall and switch each supply their own native-connector
 * registry, generic SNMP connector, and `mergeFromConnector` (since the
 * fields each type collects differ — HA/license vs stack/PoE), while this
 * module owns the fallback decision and the connectivity/management-status
 * bookkeeping so it can never drift between device types.
 */
async function collect({
  deviceId,
  host,
  port,
  vendor,
  credentials,
  discoveryResult,
  emptyNormalized,
  nativeConnectors = {},
  createGenericSnmpConnector,
  mergeFromConnector,
}) {
  const normalized = emptyNormalized(deviceId, host);
  if (discoveryResult) {
    normalized.fingerprint = discoveryResult.fingerprint;
    normalized.capabilities = { ...normalized.capabilities, ...discoveryResult.capabilities };
    normalized.connectivity.icmp = discoveryResult.reachability?.icmp ?? null;
    normalized.connectivity.https = discoveryResult.reachability?.https ?? null;
    normalized.connectivity.netconf = discoveryResult.reachability?.netconf ?? null;
    if (discoveryResult.hostname) normalized.device.hostname = discoveryResult.hostname;
    if (discoveryResult.fingerprint?.vendor) {
      normalized.device.vendor = discoveryResult.fingerprint.vendor;
      normalized.device.product = discoveryResult.fingerprint.product;
    }
  }

  let usedApi = false;

  // 1. Native vendor API — only tried when this device type has a registered
  //    connector for the detected/chosen vendor and credentials are present.
  const createNative = nativeConnectors[vendor];
  if (createNative && credentials?.apiToken) {
    const connector = createNative({ host, port, apiToken: credentials.apiToken });
    const auth = await connector.authenticate();
    normalized.connectivity.api = auth.ok;
    if (auth.ok) {
      usedApi = true;
      normalized.connectivity.managementStatus = 'reachable';
      await mergeFromConnector(normalized, connector, 'native_api');
    } else {
      // API auth failure must not take the whole device offline — fall through to SNMP below.
      normalized.connectivity.managementStatus = 'auth_failed';
    }
  } else {
    normalized.connectivity.api = credentials?.apiToken ? false : null;
  }

  // 2. NETCONF — capability is recorded from discovery; no working connector for any device type this pass.

  // 3. SNMP fallback — always tried if the native API didn't already succeed and SNMP looks reachable.
  if (!usedApi && (discoveryResult?.reachability?.snmp || credentials?.snmp)) {
    const connector = createGenericSnmpConnector({ host, ...(credentials?.snmp || {}) });
    const info = await connector.getDeviceInfo();
    normalized.connectivity.snmp = Boolean(info);
    if (info) {
      if (normalized.connectivity.managementStatus !== 'auth_failed') normalized.connectivity.managementStatus = 'reachable';
      await mergeFromConnector(normalized, connector, 'snmp');
    }
  } else if (discoveryResult) {
    normalized.connectivity.snmp = discoveryResult.reachability?.snmp ?? null;
  }

  // 4/5. TCP + ICMP are pure reachability signals (already folded in above) — no health data to merge.

  // "Management reachable" means an actual management channel answered (HTTPS/API/SNMP) —
  // bare ICMP proves the box is powered on, not that anything can manage/monitor it.
  if (normalized.connectivity.managementStatus === 'unknown') {
    const managementReachable = normalized.connectivity.https || normalized.connectivity.snmp || normalized.connectivity.api;
    normalized.connectivity.managementStatus = managementReachable ? 'reachable' : 'unreachable';
  }
  const anyChannelUp =
    normalized.connectivity.icmp || normalized.connectivity.https || normalized.connectivity.snmp || normalized.connectivity.api;
  normalized.connectivity.lastSeen = anyChannelUp ? new Date().toISOString() : normalized.connectivity.lastSeen;

  return normalized;
}

module.exports = { collect };
