# 7 天训练计划生成逻辑完善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把“7 天训练计划”从静态每日任务列表升级为接近“我还没写”板块完成度的交互式 7 天写作训练流程。

**Architecture:** 复用现有 Node.js + Express 单体服务、DeepSeek JSON 调用、`essaySessions` 和 `trainingPlans` 状态存储。7 天计划不再只由本地规则拼标题，而是以“单篇作文从构思到复盘”的 7 个阶段为主线，每天有输入项、AI 生成结果、学生提交、反馈和下一步状态。

**Tech Stack:** Node.js、Express、原生前端 HTML/CSS/JS、DeepSeek-compatible Chat API、Playwright、现有 `state`/Cloudflare D1 持久化层。

**Spec:** 当前用户要求：第 5 项“完善整体生成 7 天计划的逻辑，尽可能接近‘我还没写’板块的完成度”；参考已完成报告 `test/7天训练计划专项检查与修复冒烟测试报告-1.md`。

## Global Constraints

- 只围绕 7 天训练计划，不恢复 14 天、30 天、考前 10 天入口。
- 训练计划服务面向短期单篇作文训练，不在本阶段扩展长期能力成长系统。
- DeepSeek 调用必须走环境变量 `AI_API_BASE_URL`、`AI_API_KEY`、`AI_GUIDANCE_MODEL`，不得写入密钥。
- AI 只做指导、追问、提纲、反馈和复盘，不替学生直接写完整作文。
- 用户提供的题目、素材、段落草稿是事实来源；AI 不编造生活经历。
- 页面交互完成度对齐“我还没写”：能选择、能回答、能生成、能继续写、能保存状态。
- 新增或改动测试报告按编号保存；不覆盖旧报告。

---

### Task 1: 固定 7 天训练蓝图

**Files:**
- Modify: `lib/long-term-ability.js`
- Test: `scripts/long-term-ability.test.js`
- Test: `scripts/training-plan-7d.test.js`

**Interfaces:**
- Consumes: `buildTrainingPlanTasks(input)`
- Produces: `plan.days[]` 中稳定的 7 个阶段字段：`stageId`、`stageTitle`、`inputSchema`、`expectedOutput`、`aiAction`、`dependsOnStageIds`

- [ ] **Step 1: Write the failing test**

```js
const planTasks = longTermAbility.buildTrainingPlanTasks({
  planType: '7d',
  title: '那一刻，我长大了',
  grade: '初二',
  genre: '记叙文',
  focusDimensions: ['素材具体度', '语言自然度']
});
assert.strictEqual(planTasks.tasks.length, 7);
assert.deepStrictEqual(planTasks.tasks.map((task) => task.stageId), [
  'topic_angle',
  'material_questions',
  'outline_tree',
  'paragraph_guides',
  'paragraph_drafting',
  'draft_diagnosis',
  'revision_reflection'
]);
assert.ok(planTasks.tasks[0].inputSchema.fields.some((field) => field.name === 'title'));
assert.ok(planTasks.tasks[3].expectedOutput.includes('段落写作提示'));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:long-term-ability`

Expected: FAIL because current tasks only have rotating `taskType` and do not expose 7 个固定阶段。

- [ ] **Step 3: Implement the 7-day blueprint**

Add a `SEVEN_DAY_STAGE_BLUEPRINTS` constant:

