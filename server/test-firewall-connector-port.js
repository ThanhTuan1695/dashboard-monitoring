/**
 * Regression test for a real deployment gap: FortiGate admin GUIs are commonly
 * moved off the default HTTPS port (e.g. 11443), but createFortiGateConnector
 * used to hardcode port 443 with no way to override it. Verifies the
 * connector actually talks to the configured port, not silently to 443.
 */
const assert = require('assert');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createFortiGateConnector } = require('./src/firewall/connectors/fortigate/fortiGateConnector');

/** A local self-signed cert via the system `openssl` CLI — no extra npm dependency needed just for a test fixture. */
function makeSelfSignedCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fortigate-connector-test-'));
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyPath, '-out', certPath, '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1'],
    { stdio: ['ignore', 'ignore', 'ignore'] }
  );
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath), dir };
}

async function main() {
  const { key, cert, dir } = makeSelfSignedCert();

  const server = https.createServer({ key, cert }, (req, res) => {
    if (req.url.startsWith('/api/v2/monitor/system/status')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results: { hostname: 'test-fgt', serial: 'FGTTEST123', version: 'v7.4.1', uptime: 12345 } }));
    } else {
      res.writeHead(404).end();
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const connectorOnRightPort = createFortiGateConnector({ host: '127.0.0.1', port, apiToken: 'test-token', timeoutMs: 2000 });
  const authOk = await connectorOnRightPort.authenticate();
  console.log('[test] authenticate() against the configured custom port ->', authOk);
  assert.strictEqual(authOk.ok, true, 'connector should authenticate successfully when pointed at its actual configured port');

  const info = await connectorOnRightPort.getDeviceInfo();
  assert.strictEqual(info.hostname, 'test-fgt', 'getDeviceInfo should parse the response from the custom port');

  const connectorOnDefaultPort = createFortiGateConnector({ host: '127.0.0.1', apiToken: 'test-token', timeoutMs: 500 });
  const authWrong = await connectorOnDefaultPort.authenticate();
  console.log('[test] authenticate() with no port override (defaults to 443, nothing listening there) ->', authWrong);
  assert.strictEqual(authWrong.ok, false, 'without an explicit port, the connector must not somehow still reach the custom-port server');

  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\n[test] ALL FIREWALL CONNECTOR PORT TESTS PASSED');
}

main().catch((err) => {
  console.error('[test] FAILED', err);
  process.exitCode = 1;
});
