# Training Plan Feature Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重做 InkEdge “训练计划”功能：保留现有 API 路由、数据结构和 7 天阶段框架，删除当前不可用或重复的训练计划 UI 与前端流程代码，重新做成可创建、可推进、可填写、可生成反馈、可进入下一阶段的 7 天单篇作文训练工作台。

**Architecture:** “成长”功能保持不动；训练计划重做只覆盖主应用 `view-training`、独立页 `/training-plans.html`、`public/training-plans.js`、训练计划相关样式、7 天阶段运行逻辑和对应测试。后端保留 `/api/v1/training-plans`、`/api/v1/training-plans/active`、`/api/v1/training-plans/:planId/tasks/:taskId/run`、`/api/v1/training-tasks/today` 等接口路径，但强化返回结构和阶段状态更新，使前端可以稳定渲染完整训练闭环。

**Tech Stack:** Node.js、Express、静态 HTML/CSS/JS、DeepSeek-compatible Chat API、现有 JSON state、Cloudflare Worker/D1 兼容入口、Playwright、本地测试脚本。

**Spec:** 来源为用户 2026-09-06 更正请求：“刚刚说错了，成长功能是正常的，有问题的是训练计划。请重新制定计划。”本计划取代 `2026-09-06-growth-feature-rebuild-plan.md` 作为后续执行依据；不修改成长功能。

## Global Constraints

- 不修改“成长”功能，除非训练计划入口跳转需要读取现有成长状态。
- 不恢复 14 天、30 天、考前 10 天等计划入口。
- 训练计划只做 7 天单篇作文训练。
- DeepSeek 调用必须走服务端环境变量或 Cloudflare Secret，前端不得接触 API Key。
- 主要写作辅导请求继续沿用 300 秒超时。
- AI 只提供立意、追问、提纲、段落提示、反馈、诊断和复盘，不替学生直接写完整作文。
- 用户输入的题目、素材、问题回答、段落草稿和完整草稿是事实来源；AI 不编造生活经历。
- 不删除项目文件夹；如需删除文件，只能单个文件处理。本计划阶段不执行删除。
- 不推送 Git。
- 不覆盖旧文档。
- 中文文件读取使用 Node.js UTF-8 方式，不用 PowerShell 直接读取。
- 搜索范围限制在 `D:/tony/黑客松项目`。
- 实质开发完成后必须跑冒烟测试，并将测试记录保存到 `test/` 目录，按编号递增命名。

---

## 1. 当前训练计划问题判断

### 1.1 主应用内训练计划板块

- `public/app.html` 的 `view-training` 只有 `trainingPlan` 和 `trainingCamps` 两个容器。
- `public/app.js` 的 `renderTrainingPlan()` 和 `renderTrainingCamps()` 都渲染“专项能力训练营”入口，造成截图中的重复卡片。
- 主应用训练计划板块没有直接展示当前计划、阶段进度、当天输入区、生成结果区和下一步按钮。
- `featureInterfaces` 中训练计划相关内容仍有“已预留”气质，与真实可用功能不匹配。

### 1.2 独立训练计划页

- `public/training-plans.html` 已有 7 天计划创建表单、当前计划、今日任务和当前阶段写作向导。
- `public/training-plans.js` 已有阶段运行雏形，但仍偏“技术展示”：结果 JSON 直接展示、提纲树用 `pre`、问题回答和段落写作缺少清晰表单，阶段之间的上一阶段产物复用不够直观。
- 计划创建后可以运行第 1 天，但从第 2 天到第 7 天的用户真实路径仍不够像“我还没写”板块那样连续。
- 当前阶段 UI 没有清楚区分“需要用户填写什么”“AI 刚生成了什么”“用户下一步怎么做”。

### 1.3 后端和测试基础

