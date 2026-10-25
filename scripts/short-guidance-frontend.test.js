const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function read(filePath) {
  assert(fs.existsSync(filePath), `${filePath} should exist`);
  return fs.readFileSync(filePath, 'utf8');
}

const indexHtml = read('public/index.html');
const appHtml = read('public/app.html');
const accountHtml = read('public/account.html');
const configJs = read('public/config.js');
const apiClientJs = read('public/api-client.js');
const themeJs = read('public/theme.js');
const appJs = read('public/app.js');
const stylesCss = read('public/styles.css');
const appAppleCss = read('public/app-apple.css');
const accountJs = read('public/account.js');
const trainingPlansHtml = read('public/training-plans.html');
const trainingPlansJs = read('public/training-plans.js');
const serverJs = read('server.js');

for (const script of ['config.js', 'api-client.js', 'theme.js', 'app.js']) {
  assert(appHtml.includes(script), `app.html should load ${script}`);
}

assert(appHtml.includes('<h1 id="dashboardTitle">InkEdge</h1>'), 'dashboard title should be shortened to InkEdge');
for (const removedOverview of ['today-board', 'quick-grid', 'action-grid']) {
  assert(!appHtml.includes(removedOverview), `app.html should remove oversized overview block: ${removedOverview}`);
}
for (const removedDashboardWrite of [
  "$('#completedCount').textContent",
  "$('#todayFocus').textContent",
  "$('#todayProgress').style.width",
  "$('#todayMeta').textContent"
]) {
  assert(!appJs.includes(removedDashboardWrite), `app.js should not directly write removed dashboard element: ${removedDashboardWrite}`);
}
for (const removedNotebookText of ['错因本', '个人错因本', 'Error Notebook', 'error-notebook', 'view-notebook', 'notebookList', 'renderNotebook', 'getErrorNotebook', 'createErrorNotebookItem']) {
  assert(!appHtml.includes(removedNotebookText), `app.html should not expose error notebook text or markup: ${removedNotebookText}`);
  assert(!appJs.includes(removedNotebookText), `app.js should not expose error notebook logic: ${removedNotebookText}`);
  assert(!apiClientJs.includes(removedNotebookText), `api-client should not expose error notebook API: ${removedNotebookText}`);
}
for (const removedNotebookStyle of ['notebook-list', 'notebook-item', 'notebook-index']) {
  assert(!stylesCss.includes(removedNotebookStyle), `styles.css should remove error notebook style: ${removedNotebookStyle}`);
  assert(!appAppleCss.includes(removedNotebookStyle), `app-apple.css should remove error notebook style: ${removedNotebookStyle}`);
}
assert(!serverJs.includes("app.get('/api/v1/error-notebook'"), 'server should remove error notebook read endpoint');
assert(!serverJs.includes("app.post('/api/v1/error-notebook/items'"), 'server should remove error notebook write endpoint');
assert(appHtml.includes('overviewFeatureGrid'), 'dashboard overview should contain the main feature card grid');
for (const overviewCard of ['data-overview-goto="brainstorm"', 'data-overview-goto="revise"', 'data-overview-goto="materials"', 'data-overview-goto="training"']) {
  assert(appHtml.includes(overviewCard), `dashboard overview should include feature card ${overviewCard}`);
}
assert(appJs.includes('[data-overview-goto]'), 'app.js should wire overview feature card navigation');