```js
const SEVEN_DAY_STAGE_BLUEPRINTS = [
  {
    stageId: 'topic_angle',
    day: 1,
    stageTitle: '审题与立意',
    taskType: '构思',
    relatedDimension: '审题能力',
    inputSchema: {
      fields: [
        { name: 'title', label: '作文题目', type: 'text', required: true },
        { name: 'grade', label: '年级', type: 'select', required: false },
        { name: 'genre', label: '文体', type: 'select', required: false }
      ]
    },
    aiAction: 'topic_analysis',
    expectedOutput: '题眼、风险角度、可选立意方向'
  },
  {
    stageId: 'material_questions',
    day: 2,
    stageTitle: '素材追问',
    taskType: '素材',
    relatedDimension: '细节能力',
    inputSchema: {
      fields: [
        { name: 'selectedAngle', label: '选择的立意方向', type: 'hidden', required: true },
        { name: 'initialMaterial', label: '已有素材', type: 'textarea', required: false }
      ]
    },
    aiAction: 'material_questions',
    expectedOutput: '按人物、时间、地点、动作、对话、感受追问'
  },
  {
    stageId: 'outline_tree',
    day: 3,
    stageTitle: '提纲树',
    taskType: '提纲',
    relatedDimension: '结构能力',
    inputSchema: { fields: [{ name: 'materialAnswers', label: '素材回答', type: 'answers', required: true }] },
    aiAction: 'outline_tree',
    expectedOutput: '树形提纲与段落功能'
  },
  {
    stageId: 'paragraph_guides',
    day: 4,
    stageTitle: '段落写作提示',
    taskType: '段落',
    relatedDimension: '语言能力',
    inputSchema: { fields: [{ name: 'outlineTree', label: '提纲树', type: 'artifact', required: true }] },
    aiAction: 'paragraph_guides',
    expectedOutput: '每段该写什么、必须包含什么、避开什么'
  },
  {
    stageId: 'paragraph_drafting',
    day: 5,
    stageTitle: '分段写作',
    taskType: '写作',
    relatedDimension: '语言能力',
    inputSchema: { fields: [{ name: 'paragraphDrafts', label: '分段作文', type: 'paragraphs', required: true }] },
    aiAction: 'paragraph_feedback',
    expectedOutput: '逐段反馈与合并草稿'
  },
  {
    stageId: 'draft_diagnosis',
    day: 6,
    stageTitle: '整文体检',
    taskType: '体检',
    relatedDimension: '修改能力',
    inputSchema: { fields: [{ name: 'draftText', label: '完整作文', type: 'textarea', required: true }] },
    aiAction: 'draft_diagnosis',
    expectedOutput: '结构、语言、素材、扣题问题清单'
  },
  {
    stageId: 'revision_reflection',
    day: 7,
    stageTitle: '修改与复盘',
    taskType: '复盘',
    relatedDimension: '修改能力',
    inputSchema: { fields: [{ name: 'revisedText', label: '修改稿', type: 'textarea', required: true }] },
    aiAction: 'revision_reflection',
    expectedOutput: '修改建议、最终对比、下一次训练重点'
  }
];
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm run test:long-term-ability
npm run test:training-plan-7d
```

Expected: PASS, and `POST /api/v1/training-plans` still returns exactly 7 days.

---

### Task 2: 训练计划生成接入“我还没写”的上下文

**Files:**
- Modify: `server.js`
- Modify: `lib/long-term-ability.js`
- Test: `scripts/training-plan-7d.test.js`

**Interfaces:**
- Consumes: `POST /api/v1/training-plans`
- Produces: `plan.context` with `title`、`grade`、`genre`、`initialMaterial`、`goal`、`sourceSessionId`

- [ ] **Step 1: Write the failing test**

```js
const create = await req(base, 'POST', '/api/v1/training-plans', {
  planType: '7d',
  title: '那一刻，我长大了',
  grade: '初二',
  genre: '记叙文',
  initialMaterial: '我第一次独自上台演讲。',
  goal: '完成一篇记叙文'
});
assert.strictEqual(create.status, 200);
assert.strictEqual(create.json.data.context.title, '那一刻，我长大了');
assert.strictEqual(create.json.data.context.genre, '记叙文');
assert.strictEqual(create.json.data.days[0].inputSnapshot.title, '那一刻，我长大了');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:training-plan-7d`

Expected: FAIL because current plan does not persist `context` or `inputSnapshot`。

- [ ] **Step 3: Implement context persistence**

In `buildTrainingPlanTasks(input)` normalize:

