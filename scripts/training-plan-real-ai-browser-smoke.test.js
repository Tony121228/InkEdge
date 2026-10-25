const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const AI_STAGE_IDS = new Set([
  'topic_angle',
  'material_questions',
  'outline_tree',
  'paragraph_guides',
  'draft_diagnosis',
  'revision_reflection'
]);

function assertModelArtifact(result, expectedStageId) {
  assert.strictEqual(result.stageId, expectedStageId, `${expectedStageId} should return the expected stage id`);
  assert.ok(result.artifact, `${expectedStageId} should return an artifact`);
  if (AI_STAGE_IDS.has(expectedStageId)) {
    assert.strictEqual(
      result.artifact.localFallback,
      false,
      `${expectedStageId} should use the real AI model, not local fallback; reason=${result.artifact.modelFallbackReasonCode || 'unknown'}; preview=${result.artifact.modelFallbackDebugPreview || ''}`
    );
    assert.ok(result.artifact.modelMeta, `${expectedStageId} should include model metadata`);
  }
  return result.artifact;
}

async function runStage(page, expectedStageId) {
  console.log(`RUN ${expectedStageId}`);
  const responsePromise = page.waitForResponse((response) => {
    const url = response.url();
    return url.includes('/api/v1/training-plans/')
      && url.includes('/tasks/')
      && url.endsWith('/run');
  }, { timeout: 310000 });
  await page.locator('[data-action="run-stage"]').first().click();
  const response = await responsePromise;
  assert.strictEqual(response.status(), 200, `${expectedStageId} API response should be 200`);
  const payload = await response.json();
  assert.notStrictEqual(payload.success, false, `${expectedStageId} API payload should be successful`);
  const artifact = assertModelArtifact(payload.data, expectedStageId);
  console.log(`OK ${expectedStageId}`);
  return artifact;
}

