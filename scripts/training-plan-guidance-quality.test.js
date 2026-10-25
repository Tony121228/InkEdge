const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const serverSource = read('server.js');
const runnerSource = read('lib/seven-day-training-runner.js');
const frontendSource = read('public/training-plans.js');
const appSource = read('public/app.js');

const bannedPromptFragments = [
  '45 字以内',
  '35 字以内',
  '30 字以内',
  '25 字以内',
  '20 字以内',
  '最多 2 项',
  '尽量 25 字以内',
  '尽量 45 字以内',
  '短字符串',
  '内容精简'
];

for (const banned of bannedPromptFragments) {
  assert.ok(!serverSource.includes(banned), `server prompt should remove concise rule: ${banned}`);
}

const detailedFields = [
  'whyThisFitsTopic',
  'materialConnection',
  'writingPath',
  'keyDetailsToAsk',
  'riskReminder',
  'writeTask',
  'writingObjects',
  'detailPlan',
  'eventBeats',
  'emotionShift',
  'transitionHint',
  'studentChecklist',
  'writingTargets',
  'howToWrite',
  'detailsToInclude',
  'developmentSteps',
  'sensoryDetails',
  'innerThoughtPrompts',
  'selfCheck'
];

for (const field of detailedFields) {
  assert.ok(
    serverSource.includes(field) || runnerSource.includes(field),
    `guidance schema or fallback should include ${field}`
  );
  assert.ok(frontendSource.includes(field), `frontend should render ${field}`);
  assert.ok(appSource.includes(field), `main app should render ${field}`);
}

for (const uiText of ['为什么扣题', '怎样使用素材', '写作路径', '这一段写什么', '写作对象', '细节安排', '写作顺序', '自查']) {
  assert.ok(frontendSource.includes(uiText), `frontend should expose detailed guidance section: ${uiText}`);
  assert.ok(appSource.includes(uiText), `main app should expose detailed guidance section: ${uiText}`);
}

for (const anchorPrompt of ['素材锚点', '地名', '核心物件']) {
  assert.ok(serverSource.includes(anchorPrompt), `server prompt should require material anchor guidance: ${anchorPrompt}`);
}

console.log('OK training guidance quality checks');