- `/api/v1/training-plans` 已能创建 7 天计划，并保存题目、年级、文体、初始素材等 `context`。
- `/api/v1/training-plans/active` 已能返回当前计划。
- `/api/v1/training-plans/:planId/tasks/:taskId/run` 已能运行阶段并保存 `artifacts` 与 `progress`。
- `lib/seven-day-training-runner.js` 已按 7 个阶段生成本地兜底结果。
- `scripts/training-plan-7d.test.js` 已覆盖创建计划、读取当前计划、今日任务和第 1 阶段运行。
- 现有测试仍不足以证明完整 7 天训练前端路径可用。

---

## 2. 删除范围与保留范围

### 2.1 删除或替换的训练计划 UI

**文件：`public/app.html`**

- 替换 `view-training` 内当前简单容器结构。
- 删除主应用训练计划板块里“专项能力训练营”重复展示区。
- 保留侧边栏“训练计划”入口，不改“成长”入口。
- 保留总览页“去训练”按钮，但它应进入新的 7 天训练工作台。

**文件：`public/app.js`**

- 删除或替换 `renderTrainingPlan()` 当前只输出训练营入口的实现。
- 删除或替换 `renderTrainingCamps()` 在主应用训练计划板块内造成重复入口的调用。
- 训练计划板块不再依赖静态 `featureInterfaces` 里的“已预留”描述。
- 新增主应用内训练工作台渲染逻辑，或让主应用训练入口直接承载与独立页一致的核心体验。

**文件：`public/training-plans.html`**

- 替换当前“创建卡 + 当前计划 + 今日任务 + 当前阶段写作向导”的松散布局。
- 删除“专项训练营”导航入口，避免用户误以为训练计划等于训练营。
- 保留 7 天计划创建表单字段：题目、年级、文体、已有素材。
- 保留 `data-plan-type="7d"`，但页面只出现一个清晰主入口。

**文件：`public/training-plans.js`**

- 删除或重写以下偏临时实现：
  - `artifactPreview()` 直接 JSON/`pre` 展示提纲树和结果的逻辑。
  - 阶段输入区只有通用字段渲染、缺少回答收集和段落输入的逻辑。
  - 阶段运行后只简单 `mergeStageResult()`，没有稳定展示下一阶段所需上下文。
  - `renderPlanOverview()` 中把 7 天卡片当静态列表展示，不能直接进入对应阶段工作。

**文件：`public/styles.css` / `public/app-apple.css`**

- 删除或停用只服务旧重复卡片、旧计划卡的样式。
- 保留通用按钮、输入框、面板、深浅主题变量。
- 新增训练工作台、阶段时间轴、阶段产物、回答表单、段落草稿、反馈卡样式。

### 2.2 保留的框架内容

**API 与客户端方法保留：**

- `window.EssayCoachAPI.createTrainingPlan(body)`
- `window.EssayCoachAPI.getActiveTrainingPlan()`
- `window.EssayCoachAPI.getTodayTasks()`
- `window.EssayCoachAPI.getTrainingTask(taskId)`
- `window.EssayCoachAPI.submitTrainingTask(taskId, body)`
- `window.EssayCoachAPI.getTrainingFeedback(taskId, body)`
- `window.EssayCoachAPI.runTrainingPlanTask(planId, taskId, body)`

**服务端路由保留：**

- `POST /api/v1/training-plans`
- `GET /api/v1/training-plans/active`
- `GET /api/v1/training-tasks/today`
- `GET /api/v1/training-tasks/:taskId`
- `POST /api/v1/training-tasks/:taskId/submissions`
- `POST /api/v1/training-tasks/:taskId/feedback`
- `POST /api/v1/training-plans/:planId/tasks/:taskId/run`

**数据集合保留：**

- `state.trainingPlans`
- `state.trainingTaskSubmissions`
- `trainingPlan.artifacts`
- `trainingPlan.progress`
- `trainingPlan.days`
- `trainingPlan.context`

**业务模块保留并增强：**

- `lib/long-term-ability.js` 中 7 天阶段蓝图保留。
- `lib/seven-day-training-runner.js` 中阶段运行入口保留。
- `scripts/training-plan-7d.test.js` 保留并扩展。
- `scripts/short-guidance-frontend.test.js` 中训练计划静态约束保留并更新。

---

## 3. 新训练计划功能设计

