# Growth Feature Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重做 InkEdge “成长”功能：删除现有不可用的成长页主体 UI 与占位逻辑，保留 API 与数据框架，重建一个能记录作文训练进展、展示能力变化、生成下一步行动建议的真实可用成长中心。

**Architecture:** 保留现有 Express API 路由、`public/api-client.js` 客户端方法、`state.abilityProfiles` / `state.trainingPlans` / `state.trainingTaskSubmissions` / `state.essaySessions` 等状态集合，并重写成长页前端和成长数据聚合逻辑。新的成长中心以“用户最近一次作文与训练行为”为主线：展示当前画像、近 7 天训练进展、问题变化、成长时间线和下一步建议，不再展示静态占位地图或重复训练营卡片。

**Tech Stack:** Node.js、Express、静态 HTML/CSS/JS、DeepSeek-compatible Chat API、现有 JSON state、本地测试脚本、Playwright。

**Spec:** 来源为用户 2026-09-06 请求：“成长功能不是修改，而是重做；API 接口等框架内容可以保留，但从 UI 到功能代码等全部事项都应删除重做。”本计划同时包含删除范围、保留范围、重建设计与执行步骤。

## Global Constraints

- 不删除项目文件夹；如需删除文件，只能单个文件处理。本计划阶段不执行删除。
- 不推送 Git。
- 不覆盖旧文档。
- 中文文件读取使用 Node.js UTF-8 方式，不用 PowerShell 直接读取。
- 搜索范围限制在 `D:/tony/黑客松项目`。
- 重做时不影响“我还没写”“我写完了”“素材库”“7 天训练计划”的主路径。
- 主要写作辅导请求继续沿用 300 秒超时策略。
- 成长功能可以调用 DeepSeek，但前端不能接触 API Key。
- 实质开发完成后必须跑冒烟测试，并将测试记录保存到 `test/` 目录，按编号递增命名。

---

## 1. 当前问题判断

### 1.1 现有成长功能表现

- `public/app.html` 中 `view-growth` 由“初始能力测评”“文风档案”“阶段测评”“成长地图”“AI 使用边界”拼成，但这些模块不是一个连续用户路径。
- 截图显示训练计划页面与训练营入口重复，成长能力模块与训练计划/总览的关系不清。
- `public/app.js` 中 `renderGrowthModules()` 会渲染静态成长阶段和 AI 使用边界，属于假内容。
- `renderGrowthTimeline()` 尝试从 `/api/v1/growth/timeline` 读取数据，但服务端目前基本返回空 timeline。
- `assessmentDemo()` 与 `styleProfileDemo()` 是孤立按钮，结果没有自然沉淀到成长页的核心视图。
- 前端 `featureInterfaces` 中仍保留大量“已预留”式描述，容易让用户误以为功能已完成。

### 1.2 可保留基础

- API 客户端已有 `initialAssessment()`、`getAbilityProfile()`、`updateProfileFromReflection()`、`getTodayTasks()`、`createStageReview()`、`getGrowthTimeline()` 等方法。
- 服务端已有 `/api/v1/ability/initial-assessment`、`/api/v1/ability/profile`、`/api/v1/ability/profile/update-from-reflection`、`/api/v1/training-tasks/today`、`/api/v1/training-plans/:planId/stage-review`、`/api/v1/growth/timeline` 等路由。
- `lib/long-term-ability.js` 已有八维能力画像、训练任务、任务反馈、阶段复盘等纯业务函数，可作为框架保留并局部重写。
- `scripts/long-term-ability.test.js` 已能作为长期能力模块回归测试基座。

---

## 2. 删除范围与保留范围

### 2.1 删除或替换的前端内容

**文件：`public/app.html`**

- 删除 `view-growth` 内现有的“双栏初始能力测评 + 文风档案”布局。
- 删除静态“阶段测评”空状态卡。
- 删除静态“成长地图”容器的旧语义。
- 删除“AI 使用边界”作为成长页主体模块的展示位置。
- 删除成长页中与用户真实数据无关的占位说明。

**文件：`public/app.js`**

