const { tcpCheck } = require('../../services/checks');

/**
 * Discovery-only: is port 830 (NETCONF-over-SSH) open? There is no working
 * NETCONF client in this pass (Juniper/real NETCONF connectors are deferred —
 * see the plan) — this only feeds the `capabilities.netconf` flag so the UI
 * can show "NETCONF available" without the pipeline ever using it as a
 * connector priority tier yet.
 */
async function netconfProbe(host, timeoutMs = 2000) {
  const result = await tcpCheck(host, 830, timeoutMs);
  return { available: result.ok, latencyMs: result.latencyMs };
}

module.exports = { netconfProbe };