### 3.1 新页面定位

训练计划页不再是“生成一个计划列表”，而是“7 天单篇作文训练工作台”。它必须帮助用户完成一条连续路径：

1. 输入题目、年级、文体、已有素材。
2. 生成 7 天计划。
3. Day 1 生成可选立意，用户选择一个。
4. Day 2 根据所选立意生成素材追问，用户逐题回答。
5. Day 3 根据回答生成提纲树，用户确认结构。
6. Day 4 生成段落写作提示。
7. Day 5 用户按段落写草稿，系统合并草稿并给段落反馈。
8. Day 6 对完整草稿做体检。
9. Day 7 生成修改复盘和下一轮训练建议。

### 3.2 主应用内 `view-training`

主应用中的训练计划板块改为轻量版工作台：

- 顶部显示当前计划状态：未创建 / 进行中 / 已完成。
- 未创建时显示紧凑 7 天计划创建表单。
- 进行中时显示 7 个阶段进度条、当前阶段卡片、继续训练按钮。
- 点击继续训练后，直接在主应用内展开当前阶段工作区，或跳转到 `/training-plans.html` 的同一阶段。
- 不显示训练营重复卡片。
- 不修改成长页。

### 3.3 独立页 `/training-plans.html`

独立页作为完整工作台，布局为：

- **计划设置区**：题目、年级、文体、已有素材、生成计划按钮。
- **阶段时间轴**：Day 1 到 Day 7，显示阶段名、状态、是否可进入。
- **当前阶段工作区**：左侧“你需要填写”，右侧“AI 生成结果”。
- **阶段产物区**：根据阶段类型渲染，不再直接展示 JSON。
- **下一步区**：显示下一阶段需要什么，按钮文案明确。

### 3.4 七个阶段交互定义

**Day 1：审题与立意**

- 输入：题目、年级、文体、已有素材。
- 输出：3 个立意方向，每个包含标题、说明、素材提醒、风险。
- 用户动作：选择 1 个立意方向。
- 保存：`artifacts.topic_angle.selectedAngle`。

**Day 2：素材追问**

- 输入：Day 1 选择的立意、已有素材。
- 输出：3 到 6 个具体追问。
- 用户动作：逐题填写回答。
- 保存：`artifacts.material_questions.answers`。

**Day 3：提纲树**

- 输入：题目、立意、素材回答。
- 输出：树形提纲，按开头、主体、转折、结尾拆分。
- 用户动作：确认提纲或补充结构备注。
- 保存：`artifacts.outline_tree.confirmedOutline`。

**Day 4：段落写作提示**

- 输入：已确认提纲。
- 输出：每段该写什么、必须包含、写作提示、避免事项、建议字数。
- 用户动作：确认进入写作。
- 保存：`artifacts.paragraph_guides.paragraphGuides`。

**Day 5：段落草稿**

- 输入：每段文本框。
- 输出：合并草稿、每段反馈、下一步修改提示。
- 用户动作：填写段落并点击“合并草稿”。
- 保存：`artifacts.paragraph_drafting.mergedDraft`。

**Day 6：整文体检**

- 输入：Day 5 合并草稿或用户手动粘贴完整草稿。
- 输出：结构、素材、语言、扣题、情感等诊断。
- 用户动作：选择优先修改问题。
- 保存：`artifacts.draft_diagnosis.priorityIssue`。

**Day 7：修改复盘**

- 输入：修改后的作文、Day 6 选择的问题、学生自我反思。
- 输出：本次学到的方法、反复问题、下一次训练重点。
- 用户动作：完成计划。
- 保存：计划状态改为 `已完成`。

---

## 4. 文件结构计划

### Task 1: 写失败测试，锁定训练计划重做边界

