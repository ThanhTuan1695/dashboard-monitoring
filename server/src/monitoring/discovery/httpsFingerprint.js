const tls = require('tls');
const https = require('https');
const axios = require('axios');

/** Raw TLS handshake, bypassing HTTP — works even if the HTTP layer 404s/redirects oddly, gives us the cert regardless. */
function getPeerCertificate(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      finish(cert && cert.subject ? cert : null);
    });
    socket.on('error', () => finish(null));
    socket.on('timeout', () => {
      socket.destroy();
      finish(null);
    });
  });
}

/**
 * Non-intrusive HTTPS fingerprinting (spec §11): TLS certificate CN/O, the
 * `Server` response header, and the login page's <title> — no auth attempts,
 * no crawling beyond the root path.
 */
async function httpsFingerprint(host, port = 443, timeoutMs = 3000) {
  const evidence = [];
  const cert = await getPeerCertificate(host, port, timeoutMs);
  const tlsSubject = cert?.subject?.CN || cert?.subject?.O || null;
  const tlsIssuer = cert?.issuer?.CN || cert?.issuer?.O || null;
  if (tlsSubject) evidence.push(`TLS certificate CN/O: ${tlsSubject}`);

  let reachable = Boolean(cert);
  let title = null;
  let server = null;
  try {
    const res = await axios.get(`https://${host}:${port}/`, {
      timeout: timeoutMs,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      validateStatus: () => true,
      maxRedirects: 2,
    });
    reachable = true;
    server = res.headers?.server || null;
    if (server) evidence.push(`HTTP Server header: ${server}`);

    const titleMatch = typeof res.data === 'string' ? res.data.match(/<title>([^<]*)<\/title>/i) : null;
    title = titleMatch ? titleMatch[1].trim() : null;
    if (title) evidence.push(`Page title: ${title}`);
  } catch {
    // The raw TLS handshake above may still have succeeded even if the HTTP layer failed —
    // `reachable` already reflects that; nothing else to report here.
  }

  return { reachable, title, server, tlsSubject, tlsIssuer, evidence };
}

module.exports = { httpsFingerprint };