for (const [view, label] of [
  ['dashboard', '导航'],
  ['brainstorm', '作文构思'],
  ['revise', '作文修改'],
  ['training', '写作计划'],
  ['growth', '成长记录']
]) {
  assert(
    appHtml.includes('data-view="' + view + '">' + label + '</button>'),
    'sidebar navigation must show the annotated label ' + label
  );
}
assert(appHtml.includes('<p class="eyebrow">写作训练工作台</p>'), 'workspace eyebrow must use the annotated name');
assert(appHtml.includes('<h2 id="brainstormTitle">文章构思</h2>'), 'brainstorm heading must use the annotated name');
assert(appHtml.includes('<h2 id="reviseTitle">修改作文</h2>'), 'revision heading must use the annotated name');
assert(appHtml.includes('<option>散文</option>'), 'genre selector must include prose');
assert(appHtml.includes('作文标题'), 'brainstorm form must label the topic as a title');
assert((appHtml.match(/<option value="custom">其他<\/option>/g) || []).length >= 2, 'both revision selectors must expose custom options');
for (const customInput of ['reviseGoalCustom', 'reviseDepthCustom']) {
  assert(appHtml.includes('id="' + customInput + '"'), 'revision form must include ' + customInput);
}
assert(appJs.includes("bindCustomRevisionSelect('reviseGoalInput', 'reviseGoalCustom')"), 'revision goal custom input must be wired');
assert(appJs.includes("bindCustomRevisionSelect('reviseDepthInput', 'reviseDepthCustom')"), 'revision depth custom input must be wired');
assert(appJs.includes('data-score-scale="10"') && appJs.includes('aria-valuemax="10"'), 'diagnostic score cards must use a ten-point scale');
assert(appJs.includes('value * 10'), 'diagnostic score bar width must match the ten-point value');
assert(!appHtml.includes('id="suggestBtn"'), 'local revision button must not be available before diagnosis');
assert(appJs.includes('suggestionActionSlot'), 'local revision button must render after the priority issue card');
assert(appJs.includes('revisionFlowState'), 'revision flow must retain the completed diagnostic session');
assert(/suggestionDemo[\s\S]*getRevisionSuggestions[\s\S]*diagnosticId/.test(appJs), 'local revision suggestions must reuse the completed diagnostic');
assert(!/async function suggestionDemo[\s\S]*?diagnoseEssay/.test(appJs), 'local revision suggestions must not rerun diagnosis');
assert(!appJs.includes('diagnosticReferenceCompareBtn'), 'reference comparison must not be attached to the diagnosis card');
for (const referenceHook of [
  'suggestionReferenceCompareBtn',
  'inkedgeReferenceComparisonContext',
  '/reference-comparison.html'
]) {
  assert(appJs.includes(referenceHook), 'reference comparison flow must include ' + referenceHook);
}
assert(apiClientJs.includes('generateReferenceRewrite'), 'API client must expose reference rewrite');
for (const referenceFile of ['public/reference-comparison.html', 'public/reference-comparison.js', 'public/reference-comparison.css']) {
  assert(fs.existsSync(referenceFile), referenceFile + ' must exist');
}

assert(indexHtml.includes('app.html'), 'landing index.html should link to the application entry');
for (const gradeLabel of ['三年级', '四年级', '五年级', '六年级']) {
  assert(appHtml.includes(`<option>${gradeLabel}</option>`), `brainstorm grade selector should include ${gradeLabel}`);
}

assert(accountHtml.includes('account.js'), 'account.html should load the account page script');
assert(appHtml.includes('account.html'), 'app.html should link to the account center');

assert(configJs.includes("API_BASE_URL: ''"), 'frontend should use same-origin backend by default');
assert(configJs.includes("API_PREFIX: '/api/v1'"), 'frontend should target /api/v1');
assert(configJs.includes('USE_BACKEND: true'), 'frontend should enable backend API calls');
const timeoutMatch = configJs.match(/REQUEST_TIMEOUT_MS:\s*(\d+)/);
assert(timeoutMatch, 'frontend should configure a request timeout');
assert.strictEqual(Number(timeoutMatch[1]), 300000, 'frontend timeout should be 300 seconds for writing guidance');
assert(apiClientJs.includes('window.EssayCoachAPI'), 'api-client should expose EssayCoachAPI');
assert(apiClientJs.includes('300000'), 'api-client default timeout should also be 300 seconds');
assert(apiClientJs.includes('请求超时'), 'api-client should translate AbortController timeout into a readable message');
assert(themeJs.includes('data-theme-toggle'), 'theme script should wire the latest frontend theme toggle');

for (const method of [
  'createEssaySession',
  'analyzeTopic',
  'getMaterialQuestions',
  'saveMaterial',
  'generateOutline',
  'diagnoseEssay',
  'getRevisionSuggestions',
  'createReflection',
  'createStyleProfile',
  'generateGuidedWriting'
]) {
  assert(apiClientJs.includes(method), `api-client should expose ${method}`);
}

for (const frontendHook of [
  'brainstormState',
  'renderInteractiveBrainstorm',
  'generateWritingGuideDemo',
  'renderOutlineTree',
  'renderParagraphGuides',
  'material-answer-input',
  'writing-guide-area',
  'outline-tree'
]) {
  assert(appJs.includes(frontendHook), `app.js should include interactive brainstorm hook: ${frontendHook}`);
}
for (const detailedGuidanceHook of [
  'guidanceDetailList',
  'whyThisFitsTopic',
  'materialConnection',
  'writingPath',
  'keyDetailsToAsk',
  'writeTask',
  'writingObjects',
  'detailPlan',
  'eventBeats',
  'writingTargets',
  'howToWrite',
  'detailsToInclude',
  'developmentSteps',
  'selfCheck'
]) {
  assert(appJs.includes(detailedGuidanceHook), `app.js should expose detailed brainstorm guidance hook: ${detailedGuidanceHook}`);
}

