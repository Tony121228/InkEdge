# 短期单篇作文指导实现计划

> **给后续执行代理的要求：** 实施本计划时，必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，并按任务逐项执行。每一步使用复选框（`- [ ]`）跟踪状态。

**目标：** 将当前项目收缩并打磨成一个专注于“短期单篇作文指导”的工具，帮助学生完成题目理解、真实素材追问、提纲生成、作文体检、局部修改建议和本次复盘。

**架构：** 项目继续保持 Node.js + Express 单体结构。后端统一使用 `/api/v1` 作为新前端合同，短期单篇作文指导能力独立于长期成长系统；长期能力提升接口只保留轻量占位和后续接入点。前端只保留一个干净的作文指导流程页，不再展示检测、反测、账号、算力、充值、管理后台或训练知识库 UI。

**技术栈：** Node.js、Express 5、静态 HTML/CSS、原生 JavaScript、本地 JSON 状态、Node 内置测试脚本。

**依据文档：**

- `C:/Users/Shirly412/Documents/Codex/2026-08-23/offmap-x-1-2-10-3/outputs/作文写作辅助软件改造方向建议.md`
- `C:/Users/Shirly412/Documents/Codex/2026-08-23/offmap-x-1-2-10-3/outputs/三人分工作文训练系统API接口设计.md`

## 全局约束

- 只在 `D:\tony\黑客松项目` 中开发，不修改旧项目目录。
- 当前 MVP 只做短期单篇作文指导。
- 不重新引入 AI 检测、反检测、整篇改写、个人中心、算力、充值、后台管理、训练知识库等 UI。
- 不默认替学生生成完整作文。
- 输出重点是提示、诊断、局部建议、学生确认和本次复盘。
- 必须保护事实边界：不能编造时间、人物、地点、动作、对话、感官细节或心理感受。
- 长期能力提升 API 可以保留为占位或轻量联调接口，除非用户明确要求，否则不展开完整长期系统。
- 每次行为改动都先写或更新聚焦测试，确认测试按预期失败，再实现，再确认通过。
- 项目有较大实质改动后，必须进行冒烟测试，并把测试记录保存为编号 Markdown 文档。

---

## 文件职责

- `lib/essay-guidance.js`
  - 负责短期单篇作文指导的本地规则逻辑。
  - 输出题目分析、素材追问、提纲、诊断、局部修改建议、草稿对比、复盘、轻量能力测评等纯函数。

- `server.js`
  - 负责 Express 路由、状态保存、请求校验、`/api/v1` 统一返回结构。
  - 只做编排，不把复杂作文指导规则继续塞进路由里。

- `public/index.html`
  - 负责短期单篇作文指导的可见页面结构。

- `public/app.js`
  - 负责前端状态、按钮事件、调用 `/api/v1/essay-sessions` 相关接口、渲染结果。

- `public/styles.css`
  - 负责学习工具风格的页面布局和视觉。

- `public/account.html`
  - 保留为轻量返回页，避免旧账号 UI 被用户绕进去看到。

- `public/account.js`
  - 保持极简，不保留旧账号逻辑。

- `scripts/essay-guidance-api.test.js`
  - 负责短期作文指导后端 API 合同测试。

- `scripts/short-guidance-frontend.test.js`
  - 负责前端静态防回流测试，防止旧检测站 UI 和旧接口引用重新出现。

- `test/单篇作文指导前端清空冒烟测试报告-N.md`
  - 前端或流程改动后的编号冒烟测试记录。

---

### 任务 1：锁定短期作文指导 API 合同

**文件：**

- 修改：`scripts/essay-guidance-api.test.js`
- 修改：`server.js`
- 修改：`lib/essay-guidance.js`

**接口：**

统一成功返回结构：

```js
{
  success: true,
  data: {},
  error: null,
  requestId: "req_or_generated_id"
}
```

MVP 必需接口：

- `POST /api/v1/essay-sessions`
- `GET /api/v1/essay-sessions/:sessionId`
- `POST /api/v1/essay-sessions/:sessionId/topic-analysis`
- `POST /api/v1/essay-sessions/:sessionId/material-questions`
- `POST /api/v1/essay-sessions/:sessionId/materials`
- `POST /api/v1/essay-sessions/:sessionId/outline`
- `POST /api/v1/essay-sessions/:sessionId/diagnose`
- `POST /api/v1/essay-sessions/:sessionId/revision-suggestions`
- `POST /api/v1/essay-sessions/:sessionId/reflection`

- [ ] **第 1 步：添加失败测试**

