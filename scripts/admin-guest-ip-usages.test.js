const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appSecret = 'test-secret-for-admin-guest-ip-usages';
const sessionToken = 'admin-session-token';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-guest-ip-usages-'));

process.env.APP_DATA_DIR = tmpDir;
process.env.APP_SECRET = appSecret;
process.env.ADMIN_EMAILS = 'admin@example.com';

function hashValue(value) {
  return crypto.createHmac('sha256', appSecret).update(String(value || '')).digest('hex');
}

function seedState() {
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(tmpDir, 'app-state.json'), `${JSON.stringify({
    users: [{
      id: 'user_admin',
      email: 'admin@example.com',
      phone: '',
      displayName: 'Admin',
      role: 'admin',
      powerBalance: 1000,
      createdAt: now,
      lastLoginAt: now
    }],
    verificationCodes: [],
    sessions: [{
      id: 'sess_admin',
      userId: 'user_admin',
      tokenHash: hashValue(`session:${sessionToken}`),
      createdAt: now,
      lastSeenAt: now
    }],
    guestUsages: [],
    guestIpUsages: [{
      ip: '203.0.113.9',
      ipHash: hashValue('203.0.113.9'),
      remainingPower: 260,
      firstSeenAt: now,
      lastSeenAt: '2026-08-15T08:30:00.000Z'
    }, {
      ipHash: 'hash-only-guest-ip',
      remainingPower: 120,
      firstSeenAt: now,
      lastSeenAt: '2026-08-15T07:30:00.000Z'
    }],
    powerLedger: [],
    rechargeOrders: [],
    rewriteTasks: [],
    authRateLimits: []
  }, null, 2)}\n`, 'utf8');
}

async function main() {
  seedState();
  const app = require('../server');
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    const resp = await fetch(`http://127.0.0.1:${port}/api/admin/guest-ip-usages`, {
      headers: { cookie: `session_id=${sessionToken}` }
    });
    assert.strictEqual(resp.status, 200);
    const data = await resp.json();
    assert.strictEqual(data.ok, true);
    assert.deepStrictEqual(data.records, [{
      ipLabel: 'IP',
      ip: '203.0.113.9',
      remainingPower: 260,
      lastSeenAt: '2026-08-15T08:30:00.000Z'
    }, {
      ipLabel: 'IPhash',
      ip: 'hash-only-guest-ip',
      remainingPower: 120,
      lastSeenAt: '2026-08-15T07:30:00.000Z'
    }]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    const statePath = path.join(tmpDir, 'app-state.json');
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
    fs.rmdirSync(tmpDir);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
