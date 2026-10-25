const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'essay-guidance-api-'));
const modelCalls = [];
const angleFirstContractFailures = [];
const topicAnalysisResponses = [];
const materialQuestionResponses = [];

const topicAngles = [
  {
    angleId: 'angle_1',
    title: '考试后的自我整理',
    prompt: '写失利后自己整理错题的变化。',
    whyThisFitsTopic: '主动面对失利能体现成长。',
    materialConnection: '需要补充试卷、整理动作和家人反应。',
    writingPath: '从看到分数写到整理错题，再写态度变化。',
    keyDetailsToAsk: ['看到分数时做了什么？', '整理错题时遇到什么困难？'],
    riskReminder: '不要只写努力的重要性。',
    materialHint: '补试卷、动作和妈妈的话。'
  },
  {
    angleId: 'angle_2',
    title: '承担一次家务',
    prompt: '写从被照顾到主动承担。',
    whyThisFitsTopic: '主动承担家庭责任能具体表现成长。',
    materialConnection: '把第一次独自上台演讲时的坚持，联系到主动承担带来的变化。',
    writingPath: '先写犹豫，再写主动行动，最后用结果证明变化。',
    keyDetailsToAsk: ['你主动承担了哪件事？', '家人当时有什么真实反应？'],
    riskReminder: '不要编造没有发生的家务细节。',
    materialHint: '补地点、动作和感受。'
  },
  {
    angleId: 'angle_3',
    title: '和同学和解',
    prompt: '写一次关系里的反思。',
    whyThisFitsTopic: '愿意反思并修复关系能体现成长。',
    materialConnection: '需要补充冲突、对话和和解后的变化。',
    writingPath: '从冲突写到反思，再写主动沟通。',
    keyDetailsToAsk: ['冲突因为什么发生？', '你主动说了什么？'],
    riskReminder: '不要用空泛道歉替代真实过程。',
    materialHint: '补对话和转折。'
  }
];