在 `scripts/essay-guidance-api.test.js` 创建会话后增加：

```js
assert.ok(create.json.data.session);
assert.strictEqual(create.json.data.session.mode, 'brainstorm');
assert.strictEqual(create.json.error, null);
```

- [ ] **第 2 步：运行测试确认失败原因正确**

运行：

```powershell
npm run test:essay-guidance
```

预期：如果接口合同缺字段，应失败在 `session` 或 `error` 断言上。

- [ ] **第 3 步：实现最小路由合同**

在 `server.js` 中确保 `POST /api/v1/essay-sessions` 返回：

```js
return v1Success(req, res, {
  sessionId: session.id,
  nextStep: mode === 'revise' ? 'diagnose' : 'topic_analysis',
  initialQuestions: questions,
  session: serializeEssaySession(session)
});
```

- [ ] **第 4 步：运行测试确认通过**

运行：

```powershell
npm run test:essay-guidance
```

预期：通过。

- [ ] **第 5 步：记录结果**

如果本任务改变了 API 行为，在最新的 `test/作文训练系统API冒烟测试报告-N.md` 后追加结果，或新建 `N+1` 编号报告。

---

### 任务 2：强化题目理解与立意建议

**文件：**

- 修改：`lib/essay-guidance.js`
- 修改：`scripts/essay-guidance-api.test.js`

**接口：**

输入：

```js
essayGuidance.buildTopicAnalysis({ title, genre, grade, target })
```

输出：

```js
{
  topicKeywords: string[],
  coreQuestion: string,
  possibleAngles: { angleId: string, title: string, prompt: string, materialHint: string }[],
  riskyAngles: { title: string, reason: string }[],
  suggestedNextQuestions: string[]
}
```

- [ ] **第 1 步：添加题眼和立意质量测试**

在题目分析接口测试后增加：

```js
assert.ok(topic.json.data.topicKeywords.some((item) => item.includes('长大') || item.includes('那一刻')));
assert.ok(topic.json.data.riskyAngles.some((item) => item.reason.includes('空泛') || item.reason.includes('模板')));
assert.ok(topic.json.data.suggestedNextQuestions.some((item) => item.includes('什么时候') || item.includes('谁')));
```

- [ ] **第 2 步：运行测试确认失败原因正确**

运行：

```powershell
npm run test:essay-guidance
```

预期：如果题眼或追问输出不够，应失败在新增断言上。

- [ ] **第 3 步：实现本地题目分析**

在 `lib/essay-guidance.js` 中保持确定性规则：

```js
const keywords = titleKeywords(normalizedTitle);
const theme = inferTheme(normalizedTitle);
const coreQuestion = `这个题目真正要写的不是一句口号，而是围绕“${coreKeyword}”选一个具体时刻，写清楚事情怎样发生、你怎样判断、最后有什么变化。`;
```

前三个立意方向分别围绕：

```js
['具体瞬间', '一个人', '物品或场景']
```

- [ ] **第 4 步：运行测试确认通过**

运行：

```powershell
npm run test:essay-guidance
```

预期：通过。

---

### 任务 3：让素材追问真正驱动学生补真实素材

**文件：**

- 修改：`lib/essay-guidance.js`
- 修改：`scripts/essay-guidance-api.test.js`
- 修改：`public/app.js`

**接口：**

输入：

```js
essayGuidance.buildMaterialQuestions({
  selectedAngle,
  existingMaterials,
  missingFields
})
```

输出：

```js
{
  questions: { field: string, question: string, purpose: string }[],
  materialChecklist: { field: string, label: string, present: boolean, value: string, suggestion: string }[],
  nextAction: "continue_questions" | "generate_outline",
  selectedAngle: string
}
```

- [ ] **第 1 步：添加缺失素材字段测试**

在素材追问测试后增加：

```js
assert.ok(material.json.data.questions.some((item) => item.field === 'dialogue'));
assert.ok(material.json.data.questions.every((item) => item.purpose.includes('避免') || item.purpose.includes('补齐')));
```

- [ ] **第 2 步：运行测试确认失败原因正确**

运行：

```powershell
npm run test:essay-guidance
```

预期：如果缺失字段被忽略，应失败在 `dialogue` 追问断言上。

- [ ] **第 3 步：实现素材清单优先的追问**

在 `lib/essay-guidance.js` 中，`buildMaterialChecklist` 固定检查：

```js
['event', 'people', 'time', 'place', 'actions', 'dialogue', 'feelings', 'sensoryDetails']
```

追问选择逻辑：

