# InkEdge 页面 UI/UX 全面升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This side conversation forbids sub-agents, so do not dispatch sub-agents while executing from this context.

**Goal:** 全面升级 InkEdge 的主应用、7 天训练计划、学习档案/账户页和首页入口，让用户能更快找到功能、看懂当前状态，并顺畅完成从输入到生成结果再继续操作的路径。

**Architecture:** 先统一视觉基础和组件规则，再逐页改造。保留当前静态 HTML/CSS/JS 架构，不引入 React/Vue 或构建链；优先通过 `public/styles.css`、`public/app-apple.css`、`public/account.css` 和现有渲染函数完成升级。每个阶段都配套可运行测试，避免只做视觉改动却破坏训练、构思、体检等主路径。

**Tech Stack:** 静态 HTML/CSS/JS、Node.js、Express、Playwright、现有 `api-client.js`、现有主题切换脚本。

**Spec:** 当前用户请求“生成一份计划，全面升级页面UI/UX”；参考现有文档 `docs/UI改版计划-青春配色与信息可视化.md`，并以当前代码文件 `public/app.html`、`public/app.js`、`public/training-plans.html`、`public/training-plans.js`、`public/styles.css`、`public/app-apple.css`、`public/account.html`、`public/account.css` 为实际依据。

## Global Constraints

- 不改变后端接口路径和返回结构，除非后续用户另行批准。
- 不引入前端构建链，不新增 React/Vue/Svelte 等框架。
- 保留当前深浅主题切换能力，默认主题由现有实现决定，不在本计划中强行切换默认主题。
- 卡片圆角保持 8px 或以下，除非现有账户页组件在单独任务中统一回收。
- 不使用大面积单一紫蓝、米色、棕橙、深蓝单色调；主色以蓝绿色为核心，辅色只用于状态和区分层级。
- 页面第一屏必须出现实际可用入口，不做纯宣传页。
- 不把功能说明写成大段内置教学文字，优先使用短标签、清晰按钮、状态提示和结果结构。
- 移动端不得依赖横向滚动完成主要功能。
- 新增测试报告保存到 `docs/reports/`，不新增到 `test/`。
- 若测试启动本地服务，测试结束必须关闭服务。
- 不推送 Git，不删除文件夹。

---

## File Structure

**Modify**

- `public/styles.css`
  - 全局 tokens、基础组件、主应用布局、训练计划页面、移动端规则、状态样式。
- `public/app-apple.css`
  - 当前主应用专用视觉层。需要收敛与 `styles.css` 的重复规则，统一按钮、卡片、输入框和导航状态。
- `public/app.html`
  - 主应用页面结构。主要调整语义分组、入口区、表单区域、结果区域和可访问性属性。
- `public/app.js`
  - 主应用渲染函数。主要调整总览、构思、体检、局部修改、素材库、成长模块的 DOM 输出结构和状态文案。
- `public/training-plans.html`
  - 7 天训练计划页面外壳。主要调整顶部、阶段区、状态区的结构。
- `public/training-plans.js`
  - 7 天训练计划各阶段渲染。重点改造 Day 1 到 Day 7 的表单、结果、下一步操作和错误状态。
- `public/account.html`
  - 学习档案/账户页结构。统一顶部导航、账户信息、算力流水、管理员区域的层级。
- `public/account.css`
  - 账户页专用样式。需要对齐 `styles.css` 和 `app-apple.css` 的 tokens、圆角、按钮、卡片和移动端规则。
- `public/landing.css`
  - 首页入口样式。减少独立视觉体系，和主应用品牌保持一致。
- `scripts/short-guidance-frontend.test.js`
  - 增加主应用 UI 结构检查。
- `scripts/training-plan-workspace-frontend.test.js`
  - 增加训练计划 UI 结构检查。
- `scripts/app-apple-theme-ui.test.js`
  - 扩展主题、对比度、按钮状态和移动端检查。

**Create**

- `scripts/ui-ux-primary-flows-smoke.test.js`
  - Playwright 冒烟，覆盖桌面和移动端主要用户路径。
- `scripts/ui-ux-static-contract.test.js`
  - 静态断言，防止旧占位文案、旧入口、错误圆角和重复布局回流。
- `docs/reports/UIUX全面升级冒烟测试报告-1.md`
  - 完成较大改动后的测试记录。

---

## Task 1: 建立 UI/UX 基线与问题清单

**Files:**
- Create: `scripts/ui-ux-static-contract.test.js`
- Modify: `package.json`
- Create: `docs/reports/UIUX升级基线检查报告-1.md`

