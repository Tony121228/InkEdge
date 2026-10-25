# 全功能问题修复与素材库智能化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依次修复真实作文素材全功能冒烟测试暴露的问题，并把素材库改造成“只输入素材，由 AI 自动分类、生成适合题目并保存”的可用功能。

**Architecture:** 保持当前 Node.js + Express + 静态前端结构，不引入 React/Vue 或构建链。后端先补稳定性、权限和数据聚合，前端再消费稳定结构；素材库智能分类优先走 DeepSeek，缺 Key 或模型失败时走本地规则兜底。

**Tech Stack:** Node.js、Express、静态 HTML/CSS/JS、DeepSeek Chat API、Cloudflare Worker/D1 兼容状态层、Playwright、现有 `scripts/*.test.js` 测试脚本。

**Spec:** `docs/reports/真实作文素材全功能冒烟测试报告-1.md` 与用户当前需求：“先依次修反映出来的问题；素材库只输入素材，AI 自动分类以及生成适合的题目，并存入素材库；去掉原来的 3 个输入框。”

## Global Constraints

- 删除文件时只允许一个一个删除；本计划不需要删除文件。
- 不推送 Git，不改线上资源，除非用户后续明确要求部署。
- 读取中文文件用 Node.js UTF-8，不用 PowerShell 直接读取。
- 搜索范围限制在 `D:\tony\黑客松项目`。
- 每个生产代码改动前先写失败测试并看见红灯。
- 大规模改动完成后保存冒烟报告到 `docs/reports/`，编号递增。
- 如测试启动本地服务，测试结束必须关闭进程。

---

## File Structure

- Modify: `server.js`
  - 拆分短期 `guided-writing` 模型调用。
  - 增加作文会话用户归属校验。
  - 增加素材智能分类模型调用与兜底。
  - 聚合成长时间线数据。
  - 收紧训练计划 `planType`。
  - 调整局部修改提示词的事实边界。
- Modify: `public/app.html`
  - 素材库移除“素材标题 / 场景分类 / 适合题目”三个输入框。
  - 年级下拉补小学年级。
- Modify: `public/app.js`
  - 素材库只读取素材正文并展示 AI 分类结果、适合题目、素材卡列表。
  - 成长页改为从后端 timeline 渲染真实节点。
  - 体检分数兼容对象型 score。
  - 能力画像展示八维分数、证据和建议。
- Modify: `public/api-client.js`
  - 保留现有 `saveMaterial(sessionId, body)`，前端传入 `rawMaterial` 或 `event`。
  - 若新增素材列表接口，则增加 `getEssaySession` 复用，不额外扩展客户端。
- Modify: `public/styles.css`
  - 增加素材卡、AI 分类标签、适合题目列表、成长节点、能力维度条的样式。
- Modify: `lib/essay-guidance.js`
  - 如现有本地素材卡规则不足，补充 `classifyMaterialLocally()` 或扩展 `saveMaterialCard()` 的兼容输入。
- Modify: `lib/long-term-ability.js`
  - 如成长时间线聚合逻辑适合抽出纯函数，则新增 `buildGrowthTimelineSnapshot(state, userId)`。
- Create: `scripts/essay-guidance-guided-writing-split.test.js`
- Create: `scripts/essay-session-ownership.test.js`
- Create: `scripts/growth-timeline-derived-events.test.js`
- Create: `scripts/material-library-ai-classification.test.js`
- Create: `scripts/app-material-library-ui.test.js`
- Modify: `scripts/essay-guidance-model-json-parse-no-retry.test.js`
  - 保持底层 JSON 解析失败不做全局重试的语义，但不阻止 `guided-writing` 自己拆分或局部修复。
- Modify: `scripts/short-guidance-frontend.test.js`
  - 增加小学年级和素材库新输入结构断言。
- Modify: `package.json`
  - 增加本轮新增测试脚本。

---

## Task 1: 稳定短期 guided-writing 生成链路

