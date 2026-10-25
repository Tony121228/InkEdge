const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'essay-guidance-server-regression-'));
const failures = [];
const modelPlans = [];
const modelCalls = [];

const topicAngles = [
  {
    angleId: 'angle_1',
    title: '在紧张中坚持完成演讲',
    prompt: '写第一次独自上台演讲时，从紧张退缩到坚持讲完的真实变化。',
    whyThisFitsTopic: '关键动作和前后变化能具体表现成长。',
    materialConnection: '使用手发抖、看见讲稿和坚持讲完这些真实素材。',
    writingPath: '先写上台前的紧张，再写台上的动作和困难，最后写坚持讲完后的认识。',
    keyDetailsToAsk: ['上台前看见了什么？', '最想放弃时做了什么？'],
    riskReminder: '不要只说自己很紧张。',
    materialHint: '补充现场、动作和身体感受。'
  },
  {
    angleId: 'angle_2',
    title: '从等待帮助到主动承担',
    prompt: '写一次在家人需要时主动做事的经历。',
    whyThisFitsTopic: '主动承担能体现成长。',
    materialConnection: '把演讲时坚持到底的力量迁移到生活中的主动承担。',
    writingPath: '先写发现家人需要帮助，再写连续行动，最后写家人的真实反应。',
    keyDetailsToAsk: ['你发现了什么？', '你按什么顺序做了哪些事？'],
    riskReminder: '不要编造家人对话。',
    materialHint: '补充触发点、动作顺序和结果。'
  },
  {
    angleId: 'angle_3',
    title: '在失败后主动整理问题',
    prompt: '写一次失败后不再逃避、主动查找原因的经历。',
    whyThisFitsTopic: '主动面对问题能体现成长。',
    materialConnection: '使用演讲前紧张但最终完成的经历作为面对困难的基础。',
    writingPath: '先写失败后的反应，再写整理和改正的动作，最后写态度变化。',
    keyDetailsToAsk: ['失败后第一反应是什么？', '后来具体整理了什么？'],
    riskReminder: '不要用大道理代替行动。',
    materialHint: '补充失败结果、整理动作和改变证据。'
  }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function topicFixture(
  angles = topicAngles,
  riskyAngles = [{ title: '只写道理', reason: '缺少真实事件。' }]
) {
  return {
    topicKeywords: ['成长', '坚持'],
    coreQuestion: '用哪一个真实瞬间表现自己从退缩到主动面对？',
    possibleAngles: clone(angles),
    riskyAngles: clone(riskyAngles),
    suggestedNextQuestions: ['当时谁在场？', '你连续做了哪些动作？']
  };
}

function materialFixture(selectedAngleId, marker) {
  const selected = topicAngles.find((angle) => angle.angleId === selectedAngleId);
  const anchors = selectedAngleId === 'angle_1'
    ? ['第一次独自上台演讲', '手一直在抖', '坚持讲完', '台下同学', '演讲结束后的变化']
    : ['家人需要帮助', '主动承担', '连续行动', '家人的真实反应', '从等待到主动'];
  return {
    questionSetId: `model_${marker}`,
    selectedAngleId,
    questions: anchors.map((anchor, index) => ({
      questionId: `${marker}_q${index + 1}`,
      field: ['trigger', 'scene', 'action', 'reaction', 'change'][index],
      category: ['触发', '现场', '行动', '反应', '变化'][index],
      question: `围绕「${anchor}」，请写清第 ${index + 1} 个真实细节，以及它怎样推进「${selected.title}」这一立意？`,
      purpose: `补足「${selected.writingPath}」中的第 ${index + 1} 个关键环节。`,
      materialAnchor: `${anchor}；${selected.title}`,
      detailHints: ['当时可见的具体情况', '你真实做出的动作', '前后发生的变化'],
      required: true
    })),
    materialChecklist: [
      { field: 'event', label: '事件', present: true, value: marker, suggestion: '继续补足动作顺序。' }
    ],
    requiredAnswerCount: 5,
    nextAction: 'answer_questions'
  };
}

function lowQualityMaterialFixture(selectedAngleId, variant) {
  const genericQuestions = variant === 'short'
    ? [
      ['何时？', '事'], ['何地？', '人'], ['何人？', '物'], ['何事？', '想'], ['如何？', '做']
    ]
    : [
      ['请详细说明这件事情发生时的具体情况。', '这件事情'],
      ['请详细说明当时相关人物的具体表现。', '相关人物'],
      ['请详细说明事情发展过程中的主要动作。', '事情过程'],
      ['请详细说明事情结束之后的真实感受。', '真实感受'],
      ['请详细说明这件事情带给你的重要变化。', '重要变化']
    ];
  return {
    questionSetId: `model_low_${variant}`,
    selectedAngleId,
    questions: genericQuestions.map(([question, materialAnchor], index) => ({
      questionId: `low_${variant}_${index + 1}`,
      field: `field_${index + 1}`,
      category: `分类${index + 1}`,
      question,
      purpose: variant === 'short' ? `补${index + 1}` : '补充一段一般性的事件信息。',
      materialAnchor,
      detailHints: variant === 'short' ? ['时', '地'] : ['时间和地点', '人物和动作'],
      required: true
    })),
    materialChecklist: [
      { field: 'event', label: '事件', present: false, value: '', suggestion: '继续补充。' }
    ],
    requiredAnswerCount: 5,
    nextAction: 'answer_questions'
  };
}

function indirectMaterialMatchFixture(selectedAngle) {
  return {
    questionSetId: 'model_indirect_material_match',
    selectedAngleId: selectedAngle.angleId,
    questions: [
      ['trigger', '触发', '请说明这个部分开始时发生了什么具体情况，以及它为什么值得写。', '雨后操场边的红色长椅'],
      ['scene', '现场', '请说明当时周围有什么可以看见或听见的具体事物。', '教学楼二层的旧公告栏'],
      ['action', '行动', '请按先后顺序说明人物做了哪些动作，事情怎样向前发展。', '贴着蓝色胶带的纸箱'],
      ['reaction', '反应', '请说明其他人物看到这些动作之后有什么真实反应。', '戴银边眼镜的值日老师'],
      ['change', '变化', '请说明事情结束以后，人物的想法或做法发生了什么变化。', '写着日期的绿色便签']
    ].map(([field, category, question, materialAnchor], index) => ({
      questionId: `indirect_q${index + 1}`,
      field,
      category,
      question,
      purpose: `用于推进“${selectedAngle.title}”这一方向中的第 ${index + 1} 个环节。`,
      materialAnchor,
      detailHints: ['交代具体时间地点', '写清人物连续动作', '说明事情前后变化'],
      required: true
    })),
    materialChecklist: [
      { field: 'event', label: '事件', present: true, value: '已有事件', suggestion: '继续补充动作。' }
    ],
    requiredAnswerCount: 5,
    nextAction: 'answer_questions'
  };
}

function outlineFixture(marker = 'guide') {
  return {
    outlineTree: {
      title: `提纲-${marker}`,
      theme: '在真实行动中体现变化',
      children: [
        { nodeId: 'p1', role: '开头', label: '现场切入', focus: '写清地点和触发点', children: [] },
        { nodeId: 'p2', role: '主体', label: '行动过程', focus: '按顺序写动作和阻力', children: [] }
      ]
    }
  };
}

function paragraphFixture(marker = 'guide') {
  return {
    paragraphGuides: [
      {
        paragraphId: 'p1',
        role: '开头',
        goal: `用真实现场进入事件-${marker}`,
        mustInclude: ['地点', '人物', '触发动作'],
        writingPrompts: ['你第一眼看见了什么？'],
        starterHint: '从一个可见动作开始。',
        avoid: ['不要空喊口号'],
        suggestedLength: '80-120字'
      }
    ],
    missingMaterialQuestions: [],
    nextAction: 'write_paragraph_1',
    studentTask: '先完成开头段。'
  };
}

function taskNameFor(body) {
  try {
    return JSON.parse(body.messages?.[1]?.content || '{}').taskName || '';
  } catch (_) {
    return '';
  }
}

function parsedModelInput(body) {
  try {
    return JSON.parse(body.messages?.[1]?.content || '{}');
  } catch (_) {
    return {};
  }
}

function defaultModelResponse(taskName, body) {
  if (taskName === '题目理解与立意建议') return topicFixture();
  if (taskName === '素材追问') {
    const prompt = JSON.parse(body.messages[1].content);
    return materialFixture(prompt.input.selectedAngleId, `default_${prompt.input.selectedAngleId}`);
  }
  if (taskName === '短期写作引导：生成提纲树') return outlineFixture();
  if (taskName === '短期写作引导：生成段落写作提示') return paragraphFixture();
  throw new Error(`Unexpected model task: ${taskName}`);
}

function queueModelResponse(taskName, response, gate = null) {
  const arrived = deferred();
  const entry = { taskName, response, gate, arrived };
  modelPlans.push(entry);
  return entry;
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

async function request(baseUrl, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await response.json();
  return { status: response.status, json };
}

function check(name, assertion) {
  try {
    assertion();
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

function responseIsStale(response) {
  return response.status === 409 && response.json?.failureCode === 'STALE_REQUEST'
    || response.json?.data?.stale === true
    || response.json?.stale === true;
}

function assertCompleteAngles(result) {
  const angles = result?.possibleAngles;
  assert.ok(Array.isArray(angles), 'possibleAngles must be an array');
  assert.strictEqual(angles.length, 3, 'possibleAngles must contain exactly three items');
  assert.strictEqual(new Set(angles.map((angle) => angle.angleId)).size, 3, 'angleId values must be unique');
  for (const angle of angles) {
    for (const field of ['angleId', 'title', 'prompt', 'writingPath']) {
      assert.strictEqual(typeof angle?.[field], 'string', `${field} must be a string`);
      assert.ok(angle[field].trim(), `${field} must not be empty`);
    }
  }
}

async function createBrainstormSession(baseUrl, initialMaterial = '我第一次独自上台演讲，手一直在抖，但最后坚持讲完。') {
  const created = await request(baseUrl, 'POST', '/api/v1/essay-sessions', {
    mode: 'brainstorm',
    title: '那一刻，我长大了',
    genre: '记叙文',
    grade: '初二',
    initialMaterial,
    draftText: ''
  });
  assert.strictEqual(created.status, 200);
  return created.json.data.sessionId;
}

async function analyzeTopic(baseUrl, sessionId) {
  const response = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/topic-analysis`, {
    title: '那一刻，我长大了',
    genre: '记叙文',
    grade: '初二'
  });
  assert.strictEqual(response.status, 200);
  return response;
}

function answersFor(questionSet) {
  return questionSet.questions
    .filter((question) => question.required)
    .map((question) => ({
      questionId: question.questionId,
      answer: `针对 ${question.materialAnchor}，这是学生提供的真实细节和连续动作。`
    }));
}

async function runMaterialQuestionRace(baseUrl) {
  const sessionId = await createBrainstormSession(baseUrl);
  await analyzeTopic(baseUrl, sessionId);

  const gateA = deferred();
  const planA = queueModelResponse('素材追问', materialFixture('angle_1', 'race_a'), gateA.promise);
  const requestA = request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/material-questions`, {
    selectedAngleId: 'angle_1'
  });
  await planA.arrived.promise;

  queueModelResponse('素材追问', materialFixture('angle_2', 'race_b'));
  const responseB = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/material-questions`, {
    selectedAngleId: 'angle_2'
  });
  assert.strictEqual(responseB.status, 200, 'newer B request should succeed');
  gateA.resolve();
  const responseA = await requestA;

  check('older material-question response must be marked stale', () => {
    assert.ok(responseIsStale(responseA), `expected stale response, got HTTP ${responseA.status}`);
  });

  const session = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${sessionId}`);
  check('older A response must not overwrite newer B question set', () => {
    assert.strictEqual(session.status, 200);
    assert.strictEqual(session.json.data.selectedAngleId, 'angle_2');
    assert.strictEqual(session.json.data.materialQuestionSet.questionSetId, responseB.json.data.questionSetId);
  });

  const guided = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/guided-writing`, {
    selectedAngleId: 'angle_2',
    questionSetId: responseB.json.data.questionSetId,
    materialAnswers: answersFor(responseB.json.data),
    preferredStructure: '记叙文'
  });
  check('newer B question set must remain usable for guided writing', () => {
    assert.strictEqual(guided.status, 200);
    assert.strictEqual(guided.json.success, true);
    assert.strictEqual(guided.json.data.questionSetId, responseB.json.data.questionSetId);
  });
}

async function runGuidedWritingRace(baseUrl) {
  const sessionId = await createBrainstormSession(baseUrl);
  await analyzeTopic(baseUrl, sessionId);

  queueModelResponse('素材追问', materialFixture('angle_1', 'old_stage'));
  const oldQuestions = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/material-questions`, {
    selectedAngleId: 'angle_1'
  });
  assert.strictEqual(oldQuestions.status, 200);

  const oldGuideGate = deferred();
  const oldOutlinePlan = queueModelResponse('短期写作引导：生成提纲树', outlineFixture('old'), oldGuideGate.promise);
  const oldGuideRequest = request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/guided-writing`, {
    selectedAngleId: 'angle_1',
    questionSetId: oldQuestions.json.data.questionSetId,
    materialAnswers: answersFor(oldQuestions.json.data),
    preferredStructure: '记叙文'
  });
  await oldOutlinePlan.arrived.promise;

  queueModelResponse('素材追问', materialFixture('angle_2', 'new_stage'));
  const newQuestions = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/material-questions`, {
    selectedAngleId: 'angle_2'
  });
  assert.strictEqual(newQuestions.status, 200);
  oldGuideGate.resolve();
  const oldGuideResponse = await oldGuideRequest;

  check('old guided-writing response must be marked stale after a new question set starts', () => {
    assert.ok(responseIsStale(oldGuideResponse), `expected stale response, got HTTP ${oldGuideResponse.status}`);
  });

  const session = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${sessionId}`);
  check('old guided-writing completion must not overwrite the new material-question stage', () => {
    assert.strictEqual(session.status, 200);
    assert.strictEqual(session.json.data.selectedAngleId, 'angle_2');
    assert.strictEqual(session.json.data.materialQuestionSet.questionSetId, newQuestions.json.data.questionSetId);
    assert.strictEqual(session.json.data.status, 'collecting_materials');
    assert.ok(
      !session.json.data.guidedWriting
        || session.json.data.guidedWriting.questionSetId === newQuestions.json.data.questionSetId,
      'session must not expose a guide produced from the superseded question set'
    );
  });
}

async function runTopicValidationCases(baseUrl) {
  const cases = [];

  const missingId = clone(topicAngles);
  delete missingId[0].angleId;
  cases.push(['missing angleId', missingId]);

  const duplicateId = clone(topicAngles);
  duplicateId[1].angleId = duplicateId[0].angleId;
  cases.push(['duplicate angleId', duplicateId]);

  for (const field of ['title', 'prompt', 'writingPath']) {
    const missingField = clone(topicAngles);
    delete missingField[0][field];
    cases.push([`missing ${field}`, missingField]);
  }

  cases.push(['not exactly three angles', clone(topicAngles).slice(0, 2)]);

  for (const [name, angles] of cases) {
    const sessionId = await createBrainstormSession(baseUrl);
    queueModelResponse('题目理解与立意建议', topicFixture(angles));
    const result = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/topic-analysis`, {
      title: '那一刻，我长大了',
      genre: '记叙文',
      grade: '初二'
    });

    check(`topic-analysis must reject or normalize ${name}`, () => {
      if (result.status === 200) assertCompleteAngles(result.json.data);
      else {
        assert.strictEqual(result.status, 502);
        assert.ok(
          ['TOPIC_ANALYSIS_INVALID', 'TOPIC_ANALYSIS_FAILED'].includes(result.json.failureCode),
          `unexpected failureCode ${result.json.failureCode}`
        );
      }
    });

    const session = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${sessionId}`);
    check(`session must not persist unusable angles for ${name}`, () => {
      const stored = session.json.data.topicAnalysis;
      if (stored) assertCompleteAngles(stored);
      else assert.notStrictEqual(result.status, 200, 'a successful response must persist a valid topic analysis');
    });
  }
}

async function runRiskyAngleNormalizationCases(baseUrl) {
  const stringRisks = [
    '只写我明白了坚持的道理，没有展开真实事件。',
    '临时编造人物对话和动作，会让细节失真。'
  ];
  const stringSessionId = await createBrainstormSession(baseUrl);
  queueModelResponse('题目理解与立意建议', topicFixture(topicAngles, stringRisks));
  const stringResult = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${stringSessionId}/topic-analysis`, {
    title: '那一刻，我长大了',
    genre: '记叙文',
    grade: '初二'
  });

  check('topic-analysis must normalize non-empty riskyAngles strings into frontend-safe objects', () => {
    assert.strictEqual(stringResult.status, 200);
    assertCompleteAngles(stringResult.json.data);
    assert.strictEqual(stringResult.json.data.riskyAngles.length, stringRisks.length);
    stringResult.json.data.riskyAngles.forEach((risk, index) => {
      assert.ok(risk && typeof risk === 'object' && !Array.isArray(risk));
      assert.ok(typeof risk.title === 'string' && risk.title.trim(), `riskyAngles[${index}].title must be non-empty`);
      assert.ok(typeof risk.reason === 'string' && risk.reason.trim(), `riskyAngles[${index}].reason must be non-empty`);
      assert.ok(
        `${risk.title}${risk.reason}`.includes(stringRisks[index]),
        `riskyAngles[${index}] must retain the model-provided warning text`
      );
    });
  });

  const storedStringSession = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${stringSessionId}`);
  check('normalized riskyAngles strings must be persisted in frontend-safe object form', () => {
    assert.strictEqual(storedStringSession.status, 200);
    assert.deepStrictEqual(
      storedStringSession.json.data.topicAnalysis.riskyAngles,
      stringResult.json.data.riskyAngles
    );
  });

  const emptySessionId = await createBrainstormSession(baseUrl);
  queueModelResponse('题目理解与立意建议', topicFixture(topicAngles, []));
  const emptyResult = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${emptySessionId}/topic-analysis`, {
    title: '那一刻，我长大了',
    genre: '记叙文',
    grade: '初二'
  });

  check('topic-analysis must continue accepting an empty riskyAngles array', () => {
    assert.strictEqual(emptyResult.status, 200);
    assertCompleteAngles(emptyResult.json.data);
    assert.deepStrictEqual(emptyResult.json.data.riskyAngles, []);
  });
}