- 删除或替换 `renderGrowthModules()`。
- 删除或替换旧 `renderGrowthTimeline()`。
- 删除成长页依赖静态 stages 数组的成长地图逻辑。
- 删除 `featureInterfaces` 中与成长页“已预留”假入口强绑定的旧描述，或改成真实功能状态。
- 将 `assessmentDemo()` 和 `styleProfileDemo()` 从“孤立 demo 按钮”改造成成长页数据入口；若暂不承担新路径，则从成长页 UI 删除。

**文件：`public/styles.css` / `public/app-apple.css`**

- 删除或停用只服务旧成长地图、旧边界卡、旧重复面板的样式。
- 保留通用布局、按钮、面板、输入框、标签、进度条样式。
- 新增成长中心需要的能力雷达/条形评分、趋势列表、时间线、下一步行动卡样式。

### 2.2 删除或替换的后端功能内容

**文件：`server.js`**

- 不删除现有成长相关路由名。
- 替换 `/api/v1/growth/timeline` 的空返回逻辑，改为从真实 state 聚合成长事件。
- 替换 `/api/v1/ability/profile` 的默认占位数据，改为更明确的“未测评但可行动”状态。
- 调整 `/api/v1/ability/profile/update-from-reflection`，让它能生成可展示的变化记录。
- 必要时新增内部 helper，不改变已有公开 API 路径。

**文件：`lib/long-term-ability.js`**

- 保留八维能力体系与基础函数。
- 重写或增强“成长摘要”“下一步建议”“阶段变化归因”的纯函数。
- 不保留只返回全 60 分且缺乏行动意义的默认画像作为前端主展示内容。

### 2.3 暂时保留的框架内容

- `public/api-client.js` 现有方法名保留，避免前端调用面震荡。
- `state.abilityProfiles`、`state.trainingPlans`、`state.trainingTaskSubmissions`、`state.essaySessions`、`state.essayReflections` 集合保留。
- 现有训练计划 API 保留，不把“成长重做”扩散成“训练计划重做”。
- `scripts/long-term-ability.test.js` 保留并扩展。
- `/api/v1/growth/timeline` 路由保留，但返回结构升级。

---

## 3. 新成长功能设计

### 3.1 新页面定位

成长页不再是“几个未来功能的占位页”，而是用户的写作成长中心，回答 4 个问题：

- 我现在作文能力大概在哪里？
- 最近做过哪些作文、训练、修改和复盘？
- 哪些问题正在减少，哪些问题还反复出现？
- 下一步最应该做什么？

### 3.2 页面结构

新的 `view-growth` 建议改成 5 个区域：

1. **成长总览**
   - 当前阶段：未测评 / 基础期 / 进阶期 / 提升期 / 冲刺期。
   - 当前重点：从能力画像或最近训练计划中提取。
   - 最近活动：最近一次作文、最近一次训练、最近一次复盘。
   - 下一步按钮：去测评 / 去训练 / 去体检 / 继续计划。

2. **能力画像**
   - 展示八维能力分数。
   - 无画像时展示一个“粘贴一篇作文生成画像”的入口。
   - 有画像时展示优势、短板、当前重点和更新时间。

3. **近 7 天成长记录**
   - 从训练计划任务、作文会话、复盘记录中聚合。
   - 每条记录包含：日期、动作类型、标题、产物摘要、关联维度。
   - 空状态必须可行动：提示用户先完成一次体检或训练。

4. **反复问题与变化**
   - 展示常见问题、出现次数、最近是否改善。
   - 来源优先级：作文诊断 priorityIssues > 任务反馈 relatedIssues > 复盘 recurringIssues。
   - 不做精确承诺，只做趋势提示。

5. **下一步行动**
   - 生成 1 到 3 个具体按钮：
     - “用最近作文生成能力画像”
     - “继续今天的 7 天训练”
     - “用最近诊断做一次复盘”
     - “去我还没写生成新作文”

### 3.3 数据返回结构

保留 `/api/v1/growth/timeline`，升级为：