**Files:**
- Create: `scripts/essay-guidance-guided-writing-split.test.js`
- Modify: `server.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `callEssayGuidanceModel(taskName, input, outputContract, options)`
- Produces: `POST /api/v1/essay-sessions/:sessionId/guided-writing` 仍返回 `{ outlineTree, paragraphGuides, missingMaterialQuestions, nextAction, studentTask }`

- [ ] **Step 1: Write failing test**

Test behavior:

```js
// scripts/essay-guidance-guided-writing-split.test.js
// Arrange a fake DeepSeek server.
// First essay session receives real initialMaterial.
// Calling /guided-writing must trigger two smaller model tasks:
//   1. taskName includes "提纲树" and output includes { outlineTree }
//   2. taskName includes "段落写作提示" and output includes { paragraphGuides }
// Assert response has 4 outline children, 4 paragraphGuides, nextAction=write_paragraph_1.
// Assert both model inputs include the student's material anchors "妈妈", "发烧", "朗读比赛", "煮粥", "书包".
```

- [ ] **Step 2: Run test to verify red**

Run: `node scripts/essay-guidance-guided-writing-split.test.js`

Expected: FAIL because the current endpoint makes one combined `交互式写作引导` model call.

- [ ] **Step 3: Implement split calls**

In `server.js`, change `guided-writing` to:

```js
const outlineResult = await callEssayGuidanceModel(
  '短期写作引导：生成提纲树',
  input,
  GUIDANCE_OUTPUT_CONTRACTS.outlineTree,
  { maxTokens: 4200 }
);

const outlineTree = normalizeGuidedOutlineTree(outlineResult.outlineTree, session, req.body);

const paragraphResult = await callEssayGuidanceModel(
  '短期写作引导：生成段落写作提示',
  { ...input, outlineTree },
  GUIDANCE_OUTPUT_CONTRACTS.paragraphGuides,
  { maxTokens: 5200 }
);
```

Add small normalizers in `server.js`:

```js
function normalizeGuidedOutlineTree(value, session, body) { /* return object with 4 children or local fallback */ }
function normalizeGuidedParagraphGuides(value) { /* return array, max 6, min 0 */ }
function guidedStudentTask(nextAction, paragraphGuides) { /* if writing, tell student to start first paragraph */ }
```

- [ ] **Step 4: Verify green**

Run:

```text
node scripts/essay-guidance-guided-writing-split.test.js
npm run test:short-guidance-frontend
npm run test:essay-guidance
npm run test:guidance-json-parse-no-retry
```

Expected: all pass.

---

## Task 2: 作文会话用户归属校验

**Files:**
- Create: `scripts/essay-session-ownership.test.js`
- Modify: `server.js`

**Interfaces:**
- Produces: `assertOwnedEssaySession(req, res, sessionId)` or equivalent helper.
- Existing session routes must reject cross-user reads and writes.

- [ ] **Step 1: Write failing test**

Test behavior:

```js
// User A with X-Forwarded-For=10.231.42.17 creates a brainstorm session and saves materials.
// User A can GET /api/v1/essay-sessions/:sessionId and sees materials.
// User B with X-Forwarded-For=10.231.42.18 GETs the same sessionId.
// Expected: 404 SESSION_NOT_FOUND or 403 SESSION_FORBIDDEN.
// User B POSTs /materials, /topic-analysis, /guided-writing, /diagnose to same sessionId.
// Expected: each rejects, no data is appended to User A session.
```

- [ ] **Step 2: Run test to verify red**

Run: `node scripts/essay-session-ownership.test.js`

Expected: FAIL because `assertEssaySession()` currently only matches by id.

- [ ] **Step 3: Implement owned session helper**

In `server.js`, add:

```js
function essaySessionOwnerId(session) {
  return String(session?.studentId || session?.userId || '').trim();
}