```js
const questions = checklist
  .filter((item) => !item.present)
  .slice(0, 5)
  .map((item) => ({
    field: item.field,
    question: item.suggestion,
    purpose: `补齐${item.label}，避免系统或学生自己编空话。`
  }));
```

- [ ] **第 4 步：保持前端素材字段一致**

在 `public/app.js` 中，`currentMaterial()` 只返回：

```js
{
  event,
  people,
  actions,
  dialogue,
  feelings,
  sensoryDetails
}
```

不要发送旧检测/改写流程字段。

- [ ] **第 5 步：运行测试**

运行：

```powershell
npm run test:essay-guidance
npm run test:short-guidance-frontend
```

预期：全部通过。

---

### 任务 4：完善提纲输出，但不生成完整作文

**文件：**

- 修改：`lib/essay-guidance.js`
- 修改：`scripts/essay-guidance-api.test.js`
- 修改：`public/app.js`

**接口：**

输入：

```js
essayGuidance.buildOutline({
  selectedAngle,
  materials,
  preferredStructure,
  genre
})
```

输出：

```js
{
  outlines: {
    outlineId: string,
    title: string,
    structure: string,
    paragraphs: { role: string, instruction: string }[]
  }[],
  recommendedOutlineId: string,
  warnings: string[]
}
```

- [ ] **第 1 步：添加防整篇代写测试**

在提纲测试后增加：

```js
const outlineText = JSON.stringify(outline.json.data);
assert.ok(!outlineText.includes('范文'));
assert.ok(!outlineText.includes('完整作文'));
assert.ok(outline.json.data.warnings.some((item) => item.includes('不') && item.includes('整篇')));
```

- [ ] **第 2 步：运行测试确认能抓到不安全文案**

运行：

```powershell
npm run test:essay-guidance
```

预期：如果出现整篇代写倾向，应失败。

- [ ] **第 3 步：只输出提纲说明**

在 `buildOutline` 中，每段只返回写作指令，例如：

```js
{ role: '经过', instruction: `重点写${summary.action}，让读者看见过程。` }
```

不要返回完整段落或完整作文正文。

- [ ] **第 4 步：前端按“指令”渲染提纲**

在 `public/app.js` 中，`renderOutline(data)` 应这样渲染每段：

```js
<li><b>${escapeHtml(item.role)}</b><span>${escapeHtml(item.instruction)}</span></li>
```

- [ ] **第 5 步：运行测试**

运行：

```powershell
npm run test:essay-guidance
npm run test:short-guidance-frontend
```

预期：全部通过。

---

### 任务 5：细化单篇作文体检

**文件：**

- 修改：`lib/essay-guidance.js`
- 修改：`scripts/essay-guidance-api.test.js`
- 修改：`public/app.js`

**接口：**

输入：

```js
essayGuidance.buildDiagnosis({
  draftText,
  title,
  genre,
  grade,
  userGoal
})
```

输出：

```js
{
  overallComment: string,
  dimensionScores: {
    topicFit,
    ideaClarity,
    materialSpecificity,
    structureClarity,
    emotionNaturalness,
    languageNaturalness,
    studentVoiceFit
  },
  priorityIssues: { issueId, dimension, title, severity, explanation, suggestion, relatedSegmentId }[],
  highlightedSegments: { segmentId, text, issueType, reason, suggestion }[],
  suggestedRevisionPath: string[]
}
```

- [ ] **第 1 步：添加七个诊断维度测试**

在作文体检测试后增加：

```js
for (const key of [
  'topicFit',
  'ideaClarity',
  'materialSpecificity',
  'structureClarity',
  'emotionNaturalness',
  'languageNaturalness',
  'studentVoiceFit'
]) {
  assert.ok(diagnose.json.data.dimensionScores[key], `missing dimension ${key}`);
  assert.strictEqual(typeof diagnose.json.data.dimensionScores[key].score, 'number');
}
```

- [ ] **第 2 步：运行测试确认失败原因正确**

运行：

```powershell
npm run test:essay-guidance
```

预期：如果缺维度，应失败并指出缺少哪个维度。

- [ ] **第 3 步：实现可解释的本地评分**

`buildDimensionScores` 中每个维度都要有明确依据：

```txt
审题贴合度：题目关键词命中
立意清晰度：是否出现“明白/懂得/改变/发现/学会”等变化表达
素材具体度：事实锚点和具体细节命中
结构清晰度：段落数量和段落角色
情感自然度：是否突然喊口号或拔高
语言自然度：模板句和节奏检查
学生口吻贴合度：过度成熟套话扣分
```

- [ ] **第 4 步：前端紧凑展示体检报告**

