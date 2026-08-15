const net = require('net');
const ping = require('ping');
const axios = require('axios');

/**
 * Each check function resolves to { ok: boolean, latencyMs: number|null, error: string|null }
 * and never throws — callers can rely on the return shape alone.
 */

async function pingCheck(host, timeoutMs) {
  const timeoutSec = Math.max(1, Math.round(timeoutMs / 1000));
  const start = Date.now();
  try {
    const res = await ping.promise.probe(host, {
      timeout: timeoutSec,
      extra: process.platform === 'linux' ? ['-c', '1'] : undefined,
    });
    if (res.alive) {
      const latency = Number(res.time);
      return { ok: true, latencyMs: Number.isFinite(latency) ? latency : Date.now() - start, error: null };
    }
    return { ok: false, latencyMs: null, error: 'No reply (ICMP)' };
  } catch (err) {
    return { ok: false, latencyMs: null, error: err.message || 'Ping failed' };
  }
}

function tcpCheck(host, port, timeoutMs) {
  return new Promise((resolve) => {
    if (!port) {
      resolve({ ok: false, latencyMs: null, error: 'No port configured for tcp check' });
      return;
    }
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, latencyMs: Date.now() - start, error: null }));
    socket.once('timeout', () => finish({ ok: false, latencyMs: null, error: 'TCP connect timed out' }));
    socket.once('error', (err) => finish({ ok: false, latencyMs: null, error: err.message || 'TCP connect failed' }));

    socket.connect(port, host);
  });
}

async function httpCheck(host, port, httpPath, timeoutMs) {
  const scheme = port === 443 ? 'https' : 'http';
  const path = httpPath && httpPath.startsWith('/') ? httpPath : `/${httpPath || ''}`;
  const url = `${scheme}://${host}${port ? `:${port}` : ''}${path}`;
  const start = Date.now();
  try {
    const res = await axios.get(url, {
      timeout: timeoutMs,
      validateStatus: () => true, // any HTTP response means the app is up
      // Allow self-signed certs on internal https management UIs.
      httpsAgent: scheme === 'https' ? new (require('https').Agent)({ rejectUnauthorized: false }) : undefined,
    });
    const ok = res.status >= 200 && res.status < 500; // 5xx = app responded but unhealthy-ish; still "reachable"
    return { ok, latencyMs: Date.now() - start, error: ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, latencyMs: null, error: err.message || 'HTTP request failed' };
  }
}

const SYSTEM_UPTIME_OID = '1.3.6.1.2.1.1.3.0'; // sysUpTime.0 — cheap, near-universal, doesn't require MIB knowledge

/**
 * Reachability via SNMP GET (defaults to sysUpTime.0, which any SNMP-speaking
 * switch/firewall answers without needing device-specific OIDs). Requires the
 * `net-snmp` package — lazily required so the rest of the app still works if
 * it hasn't been installed yet (`npm install` in server/).
 */
function snmpCheck(host, { community = 'public', version = '2c', oid = SYSTEM_UPTIME_OID, port = 161 } = {}, timeoutMs) {
  return new Promise((resolve) => {
    let snmp;
    try {
      snmp = require('net-snmp');
    } catch (err) {
      resolve({ ok: false, latencyMs: null, error: 'net-snmp package not installed — run `npm install` in server/' });
      return;
    }

    const start = Date.now();
    let session;
    try {
      session = snmp.createSession(host, community, {
        port,
        version: version === '1' ? snmp.Version1 : snmp.Version2c,
        timeout: timeoutMs,
        retries: 0,
      });
    } catch (err) {
      resolve({ ok: false, latencyMs: null, error: err.message || 'Failed to create SNMP session' });
      return;
    }

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      session.close();
      resolve(result);
    };

    session.on('error', (err) => finish({ ok: false, latencyMs: null, error: err.message || 'SNMP session error' }));

    session.get([oid || SYSTEM_UPTIME_OID], (err, varbinds) => {
      if (err) {
        finish({ ok: false, latencyMs: null, error: err.message || 'SNMP request failed' });
        return;
      }
      const varbind = varbinds[0];
      if (snmp.isVarbindError(varbind)) {
        finish({ ok: false, latencyMs: null, error: snmp.varbindError(varbind) });
        return;
      }
      finish({ ok: true, latencyMs: Date.now() - start, error: null });
    });
  });
}