function assertOwnedEssaySession(req, res, sessionId) {
  const session = assertEssaySession(sessionId);
  const ownerId = essaySessionOwnerId(session);
  const viewerId = currentStudentId(req, res);
  if (ownerId && ownerId !== viewerId) {
    const error = new Error('作文会话不存在');
    error.status = 404;
    error.failureCode = 'SESSION_NOT_FOUND';
    throw error;
  }
  if (!ownerId) {
    session.studentId = viewerId;
  }
  return session;
}
```

Update all `/api/v1/essay-sessions/:sessionId/*` routes to use `assertOwnedEssaySession(req, res, req.params.sessionId)`.

- [ ] **Step 4: Verify green**

Run:

```text
node scripts/essay-session-ownership.test.js
npm run test:essay-guidance
npm run test:short-guidance-frontend
```

Expected: all pass.

---

## Task 3: 素材库改为 AI 智能分类与题目生成

**Files:**
- Create: `scripts/material-library-ai-classification.test.js`
- Create: `scripts/app-material-library-ui.test.js`
- Modify: `server.js`
- Modify: `lib/essay-guidance.js`
- Modify: `public/app.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `package.json`

**Interfaces:**
- Consumes: `POST /api/v1/essay-sessions/:sessionId/materials`
- Produces: material card fields:
  - `title:string`
  - `scene:string`
  - `category:string`
  - `event:string`
  - `people:string[]`
  - `places:string[]`
  - `actions:string[]`
  - `sensoryDetails:string[]`
  - `emotions:string[]`
  - `suitableTopics:string[]`
  - `topicReasons:{topic,reason}[]`
  - `writingAngles:string[]`
  - `keywords:string[]`
  - `completenessScore:number`

- [ ] **Step 1: Write backend failing test**

Test behavior:

```js
// scripts/material-library-ai-classification.test.js
// Fake DeepSeek receives taskName "素材智能分类与题目生成".
// Request body only sends rawMaterial/event text:
// "运动会800米最后一圈，我听见同学喊我的名字..."
// Assert no title, scene, suitableTopics are required from the client.
// Assert saved material returns AI-generated category "挫折与坚持",
// title "800米最后一圈",
// suitableTopics contains "坚持的力量" and "那一次，我没有放弃".
// Assert GET session reads the saved material back.
```

- [ ] **Step 2: Verify red**

Run: `node scripts/material-library-ai-classification.test.js`

Expected: FAIL because current backend only saves manually supplied title/scene/topic.

- [ ] **Step 3: Write frontend failing test**

Test behavior:

```js
// scripts/app-material-library-ui.test.js
// Load public/app.html + public/app.js in jsdom or Playwright.
// Assert #materialTitleInput is absent.
// Assert #materialSceneInput is absent.
// Assert #materialTopicInput is absent.
// Assert #materialDetailInput exists and button text includes "智能生成素材卡".
// Mock EssayCoachAPI.saveMaterial and verify body has rawMaterial/event only.
// Assert rendered result includes AI category, suitable topics, keywords and original material anchor.
```

- [ ] **Step 4: Verify red**

Run: `node scripts/app-material-library-ui.test.js`

Expected: FAIL because the three old inputs still exist.

- [ ] **Step 5: Implement backend AI classification**

In `server.js`, add `GUIDANCE_OUTPUT_CONTRACTS.materialCard`:

```js
materialCard: '只返回合法 JSON 对象，固定键为 title、scene、category、event、people、places、actions、sensoryDetails、emotions、suitableTopics、topicReasons、writingAngles、keywords、completenessScore。根据学生输入的一段真实素材自动分类，并生成 5-8 个适合作文题目。不要编造素材中不存在的人物、地点、动作。'
```

In `/materials` route:

```js
const rawMaterial = String(req.body?.rawMaterial || req.body?.event || req.body?.detail || '').trim();
if (countCjk(rawMaterial) < 10) return v1Error(req, res, 400, 'MATERIAL_TOO_SHORT', '请至少输入一段具体素材');
const classified = await buildSmartMaterialCard(rawMaterial, session);
```

Add helper:

```js
async function buildSmartMaterialCard(rawMaterial, session) {
  try {
    const modelResult = await callEssayGuidanceModel('素材智能分类与题目生成', {
      rawMaterial,
      title: session.title,
      grade: session.grade,
      genre: session.genre
    }, GUIDANCE_OUTPUT_CONTRACTS.materialCard, { maxTokens: 2600 });
    return normalizeSmartMaterialCard(modelResult, rawMaterial);
  } catch (error) {
    const fallback = essayGuidance.saveMaterialCard({ event: rawMaterial });
    return normalizeSmartMaterialCard(fallback.material, rawMaterial, { localFallback: true });
  }
}
```

- [ ] **Step 6: Implement frontend one-input material library**

In `public/app.html`, remove the three old input blocks:

```html
<input id="materialTitleInput">
<select id="materialSceneInput">
<input id="materialTopicInput">
```

Keep one textarea:

```html
<textarea id="materialDetailInput" rows="8" placeholder="只写一段真实素材：发生了什么、谁在场、做了什么、你看到听到感受到什么"></textarea>
```

In `public/app.js`, `saveMaterialDemo()` reads only:

```js
const detail = $('#materialDetailInput').value.trim();
const material = await window.EssayCoachAPI.saveMaterial(sessionId, {
  rawMaterial: detail,
  event: detail
});
```

Render AI fields:

```js
renderMaterialCard(material.material || material)
```

- [ ] **Step 7: Verify green**

Run:

```text
node scripts/material-library-ai-classification.test.js
node scripts/app-material-library-ui.test.js
npm run test:short-guidance-frontend
```

Expected: all pass.

---

## Task 4: 成长地图从真实数据生成

**Files:**
- Create: `scripts/growth-timeline-derived-events.test.js`
- Modify: `server.js`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `package.json`

**Interfaces:**
- Produces: `GET /api/v1/growth/timeline` returns:
  - `timeline:{eventId,type,title,summary,createdAt,evidence,nextAction}[]`
  - `abilityChanges:{dimension,before,after,delta,evidence}[]`
  - `completedPlans:array`
  - `essayMilestones:array`
  - `badges:array`
  - `currentStage:string`
  - `nextSuggestions:string[]`

- [ ] **Step 1: Write failing test**

Test behavior:

```js
// Create ability assessment for User A.
// Update profile from reflection with changed dimensions.
// Create a 7d training plan.
// Submit one training task.
// Diagnose one essay session.
// GET /api/v1/growth/timeline.
// Assert timeline length >= 4.
// Assert abilityChanges length >= 1.
// Assert currentStage is not empty.
// Assert User B timeline does not include User A events.
```

- [ ] **Step 2: Verify red**

Run: `node scripts/growth-timeline-derived-events.test.js`

Expected: FAIL because current endpoint returns empty timeline and abilityChanges.

- [ ] **Step 3: Implement aggregation**

In `server.js`, replace empty response with `buildGrowthTimelineForUser(userId)`:

```js
function buildGrowthTimelineForUser(userId) {
  const profiles = (state.abilityProfiles || []).filter((item) => item.userId === userId);
  const sessions = (state.essaySessions || []).filter((item) => item.studentId === userId || item.userId === userId);
  const plans = (state.trainingPlans || []).filter((item) => item.userId === userId);
  const submissions = (state.trainingTaskSubmissions || []).filter((item) => item.userId === userId);
  // build timeline from assessment, reflection updates, sessions, diagnoses, submissions, completed plans.
}
```

Rules:
- 初始测评生成“完成能力诊断”节点。
- profile `recentChanges` 生成能力变化。
- 作文体检生成“完成作文体检”节点。
- 训练任务提交生成“完成训练任务”节点。
- 已完成计划生成“完成 7 天训练计划”节点。
- 若没有真实节点，返回空数组但 `nextSuggestions` 提示先完成测评或训练。

- [ ] **Step 4: Implement growth UI**

In `public/app.js`, make growth tab request API:

```js
const timeline = await window.EssayCoachAPI.getGrowthTimeline();
renderGrowthTimeline(timeline);
```

Render:
- 当前阶段
- 最近能力变化
- 时间线节点
- 下一步建议
- 空态只在确实没有节点时展示

- [ ] **Step 5: Verify green**

Run:

```text
node scripts/growth-timeline-derived-events.test.js
npm run test:long-term-ability
```

Expected: all pass.

---

## Task 5: UI 问题修复：小学年级、体检分数、能力八维详情

**Files:**
- Modify: `public/app.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `scripts/short-guidance-frontend.test.js`
- Modify: `scripts/long-term-ability.test.js` only if existing assertions need expanded UI contract

**Interfaces:**
- Produces: visible grade options `三年级`、`四年级`、`五年级`、`六年级`。
- Produces: score rendering accepts number and object `{ score, level, evidence, suggestion }`。

- [ ] **Step 1: Update failing frontend contract test**

Add assertions:

```js
assert(html.includes('<option>五年级</option>'));
assert(appJs.includes('normalizeDimensionScore'));
assert(appJs.includes('renderAbilityDimensionDetails'));
```

- [ ] **Step 2: Verify red**

Run: `npm run test:short-guidance-frontend`

Expected: FAIL until UI code is changed.

- [ ] **Step 3: Implement grade options**

In `public/app.html`, add options before 初一:

```html
<option>三年级</option>
<option>四年级</option>
<option>五年级</option>
<option>六年级</option>
```

- [ ] **Step 4: Implement score normalization**

In `public/app.js`, add:

```js
function normalizeDimensionScore(value) {
  if (typeof value === 'number') return { score: value, level: '', evidence: '', suggestion: '' };
  if (value && typeof value === 'object') {
    return {
      score: Number(value.score ?? value.value ?? 0) || 0,
      level: String(value.level || ''),
      evidence: String(value.evidence || ''),
      suggestion: String(value.suggestion || '')
    };
  }
  return { score: 0, level: '', evidence: '', suggestion: '' };
}
```

Use it wherever diagnostic and ability score cards are rendered.

- [ ] **Step 5: Verify green**

Run:

```text
npm run test:short-guidance-frontend
npm run test:long-term-ability
```

Expected: all pass.

---

## Task 6: 局部修改严格保事实

**Files:**
- Modify: `server.js`
- Create: `scripts/revision-suggestions-fact-boundary.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `POST /api/v1/essay-sessions/:sessionId/revision-suggestions`
- Produces: `exampleRevision` 不新增无来源事实；需要新增细节时用问题式占位。

- [ ] **Step 1: Write failing test**

Test behavior:

```js
// Fake DeepSeek captures prompt for "生成局部修改建议".
// Request keepFactsStrict=true.
// Assert outputContract or prompt contains:
//   "只能使用原文已有事实"
//   "新增细节用问题式占位"
//   "不要替学生补出原文没有的人物、地点、动作、心理或感官细节"
```

- [ ] **Step 2: Verify red**

Run: `node scripts/revision-suggestions-fact-boundary.test.js`

Expected: FAIL until prompt contract is strengthened.

- [ ] **Step 3: Strengthen revision contract**

Change `GUIDANCE_OUTPUT_CONTRACTS.revision` to require:

```text
keepFactsStrict 为 true 时，exampleRevision 只能改写原文已有事实；如果必须补细节，用「这里补一个你真实看到的动作」这类问题式占位，不得替学生编出新事实。
```

Also include this boundary in endpoint input.

- [ ] **Step 4: Verify green**

Run:

```text
node scripts/revision-suggestions-fact-boundary.test.js
npm run test:essay-guidance
```

Expected: all pass.

---

## Task 7: 训练计划 API 只保留 7 天

**Files:**
- Modify: `lib/long-term-ability.js`
- Modify: `server.js`
- Modify: `scripts/training-plan-7d.test.js`

**Interfaces:**
- Produces: `POST /api/v1/training-plans` with `planType` other than empty or `7d` returns 400 `TRAINING_PLAN_TYPE_UNSUPPORTED`。

- [ ] **Step 1: Write failing test**

Add to `scripts/training-plan-7d.test.js`:

```js
const invalid = await request(baseUrl, 'POST', '/api/v1/training-plans', {
  planType: '30d',
  title: '一日秋游踏青',
  grade: '初一',
  genre: '记叙文'
});
assert.strictEqual(invalid.status, 400);
assert.strictEqual(invalid.json.error.code, 'TRAINING_PLAN_TYPE_UNSUPPORTED');
```

- [ ] **Step 2: Verify red**

Run: `npm run test:training-plan-7d`

Expected: FAIL because current API accepts `30d`/`14d`。

- [ ] **Step 3: Implement validation**

In `server.js` training plan route:

```js
const requestedPlanType = String(req.body?.planType || '7d').trim();
if (requestedPlanType && requestedPlanType !== '7d') {
  return v1Error(req, res, 400, 'TRAINING_PLAN_TYPE_UNSUPPORTED', '当前只支持 7 天单篇作文训练计划');
}
```

In `lib/long-term-ability.js`, make `buildTrainingPlanTasks()` always return `planType:'7d'` and `totalDays:7`。

- [ ] **Step 4: Verify green**

Run:

```text
npm run test:training-plan-7d
npm run test:training-workspace
npm run test:training-workspace-full-browser
```

Expected: all pass.

---

## Task 8: Final Verification and Smoke Report

**Files:**
- Create: `docs/reports/全功能问题修复冒烟测试报告-1.md` or next available number

- [ ] **Step 1: Run syntax checks**

Run:

```text
node --check server.js
node --check public/app.js
node --check public/api-client.js
node --check public/training-plans.js
node --check lib/essay-guidance.js
node --check lib/long-term-ability.js
```

- [ ] **Step 2: Run automated tests**

Run:

```text
npm run test:essay-guidance
npm run test:essay-guidance-missing-key
npm run test:short-guidance-frontend
npm run test:long-term-ability
npm run test:training-plan-7d
npm run test:training-workspace
npm run test:training-workspace-full-browser
npm run test:guidance-json-parse-no-retry
node scripts/essay-guidance-guided-writing-split.test.js
node scripts/essay-session-ownership.test.js
node scripts/growth-timeline-derived-events.test.js
node scripts/material-library-ai-classification.test.js
node scripts/app-material-library-ui.test.js
node scripts/revision-suggestions-fact-boundary.test.js
```

- [ ] **Step 3: Run real AI smoke when local `.env` has Key**

Run:

```text
npm run test:training-workspace-real-ai
npm run test:training-stage-real-ai
```

For short `guided-writing`, run one real素材 smoke with:

```text
题目：那一刻，我长大了
素材：妈妈发烧仍陪我准备朗读比赛，我第一次主动煮粥、整理书包，发现照顾别人也需要细心和责任。
```

Expected:
- No `MODEL_JSON_PARSE`
- `outlineTree.children.length >= 4`
- `paragraphGuides.length >= 4`
- output includes anchors `妈妈`、`发烧`、`朗读`、`煮粥`、`书包`

- [ ] **Step 4: Save smoke report**

Report includes:
- 修改摘要
- 每个原问题的修复状态
- 新素材库使用方式截图/文字描述
- 本地自动测试结果
- 真实 AI 冒烟结果
- 未部署说明
- 置信度评估

## Self-Review

- Spec coverage: 已覆盖 P0 `guided-writing`、P1 用户隔离、P1 成长地图、P1 小学年级、P2 体检分数、P2 素材库 UI、P2 能力诊断 UI、P2 局部修改事实边界、P2 训练计划 14/30 天接口残留。
- Placeholder scan: 本计划没有使用 TBD、TODO、implement later 等占位词；每项都有明确测试、文件和验收结果。
- Type consistency: 素材卡字段、成长时间线字段、guided-writing 返回字段均与现有前端/后端接口风格一致；新增函数命名在任务内保持一致。

## Execution Choice

推荐用当前会话内联执行，原因是改动跨同一批核心文件，拆多个写入型子代理容易互相覆盖。可以在最终测试阶段再派只读子代理做复核。

## 置信度评估

- 置信度：0.87
- 依据：计划来自刚完成的真实素材全功能冒烟报告，并已静态复核到关键代码位置；每个问题都有对应红灯测试和独立验收命令。
- 不确定性：短期 `guided-writing` 的真实模型稳定性仍受 DeepSeek 输出随机性影响；拆分模型调用可以显著降低风险，但最终还需要真实 AI 冒烟确认。
