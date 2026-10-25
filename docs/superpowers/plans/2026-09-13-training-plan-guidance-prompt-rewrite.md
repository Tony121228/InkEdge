# 训练计划写作引导提示词重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重做训练计划与短期构思指导相关提示词，让立意、提纲树、段落写作提示从“简短标签”升级为学生看完就知道写什么、怎么写、写哪些细节的具体指导。

**Architecture:** 保留现有 API、阶段状态机和前端页面框架，只重做模型输出契约、模型输入上下文、兜底结构、前端展示和测试口径。后端仍通过 `callEssayGuidanceModel` 调 DeepSeek，前端仍使用现有 `training-plans.js` 渲染阶段结果，但新增展示更细的字段。

**Tech Stack:** Node.js、Express、Cloudflare Worker、静态 HTML/CSS/JS、DeepSeek Chat API、Playwright。

**Spec:** 本计划来自 2026-09-13 用户截图与需求：提纲和段落建议过于模糊，要去除所有“内容精简”提示词，重做提示词并提升真实引导价值。

## Global Constraints

- 不重写训练计划 API 框架，不改 D1 表结构，不改部署路由。
- 不让模型替学生直接写完整作文；允许提供写作对象、细节清单、推进步骤、开头句式方向和自查问题。
- 去除提示词中的“45 字以内、25 字以内、20 字以内、最多 2 项、尽量短、内容精简”等限制。
- 允许结构化输出更长，但仍必须返回合法 JSON，前端必须稳定渲染。
- 主写作辅导模型调用继续使用 300 秒超时。
- 完成后需要保存冒烟测试报告到 `docs/reports/`。

---

## 一、当前需要删除或改掉的内容

### 1. 提示词中的精简约束

**文件：** `server.js`

需要改掉 `GUIDANCE_OUTPUT_CONTRACTS` 中这些约束：

- `topicAnalysis` 的“每个字符串 45 字以内”。
- `materialQuestions` 的“每个字符串尽量 45 字以内”。
- `outlineTree` 的“label 20 字以内，focus 25 字以内”。
- `paragraphGuides` 的“mustInclude、writingPrompts、avoid 每个数组最多 2 项”和“每个字符串尽量 25 字以内”。
- 与训练引导相关的任何“尽量短、简短、精简、少写”式约束。

保留这些安全约束：

- 只返回 JSON。
- 不输出 Markdown。
- 不替学生生成完整作文。
- 不编造学生未提供的事实。
- 素材不足时用问题引导补充。

### 2. 过窄的输出字段

**文件：** `server.js`、`lib/seven-day-training-runner.js`

当前 `outlineTree` 主要依赖 `label`、`focus`，容易生成“秋游缘起”这类空标签。需要新增可操作字段：

- `writeTask`：这一段具体要完成什么。
- `writingObjects`：这一段要写哪些对象，例如人物、地点、动作、景物、心理、对话。
- `detailPlan`：每个对象应写哪些细节。
- `eventBeats`：事情推进的几个小步骤。
- `emotionShift`：情绪或认识如何变化。
- `transitionHint`：如何自然接到下一段。
- `studentChecklist`：写完后自查什么。

当前 `paragraphGuides` 只有 `goal`、`mustInclude`、`writingPrompts`、`starterHint`，需要新增：

- `writingTargets`：本段写作对象清单。
- `howToWrite`：每个对象分别怎么写。
- `detailsToInclude`：必须落地的细节。
- `developmentSteps`：本段写作顺序。
- `sensoryDetails`：可写的视觉、听觉、触觉、动作等。
- `innerThoughtPrompts`：心理或感受追问。
- `selfCheck`：学生写完本段后检查什么。

### 3. 前端浅展示

**文件：** `public/training-plans.js`

当前渲染问题：

- 立意卡片只显示标题、一句提示、素材提示。
- 提纲树节点只显示 `role`、`label`、`focus`。
- 段落卡片只显示目标、必须写入、开头提示、追问和长度。

需要改为展示“写作对象、写法、细节、顺序、自查”，否则即使后端返回详细内容，用户仍然只能看到模糊摘要。

---

## 二、目标输出设计

### 1. 第 1 天：立意方向

每个方向至少包含：

- `title`：方向名。
- `prompt`：这个方向具体写什么事。
- `whyThisFitsTopic`：为什么扣题。
- `materialConnection`：如何使用用户已输入的真实素材。
- `writingPath`：按什么顺序写。
- `keyDetailsToAsk`：继续追问哪些细节。
- `riskReminder`：最容易写空的地方。
- `materialHint`：下一步补素材的提醒。

验收口径：

- 不是泛泛的“写成长、写感悟”。
- 必须引用或改写用户输入素材中的具体词。
- 每个方向能直接引导第 2 天追问。