async function runMaterialQualityCases(baseUrl) {
  for (const variant of ['short', 'generic']) {
    const sessionId = await createBrainstormSession(baseUrl);
    await analyzeTopic(baseUrl, sessionId);
    queueModelResponse('素材追问', lowQualityMaterialFixture('angle_1', variant));
    const result = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/material-questions`, {
      selectedAngleId: 'angle_1'
    });

    check(`material questions must reject ${variant === 'short' ? 'extremely short generic fields' : 'a set with no substantive angle or material anchor'}`, () => {
      assert.strictEqual(result.status, 502);
      assert.strictEqual(result.json.failureCode, 'MATERIAL_QUESTIONS_INVALID');
    });

    const session = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${sessionId}`);
    check(`rejected ${variant} material questions must not be persisted`, () => {
      assert.ok(!session.json.data.materialQuestionSet, 'invalid question set was persisted');
    });
  }
}

async function runTopicSemanticQualityCase(baseUrl) {
  const placeholderAngles = clone(topicAngles).map((angle, index) => ({
    ...angle,
    angleId: `placeholder_${index + 1}`,
    title: '好',
    prompt: '写事',
    writingPath: '写事'
  }));
  const sessionId = await createBrainstormSession(baseUrl);
  queueModelResponse('题目理解与立意建议', topicFixture(placeholderAngles));
  const result = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/topic-analysis`, {
    title: '那一刻，我长大了',
    genre: '记叙文',
    grade: '初二'
  });

  check('topic-analysis must reject structurally complete placeholder angles', () => {
    assert.strictEqual(result.status, 502);
    assert.strictEqual(result.json.failureCode, 'TOPIC_ANALYSIS_INVALID');
  });

  const session = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${sessionId}`);
  check('placeholder angles must not be persisted', () => {
    assert.ok(!session.json.data.topicAnalysis, 'placeholder topic analysis was persisted');
  });
}

