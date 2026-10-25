const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'training-ui-smoke-'));
  process.env.APP_DATA_DIR = tempDir;
  process.env.AI_API_KEY = '';
  const app = require('../server');
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(`${base}/training-plans.html`, { waitUntil: 'networkidle' });
    await page.click('[data-plan-type="7d"]');

    await page.waitForSelector('#stageTitleInput');
    await page.fill('#stageTitleInput', '那一刻，我长大了');
    await page.fill('#stageGradeInput', '初二');
    await page.fill('#stageGenreInput', '记叙文');
    await page.fill('#stageMaterialInput', '我第一次独自上台演讲，手一直在抖。');
    await page.click('[data-action="run-stage"]');
    await page.waitForSelector('.stage-angle-choice');

    const angleCount = await page.locator('.stage-angle-choice').count();
    assert.ok(angleCount >= 1, 'Day 1 should keep angle choices visible after generation');

    await page.locator('.stage-angle-choice').first().click();
    await page.click('[data-action="go-next-stage"]');
    await page.waitForSelector('#selectedAngleInput');
    const selectedAngle = await page.inputValue('#selectedAngleInput');
    assert.ok(selectedAngle.trim(), 'selected angle should flow into Day 2');
    assert.deepStrictEqual(pageErrors, [], 'page should not throw uncaught errors');

    console.log(`OK browser training smoke ${base} angles=${angleCount}`);
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
