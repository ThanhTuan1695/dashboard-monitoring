const axios = require('axios');
const https = require('https');
const parser = require('./fortiGateParser');

function makeClient(host, port, apiToken, timeoutMs) {
  return axios.create({
    baseURL: `https://${host}:${port}`,
    timeout: timeoutMs,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }), // internal management UIs commonly use a self-signed cert
    headers: { Authorization: `Bearer ${apiToken}` },
    validateStatus: () => true,
  });
}

async function safeGet(http, path) {
  try {
    const res = await http.get(path);
    return res.status === 200 ? res.data : null;
  } catch {
    return null;
  }
}

/**
 * FortiOS REST API v2 connector (spec §23) — every call degrades to `null`
 * on any failure or unexpected shape, so a wrong endpoint path for a given
 * FortiOS version fails safely (ConnectorManager falls back to SNMP) rather
 * than crashing the poll. Vendor-specific facts only — never computes
 * overall health itself (spec §16/§23).
 */
function createFortiGateConnector({ host, port = 443, apiToken, timeoutMs = 5000 } = {}) {
  const http = makeClient(host, port, apiToken, timeoutMs);

  return {
    name: 'fortigate-api',

    async authenticate() {
      const raw = await safeGet(http, '/api/v2/monitor/system/status');
      return { ok: Boolean(raw), error: raw ? null : 'Authentication failed or system/status unavailable' };
    },

    async getDeviceInfo() {
      return parser.parseStatus(await safeGet(http, '/api/v2/monitor/system/status'));
    },

    async getSystemHealth() {
      const [status, usage] = await Promise.all([
        safeGet(http, '/api/v2/monitor/system/status'),
        safeGet(http, '/api/v2/monitor/system/resource/usage?resource=cpu,mem,disk&interval=1-min'),
      ]);
      const { cpuPercent, memoryPercent, diskPercent } = parser.parseResourceUsage(usage);
      return {
        cpuPercent,
        memoryPercent,
        diskPercent,
        uptimeSeconds: typeof status?.results?.uptime === 'number' ? status.results.uptime : null,
        temperature: null,
        activeSessions: null, // deferred — needs verification of the right session-count endpoint for the target FortiOS version
      };
    },

    async getInterfaces() {
      return parser.parseInterfaces(await safeGet(http, '/api/v2/monitor/system/interface'));
    },

    async getHAStatus() {
      return parser.parseHa(await safeGet(http, '/api/v2/monitor/system/ha-checksums'));
    },

    async getSessions() {
      return null;
    },

    async getAlarms() {
      return [];
    },

    async getLicenseStatus() {
      return parser.parseLicense(await safeGet(http, '/api/v2/monitor/license/status'));
    },
  };
}

module.exports = { createFortiGateConnector };