async function runMaterialSourceIntegrityCase(baseUrl) {
  const initialMaterial = '周六清晨，我在青石巷口扶起摔倒的快递箱，并把散落的橘子逐个捡回篮子。';
  const customAngles = clone(topicAngles);
  customAngles[0] = {
    ...customAngles[0],
    title: '把一次犹豫写成主动行动',
    prompt: '写清自己从短暂旁观到主动伸手帮忙的真实转变。',
    materialConnection: '使用青石巷口、摔倒的快递箱和散落橘子这些学生已经提供的素材。',
    writingPath: '先写发现意外时的犹豫，再写主动帮忙的连续动作，最后写这次行动带来的认识。',
    materialHint: '补清触发犹豫的现场、伸手帮忙的动作顺序和事后变化。'
  };
  const sessionId = await createBrainstormSession(baseUrl, initialMaterial);
  queueModelResponse('题目理解与立意建议', topicFixture(customAngles));
  const analysis = await analyzeTopic(baseUrl, sessionId);
  assert.strictEqual(analysis.status, 200);

  queueModelResponse('素材追问', indirectMaterialMatchFixture(customAngles[0]));
  const result = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/material-questions`, {
    selectedAngleId: customAngles[0].angleId
  });

  check('material questions must directly reference initial material instead of borrowing materialConnection', () => {
    assert.strictEqual(result.status, 502);
    assert.strictEqual(result.json.failureCode, 'MATERIAL_QUESTIONS_INVALID');
  });

  const session = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${sessionId}`);
  check('indirectly matched material questions must not be persisted', () => {
    assert.ok(!session.json.data.materialQuestionSet, 'indirectly matched question set was persisted');
  });
}