**Interfaces:**
- Consumes: 当前 `public/*.html`、`public/*.css`、`public/*.js`
- Produces: `npm run test:ui-ux-static`，供后续每个任务重复验证

- [ ] **Step 1: 新建静态契约测试**

Create `scripts/ui-ux-static-contract.test.js` with checks like:

```js
const assert = require('assert');
const fs = require('fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const appHtml = read('public/app.html');
const appJs = read('public/app.js');
const styles = read('public/styles.css');
const trainingHtml = read('public/training-plans.html');
const trainingJs = read('public/training-plans.js');
const accountHtml = read('public/account.html');
const accountCss = read('public/account.css');

for (const text of ['训练计划工作台正在重做', '下一步会在这里接入完整 7 天训练流程', '14 天', '30 天']) {
  assert(!appJs.includes(text), `main app should not show stale training placeholder: ${text}`);
  assert(!trainingHtml.includes(text), `training page should not show unrelated plan text: ${text}`);
  assert(!trainingJs.includes(text), `training JS should not show unrelated plan text: ${text}`);
}

assert(appHtml.includes('id="view-dashboard"'), 'main app keeps dashboard view');
assert(appHtml.includes('id="view-brainstorm"'), 'main app keeps brainstorm view');
assert(appHtml.includes('id="view-revise"'), 'main app keeps revise view');
assert(appHtml.includes('id="view-materials"'), 'main app keeps materials view');
assert(appHtml.includes('id="view-training"'), 'main app keeps training view');
assert(appHtml.includes('id="view-growth"'), 'main app keeps growth view');

assert(trainingHtml.includes('id="trainingWorkbench"'), 'training page keeps workbench root');
assert(trainingJs.includes('renderTopicAngleStage'), 'training page keeps Day 1 renderer');
assert(trainingJs.includes('renderRevisionReflectionStage'), 'training page keeps Day 7 renderer');

assert(styles.includes('--mint'), 'global styles keep primary color token');
assert(accountCss.includes('.account-chip'), 'account page keeps account trigger styles');
```

- [ ] **Step 2: 增加 npm 脚本**

Modify `package.json`:

```json
{
  "scripts": {
    "test:ui-ux-static": "node scripts/ui-ux-static-contract.test.js"
  }
}
```

Keep existing scripts unchanged.

- [ ] **Step 3: 运行基线测试**

Run:

```bash
npm run test:ui-ux-static
npm run test:short-guidance-frontend
npm run test:training-workspace
```

Expected:

```text
all commands exit 0
```

If any command fails because it reveals a current known UI problem, record that failure in the baseline report before fixing.

- [ ] **Step 4: 写基线报告**

Create `docs/reports/UIUX升级基线检查报告-1.md` with:

```md
# UI/UX 升级基线检查报告-1

## 检查范围
- 主应用：app.html/app.js/styles.css/app-apple.css
- 训练计划：training-plans.html/training-plans.js
- 学习档案/账户页：account.html/account.css/account.js

## 当前主要问题
- 视觉规则分散在 styles.css、app-apple.css、account.css，按钮和卡片观感不一致。
- 主应用入口区、训练计划页和账户页不是同一套页面骨架。
- 结果区层级依赖文字堆叠，长内容扫读成本高。
- 移动端需要重点检查表单、阶段卡、结果卡是否溢出。

## 已运行命令
- npm run test:ui-ux-static
- npm run test:short-guidance-frontend
- npm run test:training-workspace

## 结论
记录每条命令的退出码和异常。
```

---

## Task 2: 统一设计 Tokens 与基础组件

**Files:**
- Modify: `public/styles.css`
- Modify: `public/app-apple.css`
- Modify: `public/account.css`
- Modify: `scripts/app-apple-theme-ui.test.js`

**Interfaces:**
- Consumes: 现有 CSS 变量 `--ink`、`--muted`、`--line`、`--paper`、`--mint`、`--blue`
- Produces: 统一 tokens 和基础类：`.ui-button-primary`、`.ui-button-secondary`、`.ui-panel`、`.ui-field`、`.ui-status`

- [ ] **Step 1: 在 `styles.css` 定义统一组件变量**

Add near `:root`:

```css
:root {
  --radius-card: 8px;
  --radius-control: 8px;
  --space-page-x: 32px;
  --space-section: 18px;
  --focus-ring: 0 0 0 3px rgba(71, 210, 197, 0.28);
  --cta-solid: var(--mint);
  --cta-solid-hover: #58ded2;
}
```

For light theme:

```css
html[data-theme="light"] {
  --cta-solid: var(--mint);
  --cta-solid-hover: #22c6a5;
}
```

- [ ] **Step 2: 建立基础按钮类**