在 `public/app.js` 中，`renderDiagnose(data)` 必须展示：

```txt
总体评价
维度评分
优先修改
问题片段
```

不要展示旧 AI 概率、风险条或改写流程。

- [ ] **第 5 步：运行测试**

运行：

```powershell
npm run test:essay-guidance
npm run test:short-guidance-frontend
```

预期：全部通过。

---

### 任务 6：让局部修改建议保持“学生参与”和“事实安全”

**文件：**

- 修改：`lib/essay-guidance.js`
- 修改：`scripts/essay-guidance-api.test.js`
- 修改：`public/app.js`

**接口：**

输入：

```js
essayGuidance.buildRevisionSuggestion({
  diagnostic,
  segmentId,
  revisionGoal,
  keepFactsStrict
})
```

输出：

```js
{
  issueExplanation: string,
  revisionStrategy: string,
  exampleRevision: string,
  studentAction: string,
  revisionGoal: string
}
```

- [ ] **第 1 步：添加事实边界文案测试**

在局部建议测试后增加：

```js
assert.ok(revise.json.data.revisionStrategy.includes('不新增') || revise.json.data.revisionStrategy.includes('保留原有事实'));
assert.ok(revise.json.data.studentAction.includes('确认'));
```

- [ ] **第 2 步：运行测试确认能抓到整篇改写倾向**

运行：

```powershell
npm run test:essay-guidance
```

预期：如果建议没有事实边界，应失败。

- [ ] **第 3 步：实现局部修改建议**

在 `buildRevisionSuggestion` 中保留如下逻辑：

```js
const strictText = keepFactsStrict === false
  ? '可以适度调整表达，但仍不能编造新经历。'
  : '严格保留原有事实，不新增时间、地点、人物和动作。';
```

`studentAction` 必须要求学生确认细节是否真实。

- [ ] **第 4 步：前端按四段渲染**

在 `public/app.js` 中，`renderRevision(data)` 展示：

```txt
问题说明
修改思路
参考示例
学生要做
```

- [ ] **第 5 步：运行测试**

运行：

```powershell
npm run test:essay-guidance
npm run test:short-guidance-frontend
```

预期：全部通过。

---

### 任务 7：前端固定为单一用途工具

**文件：**

- 修改：`public/index.html`
- 修改：`public/app.js`
- 修改：`public/styles.css`
- 修改：`public/account.html`
- 修改：`public/account.js`
- 修改：`scripts/short-guidance-frontend.test.js`

**接口：**

前端只消费 `/api/v1/essay-sessions` 工作流接口。

页面必须保留这些元素 ID：

```txt
sessionForm
topicAnalysisBtn
materialQuestionsBtn
outlineBtn
diagnoseBtn
revisionBtn
reflectionBtn
```

- [ ] **第 1 步：维护旧 UI 防回流测试**

`scripts/short-guidance-frontend.test.js` 中保留禁止文案：

```js
const forbiddenHtml = [
  '墨锋InkEdge',
  '文本检测',
  '检测 AI 痕迹风险',
  '自动改写',
  '个人中心',
  '算力'
];
```

保留禁止 JS 引用：

```js
const forbiddenJs = [
  '/api/detect',
  '/api/rewrite',
  '/api/train',
  'detectBtn',
  'rewriteCard',
  'trainingCard'
];
```

- [ ] **第 2 步：运行测试确认旧 UI 会被抓到**

运行：

```powershell
npm run test:short-guidance-frontend
```

预期：如果旧 UI 存在，应失败并指出旧文案或旧引用。

- [ ] **第 3 步：首页只保留短期指导表单**

`public/index.html` 中只保留短期指导需要的表单和按钮，例如：

```html
<form id="sessionForm">
  <select id="modeInput"></select>
  <select id="gradeInput"></select>
  <select id="genreInput"></select>
  <input id="titleInput" />
  <textarea id="draftInput"></textarea>
</form>
```

以及六个流程按钮。

- [ ] **第 4 步：前端 JS 只调用新作文指导接口**

`public/app.js` 中所有 `/api/` 调用都应以：

```js
/api/v1/essay-sessions
```

开头，不调用旧路由。

- [ ] **第 5 步：账号页保持轻量返回页**

`public/account.html` 中只保留：

```html
<h1>只保留单篇作文指导</h1>
<a class="button-link" href="/">返回作文指导</a>
```

- [ ] **第 6 步：运行测试**

运行：

```powershell
npm run test:short-guidance-frontend
npm run test:essay-guidance
```

预期：全部通过。

---