async function createGuidedSession(baseUrl, marker, additionalMaterial = '') {
  const sessionId = await createBrainstormSession(baseUrl);
  await analyzeTopic(baseUrl, sessionId);
  queueModelResponse('素材追问', materialFixture('angle_1', marker));
  const questions = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/material-questions`, {
    selectedAngleId: 'angle_1'
  });
  assert.strictEqual(questions.status, 200);
  const guidedBody = {
    selectedAngleId: 'angle_1',
    questionSetId: questions.json.data.questionSetId,
    materialAnswers: answersFor(questions.json.data),
    preferredStructure: '记叙文'
  };
  if (additionalMaterial) guidedBody.additionalMaterial = additionalMaterial;
  const guided = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/guided-writing`, guidedBody);
  assert.strictEqual(guided.status, 200);
  const beforeReset = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${sessionId}`);
  assert.ok(beforeReset.json.data.materialAnswers.length > 0, 'test setup must persist material answers');
  assert.ok(beforeReset.json.data.guidedWriting, 'test setup must persist guided writing');
  assert.ok(beforeReset.json.data.latestGuide, 'test setup must expose latestGuide');
  return { sessionId, questions, guided };
}

async function runStageResetCases(baseUrl) {
  const topicReset = await createGuidedSession(baseUrl, 'topic_reset');
  const analysis = await analyzeTopic(baseUrl, topicReset.sessionId);
  assert.strictEqual(analysis.status, 200);
  const afterTopicReset = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${topicReset.sessionId}`);
  check('successful topic-analysis rerun must clear all downstream stage state', () => {
    const session = afterTopicReset.json.data;
    assert.ok(!session.selectedAngleId, 'selectedAngleId was not cleared');
    assert.ok(!session.materialQuestionSet, 'materialQuestionSet was not cleared');
    assert.deepStrictEqual(session.materialAnswers || [], [], 'materialAnswers were not cleared');
    assert.ok(!session.guidedWriting, 'guidedWriting was not cleared');
    assert.ok(!session.latestGuide, 'latestGuide still exposes an obsolete guide');
  });

  const materialReset = await createGuidedSession(baseUrl, 'material_reset_old');
  queueModelResponse('素材追问', materialFixture('angle_1', 'material_reset_new'));
  const regenerated = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${materialReset.sessionId}/material-questions`, {
    selectedAngleId: 'angle_1'
  });
  assert.strictEqual(regenerated.status, 200);
  const afterMaterialReset = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${materialReset.sessionId}`);
  check('successful material-question rerun must clear answers and obsolete guides', () => {
    const session = afterMaterialReset.json.data;
    assert.deepStrictEqual(session.materialAnswers || [], [], 'materialAnswers were not cleared');
    assert.ok(!session.guidedWriting, 'guidedWriting was not cleared');
    assert.ok(!session.latestGuide, 'latestGuide still exposes an obsolete guide');
    assert.strictEqual(session.materialQuestionSet.questionSetId, regenerated.json.data.questionSetId);
  });
}