**Files:**
- Modify: `scripts/training-plan-7d.test.js`
- Create: `scripts/training-plan-workspace-frontend.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `public/app.html`、`public/app.js`、`public/training-plans.html`、`public/training-plans.js`
- Produces: `npm run test:training-workspace`

- [ ] **Step 1: 增强后端 7 阶段完整运行测试**

在 `scripts/training-plan-7d.test.js` 增加 Day 1 到 Day 7 连续运行断言：

```js
let currentPlan = plan;
const stageInputs = {
  topic_angle: { title: '那一刻，我长大了', grade: '初二', genre: '记叙文', initialMaterial: '我第一次独自上台演讲。' },
  material_questions: { selectedAngle: '一次真实变化', initialMaterial: '我第一次独自上台演讲。', answers: [{ question: '什么时候？', answer: '周一班会课。' }] },
  outline_tree: { materialAnswers: [{ question: '什么时候？', answer: '周一班会课。' }] },
  paragraph_guides: { confirmedOutline: { title: '那一刻，我长大了' } },
  paragraph_drafting: { paragraphDrafts: [{ paragraphId: 'p1', text: '班会课上，我握着稿纸走上讲台。' }, { paragraphId: 'p2', text: '我的手一直在抖，但我还是开始讲。' }] },
  draft_diagnosis: { mergedDraft: '班会课上，我握着稿纸走上讲台。\\n\\n我的手一直在抖，但我还是开始讲。' },
  revision_reflection: { revisedText: '班会课上，我握着稿纸走上讲台。我的手一直在抖，但我还是把稿子讲完了。', studentSelfReflection: '我学会了写动作细节。' }
};
for (const day of currentPlan.days) {
  const run = await req(base, 'POST', `/api/v1/training-plans/${currentPlan.id}/tasks/${day.taskId}/run`, { input: stageInputs[day.stageId] });
  assert.strictEqual(run.status, 200, `${day.stageId} run status`);
  assert.strictEqual(run.json.data.stageId, day.stageId);
  assert.ok(run.json.data.artifact, `${day.stageId} should return artifact`);
}
const activeAfter = await req(base, 'GET', '/api/v1/training-plans/active');
assert.strictEqual(activeAfter.json.data.progress.completedStageIds.length, 7);
```

- [ ] **Step 2: 运行后端测试确认失败或暴露缺口**

Run: `npm run test:training-plan-7d`

Expected: FAIL，常见失败点可能是阶段推进状态不完整、Day 7 后计划未完成、某些阶段 artifact 字段不适合前端渲染。

- [ ] **Step 3: 新建前端重做边界测试**

创建 `scripts/training-plan-workspace-frontend.test.js`：

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appHtml = fs.readFileSync(path.join(root, 'public', 'app.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const plansHtml = fs.readFileSync(path.join(root, 'public', 'training-plans.html'), 'utf8');
const plansJs = fs.readFileSync(path.join(root, 'public', 'training-plans.js'), 'utf8');

assert(appHtml.includes('id="view-training"'));
assert(appHtml.includes('trainingWorkspace'));
assert(!appHtml.includes('id="trainingCamps"'));
assert(!appJs.includes('renderTrainingCamps()'));
assert(!plansHtml.includes('专项训练营'));
assert(plansHtml.includes('training-stage-timeline'));
assert(plansHtml.includes('training-stage-panel'));
assert(plansHtml.includes('training-artifact-panel'));
assert(plansJs.includes('renderTrainingWorkspace'));
assert(plansJs.includes('renderTopicAngleStage'));
assert(plansJs.includes('renderMaterialQuestionsStage'));
assert(plansJs.includes('renderParagraphDraftingStage'));
assert(!plansJs.includes('JSON.stringify(artifact, null, 2)'));
for (const removedPlanText of ['14 天', '30 天', '考前 10 天', 'examSprint']) {
  assert(!plansHtml.includes(removedPlanText));
}
```

- [ ] **Step 4: 增加测试脚本**

在 `package.json` scripts 中增加：

```json
"test:training-workspace": "node scripts/training-plan-workspace-frontend.test.js"
```

- [ ] **Step 5: 运行前端测试确认失败**

Run: `npm run test:training-workspace`

Expected: FAIL，原因是新工作台 DOM 和渲染函数尚未实现，旧训练营入口仍存在。

---