```js
{
  stage: '未测评',
  currentFocus: [],
  abilityProfile: {
    stage: '未测评',
    dimensionScores: {},
    strengths: [],
    weaknesses: [],
    updatedAt: ''
  },
  weeklySummary: {
    completedTasks: 0,
    essaySessions: 0,
    reflections: 0,
    activeDays: 0
  },
  timeline: [
    {
      id: 'event_x',
      type: 'essay_session',
      title: '那一刻，我长大了',
      date: '2026-09-06',
      summary: '完成构思与段落提示',
      relatedDimensions: ['选材能力', '结构能力'],
      sourceId: 'essay_session_x'
    }
  ],
  recurringIssues: [
    {
      title: '素材不够具体',
      count: 2,
      trend: 'stable',
      suggestion: '下一次优先补动作、对话和感官细节。'
    }
  ],
  nextActions: [
    {
      actionId: 'continue_training',
      label: '继续今天训练',
      view: 'training',
      reason: '已有进行中的 7 天计划。'
    }
  ],
  emptyState: {
    reason: 'no_profile',
    message: '还没有成长记录。先粘贴一篇作文生成能力画像。'
  }
}
```

### 3.4 前端交互原则

- 成长页默认先拉取 `/api/v1/growth/timeline`。
- 无数据时只显示一个主要入口，不堆多个占位卡。
- 测评输入框只在需要时展开，不默认占据首屏大面积空间。
- 点击下一步行动时复用现有 `showView()` 切换到目标板块。
- 请求失败时保留当前已渲染内容，只在局部区域展示中文错误。
- 不再显示“已预留”“未来支持”这类占位文案。

---

## 4. 文件结构计划

### Task 1: 锁定重做边界与失败测试

**Files:**
- Modify: `scripts/long-term-ability.test.js`
- Create: `scripts/growth-page-frontend.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: 现有 `longTermAbility` 导出函数、`public/app.html`、`public/app.js`
- Produces: 新测试脚本 `npm run test:growth-page`

- [ ] **Step 1: 写后端聚合失败测试**

在 `scripts/long-term-ability.test.js` 中增加断言，要求长期能力模块能从画像、计划、提交、作文会话中生成成长摘要。建议新增纯函数目标：

```js
const snapshot = longTermAbility.buildGrowthSnapshot({
  abilityProfile: {
    stage: '进阶期',
    currentFocus: '细节能力',
    dimensionScores: { 细节能力: 55, 结构能力: 65 }
  },
  trainingPlans: [{
    id: 'plan_1',
    status: '进行中',
    days: [{ taskId: 'task_1', title: '第1天：审题与立意', status: '已完成', relatedDimension: '审题能力', completedAt: '2026-09-06T10:00:00.000Z' }]
  }],
  essaySessions: [{ id: 'essay_1', title: '那一刻，我长大了', status: 'reflected', updatedAt: '2026-09-06T11:00:00.000Z' }],
  reflections: [{ id: 'reflection_1', recurringIssues: ['素材不够具体'], learnedSkills: ['补动作细节'], createdAt: '2026-09-06T12:00:00.000Z' }],
  submissions: []
});
assert.strictEqual(snapshot.stage, '进阶期');
assert.ok(snapshot.timeline.length >= 3);
assert.ok(snapshot.recurringIssues.some((item) => item.title === '素材不够具体'));
assert.ok(snapshot.nextActions.length >= 1);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:long-term-ability`

Expected: FAIL，原因是 `buildGrowthSnapshot` 尚未实现。

- [ ] **Step 3: 写前端失败测试**

创建 `scripts/growth-page-frontend.test.js`，检查旧占位被移除、新成长中心钩子存在：

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'app.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const apiClientJs = fs.readFileSync(path.join(root, 'public', 'api-client.js'), 'utf8');

assert(html.includes('id="view-growth"'));
assert(html.includes('growthSnapshot'));
assert(html.includes('growthNextActions'));
assert(!html.includes('AI 使用边界'));
assert(!html.includes('已预留'));
assert(appJs.includes('renderGrowthCenter'));
assert(appJs.includes('loadGrowthSnapshot'));
assert(appJs.includes('getGrowthTimeline'));
assert(apiClientJs.includes('getGrowthTimeline'));
```

- [ ] **Step 4: 给 `package.json` 增加测试脚本**

新增：

```json
"test:growth-page": "node scripts/growth-page-frontend.test.js"
```

- [ ] **Step 5: 运行前端测试确认失败**

Run: `npm run test:growth-page`

Expected: FAIL，原因是旧成长 UI 未删除、新钩子不存在。

---

### Task 2: 重写后端成长快照聚合