```js
const context = {
  title: normalizeText(input.title, 120),
  grade: normalizeText(input.grade, 40),
  genre: normalizeText(input.genre, 40),
  initialMaterial: normalizeText(input.initialMaterial, 1200),
  goal: normalizeText(input.goal, 120) || '完成一篇单篇作文训练',
  sourceSessionId: normalizeText(input.sourceSessionId, 80)
};
```

Attach `context` to the returned result and copy it into each task as `inputSnapshot` where needed.

- [ ] **Step 4: Update route response**

In `server.js` plan object include:

```js
context: result.context || {},
artifacts: {},
progress: { currentStageId: 'topic_angle', completedStageIds: [] }
```

- [ ] **Step 5: Run tests**

Run: `npm run test:training-plan-7d`

Expected: PASS.

---

### Task 3: 增加 7 天任务执行接口

**Files:**
- Modify: `server.js`
- Modify: `public/api-client.js`
- Test: `scripts/training-plan-7d.test.js`
- Test: `scripts/short-guidance-frontend.test.js`

**Interfaces:**
- Produces: `POST /api/v1/training-plans/:planId/tasks/:taskId/run`
- Produces frontend method: `runTrainingPlanTask(planId, taskId, body)`

- [ ] **Step 1: Write the failing API test**

```js
const run = await req(base, 'POST', `/api/v1/training-plans/${plan.id}/tasks/${plan.days[0].taskId}/run`, {
  input: { title: '那一刻，我长大了', grade: '初二', genre: '记叙文' }
});
assert.strictEqual(run.status, 200);
assert.strictEqual(run.json.data.taskId, plan.days[0].taskId);
assert.ok(run.json.data.artifact);
assert.strictEqual(run.json.data.nextStageId, 'material_questions');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:training-plan-7d`

Expected: FAIL because route does not exist.

- [ ] **Step 3: Implement route dispatcher**

Add helper in `server.js`:

```js
function findPlanTask(planId, taskId) {
  const plan = (state.trainingPlans || []).find((item) => item.id === planId || item.planId === planId);
  if (!plan) return { error: 'PLAN_NOT_FOUND' };
  const task = (plan.days || []).find((item) => item.taskId === taskId);
  if (!task) return { error: 'TASK_NOT_FOUND', plan };
  return { plan, task };
}
```

Add route:

```js
app.post('/api/v1/training-plans/:planId/tasks/:taskId/run', async (req, res) => {
  const found = findPlanTask(req.params.planId, req.params.taskId);
  if (found.error === 'PLAN_NOT_FOUND') return v1Error(req, res, 404, 'PLAN_NOT_FOUND', '训练计划不存在');
  if (found.error === 'TASK_NOT_FOUND') return v1Error(req, res, 404, 'TASK_NOT_FOUND', '训练任务不存在');
  const result = await runSevenDayTrainingTask({ plan: found.plan, task: found.task, input: req.body?.input || {} });
  return v1Success(req, res, result);
});
```

- [ ] **Step 4: Add API client method**

```js
runTrainingPlanTask: (planId, taskId, body) => request(`training-plans/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}/run`, { method: 'POST', body })
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test:training-plan-7d
npm run test:short-guidance-frontend
```

Expected: PASS.

---

### Task 4: 复用“我还没写”的 AI 能力生成每日产物

**Files:**
- Modify: `server.js`
- Create: `lib/seven-day-training-runner.js`
- Test: `scripts/training-plan-7d.test.js`
- Test: `scripts/essay-guidance-missing-key.test.js`

**Interfaces:**
- Consumes: `runSevenDayTrainingTask({ plan, task, input, callModel })`
- Produces: `{ planId, taskId, stageId, artifact, nextStageId, status }`

- [ ] **Step 1: Write failing tests for Day 1 and missing key fallback**

```js
const day1 = plan.days.find((task) => task.stageId === 'topic_angle');
const run = await req(base, 'POST', `/api/v1/training-plans/${plan.id}/tasks/${day1.taskId}/run`, {
  input: { title: '那一刻，我长大了', grade: '初二', genre: '记叙文' }
});
assert.strictEqual(run.status, 200);
assert.ok(Array.isArray(run.json.data.artifact.possibleAngles));
assert.ok(run.json.data.artifact.possibleAngles.length >= 1);
```