### 2. 第 3 天：提纲树

提纲树仍保持 4 段主结构，但每个段落节点必须有足够信息：

- `role`：开头、经过、转折、结尾。
- `label`：段落标题，允许较长，但不能只是四五个字标签。
- `focus`：本段核心任务。
- `writeTask`：学生这一段要写成什么效果。
- `writingObjects`：本段要写的对象数组。
- `detailPlan`：对象与细节的对应说明。
- `eventBeats`：本段事件推进步骤。
- `emotionShift`：本段心理变化。
- `transitionHint`：下一段衔接提示。
- `studentChecklist`：写完检查项。
- `children`：可保留子节点，用于展示局部展开。

验收口径：

- 不再出现只有“秋游缘起”“主体”“感受与思考”这类不可执行节点。
- 学生看到每段节点后，应能知道这一段写哪些人、物、动作、场景、心理和转折。
- 不要求模型写成完整段落。

### 3. 第 4 天：段落写作提示

每段提示至少包含：

- `role`：段落角色。
- `goal`：这一段的写作目标。
- `writingTargets`：写作对象列表。
- `howToWrite`：每个对象的写法。
- `detailsToInclude`：细节清单。
- `developmentSteps`：本段写作顺序。
- `writingPrompts`：给学生的追问。
- `starterHint`：只给开头方向，不提供完整段落。
- `avoid`：避免写空的提醒。
- `selfCheck`：本段完成后的检查项。
- `suggestedLength`：建议字数。

验收口径：

- 每段都能回答“写谁/写什么、从哪写起、接着怎么推进、用哪些细节证明”。
- 不再只给“描写天气、地点、人物”这种笼统要求。
- 写作提示必须和第 3 天提纲、用户素材保持一致。

---

## 三、实施任务

### Task 1: 增加提示词质量回归测试

**Files:**
- Create: `scripts/training-plan-guidance-quality.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `server.js` 中的提示词文本、`lib/seven-day-training-runner.js` 的本地兜底输出、`public/training-plans.js` 的展示字段。
- Produces: `npm run test:training-guidance-quality`

- [ ] **Step 1: 写失败测试**

测试应检查：

```js
const fs = require('fs');
const assert = require('assert');

const serverSource = fs.readFileSync('server.js', 'utf8');
const runnerSource = fs.readFileSync('lib/seven-day-training-runner.js', 'utf8');
const frontendSource = fs.readFileSync('public/training-plans.js', 'utf8');

for (const banned of ['45 字以内', '25 字以内', '20 字以内', '最多 2 项', '尽量 25 字以内', '尽量 45 字以内']) {
  assert.ok(!serverSource.includes(banned), `server prompt should remove concise rule: ${banned}`);
}