**Files:**
- Modify: `lib/long-term-ability.js`
- Modify: `server.js`
- Test: `scripts/long-term-ability.test.js`

**Interfaces:**
- Produces: `longTermAbility.buildGrowthSnapshot(input): GrowthSnapshot`
- Consumes: `state.abilityProfiles`、`state.trainingPlans`、`state.trainingTaskSubmissions`、`state.essaySessions`、`state.essayReflections`

- [ ] **Step 1: 在 `lib/long-term-ability.js` 实现 `buildGrowthSnapshot`**

函数职责：

```js
function buildGrowthSnapshot({
  abilityProfile,
  trainingPlans = [],
  submissions = [],
  essaySessions = [],
  reflections = [],
  now = new Date()
} = {}) {
  // 返回 stage/currentFocus/abilityProfile/weeklySummary/timeline/recurringIssues/nextActions/emptyState
}
```

实现要求：

- 能处理完全无数据的用户。
- 时间线按时间倒序返回，最多 12 条。
- 近 7 天摘要只统计最近 7 天内数据。
- `recurringIssues` 从 `reflections.recurringIssues`、`submissions.relatedIssues`、诊断问题字段中聚合。
- `nextActions` 只返回 1 到 3 个最相关动作。

- [ ] **Step 2: 导出新函数**

在 `module.exports` 中新增：

```js
buildGrowthSnapshot
```

- [ ] **Step 3: 修改 `/api/v1/growth/timeline`**

将当前空返回替换为：

```js
app.get('/api/v1/growth/timeline', (req, res) => {
  const userId = String(req.query?.userId || '').trim() || currentStudentId(req, res);
  const profile = (state.abilityProfiles || []).find((item) => item.userId === userId) || null;
  const plans = (state.trainingPlans || []).filter((item) => item.userId === userId);
  const submissions = (state.trainingTaskSubmissions || []).filter((item) => item.userId === userId);
  const sessions = (state.essaySessions || []).filter((item) => item.userId === userId);
  const reflections = (state.essayReflections || []).filter((item) => {
    const session = sessions.find((essay) => essay.id === item.sessionId || essay.sessionId === item.sessionId);
    return !!session;
  });
  const snapshot = longTermAbility.buildGrowthSnapshot({
    abilityProfile: profile,
    trainingPlans: plans,
    submissions,
    essaySessions: sessions,
    reflections
  });
  return v1Success(req, res, snapshot);
});
```

- [ ] **Step 4: 运行后端测试**

Run: `npm run test:long-term-ability`

Expected: PASS。

---

### Task 3: 删除旧成长页主体 UI，建立新 DOM 骨架

**Files:**
- Modify: `public/app.html`
- Test: `scripts/growth-page-frontend.test.js`

**Interfaces:**
- Produces: 新 DOM 节点 `growthSnapshot`、`growthAbilityPanel`、`growthTimeline`、`growthIssues`、`growthNextActions`

- [ ] **Step 1: 替换 `view-growth` 内容**

将旧内容替换为：

```html
<section class="view" id="view-growth" aria-labelledby="growthTitle">
  <div class="section-head">
    <div>
      <p class="eyebrow">Growth</p>
      <h2 id="growthTitle">成长中心</h2>
    </div>
  </div>

  <div id="growthSnapshot" class="growth-center">
    <section class="growth-overview-panel" id="growthOverview"></section>
    <section class="growth-ability-panel" id="growthAbilityPanel"></section>
    <section class="growth-action-panel" id="growthNextActions"></section>
    <section class="growth-history-panel" id="growthTimeline"></section>
    <section class="growth-issues-panel" id="growthIssues"></section>
  </div>
</section>
```

- [ ] **Step 2: 确保旧文案删除**

确认 `public/app.html` 中不再出现：

- `AI 使用边界`
- `阶段测评`
- `文风档案`
- `生成写作习惯卡`
- 成长页里的旧 `assessmentInput` 默认大文本框

- [ ] **Step 3: 运行前端结构测试**

Run: `npm run test:growth-page`

Expected: 仍可能失败，因为 JS 钩子尚未实现；但 HTML 相关断言应通过。

---

### Task 4: 重写成长页前端功能代码

**Files:**
- Modify: `public/app.js`
- Test: `scripts/growth-page-frontend.test.js`

