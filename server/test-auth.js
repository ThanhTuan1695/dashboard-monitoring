/**
 * Unit test for auth: password hashing, JWT sign/verify, and the
 * requireAuth/requireAdmin middleware — no database needed.
 */
const assert = require('assert');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./src/services/auth');
const { requireAuth, requireAdmin } = require('./src/middleware/auth');

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

async function main() {
  // password hashing round-trip
  const hash = await hashPassword('correct-password-123');
  assert.strictEqual(await verifyPassword('correct-password-123', hash), true, 'correct password should verify');
  assert.strictEqual(await verifyPassword('wrong-password', hash), false, 'wrong password should not verify');
  console.log('[test] OK: password hashing round-trip');

  // token round-trip
  const adminUser = { _id: { toString: () => 'user-1' }, role: 'admin', username: 'alice' };
  const adminToken = signToken(adminUser);
  const decoded = verifyToken(adminToken);
  assert.strictEqual(decoded.sub, 'user-1');
  assert.strictEqual(decoded.role, 'admin');
  console.log('[test] OK: JWT sign/verify round-trip');

  // requireAuth: missing token -> 401, next not called
  {
    const req = { headers: {} };
    const res = fakeRes();
    let called = false;
    requireAuth(req, res, () => (called = true));
    assert.strictEqual(called, false);
    assert.strictEqual(res.statusCode, 401);
  }
  console.log('[test] OK: requireAuth rejects a missing token');

  // requireAuth: valid token -> next called, req.user populated
  {
    const req = { headers: { authorization: `Bearer ${adminToken}` } };
    const res = fakeRes();
    let called = false;
    requireAuth(req, res, () => (called = true));
    assert.strictEqual(called, true);
    assert.strictEqual(req.user.role, 'admin');
  }
  console.log('[test] OK: requireAuth accepts a valid token');

  // requireAuth: garbage token -> 401
  {
    const req = { headers: { authorization: 'Bearer not-a-real-token' } };
    const res = fakeRes();
    let called = false;
    requireAuth(req, res, () => (called = true));
    assert.strictEqual(called, false);
    assert.strictEqual(res.statusCode, 401);
  }
  console.log('[test] OK: requireAuth rejects an invalid token');

  // requireAdmin: operator role -> 403
  {
    const operatorUser = { _id: { toString: () => 'user-2' }, role: 'operator', username: 'bob' };
    const opToken = signToken(operatorUser);
    const req = { headers: { authorization: `Bearer ${opToken}` } };
    const res = fakeRes();
    let called = false;
    requireAdmin(req, res, () => (called = true));
    assert.strictEqual(called, false);
    assert.strictEqual(res.statusCode, 403);
  }
  console.log('[test] OK: requireAdmin rejects a non-admin role');

  // requireAdmin: admin role -> next called
  {
    const req = { headers: { authorization: `Bearer ${adminToken}` } };
    const res = fakeRes();
    let called = false;
    requireAdmin(req, res, () => (called = true));
    assert.strictEqual(called, true);
  }
  console.log('[test] OK: requireAdmin accepts an admin role');

  console.log('\n[test] ALL AUTH TESTS PASSED');
}

main().catch((err) => {
  console.error('[test] FAILED', err);
  process.exitCode = 1;
});
