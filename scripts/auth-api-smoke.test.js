const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkedge-auth-api-'));
process.env.APP_DATA_DIR = tmpDir;
process.env.APP_SECRET = 'test-secret-for-auth-api-smoke-32-chars';
process.env.SMTP_HOST = '';
process.env.SMTP_PORT = '';
process.env.SMTP_SECURE = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.SMTP_FROM = '';

async function main() {
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const viewerResponse = await fetch(`${baseUrl}/api/me`);
    assert.strictEqual(viewerResponse.status, 200);
    const viewer = await viewerResponse.json();
    assert.strictEqual(viewer.authenticated, false);

    const sendResponse = await fetch(`${baseUrl}/api/auth/send-code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'smoke@example.com' })
    });
    assert.strictEqual(sendResponse.status, 503, 'missing SMTP should be reported as 503');
    const sendPayload = await sendResponse.json();
    assert.match(String(sendPayload.message || ''), /SMTP/);

    const verifyResponse = await fetch(`${baseUrl}/api/auth/verify-code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'smoke@example.com', code: '123456' })
    });
    assert.strictEqual(verifyResponse.status, 400, 'unknown verification code should be a controlled 400');
    const verifyPayload = await verifyResponse.json();
    assert.match(String(verifyPayload.message || ''), /验证码/);

    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
    assert.strictEqual(logoutResponse.status, 200);
    const logoutPayload = await logoutResponse.json();
    assert.strictEqual(logoutPayload.ok, true);

    console.log('OK auth API smoke: viewer, missing SMTP, invalid code, logout');
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