async function runAdditionalMaterialBindingCases(baseUrl) {
  const additionalMaterial = '補充：演講前我把講稿折了兩次，手心的汗把紙角浸濕。';
  const targetSession = await createGuidedSession(baseUrl, 'additional_binding_target', additionalMaterial);
  const boundGuideCalls = modelCalls
    .map(parsedModelInput)
    .filter((call) => call.input?.additionalMaterial === additionalMaterial);
  check('additionalMaterial must enter both guided-writing model calls with the current session binding', () => {
    assert.strictEqual(boundGuideCalls.length, 2);
    assert.ok(boundGuideCalls.every((call) => call.input.questionSetId === targetSession.questions.json.data.questionSetId));
    assert.ok(boundGuideCalls.every((call) => call.input.selectedAngleId === 'angle_1'));
    assert.ok(boundGuideCalls.every((call) => call.input.factSources.some((source) => String(source.content || '').includes(additionalMaterial))));
  });
  const targetStateBeforeCrossSession = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${targetSession.sessionId}`);
  check('additionalMaterial must persist only on the current session', () => {
    assert.strictEqual(targetStateBeforeCrossSession.json.data.additionalMaterial, additionalMaterial);
  });

  const sourceSession = await createGuidedSession(baseUrl, 'additional_binding_source');
  const callsBeforeCrossSession = modelCalls.length;
  const crossSessionQuestionSet = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${targetSession.sessionId}/guided-writing`, {
    selectedAngleId: 'angle_1',
    questionSetId: sourceSession.questions.json.data.questionSetId,
    additionalMaterial: '这段补充素材只属于另一个会话的题组。'
  });

  check('additionalMaterial must reject a questionSetId issued for another session', () => {
    assert.strictEqual(crossSessionQuestionSet.status, 400);
    assert.strictEqual(crossSessionQuestionSet.json.failureCode, 'QUESTION_SET_MISMATCH');
  });
  check('cross-session additionalMaterial must not invoke the writing-guide model', () => {
    assert.strictEqual(modelCalls.length, callsBeforeCrossSession, 'cross-session question set should not add model calls');
  });

  const callsBeforeAngleMismatch = modelCalls.length;
  const wrongAngle = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${targetSession.sessionId}/guided-writing`, {
    selectedAngleId: 'angle_2',
    questionSetId: targetSession.questions.json.data.questionSetId,
    additionalMaterial: '这段补充素材不能改绑到另一个立意。'
  });
  check('additionalMaterial must reject an angle that differs from its current question set', () => {
    assert.strictEqual(wrongAngle.status, 400);
    assert.strictEqual(wrongAngle.json.failureCode, 'ANGLE_MISMATCH');
  });
  check('angle-mismatched additionalMaterial must not invoke the writing-guide model', () => {
    assert.strictEqual(modelCalls.length, callsBeforeAngleMismatch, 'angle mismatch should not add model calls');
  });
  const targetStateAfterRejectedBindings = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${targetSession.sessionId}`);
  check('rejected foreign question-set material must not replace the session-bound additionalMaterial', () => {
    assert.strictEqual(targetStateAfterRejectedBindings.json.data.additionalMaterial, additionalMaterial);
  });
}