async function clickNext(page) {
  await page.locator('[data-action="go-next-stage"]').first().click();
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'training-real-ai-smoke-'));
  process.env.APP_DATA_DIR = tempDir;
  process.env.TRAINING_PLAN_MODEL_DEBUG = 'true';
  const app = require('../server');

  assert.ok(process.env.AI_API_KEY, 'AI_API_KEY must be configured in environment or .env for real AI smoke');
  assert.ok(process.env.AI_API_BASE_URL, 'AI_API_BASE_URL must be configured for real AI smoke');
  assert.ok(process.env.AI_GUIDANCE_MODEL || process.env.AI_REWRITE_MODEL, 'AI_GUIDANCE_MODEL or AI_REWRITE_MODEL must be configured for real AI smoke');

  const server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 940 } });
    page.setDefaultTimeout(310000);
    page.setDefaultNavigationTimeout(310000);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(`${base}/training-plans.html`, { waitUntil: 'networkidle' });
    await page.click('[data-plan-type="7d"]');

    await page.waitForSelector('#stageTitleInput');
    await page.fill('#stageTitleInput', '一日秋游踏青');
    await page.fill('#stageGradeInput', '初二');
    await page.fill('#stageGenreInput', '记叙文');
    await page.fill('#stageMaterialInput', '初一时我们去塔子山公园秋游，天气微凉，班级同学一起走进鸟林。我看到几只小鸟在树枝和笼舍间跳动，忽然觉得它们不是景点里的摆设，而是有自己生命节奏的小生灵。');
    const topicArtifact = await runStage(page, 'topic_angle');
    await page.waitForSelector('.stage-angle-choice');
    assert.ok(Array.isArray(topicArtifact.possibleAngles) && topicArtifact.possibleAngles.length >= 1, 'real Day 1 should produce angle choices');
    assert.ok(topicArtifact.possibleAngles.every((angle) => angle.whyThisFitsTopic && angle.materialConnection && angle.writingPath), 'real Day 1 should explain topic fit, material use and writing path');
    assert.ok(JSON.stringify(topicArtifact).includes('塔子山') || JSON.stringify(topicArtifact).includes('鸟林'), 'real Day 1 should use the student material');
    await page.locator('.stage-angle-choice').first().click();
    await clickNext(page);

    await page.waitForSelector('#selectedAngleInput');
    const materialArtifact = await runStage(page, 'material_questions');
    await page.waitForSelector('.stage-answer-input');
    assert.ok(Array.isArray(materialArtifact.questions) && materialArtifact.questions.length >= 1, 'real Day 2 should produce material questions');
    const answerInputs = page.locator('.stage-answer-input');
    const answerCount = await answerInputs.count();
    for (let index = 0; index < answerCount; index += 1) {
      await answerInputs.nth(index).fill([
        '秋游那天上午，我们从学校出发，到了塔子山公园后先沿着林荫路往鸟林走。',
        '鸟林里树影很密，笼舍旁有潮湿的泥土味，几只小鸟在树枝间跳来跳去。',
        '我一开始只顾着和同学说笑，后来看到一只鸟反复啄羽毛，又停下来望着我们。',
        '那一刻我忽然觉得它们不是被我们观看的东西，而是和我们一样会紧张、会生活的小生命。'
      ][index] || '这个细节能说明我从热闹游玩转向认真观察和理解生命。');
    }
    await page.waitForSelector('[data-action="go-next-stage"]');
    await clickNext(page);

    await page.waitForSelector('[data-action="run-stage"]');
    const outlineArtifact = await runStage(page, 'outline_tree');
    await page.waitForSelector('.outline-tree');
    assert.ok(outlineArtifact.outlineTree && Array.isArray(outlineArtifact.outlineTree.children), 'real Day 3 should produce an outline tree');
    const outlineText = JSON.stringify(outlineArtifact);
    assert.ok(outlineText.length > 1200, 'outline should contain detailed guidance');
    assert.ok(outlineArtifact.outlineTree.children.every((node) => node.writeTask && Array.isArray(node.writingObjects) && Array.isArray(node.detailPlan) && Array.isArray(node.eventBeats) && Array.isArray(node.studentChecklist)), 'outline nodes should include detailed writing guidance fields');
    assert.ok(!outlineText.includes('秋游缘起'), 'outline should not collapse to vague four-character labels');
    assert.ok(/塔子山|鸟林|小鸟|秋游/.test(outlineText), 'outline should keep material anchors from the student input');
    await clickNext(page);

    await page.waitForSelector('[data-action="run-stage"]');
    const guidesArtifact = await runStage(page, 'paragraph_guides');
    await page.waitForSelector('.paragraph-guide-card');
    assert.ok(Array.isArray(guidesArtifact.paragraphGuides) && guidesArtifact.paragraphGuides.length >= 1, 'real Day 4 should produce paragraph guides');
    const guidesText = JSON.stringify(guidesArtifact);
    assert.ok(guidesText.length > 1800, 'paragraph guides should contain detailed guidance');
    assert.ok(guidesArtifact.paragraphGuides.every((guide) => Array.isArray(guide.writingTargets) && Array.isArray(guide.howToWrite) && Array.isArray(guide.detailsToInclude) && Array.isArray(guide.developmentSteps) && Array.isArray(guide.selfCheck)), 'paragraph guides should include detailed writing fields');
    assert.ok(/塔子山|鸟林|小鸟|秋游/.test(guidesText), 'paragraph guides should keep material anchors from the student input');
    await clickNext(page);

    await page.waitForSelector('.paragraph-draft-input');
    const draftInputs = page.locator('.paragraph-draft-input');
    const draftCount = await draftInputs.count();
    assert.ok(draftCount >= 1, 'Day 5 should render paragraph draft inputs from real guides');
    const paragraphTexts = [
      '最近下了两场雨，空气里带着夏末秋初的凉意。我们初一年级的同学们踏着轻快的脚步走进塔子山公园，路边树叶被风吹得轻轻晃动。',
      '走进鸟林时，我先听见细碎的叫声。几只小鸟在枝条间跳来跳去，一只鸟停在笼舍边，低头啄了啄羽毛，又忽然抬头看向我们。',
      '我原本只把这里当作秋游中好玩的景点，可看着那只鸟小心地挪动脚爪，我忽然安静下来。它不是给我们取乐的摆设，也有自己的害怕和生活。',
      '离开鸟林时，同学们还在讨论哪只鸟最好看，我却一直记得那双黑亮的小眼睛。那一天的秋游让我明白，真正的踏青不只是看风景，也是学着尊重身边的生命。'
    ];
    for (let index = 0; index < draftCount; index += 1) {
      await draftInputs.nth(index).fill(paragraphTexts[index] || paragraphTexts[paragraphTexts.length - 1]);
    }
    const draftingArtifact = await runStage(page, 'paragraph_drafting');
    await page.waitForSelector('#mergedDraftPreview');
    assert.strictEqual(draftingArtifact.localFallback, true, 'Day 5 is a local merge step');
    assert.ok(draftingArtifact.mergedDraft.includes('塔子山') && draftingArtifact.mergedDraft.includes('鸟林'), 'Day 5 should merge the real smoke draft text');
    await clickNext(page);

    await page.waitForSelector('#diagnosisDraftInput');
    const diagnosisArtifact = await runStage(page, 'draft_diagnosis');
    await page.waitForSelector('.priority-issue-choice');
    assert.ok(Array.isArray(diagnosisArtifact.priorityIssues) && diagnosisArtifact.priorityIssues.length >= 1, 'real Day 6 should produce priority issues');
    await page.locator('.priority-issue-choice').first().click();
    await clickNext(page);

    await page.waitForSelector('#revisedDraftInput');
    await page.fill('#studentSelfReflectionInput', '我学会了先写秋游里的具体景物和小鸟动作，再写自己从热闹游玩到尊重生命的变化。');
    const reflectionArtifact = await runStage(page, 'revision_reflection');
    await page.waitForSelector('text=训练复盘');
    assert.ok(Array.isArray(reflectionArtifact.learnedSkills), 'real Day 7 should produce learned skills');
    await page.waitForFunction(() => document.querySelector('#planStatus')?.textContent?.includes('已完成'));
    assert.deepStrictEqual(pageErrors, [], 'page should not throw uncaught errors');

    console.log(`OK real AI browser training smoke ${base} realStages=6 paragraphs=${draftCount}`);
  } finally {
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    const stateFile = path.join(tempDir, 'app-state.json');
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
