const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

async function clickRun(page) {
  await page.locator('[data-action="run-stage"]').first().click();
}

async function clickNext(page) {
  await page.locator('[data-action="go-next-stage"]').first().click();
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'training-full-ui-smoke-'));
  process.env.APP_DATA_DIR = tempDir;
  process.env.AI_API_KEY = '';
  const app = require('../server');
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 940 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(`${base}/training-plans.html`, { waitUntil: 'networkidle' });
    await page.click('[data-plan-type="7d"]');

    await page.waitForSelector('#stageTitleInput');
    await page.fill('#stageTitleInput', '那一刻，我长大了');
    await page.fill('#stageGradeInput', '初二');
    await page.fill('#stageGenreInput', '记叙文');
    await page.fill('#stageMaterialInput', '我第一次独自上台演讲，站在讲台前手一直在抖。');
    await clickRun(page);
    await page.waitForSelector('.stage-angle-choice');
    assert.ok(await page.locator('.stage-angle-choice').count() >= 1, 'Day 1 should render angle choices');
    await page.locator('.stage-angle-choice').first().click();
    await clickNext(page);

    await page.waitForSelector('#selectedAngleInput');
    await clickRun(page);
    await page.waitForSelector('.stage-answer-input');
    const answerInputs = page.locator('.stage-answer-input');
    const answerCount = await answerInputs.count();
    assert.ok(answerCount >= 3, 'Day 2 should render material questions');
    for (let index = 0; index < answerCount; index += 1) {
      await answerInputs.nth(index).fill([
        '周五下午的班会课，老师临时让我代表小组发言。',
        '我站在教室前面，能看见黑板角落还留着上一节课的公式。',
        '我把稿纸攥得很皱，先深吸一口气，再抬头看同学。',
        '我本来很想逃开，但讲完第一句后发现大家在认真听。'
      ][index] || '这个细节让我意识到自己真的开始面对害怕的事情。');
    }
    await page.waitForSelector('[data-action="go-next-stage"]');
    await clickNext(page);

    await page.waitForSelector('[data-action="run-stage"]');
    await clickRun(page);
    await page.waitForSelector('.outline-tree');
    assert.ok(await page.locator('.outline-node').count() >= 4, 'Day 3 should render an outline tree');
    await page.waitForSelector('text=这一段写什么');
    await page.waitForSelector('text=写作对象');
    await page.waitForSelector('text=细节安排');
    await clickNext(page);

    await page.waitForSelector('[data-action="run-stage"]');
    await clickRun(page);
    await page.waitForSelector('.paragraph-guide-card');
    const guideCount = await page.locator('.paragraph-guide-card').count();
    assert.ok(guideCount >= 4, 'Day 4 should render paragraph guides');
    await page.waitForSelector('text=分别怎么写');
    await page.waitForSelector('text=写作顺序');
    await page.waitForSelector('text=自查');
    await clickNext(page);

    await page.waitForSelector('.paragraph-draft-input');
    const draftInputs = page.locator('.paragraph-draft-input');
    const draftCount = await draftInputs.count();
    assert.ok(draftCount >= 4, 'Day 5 should render paragraph draft inputs');
    const paragraphTexts = [
      '周五下午的班会课快结束时，老师忽然叫到我的名字，让我代表小组上台发言。我站起来时，椅子腿在地上轻轻响了一下，手里的稿纸被我攥出了一道折痕。',
      '我走到讲台前，看见黑板角落还留着上一节数学课的公式，下面几十双眼睛都望着我。我的声音卡在喉咙里，第一句话差点没有说出来。',
      '那一刻，我想起小组讨论时大家把最后一段交给我的样子。我深吸了一口气，把稿纸往下放了放，抬头看着第一排同学，把准备好的内容慢慢说了出来。',
      '讲完后，教室里响起掌声。我走回座位时，手心还是湿的，但心里不再只剩害怕。后来再想起那一刻，我知道长大不是突然勇敢，而是害怕时仍然向前一步。'
    ];
    for (let index = 0; index < draftCount; index += 1) {
      await draftInputs.nth(index).fill(paragraphTexts[index] || paragraphTexts[paragraphTexts.length - 1]);
    }
    await clickRun(page);
    await page.waitForSelector('#mergedDraftPreview');
    const mergedDraft = await page.inputValue('#mergedDraftPreview');
    assert.ok(mergedDraft.includes('讲台') && mergedDraft.includes('向前一步'), 'Day 5 should merge paragraph drafts');
    const feedbackText = await page.locator('#trainingNextStepPanel').textContent();
    assert.ok(!feedbackText.includes('paragraphId'), 'Day 5 feedback should not expose raw JSON keys');
    assert.ok(feedbackText.includes('这一段') || feedbackText.includes('偏短'), 'Day 5 feedback should render readable Chinese feedback');
    await clickNext(page);

    await page.waitForSelector('#diagnosisDraftInput');
    assert.ok((await page.inputValue('#diagnosisDraftInput')).includes('讲台'), 'Day 6 should carry merged draft forward');
    await clickRun(page);
    await page.waitForSelector('.priority-issue-choice');
    assert.ok(await page.locator('.priority-issue-choice').count() >= 1, 'Day 6 should render priority issues');
    await page.locator('.priority-issue-choice').first().click();
    await clickNext(page);

    await page.waitForSelector('#revisedDraftInput');
    await page.fill('#studentSelfReflectionInput', '我学会了先写能看见的动作，再写心里的变化。');
    await clickRun(page);
    await page.waitForSelector('text=训练复盘');
    await page.waitForSelector('text=已完成');
    assert.deepStrictEqual(pageErrors, [], 'page should not throw uncaught errors');

    console.log(`OK full browser training smoke ${base} paragraphs=${draftCount}`);
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