### Task 2: 强化后端 7 天阶段状态和产物结构

**Files:**
- Modify: `server.js`
- Modify: `lib/seven-day-training-runner.js`
- Modify: `lib/long-term-ability.js`
- Test: `scripts/training-plan-7d.test.js`

**Interfaces:**
- Consumes: `runSevenDayTrainingTask({ plan, task, input, callModel, outputContracts })`
- Produces: 稳定阶段返回 `{ planId, taskId, stageId, artifact, nextStageId, status, uiHints }`

- [ ] **Step 1: 让每个阶段 artifact 都有前端可渲染字段**

在 `lib/seven-day-training-runner.js` 中保证：

```js
topic_angle.artifact.possibleAngles
material_questions.artifact.questions
outline_tree.artifact.outlineTree
paragraph_guides.artifact.paragraphGuides
paragraph_drafting.artifact.mergedDraft
paragraph_drafting.artifact.paragraphFeedback
draft_diagnosis.artifact.priorityIssues
revision_reflection.artifact.learnedSkills
revision_reflection.artifact.suggestedTrainingFocus
```

- [ ] **Step 2: Day 7 完成后关闭计划**

在 `server.js` 的阶段运行路由里，当 `nextStageId` 为空且当前阶段为 `revision_reflection` 时：

```js
found.plan.status = '已完成';
found.plan.completedAt = nowIso();
found.plan.progress.currentStageId = '';
```

- [ ] **Step 3: 保存用户阶段输入**

在 `server.js` 运行阶段后保存：

```js
found.plan.stageInputs = found.plan.stageInputs || {};
found.plan.stageInputs[found.task.stageId || found.task.taskId] = req.body?.input || {};
```

- [ ] **Step 4: 返回更新后的计划摘要**

阶段运行响应增加：

```js
planProgress: found.plan.progress,
planStatus: found.plan.status
```

- [ ] **Step 5: 运行后端测试**

Run: `npm run test:training-plan-7d`

Expected: PASS，且完整 7 阶段运行后 `completedStageIds.length === 7`，计划状态为 `已完成`。

---

### Task 3: 重做主应用内训练计划板块

**Files:**
- Modify: `public/app.html`
- Modify: `public/app.js`
- Test: `scripts/training-plan-workspace-frontend.test.js`
- Test: `scripts/short-guidance-frontend.test.js`

**Interfaces:**
- Produces: `#trainingWorkspace`、`renderTrainingWorkspaceSummary()`、`loadTrainingWorkspaceSummary()`
- Consumes: `window.EssayCoachAPI.getActiveTrainingPlan()`

- [ ] **Step 1: 替换 `view-training` DOM**

将 `view-training` 改为：

```html
<section class="view" id="view-training" aria-labelledby="trainingTitle">
  <div class="section-head">
    <div>
      <p class="eyebrow">Training Plan</p>
      <h2 id="trainingTitle">7 天训练计划</h2>
    </div>
  </div>
  <div id="trainingWorkspace" class="training-workspace-summary"></div>
</section>
```

- [ ] **Step 2: 删除主应用训练营重复容器**

从 `public/app.html` 删除：

```html
<div id="trainingPlan" class="plan-grid"></div>
<article class="panel">
  <h3>专项能力训练营</h3>
  <div id="trainingCamps" class="feature-grid"></div>
</article>
```

- [ ] **Step 3: 重写 `public/app.js` 的训练摘要渲染**

新增：

```js
async function loadTrainingWorkspaceSummary() {
  const target = $('#trainingWorkspace');
  if (!target) return;
  try {
    const plan = apiEnabled() ? await window.EssayCoachAPI.getActiveTrainingPlan() : null;
    renderTrainingWorkspaceSummary(plan);
  } catch (error) {
    target.innerHTML = `<div class="empty-state">训练计划读取失败：${escapeHtml(error.message)}</div>`;
  }
}
```

渲染要求：

- 无计划：显示创建 7 天计划入口，链接到 `/training-plans.html`。
- 有计划：显示阶段进度、当前阶段、继续训练按钮。
- 不显示训练营入口。