Add:

```css
.ui-button-primary,
button.primary,
a.button.primary {
  min-height: 44px;
  border: 1px solid var(--cta-solid);
  border-radius: var(--radius-control);
  background: var(--cta-solid);
  color: #061622;
  font-weight: 850;
  text-decoration: none;
}

.ui-button-primary:hover,
button.primary:hover,
a.button.primary:hover {
  background: var(--cta-solid-hover);
}

.ui-button-secondary {
  min-height: 44px;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--button-bg);
  color: var(--ink);
}
```

- [ ] **Step 3: 建立基础面板和字段类**

Add:

```css
.ui-panel {
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--paper);
  box-shadow: var(--shadow);
}

.ui-field {
  display: grid;
  gap: 8px;
}

.ui-field label,
.ui-field-title {
  color: var(--muted);
  font-weight: 850;
}

.ui-status {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border-radius: var(--radius-control);
  border: 1px solid rgba(71, 210, 197, 0.36);
  background: rgba(71, 210, 197, 0.10);
  color: var(--mint);
  font-weight: 900;
}
```

- [ ] **Step 4: 收敛 `app-apple.css` 重复 tokens**

In `public/app-apple.css`, keep app-specific tokens, but ensure these map to the new globals:

```css
:root {
  --radius-card: 8px;
  --radius-control: 8px;
  --cta-solid: var(--app-accent);
  --cta-solid-hover: var(--app-accent-hover);
}
```

Replace large local radius usages for ordinary cards and controls with `var(--radius-card)` and `var(--radius-control)`. Keep splash or special brand animation only where already visually required.

- [ ] **Step 5: 收敛 `account.css` 面板圆角**

Replace:

```css
.panel {
  border-radius: 18px;
}
```

with:

```css
.panel {
  border-radius: var(--radius-card);
}
```

Replace `.account-chip` and `.stat-card` radius with `var(--radius-control)`.

- [ ] **Step 6: 扩展主题测试**

In `scripts/app-apple-theme-ui.test.js`, add assertions:

```js
const rootVars = await page.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  return {
    radiusCard: root.getPropertyValue('--radius-card').trim(),
    ctaSolid: root.getPropertyValue('--cta-solid').trim(),
    focusRing: root.getPropertyValue('--focus-ring').trim()
  };
});

assert.strictEqual(rootVars.radiusCard, '8px', 'card radius should be capped at 8px');
assert.ok(rootVars.ctaSolid, 'primary CTA token should be defined');
assert.ok(rootVars.focusRing.includes('rgba'), 'focus ring token should be visible');
```

- [ ] **Step 7: 验证**

Run:

```bash
npm run test:ui-ux-static
node scripts/app-apple-theme-ui.test.js
```

Expected:

```text
all commands exit 0
```

---

## Task 3: 重整主应用骨架和导航体验

**Files:**
- Modify: `public/app.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `public/nav-hotfix.js`
- Modify: `scripts/short-guidance-frontend.test.js`

**Interfaces:**
- Consumes: existing view ids `dashboard`、`brainstorm`、`revise`、`materials`、`training`、`growth`
- Produces: 更清楚的页面骨架、导航状态和入口跳转

- [ ] **Step 1: 给主应用增加统一页面骨架类**

In `public/app.html`, change:

```html
<main class="shell">
```

to:

```html
<main class="shell app-workspace-shell">
```

Change:

```html
<section class="workspace">
```

to:

```html
<section class="workspace app-workspace-grid">
```

- [ ] **Step 2: 导航按钮加短标签属性**

For each side nav button:

```html
<button class="nav-item active" type="button" data-view="dashboard" data-short-label="总览">总览</button>
```

Repeat for:

```text
我还没写
我写完了
素材库
训练计划
成长
```

- [ ] **Step 3: 更新导航样式**

Add:

```css
.app-workspace-grid {
  align-items: start;
}

.side-nav {
  gap: 10px;
}

.side-nav .nav-item {
  min-height: 48px;
  justify-content: flex-start;
  border-radius: var(--radius-control);
}

.side-nav .nav-item.active {
  border-color: rgba(71, 210, 197, 0.72);
  background: rgba(71, 210, 197, 0.14);
  color: var(--mint);
}