**Interfaces:**
- Consumes: `window.EssayCoachAPI.getGrowthTimeline()`
- Produces: `loadGrowthSnapshot()`、`renderGrowthCenter(snapshot)`、`renderGrowthEmptyState(snapshot)`、`handleGrowthAction(actionId)`

- [ ] **Step 1: 删除旧渲染函数**

删除或停止调用：

```js
renderGrowthModules()
renderGrowthTimeline()
```

将 `renderDashboard()` 中旧调用替换为：

```js
loadGrowthSnapshot();
```

或只在切换到 `growth` 视图时加载。

- [ ] **Step 2: 实现数据加载**

```js
let growthState = { loading: false, snapshot: null, error: '' };

async function loadGrowthSnapshot() {
  const target = $('#growthSnapshot');
  if (!target) return;
  growthState.loading = true;
  renderGrowthLoading();
  try {
    const snapshot = apiEnabled()
      ? await window.EssayCoachAPI.getGrowthTimeline()
      : demoGrowthSnapshot();
    growthState = { loading: false, snapshot, error: '' };
    renderGrowthCenter(snapshot);
  } catch (error) {
    growthState = { loading: false, snapshot: growthState.snapshot, error: error.message };
    renderGrowthError(error);
  }
}
```

- [ ] **Step 3: 实现主渲染**

`renderGrowthCenter(snapshot)` 必须渲染：

- 当前阶段与当前重点。
- 八维能力分数或测评入口。
- 近 7 天摘要。
- 时间线。
- 反复问题。
- 下一步行动按钮。

- [ ] **Step 4: 实现行动按钮**

行动与视图映射：

```js
const growthActionMap = {
  start_assessment: 'growth',
  continue_training: 'training',
  diagnose_recent: 'revise',
  brainstorm_new: 'brainstorm'
};
```

点击时：

- `continue_training` 切到训练计划。
- `diagnose_recent` 切到我写完了。
- `brainstorm_new` 切到我还没写。
- `start_assessment` 展开成长页内测评输入区。

- [ ] **Step 5: 保留测评入口但改变位置**

无画像时显示一个紧凑测评表单：

```html
<textarea id="growthAssessmentInput" rows="5" placeholder="粘贴一篇最近作文，生成能力画像"></textarea>
<button id="growthAssessmentBtn" type="button" class="primary">生成能力画像</button>
```

调用仍复用：

```js
window.EssayCoachAPI.initialAssessment({ sampleEssay })
```

完成后重新调用 `loadGrowthSnapshot()`。

- [ ] **Step 6: 运行前端测试**

Run: `npm run test:growth-page`

Expected: PASS。

---

### Task 5: 完善成长中心样式

**Files:**
- Modify: `public/styles.css`
- Modify: `public/app-apple.css`
- Test: `scripts/app-apple-theme-ui.test.js`

**Interfaces:**
- Consumes: 新 DOM class：`growth-center`、`growth-overview-panel`、`growth-score-list`、`growth-timeline`、`growth-issue-list`、`growth-action-list`

- [ ] **Step 1: 增加桌面布局**

成长中心桌面布局：

```css
.growth-center {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, .8fr);
  gap: 16px;
}
```

- [ ] **Step 2: 增加移动端布局**

```css
@media (max-width: 760px) {
  .growth-center {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 3: 增加能力分数条**

样式要求：

- 分数条有稳定高度。
- 中文维度名不溢出。
- 低分、中分、高分用不同状态色，但不做一色到底。

- [ ] **Step 4: 增加时间线样式**

时间线要求：

- 每条记录能换行。
- 日期、类型、标题、摘要层级清楚。
- 没有横向滚动。

- [ ] **Step 5: 运行 UI 测试**

Run: `node scripts/app-apple-theme-ui.test.js`

Expected: PASS。

---

### Task 6: API 冒烟测试与本地浏览器检查

**Files:**
- Create: `scripts/growth-api-smoke.test.js`
- Modify: `package.json`
- Create: `test/成长功能重做冒烟测试报告-1.md`

**Interfaces:**
- Consumes: Express app、`/api/v1/growth/timeline`、`/api/v1/ability/initial-assessment`
- Produces: `npm run test:growth-api`

- [ ] **Step 1: 新增 API 冒烟测试**

测试内容：

```js
const createProfile = await request(baseUrl, 'POST', '/api/v1/ability/initial-assessment', {
  userId: 'growth_smoke_user',
  sampleEssay: '那天我第一次独自上台演讲，手心全是汗，但我还是把稿子讲完了。后来我发现自己并不是不能面对紧张。',
  title: '那一刻，我长大了',
  grade: '初二',
  genre: '记叙文'
});
assert.strictEqual(createProfile.status, 200);