- [ ] **Step 4: 调整调用点**

`renderDashboard()` 中保留成长相关调用，不动 `renderGrowthModules()` 和 `renderGrowthTimeline()`；只把训练计划调用改为：

```js
loadTrainingWorkspaceSummary();
```

- [ ] **Step 5: 运行前端测试**

Run:

```text
npm run test:training-workspace
npm run test:short-guidance-frontend
```

Expected: PASS 或只剩独立训练页相关断言失败。

---

### Task 4: 重做独立训练计划页 DOM

**Files:**
- Modify: `public/training-plans.html`
- Test: `scripts/training-plan-workspace-frontend.test.js`

**Interfaces:**
- Produces: `#trainingStageTimeline`、`#trainingStagePanel`、`#trainingArtifactPanel`、`#trainingNextStepPanel`

- [ ] **Step 1: 保留 7 天创建表单并重排页面**

页面主体改为：

```html
<main class="app-main training-plan-shell">
  <section class="training-workbench" id="trainingWorkbench">
    <header class="training-workbench-head">
      <div>
        <p class="eyebrow">Training Plan</p>
        <h1>7 天单篇作文训练</h1>
      </div>
      <div id="planStatus" class="training-status-pill">读取中</div>
    </header>

    <section class="training-create-panel" id="trainingCreatePanel"></section>
    <section class="training-stage-timeline" id="trainingStageTimeline"></section>
    <section class="training-stage-panel" id="trainingStagePanel"></section>
    <section class="training-artifact-panel" id="trainingArtifactPanel"></section>
    <section class="training-next-step-panel" id="trainingNextStepPanel"></section>
  </section>
</main>
```

- [ ] **Step 2: 删除无关导航**

从独立页头部删除：

```html
<a class="nav-item" href="/training-camps.html">专项训练营</a>
```

- [ ] **Step 3: 保留脚本引用**

确保仍加载：

```html
<script src="/theme.js"></script>
<script src="/config.js"></script>
<script src="/api-client.js"></script>
<script src="/training-plans.js"></script>
```

- [ ] **Step 4: 运行前端结构测试**

Run: `npm run test:training-workspace`

Expected: JS 相关断言可能仍失败，HTML 断言通过。

---

### Task 5: 重写独立训练计划页前端状态机

**Files:**
- Modify: `public/training-plans.js`
- Test: `scripts/training-plan-workspace-frontend.test.js`

**Interfaces:**
- Consumes: `createTrainingPlan`、`getActiveTrainingPlan`、`runTrainingPlanTask`
- Produces: `renderTrainingWorkspace()`、`renderTopicAngleStage()`、`renderMaterialQuestionsStage()`、`renderOutlineTreeStage()`、`renderParagraphGuidesStage()`、`renderParagraphDraftingStage()`、`renderDraftDiagnosisStage()`、`renderRevisionReflectionStage()`

- [ ] **Step 1: 建立统一状态**

```js
const trainingState = {
  activePlan: null,
  selectedStageId: '',
  busy: false,
  error: '',
  draftInputs: {}
};
```

- [ ] **Step 2: 实现 `renderTrainingWorkspace()`**

职责：

- 渲染创建面板。
- 渲染 Day 1 到 Day 7 时间轴。
- 根据当前阶段调用对应 stage renderer。
- 渲染上一次 artifact 和下一步提示。

- [ ] **Step 3: 实现 Day 1 渲染**

`renderTopicAngleStage(task, artifact)`：

- 未生成时显示题目/年级/文体/素材确认区。
- 已生成时以卡片展示 3 个立意方向。
- 每个方向可点击选择。
- 点击选择后写入隐藏输入 `selectedAngle`，并提示下一阶段会基于它追问素材。

- [ ] **Step 4: 实现 Day 2 渲染**

`renderMaterialQuestionsStage(task, artifact)`：

- 展示 Day 1 已选立意。
- 未生成时按钮为“生成素材追问”。
- 已生成时每个问题下面有回答框。
- 提交时把 answers 数组传入 `runTrainingPlanTask()`。

