const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const baseUrl = process.env.DEMO_BASE_URL || 'http://localhost:3000';
const outDir = path.resolve('output/investor-demo');
fs.mkdirSync(outDir, { recursive: true });

const topics = [
  { title: '那一次，我学会了等待', grade: '初一', genre: '记叙文', material: '上学期我参加校运会接力赛，最后一棒前队友摔倒。我一边着急，一边陪他调整呼吸，最后我们没有拿到名次，却一起走完了比赛。' },
  { title: '一把旧伞', grade: '六年级', genre: '记叙文', material: '放学时突然下雨，奶奶把家里唯一一把旧伞送到校门口，自己淋着雨回家。我注意到伞柄上缠着一圈蓝色胶带。' },
  { title: '我终于明白了', grade: '初二', genre: '记叙文', material: '我准备参加演讲比赛，反复背稿却越背越紧张。老师让我先讲给同桌听，我从同桌的笑声里发现，真实表达比完美背诵更重要。' }
];
const selected = topics[Math.floor(Math.random() * topics.length)];
const essayText = `${selected.title}\n\n那天的天气并不特别，真正让我记住它的，是一件看起来很小的事。${selected.material}\n\n我原本只想着把事情做完，后来却发现，事情的意义常常藏在过程里。有人陪着我把慌乱慢下来，也让我第一次认真看见身边人的努力。\n\n回家的路上，我还在想，如果再遇到类似的时刻，我大概不会只盯着结果。我会先停一停，听清楚自己和别人真正需要什么。那一刻，我明白了成长不是突然变得厉害，而是愿意把一件小事做得更认真。`;

async function saveJson(name, value) { fs.writeFileSync(path.join(outDir, name), JSON.stringify(value, null, 2), 'utf8'); }
async function snap(page, name) { await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true }); }
async function waitForText(page, text, timeout = 300000) { await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout }); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));

  console.log(`DEMO_TOPIC=${selected.title}`);
  console.log(`DEMO_GRADE=${selected.grade}`);
  console.log(`DEMO_GENRE=${selected.genre}`);

  await page.goto(`${baseUrl}/app.html`, { waitUntil: 'networkidle' });
  await snap(page, '01-workspace-start');

  await page.locator('#topicInput').fill(selected.title);
  await page.locator('#gradeInput').selectOption({ label: selected.grade });
  await page.locator('#genreInput').selectOption({ label: selected.genre });
  await page.locator('#materialInput').fill(selected.material);
  await snap(page, '02-topic-material-input');
  await page.locator('#buildOutlineBtn').click();
  await page.locator('#brainstormResult').locator('text=立意方向').waitFor({ state: 'visible', timeout: 300000 }).catch(() => {});
  await snap(page, '03-topic-analysis');

  const angle = page.locator('#brainstormResult .angle-card:visible').first();
  if (await angle.count()) {
    await angle.click({ force: true });
    await page.waitForSelector('#brainstormResult .angle-card[aria-checked="true"]', { timeout: 10000 }).catch(() => {});
  } else {
    const angleButton = page.locator('#brainstormResult button').filter({ hasText: /选择|确认|采用/ }).first();
    if (await angleButton.count()) await angleButton.click();
  }
  await page.waitForTimeout(500);
  const materialBtn = page.locator('#generateMaterialQuestionsBtn');
  if (await materialBtn.count()) await materialBtn.click();
  await page.waitForSelector('#brainstormResult .material-answer-input', { state: 'visible', timeout: 300000 }).catch(() => {});
  await snap(page, '04-material-questions');

  const questionInputs = page.locator('#brainstormResult textarea, #brainstormResult input[type="text"]');
  const qCount = await questionInputs.count();
  for (let i = 0; i < qCount; i += 1) {
    const value = i === 0 ? '我先想到的是比赛前手心出汗，后来陪队友慢慢调整呼吸。' : i === 1 ? '操场边的喇叭声、塑胶跑道的气味和同学递来的矿泉水让我印象很深。' : '我最后没有继续催促，而是蹲下来听队友把话说完。';
    await questionInputs.nth(i).fill(value);
  }
  await snap(page, '05-material-answers');
  const continueBtn = page.locator('#brainstormResult button').filter({ hasText: /继续|生成提纲|完成回答|写作/ }).last();
  if (await continueBtn.count()) await continueBtn.click();
  await page.waitForTimeout(2000);
  await snap(page, '06-outline-and-guides');

  const reviseNav = page.locator('[data-view="revise"]:visible').first();
  await reviseNav.click({ timeout: 10000 });
  await page.waitForTimeout(500);
  const draft = page.locator('#draftInput');
  await draft.fill(essayText);
  await snap(page, '07-draft-written');
  await page.locator('#diagnoseBtn').click();
  await page.locator('#reviseResult').locator('text=优先问题').waitFor({ state: 'visible', timeout: 300000 }).catch(() => {});
  await snap(page, '08-diagnostic-report');

  const suggestBtn = page.locator('#suggestBtn');
  if (await suggestBtn.count() && await suggestBtn.isEnabled()) {
    await suggestBtn.click();
    await page.locator('#reviseResult').locator('text=问题说明').waitFor({ state: 'visible', timeout: 300000 }).catch(() => {});
    await snap(page, '09-revision-suggestion');
  } else {
    await snap(page, '09-revision-suggestion-unavailable');
  }

  const compareBtn = page.locator('#suggestionReferenceCompareBtn');
  if (await compareBtn.count()) {
    await compareBtn.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);
    await snap(page, '10-reference-comparison-entry');
    const refBtn = page.locator('button').filter({ hasText: /生成参考|生成/ }).last();
    if (await refBtn.count() && await refBtn.isEnabled()) {
      await refBtn.click();
      await page.waitForTimeout(300000).catch(() => {});
      await snap(page, '11-reference-comparison-result');
    }
  } else {
    await snap(page, '10-reference-comparison-unavailable');
  }

  await saveJson('demo-input.json', { topic: selected, essayText, capturedAt: new Date().toISOString(), errors });
  fs.writeFileSync(path.join(outDir, 'demo-steps.md'), `# InkEdge 投资人演示实测记录\n\n- 题目：${selected.title}\n- 年级：${selected.grade}\n- 文体：${selected.genre}\n- 素材：${selected.material}\n\n## 截图\n\n${fs.readdirSync(outDir).filter(f => f.endsWith('.png')).sort().map(f => `- ${f}`).join('\n')}\n\n## 页面错误\n\n${errors.length ? errors.map(e => `- ${e}`).join('\n') : '- 未捕获页面级错误'}\n`, 'utf8');
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