for (const route of [
  "app.get('/api/v1/me'",
  "app.get('/api/v1/dashboard'",
  "app.post('/api/v1/essay-sessions'",
  "app.post('/api/v1/essay-sessions/:sessionId/guided-writing'",
  "app.post('/api/v1/style-profile'",
  "app.get('/api/v1/ability/profile'",
  "app.get('/api/v1/training-tasks/today'",
  "app.get('/api/v1/growth/timeline'"
]) {
  assert(serverJs.includes(route), `server.js should expose ${route}`);
}

for (const legacyEndpoint of ['/api/detect', '/api/rewrite', '/api/train']) {
  assert(!apiClientJs.includes(legacyEndpoint), `api-client should not call legacy endpoint ${legacyEndpoint}`);
  assert(!appJs.includes(legacyEndpoint), `app.js should not call legacy endpoint ${legacyEndpoint}`);
}

assert(accountJs.includes("fetchJson('/api/me')"), 'account page should hydrate account data from the account API');
assert(appJs.includes('runWithButtonLoading'), 'app.js should guard async buttons with a busy state');
for (const frontendNormalizer of [
  'function normalizeDimensionScore',
  'function dimensionScoreEntries',
  'function renderDiagnosticScoreDetails',
  'function renderAbilityDimensionDetails'
]) {
  assert(appJs.includes(frontendNormalizer), `app.js should normalize and render score object details: ${frontendNormalizer}`);
}
assert(
  /renderBackendDiagnostic[\s\S]*renderDiagnosticScoreDetails/.test(appJs),
  'backend diagnostic renderer should show detailed score objects instead of flattening them to zero'
);
assert(
  /hydrateDashboardFromBackend[\s\S]*dimensionScoreEntries/.test(appJs),
  'dashboard hydration should support object-shaped dimensionScores'
);

for (const trainingHook of [
  'training-plan-shell',
  'training-workbench',
  'training-stage-timeline',
  'training-stage-panel',
  'training-artifact-panel',
  'training-next-step-panel',
  'plan-create-button',
  'renderTrainingWorkspace',
  'setButtonBusy'
]) {
  assert(
    trainingPlansHtml.includes(trainingHook) || trainingPlansJs.includes(trainingHook),
    `training plan UI should include ${trainingHook}`
  );
}

assert(!trainingPlansJs.includes('alert('), 'training plan UI should render inline status instead of alert popups');
assert(apiClientJs.includes('runTrainingPlanTask'), 'api-client should expose runTrainingPlanTask');
for (const sevenDayHook of [
  'seven-day-plan-form',
  'trainingCreatePanel',
  'trainingStageTimeline',
  'trainingStagePanel',
  'trainingArtifactPanel',
  'trainingNextStepPanel',
  'renderCreatePanel',
  'renderStageTimeline'
]) {
  assert(
    trainingPlansHtml.includes(sevenDayHook) || trainingPlansJs.includes(sevenDayHook) || apiClientJs.includes(sevenDayHook),
    `training plan page should include 7-day guide hook: ${sevenDayHook}`
  );
}
assert(trainingPlansHtml.includes('trainingWorkbench'), 'training plan page should focus on the rebuilt 7-day workbench');
assert(
  trainingPlansHtml.includes('data-plan-type="7d"') || trainingPlansJs.includes('data-plan-type="7d"'),
  'training plan page should expose the 7-day plan entry'
);
for (const unrelatedPlanText of ['data-plan-type="14d"', 'data-plan-type="30d"', 'data-plan-type="examSprint"', '14 天', '30 天', '考前 10 天']) {
  assert(!trainingPlansHtml.includes(unrelatedPlanText), `training plan page should not show unrelated preset: ${unrelatedPlanText}`);
}

async function assertTimeoutMessageIsReadable() {
  const context = {
    window: {
      ESSAY_COACH_CONFIG: {
        API_BASE_URL: '',
        API_PREFIX: '/api/v1',
        USE_BACKEND: true,
        REQUEST_TIMEOUT_MS: 1
      }
    },
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        reject(new Error('signal is aborted without reason'));
      });
    })
  };
  vm.createContext(context);
  vm.runInContext(apiClientJs, context);
  try {
    await context.window.EssayCoachAPI.createEssaySession({ mode: 'brainstorm', title: '测试' });
    assert.fail('timeout request should fail');
  } catch (error) {
    assert(error.message.includes('请求超时'), 'timeout error should be readable for users');
    assert(!error.message.includes('signal is aborted without reason'), 'timeout error should not expose raw abort text');
  }
}

assertTimeoutMessageIsReadable().catch((error) => {
  console.error(error);
  process.exit(1);
});