- [ ] **Step 5: 实现 Day 3 渲染**

`renderOutlineTreeStage(task, artifact)`：

- 用嵌套列表渲染 `outlineTree`。
- 提供“确认这个提纲”按钮。
- 提供一个小文本框让用户补充结构备注。

- [ ] **Step 6: 实现 Day 4 渲染**

`renderParagraphGuidesStage(task, artifact)`：

- 每段一个提示卡。
- 显示角色、目标、必须包含、写作提示、避免事项、建议字数。
- 按钮为“进入段落写作”。

- [ ] **Step 7: 实现 Day 5 渲染**

`renderParagraphDraftingStage(task, artifact)`：

- 根据 Day 4 的 `paragraphGuides` 生成段落文本框。
- 每个文本框保留用户输入。
- 按钮为“合并草稿并获取段落反馈”。
- 结果展示合并草稿和每段反馈。

- [ ] **Step 8: 实现 Day 6 渲染**

`renderDraftDiagnosisStage(task, artifact)`：

- 默认读取 Day 5 的 `mergedDraft`。
- 允许用户手动修改完整草稿。
- 展示诊断问题时用列表和优先级，不展示 JSON。
- 用户可选择一个优先修改问题。

- [ ] **Step 9: 实现 Day 7 渲染**

`renderRevisionReflectionStage(task, artifact)`：

- 输入：修改后作文、自我反思。
- 输出：学到的方法、反复问题、下一轮训练重点。
- 完成后显示计划完成状态。

- [ ] **Step 10: 删除直接 JSON 结果展示**

确认 `public/training-plans.js` 不再包含：

```js
JSON.stringify(artifact, null, 2)
```

- [ ] **Step 11: 运行前端测试**

Run: `npm run test:training-workspace`

Expected: PASS。

---

### Task 6: 样式重做

**Files:**
- Modify: `public/styles.css`
- Modify: `public/app-apple.css`
- Test: `scripts/app-apple-theme-ui.test.js`
- Test: `scripts/training-plan-workspace-frontend.test.js`

**Interfaces:**
- Consumes: 新 class：`training-workbench`、`training-stage-timeline`、`training-stage-panel`、`training-artifact-panel`、`training-next-step-panel`、`stage-answer-list`、`paragraph-draft-grid`

- [ ] **Step 1: 训练工作台布局**

桌面端：

```css
.training-workbench {
  display: grid;
  grid-template-columns: minmax(260px, .75fr) minmax(0, 1.25fr);
  gap: 16px;
}
```

- [ ] **Step 2: 移动端单列**