.side-nav .nav-item:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
```

- [ ] **Step 4: 防止 `nav-hotfix.js` 抢默认视图**

Current `ensureDefault()` may force `brainstorm` if dashboard has no visible input. Change it to:

```js
function ensureDefault(){
  const active = document.querySelector('.view.active');
  if(active) return;
  switchView('dashboard');
}
```

- [ ] **Step 5: 更新前端测试**

In `scripts/short-guidance-frontend.test.js`, add:

```js
assert(appHtml.includes('app-workspace-shell'), 'app should use unified workspace shell');
assert(appHtml.includes('app-workspace-grid'), 'app should use unified workspace grid');
assert(navHotfixJs.includes(\"switchView('dashboard')\"), 'nav hotfix should default to dashboard when no active view exists');
```

Read `public/nav-hotfix.js` at top of the test:

```js
const navHotfixJs = read('public/nav-hotfix.js');
```

- [ ] **Step 6: 验证**

Run:

```bash
npm run test:short-guidance-frontend
npm run test:ui-ux-static
```

Expected:

```text
all commands exit 0
```

---

## Task 4: 升级总览页和主功能入口

**Files:**
- Modify: `public/app.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `scripts/short-guidance-frontend.test.js`

**Interfaces:**
- Consumes: `data-overview-goto` and existing `data-view`
- Produces: 总览页四个主要入口和两个辅助入口，状态明确、按钮明显

- [ ] **Step 1: 调整总览页入口结构**

Keep `#overviewFeatureGrid`, but standardize each card:

```html
<article class="feature-card primary-flow-card">
  <div class="feature-top"><span>开始</span><strong>构思</strong></div>
  <h3>我还没写</h3>
  <p>从题目和真实素材开始，生成立意、追问和段落提示。</p>
  <button class="primary" type="button" data-overview-goto="brainstorm">开始构思</button>
</article>
```

Use the same structure for:

```text
作文体检 -> revise
素材库 -> materials
训练计划 -> training
成长 -> growth
学习档案 -> account.html link
```

- [ ] **Step 2: 在 `app.js` 保持入口跳转稳定**

Ensure click handler supports both buttons and links:

```js
const overviewButton = event.target.closest('[data-overview-goto]');
if (overviewButton) {
  const viewId = overviewButton.dataset.overviewGoto;
  switchView(viewId);
  return;
}
```

Do not remove existing nav item handlers.

- [ ] **Step 3: 视觉样式**

Add:

```css
.primary-flow-card {
  display: grid;
  min-height: 230px;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
}

.primary-flow-card .primary {
  width: 100%;
}

.feature-top span {
  border-radius: var(--radius-control);
}
```

- [ ] **Step 4: 空态更清楚**

When dashboard data is empty, render short empty state:

```js
recentIssues.innerHTML = '<div class="empty-state">还没有作文记录。完成一次体检后，这里会显示常见问题。</div>';
```

Do not render long explanatory paragraphs.

- [ ] **Step 5: 测试**

Add to `scripts/short-guidance-frontend.test.js`:

```js
for (const goto of ['brainstorm', 'revise', 'materials', 'training', 'growth']) {
  assert(appHtml.includes(`data-overview-goto="${goto}"`), `dashboard should expose goto ${goto}`);
}
assert(stylesCss.includes('primary-flow-card'), 'dashboard cards should use primary-flow-card style');
```

- [ ] **Step 6: 验证**

Run:

```bash
npm run test:short-guidance-frontend
```

Expected:

```text
exit 0
```

---

## Task 5: 升级“我还没写”写作引导 UX

**Files:**
- Modify: `public/app.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `scripts/short-guidance-frontend.test.js`

**Interfaces:**
- Consumes: existing brainstorm state fields `topic`、`grade`、`genre`、`initialMaterial`、`topicAnalysis`、`materialQuestions`、`guidedWriting`
- Produces: 更清楚的输入区、追问区、提纲区、段落写作区和“我写完了”转换动作

- [ ] **Step 1: 表单分组**

Wrap brainstorm form fields in:

```html
<div class="writing-flow-panel" data-flow-step="input">
  <div class="flow-step-head">
    <span>1</span>
    <div>
      <h3>先告诉我题目和素材</h3>
      <p>素材可以很短，真实比完整更重要。</p>
    </div>
  </div>
  ...
</div>
```

Use this structure only inside `#view-brainstorm`.

- [ ] **Step 2: 改造结果渲染容器**

In `renderBrainstormResult()` or equivalent renderer, output separate containers:

```html
<section class="writing-flow-panel" data-flow-step="angles"></section>
<section class="writing-flow-panel" data-flow-step="questions"></section>
<section class="writing-flow-panel" data-flow-step="outline"></section>
<section class="writing-flow-panel" data-flow-step="paragraphs"></section>
```

Do not put all generated guidance into a single undifferentiated result box.

- [ ] **Step 3: 追问回答框有明确位置**

For each material question, render:

```html
<label class="question-answer-card">
  <strong>问题文本</strong>
  <span>这个问题帮助你补充什么</span>
  <textarea class="material-answer-input" rows="4"></textarea>
</label>
```

- [ ] **Step 4: 段落草稿输入框保持可编辑**

For each paragraph guide, render:

```html
<label class="paragraph-writing-card">
  <strong>第 1 段：开头</strong>
  <span>这一段该写什么</span>
  <textarea class="paragraph-draft-input" rows="7"></textarea>
</label>
```

The final button text remains:

```text
我写完了
```

- [ ] **Step 5: 样式**

Add:

```css
.writing-flow-panel {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--paper);
}

.flow-step-head {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.flow-step-head > span {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-control);
  background: rgba(71, 210, 197, 0.14);
  color: var(--mint);
  font-weight: 900;
}

.question-answer-card,
.paragraph-writing-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: rgba(10, 18, 32, 0.36);
}
```

- [ ] **Step 6: 测试**

Add assertions:

```js
for (const selectorText of ['writing-flow-panel', 'question-answer-card', 'paragraph-writing-card']) {
  assert(appJs.includes(selectorText) || appHtml.includes(selectorText), `brainstorm UI should include ${selectorText}`);
}
```

- [ ] **Step 7: 验证**

Run:

```bash
npm run test:short-guidance-frontend
npm run test:essay-guidance
```

Expected:

```text
all commands exit 0
```

---

## Task 6: 升级作文体检与局部修改结果 UX

**Files:**
- Modify: `public/app.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `scripts/short-guidance-frontend.test.js`

**Interfaces:**
- Consumes: existing diagnosis and revision result renderers
- Produces: 问题优先级、修改建议、示范句和下一步操作的清楚层级

- [ ] **Step 1: 体检报告分区**

Render diagnosis result as:

```html
<section class="diagnosis-report">
  <article class="diagnosis-summary-card"></article>
  <article class="diagnosis-priority-card"></article>
  <article class="diagnosis-detail-card"></article>
  <article class="diagnosis-next-action-card"></article>
</section>
```

- [ ] **Step 2: 问题卡使用统一结构**

Each issue:

```html
<article class="diagnosis-issue-card" data-priority="high">
  <div class="issue-card-head">
    <span>优先改</span>
    <strong>问题标题</strong>
  </div>
  <p>问题说明</p>
  <small>建议动作</small>
</article>
```

- [ ] **Step 3: 局部修改建议分三栏**

For local revision:

```html
<section class="revision-suggestion-grid">
  <article><h3>问题</h3></article>
  <article><h3>怎么改</h3></article>
  <article><h3>示范句</h3></article>
</section>
```

On mobile, this grid becomes one column.

- [ ] **Step 4: 样式**

Add:

```css
.diagnosis-report,
.revision-suggestion-grid {
  display: grid;
  gap: 14px;
}

.revision-suggestion-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.diagnosis-issue-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--soft);
}

