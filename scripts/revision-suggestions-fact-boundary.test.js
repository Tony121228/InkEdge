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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-boundary-'));
  const modelPrompts = [];
  const upstream = http.createServer(async (req, res) => {
    assert.strictEqual(req.url, '/v1/chat/completions');
    const body = JSON.parse(await readBody(req));
    const prompt = JSON.parse(body.messages[1].content);
    modelPrompts.push(prompt);

    const isRevision = prompt.taskName.includes('局部修改建议');
    const content = isRevision
      ? {
        issueExplanation: '这句话缺少可看见的动作。',
        revisionStrategy: '只使用原文已有事实，把蓝色水杯和走廊脚步写具体。',
        exampleRevision: '我攥着蓝色水杯站在走廊口，听见自己的脚步声慢下来。',
        studentAction: '请确认蓝色水杯和走廊脚步是否真实出现。',
        revisionGoal: '补出真实细节'
      }
      : {
        overallComment: '草稿能写出事件，但细节还可以更具体。',
        dimensionScores: {
          materialSpecificity: { score: 48, level: '优先修改', evidence: '写到蓝色水杯和走廊，但动作偏少。', suggestion: '补手上动作。' }
        },
        priorityIssues: [
          { issueId: 'issue_1', dimension: 'materialSpecificity', title: '细节不足', severity: 'high', explanation: '关键画面还概括。', suggestion: '补蓝色水杯和走廊脚步。', relatedSegmentId: 'segment_1' }
        ],
        highlightedSegments: [
          { segmentId: 'segment_1', text: '我拿着蓝色水杯站在走廊口。', issueType: '细节不足', reason: '动作少。', suggestion: '补手上动作和脚步声。' }
        ],
        suggestedRevisionPath: ['先补动作', '再补感受']
      };

    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
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
    const draftText = '那天放学后，我拿着蓝色水杯站在走廊口，听见教室里同学还在背稿，我心里很紧张。后来老师走过来提醒我先深呼吸。';
    const created = await request(baseUrl, 'POST', '/api/v1/essay-sessions', {
      mode: 'revise',
      title: '那一次，我战胜了紧张',
      grade: '五年级',
      genre: '记叙文',
      draftText
    });
    assert.strictEqual(created.status, 200);
    const sessionId = created.json.data.sessionId;

    const diagnostic = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/diagnose`, {
      draftText,
      userGoal: '补具体'
    });
    assert.strictEqual(diagnostic.status, 200);

    const suggestion = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/revision-suggestions`, {
      diagnosticId: diagnostic.json.data.diagnosticId,
      revisionGoal: '补具体',
      keepFactsStrict: true
    });
    assert.strictEqual(suggestion.status, 200);

    const revisionPrompt = modelPrompts.find((item) => item.taskName.includes('局部修改建议'));
    assert(revisionPrompt, 'revision request should call the model');
    assert(revisionPrompt.input.draftText.includes('蓝色水杯'), 'revision request should include the original draft text');
    assert(revisionPrompt.input.factBoundary.includes('不得新增人物、地点、时间、事件'), 'revision input should spell out the fact boundary');
    assert(revisionPrompt.outputContract.includes('不得新增人物、地点、时间、事件'), 'revision contract should forbid invented facts');
    assert(revisionPrompt.outputContract.includes('只允许使用 draftText'), 'revision contract should restrict example revisions to known facts');

    console.log('OK revision suggestions fact boundary');
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
