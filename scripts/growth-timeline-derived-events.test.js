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

function modelJsonFor(prompt) {
  if (prompt.taskName.includes('长期能力初始测评')) {
    return {
      dimensionScores: {
        审题能力: 70,
        立意能力: 66,
        选材能力: 74,
        结构能力: 62,
        细节能力: 58,
        语言能力: 60,
        修改能力: 48,
        考场表达能力: 64
      },
      dimensionComments: {
        细节能力: '能写事件，但动作和感官细节还偏少。',
        修改能力: '修改意识还需要通过复盘训练。'
      },
      summary: '素材真实，下一步重点补细节和修改。'
    };
  }
  if (prompt.taskName.includes('单篇作文体检')) {
    return {
      overallComment: '作文能扣住题目，但关键场景还需要更具体。',
      dimensionScores: {
        topicFit: { key: 'topicFit', name: '审题贴合度', score: 78, level: '可提升', evidence: '能回应成长。', suggestion: '结尾再扣题。' },
        materialSpecificity: { key: 'materialSpecificity', name: '素材具体度', score: 56, level: '优先修改', evidence: '动作少。', suggestion: '补一处手上动作。' }
      },
      priorityIssues: [
        { issueId: 'issue_1', dimension: 'materialSpecificity', title: '关键场景细节不足', severity: 'high', explanation: '过程写得概括。', suggestion: '补动作和对话。', relatedSegmentId: 'segment_1' }
      ],
      highlightedSegments: [
        { segmentId: 'segment_1', text: '我终于坚持下来了。', issueType: '概括', reason: '缺动作。', suggestion: '补冲线前的动作。' }
      ],
      suggestedRevisionPath: ['先补动作', '再改结尾']
    };
  }
  return {};
}

function request(baseUrl, method, pathname, body, forwardedFor) {
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
        ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {})
      }
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'growth-timeline-'));
  const upstream = http.createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    const prompt = JSON.parse(body.messages[1].content);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(modelJsonFor(prompt)) } }],
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
  const userA = '10.231.50.17';
  const userB = '10.231.50.18';

  try {
    const assessment = await request(baseUrl, 'POST', '/api/v1/ability/initial-assessment', {
      grade: '五年级',
      target: '提升记叙文',
      title: '那一刻，我长大了',
      genre: '记叙文',
      sampleEssay: '运动会800米最后一圈，我听见同学喊我的名字，腿很酸但还是冲过终点。'
    }, userA);
    assert.strictEqual(assessment.status, 200);

    const profileUpdate = await request(baseUrl, 'POST', '/api/v1/ability/profile/update-from-reflection', {
      dimensionEvidence: {
        细节能力: '细节进步：补了最后一圈的动作和声音。',
        修改能力: '修改进步：根据体检意见重写了结尾。'
      }
    }, userA);
    assert.strictEqual(profileUpdate.status, 200);
    assert.ok(profileUpdate.json.data.changedDimensions.length >= 1);

    const plan = await request(baseUrl, 'POST', '/api/v1/training-plans', {
      planType: '7d',
      title: '坚持的力量',
      grade: '五年级',
      genre: '记叙文',
      initialMaterial: '运动会800米最后一圈，我咬牙冲过终点。',
      focusDimensions: ['细节能力']
    }, userA);
    assert.strictEqual(plan.status, 200);
    const taskId = plan.json.data.days[0].taskId;

    const submission = await request(baseUrl, 'POST', `/api/v1/training-tasks/${taskId}/submissions`, {
      content: '我写了最后一圈腿酸、同学喊声和冲线动作。',
      spentMinutes: 18
    }, userA);
    assert.strictEqual(submission.status, 200);

    const session = await request(baseUrl, 'POST', '/api/v1/essay-sessions', {
      mode: 'revise',
      title: '坚持的力量',
      grade: '五年级',
      genre: '记叙文',
      draftText: '运动会800米最后一圈，我听见同学喊我的名字，腿很酸但还是冲过终点。我终于坚持下来了。'
    }, userA);
    assert.strictEqual(session.status, 200);
    const sessionId = session.json.data.sessionId;

    const diagnosis = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/diagnose`, {
      draftText: '运动会800米最后一圈，我听见同学喊我的名字，腿很酸但还是冲过终点。我终于坚持下来了。'
    }, userA);
    assert.strictEqual(diagnosis.status, 200);

    const timeline = await request(baseUrl, 'GET', '/api/v1/growth/timeline', undefined, userA);
    assert.strictEqual(timeline.status, 200);
    assert.ok(timeline.json.data.timeline.length >= 4, 'growth timeline should derive visible events');
    assert.ok(timeline.json.data.abilityChanges.length >= 1, 'growth timeline should expose ability changes');
    assert.ok(timeline.json.data.currentStage, 'growth timeline should expose current stage');
    assert.ok(timeline.json.data.nextSuggestions.length >= 1, 'growth timeline should give next suggestions');
    assert.ok(JSON.stringify(timeline.json.data).includes('完成能力诊断'));
    assert.ok(JSON.stringify(timeline.json.data).includes('完成训练任务'));
    assert.ok(JSON.stringify(timeline.json.data).includes('完成作文体检'));

    const otherTimeline = await request(baseUrl, 'GET', '/api/v1/growth/timeline', undefined, userB);
    assert.strictEqual(otherTimeline.status, 200);
    assert.strictEqual(otherTimeline.json.data.timeline.length, 0, 'user B should not see user A growth events');

    console.log('OK growth timeline derived events');
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