@media (max-width: 980px) {
  .revision-suggestion-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: 测试**

Add:

```js
for (const hook of ['diagnosis-report', 'diagnosis-issue-card', 'revision-suggestion-grid']) {
  assert(appJs.includes(hook), `diagnosis/revision renderer should include ${hook}`);
}
```

- [ ] **Step 6: 验证**

Run:

```bash
npm run test:short-guidance-frontend
npm run test:essay-guidance-missing-key
```

Expected:

```text
all commands exit 0
```

---

## Task 7: 升级素材库、成长地图和学习档案入口

**Files:**
- Modify: `public/app.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `public/account.html`
- Modify: `public/account.css`

**Interfaces:**
- Consumes: existing materials state and growth renderers
- Produces: 素材卡、成长卡、学习档案入口的一致布局

- [ ] **Step 1: 素材库卡片标准化**

Render each material as:

```html
<article class="material-card">
  <div class="material-card-head">
    <span>素材</span>
    <strong>素材标题</strong>
  </div>
  <p>素材摘要</p>
  <div class="material-tags"></div>
</article>
```

- [ ] **Step 2: 成长地图分成三块**

Use:

```html
<section class="growth-dashboard">
  <article class="growth-level-card"></article>
  <article class="growth-focus-card"></article>
  <article class="growth-history-card"></article>
</section>
```

- [ ] **Step 3: 学习档案入口保持一致**

In `account.html`, change topbar back link text from:

```text
返回检测页
```

to:

```text
返回工作台
```

Set href:

```html
href="/app.html"
```

- [ ] **Step 4: 账户页面板对齐**

In `account.css`, align:

```css
.layout {
  width: min(1180px, calc(100% - 32px));
}

.panel,
.stat-card,
.package-card {
  border-radius: var(--radius-card);
}
```

- [ ] **Step 5: 样式**

Add:

```css
.material-card,
.growth-level-card,
.growth-focus-card,
.growth-history-card {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--paper);
}

