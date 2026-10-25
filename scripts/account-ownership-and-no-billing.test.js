const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkedge-account-no-billing-'));
const appSecret = 'test-secret-for-account-no-billing-32-chars';
const sessionToken = 'account-test-session';
process.env.APP_DATA_DIR = tmpDir;
process.env.APP_SECRET = appSecret;
process.env.ADMIN_EMAILS = 'admin@example.com';
process.env.SMTP_HOST = '';
process.env.SMTP_FROM = '';

const now = new Date().toISOString();
const hash = (value) => crypto.createHmac('sha256', appSecret).update(String(value)).digest('hex');
fs.writeFileSync(path.join(tmpDir, 'app-state.json'), JSON.stringify({
  users: [{ id: 'user_a', email: 'a@example.com', displayName: '用户A', role: 'user', powerBalance: 999, createdAt: now, lastLoginAt: now }],
  sessions: [{ id: 'session_a', userId: 'user_a', tokenHash: hash(`session:${sessionToken}`), createdAt: now, lastSeenAt: now }]
}, null, 2));

async function main() {
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { cookie: `session_id=${sessionToken}`, 'content-type': 'application/json' };

    const viewerResp = await fetch(`${base}/api/me`, { headers });
    const viewer = await viewerResp.json();
    assert.strictEqual(viewerResp.status, 200);
    assert.strictEqual(viewer.authenticated, true);
    assert.strictEqual(viewer.user.id, 'user_a');
    assert.ok(!('powerBalance' in viewer.user));
    assert.ok(!('quota' in viewer));

    const sessionResp = await fetch(`${base}/api/v1/essay-sessions`, {
      method: 'POST', headers,
      body: JSON.stringify({ userId: 'user_b', mode: 'brainstorm', title: '账号归属测试', grade: '五年级', genre: '记叙文' })
    });
    const session = await sessionResp.json();
    assert.strictEqual(sessionResp.status, 200);
    assert.strictEqual(session.data.session.userId, 'user_a');

    const paymentResp = await fetch(`${base}/api/payment/config`, { headers });
    const payment = await paymentResp.json();
    assert.strictEqual(paymentResp.status, 200);
    assert.ok(payment.payment.qrSrc.includes('wechat-merchant-qr'));
    assert.ok(!('remarkHint' in payment.payment));
    assert.ok(!('adminContact' in payment.payment));

    for (const endpoint of ['/api/power/packages', '/api/power/ledger']) {
      const response = await fetch(`${base}${endpoint}`, { headers });
      assert.strictEqual(response.status, 410, `${endpoint} should be retired`);
    }

    const accountHtml = await (await fetch(`${base}/account.html`)).text();
    assert.ok(accountHtml.includes('wechat-merchant-qr.example.svg'));
    assert.ok(!accountHtml.includes('wechat-merchant-qr.jpg'));
    assert.ok(!/算力|试用额度|费率|转账备注|余额|临时IP/.test(accountHtml));
    console.log('OK account ownership and no-billing contract');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    const statePath = path.join(tmpDir, 'app-state.json');
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