```css
@media (max-width: 760px) {
  .training-workbench {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 3: 时间轴样式**

要求：

- Day 卡片固定最小高度。
- 当前阶段、已完成、未解锁三种状态清楚。
- 长标题换行，不横向滚动。

- [ ] **Step 4: 阶段表单样式**

要求：

- 问题回答框一题一框。
- 段落写作框高度适中，提示和输入框不互相挤压。
- 生成按钮 loading 时不改变布局高度。

- [ ] **Step 5: 产物样式**

要求：

- 立意方向、素材追问、提纲树、段落提示、诊断问题、复盘结果各有清楚层级。
- 不使用大面积单一紫蓝渐变。
- 深浅主题都能读清楚。

- [ ] **Step 6: 跑 UI 静态测试**

Run:

```text
node scripts/app-apple-theme-ui.test.js
npm run test:training-workspace
```

Expected: PASS。

---

### Task 7: 浏览器级冒烟和测试记录

**Files:**
- Create: `scripts/training-plan-workspace-smoke.test.js`
- Modify: `package.json`
- Create: `test/训练计划功能重做冒烟测试报告-1.md`

**Interfaces:**
- Consumes: 本地 Express 服务、`/training-plans.html`
- Produces: `npm run test:training-workspace-smoke`

- [ ] **Step 1: 新增 Playwright 冒烟脚本**

测试路径：

```js
await page.goto(`${base}/training-plans.html`);
await page.fill('#trainingTopicInput', '那一刻，我长大了');
await page.selectOption('#trainingGradeInput', { label: '初二' });
await page.selectOption('#trainingGenreInput', { label: '记叙文' });
await page.fill('#trainingMaterialInput', '我第一次独自上台演讲，手一直在抖，但最后坚持讲完。');
await page.click('[data-plan-type="7d"]');
await page.waitForSelector('.training-stage-timeline');
await page.click('text=生成立意方向');
await page.waitForSelector('.stage-angle-choice');
```

- [ ] **Step 2: 增加脚本**

```json
"test:training-workspace-smoke": "node scripts/training-plan-workspace-smoke.test.js"
```

- [ ] **Step 3: 执行核心测试**

Run:

```text
npm run test:training-plan-7d
npm run test:training-workspace
npm run test:training-workspace-smoke
npm run test:short-guidance-frontend
npm run test:long-term-ability
npm run test:essay-guidance
node scripts/app-apple-theme-ui.test.js
```

Expected: 全部 PASS。

- [ ] **Step 4: 保存测试报告**

报告保存为：

```text
test/训练计划功能重做冒烟测试报告-1.md
```

若已存在则递增编号。

报告必须包含：

- 删除和替换内容。
- 保留的 API 与框架。
- 自动测试结果。
- 浏览器冒烟路径。
- 已知风险。
- 置信度评估。

- [ ] **Step 5: 测试进程清理**

如果冒烟脚本启动了本地服务，脚本结束时必须关闭服务进程，并只删除临时状态文件，不删除文件夹。

---

## 5. 验收标准

### 5.1 删除验收

- 主应用训练计划板块不再出现重复“专项能力训练营”卡片。
- 训练计划页不再出现 14 天、30 天、考前 10 天等入口或文案。
- 训练计划页不再把 JSON 直接作为主要用户结果展示。
- 训练计划页不再依赖“已预留”式说明冒充功能。

### 5.2 功能验收

- 用户能创建单一 7 天计划。
- 用户能看到 Day 1 到 Day 7 的进度。
- 用户能在 Day 1 选择立意方向。
- 用户能在 Day 2 回答素材追问。
- 用户能在 Day 3 查看并确认提纲树。
- 用户能在 Day 4 查看段落写作提示。
- 用户能在 Day 5 输入多段草稿并合并。
- 用户能在 Day 6 对完整草稿做诊断。
- 用户能在 Day 7 完成复盘，计划状态变为已完成。
- 切换页面或刷新后，当前计划与已生成产物仍可读取。

### 5.3 回归验收

- “成长”功能保持原状，不纳入重做。
- “我还没写”构思指导不受影响。
- “我写完了”作文体检不受影响。
- “素材库”不受影响。
- API Key 仍不进入前端资源。

---

## 6. 推荐实施顺序

1. 先写训练计划前后端失败测试。
2. 先修后端阶段状态与 artifact 结构。
3. 再重做主应用训练计划板块，消除重复卡片。
4. 再重做独立训练计划页 DOM。
5. 再重写 `training-plans.js` 状态机和 7 阶段渲染。
6. 最后做样式和浏览器冒烟。

---

## 7. 不在本轮重做范围内

- 不重做“成长”功能。
- 不重做长期能力画像算法。
- 不新增 14 天、30 天、考试冲刺计划。
- 不做训练营体系。
- 不做排行榜、积分、付费权限。
- 不做整篇代写。
- 不改变已部署域名和 Worker 名。

---

## 8. 置信度评估

- 置信度：0.90
- 依据：已检查 `public/app.html`、`public/app.js`、`public/training-plans.html`、`public/training-plans.js`、`public/api-client.js`、`server.js`、`lib/long-term-ability.js`、`lib/seven-day-training-runner.js` 和现有训练计划测试，确认问题集中在训练计划 UI 与阶段工作流，而不是成长功能。
- 不确定性：本计划尚未实际执行浏览器点击测试；阶段 2 到阶段 7 的真实模型输出质量需要在开发后通过 DeepSeek 冒烟进一步确认。
