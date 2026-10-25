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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-writing-split-'));
  const modelCalls = [];
  const upstream = http.createServer(async (req, res) => {
    assert.strictEqual(req.method, 'POST');
    assert.strictEqual(req.url, '/v1/chat/completions');
    const body = JSON.parse(await readBody(req));
    const prompt = JSON.parse(body.messages[1].content);
    modelCalls.push(prompt);

    let payload;
    if (prompt.taskName.includes('题目理解')) {
      payload = {
        topicKeywords: ['长大', '责任'],
        coreQuestion: '写出从被照顾到主动照顾妈妈的变化。',
        possibleAngles: [
          {
            angleId: 'angle_1',
            title: '一碗粥里的责任',
            prompt: '围绕煮粥和整理书包写成长。',
            whyThisFitsTopic: '能表现那一刻的变化。',
            materialConnection: '直接使用妈妈发烧、朗读比赛、煮粥、书包。',
            writingPath: '先写妈妈发烧，再写自己行动，最后点出责任。',
            keyDetailsToAsk: ['粥是什么样子', '书包里放了什么'],
            riskReminder: '不要写空泛道理。',
            materialHint: '补厨房动作和妈妈状态。'
          },
          {
            angleId: 'angle_2',
            title: '书包里的细心',
            prompt: '写第一次替妈妈提前整理。',
            whyThisFitsTopic: '细心动作能扣住成长。',
            materialConnection: '使用朗读稿、水杯、书包。',
            writingPath: '由依赖到体谅。',
            keyDetailsToAsk: ['整理了哪些东西'],
            riskReminder: '不要泛泛写懂事。',
            materialHint: '补具体物件。'
          },
          {
            angleId: 'angle_3',
            title: '发现妈妈也会累',
            prompt: '写看见妈妈发烧后的心理变化。',
            whyThisFitsTopic: '心理转折清楚。',
            materialConnection: '使用妈妈额头的汗和椅背。',
            writingPath: '由紧张比赛到关心妈妈。',
            keyDetailsToAsk: ['妈妈当时说了什么'],
            riskReminder: '不要过度抒情。',
            materialHint: '补真实对话。'
          }
        ],
        riskyAngles: [],
        suggestedNextQuestions: ['妈妈发烧时有什么动作？']
      };
    } else if (prompt.taskName.includes('素材追问')) {
      payload = {
        questionSetId: 'questions_angle_1',
        selectedAngleId: 'angle_1',
        questions: [
          { questionId: 'q1', field: 'trigger', category: '触发', question: '你是在什么情况下发现妈妈发烧的？', purpose: '补清行动的触发点。', materialAnchor: '妈妈发烧仍陪我准备朗读比赛', detailHints: ['当时在哪里', '妈妈的样子'], required: true },
          { questionId: 'q2', field: 'action', category: '行动', question: '你主动做了哪些事？', purpose: '补足真实动作。', materialAnchor: '煮粥、整理书包', detailHints: ['先后顺序', '用到的物件'], required: true },
          { questionId: 'q3', field: 'difficulty', category: '困难', question: '煮粥时最难的一步是什么？', purpose: '补足过程阻力。', materialAnchor: '米粒在锅里翻滚', detailHints: ['当时的困难', '你怎样解决'], required: false },
          { questionId: 'q4', field: 'reaction', category: '反应', question: '妈妈看到后有什么真实反应？', purpose: '补充人物反应。', materialAnchor: '妈妈发烧', detailHints: ['表情', '真实话语'], required: false },
          { questionId: 'q5', field: 'change', category: '变化', question: '这件事前后你有什么变化？', purpose: '补出成长证据。', materialAnchor: '发现照顾别人也需要细心和责任', detailHints: ['以前怎样', '这次怎样'], required: false }
        ],
        materialChecklist: [],
        requiredAnswerCount: 2,
        nextAction: 'answer_questions'
      };
    } else if (prompt.taskName.includes('提纲树')) {
      payload = {
        outlineTree: {
          title: '那一刻，我长大了',
          theme: '一碗粥里的责任',
          children: ['开头', '经过', '转折', '结尾'].map((role, index) => ({
            nodeId: `p${index + 1}`,
            role,
            label: `${role}：妈妈发烧和朗读比赛`,
            focus: '扣住妈妈发烧、朗读比赛、煮粥、整理书包',
            writeTask: '写清这一段发生了什么以及我的变化。',
            writingObjects: ['妈妈', '朗读稿', '粥', '书包'],
            detailPlan: ['妈妈发烧仍提醒我朗读', '我去厨房煮粥', '我整理书包'],
            eventBeats: ['看到妈妈额头冒汗', '米粒在锅里翻滚', '把朗读稿放进书包'],
            emotionShift: '从只顾比赛到主动照顾妈妈。',
            transitionHint: '用一个动作承接下一段。',
            studentChecklist: ['有没有写妈妈发烧', '有没有写自己的动作'],
            children: []
          }))
        }
      };
    } else if (prompt.taskName.includes('段落写作提示')) {
      assert.ok(prompt.input.outlineTree, 'paragraph guide call should receive the generated outline tree');
      payload = {
        paragraphGuides: ['开头', '主体一', '主体二', '结尾'].map((role, index) => ({
          paragraphId: `p${index + 1}`,
          role,
          goal: '让学生知道这一段该写妈妈发烧、朗读比赛、煮粥和书包。',
          writingTargets: ['妈妈发烧的样子', '我煮粥的动作', '整理书包的物件'],
          howToWrite: ['先写看到的样子', '再写自己做了什么', '最后写心里变化'],
          detailsToInclude: ['妈妈', '发烧', '朗读比赛', '煮粥', '书包'],
          developmentSteps: ['看见妈妈累', '走进厨房', '整理朗读稿'],
          sensoryDetails: ['米粥热气', '妈妈沙哑的声音'],
          innerThoughtPrompts: ['你第一次发现妈妈也会累时怎么想？'],
          mustInclude: ['妈妈', '发烧', '朗读比赛', '煮粥', '书包'],
          writingPrompts: ['你手上正在做什么？'],
          starterHint: '从一个真实动作开始。',
          avoid: ['不要直接喊我长大了'],
          selfCheck: ['有没有真实动作', '有没有扣题'],
          suggestedLength: '120-180字'
        })),
        missingMaterialQuestions: [],
        nextAction: 'write_paragraph_1',
        studentTask: '先写第1段，写妈妈发烧和你开始行动的画面。'
      };
    } else {
      payload = {};
    }

    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
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
    const material = '妈妈发烧仍陪我准备朗读比赛，我第一次主动煮粥、整理书包，发现照顾别人也需要细心和责任。';
    const created = await request(baseUrl, 'POST', '/api/v1/essay-sessions', {
      mode: 'brainstorm',
      title: '那一刻，我长大了',
      grade: '五年级',
      genre: '记叙文',
      initialMaterial: material
    });
    assert.strictEqual(created.status, 200);
    const sessionId = created.json.data.sessionId;

    const topic = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/topic-analysis`, {
      initialMaterial: material
    });
    assert.strictEqual(topic.status, 200);

    const questions = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/material-questions`, {
      selectedAngleId: 'angle_1'
    });
    assert.strictEqual(questions.status, 200);
    const questionSetId = questions.json.data.questionSetId;
    assert.strictEqual(typeof questionSetId, 'string');
    assert.ok(questionSetId.trim(), 'material-questions should return a non-empty server questionSetId');
    assert.notStrictEqual(questionSetId, 'questions_angle_1', 'server questionSetId must not reuse the model-provided ID');

    const guided = await request(baseUrl, 'POST', `/api/v1/essay-sessions/${sessionId}/guided-writing`, {
      questionSetId,
      selectedAngleId: 'angle_1',
      materialAnswers: [
        { questionId: 'q1', answer: '她额头冒汗，声音发哑，还提醒我朗读停顿。' },
        { questionId: 'q2', answer: '我去厨房煮粥，又把朗读稿和水杯放进书包。' }
      ],
      extraMaterial: '厨房灯是暖黄的，米粒在锅里翻滚。'
    });

    assert.strictEqual(guided.status, 200);
    assert.strictEqual(guided.json.data.outlineTree.children.length, 4);
    assert.strictEqual(guided.json.data.paragraphGuides.length, 4);
    assert.strictEqual(guided.json.data.nextAction, 'write_paragraph_1');

    const taskNames = modelCalls.map((call) => call.taskName);
    assert.ok(taskNames.some((name) => name.includes('提纲树')), 'guided-writing should call a dedicated outline-tree model task');
    assert.ok(taskNames.some((name) => name.includes('段落写作提示')), 'guided-writing should call a dedicated paragraph-guide model task');
    assert.ok(!taskNames.includes('交互式写作引导'), 'guided-writing should no longer use one combined model task');

    const outlineCall = modelCalls.find((call) => call.taskName.includes('提纲树'));
    const paragraphCall = modelCalls.find((call) => call.taskName.includes('段落写作提示'));
    for (const anchor of ['妈妈', '发烧', '朗读比赛', '煮粥', '书包']) {
      assert.ok(JSON.stringify(outlineCall.input).includes(anchor), `outline model input should include ${anchor}`);
      assert.ok(JSON.stringify(paragraphCall.input).includes(anchor), `paragraph model input should include ${anchor}`);
    }

    console.log('OK guided writing split model calls');
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