.growth-dashboard {
  display: grid;
  grid-template-columns: 1.1fr 1fr 1fr;
  gap: 14px;
}

@media (max-width: 980px) {
  .growth-dashboard {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 6: 验证**

Run:

```bash
npm run test:short-guidance-frontend
node scripts/account-escape-html.test.js
```

Expected:

```text
all commands exit 0
```

---

## Task 8: 升级 7 天训练计划工作台

**Files:**
- Modify: `public/training-plans.html`
- Modify: `public/training-plans.js`
- Modify: `public/styles.css`
- Modify: `scripts/training-plan-workspace-frontend.test.js`
- Modify: `scripts/training-plan-workspace-browser-smoke.test.js`
- Modify: `scripts/training-plan-workspace-full-browser-smoke.test.js`

**Interfaces:**
- Consumes: stage ids `topic_angle`、`material_questions`、`outline_tree`、`paragraph_guides`、`paragraph_drafting`、`draft_diagnosis`、`revision_reflection`
- Produces: 更清楚的阶段导航、当前任务区、结果区和下一步区

- [ ] **Step 1: 页面骨架分成三层**

In `training-plans.html`, wrap stage panels:

```html
<section class="training-workbench-main">
  <section class="training-stage-panel" id="trainingStagePanel"></section>
  <section class="training-artifact-panel" id="trainingArtifactPanel"></section>
  <section class="training-next-step-panel" id="trainingNextStepPanel"></section>
</section>
```

- [ ] **Step 2: 阶段时间线加进度语义**

In `renderStageTimeline(plan)`, add:

```html
aria-current="${day.stageId === trainingState.selectedStageId ? 'step' : 'false'}"
```

and include:

```html
<small>${index + 1}/7</small>
```

- [ ] **Step 3: 当前任务区稳定显示**

Every stage renderer must output:

```html
<article class="training-stage-card">
  <div class="training-stage-card-head"></div>
  ...
</article>
```

This applies to all seven renderers.

- [ ] **Step 4: 结果区稳定显示**

Every artifact panel must output:

```html
<article class="training-result-card">
  ...
</article>
```

Empty state text must be short:

```text
生成后显示在这里。
```

- [ ] **Step 5: 下一步区更明确**

Every next step panel must include a primary or secondary action if the current stage has produced required artifacts. Use:

```html
<button class="primary hollow" type="button" data-action="go-next-stage">进入下一步</button>
```

Use specific button text only where it helps:

```text
进入素材追问
生成段落提示
开始分段写作
进入草稿诊断
进入复盘
```

- [ ] **Step 6: 样式**

Add:

```css
.training-workbench-main {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.2fr);
  gap: 14px;
}

.training-next-step-panel {
  grid-column: 1 / -1;
}

.training-stage-card,
.training-result-card {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--paper);
}

@media (max-width: 980px) {
  .training-workbench-main {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 7: 更新静态测试**

In `scripts/training-plan-workspace-frontend.test.js`, add:

```js
for (const hook of ['training-workbench-main', 'training-stage-card', 'training-result-card']) {
  assert(plansHtml.includes(hook) || plansJs.includes(hook), `training workbench should include ${hook}`);
}
assert(plansJs.includes('aria-current'), 'stage timeline should expose current step semantics');
```

- [ ] **Step 8: 更新浏览器冒烟**

In `scripts/training-plan-workspace-browser-smoke.test.js`, after creating a plan:

```js
await page.waitForSelector('.training-stage-card');
await page.waitForSelector('.training-result-card');
await page.waitForSelector('[aria-current="step"]');
```

- [ ] **Step 9: 验证**

Run:

```bash
npm run test:training-workspace
npm run test:training-workspace-browser
npm run test:training-workspace-full-browser
```

Expected:

```text
all commands exit 0
```

---

## Task 9: 加强加载态、错误态和可恢复操作

**Files:**
- Modify: `public/app.js`
- Modify: `public/training-plans.js`
- Modify: `public/styles.css`
- Modify: `scripts/short-guidance-frontend.test.js`
- Modify: `scripts/training-plan-workspace-frontend.test.js`

**Interfaces:**
- Consumes: existing `setButtonBusy`、`setStatus`、result areas
- Produces: 一致 loading、error、success、empty 状态

- [ ] **Step 1: 统一状态 CSS**

Add:

```css
.state-message {
  min-height: 44px;
  display: flex;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--soft);
  color: var(--muted);
}

.state-message.is-error {
  border-color: rgba(255, 138, 112, 0.46);
  background: rgba(255, 138, 112, 0.10);
  color: var(--coral);
}

.state-message.is-success {
  border-color: rgba(71, 210, 197, 0.46);
  background: rgba(71, 210, 197, 0.10);
  color: var(--mint);
}
```

- [ ] **Step 2: 主应用错误提示统一**

Replace ad hoc strings like:

```js
resultArea.innerHTML = `<div class="empty-state">...</div>`;
```

with:

```js
resultArea.innerHTML = `<div class="state-message is-error">${escapeHtml(message)}</div>`;
```

Only use `is-error` for real failures.

- [ ] **Step 3: 训练计划状态统一**

In `setStatus(message, tone)`, emit classes:

```js
target.className = `state-message${tone ? ` is-${tone}` : ''}`;
```

Keep `role="status"` in HTML.

- [ ] **Step 4: 防重复点击**

For all main generation buttons, ensure:

```js
button.disabled = true;
button.classList.add('button-loading');
```

and in `finally`:

```js
button.disabled = false;
button.classList.remove('button-loading');
```

Do not clear previous usable results when a new request fails.

- [ ] **Step 5: 测试**

Add static assertions:

```js
assert(stylesCss.includes('state-message'), 'styles should include shared state message');
assert(appJs.includes('button-loading'), 'main app should use loading state');
assert(trainingPlansJs.includes('button-loading'), 'training page should use loading state');
```

- [ ] **Step 6: 验证**

Run:

```bash
npm run test:short-guidance-frontend
npm run test:training-workspace
```

Expected:

```text
all commands exit 0
```

---

## Task 10: 移动端和可访问性检查

**Files:**
- Create: `scripts/ui-ux-primary-flows-smoke.test.js`
- Modify: `package.json`
- Modify: `public/styles.css`

**Interfaces:**
- Consumes: `/app.html`、`/training-plans.html`、`/account.html`
- Produces: `npm run test:ui-ux-flows`

- [ ] **Step 1: 新建 Playwright 冒烟**

Create `scripts/ui-ux-primary-flows-smoke.test.js`:

```js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-ux-flows-'));
  process.env.APP_DATA_DIR = tempDir;
  process.env.AI_API_KEY = '';
  const app = require('../server');
  const server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });

  try {
    for (const viewport of [
      { width: 1366, height: 900, name: 'desktop' },
      { width: 390, height: 844, name: 'mobile' }
    ]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));

      await page.goto(`${base}/app.html`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.side-nav .nav-item');
      await page.click('[data-overview-goto="brainstorm"]');
      await page.waitForSelector('#view-brainstorm.active');
      await page.click('.side-nav .nav-item[data-view="training"]');
      await page.waitForSelector('#trainingWorkspace');

      await page.goto(`${base}/training-plans.html`, { waitUntil: 'networkidle' });
      await page.click('[data-plan-type="7d"]');
      await page.waitForSelector('[data-action="run-stage"]');

      const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
      assert.strictEqual(horizontalOverflow, false, `${viewport.name} should not have horizontal overflow`);
      assert.deepStrictEqual(errors, [], `${viewport.name} should not throw page errors`);
      await page.close();
    }
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
```

- [ ] **Step 2: 增加 npm 脚本**

Add:

```json
{
  "scripts": {
    "test:ui-ux-flows": "node scripts/ui-ux-primary-flows-smoke.test.js"
  }
}
```

- [ ] **Step 3: 补充 focus-visible**

Add:

```css
button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
```

- [ ] **Step 4: 验证**

Run:

```bash
npm run test:ui-ux-flows
```

Expected:

```text
exit 0
```

---

## Task 11: 清理重复样式和旧 UI 残留

**Files:**
- Modify: `public/styles.css`
- Modify: `public/app-apple.css`
- Modify: `public/account.css`
- Modify: `public/app.html`
- Modify: `public/training-plans.html`
- Modify: `scripts/ui-ux-static-contract.test.js`

**Interfaces:**
- Consumes: results from Tasks 2-10
- Produces: 更少重复规则和旧文案残留

- [ ] **Step 1: 扫描旧文案和旧入口**

Run:

```bash
node -e "const fs=require('fs'),path=require('path');const words=['重做中','训练营','14 天','30 天','考前 10 天','错因本'];for(const f of ['public/app.html','public/app.js','public/training-plans.html','public/training-plans.js']){const s=fs.readFileSync(f,'utf8');for(const w of words){if(s.includes(w)) console.log(f+': '+w)}}"
```

Expected:

```text
no output
```

If `错因本` is intentionally restored later, update the expected terms in `ui-ux-static-contract.test.js` with the exact approved label.

- [ ] **Step 2: 收敛重复 radius**

Search for:

```bash
node -e "const fs=require('fs');for(const f of ['public/styles.css','public/app-apple.css','public/account.css']){const s=fs.readFileSync(f,'utf8');const matches=s.match(/border-radius:\\s*(1[0-9]|2[0-9]|999)px/g)||[];console.log(f,matches)}"
```

For ordinary cards/buttons/inputs, replace with:

```css
border-radius: var(--radius-card);
```

or:

```css
border-radius: var(--radius-control);
```

Keep `999px` only for pill badges if the design needs a pill.

- [ ] **Step 3: 静态测试记录 radius 规则**

Add to `ui-ux-static-contract.test.js`:

```js
for (const file of ['public/styles.css', 'public/app-apple.css', 'public/account.css']) {
  const css = read(file);
  assert(!/border-radius:\s*2[0-9]px/.test(css), `${file} should not use oversized card radius`);
}
```

- [ ] **Step 4: 验证**

Run:

```bash
npm run test:ui-ux-static
npm run test:short-guidance-frontend
npm run test:training-workspace
```

Expected:

```text
all commands exit 0
```

---

## Task 12: 完整冒烟与报告沉淀

**Files:**
- Create: `docs/reports/UIUX全面升级冒烟测试报告-1.md`

**Interfaces:**
- Consumes: all tests from earlier tasks
- Produces: final evidence report

- [ ] **Step 1: 执行自动测试**

Run:

```bash
npm run test:ui-ux-static
npm run test:ui-ux-flows
npm run test:short-guidance-frontend
npm run test:training-workspace
npm run test:training-workspace-browser
npm run test:training-workspace-full-browser
npm run test:essay-guidance-missing-key
node scripts/app-apple-theme-ui.test.js
node scripts/account-escape-html.test.js
```

Expected:

```text
all commands exit 0
```

- [ ] **Step 2: 手动检查页面**

Start local service:

```bash
npm run dev
```

Open:

```text
http://localhost:3000/app.html
http://localhost:3000/training-plans.html
http://localhost:3000/account.html
```

Check:

```text
主入口是否清楚
按钮是否显眼但不花哨
表单是否不溢出
长结果是否可读
移动端是否无横向滚动
深浅主题是否都可读
```

After checking, stop the local service.

- [ ] **Step 3: 写最终报告**

Create `docs/reports/UIUX全面升级冒烟测试报告-1.md`:

```md
# UI/UX 全面升级冒烟测试报告-1