For missing key:

```js
assert.ok(run.json.data.artifact.localFallback);
assert.ok(run.json.data.artifact.possibleAngles.length >= 1);
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test:training-plan-7d
npm run test:essay-guidance-missing-key
```

Expected: FAIL because no runner exists.

- [ ] **Step 3: Create runner with stage dispatch**

Implement `lib/seven-day-training-runner.js`:

```js
async function runSevenDayTrainingTask({ plan, task, input, callModel }) {
  if (task.stageId === 'topic_angle') return runTopicAngle({ plan, task, input, callModel });
  if (task.stageId === 'material_questions') return runMaterialQuestions({ plan, task, input, callModel });
  if (task.stageId === 'outline_tree') return runOutlineTree({ plan, task, input, callModel });
  if (task.stageId === 'paragraph_guides') return runParagraphGuides({ plan, task, input, callModel });
  if (task.stageId === 'paragraph_drafting') return runParagraphDrafting({ plan, task, input, callModel });
  if (task.stageId === 'draft_diagnosis') return runDraftDiagnosis({ plan, task, input, callModel });
  return runRevisionReflection({ plan, task, input, callModel });
}
```

Each stage should reuse existing output contracts where possible:

- Day 1: `GUIDANCE_OUTPUT_CONTRACTS.topicAnalysis`
- Day 2: `GUIDANCE_OUTPUT_CONTRACTS.materialQuestions`
- Day 3/4: `GUIDANCE_OUTPUT_CONTRACTS.guidedWriting`
- Day 5: existing `reviewTaskSubmission`
- Day 6: `GUIDANCE_OUTPUT_CONTRACTS.diagnose`
- Day 7: `GUIDANCE_OUTPUT_CONTRACTS.reflection`

- [ ] **Step 4: Save artifact into plan**

In the route after runner returns:

```js
plan.artifacts = plan.artifacts || {};
plan.artifacts[task.stageId] = result.artifact;
task.status = '已完成';
task.completedAt = nowIso();
plan.progress.currentStageId = result.nextStageId || task.stageId;
plan.progress.completedStageIds = Array.from(new Set([...(plan.progress.completedStageIds || []), task.stageId]));
plan.updatedAt = nowIso();
saveState();
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test:training-plan-7d
npm run test:essay-guidance-missing-key
```

Expected: PASS.

---

### Task 5: 训练计划页面升级为 7 天向导

**Files:**
- Modify: `public/training-plans.html`
- Modify: `public/training-plans.js`
- Modify: `public/styles.css`
- Test: `scripts/short-guidance-frontend.test.js`

**Interfaces:**
- Consumes: `EssayCoachAPI.createTrainingPlan`
- Consumes: `EssayCoachAPI.getActiveTrainingPlan`
- Consumes: `EssayCoachAPI.runTrainingPlanTask`
- Produces UI hooks: `seven-day-plan-form`、`training-stage-workspace`、`stage-input-area`、`stage-artifact-area`

- [ ] **Step 1: Write failing frontend hook tests**

```js
for (const hook of [
  'seven-day-plan-form',
  'training-stage-workspace',
  'stage-input-area',
  'stage-artifact-area',
  'runTrainingPlanTask',
  'renderStageWorkspace',
  'collectStageInput'
]) {
  assert(trainingPlansHtml.includes(hook) || trainingPlansJs.includes(hook) || apiClientJs.includes(hook), `missing ${hook}`);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:short-guidance-frontend`

Expected: FAIL because current page only creates and displays plan.

- [ ] **Step 3: Add creation form**

Add form fields:

```html
<div id="sevenDayPlanForm" class="seven-day-plan-form">
  <label>作文题目<input id="trainingTopicInput" type="text"></label>
  <label>年级<select id="trainingGradeInput"></select></label>
  <label>文体<select id="trainingGenreInput"></select></label>
  <label>已有素材<textarea id="trainingMaterialInput"></textarea></label>
</div>
```

