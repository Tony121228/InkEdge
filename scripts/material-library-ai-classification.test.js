const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

function listen(target) {
  return new Promise((resolve) => {
    const server = target.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function request(baseUrl, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await response.json();
  return { status: response.status, json };
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-library-ai-'));
  const modelCalls = [];
  const upstream = http.createServer(async (req, res) => {
    assert.strictEqual(req.url, '/v1/chat/completions');
    const body = JSON.parse(await readBody(req));
    const prompt = JSON.parse(body.messages[1].content);
    modelCalls.push(prompt);
    assert.strictEqual(prompt.taskName, '素材智能分类与题目生成');
    assert.ok(prompt.input.rawMaterial.includes('800米最后一圈'), 'model input should receive raw material');
    assert.ok(!prompt.input.clientTitle, 'client title should not be required');
    assert.ok(!prompt.input.clientScene, 'client scene should not be required');
    assert.ok(!prompt.input.clientSuitableTopics, 'client topics should not be required');

    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            title: '800米最后一圈',
            scene: '校园运动会',
            category: '挫折与坚持',
            event: '运动会800米最后一圈，我听见同学喊我的名字，腿很酸但还是冲过终点。',
            people: ['我', '同学', '体育老师'],
            places: ['操场跑道', '终点线'],
            actions: ['听见喊声', '咬牙加速', '冲过终点'],
            sensoryDetails: ['腿很酸', '风从耳边过去', '掌声越来越近'],
            emotions: ['想放弃', '被鼓励', '坚持下来'],
            suitableTopics: ['坚持的力量', '那一次，我没有放弃', '身边的鼓励', '难忘的运动会', '越过终点以后'],
            topicReasons: [
              { topic: '坚持的力量', reason: '素材里有想放弃到坚持完成的转折。' },
              { topic: '那一次，我没有放弃', reason: '最后一圈的动作能直接扣题。' }
            ],
            writingAngles: ['写最后一圈的身体感受', '写同学喊声带来的变化'],
            keywords: ['800米', '最后一圈', '同学喊声', '终点', '坚持'],
            completenessScore: 92
          })
        }
      }],
      usage: { total_tokens: 321 }
    }));
  });
  await listen(upstream);

  process.env.APP_DATA_DIR = tempDir;
  process.env.AI_API_BASE_URL = `http://127.0.0.1:${upstream.address().port}/v1`;
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_GUIDANCE_MODEL = 'test-guidance-model';
  process.env.AI_REWRITE_MODEL = '';
  process.env.PORT = '0';

  const app = require('../server');
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const created = await request(baseUrl, 'POST', '/api/v1/essay-sessions', {
      mode: 'brainstorm',
      title: '一次难忘的经历',
      grade: '五年级',
      genre: '记叙文'
    });
    assert.strictEqual(created.status, 200);
    const sessionId = created.json.data.sessionId;

    const rawMaterial = '运动会800米最后一圈，我听见同学喊我的名字，腿像灌了铅，体育老师在终点线旁挥手，我咬牙加速，最后冲过终点。';
    const saved = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/materials`, {
      rawMaterial
    });

    assert.strictEqual(saved.status, 200);
    assert.strictEqual(modelCalls.length, 1, 'saving raw material should call the model once');
    const material = saved.json.data.material;
    assert.strictEqual(material.title, '800米最后一圈');
    assert.strictEqual(material.category, '挫折与坚持');
    assert.strictEqual(material.scene, '校园运动会');
    assert.ok(material.event.includes('800米最后一圈'));
    assert.ok(material.suitableTopics.includes('坚持的力量'));
    assert.ok(material.suitableTopics.includes('那一次，我没有放弃'));
    assert.ok(material.topicReasons.some((item) => item.topic === '坚持的力量'));
    assert.ok(material.keywords.includes('终点'));
    assert.strictEqual(saved.json.data.completenessScore, 92);

    const session = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${sessionId}`);
    assert.strictEqual(session.status, 200);
    assert.strictEqual(session.json.data.materials.length, 1);
    assert.strictEqual(session.json.data.materials[0].category, '挫折与坚持');
    assert.ok(session.json.data.materials[0].suitableTopics.includes('坚持的力量'));

    console.log('OK material library AI classification');
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
