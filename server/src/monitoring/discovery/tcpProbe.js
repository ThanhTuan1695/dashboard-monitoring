const { tcpCheck } = require('../../services/checks');

// 443/8443 (HTTPS mgmt), 830 (NETCONF), 22 (SSH) — spec §11's suggested discovery ports.
const DEFAULT_PORTS = [443, 8443, 830, 22];

async function tcpProbe(host, ports = DEFAULT_PORTS, timeoutMs = 2000) {
  return Promise.all(
    ports.map(async (port) => {
      const result = await tcpCheck(host, port, timeoutMs);
      return { port, open: result.ok, latencyMs: result.latencyMs };
    })
  );
}

module.exports = { tcpProbe, DEFAULT_PORTS };
