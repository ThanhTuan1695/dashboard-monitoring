/**
 * Standalone test of the actual reachability-check logic (ping/tcp/http),
 * with no database involved. This is the part that answers "is the device
 * active or not" and is worth verifying directly against real sockets.
 */
const net = require('net');
const http = require('http');
const { pingCheck, tcpCheck, httpCheck, snmpCheck, onvifCheck } = require('./src/services/checks');

function assert(cond, msg) {
  if (!cond) {
    console.error('[test] ASSERTION FAILED:', msg);
    process.exitCode = 1;
  } else {
    console.log('[test] OK:', msg);
  }
}

async function main() {
  // --- ping ---
  const pingUp = await pingCheck('127.0.0.1', 2000);
  console.log('[test] ping 127.0.0.1 ->', pingUp);
  assert(pingUp.ok === true, 'ping against loopback should succeed');

  const pingDown = await pingCheck('192.0.2.123', 1000); // TEST-NET-1, RFC 5737, non-routable
  console.log('[test] ping 192.0.2.123 ->', pingDown);
  assert(pingDown.ok === false, 'ping against a non-routable test address should fail/time out');

  // --- tcp ---
  const tcpServer = net.createServer((s) => s.end());
  await new Promise((resolve) => tcpServer.listen(0, '127.0.0.1', resolve));
  const tcpPort = tcpServer.address().port;

  const tcpUp = await tcpCheck('127.0.0.1', tcpPort, 2000);
  console.log('[test] tcp open port ->', tcpUp);
  assert(tcpUp.ok === true, 'tcp check against an open local port should succeed');

  const tcpDown = await tcpCheck('127.0.0.1', tcpPort + 1, 1000); // very likely closed
  console.log('[test] tcp closed port ->', tcpDown);
  assert(tcpDown.ok === false, 'tcp check against a closed port should fail');

  tcpServer.close();

  // --- http ---
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200).end('ok');
    } else {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const httpPort = httpServer.address().port;

  const httpUp = await httpCheck('127.0.0.1', httpPort, '/health', 2000);
  console.log('[test] http /health ->', httpUp);
  assert(httpUp.ok === true, 'http check against a 200-returning path should succeed');

  const httpDown = await httpCheck('127.0.0.1', httpPort + 1, '/health', 1000); // nothing listening
  console.log('[test] http unreachable port ->', httpDown);
  assert(httpDown.ok === false, 'http check against an unreachable port should fail');

  httpServer.close();

  // --- snmp ---
  // No real SNMP agent available in this test env, so we only verify it never
  // throws and resolves ok:false against something that can't answer — either
  // because net-snmp isn't installed yet, or because nothing is listening.
  const snmpResult = await snmpCheck('127.0.0.1', { community: 'public', port: 1, oid: '1.3.6.1.2.1.1.3.0' }, 1000);
  console.log('[test] snmp against a closed port ->', snmpResult);
  assert(snmpResult.ok === false, 'snmp check against a non-responding port should fail gracefully, not throw');
  assert(typeof snmpResult.error === 'string' && snmpResult.error.length > 0, 'snmp failure should include an error message');

  // --- onvif ---
  // No real camera available, but onvif is plain HTTP/SOAP (no client library),
  // so both the failure path and a fake-SOAP-response success path are testable locally.
  const onvifServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/xml' }).end(
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><tds:GetSystemDateAndTimeResponse/></soap:Body></soap:Envelope>'
    );
  });
  await new Promise((resolve) => onvifServer.listen(0, '127.0.0.1', resolve));
  const onvifPort = onvifServer.address().port;

  const onvifUp = await onvifCheck('127.0.0.1', { port: onvifPort, path: '/onvif/device_service' }, 2000);
  console.log('[test] onvif against a fake SOAP responder ->', onvifUp);
  assert(onvifUp.ok === true, 'onvif check should succeed against a server returning a SOAP envelope');

  onvifServer.close();

  const onvifDown = await onvifCheck('127.0.0.1', { port: onvifPort + 1 }, 1000); // nothing listening
  console.log('[test] onvif unreachable port ->', onvifDown);
  assert(onvifDown.ok === false, 'onvif check against an unreachable port should fail gracefully, not throw');

  if (process.exitCode === 1) {
    console.error('\n[test] SOME CHECKS FAILED');
  } else {
    console.log('\n[test] ALL CHECK-LOGIC TESTS PASSED');
  }
}

main();
