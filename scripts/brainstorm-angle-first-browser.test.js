const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const topicAngles = [
  {
    angleId: 'angle_1',
    title: '考试后的自我整理',
    prompt: '写失利后自己整理错题的变化。',
    whyThisFitsTopic: '主动面对失利能体现成长。',
    materialConnection: '联系已有的紧张和坚持。',
    writingPath: '从失利写到整理，再写变化。',
    keyDetailsToAsk: ['看到分数时做了什么？'],
    riskReminder: '不要只写大道理。',
    materialHint: '补试卷和整理动作。'
  },
  {
    angleId: 'angle_2',
    title: '承担一次家务',
    prompt: '写从被照顾到主动承担。',
    whyThisFitsTopic: '主动承担能具体表现成长。',
    materialConnection: '联系第一次独自上台时的坚持。',
    writingPath: '从犹豫写到行动，再写结果。',
    keyDetailsToAsk: ['主动承担了什么？'],
    riskReminder: '不要编造家务细节。',
    materialHint: '补地点、动作和家人反应。'
  },
  {
    angleId: 'angle_3',
    title: '和同学和解',
    prompt: '写一次关系里的反思。',
    whyThisFitsTopic: '主动修复关系能体现成长。',
    materialConnection: '联系已有经历中的紧张和行动。',
    writingPath: '从冲突写到反思，再写沟通。',
    keyDetailsToAsk: ['你主动说了什么？'],
    riskReminder: '不要编造对话。',
    materialHint: '补冲突、对话和转折。'
  }
];

const failures = [];