## 检查日期
2026-09-13

## 检查范围
- 主应用 app.html
- 7 天训练计划 training-plans.html
- 学习档案 account.html
- 深浅主题
- 桌面和移动端

## 自动测试结果
逐条记录命令、退出码、关键输出。

## 手动检查结果
记录每个页面的桌面和移动端观察。

## 已知问题
按 P0/P1/P2/P3 标注。

## 结论
说明是否可以进入下一轮功能开发。

## 置信度评估
填写 0 到 1 的置信度，并说明依据。
```

---

## Acceptance Criteria

- 主应用首页 5 秒内能看出主要功能入口。
- “我还没写”从输入、立意、追问、提纲、段落提示到草稿输入的路径清楚。
- “我写完了”和“局部修改”结果不再是一整块长文本，能扫读问题和建议。
- 素材库、成长地图、学习档案的视觉语言统一。
- 7 天训练计划页面能清楚区分阶段导航、当前任务、阶段结果和下一步。
- 所有主要按钮有一致的 hover、focus、disabled、loading 状态。
- 深色和浅色主题都可读，主要文本对比度满足日常使用。
- 桌面和移动端都无关键内容遮挡或横向溢出。
- 所有新增或修改测试通过。
- 冒烟报告保存到 `docs/reports/`。

## Execution Notes

- 建议按 Task 1 到 Task 12 顺序执行，不要跳过基线测试。
- 每个任务完成后至少运行该任务列出的测试。
- 若中途发现 UI 改动影响业务功能，先保功能路径，再调视觉。
- 本计划不要求提交 Git，不要求部署；部署需用户另行确认。

## 置信度评估

置信度：0.87

依据：计划已读取当前主应用、训练计划页、账户页、全局样式、Apple 风格样式、现有 UI 计划和现有前端测试脚本；任务按现有静态 HTML/CSS/JS 架构拆分，避免引入新框架。主要不确定性在于当前 `app-apple.css` 与 `styles.css` 的覆盖关系较复杂，执行时需要通过浏览器截图和主题测试逐步确认，不能只依赖静态检查。
