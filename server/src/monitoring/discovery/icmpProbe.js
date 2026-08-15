const { pingCheck } = require('../../services/checks');

/** Thin wrapper over the existing ping check — kept separate so discoveryService reads like the spec's probe list. */
async function icmpProbe(host, timeoutMs = 2000) {
  const result = await pingCheck(host, timeoutMs);
  return { reachable: result.ok, latencyMs: result.latencyMs, error: result.error };
}

module.exports = { icmpProbe };
