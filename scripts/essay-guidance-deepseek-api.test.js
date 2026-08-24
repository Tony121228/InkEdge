const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'essay-guidance-deepseek-'));
const calls = [];

function listen(server) {
  return new Promise((resolve) => {
    const handle = server.listen(0, '127.0.0.1', () => resolve(handle));
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

function responseFor(body) {
  const text = `${body.messages?.[0]?.content || ''}\n${body.messages?.[1]?.content || ''}`;
  if (text.includes('题目理解')) {
    return {
      topicKeywords: ['那一刻', '长大'],
      coreQuestion: '模型生成：抓住一个真实变化瞬间。',
      possibleAngles: [{ angleId: 'model_angle_1', title: '模型立意', prompt: '写一次真实经历中的变化。', materialHint: '补人物、动作和对话。' }],
      riskyAngles: [{ title: '空泛抒情', reason: '容易脱离事实。' }],
      suggestedNextQuestions: ['这件事发生在什么时候？']
    };
  }
  if (text.includes('作文体检')) {
    return {
      overallComment: '模型生成：先补事实，再改表达。',
      dimensionScores: {
        topicFit: { key: 'topicFit', name: '审题贴合度', score: 72, level: '可提升', evidence: '回应题目', suggestion: '回扣题眼' },
        materialSpecificity: { key: 'materialSpecificity', name: '素材具体度', score: 51, level: '优先修改', evidence: '细节少', suggestion: '补动作' }
      },
      priorityIssues: [{ issueId: 'issue_model_1', dimension: 'materialSpecificity', title: '模型问题', severity: 'high', explanation: '缺动作', suggestion: '补一个动作', relatedSegmentId: 'segment_model_1' }],
      highlightedSegments: [{ segmentId: 'segment_model_1', text: '成长是一束光。', issueType: '空泛表达', reason: '像模板', suggestion: '换成真实画面' }],
      suggestedRevisionPath: ['先补动作']
    };
  }
  return {
    questions: [{ field: 'dialogue', question: '模型追问：有没有一句真实对话？', purpose: '补齐对话，避免编造。' }],
    materialChecklist: [{ field: 'dialogue', label: '对话', present: false, value: '', suggestion: '补真实对话。' }],
    nextAction: 'continue_questions',
    selectedAngle: '模型立意'
  };
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
  const fakeDeepSeek = await listen(http.createServer(async (req, res) => {
    assert.strictEqual(req.method, 'POST');
    assert.strictEqual(req.url, '/v1/chat/completions');
    assert.strictEqual(req.headers.authorization, 'Bearer test-key');
    const body = JSON.parse(await readBody(req));
    calls.push(body);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(responseFor(body)) } }],
      usage: { total_tokens: 123 }
    }));
  }));

  process.env.APP_DATA_DIR = tempDir;
  process.env.AI_API_BASE_URL = `http://127.0.0.1:${fakeDeepSeek.address().port}/v1`;
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_DETECT_MODEL = 'deepseek-chat';
  process.env.AI_REWRITE_MODEL = 'deepseek-chat';
  process.env.PORT = '0';

  const app = require('../server');
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
    assert.strictEqual(topic.status, 200);
    assert.strictEqual(topic.json.success, true);
    assert.strictEqual(topic.json.data.coreQuestion, '模型生成：抓住一个真实变化瞬间。');

    const diagnose = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${create.json.data.sessionId}/diagnose`, {
      title: '那一刻，我长大了',
      genre: '记叙文',
      grade: '初二',
      draftText: '成长是一束光，照亮我前行的路。那一次考试后，我明白了努力的重要性。从那以后，我会更加努力，做更好的自己。'
    });
    assert.strictEqual(diagnose.status, 200);
    assert.strictEqual(diagnose.json.success, true);
    assert.strictEqual(diagnose.json.data.overallComment, '模型生成：先补事实，再改表达。');

    assert.strictEqual(calls.length, 2);
    const promptText = calls.map((item) => item.messages.map((message) => message.content).join('\n')).join('\n');
    assert.ok(promptText.includes('只输出 JSON'));
    assert.ok(promptText.includes('不替学生生成完整作文'));
    assert.ok(promptText.includes('不编造'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => fakeDeepSeek.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