- [ ] **Step 4: Add stage workspace**

```html
<section class="panel result-panel training-stage-workspace">
  <div id="stageInputArea" class="stage-input-area"></div>
  <div id="stageArtifactArea" class="stage-artifact-area"></div>
</section>
```

- [ ] **Step 5: Implement stage renderer**

In `public/training-plans.js`:

```js
function renderStageWorkspace(plan) {
  const task = currentPlanTask(plan);
  renderStageInputs(task, plan);
  renderStageArtifact(task, plan.artifacts && plan.artifacts[task.stageId]);
}
```

- [ ] **Step 6: Implement input collection**

```js
function collectStageInput(task) {
  return Object.fromEntries($all('[data-stage-field]').map((field) => [field.dataset.stageField, field.value.trim()]));
}
```

- [ ] **Step 7: Wire run button**

```js
async function runCurrentStage(button) {
  const plan = trainingPlanState.activePlan;
  const task = currentPlanTask(plan);
  const result = await api().runTrainingPlanTask(plan.id, task.taskId, { input: collectStageInput(task) });
  mergeStageResult(plan, result);
  renderPlanOverview(plan);
  renderStageWorkspace(plan);
}
```

- [ ] **Step 8: Run tests**

Run: `npm run test:short-guidance-frontend`

Expected: PASS.

---

### Task 6: 完成端到端冒烟和报告

**Files:**
- Create: `test/7天训练计划生成逻辑完善冒烟测试报告-1.md`
- Test: local Playwright script or `scripts/training-plan-7d.test.js`

**Interfaces:**
- Produces smoke evidence for local and online deployment.

- [ ] **Step 1: Run automated tests**

Run:

```bash
npm run test:training-plan-7d
npm run test:short-guidance-frontend
npm run test:long-term-ability
npm run test:essay-guidance
npm run test:essay-guidance-missing-key
```

Expected: all PASS.

- [ ] **Step 2: Run local browser smoke**

Use Playwright to:

1. Open `/training-plans.html`.
2. Fill title, grade, genre, material.
3. Create 7 天计划.
4. Run Day 1.
5. Verify stage artifact appears.
6. Run Day 2 using Day 1 result.
7. Verify stage workspace advances.

- [ ] **Step 3: Deploy and online smoke**

Run:

```bash
npx wrangler deploy --dry-run
npx wrangler deploy
```

Then create a temporary online test user and verify:

- `POST /api/v1/training-plans` returns context and 7 stages.
- `POST /api/v1/training-plans/:planId/tasks/:taskId/run` returns Day 1 artifact.
- `GET /api/v1/training-tasks/today` returns current plan task.
- Clean the temporary online record from D1 after smoke.

- [ ] **Step 4: Save numbered smoke report**

Create `test/7天训练计划生成逻辑完善冒烟测试报告-1.md` with:

- 修改范围
- 测试命令
- 本地结果
- 线上结果
- 测试数据清理结果
- 已知风险
- 置信度评估

---

## Self-Review

- Spec coverage: 覆盖 7 天计划生成、每日输入、AI 产物、状态保存、前端向导、测试和报告。
- Placeholder scan: 未使用 TBD、TODO 或“以后补”式占位。
- Type consistency: `stageId`、`inputSchema`、`artifact`、`progress.currentStageId`、`runTrainingPlanTask` 在各任务中保持一致。
- Scope check: 只做 7 天单篇作文训练，不扩展 14 天、30 天或长期能力提升。

## 置信度评估

置信度：0.86

依据：现有“我还没写”已经具备题目分析、素材追问、树形提纲、段落提示、分段输入和合并成稿的基础能力；现有 7 天计划已经具备创建、当前计划、今日任务和线上持久化。主要风险在于把多日状态与 AI 产物串起来后，历史计划数据兼容和 DeepSeek JSON 稳定性需要通过契约测试与本地降级结果兜底。