const materialQuestionFixture = {
  questionSetId: 'questions_angle_2',
  selectedAngleId: 'angle_2',
  selectedAngle: topicAngles[1],
  questions: [
    {
      questionId: 'q1',
      field: 'trigger',
      category: '触发',
      question: '是什么具体情况让你决定主动承担这件事？',
      purpose: '补清从被照顾到主动承担的触发点。',
      materialAnchor: '第一次独自上台演讲时虽然手抖但坚持讲完',
      detailHints: ['当时看见了什么', '谁在场', '你先做了什么'],
      required: true
    },
    {
      questionId: 'q2',
      field: 'action',
      category: '行动',
      question: '你主动承担时连续做了哪些真实动作？',
      purpose: '用可见动作证明主动承担。',
      materialAnchor: '主动承担一次家务',
      detailHints: ['先后顺序', '手上的动作', '用到的物件'],
      required: true
    },
    {
      questionId: 'q3',
      field: 'difficulty',
      category: '困难',
      question: '过程中最难的一步是什么，你怎样继续做下去？',
      purpose: '补出行动中的阻力和坚持。',
      materialAnchor: '上台演讲时手一直在抖但坚持讲完',
      detailHints: ['困难表现', '身体感受', '解决动作'],
      required: true
    },
    {
      questionId: 'q4',
      field: 'reaction',
      category: '人物反应',
      question: '家人看到后有过什么真实反应或对话？',
      purpose: '用他人反应侧面证明变化。',
      materialAnchor: '从被照顾到主动承担',
      detailHints: ['原话', '表情', '没有对话也可如实说明'],
      required: false
    },
    {
      questionId: 'q5',
      field: 'change_evidence',
      category: '变化证据',
      question: '这件事前后，你对承担责任的做法有什么真实变化？',
      purpose: '形成能支撑立意的前后对比。',
      materialAnchor: '写从被照顾到主动承担',
      detailHints: ['以前怎样做', '这次怎样做', '后来是否再次主动'],
      required: true
    }
  ],
  materialChecklist: [
    { field: 'event', label: '事件', present: true, value: '主动承担一次家务', suggestion: '继续补足具体动作。' },
    { field: 'dialogue', label: '对话', present: false, value: '', suggestion: '如实补充家人的一句话或说明没有对话。' }
  ],
  requiredAnswerCount: 4,
  nextAction: 'answer_questions'
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function queueMaterialQuestionResponse(mutate) {
  const response = cloneJson(materialQuestionFixture);
  mutate(response);
  materialQuestionResponses.push(response);
}

function checkAngleFirstContract(regressionName, assertion) {
  try {
    assertion();
  } catch (error) {
    angleFirstContractFailures.push(`${regressionName}: ${error.message}`);
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

function modelJsonFor(body) {
  const promptText = body.messages?.[1]?.content || '';
  if (promptText.includes('题目理解')) {
    return topicAnalysisResponses.shift() || {
      topicKeywords: ['那一刻', '长大'],
      coreQuestion: '那一刻真正要写的是一次真实变化，而不是一句成长口号。',
      possibleAngles: topicAngles,
      riskyAngles: [{ title: '只写大道理', reason: '容易空泛和模板化。' }],
      suggestedNextQuestions: ['这件事发生在什么时候？', '当时你身边有谁？']
    };
  }
  if (promptText.includes('素材追问')) {
    return materialQuestionResponses.shift() || materialQuestionFixture;
  }
  if (promptText.includes('生成作文提纲')) {
    return {
      outlines: [
        {
          outlineId: 'outline_1',
          title: '画面切入式',
          structure: '记叙文',
          paragraphs: [
            { role: '开头', instruction: '从试卷摊开在桌上的画面写起。' },
            { role: '经过', instruction: '重点写自己抄错题和写原因的动作。' }
          ]
        },
        {
          outlineId: 'outline_2',
          title: '前后对比式',
          structure: '记叙文',
          paragraphs: [
            { role: '之前', instruction: '写原来只等别人安慰。' },
            { role: '之后', instruction: '写开始自己处理问题。' }
          ]
        }
      ],
      recommendedOutlineId: 'outline_1',
      warnings: ['不要生成整篇作文，先确认素材真实。']
    };
  }
  if (promptText.includes('作文体检')) {
    return {
      overallComment: '这篇作文中心能看出来，但素材太概括，需要先补动作和场景。',
      dimensionScores: {
        topicFit: { key: 'topicFit', name: '审题贴合度', score: 72, level: '可提升', evidence: '回应了成长', suggestion: '回扣那一刻。' },
        materialSpecificity: { key: 'materialSpecificity', name: '素材具体度', score: 48, level: '优先修改', evidence: '缺少动作', suggestion: '补具体动作。' }
      },
      priorityIssues: [{ issueId: 'issue_1', dimension: 'materialSpecificity', title: '素材具体度需要优先提升', severity: 'high', explanation: '缺少动作和场景', suggestion: '补一个动作', relatedSegmentId: 'segment_1' }],
      highlightedSegments: [{ segmentId: 'segment_1', text: '成长是一束光。', issueType: '空泛表达', reason: '像模板', suggestion: '换成真实画面。' }],
      suggestedRevisionPath: ['先补动作', '再改结尾']
    };
  }
  if (promptText.includes('局部修改建议')) {
    return {
      issueExplanation: '这句话像万能开头，缺少真实画面。',
      revisionStrategy: '保留考试失利后的核心经历，可以补充合理的动作与身体感受，并请学生核对细节。',
      exampleRevision: '看到分数时，我的指尖把试卷边角捏出一道褶皱，胸口闷闷的。',
      studentAction: '请核对补充细节是否符合真实经历，再用自己的话改写。',
      revisionGoal: '把空泛表达改具体'
    };
  }
  if (promptText.includes('单篇作文复盘')) {
    return {
      summary: '本次主要学会先补事实再改表达。',
      learnedSkills: ['素材具体度', '修改复盘能力'],
      recurringIssues: ['空泛开头'],
      suggestedTrainingFocus: ['素材具体度'],
      studentSelfReflection: '我发现写清楚动作比喊口号更有用。',
      finalTextLength: 42
    };
  }
  if (promptText.includes('文风档案生成')) {
    return {
      summary: '这份样本更擅长写真实经历，但常把感受概括成口号。',
      traits: ['真实经历', '句子偏短', '结尾容易概括'],
      strengths: ['能写清事件顺序'],
      habits: ['喜欢用总结句收尾'],
      commonIssues: ['细节动作偏少'],
      suggestions: ['每段补一个可看见的动作']
    };
  }
  if (promptText.includes('短期写作引导：生成提纲树')) {
    return {
      outlineTree: {
        title: '那一刻，我长大了',
        theme: '从被动难过到主动整理问题',
        children: [
          { nodeId: 'p1', role: '开头', label: '试卷摊开在书桌上的画面', focus: '用画面进入事件', children: [] },
          {
            nodeId: 'body',
            role: '主体',
            label: '整理错题的过程',
            focus: '写动作和变化',
            children: [
              { nodeId: 'p2', role: '起因', label: '看到分数后的反应', focus: '真实情绪', children: [] },
              { nodeId: 'p3', role: '经过', label: '重新抄错题并写原因', focus: '具体动作', children: [] }
            ]
          },
          { nodeId: 'p4', role: '结尾', label: '回到自己主动面对问题', focus: '自然点题', children: [] }
        ]
      }
    };
  }
  if (promptText.includes('短期写作引导：生成段落写作提示')) {
    return {
      paragraphGuides: [
        {
          paragraphId: 'p1',
          role: '开头',
          goal: '用一个真实画面进入事件，不先讲大道理。',
          mustInclude: ['试卷', '书桌', '手上的动作'],
          writingPrompts: ['你第一眼看到卷子时，手正在做什么？'],
          starterHint: '可以从“卷子摊在书桌上”这样的画面开始。',
          avoid: ['不要写成长是一束光', '不要直接喊口号'],
          suggestedLength: '80-120字'
        },
        {
          paragraphId: 'p3',
          role: '经过',
          goal: '写清楚自己怎样一步一步处理错题。',
          mustInclude: ['错题本', '写原因', '妈妈的动作'],
          writingPrompts: ['你抄第一道错题时，哪里最不想面对？'],
          starterHint: '按动作顺序写，不要直接总结努力很重要。',
          avoid: ['不要新增没有发生的对话'],
          suggestedLength: '160-220字'
        }
      ],
      missingMaterialQuestions: [],
      nextAction: 'write_paragraph_1',
      studentTask: '先写第1段，只写试卷和书桌这个真实画面。'
    };
  }
  if (promptText.includes('交互式写作引导')) {
    return {
      outlineTree: {
        title: '那一刻，我长大了',
        theme: '从被动难过到主动整理问题',
        children: [
          { nodeId: 'p1', role: '开头', label: '试卷摊开在书桌上的画面', focus: '用画面进入事件', children: [] },
          { nodeId: 'p4', role: '结尾', label: '回到自己主动面对问题', focus: '自然点题', children: [] }
        ]
      },
      paragraphGuides: [
        {
          paragraphId: 'p1',
          role: '开头',
          goal: '用一个真实画面进入事件，不先讲大道理。',
          mustInclude: ['试卷', '书桌', '手上的动作'],
          writingPrompts: ['你第一眼看到卷子时，手正在做什么？'],
          starterHint: '可以从“卷子摊在书桌上”这样的画面开始。',
          avoid: ['不要写成长是一束光', '不要直接喊口号'],
          suggestedLength: '80-120字'
        }
      ],
      missingMaterialQuestions: [],
      nextAction: 'write_paragraph_1',
      studentTask: '先写第1段，只写试卷和书桌这个真实画面。'
    };
  }
  return {};
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
    assert.strictEqual(req.url, '/v1/chat/completions');
    assert.strictEqual(req.headers.authorization, 'Bearer test-key');
    const body = JSON.parse(await readBody(req));
    modelCalls.push(body);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(modelJsonFor(body)) } }],
      usage: { total_tokens: 321 }
    }));
  }));

  process.env.APP_DATA_DIR = tempDir;
  process.env.AI_API_BASE_URL = `http://127.0.0.1:${fakeDeepSeek.address().port}/v1`;
  process.env.AI_API_KEY = 'test-key';
  process.env.PORT = '0';

  const app = require('../server');
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const create = await request(baseUrl, 'POST', '/api/v1/essay-sessions', {
      mode: 'brainstorm',
      title: '那一刻，我长大了',
      genre: '记叙文',
      grade: '初二',
      initialMaterial: '我第一次独自上台演讲，手一直在抖，但最后坚持讲完。',
      draftText: ''
    });
    assert.strictEqual(create.status, 200);
    assert.strictEqual(create.json.success, true);
    assert.ok(create.json.requestId);
    assert.ok(create.json.data.sessionId);
    assert.strictEqual(create.json.data.session.initialMaterial, '我第一次独自上台演讲，手一直在抖，但最后坚持讲完。');
    assert.strictEqual(create.json.data.nextStep, 'topic_analysis');
    assert.ok(Array.isArray(create.json.data.initialQuestions));
    assert.ok(create.json.data.initialQuestions.length >= 3);

    const sessionId = create.json.data.sessionId;

    const topic = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/topic-analysis`, {
      title: '那一刻，我长大了',
      genre: '记叙文',
      grade: '初二',
      target: '日常练习'
    });
    assert.strictEqual(topic.status, 200);
    assert.strictEqual(topic.json.success, true);
    assert.ok(topic.json.data.coreQuestion.includes('真实变化'));
    assert.ok(topic.json.data.possibleAngles.length >= 3);
    const topicPrompt = JSON.parse(modelCalls[0].messages[1].content);
    assert.strictEqual(topicPrompt.taskName, '题目理解与立意建议');
    assert.ok(
      String(topicPrompt.input.initialMaterial || topicPrompt.input.existingMaterials || '').includes('独自上台演讲'),
      'topic analysis model input should include initial material from the brainstorm form'
    );

    const callsBeforeMissingAngle = modelCalls.length;
    const missingAngle = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/material-questions`, {});
    checkAngleFirstContract('missing selectedAngleId must be rejected before model invocation', () => {
      assert.strictEqual(missingAngle.status, 400);
      assert.strictEqual(missingAngle.json.failureCode, 'ANGLE_REQUIRED');
    });
    checkAngleFirstContract('missing selectedAngleId must not invoke DeepSeek', () => {
      assert.strictEqual(modelCalls.length, callsBeforeMissingAngle, 'missing angle request should not add a model call');
    });

    const callsBeforeUnknownAngle = modelCalls.length;
    const unknownAngle = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/material-questions`, {
      selectedAngleId: 'angle_not_in_this_session'
    });
    checkAngleFirstContract('unknown selectedAngleId must be rejected before model invocation', () => {
      assert.strictEqual(unknownAngle.status, 400);
      assert.strictEqual(unknownAngle.json.failureCode, 'ANGLE_NOT_FOUND');
    });
    checkAngleFirstContract('unknown selectedAngleId must not invoke DeepSeek', () => {
      assert.strictEqual(modelCalls.length, callsBeforeUnknownAngle, 'unknown angle request should not add a model call');
    });

    const chosenAngle = topic.json.data.possibleAngles[1];
    const material = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/material-questions`, {
      selectedAngleId: chosenAngle.angleId
    });
    assert.strictEqual(material.status, 200);
    assert.strictEqual(material.json.success, true);
    checkAngleFirstContract('valid material questions must stay bound to the chosen second angle', () => {
      assert.ok(material.json.data.questionSetId, 'response should include questionSetId');
      assert.strictEqual(material.json.data.selectedAngleId, chosenAngle.angleId);
      assert.deepStrictEqual(material.json.data.selectedAngle, chosenAngle);
      assert.ok(material.json.data.questions.length >= 5 && material.json.data.questions.length <= 7, 'response should include 5-7 questions');
      assert.ok(Number.isInteger(material.json.data.requiredAnswerCount), 'response should include requiredAnswerCount');
      assert.ok(material.json.data.requiredAnswerCount > 0, 'requiredAnswerCount should require at least one answer');
      for (const question of material.json.data.questions) {
        for (const field of ['questionId', 'field', 'category', 'question', 'purpose', 'materialAnchor', 'detailHints', 'required']) {
          assert.ok(Object.prototype.hasOwnProperty.call(question, field), `question should include ${field}`);
        }
        assert.ok(Array.isArray(question.detailHints) && question.detailHints.length >= 2, 'question detailHints should be actionable');
        assert.strictEqual(typeof question.required, 'boolean', 'question required should be boolean');
      }
    });

    const materialPromptCalls = modelCalls
      .map((call) => JSON.parse(call.messages[1].content))
      .filter((prompt) => prompt.taskName === '素材追问');
    const validMaterialPrompt = materialPromptCalls[materialPromptCalls.length - 1];
    checkAngleFirstContract('material-question model input must contain the complete chosen angle and session initial material', () => {
      assert.ok(validMaterialPrompt, 'valid request should invoke the material-question model');
      assert.strictEqual(validMaterialPrompt.input.selectedAngleId, chosenAngle.angleId);
      assert.deepStrictEqual(validMaterialPrompt.input.selectedAngle, chosenAngle);
      assert.notStrictEqual(validMaterialPrompt.input.selectedAngleId, topic.json.data.possibleAngles[0].angleId);
      assert.ok(
        JSON.stringify(validMaterialPrompt.input).includes('我第一次独自上台演讲，手一直在抖，但最后坚持讲完。'),
        'model input should include the session initial material without requiring the client to resend it'
      );
    });

    const guidedWritingBase = {
      selectedAngleId: chosenAngle.angleId,
      materialAnswers: [
        { questionId: 'q1', answer: '妈妈发烧的那天晚上，我看见她连站起来都很吃力。' },
        { questionId: 'q2', answer: '我先量米、淘米，再守在锅边搅动，最后把粥端到桌上。' },
        { questionId: 'q3', answer: '最难的是控制火候，我把火调小后继续守着锅。' },
        { questionId: 'q4', answer: '   ' },
        { questionId: 'q5', answer: '以前我等家人安排，这次我主动把事情一件件做完。' },
        { questionId: 'q_not_in_current_set', answer: '这个答案不应进入模型输入。' }
      ],
      extraMaterial: '我把锅盖掀开一条缝，看着米粒在里面翻滚。',
      preferredStructure: '记叙文'
    };

    const callsBeforeMissingQuestionSet = modelCalls.length;
    const missingQuestionSet = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/guided-writing`, {
      ...guidedWritingBase
    });
    checkAngleFirstContract('guided writing must require the current questionSetId before model invocation', () => {
      assert.strictEqual(missingQuestionSet.status, 400);
      assert.strictEqual(missingQuestionSet.json.failureCode, 'QUESTION_SET_REQUIRED');
    });
    checkAngleFirstContract('missing questionSetId must not invoke either guided-writing model call', () => {
      assert.strictEqual(modelCalls.length, callsBeforeMissingQuestionSet, 'missing questionSetId should not add a model call');
    });

    const callsBeforeStaleQuestionSet = modelCalls.length;
    const staleQuestionSet = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/guided-writing`, {
      ...guidedWritingBase,
      questionSetId: 'questions_stale'
    });
    checkAngleFirstContract('guided writing must reject an unknown or stale questionSetId before model invocation', () => {
      assert.strictEqual(staleQuestionSet.status, 400);
      assert.strictEqual(staleQuestionSet.json.failureCode, 'QUESTION_SET_MISMATCH');
    });
    checkAngleFirstContract('stale questionSetId must not invoke either guided-writing model call', () => {
      assert.strictEqual(modelCalls.length, callsBeforeStaleQuestionSet, 'stale questionSetId should not add a model call');
    });

    const callsBeforeAngleMismatch = modelCalls.length;
    const angleMismatch = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/guided-writing`, {
      ...guidedWritingBase,
      questionSetId: material.json.data.questionSetId,
      selectedAngleId: topic.json.data.possibleAngles[0].angleId,
      additionalMaterial: '补充素材必须随当前立意与题组一起校验。'
    });
    checkAngleFirstContract('guided writing must reject an angle outside the current question set before model invocation', () => {
      assert.strictEqual(angleMismatch.status, 400);
      assert.strictEqual(angleMismatch.json.failureCode, 'ANGLE_MISMATCH');
    });
    checkAngleFirstContract('angle mismatch must not invoke either guided-writing model call', () => {
      assert.strictEqual(modelCalls.length, callsBeforeAngleMismatch, 'angle mismatch should not add a model call');
    });

    const callsBeforeIncompleteAnswers = modelCalls.length;
    const incompleteAnswers = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/guided-writing`, {
      ...guidedWritingBase,
      questionSetId: material.json.data.questionSetId,
      additionalMaterial: '补充素材不能绕过必答问题校验。',
      materialAnswers: [
        { questionId: 'q1', answer: '只回答一道已知问题。' },
        { questionId: 'q2', answer: '   ' },
        { questionId: 'q3', answer: '' },
        { questionId: 'q_not_in_current_set', answer: '未知问题不能计入完成数。' }
      ]
    });
    checkAngleFirstContract('guided writing must ignore empty and unknown answers when enforcing requiredAnswerCount', () => {
      assert.strictEqual(incompleteAnswers.status, 400);
      assert.strictEqual(incompleteAnswers.json.failureCode, 'MATERIAL_ANSWERS_INCOMPLETE');
    });
    checkAngleFirstContract('incomplete known non-empty answers must not invoke either guided-writing model call', () => {
      assert.strictEqual(modelCalls.length, callsBeforeIncompleteAnswers, 'incomplete answers should not add a model call');
    });

    const callsBeforeEmptyAdditionalMaterial = modelCalls.length;
    const emptyAdditionalMaterial = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/guided-writing`, {
      ...guidedWritingBase,
      questionSetId: material.json.data.questionSetId,
      additionalMaterial: '   '
    });
    checkAngleFirstContract('an explicitly submitted empty additionalMaterial must be rejected', () => {
      assert.strictEqual(emptyAdditionalMaterial.status, 400);
      assert.strictEqual(emptyAdditionalMaterial.json.failureCode, 'ADDITIONAL_MATERIAL_REQUIRED');
    });
    checkAngleFirstContract('empty additionalMaterial must not invoke either guided-writing model call', () => {
      assert.strictEqual(modelCalls.length, callsBeforeEmptyAdditionalMaterial, 'empty additionalMaterial should not add model calls');
    });

    queueMaterialQuestionResponse((response) => {
      response.questions[0].question = { text: response.questions[0].question };
    });
    const objectQuestionText = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/material-questions`, {
      selectedAngleId: chosenAngle.angleId
    });
    checkAngleFirstContract('object values in material-question string fields must be rejected', () => {
      assert.strictEqual(objectQuestionText.status, 502);
      assert.strictEqual(objectQuestionText.json.failureCode, 'MATERIAL_QUESTIONS_INVALID');
    });

    const outline = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/outline`, {
      selectedAngle: topic.json.data.possibleAngles[0].title,
      materials: [{
        event: '一次考试失利后自己整理错题',
        people: ['我', '妈妈'],
        actions: ['把错题重新抄到本子上', '给每道题写原因']
      }]
    });
    assert.strictEqual(outline.status, 200);
    assert.strictEqual(outline.json.success, true);
    assert.ok(outline.json.data.outlines.length >= 2);

    const additionalMaterialText = '補充：我在演講前把講稿折了兩次，手心的汗把紙角浸濕。';
    const callsBeforeValidGuidedWriting = modelCalls.length;
    const guided = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/guided-writing`, {
      ...guidedWritingBase,
      questionSetId: material.json.data.questionSetId,
      additionalMaterial: additionalMaterialText
    });
    assert.strictEqual(guided.status, 200);
    assert.strictEqual(guided.json.success, true);
    assert.ok(guided.json.data.guideId);
    assert.strictEqual(guided.json.data.outlineTree.theme, '从被动难过到主动整理问题');
    assert.ok(Array.isArray(guided.json.data.outlineTree.children));
    assert.ok(guided.json.data.outlineTree.children.length >= 2);
    assert.ok(Array.isArray(guided.json.data.paragraphGuides));
    assert.ok(guided.json.data.paragraphGuides[0].mustInclude.includes('试卷'));
    assert.strictEqual(guided.json.data.nextAction, 'write_paragraph_1');

    const validGuidedPrompts = modelCalls
      .slice(callsBeforeValidGuidedWriting)
      .map((call) => JSON.parse(call.messages[1].content));
    checkAngleFirstContract('valid guided writing must preserve the two-call order', () => {
      assert.strictEqual(validGuidedPrompts.length, 2);
      assert.strictEqual(validGuidedPrompts[0].taskName, '短期写作引导：生成提纲树');
      assert.strictEqual(validGuidedPrompts[1].taskName, '短期写作引导：生成段落写作提示');
    });
    for (const prompt of validGuidedPrompts) {
      checkAngleFirstContract(`${prompt.taskName} must use the current question set`, () => {
        assert.strictEqual(prompt.input.questionSetId, material.json.data.questionSetId);
      });
      checkAngleFirstContract(`${prompt.taskName} must use the full current angle from the session`, () => {
        assert.strictEqual(prompt.input.selectedAngleId, chosenAngle.angleId);
        assert.deepStrictEqual(prompt.input.selectedAngle, chosenAngle);
      });
      checkAngleFirstContract(`${prompt.taskName} must use the session initial material`, () => {
        assert.strictEqual(prompt.input.initialMaterial, '我第一次独自上台演讲，手一直在抖，但最后坚持讲完。');
      });
      checkAngleFirstContract(`${prompt.taskName} must include additionalMaterial as a writing-guide fact source`, () => {
        assert.ok(
          Array.isArray(prompt.input.factSources)
            && prompt.input.factSources.some((source) => String(source.content || '').includes(additionalMaterialText)),
          'additionalMaterial was not included in factSources'
        );
      });
      checkAngleFirstContract(`${prompt.taskName} must keep only known non-empty answers`, () => {
        assert.deepStrictEqual(
          prompt.input.materialAnswers.map((answer) => answer.questionId),
          ['q1', 'q2', 'q3', 'q5']
        );
        assert.ok(prompt.input.materialAnswers.every((answer) => typeof answer.answer === 'string' && answer.answer.trim()));
        for (const answer of prompt.input.materialAnswers) {
          const question = material.json.data.questions.find((item) => item.questionId === answer.questionId);
          assert.ok(question, `answer ${answer.questionId} should belong to the current question set`);
          assert.strictEqual(answer.field, question.field);
          assert.strictEqual(answer.question, question.question);
        }
      });
    }
    const sessionAfterAdditionalMaterial = await request(baseUrl, 'GET', `/api/v1/essay-sessions/${sessionId}`);
    checkAngleFirstContract('additionalMaterial must be persisted on the current essay session', () => {
      assert.strictEqual(sessionAfterAdditionalMaterial.json.data.additionalMaterial, additionalMaterialText);
    });

    const invariantSession = await request(baseUrl, 'POST', '/api/v1/essay-sessions', {
      mode: 'brainstorm',
      title: '那一刻，我长大了',
      genre: '记叙文',
      grade: '初二',
      initialMaterial: '妈妈发烧那天，我第一次独自煮粥并整理好第二天比赛要用的书包。',
      draftText: ''
    });
    assert.strictEqual(invariantSession.status, 200);
    const invariantSessionId = invariantSession.json.data.sessionId;
    const invariantTopic = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${invariantSessionId}/topic-analysis`, {
      title: '那一刻，我长大了',
      genre: '记叙文',
      grade: '初二',
      target: '日常练习'
    });
    assert.strictEqual(invariantTopic.status, 200);
    const invariantAngle = invariantTopic.json.data.possibleAngles[1];

    queueMaterialQuestionResponse((response) => {
      response.questionSetId = 'model_reused_question_set_id';
    });
    const firstInvariantQuestions = await request(
      baseUrl,
      'POST',
      `/api/v1/essay-sessions/${invariantSessionId}/material-questions`,
      { selectedAngleId: invariantAngle.angleId }
    );
    assert.strictEqual(firstInvariantQuestions.status, 200);

    queueMaterialQuestionResponse((response) => {
      response.questionSetId = 'model_reused_question_set_id';
    });
    const secondInvariantQuestions = await request(
      baseUrl,
      'POST',
      `/api/v1/essay-sessions/${invariantSessionId}/material-questions`,
      { selectedAngleId: invariantAngle.angleId }
    );
    assert.strictEqual(secondInvariantQuestions.status, 200);
    checkAngleFirstContract('server must replace a reused model questionSetId with a fresh non-empty ID for every generation', () => {
      assert.ok(firstInvariantQuestions.json.data.questionSetId, 'first generated question set should have a server ID');
      assert.ok(secondInvariantQuestions.json.data.questionSetId, 'second generated question set should have a server ID');
      assert.notStrictEqual(
        firstInvariantQuestions.json.data.questionSetId,
        secondInvariantQuestions.json.data.questionSetId,
        'two generations must not share an ID even when the model repeats its questionSetId'
      );
      assert.notStrictEqual(firstInvariantQuestions.json.data.questionSetId, 'model_reused_question_set_id');
      assert.notStrictEqual(secondInvariantQuestions.json.data.questionSetId, 'model_reused_question_set_id');
    });

    const invariantCompleteAnswers = materialQuestionFixture.questions
      .filter((question) => question.required)
      .map((question) => ({ questionId: question.questionId, answer: `这是 ${question.questionId} 的真实细节回答。` }));
    const callsBeforeSupersededQuestionSet = modelCalls.length;
    const supersededQuestionSet = await request(
      baseUrl,
      'POST',
      `/api/v1/essay-sessions/${invariantSessionId}/guided-writing`,
      {
        questionSetId: firstInvariantQuestions.json.data.questionSetId,
        selectedAngleId: invariantAngle.angleId,
        materialAnswers: invariantCompleteAnswers,
        preferredStructure: '记叙文'
      }
    );
    checkAngleFirstContract('a superseded question set ID must be rejected after material questions are regenerated', () => {
      assert.strictEqual(supersededQuestionSet.status, 400);
      assert.strictEqual(supersededQuestionSet.json.failureCode, 'QUESTION_SET_MISMATCH');
    });
    checkAngleFirstContract('a superseded question set ID must be rejected before guided-writing model invocation', () => {
      assert.strictEqual(modelCalls.length, callsBeforeSupersededQuestionSet, 'superseded question set should not add model calls');
    });

    queueMaterialQuestionResponse((response) => {
      response.questionSetId = 'model_required_count_bypass';
      response.questions.forEach((question) => {
        question.required = true;
      });
      response.requiredAnswerCount = 1;
    });
    const allRequiredQuestions = await request(
      baseUrl,
      'POST',
      `/api/v1/essay-sessions/${invariantSessionId}/material-questions`,
      { selectedAngleId: invariantAngle.angleId }
    );
    assert.strictEqual(allRequiredQuestions.status, 200);
    const requiredQuestions = allRequiredQuestions.json.data.questions.filter((question) => question.required);
    checkAngleFirstContract('requiredAnswerCount must equal the actual number of required questions', () => {
      assert.strictEqual(allRequiredQuestions.json.data.requiredAnswerCount, requiredQuestions.length);
    });

    const callsBeforeRequiredBypass = modelCalls.length;
    const requiredBypass = await request(
      baseUrl,
      'POST',
      `/api/v1/essay-sessions/${invariantSessionId}/guided-writing`,
      {
        questionSetId: allRequiredQuestions.json.data.questionSetId,
        selectedAngleId: invariantAngle.angleId,
        materialAnswers: [
          { questionId: requiredQuestions[0].questionId, answer: '只回答第一道必答题，其他必答题故意留空。' }
        ],
        preferredStructure: '记叙文'
      }
    );
    checkAngleFirstContract('guided writing must reject a request unless every required question ID is answered', () => {
      assert.strictEqual(requiredBypass.status, 400);
      assert.strictEqual(requiredBypass.json.failureCode, 'MATERIAL_ANSWERS_INCOMPLETE');
    });
    checkAngleFirstContract('missing any required answer must block guided-writing model invocation', () => {
      assert.strictEqual(modelCalls.length, callsBeforeRequiredBypass, 'required-answer bypass should not add model calls');
    });

    const diagnose = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/diagnose`, {
      title: '那一刻，我长大了',
      genre: '记叙文',
      grade: '初二',
      userGoal: '变具体',
      draftText: '成长是一束光，照亮我前行的路。那一次考试后，我明白了努力的重要性。从那以后，我会更加努力，做更好的自己。'
    });
    assert.strictEqual(diagnose.status, 200);
    assert.strictEqual(diagnose.json.success, true);
    assert.ok(diagnose.json.data.diagnosticId);
    assert.ok(diagnose.json.data.dimensionScores.materialSpecificity);
    assert.ok(diagnose.json.data.priorityIssues.length >= 1);
    assert.ok(diagnose.json.data.highlightedSegments.length >= 1);

    const diagnosticId = diagnose.json.data.diagnosticId;
    const segmentId = diagnose.json.data.highlightedSegments[0].segmentId;

    const revise = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/revision-suggestions`, {
      diagnosticId,
      segmentId,
      revisionGoal: '把空泛表达改具体'
    });
    assert.strictEqual(revise.status, 200);
    assert.strictEqual(revise.json.success, true);
    assert.ok(revise.json.data.studentAction.includes('自己'));
    assert.ok(revise.json.data.exampleRevision);
    assert.match(revise.json.data.exampleRevision, /指尖|边角|胸口/);
    assert.match(revise.json.data.studentAction, /请核对补充细节/);
    const revisionModelRequest = modelCalls[modelCalls.length - 1];
    const revisionPromptText = revisionModelRequest.messages.map((message) => String(message.content || '')).join('\n');
    checkAngleFirstContract('local revision prompt must permit reasonable added description', () => {
      assert.ok(/允许.{0,30}合理.{0,20}描写|可以.{0,30}合理.{0,20}描写/.test(revisionPromptText), 'prompt does not permit reasonable added description');
    });
    checkAngleFirstContract('local revision prompt must not prohibit every added detail', () => {
      assert.ok(!/不得新增.{0,20}(人物|细节)|不编造细节|只能使用原文事实/.test(revisionPromptText), 'prompt still prohibits all added details');
    });
    checkAngleFirstContract('local revision prompt must label and ask students to verify added details', () => {
      assert.ok(/addedDetails/.test(revisionPromptText), 'prompt output contract does not require addedDetails');
    });
    checkAngleFirstContract('local revision prompt must ask students to verify added details', () => {
      assert.ok(/核实|核对/.test(revisionPromptText), 'prompt does not ask the student to verify added details');
    });
    const appSource = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
    const revisionCall = appSource.match(/getRevisionSuggestions\(sessionId,\s*\{([\s\S]*?)\}\s*\)/);
    checkAngleFirstContract('ordinary revision UI must not enable strict fact mode', () => {
      assert.ok(revisionCall, 'ordinary revision UI must call the revision-suggestions API');
      assert.doesNotMatch(revisionCall[1], /keepFactsStrict\s*:\s*true/);
    });
    checkAngleFirstContract('offline revision demo must disclose possible added descriptions', () => {
      assert.ok(/示范补充环境、动作和感受等描写/.test(appSource), 'offline demo is missing the added-description notice');
    });
    checkAngleFirstContract('offline revision demo must ask students to verify added details', () => {
      assert.ok(/新增细节请按真实情况核对/.test(appSource), 'offline demo is missing the verification reminder');
    });
    checkAngleFirstContract('offline revision demo must not claim it never adds experience details', () => {
      assert.ok(!/不替学生编新经历/.test(appSource), 'offline demo still claims it never adds experience details');
    });

    const reflection = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/reflection`, {
      diagnosticId,
      finalText: '那次数学考试后，我把卷子摊在书桌上，把错题重新抄到本子上，并在旁边写下原因。',
      completedActions: ['补充具体动作', '删掉空泛结尾'],
      studentSelfReflection: '我发现写清楚动作比喊口号更有用。'
    });
    assert.strictEqual(reflection.status, 200);
    assert.strictEqual(reflection.json.success, true);
    assert.ok(reflection.json.data.learnedSkills.includes('素材具体度'));
    assert.ok(reflection.json.data.suggestedTrainingFocus.length >= 1);

    const styleProfile = await request(baseUrl, 'POST', '/api/v1/style-profile', {
      writingSamples: '那次考试后，我把卷子摊在书桌上，一道题一道题重新看。妈妈没有批评我，只是把台灯往我这边推了推。我忽然觉得，长大不是喊一句口号，而是自己愿意把问题弄明白。'
    });
    assert.strictEqual(styleProfile.status, 200);
    assert.strictEqual(styleProfile.json.success, true);
    assert.ok(styleProfile.json.data.profileId);
    assert.strictEqual(styleProfile.json.data.summary, '这份样本更擅长写真实经历，但常把感受概括成口号。');
    assert.ok(styleProfile.json.data.traits.includes('真实经历'));

    const ability = await request(baseUrl, 'POST', '/api/v1/ability/initial-assessment', {
      userId: 'demo',
      grade: '初二',
      target: '日常提升',
      title: '那一刻，我长大了',
      genre: '记叙文',
      sampleEssay: '那一次考试后，我明白了努力的重要性。从那以后，我会更加努力。'
    });
    assert.strictEqual(ability.status, 200);
    assert.strictEqual(ability.json.success, true);
    assert.ok(ability.json.data.profileId);
    assert.ok(ability.json.data.dimensionScores.detailAbility);

    const today = await request(baseUrl, 'GET', '/api/v1/training-tasks/today');
    assert.strictEqual(today.status, 200);
    assert.strictEqual(today.json.success, true);
    assert.ok(Array.isArray(today.json.data.tasks));

    const taskNames = modelCalls.map((call) => JSON.parse(call.messages[1].content).taskName);
    assert.ok(taskNames.includes('短期写作引导：生成提纲树'), 'guided writing should split outline generation into a dedicated model task');
    assert.ok(taskNames.includes('短期写作引导：生成段落写作提示'), 'guided writing should split paragraph guide generation into a dedicated model task');
    if (angleFirstContractFailures.length) {
      throw new Error(`Angle-first API contract failures:\n- ${angleFirstContractFailures.join('\n- ')}`);
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
