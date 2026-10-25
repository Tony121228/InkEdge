const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(baseUrl, method, pathname, body, forwardedFor, cookie = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {})
      }
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null, headers: res.headers });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'essay-session-owner-'));
  process.env.APP_DATA_DIR = tempDir;
  process.env.AI_API_KEY = '';
  process.env.PORT = '0';

  const app = require('../server');
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const userA = '10.231.42.17';
  const userB = '10.231.42.18';
  const guestA = await request(baseUrl, 'GET', '/api/me', undefined, userA);
  const guestB = await request(baseUrl, 'GET', '/api/me', undefined, userB);
  const cookieA = (guestA.headers['set-cookie'] || []).map((item) => item.split(';')[0]).join('; ');
  const cookieB = (guestB.headers['set-cookie'] || []).map((item) => item.split(';')[0]).join('; ');

  try {
    const created = await request(baseUrl, 'POST', '/api/v1/essay-sessions', {
      mode: 'brainstorm',
      title: '那一刻，我长大了',
      grade: '五年级',
      genre: '记叙文',
      initialMaterial: '妈妈发烧仍陪我准备朗读比赛，我第一次主动煮粥、整理书包。'
    }, userA, cookieA);
    assert.strictEqual(created.status, 200, 'user A should create a session');
    const sessionId = created.json.data.sessionId;

    const saved = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/materials`, {
      event: '我在厨房煮粥，又把朗读稿和水杯放进书包。',
      people: ['我', '妈妈'],
      actions: ['煮粥', '整理书包']
    }, userA, cookieA);
    assert.strictEqual(saved.status, 200, 'user A should save material');

    const ownRead = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${sessionId}`, undefined, userA, cookieA);
    assert.strictEqual(ownRead.status, 200, 'user A should read own session');
    assert.strictEqual(ownRead.json.data.materials.length, 1, 'user A should see saved material');

    const crossRead = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${sessionId}`, undefined, userB, cookieB);
    assert.ok([403, 404].includes(crossRead.status), 'user B should not read user A session');
    assert.ok(['SESSION_FORBIDDEN', 'SESSION_NOT_FOUND'].includes(crossRead.json.error.code));

    for (const [route, body] of [
      ['topic-analysis', { initialMaterial: '试图读取别人的题目。' }],
      ['material-questions', { selectedAngle: '别人的素材' }],
      ['materials', { event: '我想把自己的素材塞进别人的会话。' }],
      ['guided-writing', { selectedAngle: '别人的素材', materialAnswers: [] }],
      ['diagnose', { draftText: '这是一段足够长的作文草稿，我想借别人的会话进行体检。' }]
    ]) {
      const response = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/${route}`, body, userB, cookieB);
      assert.ok([403, 404].includes(response.status), `user B should not POST ${route}`);
      assert.ok(['SESSION_FORBIDDEN', 'SESSION_NOT_FOUND'].includes(response.json.error.code), `${route} should use stable ownership error`);
    }

    const afterCrossWrites = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${sessionId}`, undefined, userA, cookieA);
    assert.strictEqual(afterCrossWrites.status, 200);
    assert.strictEqual(afterCrossWrites.json.data.materials.length, 1, 'cross-user writes should not mutate user A materials');

    console.log('OK essay session ownership');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    const stateFile = path.join(tempDir, 'app-state.json');
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
