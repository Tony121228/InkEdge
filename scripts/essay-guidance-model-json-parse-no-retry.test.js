const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function listenApp(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(base, method, route, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, base);
    const payload = body == null ? '' : JSON.stringify(body);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'content-type': 'application/json' }
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null });
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guidance-json-parse-'));
  let upstreamHits = 0;
  const upstream = http.createServer((req, res) => {
    upstreamHits += 1;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ message: { content: '这不是合法 JSON' } }],
      usage: { total_tokens: 12 }
    }));
  });
  await listen(upstream);

  process.env.APP_DATA_DIR = tempDir;
  process.env.AI_API_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_GUIDANCE_MODEL = 'test-guidance-model';
  process.env.AI_REWRITE_MODEL = '';

  const app = require('../server');
  const server = await listenApp(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const created = await request(base, 'POST', '/api/v1/training-plans', {
      planType: '7d',
      title: '那一刻，我长大了',
      grade: '初二',
      genre: '记叙文',
      initialMaterial: '我第一次主动承认错误。'
    });
    assert.strictEqual(created.status, 200, 'training plan should be created');
    const plan = created.json.data;
    const firstTask = plan.days[0];
    const run = await request(base, 'POST', `/api/v1/training-plans/${plan.id}/tasks/${firstTask.taskId}/run`, {
      input: {
        title: '那一刻，我长大了',
        grade: '初二',
        genre: '记叙文',
        initialMaterial: '我第一次主动承认错误。'
      }
    });

    assert.strictEqual(run.status, 200, 'stage run should fall back cleanly');
    assert.strictEqual(run.json.data.artifact.localFallback, true, 'invalid JSON should use local fallback');
    assert.strictEqual(run.json.data.artifact.modelFallbackReasonCode, 'MODEL_JSON_PARSE', 'fallback should expose JSON parse reason');
    assert.strictEqual(upstreamHits, 1, 'model JSON parse failure should not retry and multiply latency');
    console.log('OK guidance model JSON parse failure does not retry');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    const stateFile = path.join(tempDir, 'app-state.json');
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