(async () => {
  const fakeDeepSeek = await listen(http.createServer(async (req, res) => {
    try {
      assert.strictEqual(req.url, '/v1/chat/completions');
      assert.strictEqual(req.headers.authorization, 'Bearer test-key');
      const body = JSON.parse(await readBody(req));
      modelCalls.push(body);
      const taskName = taskNameFor(body);
      const planIndex = modelPlans.findIndex((plan) => plan.taskName === taskName);
      const plan = planIndex >= 0 ? modelPlans.splice(planIndex, 1)[0] : null;
      if (plan) {
        plan.arrived.resolve();
        if (plan.gate) await plan.gate;
      }
      const payload = plan ? plan.response : defaultModelResponse(taskName, body);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) } }],
        usage: { total_tokens: 321 }
      }));
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
    await runMaterialQuestionRace(baseUrl);
    await runGuidedWritingRace(baseUrl);
    await runRiskyAngleNormalizationCases(baseUrl);
    await runTopicValidationCases(baseUrl);
    await runMaterialQualityCases(baseUrl);
    await runTopicSemanticQualityCase(baseUrl);
    await runMaterialSourceIntegrityCase(baseUrl);
    await runStageResetCases(baseUrl);
    await runAdditionalMaterialBindingCases(baseUrl);

    if (failures.length) {
      throw new Error(`Essay guidance server regression failures:\n- ${failures.join('\n- ')}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => fakeDeepSeek.close(resolve));
    const statePath = path.join(tempDir, 'app-state.json');
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