for (const required of ['whyThisFitsTopic', 'materialConnection', 'writingPath', 'writeTask', 'writingObjects', 'detailPlan', 'eventBeats', 'emotionShift', 'writingTargets', 'howToWrite', 'detailsToInclude', 'developmentSteps', 'selfCheck']) {
  assert.ok(serverSource.includes(required) || runnerSource.includes(required), `guidance schema should include ${required}`);
  assert.ok(frontendSource.includes(required), `frontend should render ${required}`);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/training-plan-guidance-quality.test.js`

Expected: FAIL，至少命中旧的字数限制和缺失的新字段。

- [ ] **Step 3: 在 `package.json` 加脚本**

```json
"test:training-guidance-quality": "node scripts/training-plan-guidance-quality.test.js"
```

- [ ] **Step 4: 完成后重复运行**

Run: `npm run test:training-guidance-quality`

Expected: PASS。

### Task 2: 重写模型输出契约

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: 现有 `callEssayGuidanceModel(taskName, input, outputContract, options)`。
- Produces: 更详细的 `GUIDANCE_OUTPUT_CONTRACTS.topicAnalysis`、`materialQuestions`、`outlineTree`、`paragraphGuides`、`guidedWriting`。

- [ ] **Step 1: 删除精简化约束**

从训练指导相关契约中删除所有短字数限制和数组项限制，只保留结构化 JSON、安全边界和“不写完整作文”的要求。

- [ ] **Step 2: 改写 `topicAnalysis` 契约**

新契约要求 3 个立意方向，每个方向必须解释：

```text
angleId、title、prompt、whyThisFitsTopic、materialConnection、writingPath、keyDetailsToAsk、riskReminder、materialHint
```

并要求模型优先贴合 `input.initialMaterial` 和 `planContext.initialMaterial`。

- [ ] **Step 3: 改写 `outlineTree` 契约**

新契约要求每个主段落节点包含：

```text
nodeId、role、label、focus、writeTask、writingObjects、detailPlan、eventBeats、emotionShift、transitionHint、studentChecklist、children
```

其中 `writingObjects`、`eventBeats`、`studentChecklist` 必须是数组；`children` 可以用于细化场景、动作、心理、对话等子节点。

- [ ] **Step 4: 改写 `paragraphGuides` 契约**

新契约要求每段包含：

```text
paragraphId、role、goal、writingTargets、howToWrite、detailsToInclude、developmentSteps、mustInclude、writingPrompts、starterHint、avoid、selfCheck、suggestedLength
```

其中 `writingTargets` 和 `howToWrite` 要能说明“写作对象分别怎么写”。

- [ ] **Step 5: 检查短期构思指导兼容性**

`topicAnalysis`、`materialQuestions`、`guidedWriting` 也被“我还没写”板块使用。保留原字段 `prompt`、`materialHint`、`mustInclude`、`writingPrompts`，避免前端旧组件空白。

### Task 3: 扩展训练 runner 的输入、兜底和归一化

**Files:**
- Modify: `lib/seven-day-training-runner.js`

**Interfaces:**
- Consumes: 新模型契约字段。
- Produces: 即使模型失败，本地兜底也输出可操作的详细提纲和段落提示。

- [ ] **Step 1: 扩展本地兜底立意**

`localTopicArtifact` 的每个方向补充：

```js
{
  whyThisFitsTopic: '说明这个角度怎样扣住题目关键词',
  materialConnection: '说明怎样使用用户输入的真实素材',
  writingPath: '按起因、经过、转折、结果推进',
  keyDetailsToAsk: ['时间地点', '关键动作', '心理变化'],
  riskReminder: '提醒不要写成空泛道理'
}
```

- [ ] **Step 2: 扩展本地兜底提纲**

`localOutlineArtifact` 的四段都补充 `writeTask`、`writingObjects`、`detailPlan`、`eventBeats`、`emotionShift`、`transitionHint`、`studentChecklist`。

- [ ] **Step 3: 扩展本地兜底段落提示**

`localParagraphGuides` 的四段都补充 `writingTargets`、`howToWrite`、`detailsToInclude`、`developmentSteps`、`selfCheck`。

- [ ] **Step 4: 扩展归一化函数**

新增或修改归一化逻辑：

```js
function stringList(value, fallback = []) {
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : item?.text || item?.label || '').filter(Boolean);
  return value ? [String(value)] : fallback;
}
```

用于保证新字段即使模型返回字符串也能渲染成数组。

- [ ] **Step 5: 提高相关阶段 token 空间**

建议调整：

- `topic_angle`: 4000
- `material_questions`: 4000
- `outline_tree`: 5200
- `paragraph_guides`: 6500

保持 300 秒超时，不额外增加重试次数。

### Task 4: 前端展示详细引导字段

**Files:**
- Modify: `public/training-plans.js`
- Modify: `public/styles.css`

**Interfaces:**
- Consumes: 新字段 `whyThisFitsTopic`、`materialConnection`、`writingPath`、`writeTask`、`writingObjects`、`detailPlan`、`eventBeats`、`emotionShift`、`writingTargets`、`howToWrite`、`detailsToInclude`、`developmentSteps`、`selfCheck`。
- Produces: 学生可读的详细训练工作台。

- [ ] **Step 1: 增加对象数组渲染工具**

在 `training-plans.js` 增加：

```js
function detailListMarkup(title, items, emptyText) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!values.length) return '';
  return `<div class="guidance-detail-block"><strong>${esc(title)}</strong><ul>${values.map((item)=>`<li>${esc(typeof item === 'string' ? item : item.text || item.label || item.aspect || item.how || '')}</li>`).join('')}</ul></div>`;
}
```

- [ ] **Step 2: 升级立意卡片**

立意方向卡片展示：

- 为什么扣题。
- 怎样使用已有素材。
- 写作路径。
- 还要补问的关键细节。
- 风险提醒。

- [ ] **Step 3: 升级提纲树节点**

`renderOutlineNode` 不只显示 `label/focus`，还展示：

- 这一段写什么。
- 写作对象。
- 细节安排。
- 事件推进。
- 心理变化。
- 衔接提示。
- 自查项。

- [ ] **Step 4: 升级段落提示卡片**

每段卡片展示：

- 写作对象。
- 每个对象怎么写。
- 必须出现的细节。
- 写作顺序。
- 心理追问。
- 避免项。
- 自查项。

- [ ] **Step 5: 样式微调**

新增 `.guidance-detail-block`、`.guidance-field-grid`、`.outline-node-details` 等样式，重点保证：

- 长文本换行。
- 移动端不横向滚动。
- 段落输入框仍在对应提示下方，用户写作时不用反复滚远。

### Task 5: 更新训练计划浏览器和真实 AI 测试

**Files:**
- Modify: `scripts/training-plan-workspace-frontend.test.js`
- Modify: `scripts/training-plan-workspace-full-browser-smoke.test.js`
- Modify: `scripts/training-plan-real-ai-browser-smoke.test.js`
- Modify: `scripts/training-plan-real-ai-stage-smoke.test.js`

**Interfaces:**
- Consumes: 新 UI 字段和真实 AI 返回结构。
- Produces: 能防止“又退回四字提纲”的测试门槛。

- [ ] **Step 1: 静态测试检查新字段**

在 `test:training-workspace` 中确认前端源码包含新字段渲染。

- [ ] **Step 2: 本地完整浏览器测试检查细节区**

在 Day 3 后检查页面包含“这一段写什么”“写作对象”“细节安排”等文本。

- [ ] **Step 3: 真实 AI 浏览器测试增加质量断言**

在真实 AI 测试中增加启发式检查：

```js
assert.ok(JSON.stringify(outlineArtifact).length > 1200, 'outline should contain detailed guidance');
assert.ok(JSON.stringify(paragraphGuidesArtifact).length > 1800, 'paragraph guides should contain detailed guidance');
assert.ok(!JSON.stringify(outlineArtifact).includes('秋游缘起'), 'outline should not collapse to vague four-character labels');
```

这些断言不是评价作文质量的最终标准，但能防止明显退化。

- [ ] **Step 4: 对截图场景做真实文本冒烟**

使用类似“秋游、塔子山公园、鸟林、同学、真实观察”的输入，跑一次真实 AI 路径到 Day 4，确认输出能说明：

- 开头写秋游的时间、地点、人物和进入场景方式。
- 主体写鸟林中的具体观察对象。
- 转折写一次具体发现或互动。
- 结尾写从观察中得到的真实感受。

### Task 6: 回归测试、真实 AI 验证和报告

**Files:**
- Create: `docs/reports/训练计划写作引导提示词重做冒烟测试报告-1.md`

**Interfaces:**
- Consumes: 所有修改后的功能和测试脚本。
- Produces: 编号冒烟报告。

- [ ] **Step 1: 运行基础语法检查**

Run:

```bash
node --check server.js
node --check lib/seven-day-training-runner.js
node --check public/training-plans.js
```

Expected: 全部通过。

- [ ] **Step 2: 运行核心回归**

Run:

```bash
npm run test:training-guidance-quality
npm run test:training-plan-7d
npm run test:training-workspace
npm run test:training-workspace-full-browser
npm run test:short-guidance-frontend
```

Expected: 全部通过。

- [ ] **Step 3: 运行真实 AI 冒烟**

Run:

```bash
npm run test:training-workspace-real-ai
npm run test:training-stage-real-ai
```

Expected: 全部通过，且 Day 3 / Day 4 输出长度和字段完整度达到质量断言。

- [ ] **Step 4: 保存冒烟报告**

报告写入 `docs/reports/训练计划写作引导提示词重做冒烟测试报告-1.md`，内容包括：

- 修改范围。
- 被删除的精简提示词。
- 新增字段。
- 测试命令和结果。
- 真实 AI 输出质量观察。
- 仍需复核的问题。
- 置信度评估。

## 四、验收标准

- `server.js` 中训练写作引导相关提示词不再包含短字数和数组项数精简限制。
- 第 1 天每个立意方向能说明“为什么可写、怎么扣题、怎么用用户素材、下一步追问什么”。
- 第 3 天提纲树不是四字标签，而是每段都有写作任务、对象、细节、推进、心理变化和自查项。
- 第 4 天段落提示能告诉学生每段写哪些方面、分别怎么写、包含哪些细节。
- 前端能完整展示这些字段，长文本不溢出。
- 无密钥兜底和真实 AI 调用都能跑通完整训练路径。

## 五、风险与取舍

- 输出更详细会增加 token 消耗，真实 AI 响应时间可能比现在更长。
- 结构更复杂后，模型偶发漏字段的概率会上升，所以必须加强归一化兜底。
- 前端展示信息变多后，页面需要分层，否则会显得拥挤。
- 不建议让模型输出完整范文；否则会削弱“学生自己写”的训练目标。

## 六、置信度评估

- 置信度：0.88
- 依据：已检查当前 `server.js`、`lib/seven-day-training-runner.js` 和 `public/training-plans.js`，问题与用户截图高度一致；主要根因是提示词强制精简与前端浅字段展示共同导致。
- 不确定性：真实 AI 输出质量仍受模型稳定性影响，需要在实施后用截图同类输入做真实生成验证。