const ONVIF_DEVICE_SERVICE_PATH = '/onvif/device_service';

/**
 * Reachability via an unauthenticated ONVIF SOAP call (GetSystemDateAndTime —
 * per the ONVIF spec this is available before authentication, since it's used
 * to sync clocks ahead of WS-Security digest auth, which makes it a good
 * reachability probe with no camera credentials needed). Plain HTTP/SOAP over
 * axios, no ONVIF client library required. A SOAP Fault still proves the
 * device's ONVIF service is alive, so that counts as reachable too.
 */
async function onvifCheck(host, { port = 80, path = ONVIF_DEVICE_SERVICE_PATH } = {}, timeoutMs) {
  const url = `http://${host}:${port}${path || ONVIF_DEVICE_SERVICE_PATH}`;
  const envelope =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">' +
    '<soap:Body><tds:GetSystemDateAndTime/></soap:Body>' +
    '</soap:Envelope>';
  const start = Date.now();
  try {
    const res = await axios.post(url, envelope, {
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: 'http://www.onvif.org/ver10/device/wsdl/GetSystemDateAndTime',
      },
      validateStatus: () => true,
    });
    // A SOAP Fault often comes back as HTTP 500 — still means the service answered.
    const looksLikeSoap = typeof res.data === 'string' && /envelope/i.test(res.data);
    const ok = res.status === 200 || looksLikeSoap;
    return { ok, latencyMs: ok ? Date.now() - start : null, error: ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, latencyMs: null, error: err.message || 'ONVIF request failed' };
  }
}

/**
 * Confirms SSH login actually succeeds — not just that port 22 is open, but
 * that the given username/password authenticate. Requires the `ssh2` package
 * (lazily required so the rest of the app still works if it hasn't been
 * installed yet). Host key is never verified (`hostVerifier` accepts
 * anything) — this is a reachability/credential check, not a MITM-hardened
 * connection, matching the same trust posture as httpCheck's self-signed-cert
 * allowance for internal management UIs.
 */
function sshCheck(host, { username, password, port = 22 } = {}, timeoutMs) {
  return new Promise((resolve) => {
    if (!username || !password) {
      resolve({ ok: false, latencyMs: null, error: 'SSH check requires a username and password' });
      return;
    }

    let Client;
    try {
      ({ Client } = require('ssh2'));
    } catch {
      resolve({ ok: false, latencyMs: null, error: 'ssh2 package not installed — run `npm install` in server/' });
      return;
    }

    const start = Date.now();
    const conn = new Client();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      conn.end();
      resolve(result);
    };

    conn.on('ready', () => finish({ ok: true, latencyMs: Date.now() - start, error: null }));
    conn.on('error', (err) => finish({ ok: false, latencyMs: null, error: err.message || 'SSH connection failed' }));

    try {
      conn.connect({
        host,
        port,
        username,
        password,
        readyTimeout: timeoutMs,
        hostVerifier: () => true,
      });
    } catch (err) {
      finish({ ok: false, latencyMs: null, error: err.message || 'Failed to start SSH connection' });
    }
  });
}

/**
 * Runs the configured check for a device's monitor config.
 * `device` must have ipAddress/hostname and a monitor sub-object.
 */
async function runCheck(device) {
  const host = device.ipAddress || device.hostname;
  const { method, port, httpPath, timeoutMs, snmpCommunity, snmpVersion, snmpOid, onvifPath } = device.monitor || {};
  const timeout = timeoutMs || 3000;

  switch (method) {
    case 'tcp':
      return tcpCheck(host, port, timeout);
    case 'http':
      return httpCheck(host, port, httpPath, timeout);
    case 'snmp':
      return snmpCheck(host, { community: snmpCommunity, version: snmpVersion, oid: snmpOid, port: port || 161 }, timeout);
    case 'onvif':
      return onvifCheck(host, { port: port || 80, path: onvifPath }, timeout);
    case 'ping':
    default:
      return pingCheck(host, timeout);
  }
}

module.exports = { pingCheck, tcpCheck, httpCheck, snmpCheck, onvifCheck, sshCheck, runCheck, SYSTEM_UPTIME_OID, ONVIF_DEVICE_SERVICE_PATH };