async function check(regressionName, assertion) {
  try {
    await assertion();
  } catch (error) {
    failures.push(`${regressionName}: ${error.message}`);
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

function materialQuestionResult(angle) {
  return {
    questionSetId: `questions_${angle.angleId}`,
    selectedAngleId: angle.angleId,
    selectedAngle: angle,
    questions: [
      ['q1', 'trigger', '触发', `第一次独自上台演讲的经历中，是什么具体情况让你沿着“${angle.writingPath}”决定主动行动？`, true],
      ['q2', 'action', '行动', `围绕“${angle.title}”，你在上台演讲前后连续做了哪些真实动作？`, true],
      ['q3', 'difficulty', '困难', '第一次独自上台演讲时，手一直在抖，最难坚持的一步是什么？', true],
      ['q4', 'reaction', '人物反应', '你坚持讲完后，台下同学或老师有什么真实反应？', false],
      ['q5', 'change', '变化证据', `这次上台演讲前后，你的做法有什么变化，怎样支撑“${angle.title}”？`, true]
    ].map(([questionId, field, category, question, required]) => ({
      questionId,
      field,
      category,
      question,
      purpose: '补充能支撑所选立意的真实细节。',
      materialAnchor: `第一次独自上台演讲与${angle.title}`,
      detailHints: ['当时看见什么', '你做了什么', '事情怎样变化'],
      required
    })),
    materialChecklist: [],
    requiredAnswerCount: 4,
    nextAction: 'answer_questions'
  };
}

function guidedOutlineResult(prompt) {
  const angleId = prompt.input.selectedAngleId;
  const questionSetId = prompt.input.questionSetId;
  const roles = ['开头', '经过', '转折', '结尾'];
  return {
    outlineTree: {
      title: `${angleId} · ${questionSetId} 写作提纲`,
      theme: `围绕 ${angleId} 和 ${questionSetId} 展开真实经历`,
      children: roles.map((role, index) => ({
        nodeId: `${angleId}_node_${index + 1}`,
        role,
        label: `${role}：完成第 ${index + 1} 个写作任务`,
        focus: `${questionSetId} 的第 ${index + 1} 个细节`,
        writeTask: `写清 ${role} 中的真实动作和变化。`,
        writingObjects: ['人物', '动作', '环境'],
        detailPlan: ['交代场景', '展开动作', '写出变化'],
        eventBeats: ['事件开始', '事情推进'],
        emotionShift: '从犹豫到主动。',
        transitionHint: '用下一个动作衔接。',
        studentChecklist: ['有真实动作', '有可见细节'],
        children: []
      }))
    }
  };
}

function guidedParagraphResult(prompt) {
  const angleId = prompt.input.selectedAngleId;
  const questionSetId = prompt.input.questionSetId;
  const roles = ['开头', '经过', '转折', '结尾'];
  return {
    paragraphGuides: roles.map((role, index) => ({
      paragraphId: `${angleId}_paragraph_${index + 1}`,
      role,
      goal: `${angleId}/${questionSetId} 的${role}写作任务`,
      writingTargets: ['人物动作', '环境细节'],
      howToWrite: ['按发生顺序写', '用动作代替空泛感受'],
      detailsToInclude: [`${questionSetId} 对应的真实回答`],
      developmentSteps: ['先交代场景', '再写动作', '最后写变化'],
      sensoryDetails: ['看到的事物'],
      innerThoughtPrompts: ['当时真实想到了什么'],
      mustInclude: ['真实动作', '前后变化'],
      writingPrompts: ['你先做了什么', '事情怎样变化'],
      starterHint: `从${role}的具体画面起笔。`,
      avoid: ['不要只讲道理'],
      selfCheck: ['是否有具体动作'],
      suggestedLength: `${80 + index * 20}-${120 + index * 20}字`
    })),
    missingMaterialQuestions: [{ question: '当时把演讲稿折了几次？手心有没有出汗？' }],
    nextAction: 'write_paragraph_1',
    studentTask: `先按 ${angleId} 和 ${questionSetId} 对应的第1段提示开始写。`
  };
}

function modelResult(prompt) {
  if (prompt.taskName === '题目理解与立意建议') {
    return {
      topicKeywords: ['那一刻', '长大'],
      coreQuestion: '写清一次真实变化。',
      possibleAngles: topicAngles,
      riskyAngles: [],
      suggestedNextQuestions: []
    };
  }
  if (prompt.taskName === '素材追问') {
    const selectedAngleId = prompt.input.selectedAngleId || prompt.input.selectedAngle?.angleId;
    const selectedAngleTitle = typeof prompt.input.selectedAngle === 'string' ? prompt.input.selectedAngle : '';
    const angle = topicAngles.find((item) => item.angleId === selectedAngleId || item.title === selectedAngleTitle) || topicAngles[0];
    return materialQuestionResult(angle);
  }
  if (prompt.taskName === '短期写作引导：生成提纲树') return guidedOutlineResult(prompt);
  if (prompt.taskName === '短期写作引导：生成段落写作提示') return guidedParagraphResult(prompt);
  return {};
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for expected model request');
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'angle-first-browser-'));
  const modelPrompts = [];
  let releaseAngleOneMaterialResponse = null;
  let releaseAngleThreeGuidedResponse = null;
  const fakeDeepSeek = await listen(http.createServer(async (req, res) => {
    assert.strictEqual(req.url, '/v1/chat/completions');
    assert.strictEqual(req.headers.authorization, 'Bearer test-key');
    const body = JSON.parse(await readBody(req));
    const prompt = JSON.parse(body.messages[1].content);
    modelPrompts.push(prompt);
    const requestedAngleId = prompt.input?.selectedAngleId || prompt.input?.selectedAngle?.angleId;
    if (prompt.taskName === '素材追问' && requestedAngleId === 'angle_1') {
      await new Promise((resolve) => { releaseAngleOneMaterialResponse = resolve; });
    }
    if (prompt.taskName === '短期写作引导：生成提纲树' && requestedAngleId === 'angle_3') {
      await new Promise((resolve) => { releaseAngleThreeGuidedResponse = resolve; });
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(modelResult(prompt)) } }],
      usage: { total_tokens: 123 }
    }));
  }));

  process.env.APP_DATA_DIR = tempDir;
  process.env.AI_API_BASE_URL = `http://127.0.0.1:${fakeDeepSeek.address().port}/v1`;
  process.env.AI_API_KEY = 'test-key';
  process.env.PORT = '0';

  const app = require('../server');
  const server = await listen(app);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(`http://127.0.0.1:${server.address().port}/app.html`, { waitUntil: 'networkidle' });
    const customRevisionState = await page.evaluate(() => {
      const goal = document.getElementById('reviseGoalInput');
      const goalInput = document.getElementById('reviseGoalCustom');
      const depth = document.getElementById('reviseDepthInput');
      const depthInput = document.getElementById('reviseDepthCustom');
      goal.value = 'custom';
      goal.dispatchEvent(new Event('change', { bubbles: true }));
      depth.value = 'custom';
      depth.dispatchEvent(new Event('change', { bubbles: true }));
      const customVisible = !goalInput.hidden && !depthInput.hidden;
      goalInput.value = '补充真实动作';
      depthInput.value = '逐段示范';
      const customValues = [getRevisionSelection('goal'), getRevisionSelection('depth')];
      goal.value = '变具体';
      goal.dispatchEvent(new Event('change', { bubbles: true }));
      depth.value = '只给建议';
      depth.dispatchEvent(new Event('change', { bubbles: true }));
      return { customVisible, customValues, cleared: !goalInput.value && !depthInput.value };
    });
    await check('custom revision selections must reveal inputs, return user text, and clear on preset selection', () => {
      assert.deepStrictEqual(customRevisionState, {
        customVisible: true,
        customValues: ['补充真实动作', '逐段示范'],
        cleared: true
      });
    });
    const tenPointScore = await page.evaluate(() => {
      const host = document.createElement('div');
      host.innerHTML = diagnosticScoreCard('素材具体度', { score: 7 });
      const card = host.querySelector('.score-card');
      const bar = card?.querySelector('[role="progressbar"]');
      return {
        label: card?.querySelector('strong')?.textContent,
        maximum: bar?.getAttribute('aria-valuemax'),
        current: bar?.getAttribute('aria-valuenow'),
        width: card?.querySelector('.mini-track i')?.style.width
      };
    });
    await check('diagnostic score value and progress bar must agree on a ten-point scale', () => {
      assert.deepStrictEqual(tenPointScore, { label: '7/10', maximum: '10', current: '7', width: '70%' });
    });
    const offlineTopicAnalysis = await page.evaluate(() => demoTopicAnalysis('那一刻，我长大了', ''));
    await check('offline demo without initial material must still provide three angles', () => {
      assert.ok(Array.isArray(offlineTopicAnalysis.possibleAngles));
      assert.strictEqual(offlineTopicAnalysis.possibleAngles.length, 3);
      assert.strictEqual(new Set(offlineTopicAnalysis.possibleAngles.map((angle) => angle.angleId)).size, 3);
    });
    await page.locator('.nav-item[data-view="brainstorm"]').click();
    await page.fill('#topicInput', '那一刻，我长大了');
    await page.selectOption('#gradeInput', { label: '初二' });
    await page.selectOption('#genreInput', { label: '记叙文' });
    await page.fill('#materialInput', '我第一次独自上台演讲，手一直在抖，但最后坚持讲完。');
    await page.click('#buildOutlineBtn');
    await page.waitForSelector('.angle-card');
    await check('angle cards must omit follow-up-question and risk-reminder blocks', async () => {
      const cardTexts = await page.locator('.angle-guidance-details').allTextContents();
      assert.ok(cardTexts.length >= 3);
      assert.ok(cardTexts.every((text) => !text.includes('继续追问') && !text.includes('风险提醒')));
    });

    const materialCallCount = () => modelPrompts.filter((prompt) => prompt.taskName === '素材追问').length;
    const stateBeforeAngleClick = await page.evaluate(() => ({
      selectedAngleId: brainstormState.selectedAngleId,
      selectedAngle: brainstormState.selectedAngle,
      materialQuestions: brainstormState.materialQuestions,
      questionSetId: brainstormState.questionSetId
    }));
    await check('topic analysis must leave every angle unselected', async () => {
      assert.strictEqual(await page.locator('.angle-card.selected').count(), 0);
    });
    await check('topic analysis must leave selectedAngleId empty', () => {
      assert.strictEqual(stateBeforeAngleClick.selectedAngleId, '');
    });
    await check('topic analysis must leave selectedAngle empty', () => {
      assert.strictEqual(stateBeforeAngleClick.selectedAngle, '');
    });
    await check('topic analysis must leave materialQuestions null', () => {
      assert.strictEqual(stateBeforeAngleClick.materialQuestions, null);
    });
    await check('topic analysis must leave questionSetId empty', () => {
      assert.strictEqual(stateBeforeAngleClick.questionSetId, '');
    });
    await check('topic analysis must not request material questions', () => {
      assert.strictEqual(materialCallCount(), 0);
    });

    const angleCards = page.locator('.angle-card');
    await angleCards.nth(1).click();
    await check('choosing the second angle must not request material questions', () => {
      assert.strictEqual(materialCallCount(), 0);
    });
    await check('the second angle should be visibly selected', async () => {
      assert.strictEqual(await angleCards.nth(1).evaluate((element) => element.classList.contains('selected')), true);
    });

    const materialButton = page.locator('#generateMaterialQuestionsBtn');
    const materialButtonCount = await materialButton.count();
    await check('the explicit material-question control must be a button', () => {
      assert.strictEqual(materialButtonCount, 1, 'expected one #generateMaterialQuestionsBtn');
    });

    if (materialButtonCount === 1) {
      await check('the explicit button must use an approved label', async () => {
        const label = String(await materialButton.textContent()).trim();
        assert.ok(['素材追问', '确认立意，生成素材追问'].includes(label));
      });
      const callsBeforeClick = materialCallCount();
      await materialButton.click();
      await waitFor(() => materialCallCount() > callsBeforeClick);
      const requestPrompt = modelPrompts.filter((prompt) => prompt.taskName === '素材追问').at(-1);
      await check('clicking after choosing the second angle must send angle_2', () => {
        assert.strictEqual(requestPrompt.input.selectedAngleId, 'angle_2');
      });
    }

    await page.evaluate(() => {
      brainstormState.questionSetId = 'stale_question_set';
      brainstormState.materialQuestions = { questions: [{ questionId: 'stale_question' }] };
      brainstormState.materialAnswers = [{ questionId: 'stale_question', answer: 'stale_answer' }];
      brainstormState.guidedWriting = { guideId: 'stale_guide' };
    });
    await angleCards.nth(2).click();
    const stateAfterAngleChange = await page.evaluate(() => ({
      questionSetId: brainstormState.questionSetId,
      materialQuestions: brainstormState.materialQuestions,
      materialAnswers: brainstormState.materialAnswers,
      guidedWriting: brainstormState.guidedWriting
    }));
    await check('changing angle must clear stale questionSetId', () => {
      assert.strictEqual(stateAfterAngleChange.questionSetId, '');
    });
    await check('changing angle must clear stale questions', () => {
      assert.strictEqual(stateAfterAngleChange.materialQuestions, null);
    });
    await check('changing angle must clear stale answers', () => {
      assert.deepStrictEqual(stateAfterAngleChange.materialAnswers, []);
    });
    await check('changing angle must clear stale guided writing', () => {
      assert.strictEqual(stateAfterAngleChange.guidedWriting, null);
    });

    await angleCards.nth(0).click();
    const delayedMaterialButton = page.locator('#generateMaterialQuestionsBtn');
    await delayedMaterialButton.click();
    await waitFor(() => modelPrompts.some((prompt) => (
      prompt.taskName === '素材追问'
      && (prompt.input?.selectedAngleId || prompt.input?.selectedAngle?.angleId) === 'angle_1'
    )));
    await angleCards.nth(1).click();
    await check('switching during an in-flight request must visibly select angle_2', async () => {
      assert.strictEqual(await angleCards.nth(1).evaluate((element) => element.classList.contains('selected')), true);
    });

    releaseAngleOneMaterialResponse();
    releaseAngleOneMaterialResponse = null;
    await page.waitForFunction(() => !brainstormState.materialQuestionsLoading);

    const stateAfterStaleResponse = await page.evaluate(() => ({
      selectedAngleId: brainstormState.selectedAngleId,
      selectedAngle: brainstormState.selectedAngle,
      questionSetId: brainstormState.questionSetId,
      materialQuestions: brainstormState.materialQuestions,
      materialAnswers: brainstormState.materialAnswers,
      guidedWriting: brainstormState.guidedWriting
    }));
    await check('a stale angle_1 response must not replace the current angle_2 selection', () => {
      assert.strictEqual(stateAfterStaleResponse.selectedAngleId, 'angle_2');
      assert.strictEqual(stateAfterStaleResponse.selectedAngle, topicAngles[1].title);
    });
    await check('a stale angle_1 response must not save its question set or questions', () => {
      assert.strictEqual(stateAfterStaleResponse.questionSetId, '');
      assert.strictEqual(stateAfterStaleResponse.materialQuestions, null);
    });
    await check('a stale angle_1 response must not save answers or guided writing', () => {
      assert.deepStrictEqual(stateAfterStaleResponse.materialAnswers, []);
      assert.strictEqual(stateAfterStaleResponse.guidedWriting, null);
    });
    await check('a stale angle_1 response must not render its question or writing-guide UI', async () => {
      assert.strictEqual(await page.locator('text=回答素材追问').count(), 0);
      assert.strictEqual(await page.locator('#generateWritingGuideBtn').count(), 0);
      assert.strictEqual(await page.locator('.material-question-text').count(), 0);
    });
    await check('angle_2 must remain visibly selected after the stale response settles', async () => {
      assert.strictEqual(await angleCards.nth(1).evaluate((element) => element.classList.contains('selected')), true);
    });

    const closureMaterialCallsBefore = materialCallCount();
    await page.locator('#generateMaterialQuestionsBtn').click();
    await waitFor(() => materialCallCount() > closureMaterialCallsBefore);
    try {
      await page.waitForFunction(() => (
        Boolean(brainstormState.questionSetId)
        && brainstormState.materialQuestions?.selectedAngleId === 'angle_2'
        && document.querySelectorAll('.material-question-text').length === 5
      ), undefined, { timeout: 5000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        selectedAngleId: brainstormState.selectedAngleId,
        questionSetId: brainstormState.questionSetId,
        materialQuestionsLoading: brainstormState.materialQuestionsLoading,
        materialQuestionsError: brainstormState.materialQuestionsError,
        questionCount: document.querySelectorAll('.material-question-text').length
      }));
      throw new Error(`material-question DOM did not settle: ${JSON.stringify(diagnostic)}; ${error.message}`);
    }
    const closureQuestionSetId = await page.evaluate(() => brainstormState.questionSetId);
    await check('the selected angle must render its complete material-question DOM', async () => {
      assert.strictEqual(await page.locator('.material-question-text').count(), 5);
      assert.strictEqual(await page.locator('#generateWritingGuideBtn').isDisabled(), true);
    });

    for (const questionId of ['q1', 'q2', 'q3', 'q5']) {
      await page.locator(`.material-answer-input[data-question-id="${questionId}"]`).fill(`${questionId} 的真实回答`);
    }
    await check('answering every required question must enable writing guidance', async () => {
      assert.strictEqual(await page.locator('#generateWritingGuideBtn').isEnabled(), true);
      assert.strictEqual(await page.locator('#materialAnswerProgress').textContent(), '必答素材已补充，可以生成写作引导');
    });

    const closureGuideResponse = page.waitForResponse((response) => (
      response.url().includes('/guided-writing')
      && response.request().method() === 'POST'
    ));
    await page.locator('#generateWritingGuideBtn').click();
    const completedClosureResponse = await closureGuideResponse;
    await completedClosureResponse.finished();
    await page.waitForSelector('.paragraph-guide-card');

    const closureGuideState = await page.evaluate(() => ({
      questionSetId: brainstormState.guidedWriting?.questionSetId,
      selectedAngleId: brainstormState.guidedWriting?.selectedAngleId,
      outlineTitle: brainstormState.guidedWriting?.outlineTree?.title,
      paragraphCount: brainstormState.guidedWriting?.paragraphGuides?.length
    }));
    await check('the writing guide must belong to the current angle and question set', () => {
      assert.strictEqual(closureGuideState.questionSetId, closureQuestionSetId);
      assert.strictEqual(closureGuideState.selectedAngleId, 'angle_2');
      assert.strictEqual(closureGuideState.outlineTitle, `angle_2 · ${closureQuestionSetId} 写作提纲`);
      assert.strictEqual(closureGuideState.paragraphCount, 4);
    });
    await check('the current writing guide must render its outline and paragraph tasks', async () => {
      assert.strictEqual(await page.getByText(`angle_2 · ${closureQuestionSetId} 写作提纲`, { exact: true }).count(), 1);
      assert.strictEqual(await page.getByText(`angle_2/${closureQuestionSetId} 的开头写作任务`, { exact: true }).count(), 1);
      assert.strictEqual(await page.locator('.paragraph-guide-card').count(), 4);
      assert.strictEqual(await page.locator('.user-write-input').count(), 4);
    });
    await check('both guide model stages must receive the current angle and question set', () => {
      const prompts = modelPrompts.filter((prompt) => (
        prompt.taskName.startsWith('短期写作引导：')
        && prompt.input?.selectedAngleId === 'angle_2'
      ));
      assert.strictEqual(prompts.length, 2);
      for (const prompt of prompts) assert.strictEqual(prompt.input.questionSetId, closureQuestionSetId);
    });

    const outlineText = await page.locator('.outline-tree').innerText();
    await check('outline must render four concise branches without self-check or deep checklist details', async () => {
      assert.strictEqual(await page.locator('.outline-branch').count(), 4);
      assert.ok(!outlineText.includes('自查'));
      assert.ok(!outlineText.includes('交代场景'));
    });
    await check('writing guide must rename required content and omit self-check output', async () => {
      const text = await page.locator('#writingGuideArea').innerText();
      assert.ok(text.includes('核心元素'));
      assert.ok(!text.includes('必须写入'));
      assert.ok(!text.includes('自查'));
    });
    const folds = page.locator('.paragraph-guide-details');
    await check('paragraph hints must be collapsible while keeping paragraph inputs available', async () => {
      assert.strictEqual(await folds.count(), 4);
      assert.strictEqual(await folds.nth(0).evaluate((node) => node.open), true);
      assert.strictEqual(await folds.nth(1).evaluate((node) => node.open), false);
      assert.strictEqual(await page.locator('.user-write-input').count(), 4);
    });
    await folds.nth(1).locator('summary').click();
    await check('paragraph hint cards must toggle open and closed', async () => {
      assert.strictEqual(await folds.nth(1).evaluate((node) => node.open), true);
      await folds.nth(1).locator('summary').click();
      assert.strictEqual(await folds.nth(1).evaluate((node) => node.open), false);
    });
    const additionalPlacement = await page.evaluate(() => {
      const area = document.getElementById('additionalMaterialPromptArea');
      const panel = area?.closest('.result-panel');
      const questions = panel?.querySelectorAll('.material-question-text') || [];
      const lastQuestion = questions[questions.length - 1];
      return {
        insideMaterialPanel: Boolean(panel?.querySelector('.material-answer-area')),
        afterQuestionList: Boolean(lastQuestion && (lastQuestion.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING)),
        beforeWritingGuide: Boolean(panel?.nextElementSibling?.classList.contains('writing-guide-panel'))
      };
    });
    await check('additional-material questions must appear at the end of the material-question panel', () => {
      assert.deepStrictEqual(additionalPlacement, { insideMaterialPanel: true, afterQuestionList: true, beforeWritingGuide: true });
    });
    await page.locator('#continueMaterialAnswerBtn').click();
    await check('continue-answer action must reveal a supplementary-material text box', async () => {
      assert.strictEqual(await page.locator('#additionalMaterialInput').count(), 1);
    });
    const guidedPromptCountBeforeEmpty = modelPrompts.filter((prompt) => prompt.taskName.startsWith('短期写作引导：')).length;
    await page.locator('#updateWritingGuideBtn').click();
    await check('empty supplementary material must show validation without calling the model', async () => {
      assert.ok(await page.locator('#additionalMaterialError').isVisible());
      assert.strictEqual(modelPrompts.filter((prompt) => prompt.taskName.startsWith('短期写作引导：')).length, guidedPromptCountBeforeEmpty);
    });
    const additionalDetail = '补充：演讲前我把讲稿折了两次，手心的汗把纸角浸湿。';
    await page.locator('#additionalMaterialInput').fill(additionalDetail);
    const updatedGuideResponse = page.waitForResponse((response) => (
      response.url().includes('/guided-writing') && response.request().method() === 'POST'
    ));
    await page.locator('#updateWritingGuideBtn').click();
    const completedUpdatedGuideResponse = await updatedGuideResponse;
    await completedUpdatedGuideResponse.finished();
    await waitFor(() => modelPrompts.filter((prompt) => (
      prompt.taskName.startsWith('短期写作引导：') && prompt.input?.additionalMaterial === additionalDetail
    )).length === 2);
    await page.waitForFunction(() => !document.getElementById('additionalMaterialInput'));
    const persistedAdditionalMaterial = await page.evaluate(() => brainstormState.additionalMaterial);
    await check('supplementary real detail must be bound to both guide-model stages and update the guide', () => {
      const prompts = modelPrompts.filter((prompt) => (
        prompt.taskName.startsWith('短期写作引导：') && prompt.input?.additionalMaterial === additionalDetail
      ));
      assert.strictEqual(prompts.length, 2);
      assert.ok(prompts.every((prompt) => prompt.input.questionSetId === closureQuestionSetId && prompt.input.selectedAngleId === 'angle_2'));
      assert.strictEqual(persistedAdditionalMaterial, additionalDetail);
    });

    await angleCards.nth(2).click();
    const raceMaterialCallsBefore = materialCallCount();
    await page.locator('#generateMaterialQuestionsBtn').click();
    await waitFor(() => materialCallCount() > raceMaterialCallsBefore);
    await page.waitForFunction(() => (
      Boolean(brainstormState.questionSetId)
      && brainstormState.materialQuestions?.selectedAngleId === 'angle_3'
    ));
    const raceQuestionSetId = await page.evaluate(() => brainstormState.questionSetId);
    for (const questionId of ['q1', 'q2', 'q3', 'q5']) {
      await page.locator(`.material-answer-input[data-question-id="${questionId}"]`).fill(`${questionId} 的第三立意回答`);
    }

    const staleGuideResponse = page.waitForResponse((response) => (
      response.url().includes('/guided-writing')
      && response.request().method() === 'POST'
    ));
    await page.locator('#generateWritingGuideBtn').click();
    await waitFor(() => modelPrompts.some((prompt) => (
      prompt.taskName === '短期写作引导：生成提纲树'
      && prompt.input?.selectedAngleId === 'angle_3'
    )));
    await angleCards.nth(0).click();
    await check('switching during guide generation must immediately select angle_1 and clear angle_3 artifacts', async () => {
      assert.strictEqual(await angleCards.nth(0).getAttribute('aria-checked'), 'true');
      const state = await page.evaluate(() => ({
        selectedAngleId: brainstormState.selectedAngleId,
        questionSetId: brainstormState.questionSetId,
        materialQuestions: brainstormState.materialQuestions,
        materialAnswers: brainstormState.materialAnswers,
        guidedWriting: brainstormState.guidedWriting
      }));
      assert.deepStrictEqual(state, {
        selectedAngleId: 'angle_1',
        questionSetId: '',
        materialQuestions: null,
        materialAnswers: [],
        guidedWriting: null
      });
    });

    releaseAngleThreeGuidedResponse();
    releaseAngleThreeGuidedResponse = null;
    const completedStaleGuideResponse = await staleGuideResponse;
    await completedStaleGuideResponse.finished();
    await page.waitForTimeout(100);

    const stateAfterStaleGuide = await page.evaluate(() => ({
      selectedAngleId: brainstormState.selectedAngleId,
      selectedAngle: brainstormState.selectedAngle,
      questionSetId: brainstormState.questionSetId,
      materialQuestions: brainstormState.materialQuestions,
      materialAnswers: brainstormState.materialAnswers,
      guidedWriting: brainstormState.guidedWriting
    }));
    await check('a stale angle_3 guide response must not write into the new angle_1 state', () => {
      assert.deepStrictEqual(stateAfterStaleGuide, {
        selectedAngleId: 'angle_1',
        selectedAngle: topicAngles[0].title,
        questionSetId: '',
        materialQuestions: null,
        materialAnswers: [],
        guidedWriting: null
      });
    });
    await check('a stale angle_3 guide response must not render old outline or paragraph DOM', async () => {
      assert.strictEqual(await page.getByText(`angle_3 · ${raceQuestionSetId} 写作提纲`, { exact: true }).count(), 0);
      assert.strictEqual(await page.locator('.paragraph-guide-card').count(), 0);
      assert.strictEqual(await page.locator('#btn-user-finished').count(), 0);
    });
    await check('browser flow must not throw uncaught errors', () => {
      assert.deepStrictEqual(pageErrors, []);
    });

    if (failures.length) {
      throw new Error(`Angle-first browser contract failures:\n- ${failures.join('\n- ')}`);
    }
  } finally {
    if (releaseAngleOneMaterialResponse) releaseAngleOneMaterialResponse();
    if (releaseAngleThreeGuidedResponse) releaseAngleThreeGuidedResponse();
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => fakeDeepSeek.close(resolve));
    const statePath = path.join(tempDir, 'app-state.json');
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
