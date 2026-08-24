const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'essay-guidance-api-'));
const modelCalls = [];

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
    return {
      topicKeywords: ['那一刻', '长大'],
      coreQuestion: '那一刻真正要写的是一次真实变化，而不是一句成长口号。',
      possibleAngles: [
        { angleId: 'angle_1', title: '考试后的自我整理', prompt: '写失利后自己整理错题的变化。', materialHint: '补试卷、动作和妈妈的话。' },
        { angleId: 'angle_2', title: '承担一次家务', prompt: '写从被照顾到主动承担。', materialHint: '补地点、动作和感受。' },
        { angleId: 'angle_3', title: '和同学和解', prompt: '写一次关系里的反思。', materialHint: '补对话和转折。' }
      ],
      riskyAngles: [{ title: '只写大道理', reason: '容易空泛和模板化。' }],
      suggestedNextQuestions: ['这件事发生在什么时候？', '当时你身边有谁？']
    };
  }
  if (promptText.includes('素材追问')) {
    return {
      questions: [{ field: 'dialogue', question: '有没有一句真实对话可以写进去？', purpose: '补齐对话，避免编造。' }],
      materialChecklist: [
        { field: 'event', label: '事件', present: true, value: '一次考试失利后自己整理错题', suggestion: '已有事件。' },
        { field: 'dialogue', label: '对话', present: false, value: '', suggestion: '补一句真实对话。' }
      ],
      nextAction: 'continue_questions',
      selectedAngle: '考试后的自我整理'
    };
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
      revisionStrategy: '保留原有事实，不新增人物和地点，先让学生补一个真实动作。',
      exampleRevision: '可以把抽象句换成试卷摊在桌上的局部画面。',
      studentAction: '请学生自己确认这个动作是否真实发生。',
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
  if (promptText.includes('交互式写作引导')) {
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
      draftText: ''
    });
    assert.strictEqual(create.status, 200);
    assert.strictEqual(create.json.success, true);
    assert.ok(create.json.requestId);
    assert.ok(create.json.data.sessionId);
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

    const material = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/material-questions`, {
      selectedAngle: topic.json.data.possibleAngles[0].title,
      existingMaterials: { people: ['我', '妈妈'], event: '一次考试失利后自己整理错题' },
      missingFields: ['dialogue', 'sensoryDetails']
    });
    assert.strictEqual(material.status, 200);
    assert.strictEqual(material.json.success, true);
    assert.ok(material.json.data.materialChecklist.some((item) => item.field === 'dialogue'));

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

    const guided = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/guided-writing`, {
      selectedAngleId: topic.json.data.possibleAngles[0].angleId,
      selectedAngle: topic.json.data.possibleAngles[0].title,
      materialAnswers: [
        { field: 'event', question: '这件事发生在什么时候？', answer: '期中考试后，数学卷子发下来那天晚上' },
        { field: 'dialogue', question: '有没有一句真实对话？', answer: '妈妈说：先把错在哪里找出来。' }
      ],
      extraMaterial: '我把卷子摊在书桌上，把错题重新抄到本子上。',
      preferredStructure: '记叙文'
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
      revisionGoal: '把空泛表达改具体',
      keepFactsStrict: true
    });
    assert.strictEqual(revise.status, 200);
    assert.strictEqual(revise.json.success, true);
    assert.ok(revise.json.data.studentAction.includes('自己'));
    assert.ok(revise.json.data.exampleRevision);

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

    assert.strictEqual(modelCalls.length, 8);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => fakeDeepSeek.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