const timeline = await request(baseUrl, 'GET', '/api/v1/growth/timeline?userId=growth_smoke_user');
assert.strictEqual(timeline.status, 200);
assert.strictEqual(timeline.json.success, true);
assert.ok(timeline.json.data.abilityProfile);
assert.ok(Array.isArray(timeline.json.data.nextActions));
```

- [ ] **Step 2: 增加脚本**

```json
"test:growth-api": "node scripts/growth-api-smoke.test.js"
```

- [ ] **Step 3: 执行核心测试**

Run:

```text
npm run test:growth-api
npm run test:growth-page
npm run test:long-term-ability
npm run test:training-plan-7d
npm run test:short-guidance-frontend
node scripts/app-apple-theme-ui.test.js
```

Expected: 全部 PASS。

- [ ] **Step 4: 本地浏览器冒烟**

启动本地服务后检查：

- 打开主应用。
- 点击“成长”。
- 无数据时显示清楚的测评入口。
- 粘贴短作文生成能力画像。
- 成长总览、能力画像、下一步行动可以正常显示。
- 切换到训练计划、我还没写、我写完了不受影响。

测试结束后关闭本地服务进程。

- [ ] **Step 5: 保存测试报告**

报告保存为：

```text
test/成长功能重做冒烟测试报告-1.md
```

若已存在则递增编号。

报告必须包含：

- 改动范围。
- 删除内容。
- 保留内容。
- 本地测试命令与结果。
- 浏览器冒烟结果。
- 已知风险。
- 置信度评估。

---

## 5. 验收标准

### 5.1 删除验收

- 成长页不再出现重复训练营卡片。
- 成长页不再出现静态“AI 使用边界”主体卡。
- 成长页不再出现“已预留”占位式模块。
- 成长地图不再用固定 stages 数组假装用户进度。

### 5.2 功能验收

- 无成长数据用户能看到一个明确入口：生成能力画像或开始训练。
- 有能力画像用户能看到阶段、八维分数、优势、短板和当前重点。
- 有训练计划用户能看到最近训练动作与继续训练入口。
- 有作文会话或复盘用户能看到真实时间线节点。
- `/api/v1/growth/timeline` 不再固定返回空 timeline。
- 请求失败时页面不空白，已有内容不被错误覆盖。

### 5.3 回归验收

- “我还没写”构思指导不受影响。
- “我写完了”作文体检不受影响。
- “7 天训练计划”不受影响。
- API Key 仍只从环境变量或 Cloudflare Secret 读取。

---

## 6. 推荐实施顺序

1. 先写失败测试，锁定“旧占位必须消失、新成长快照必须存在”。
2. 先做后端聚合，让成长页有真实数据源。
3. 再替换成长页 DOM，避免新 JS 挂在旧节点上。
4. 再写前端渲染和交互。
5. 最后做样式和浏览器冒烟。

---

## 7. 不在本轮重做范围内

- 不重做 7 天训练计划完整逻辑。
- 不重做“我还没写”板块。
- 不重做“我写完了”诊断和局部修改。
- 不新增付费、账号权限或后台管理功能。
- 不做复杂成就系统、积分系统或排行榜。
- 不承诺精确考试评分，只展示趋势和建议。

---

## 8. 置信度评估

- 置信度：0.88
- 依据：已检查 `public/app.html`、`public/app.js`、`public/api-client.js`、`server.js`、`lib/long-term-ability.js` 和现有测试脚本，确认成长页主体确实偏占位，服务端成长时间线也基本为空；同时确认 API 与状态集合可作为重做骨架保留。
- 不确定性：未在浏览器中逐项点击当前成长页；后续开发时仍需用 Playwright 或本地浏览器确认移动端布局和真实模型调用效果。
