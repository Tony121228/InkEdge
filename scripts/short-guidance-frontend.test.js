const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function read(filePath) {
  assert(fs.existsSync(filePath), `${filePath} should exist`);
  return fs.readFileSync(filePath, 'utf8');
}

const indexHtml = read('public/index.html');
const accountHtml = read('public/account.html');
const configJs = read('public/config.js');
const apiClientJs = read('public/api-client.js');
const themeJs = read('public/theme.js');
const appJs = read('public/app.js');
const accountJs = read('public/account.js');
const serverJs = read('server.js');

for (const script of ['config.js', 'api-client.js', 'theme.js', 'app.js']) {
  assert(indexHtml.includes(script), `index.html should load ${script}`);
}

for (const script of ['config.js', 'api-client.js', 'theme.js', 'account.js']) {
  assert(accountHtml.includes(script), `account.html should load ${script}`);
}

assert(configJs.includes("API_BASE_URL: ''"), 'frontend should use same-origin backend by default');
assert(configJs.includes("API_PREFIX: '/api/v1'"), 'frontend should target /api/v1');
assert(configJs.includes('USE_BACKEND: true'), 'frontend should enable backend API calls');
const timeoutMatch = configJs.match(/REQUEST_TIMEOUT_MS:\s*(\d+)/);
assert(timeoutMatch, 'frontend should configure a request timeout');
assert(Number(timeoutMatch[1]) >= 150000, 'frontend timeout should cover backend model retry window');
assert(apiClientJs.includes('window.EssayCoachAPI'), 'api-client should expose EssayCoachAPI');
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

for (const method of [
  'createEssaySession',
  'analyzeTopic',
  'getMaterialQuestions',
  'generateGuidedWriting'
]) {
  assert(appJs.includes(method), `app.js should call ${method} in the interactive brainstorm flow`);
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

assert(accountJs.includes('getMe'), 'account page should hydrate through the v1 API client');
assert(appJs.includes('runWithButtonLoading'), 'app.js should guard async buttons with a busy state');

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
