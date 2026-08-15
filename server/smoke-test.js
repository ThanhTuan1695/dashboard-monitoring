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

  assert(
    switchHealthRes.body.normalized.bandwidth &&
      switchHealthRes.body.normalized.bandwidth.totalRxMbps === null &&
      switchHealthRes.body.normalized.bandwidth.totalTxMbps === null,
    'bandwidth should be present but null after only one poll — nothing to diff against yet'
  );
  console.log('[smoke] confirmed bandwidth stays null (not fabricated) until a second poll exists to diff against');

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

  // 14. 'ssh' monitor method: confirms a real SSH login, not just an open port —
  // available to every device type (unlike 'connector', which is firewall/switch only).
  const { Server: SshServer } = require('ssh2');
  const { generateKeyPairSync } = require('crypto');
  const { privateKey: sshHostKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  const sshServer = new SshServer({ hostKeys: [sshHostKey] }, (client) => {
    client
      .on('authentication', (ctx) => {
        if (ctx.method === 'password' && ctx.username === 'monitor' && ctx.password === 'correct-horse-battery-staple') {
          ctx.accept();
        } else {
          ctx.reject();
        }
      })
      .on('ready', () => client.end());
  });
  await new Promise((resolve) => sshServer.listen(0, '127.0.0.1', resolve));
  const sshPort = sshServer.address().port;

  const sshDevice = (
    await request(app)
      .post('/api/devices')
      .set('Authorization', authHeader)
      .send({
        name: 'SSH Test Server',
        type: 'server',
        ipAddress: '127.0.0.1',
        monitor: { method: 'ssh', port: sshPort, downAfterFailures: 1, timeoutMs: 3000 },
      })
  ).body;
  assert(sshDevice.monitor.method === 'ssh', 'ssh device should use the ssh method as requested');

  const sshNoCredCheck = await request(app).post(`/api/devices/${sshDevice._id}/check-now`).set('Authorization', authHeader);
  assert(
    sshNoCredCheck.body.device.status.current === 'down',
    'ssh check with no credential set yet should report down, not crash'
  );
  console.log('[smoke] confirmed ssh method with no credential set reports down safely (no crash)');

  const sshCredRes = await request(app)
    .put(`/api/devices/${sshDevice._id}/credential`)
    .set('Authorization', authHeader)
    .send({ type: 'username_password', username: 'monitor', password: 'correct-horse-battery-staple' });
  assert(sshCredRes.status === 200 && sshCredRes.body.hasCredential === true, `setting ssh credential failed: ${JSON.stringify(sshCredRes.body)}`);
  assert(!JSON.stringify(sshCredRes.body).includes('correct-horse-battery-staple'), 'the raw ssh password must never be echoed back');

  const sshGoodCheck = await request(app).post(`/api/devices/${sshDevice._id}/check-now`).set('Authorization', authHeader);
  assert(sshGoodCheck.body.device.status.current === 'up', 'ssh check with the correct credential should authenticate and report up');
  console.log('[smoke] confirmed ssh check-now authenticates with the stored credential and reports up');

  await request(app)
    .put(`/api/devices/${sshDevice._id}/credential`)
    .set('Authorization', authHeader)
    .send({ type: 'username_password', username: 'monitor', password: 'wrong-password' });
  const sshBadCheck = await request(app).post(`/api/devices/${sshDevice._id}/check-now`).set('Authorization', authHeader);
  assert(sshBadCheck.body.device.status.current === 'down', 'ssh check with a wrong password should report down, not up');
  console.log('[smoke] confirmed ssh check-now fails (reports down) when the password is wrong — a real auth check, not just port-open');

  sshServer.close();

  // 15. Plain 'snmp' monitor method: genuinely exercises the new discovery
  // service (snmpDiscoveryService.js)'s success path via a real local
  // net-snmp Agent/MIB — mirrors the ssh2.Server rigor above rather than
  // just confirming graceful failure against an unreachable host, since the
  // discovery-collection logic only ever runs when the check succeeds.
  const snmp = require('net-snmp');
  const dgram = require('dgram');

  const snmpPort = await new Promise((resolve, reject) => {
    const probe = dgram.createSocket('udp4');
    probe.on('error', reject);
    probe.bind(0, '127.0.0.1', () => {
      const { port: reserved } = probe.address();
      probe.close(() => resolve(reserved));
    });
  });

  const snmpAgent = snmp.createAgent({ port: snmpPort, address: '127.0.0.1', disableAuthorization: true }, () => {});
  snmpAgent.registerProviders([
    { name: 'sysDescr', type: snmp.MibProviderType.Scalar, oid: '1.3.6.1.2.1.1.1', scalarType: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess['read-only'] },
    { name: 'sysObjectID', type: snmp.MibProviderType.Scalar, oid: '1.3.6.1.2.1.1.2', scalarType: snmp.ObjectType.OID, maxAccess: snmp.MaxAccess['read-only'] },
    { name: 'sysUpTime', type: snmp.MibProviderType.Scalar, oid: '1.3.6.1.2.1.1.3', scalarType: snmp.ObjectType.TimeTicks, maxAccess: snmp.MaxAccess['read-only'] },
    { name: 'sysName', type: snmp.MibProviderType.Scalar, oid: '1.3.6.1.2.1.1.5', scalarType: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess['read-only'] },
    {
      name: 'entPhysicalTable',
      type: snmp.MibProviderType.Table,
      oid: '1.3.6.1.2.1.47.1.1.1.1',
      maxAccess: snmp.MaxAccess['not-accessible'],
      tableColumns: [
        { number: 1, name: 'entPhysicalIndex', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 5, name: 'entPhysicalClass', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 8, name: 'entPhysicalHardwareRev', type: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 9, name: 'entPhysicalFirmwareRev', type: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 10, name: 'entPhysicalSoftwareRev', type: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 11, name: 'entPhysicalSerialNum', type: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 13, name: 'entPhysicalModelName', type: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess['read-only'] },
      ],
      tableIndex: [{ columnName: 'entPhysicalIndex' }],
    },
    {
      name: 'ifTable',
      type: snmp.MibProviderType.Table,
      oid: '1.3.6.1.2.1.2.2.1',
      maxAccess: snmp.MaxAccess['not-accessible'],
      tableColumns: [
        { number: 1, name: 'ifIndex', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 2, name: 'ifDescr', type: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess['read-only'] },
      ],
      tableIndex: [{ columnName: 'ifIndex' }],
    },
    // ifXTable augments ifTable (same ifIndex) in the real MIB — same standalone-with-matching-
    // indices simplification as entPhySensorTable below.
    {
      name: 'ifXTable',
      type: snmp.MibProviderType.Table,
      oid: '1.3.6.1.2.1.31.1.1.1',
      maxAccess: snmp.MaxAccess['not-accessible'],
      tableColumns: [
        { number: 91, name: 'rowIndex', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 15, name: 'ifHighSpeed', type: snmp.ObjectType.Gauge, maxAccess: snmp.MaxAccess['read-only'] },
      ],
      tableIndex: [{ columnName: 'rowIndex' }],
    },
    // entPhySensorTable augments entPhysicalTable in the real MIB (RFC 3433), but for this mock
    // a standalone table with matching row indices is equivalent — readEntityMib() only merges
    // by index-string equality between the two returned objects, it doesn't care how the real
    // device's INDEX clause is defined.
    {
      name: 'entPhySensorTable',
      type: snmp.MibProviderType.Table,
      oid: '1.3.6.1.2.1.99.1.1.1',
      maxAccess: snmp.MaxAccess['not-accessible'],
      tableColumns: [
        { number: 90, name: 'rowIndex', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 1, name: 'entPhySensorType', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 5, name: 'entPhySensorOperStatus', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
      ],
      tableIndex: [{ columnName: 'rowIndex' }],
    },
    {
      name: 'pethMainPseTable',
      type: snmp.MibProviderType.Table,
      oid: '1.3.6.1.2.1.105.1.3.1.1', // provider oid = pethMainPseEntry (one level deeper than the table oid the client walks)
      maxAccess: snmp.MaxAccess['not-accessible'],
      tableColumns: [
        { number: 1, name: 'pethMainPseGroupIndex', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 2, name: 'pethMainPsePower', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 4, name: 'pethMainPseConsumptionPower', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
      ],
      tableIndex: [{ columnName: 'pethMainPseGroupIndex' }],
    },
  ]);

  const snmpMib = snmpAgent.getMib();
  snmpMib.setScalarValue('sysDescr', 'Mock Switch, SNMP Test Agent');
  snmpMib.setScalarValue('sysObjectID', '1.3.6.1.4.1.9.1.1208');
  snmpMib.setScalarValue('sysUpTime', 123456);
  snmpMib.setScalarValue('sysName', 'mock-switch-01');
  snmpMib.addTableRow('entPhysicalTable', [1, 3, 'rev-A', '12.1.0', '12.1.0', 'SN-MOCK-0001', 'TestSwitch-24T']);
  snmpMib.addTableRow('entPhysicalTable', [2, 7, '', '', '', '', '']); // fan
  snmpMib.addTableRow('entPhysicalTable', [3, 6, '', '', '', '', '']); // power supply
  snmpMib.addTableRow('entPhysicalTable', [4, 8, '', '', '', '', '']); // temperature sensor
  snmpMib.addTableRow('entPhySensorTable', [2, 1, 1]); // fan: type=other, operStatus=ok
  snmpMib.addTableRow('entPhySensorTable', [3, 1, 1]); // PSU: type=other, operStatus=ok
  snmpMib.addTableRow('entPhySensorTable', [4, 8, 1]); // temp: type=celsius, operStatus=ok
  snmpMib.addTableRow('pethMainPseTable', [1, 740, 123]);
  snmpMib.addTableRow('ifTable', [1, 'GigabitEthernet0/1']);
  snmpMib.addTableRow('ifTable', [2, 'GigabitEthernet0/2']);
  snmpMib.addTableRow('ifXTable', [1, 1000]);
  snmpMib.addTableRow('ifXTable', [2, 2500]);

  // Exercise the switch generic connector's environment/PoE reads directly against this same
  // agent — the OID-level bugs found while building this test (entPhySensorTable and
  // pethMainPseTable were both off by one MIB-tree level, or had a wrong column number) would
  // have silently returned null/UNKNOWN here rather than the real values.
  const { createGenericSwitchSnmpConnector } = require('./src/switch/connectors/genericSwitchSnmpConnector');
  const switchConn = createGenericSwitchSnmpConnector({ host: '127.0.0.1', port: snmpPort, community: 'public', version: '2c', timeoutMs: 3000 });
  const env = await switchConn.getEnvironment();
  assert(env && env.fans === 'healthy', `expected fans healthy, got ${JSON.stringify(env)}`);
  assert(env.powerSupplies === 'healthy', `expected powerSupplies healthy, got ${JSON.stringify(env)}`);
  assert(env.temperature === 'healthy', `expected temperature healthy, got ${JSON.stringify(env)}`);
  console.log('[smoke] confirmed entPhySensorTable is walked correctly against a real agent (fan/PSU/temperature all healthy)');

  const poe = await switchConn.getPoeStatus();
  assert(poe && poe.budgetWatts === 740, `expected PoE budgetWatts 740, got ${JSON.stringify(poe)}`);
  assert(poe.usedWatts === 123, `expected PoE usedWatts 123, got ${JSON.stringify(poe)}`);
  console.log('[smoke] confirmed pethMainPseTable (PoE budget/usage) is walked correctly against a real agent');

  const ifaces = await switchConn.getInterfaces();
  const if1 = ifaces.find((i) => i.name === 'GigabitEthernet0/1');
  const if2 = ifaces.find((i) => i.name === 'GigabitEthernet0/2');
  assert(if1 && if1.speedMbps === 1000, `expected if1 speedMbps 1000 (from ifXTable), got ${JSON.stringify(if1)}`);
  assert(if2 && if2.speedMbps === 2500, `expected if2 speedMbps 2500 (from ifXTable), got ${JSON.stringify(if2)}`);
  console.log('[smoke] confirmed ifXTable (high-speed interface counters) is walked correctly against a real agent');

  const snmpDevice = (
    await request(app)
      .post('/api/devices')
      .set('Authorization', authHeader)
      .send({
        name: 'SNMP Discovery Test Switch',
        type: 'switch',
        ipAddress: '127.0.0.1',
        monitor: { method: 'snmp', port: snmpPort, downAfterFailures: 1, timeoutMs: 3000 },
      })
  ).body;
  assert(snmpDevice.monitor.method === 'snmp', 'snmp device should use the snmp method as requested');
  assert(snmpDevice.snmpInfo && snmpDevice.snmpInfo.discoveredAt == null, 'a brand-new device should have no discovered info yet');

  const snmpCheck1 = await request(app).post(`/api/devices/${snmpDevice._id}/check-now`).set('Authorization', authHeader);
  assert(snmpCheck1.body.device.status.current === 'up', 'snmp check-now against the mock agent should report up');
  const info1 = snmpCheck1.body.device.snmpInfo;
  assert(info1.model === 'TestSwitch-24T', `expected model 'TestSwitch-24T', got ${JSON.stringify(info1)}`);
  assert(info1.serial === 'SN-MOCK-0001', `expected serial 'SN-MOCK-0001', got ${JSON.stringify(info1)}`);
  assert(info1.version === '12.1.0', `expected version '12.1.0', got ${JSON.stringify(info1)}`);
  assert(info1.interfaceCount === 2, `expected interfaceCount 2, got ${JSON.stringify(info1)}`);
  assert(info1.sysDescr === 'Mock Switch, SNMP Test Agent', `expected sysDescr echoed back, got ${JSON.stringify(info1)}`);
  assert(info1.discoveredAt != null, 'discoveredAt should be set after a successful discovery pass');
  console.log('[smoke] confirmed plain snmp method genuinely discovers chassis/interface info via a real ENTITY-MIB agent, not just reachability');

  // A second check-now right away must NOT re-run the full discovery walk (6h staleness gate) —
  // confirm the timestamp is untouched rather than re-stamped on every poll.
  await new Promise((resolve) => setTimeout(resolve, 10));
  const snmpCheck2 = await request(app).post(`/api/devices/${snmpDevice._id}/check-now`).set('Authorization', authHeader);
  assert(
    snmpCheck2.body.device.snmpInfo.discoveredAt === info1.discoveredAt,
    'a second immediate check-now should reuse the cached discovery, not re-run it'
  );
  console.log('[smoke] confirmed discovery is only re-run when stale, not on every poll');

  snmpAgent.close();

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