### 任务 8：保存冒烟测试证据

**文件：**

- 新建：`test/单篇作文指导前端清空冒烟测试报告-N.md`
- 如 API 行为变化，更新或新建：`test/作文训练系统API冒烟测试报告-N.md`

**接口：**

消费本地开发服务，产出编号 Markdown 冒烟记录。

- [ ] **第 1 步：用临时状态目录启动服务**

运行：

```powershell
$env:APP_DATA_DIR = Join-Path $env:TEMP ('short-guidance-ui-' + [guid]::NewGuid().ToString())
$env:AI_API_KEY = ''
$env:PORT = '4320'
node server.js
```

预期：

```txt
Server running at http://localhost:4320
```

- [ ] **第 2 步：通过 HTTP 验证页面和接口**

运行：

```powershell
node -e "(async()=>{const html=await (await fetch('http://127.0.0.1:4320/')).text(); const account=await (await fetch('http://127.0.0.1:4320/account.html')).text(); const create=await fetch('http://127.0.0.1:4320/api/v1/essay-sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'brainstorm',title:'那一刻，我长大了',genre:'记叙文',grade:'初二'})}).then(r=>r.json()); const topic=await fetch('http://127.0.0.1:4320/api/v1/essay-sessions/'+create.data.sessionId+'/topic-analysis',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'那一刻，我长大了',genre:'记叙文',grade:'初二'})}).then(r=>r.json()); console.log(JSON.stringify({htmlOk:html.includes('短期单篇作文指导')&&html.includes('sessionForm'),accountCleared:account.includes('只保留单篇作文指导')&&!account.includes('个人中心')&&!account.includes('算力'),oldUiGone:!html.includes('墨锋InkEdge')&&!html.includes('文本检测'),createSuccess:create.success,topicSuccess:topic.success,angleCount:topic.data.possibleAngles.length},null,2));})().catch(e=>{console.error(e);process.exit(1)})"
```

预期：

```json
{
  "htmlOk": true,
  "accountCleared": true,
  "oldUiGone": true,
  "createSuccess": true,
  "topicSuccess": true,
  "angleCount": 3
}
```

- [ ] **第 3 步：保存编号报告**

按下一个可用编号新建：

```txt
test/单篇作文指导前端清空冒烟测试报告-N.md
```

报告结构：

```markdown
# 单篇作文指导前端清空冒烟测试报告-N

日期：2026-08-23

## 测试范围
...

## 静态验收
...

## 页面级 HTTP 冒烟
...

## 说明
...
```

- [ ] **第 4 步：停止本地服务**

在服务终端按 `Ctrl+C`。

预期：除非用户明确要求保留服务，否则不要留下持续运行的服务进程。

---

## 自检

**需求覆盖：** 本计划覆盖实现方向文档中的短期单篇作文 MVP：题目理解、素材追问、提纲、作文体检、局部修改建议、本次复盘。也遵守三人分工 API 边界：长期能力提升接口保留接入点，但不是当前 UI 核心。

**已知不做：** 完整长期能力成长、周计划、任务评分历史、错因库统计、成长轨迹、老师端、家长端暂不做，因为当前用户要求只保留“给用户生成短期单篇作文指导”的部分。

**占位检查：** 文档没有需要执行者自行猜测的“待补充”步骤；每个任务都给出了明确文件、接口、命令和预期结果。

**命名一致性：** 计划中使用的函数、接口和元素 ID 与当前项目一致：

- `buildTopicAnalysis`
- `buildMaterialQuestions`
- `buildOutline`
- `buildDiagnosis`
- `buildRevisionSuggestion`
- `buildReflection`
- `/api/v1/essay-sessions`
- `sessionForm`
- `topicAnalysisBtn`
- `materialQuestionsBtn`
- `outlineBtn`
- `diagnoseBtn`
- `revisionBtn`
- `reflectionBtn`

## 置信度评估

总体置信度：0.88。

依据置信度：0.90。计划直接基于当前项目已存在的 Node.js + Express 单体结构、当前已实现的 `/api/v1` 作文指导接口，以及已经收缩后的前端页面。

范围置信度：0.86。短期单篇作文指导边界清晰，且已经明确排除旧检测站 UI 与完整长期成长系统。

落地置信度：0.88。每个任务都有可运行测试命令和明确通过标准，适合继续按 TDD 小步推进。

风险置信度：0.80。主要风险是后续如果重新接入账号、额度、AI 模型或长期训练模块，容易把 UI 范围再次扩大；需要继续用 `scripts/short-guidance-frontend.test.js` 防止旧入口回流。

