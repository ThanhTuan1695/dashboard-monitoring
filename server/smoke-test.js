/**
 * Smoke test: spins up an in-memory MongoDB, starts the app, and exercises
 * the CRUD + monitoring flow end to end. Not a replacement for a real test
 * suite, but enough to verify the pieces wire together correctly.
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const net = require('net');
const http = require('http');
const User = require('./src/models/User');
const { hashPassword } = require('./src/services/auth');

async function main() {
  // A fake webhook receiver, up before requiring ./src/app — alerts.js reads
  // ALERT_WEBHOOK_URL at module load time, same pattern as JWT_SECRET.
  const receivedWebhooks = [];
  const webhookServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      receivedWebhooks.push(JSON.parse(body));
      res.writeHead(200).end('ok');
    });
  });
  await new Promise((resolve) => webhookServer.listen(0, '127.0.0.1', resolve));
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${webhookServer.address().port}/webhook`;

  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  console.log('[smoke] connected to in-memory MongoDB');

  const createApp = require('./src/app');
  const { app, scheduler } = createApp();
  await scheduler.start();

  // 0. Seed an admin and log in — every /api/devices and /api/users route requires a token now.
  await User.create({ username: 'admin', passwordHash: await hashPassword('smoke-test-password'), role: 'admin' });
  const loginRes = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'smoke-test-password' });
  assert(loginRes.status === 200, `login failed: ${JSON.stringify(loginRes.body)}`);
  const authHeader = `Bearer ${loginRes.body.token}`;
  console.log('[smoke] logged in as admin');

  // Unauthenticated requests must be rejected.
  const unauthed = await request(app).get('/api/devices');
  assert(unauthed.status === 401, 'devices route should reject requests with no token');
  console.log('[smoke] confirmed /api/devices rejects unauthenticated requests');

  // 1. Create a device that should be reachable (loopback, generic ping).
  const createRes = await request(app).post('/api/devices').set('Authorization', authHeader).send({
    name: 'Loopback Test Server',
    type: 'server',
    ipAddress: '127.0.0.1',
  });
  assert(createRes.status === 201, `expected 201, got ${createRes.status}: ${JSON.stringify(createRes.body)}`);
  const upDevice = createRes.body;
  console.log('[smoke] created device:', upDevice._id, 'monitor defaults:', upDevice.monitor);
  assert(upDevice.monitor.method === 'ping', 'server type should default to ping');
  assert(upDevice.monitor.intervalSeconds === 30, 'server type should default to 30s interval');

  // 2. Create a device with an unroutable IP (TEST-NET-1, RFC 5737) — should end up "down".
  const downRes = await request(app).post('/api/devices').set('Authorization', authHeader).send({
    name: 'Unreachable Firewall',
    type: 'firewall',
    ipAddress: '192.0.2.1',
    monitor: { downAfterFailures: 1, timeoutMs: 1000 },
  });
  assert(downRes.status === 201, `expected 201, got ${downRes.status}`);
  const downDevice = downRes.body;
  assert(downDevice.monitor.method === 'tcp' && downDevice.monitor.port === 443, 'firewall type should default to tcp/443');

  // 3. Trigger immediate checks for both.
  const upCheck = await request(app).post(`/api/devices/${upDevice._id}/check-now`).set('Authorization', authHeader);
  console.log('[smoke] loopback check-now result:', upCheck.body.result);
  assert(upCheck.body.result.ok === true, 'loopback ping should succeed');
  assert(upCheck.body.device.status.current === 'up', 'loopback device should be marked up');

  const downCheck = await request(app).post(`/api/devices/${downDevice._id}/check-now`).set('Authorization', authHeader);
  console.log('[smoke] unreachable check-now result:', downCheck.body.result);
  assert(downCheck.body.result.ok === false, 'unreachable TCP check should fail');
  assert(downCheck.body.device.status.current === 'down', 'unreachable device should be marked down (downAfterFailures=1)');

  // 4. List + summary endpoints.
  const list = await request(app).get('/api/devices').set('Authorization', authHeader);
  assert(list.body.length === 2, `expected 2 devices, got ${list.body.length}`);

  const summary = await request(app).get('/api/devices/summary').set('Authorization', authHeader);
  console.log('[smoke] summary:', summary.body);
  assert(summary.body.total === 2, 'summary total should be 2');
  assert(summary.body.up === 1 && summary.body.down === 1, 'summary should show 1 up, 1 down');

  // 5. Update + delete.
  const updateRes = await request(app)
    .put(`/api/devices/${upDevice._id}`)
    .set('Authorization', authHeader)
    .send({ monitor: { intervalSeconds: 45 } });
  assert(updateRes.body.monitor.intervalSeconds === 45, 'update should change interval');

  const delRes = await request(app).delete(`/api/devices/${downDevice._id}`).set('Authorization', authHeader);
  assert(delRes.status === 204, `expected 204, got ${delRes.status}`);

  // 6. User-management routes (admin-only) — list should show the seeded admin.
  const usersList = await request(app).get('/api/users').set('Authorization', authHeader);
  assert(usersList.status === 200 && usersList.body.length === 1, 'admin should be able to list users');
  assert(usersList.body[0].passwordHash === undefined, 'password hash must never be returned');
  console.log('[smoke] confirmed /api/users lists users without exposing password hashes');

  // 7. Status history: the loopback device just flipped unknown -> up via check-now above.
  const historyRes = await request(app).get(`/api/devices/${upDevice._id}/history`).set('Authorization', authHeader);
  assert(historyRes.status === 200, `history endpoint failed: ${JSON.stringify(historyRes.body)}`);
  assert(historyRes.body.timeline.some((seg) => seg.status === 'up'), 'history timeline should include an up segment');
  assert(historyRes.body.currentStatus === 'up', 'history should report the current status');
  console.log('[smoke] device history uptime (24h):', historyRes.body.uptime['24h']);

  // 8. Groups: an operator with groups=['siteA'] should only see siteA + ungrouped devices.
  await User.create({
    username: 'operator-a',
    passwordHash: await hashPassword('operator-a-password'),
    role: 'operator',
    groups: ['siteA'],
  });
  const opLogin = await request(app).post('/api/auth/login').send({ username: 'operator-a', password: 'operator-a-password' });
  assert(opLogin.status === 200, 'operator login should succeed');
  const opAuthHeader = `Bearer ${opLogin.body.token}`;

  const siteADevice = (
    await request(app)
      .post('/api/devices')
      .set('Authorization', authHeader)
      .send({ name: 'Site A Switch', type: 'switch', ipAddress: '10.0.0.2', group: 'siteA' })
  ).body;
  const siteBDevice = (
    await request(app)
      .post('/api/devices')
      .set('Authorization', authHeader)
      .send({ name: 'Site B Switch', type: 'switch', ipAddress: '10.0.0.3', group: 'siteB' })
  ).body;

  const opList = await request(app).get('/api/devices').set('Authorization', opAuthHeader);
  const opVisibleNames = opList.body.map((d) => d.name).sort();
  assert(
    opVisibleNames.includes('Site A Switch') && !opVisibleNames.includes('Site B Switch'),
    `operator should see siteA + ungrouped devices only, got: ${opVisibleNames.join(', ')}`
  );
  console.log('[smoke] confirmed group-restricted operator sees only their group + ungrouped devices');

  const opGetSiteB = await request(app).get(`/api/devices/${siteBDevice._id}`).set('Authorization', opAuthHeader);
  assert(opGetSiteB.status === 404, 'operator should not be able to fetch a device outside their group');

  // 9. Audit log: admin-only, should have recorded the device/user actions above.
  const auditAsOperator = await request(app).get('/api/audit').set('Authorization', opAuthHeader);
  assert(auditAsOperator.status === 403, 'audit log should be admin-only');

  const auditAsAdmin = await request(app).get('/api/audit').set('Authorization', authHeader);
  assert(auditAsAdmin.status === 200 && auditAsAdmin.body.entries.length > 0, 'admin should see recorded audit entries');
  assert(
    auditAsAdmin.body.entries.some((e) => e.action === 'device.create' && e.entityLabel === 'Site A Switch'),
    'audit log should include the siteA device creation'
  );
  console.log('[smoke] confirmed audit log records actions and is admin-only');

  // 10. Down alert: check-now on an unreachable device should POST to the webhook receiver.
  const alertDevice = (
    await request(app)
      .post('/api/devices')
      .set('Authorization', authHeader)
      .send({ name: 'Alert Test Device', type: 'server', ipAddress: '192.0.2.55', monitor: { downAfterFailures: 1, timeoutMs: 500 } })
  ).body;
  await request(app).post(`/api/devices/${alertDevice._id}/check-now`).set('Authorization', authHeader);
  // Filtered by name, not a raw count — other devices created earlier are still on their own
  // background schedule and may legitimately flip status (and alert) independently of this one.
  const alertDeviceWebhooks = receivedWebhooks.filter((w) => w.text.includes('Alert Test Device'));
  assert(alertDeviceWebhooks.length === 1, `expected 1 webhook call for Alert Test Device, got ${alertDeviceWebhooks.length}`);
  assert(alertDeviceWebhooks[0].text.includes('DOWN'), 'webhook payload should say DOWN');
  console.log('[smoke] confirmed down-alert webhook fires with the right payload:', alertDeviceWebhooks[0].title);

  const mutedDevice = (
    await request(app)
      .post('/api/devices')
      .set('Authorization', authHeader)
      .send({
        name: 'Muted Alert Device',
        type: 'server',
        ipAddress: '192.0.2.56',
        alertsEnabled: false,
        monitor: { downAfterFailures: 1, timeoutMs: 500 },
      })
  ).body;
  await request(app).post(`/api/devices/${mutedDevice._id}/check-now`).set('Authorization', authHeader);
  assert(
    receivedWebhooks.every((w) => !w.text.includes('Muted Alert Device')),
    'a device with alertsEnabled:false should not trigger a webhook call'
  );
  console.log('[smoke] confirmed alertsEnabled:false mutes a device');

  // 11. Groups management: list (with auto-registered siteA/siteB), create, rename cascade, delete cascade.
  const groupsList = await request(app).get('/api/groups').set('Authorization', authHeader);
  assert(groupsList.status === 200, `groups list failed: ${JSON.stringify(groupsList.body)}`);
  const siteAEntry = groupsList.body.find((g) => g.name === 'siteA');
  assert(siteAEntry, 'siteA should have been auto-registered from device/user usage');
  assert(siteAEntry.deviceCount === 1 && siteAEntry.userCount === 1, `siteA should show 1 device + 1 user, got ${JSON.stringify(siteAEntry)}`);
  console.log('[smoke] confirmed groups registry auto-syncs from existing device/user usage');

  const groupsAsOperator = await request(app).get('/api/groups').set('Authorization', opAuthHeader);
  assert(groupsAsOperator.status === 403, 'groups management should be admin-only');

  const createGroupRes = await request(app).post('/api/groups').set('Authorization', authHeader).send({ name: 'empty-group' });
  assert(createGroupRes.status === 201 && createGroupRes.body.deviceCount === 0, 'creating an empty group should succeed with 0 usage');

  const renameRes = await request(app)
    .put(`/api/groups/${siteAEntry._id}`)
    .set('Authorization', authHeader)
    .send({ name: 'siteA-renamed' });
  assert(renameRes.status === 200, `rename failed: ${JSON.stringify(renameRes.body)}`);
  assert(renameRes.body.cascade.devices === 1 && renameRes.body.cascade.users === 1, 'rename should report 1 device + 1 user updated');

  const renamedDevice = await request(app).get(`/api/devices/${siteADevice._id}`).set('Authorization', authHeader);
  assert(renamedDevice.body.group === 'siteA-renamed', 'device.group should reflect the cascaded rename');
  const renamedOperator = await request(app).get('/api/users').set('Authorization', authHeader);
  const opRecord = renamedOperator.body.find((u) => u.username === 'operator-a');
  assert(opRecord.groups.includes('siteA-renamed') && !opRecord.groups.includes('siteA'), 'user.groups should reflect the cascaded rename');
  console.log('[smoke] confirmed group rename cascades to devices and users');

  const deleteRes = await request(app).delete(`/api/groups/${siteAEntry._id}`).set('Authorization', authHeader);
  assert(deleteRes.status === 200 && deleteRes.body.devicesUnassigned === 1 && deleteRes.body.usersUnassigned === 1, 'delete should report cascade counts');

  const unassignedDevice = await request(app).get(`/api/devices/${siteADevice._id}`).set('Authorization', authHeader);
  assert(unassignedDevice.body.group === '', 'device.group should be cleared after group deletion');
  console.log('[smoke] confirmed group deletion cascades (unassigns) rather than leaving dangling references');

  const auditForGroups = await request(app).get('/api/audit?entityType=group').set('Authorization', authHeader);
  assert(
    auditForGroups.body.entries.some((e) => e.action === 'group.rename') && auditForGroups.body.entries.some((e) => e.action === 'group.delete'),
    'audit log should record group rename and delete actions'
  );
  console.log('[smoke] confirmed group actions are audited');

  // 12. Firewall connector pipeline: safe discovery with no credentials, UNKNOWN
  // health (not CRITICAL/OFFLINE) when reachable but telemetry-less, the existing
  // Up/Down chip still works, and credentials are never echoed back.
  const firewallDevice = (
    await request(app)
      .post('/api/devices')
      .set('Authorization', authHeader)
      .send({
        name: 'Firewall No Creds',
        type: 'firewall',
        ipAddress: '127.0.0.1',
        monitor: { method: 'connector', downAfterFailures: 1, timeoutMs: 800 },
      })
  ).body;
  assert(firewallDevice.monitor.method === 'connector', 'firewall device should use the connector method as requested');

  const healthBeforeFirstPoll = await request(app).get(`/api/devices/${firewallDevice._id}/health`).set('Authorization', authHeader);
  assert(
    healthBeforeFirstPoll.status === 200 && healthBeforeFirstPoll.body.hasCredential === false,
    'health should report hasCredential:false (not null/crash) before any poll has ever run'
  );
  console.log('[smoke] confirmed /health reports hasCredential correctly even before the first poll/discovery');

  const discoverRes = await request(app).post(`/api/devices/${firewallDevice._id}/discover`).set('Authorization', authHeader);
  assert(discoverRes.status === 200, `discover failed: ${JSON.stringify(discoverRes.body)}`);
  assert(discoverRes.body.reachability.icmp === true, 'loopback should be ICMP-reachable during discovery');
  assert(discoverRes.body.fingerprint.vendor === null, 'no vendor evidence -> fingerprint should stay null, never guessed');
  console.log('[smoke] confirmed firewall discovery runs safely with no credentials and never guesses a vendor');

  const firewallCheckNow = await request(app).post(`/api/devices/${firewallDevice._id}/check-now`).set('Authorization', authHeader);
  assert(firewallCheckNow.status === 200, `check-now failed: ${JSON.stringify(firewallCheckNow.body)}`);
  assert(
    firewallCheckNow.body.device.status.current === 'up',
    'connector-method device should still show as Up via the existing chip (reachable, just UNKNOWN rich health)'
  );
  console.log('[smoke] confirmed the existing Up/Down chip still works for connector-method devices');

  const healthRes = await request(app).get(`/api/devices/${firewallDevice._id}/health`).set('Authorization', authHeader);
  assert(healthRes.status === 200, `health failed: ${JSON.stringify(healthRes.body)}`);
  assert(
    healthRes.body.overallStatus === 'UNKNOWN',
    `expected UNKNOWN health with no credentials/telemetry, got ${healthRes.body.overallStatus}`
  );
  assert(healthRes.body.hasCredential === false, 'no credential has been set yet');
  console.log('[smoke] confirmed firewall health is UNKNOWN (not CRITICAL/OFFLINE) when reachable but telemetry-less');

  const credRes = await request(app)
    .put(`/api/devices/${firewallDevice._id}/credential`)
    .set('Authorization', authHeader)
    .send({ type: 'api_token', apiToken: 'test-token-should-never-be-returned' });
  assert(credRes.status === 200 && credRes.body.hasCredential === true, `setting credential failed: ${JSON.stringify(credRes.body)}`);
  assert(!JSON.stringify(credRes.body).includes('test-token-should-never-be-returned'), 'the raw secret must never be echoed back');
  console.log('[smoke] confirmed firewall credentials are accepted and never echoed back');

  const healthAfterCred = await request(app).get(`/api/devices/${firewallDevice._id}/health`).set('Authorization', authHeader);
  assert(healthAfterCred.status === 200 && healthAfterCred.body.hasCredential === true, 'health should report hasCredential:true');
  assert(!JSON.stringify(healthAfterCred.body).includes('test-token-should-never-be-returned'), 'health must never expose the raw secret');
  console.log('[smoke] confirmed /health reports credential presence without leaking the secret');

  const deleteCredRes = await request(app).delete(`/api/devices/${firewallDevice._id}/credential`).set('Authorization', authHeader);
  assert(deleteCredRes.status === 200 && deleteCredRes.body.hasCredential === false, 'deleting the credential should report hasCredential:false');
  console.log('[smoke] confirmed firewall credentials can be removed');

  // 13. Switch connector pipeline: same generalized routes (/discover, /credential, /health,
  // /poll) and shared ConnectorManager/Health Engine as the firewall pipeline, exercised end to
  // end via the generic SNMP fallback (no native switch vendor connector exists yet).
  const switchDevice = (
    await request(app)
      .post('/api/devices')
      .set('Authorization', authHeader)
      .send({
        name: 'Switch No Creds',
        type: 'switch',
        ipAddress: '127.0.0.1',
        monitor: { method: 'connector', downAfterFailures: 1, timeoutMs: 800 },
      })
  ).body;
  assert(switchDevice.monitor.method === 'connector', 'switch device should use the connector method as requested');

  const switchDiscoverRes = await request(app).post(`/api/devices/${switchDevice._id}/discover`).set('Authorization', authHeader);
  assert(switchDiscoverRes.status === 200, `switch discover failed: ${JSON.stringify(switchDiscoverRes.body)}`);
  assert(switchDiscoverRes.body.reachability.icmp === true, 'loopback should be ICMP-reachable during discovery');
  console.log('[smoke] confirmed switch discovery runs safely with the same shared discovery service');

  const switchPollRes = await request(app).post(`/api/devices/${switchDevice._id}/poll`).set('Authorization', authHeader);
  assert(switchPollRes.status === 200, `switch poll failed: ${JSON.stringify(switchPollRes.body)}`);
  assert(
    switchPollRes.body.overallStatus === 'UNKNOWN',
    `expected UNKNOWN health for a switch with no credentials/telemetry, got ${switchPollRes.body.overallStatus}`
  );
  console.log('[smoke] confirmed switch health is UNKNOWN (not CRITICAL/OFFLINE) when reachable but telemetry-less');

  const switchHealthRes = await request(app).get(`/api/devices/${switchDevice._id}/health`).set('Authorization', authHeader);
  assert(switchHealthRes.status === 200 && switchHealthRes.body.hasCredential === false, 'switch /health should report hasCredential:false');
  assert(Array.isArray(switchHealthRes.body.normalized.interfaces), 'switch normalized shape should include an interfaces array');
  assert('stack' in switchHealthRes.body.normalized && 'poe' in switchHealthRes.body.normalized, 'switch normalized shape should include stack/poe groups');
  console.log('[smoke] confirmed switch /health returns the switch-specific normalized shape (stack/poe/layer2) via the same shared route as firewall');

  const switchCredRes = await request(app)
    .put(`/api/devices/${switchDevice._id}/credential`)
    .set('Authorization', authHeader)
    .send({ type: 'snmp_v2', community: 'test-community-should-never-be-returned' });
  assert(switchCredRes.status === 200 && switchCredRes.body.hasCredential === true, `setting switch credential failed: ${JSON.stringify(switchCredRes.body)}`);
  assert(!JSON.stringify(switchCredRes.body).includes('test-community-should-never-be-returned'), 'the raw community string must never be echoed back');
  console.log('[smoke] confirmed switch credentials go through the same shared DeviceCredential storage as firewall, never echoed back');

  const switchCheckNow = await request(app).post(`/api/devices/${switchDevice._id}/check-now`).set('Authorization', authHeader);
  assert(switchCheckNow.status === 200, `switch check-now failed: ${JSON.stringify(switchCheckNow.body)}`);
  assert(
    switchCheckNow.body.device.status.current === 'up',
    'connector-method switch should still show as Up via the existing chip (reachable, just UNKNOWN rich health)'
  );
  console.log('[smoke] confirmed the existing Up/Down chip works for connector-method switches too (shared scheduler dispatch)');

  // 6. Also sanity-check a raw TCP check against a real local listener.
  const server = net.createServer((s) => s.end());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const { tcpCheck } = require('./src/services/checks');
  const tcpResult = await tcpCheck('127.0.0.1', port, 2000);
  assert(tcpResult.ok === true, 'tcp check against an open local port should succeed');
  server.close();

  await scheduler.stop();
  await mongoose.disconnect();
  await mongod.stop();
  await new Promise((resolve) => webhookServer.close(resolve));
  console.log('\n[smoke] ALL CHECKS PASSED');
  process.exit(0);
}

function assert(cond, msg) {
  if (!cond) {
    console.error('[smoke] ASSERTION FAILED:', msg);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[smoke] ERROR', err);
  process.exit(1);
});
