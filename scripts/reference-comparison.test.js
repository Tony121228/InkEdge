const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-comparison-test-'));
const modelCalls = [];
const failures = [];
let returnUnchangedReference = false;
let returnPunctuationOnlyReference = false;

const originalText = '周三放学后，我在学校操场跑完800米。起跑前手心出汗，跑到第二圈腿发沉，我差点停下，听见同学喊我的名字后继续跑过终点。';
const revisedText = '周三放学后，我在学校操场跑完800米。跑到第二圈时，腿越来越沉，我差点停下。操场边的风从耳边掠过，汗水顺着额角往下淌。听见同学喊我的名字后，我继续跑过终点。';

function check(name, assertion) {
  try {
    assertion();
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

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

let cookie = '';
async function request(baseUrl, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
    // Preserve the HTTP status when Express returns its default non-JSON 404 page.
  }
  return { status: response.status, json, text };
}

function modelInput(body) {
  try {
    return JSON.parse(body.messages?.[1]?.content || '{}');
  } catch (_) {
    return {};
  }
}

function loadPageFile(name) {
  const filePath = path.join(projectRoot, 'public', name);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function testReferencePageStructure() {
  const html = loadPageFile('reference-comparison.html');
  const script = loadPageFile('reference-comparison.js');
  const appScript = loadPageFile('app.js');
  const styles = loadPageFile('reference-comparison.css');
  const markupAndScript = `${html}\n${script}\n${appScript}`;

  check('reference comparison page must exist', () => {
    assert.ok(html, 'public/reference-comparison.html is missing');
  });
  check('reference page must show original and revised drafts in separate panes', () => {
    assert.match(html, /原稿/);
    assert.match(html, /参考稿/);
    assert.match(html, /comparison-grid|comparison-pane|original-pane|revised-pane/);
  });
  check('reference page must expose loading and error states', () => {
    assert.match(markupAndScript, /加载|生成中|正在生成/);
    assert.match(markupAndScript, /失败|错误|出错/);
  });
  check('reference page must provide retry and copy actions', () => {
    assert.match(markupAndScript, /重试/);
    assert.match(markupAndScript, /复制/);
    assert.match(script, /navigator\.clipboard|writeText/);
  });
  check('reference page must display the source revision suggestion and model change summary', () => {
    assert.match(html, /revisionSuggestionPanel/);
    assert.match(html, /changeSummaryPanel|改动说明/);
    assert.match(script, /revisionSuggestionText/);
    assert.match(script, /renderChangeSummary/);
    assert.match(appScript, /revisionSuggestionText/);
  });
  check('reference page must link both return actions to app.html', () => {
    assert.match(html, /class="top-return" href="\/app\.html"/);
    assert.match(html, /class="back-link" href="\/app\.html"/);
  });
  check('reference page must expose the shared light/dark theme toggle', () => {
    assert.match(html, /data-theme-toggle/);
    assert.match(html, /theme\.js/);
    assert.match(styles, /html\[data-theme="light"\]/);
    assert.match(styles, /\.theme-toggle/);
  });
  check('reference page must display diagnostic priority issues above the local suggestion', () => {
    assert.match(html, /priorityIssuesPanel/);
    assert.match(html, /priorityIssuesList/);
    assert.match(script, /renderPriorityIssues/);
    assert.match(script, /context\.priorityIssues \|\| context\.diagnostic\?\.priorityIssues/);
  });
  check('local revision result must display normalized addedDetails for student verification', () => {
    assert.ok(/suggestion\.factCheck\?\.addedDetails/.test(appScript), 'local revision result does not read factCheck.addedDetails');
    assert.ok(/新增描写，请核对/.test(appScript), 'local revision result is missing the added-detail verification label');
  });
  check('reference page must not present a strict fact-boundary pass label', () => {
    assert.ok(!/事实边界检查通过/.test(html), 'page still presents a strict fact-boundary pass label');
  });
  check('reference page styles must switch to a single column on mobile', () => {
    assert.match(styles, /@media/);
    assert.match(styles, /grid-template-columns/);
    assert.match(styles, /1fr/);
  });
}

async function runReferenceRewriteApi(baseUrl) {
  const create = await request(baseUrl, 'POST', '/api/v1/essay-sessions', {
    mode: 'revise',
    title: '运动会上的800米',
    grade: '初二',
    genre: '记叙文',
    draftText: originalText
  });
  assert.strictEqual(create.status, 200, 'test setup must create an essay session');
  const sessionId = create.json.data.sessionId;
  const diagnosis = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/diagnose`, {
    title: '运动会上的800米',
    grade: '初二',
    genre: '记叙文',
    userGoal: '补充动作细节',
    draftText: originalText
  });
  assert.strictEqual(diagnosis.status, 200, 'test setup must create a diagnostic reference');
  const diagnosticId = diagnosis.json.data.diagnosticId;
  const priorityIssues = diagnosis.json.data.priorityIssues;

  const blankCreate = await request(baseUrl, 'POST', '/api/v1/essay-sessions', {
    mode: 'brainstorm',
    title: '空稿',
    grade: '初二',
    genre: '记叙文',
    draftText: ''
  });
  assert.strictEqual(blankCreate.status, 200, 'test setup must create an empty-draft session');

  const requestBody = {
    originalText,
    diagnosticId,
    priorityIssues,
    revisionGoal: '补充动作细节，保持原有事实',
    revisionSuggestionText: '修改思路：把第二圈时身体越来越沉、差点停下的过程写具体，补充脚步和呼吸变化。',
    revisionSuggestion: {
      issueExplanation: '第二圈后的动作还不够具体。',
      revisionStrategy: '只用原文已有事实写清第二圈的身体感受。',
      exampleRevision: '跑到第二圈时，腿越来越沉。',
      studentAction: '核对示范中的动作与原文是否一致。',
      revisionGoal: '补充动作细节，保持原有事实',
      factCheck: {
        summary: '增加了合理描写，需核对。',
        usedSourceFacts: ['周三放学后', '学校操场', '800米'],
        addedDetails: ['风从耳边掠过'],
        coreFactsPreserved: true,
        noNewFacts: false
      }
    }
  };
  const callsBeforeInvalid = modelCalls.length;

  const emptyDraft = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${blankCreate.json.data.sessionId}/reference-rewrite`, {
    ...requestBody,
    originalText: ''
  });
  check('reference-rewrite must reject an empty draft before model invocation', () => {
    assert.strictEqual(emptyDraft.status, 400);
  });

  const missingSession = await request(baseUrl, 'POST', '/api/v1/essay-sessions/missing_reference_session/reference-rewrite', requestBody);
  check('reference-rewrite must reject a missing essay session before model invocation', () => {
    assert.strictEqual(missingSession.status, 404);
    assert.ok(missingSession.json && missingSession.json.failureCode, 'missing session should return a structured API error');
  });

  const missingDiagnostic = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/reference-rewrite`, {
    ...requestBody,
    diagnosticId: 'missing_diagnostic'
  });
  check('reference-rewrite must require an explicit diagnostic reference', () => {
    assert.ok([400, 404].includes(missingDiagnostic.status), `unexpected status ${missingDiagnostic.status}`);
    assert.ok(missingDiagnostic.json && missingDiagnostic.json.failureCode, 'missing diagnostic should return a structured API error');
  });
  check('invalid reference-rewrite requests must not invoke the model', () => {
    assert.strictEqual(modelCalls.length, callsBeforeInvalid, 'invalid requests added model calls');
  });

  const staleSuggestion = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/reference-rewrite`, {
    ...requestBody,
    revisionSuggestion: undefined,
    suggestionId: 'missing_saved_suggestion'
  });
  check('reference-rewrite must reject suggestion IDs not saved to the current diagnostic', () => {
    assert.strictEqual(staleSuggestion.status, 404);
    assert.strictEqual(staleSuggestion.json?.failureCode, 'REVISION_SUGGESTION_NOT_FOUND');
  });

  const callsBeforeValid = modelCalls.length;
  const result = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/reference-rewrite`, requestBody);
  check('valid reference-rewrite must return the original and revised draft contract', () => {
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.json?.success, true);
    assert.strictEqual(result.json?.data?.originalText, originalText);
    assert.ok(typeof result.json?.data?.revisedText === 'string' && result.json.data.revisedText.trim());
    assert.match(result.json.data.revisedText, /风从耳边掠过/);
    assert.deepStrictEqual(result.json?.data?.changes, [
      { location: '第二圈', modification: '展开腿部发沉、脚步放慢和呼吸急促的过程。' }
    ]);
  });

  const referenceCalls = modelCalls.slice(callsBeforeValid).map(modelInput);
  check('reference rewrite prompt must request substantive revisions and allow reasonable additions without lists', () => {
    const outputRules = String(referenceCalls[0]?.outputRules || '');
    assert.match(outputRules, /必须落实 input\.revisionSuggestionText/);
    assert.match(outputRules, /input\.priorityIssues/);
    assert.match(outputRules, /自由改写|自由调整/);
    assert.match(outputRules, /事件、人物、细节/);
    assert.doesNotMatch(outputRules, /addedDetails|factCheck\.addedDetails/);
  });
  check('reference rewrite model must receive the original local suggestion and be told to implement it', () => {
    const call = referenceCalls[0];
    assert.strictEqual(call?.input?.revisionSuggestionText, requestBody.revisionSuggestionText);
    assert.match(String(call?.outputContract || ''), /changes.*location.*modification/);
    assert.match(String(call?.outputRules || ''), /必须落实 input\.revisionSuggestionText/);
  });
  check('reference model must receive the essay diagnosis, suggestions, and prompt-only revision boundary', () => {
    assert.ok(referenceCalls.length > 0, 'valid reference rewrite did not call the model');
    for (const call of referenceCalls) {
      assert.strictEqual(call.input?.originalText, originalText);
      assert.strictEqual(call.input?.revisionBoundary, undefined, 'reference rewrite must not send a restrictive fact boundary');
      assert.ok(call.input?.priorityIssues?.length, 'model input is missing top-level priority issues');
      assert.ok(call.input?.diagnostic?.overallComment, 'model input is missing the diagnostic summary');
      assert.ok(Object.keys(call.input?.diagnostic?.dimensionScores || {}).length, 'model input is missing diagnostic scores');
      assert.ok(call.input?.diagnostic?.priorityIssues?.length, 'model input is missing diagnostic priority issues');
      assert.deepStrictEqual(call.input?.priorityIssues, call.input?.diagnostic?.priorityIssues, 'model input top-level priority issues must match the diagnosis card');
      assert.ok(call.input?.priorityIssues?.some((item) => item.title === '补充过程动作'), 'model input priority issues must include the diagnosis card problem');
      assert.ok(call.input?.diagnostic?.highlightedSegments?.length, 'model input is missing diagnostic highlighted segments');
      assert.ok(call.input?.diagnostic?.suggestedRevisionPath?.length, 'model input is missing the diagnostic revision path');
      for (const key of ['issueExplanation', 'revisionStrategy', 'exampleRevision', 'studentAction', 'revisionGoal']) {
        assert.strictEqual(call.input?.revisionSuggestion?.[key], requestBody.revisionSuggestion[key], `model input revision suggestion is missing ${key}`);
      }
      assert.deepStrictEqual(call.input?.revisionSuggestion?.factCheck?.addedDetails, ['风从耳边掠过']);
      assert.strictEqual(call.input?.revisionSuggestion?.factCheck?.coreFactsPreserved, true);
      assert.strictEqual(call.input?.revisionGoal, requestBody.revisionGoal, 'model input is missing the selected revision goal');
      assert.ok(!JSON.stringify(call.input?.revisionSuggestion || {}).includes('老师递水'));
    }
  });

  returnUnchangedReference = true;
  const unchangedResult = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/reference-rewrite`, requestBody);
  check('reference-rewrite must not reject a valid-length draft based on change-detection logic', () => {
    assert.strictEqual(unchangedResult.status, 200);
    assert.strictEqual(unchangedResult.json?.data?.revisedText, originalText);
  });

  returnUnchangedReference = false;
  returnPunctuationOnlyReference = true;
  const punctuationOnlyResult = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/reference-rewrite`, requestBody);
  check('reference-rewrite must not reject drafts based on substantive-change thresholds', () => {
    assert.strictEqual(punctuationOnlyResult.status, 200);
    assert.strictEqual(punctuationOnlyResult.json?.data?.revisedText, originalText.replace('，', '；'));
  });
}

(async () => {
  testReferencePageStructure();

  const fakeDeepSeek = await listen(http.createServer(async (req, res) => {
    try {
      assert.strictEqual(req.url, '/v1/chat/completions');
      assert.strictEqual(req.headers.authorization, 'Bearer test-key');
      const body = JSON.parse(await readBody(req));
      const parsed = modelInput(body);
      modelCalls.push(body);
      const isDiagnosis = /作文体检|单篇作文体检/.test(String(parsed.taskName || ''));
      const payload = isDiagnosis
        ? {
          overallComment: '作文写出了完整跑步过程，还可以补充真实动作。',
          dimensionScores: {
            materialSpecificity: { key: 'materialSpecificity', name: '素材具体度', score: 6, level: '可提升', evidence: '动作细节较少', suggestion: '补充真实动作。' }
          },
          priorityIssues: [{ issueId: 'issue_1', dimension: 'materialSpecificity', title: '补充过程动作', severity: 'medium', explanation: '第二圈后的动作可以更清楚。', suggestion: '回忆真实动作。', relatedSegmentId: 'segment_1' }],
          highlightedSegments: [{ segmentId: 'segment_1', text: '我差点停下', issueType: '过程概括', reason: '缺少动作展开', suggestion: '补足真实动作。' }],
          suggestedRevisionPath: ['补充真实动作']
        }
        : {
          revisedText: returnUnchangedReference
            ? originalText
            : returnPunctuationOnlyReference
            ? originalText.replace('，', '；')
              : revisedText,
          changes: [
            { location: '第二圈', modification: '展开腿部发沉、脚步放慢和呼吸急促的过程。' }
          ]
        };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: { total_tokens: 128 } }));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  }));

  process.env.APP_DATA_DIR = tempDir;
  process.env.AI_API_BASE_URL = `http://127.0.0.1:${fakeDeepSeek.address().port}/v1`;
  process.env.AI_API_KEY = 'test-key';
  process.env.PORT = '0';

  const app = require('../server');
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await runReferenceRewriteApi(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => fakeDeepSeek.close(resolve));
    const statePath = path.join(tempDir, 'app-state.json');
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  }

  if (failures.length) throw new Error(`Reference comparison contract failures:\n- ${failures.join('\n- ')}`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
