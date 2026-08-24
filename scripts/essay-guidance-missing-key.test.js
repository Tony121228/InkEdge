const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'essay-guidance-no-key-'));
process.env.APP_DATA_DIR = tempDir;
process.env.AI_API_KEY = '';
process.env.PORT = '0';

const app = require('../server');

function listen(target) {
  return new Promise((resolve) => {
    const server = target.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function request(baseUrl, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  return { status: response.status, json };
}

(async () => {
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const create = await request(baseUrl, 'POST', '/api/v1/essay-sessions', {
      mode: 'brainstorm',
      title: '那一刻，我长大了',
      genre: '记叙文',
      grade: '初二'
    });
    assert.strictEqual(create.status, 200);

    const topic = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${create.json.data.sessionId}/topic-analysis`, {
      title: '那一刻，我长大了',
      genre: '记叙文',
      grade: '初二'
    });

    assert.strictEqual(topic.status, 503);
    assert.strictEqual(topic.json.success, false);
    assert.strictEqual(topic.json.error.code, 'MODEL_UNAVAILABLE');

    const guided = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${create.json.data.sessionId}/guided-writing`, {
      selectedAngle: '考试后自己整理错题',
      materialAnswers: [
        { field: 'event', question: '这件事发生在什么时候？', answer: '期中考试后' }
      ]
    });

    assert.strictEqual(guided.status, 503);
    assert.strictEqual(guided.json.success, false);
    assert.strictEqual(guided.json.error.code, 'MODEL_UNAVAILABLE');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
