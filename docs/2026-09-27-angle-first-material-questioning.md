# “我还没写”先选立意再追问素材开发计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 测试脚本撰写、测试运行和结果整理必须交给子代理，主代理负责业务实现、结果复核和修复。

**Goal:** 将“我还没写”改为严格的“生成立意方向 -> 用户明确选择立意 -> 针对所选立意生成详细素材追问 -> 用户回答 -> 生成提纲和段落写作引导”流程，避免立意与追问错配，并显著提高素材追问的具体性和可回答性。

**Architecture:** 保留现有作文会话、`topic-analysis`、`material-questions` 和 `guided-writing` API，不新增平行接口。前端把一次性流程拆成分阶段状态；后端通过 `selectedAngleId` 从当前会话的 `topicAnalysis.possibleAngles` 中解析立意，统一合并初始素材、素材卡和有效答案，再生成与该立意绑定的问题集。问题集通过 `questionSetId` 与后续答案、写作引导关联，切换立意时旧问题、旧答案和旧引导全部失效。

**Tech Stack:** Node.js、Express、Cloudflare Worker 兼容状态、静态 HTML/CSS/JavaScript、DeepSeek Chat API、Node 测试脚本、Playwright。

**Spec:** 用户 2026-09-27 当前需求；参考现有计划 `docs/superpowers/plans/2026-08-23-interactive-brainstorm-writing-guidance-plan.md`，本计划替换其中“首轮同时生成立意和素材追问”的顺序。

## Global Constraints

- 只改“我还没写”的短期单篇作文指导，不扩展长期能力训练。
- 不生成完整作文，不编造学生没有提供的人物、地点、事件、动作、对话或心理活动。
- 所有主要写作辅导请求继续使用 300 秒前端超时，不缩短现有超时。
- 不添加静态兜底结果冒充 AI 成功；模型失败必须返回明确错误并保留用户当前输入。
- 保留现有作文会话所有权校验、DeepSeek 服务端密钥边界和 Worker/D1 兼容性。
- 不执行正式线上部署，除非用户后续明确要求。
- 不自动提交或推送 Git。
- 新增冒烟报告保存到 `docs/reports/`，使用递增编号。

## Review Focus

- 用户选择第二或第三个立意时，素材追问必须绑定该立意，不能继续使用第一项立意。
- 用户切换立意后，旧问题、旧答案、旧提纲和旧段落提示必须失效，不能混入新请求。
- 用户初始素材为空时，问题仍应围绕题目与所选立意追问；有素材时必须引用素材中的具体锚点。
- 空答案不得进入模型上下文；必答问题未完成时不得生成写作引导。
- 模型超时或返回结构不合规时，页面不得清空已选立意和已填写答案，也不得显示过期结果。

---

## 一、目标交互与阶段状态

最终流程固定为：

1. 用户填写题目、年级、文体和“已有真实素材（可选）”。
2. 点击“生成立意方向”，只创建会话并调用 `topic-analysis`。
3. 页面展示 3 个立意方向，不默认选中第一项。
4. 用户点击一个立意，页面展示该立意的详细说明，并启用“确认立意，生成素材追问”。
5. 点击确认后，才调用 `material-questions`。
6. 页面展示与该立意绑定的详细问题、提问目的、回答要点和输入框。
7. 用户完成必答问题后，点击“根据回答生成写作引导”。
8. `guided-writing` 校验立意、问题集和答案属于同一轮，再生成提纲树和段落提示。

前端状态建议使用以下阶段值：

- `angles_ready`：立意已生成，等待用户选择。
- `angle_selected`：用户已选择，尚未生成追问。
- `questions_loading`：正在生成素材追问。
- `questions_ready`：问题已生成，等待回答。
- `guide_loading`：正在生成提纲和段落提示。
- `guide_ready`：写作引导已生成。

## 二、素材追问质量标准

每次生成 5-7 个高价值问题，不按“时间、地点、人物”机械罗列。每个问题必须服务于所选立意，并满足：

- 说明它要补足事件链中的哪一环：背景、触发、行动、困难、转折、结果或变化证据。
- 有初始素材时，优先引用素材里的具体人物、地点、活动、物件、动作或感受；没有素材时，引用题目和所选立意。
- 问题本身一次只追一个核心事实，但 `detailHints` 给出 2-4 个可回答的细节维度。
- 至少覆盖一个可见动作、一个场景或感官细节、一个真实对话或人物反应、一个能证明立意的前后变化。
- 不诱导学生虚构；对话、心理和感官细节都要提示“没有发生可以写没有”。
- 不重复已经在初始素材中明确给出的事实，而是沿该事实继续下钻。

建议响应结构：

```json
{
  "questionSetId": "questions_xxx",
  "selectedAngleId": "angle_2",
  "selectedAngle": {
    "angleId": "angle_2",
    "title": "从犹豫到主动承担",
    "prompt": "……"
  },
  "questions": [
    {
      "questionId": "q1",
      "field": "turning_point",
      "category": "转折",
      "question": "……",
      "purpose": "说明这个细节怎样支撑所选立意",
      "materialAnchor": "引用到的已有素材锚点",
      "detailHints": ["当时看见了什么", "你做了什么", "事情怎样改变"],
      "required": true
    }
  ],
  "materialChecklist": [],
  "requiredAnswerCount": 4,
  "nextAction": "answer_questions"
}
```

## 三、文件与职责

- Modify: `server.js`
  - 解析并验证所选立意；构建完整素材上下文；升级素材追问提示词、响应归一化和会话持久化；校验写作引导的立意与问题集。
- Modify: `public/app.js`
  - 拆分前端阶段；取消默认第一立意；新增确认立意和生成追问动作；处理切换立意后的状态失效；渲染详细问题。
- Modify: `public/app.html`
  - 调整首轮按钮和素材框文案，使“已有素材辅助立意”与“选定立意后的定向追问”边界清楚。
- Modify: `public/styles.css`
  - 增加阶段状态、立意确认区、问题说明、回答要点、必答标记和加载/错误状态样式。
- Usually unchanged: `public/api-client.js`
  - 继续复用 `getMaterialQuestions()` 和 `generateGuidedWriting()`；只有请求选项确有需要时才调整。
- Modify: `scripts/short-guidance-frontend.test.js`
  - 固化前端调用顺序和 300 秒超时。
- Modify: `scripts/essay-guidance-api.test.js`
  - 固化立意解析、素材上下文和问题集契约。
- Create: `scripts/brainstorm-angle-first-browser.test.js`
  - 覆盖真实用户点击顺序、切换立意和旧状态失效。
- Create: `docs/reports/我还没写先选立意与素材追问冒烟测试报告-1.md`
  - 保存模拟接口、浏览器和真实 DeepSeek 冒烟结果；如同名存在则递增编号。

---

### Task 1: 用失败测试固定“先选立意，再生成追问”

**Files:**
- Modify: `scripts/short-guidance-frontend.test.js`
- Modify: `scripts/essay-guidance-api.test.js`
- Create: `scripts/brainstorm-angle-first-browser.test.js`

**Interfaces:**
- Consumes: 现有 `EssayCoachAPI.analyzeTopic()`、`getMaterialQuestions()`、`generateGuidedWriting()`。
- Produces: 可验证的阶段顺序、立意绑定和问题集一致性要求。

- [ ] **Step 1: 由测试子代理新增前端静态契约测试**
  - 断言 `buildOutlineDemo()` 内不调用 `getMaterialQuestions()`。
  - 断言初始化后 `selectedAngleId` 和 `selectedAngle` 为空。
  - 断言存在独立的 `generateMaterialQuestionsDemo()` 或同等职责函数。
  - 断言 300 秒超时仍然存在。

- [ ] **Step 2: 由测试子代理新增 API 契约测试**
  - 选择第二个立意时，模型输入必须包含第二个立意的完整对象、`session.initialMaterial` 和已有素材卡。
  - 缺少 `selectedAngleId` 返回 `400 ANGLE_REQUIRED`。
  - 不属于当前会话的 `selectedAngleId` 返回 `400 ANGLE_NOT_FOUND`。
  - 追问结果包含 `questionSetId`、5-7 个详细问题、`requiredAnswerCount`。

- [ ] **Step 3: 由测试子代理新增浏览器流程测试**
  - 生成立意后，页面不出现可填写的素材追问。
  - 选择第二个立意并确认后，请求体携带第二个 `selectedAngleId`。
  - 问题返回后才出现回答框和生成写作引导按钮。
  - 切换到第三个立意时，第二个立意的问题、答案和引导结果被清空。

- [ ] **Step 4: 由测试子代理运行新增测试并记录预期失败原因**
  - 预期失败应明确指向当前自动选择第一立意、首轮提前调用追问或缺少问题集校验，不能通过放宽断言解决。

### Task 2: 后端建立可信的立意与素材上下文

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `session.topicAnalysis.possibleAngles`、`session.initialMaterial`、`session.materials`、请求中的 `selectedAngleId`。
- Produces: `resolveSessionAngle(session, selectedAngleId)`、`buildEssayMaterialContext(session, body)` 及与会话一致的立意对象。

- [ ] **Step 1: 实现 `resolveSessionAngle(session, selectedAngleId)`**
  - 只允许选择当前会话题目分析返回的立意。
  - 不再用标题字符串作为唯一身份，也不默认回退第一项。

- [ ] **Step 2: 实现 `buildEssayMaterialContext(session, body)`**
  - 合并 `session.initialMaterial`、`session.materials`、有效历史答案和本轮请求数据。
  - 去除空答案、重复答案和只含空白的字段。
  - 保留事实来源标记，供提示词区分学生原始素材与模型建议。

- [ ] **Step 3: 在 `material-questions` 与 `guided-writing` 复用统一上下文**
  - 接口本身必须能读取初始素材，不再依赖前端重复传 `existingMaterials` 或 `extraMaterial` 才完整。
  - 为旧调用保留字段兼容，但新流程以会话数据为准。

- [ ] **Step 4: 由测试子代理运行 API 失败测试，确认立意校验和素材合并通过**

### Task 3: 重写素材追问提示词与结构化结果

**Files:**
- Modify: `server.js`
- Modify: `scripts/essay-guidance-api.test.js`

**Interfaces:**
- Consumes: Task 2 的标准化上下文和完整所选立意。
- Produces: `normalizeMaterialQuestionResult(result, context)` 返回本计划第二节定义的问题集结构。

- [ ] **Step 1: 重写 `GUIDANCE_OUTPUT_CONTRACTS.materialQuestions`**
  - 写入 5-7 个问题、素材锚点、提问目的、回答要点、必答标记和事件链覆盖要求。
  - 明确禁止通用问题堆砌、重复已知事实和诱导虚构。

- [ ] **Step 2: 扩充“素材追问”模型输入**
  - 包含题目、年级、文体、完整立意对象、已有事实、尚缺事实和明确的质量约束。

- [ ] **Step 3: 实现结果归一化和严格校验**
  - 校验数量、唯一 `questionId`、非空问题、`detailHints`、`requiredAnswerCount` 和立意 ID。
  - 结构不合规时返回稳定的模型输出错误，不以通用空问题冒充成功。

- [ ] **Step 4: 保存问题集到作文会话**
  - 保存 `questionSetId`、`selectedAngleId`、问题列表和生成时间。
  - 会话状态更新为 `collecting_materials`。

- [ ] **Step 5: 由测试子代理运行 API、缺密钥和 JSON 解析回归测试**

### Task 4: 前端拆成两个明确请求阶段

**Files:**
- Modify: `public/app.js`
- Modify: `public/app.html`

**Interfaces:**
- Consumes: `topic-analysis` 的 3 个立意和 Task 3 的问题集。
- Produces: 与 `questionSetId`、`selectedAngleId` 绑定的 `materialAnswers`，供 `guided-writing` 使用。

- [ ] **Step 1: 改造 `buildOutlineDemo()` 和 `setBrainstormState()`**
  - 首轮只创建会话并调用 `analyzeTopic()`。
  - 不再调用 `firstAngle()` 自动选中，也不提前调用 `getMaterialQuestions()`。

- [ ] **Step 2: 拆分立意选择和追问生成 UI**
  - 立意卡片点击只负责选择并展示详细说明。
  - 增加“确认立意，生成素材追问”按钮；只有明确选中后可用。
  - 提交期间锁定重复点击，使用现有 300 秒超时。

- [ ] **Step 3: 新增 `generateMaterialQuestionsDemo()`**
  - 请求携带 `selectedAngleId`，标题仅作展示信息。
  - 成功后写入 `questionSetId` 和 `questions`，阶段进入 `questions_ready`。
  - 失败时保留立意选择并显示可重试错误。

- [ ] **Step 4: 渲染详细追问卡片**
  - 显示分类、问题、为什么问、基于哪条已有素材、回答时可补哪些细节。
  - 必答项有明确标记；未达到 `requiredAnswerCount` 时禁用写作引导按钮并显示还差几题。

- [ ] **Step 5: 实现立意切换失效规则**
  - 改选立意时清空 `questionSetId`、问题、答案和 `guidedWriting`。
  - 页面回到 `angle_selected`，提示需要为新立意重新生成追问。

- [ ] **Step 6: 调整首轮文案**
  - “生成构思建议”改为“生成立意方向”。
  - 素材输入框标注为“已有真实素材（可选，用于辅助立意）”。

### Task 5: 写作引导校验同一轮立意、问题和答案

**Files:**
- Modify: `server.js`
- Modify: `public/app.js`
- Modify: `scripts/essay-guidance-guided-writing-split.test.js`

**Interfaces:**
- Consumes: `selectedAngleId`、`questionSetId`、非空 `materialAnswers[{questionId, field, question, answer}]`。
- Produces: 只基于当前立意和当前问题答案生成的 `outlineTree` 与 `paragraphGuides`。

- [ ] **Step 1: 前端只提交有效答案**
  - `collectMaterialAnswers()` 过滤空答案，并携带 `questionId`。
  - 请求包含 `questionSetId` 和 `selectedAngleId`。

- [ ] **Step 2: 后端校验问题集归属与答案完整度**
  - 问题集必须属于当前会话和当前立意。
  - 未完成必答问题时返回 `400 MATERIAL_ANSWERS_INCOMPLETE`，不调用提纲模型。

- [ ] **Step 3: 构建写作引导上下文**
  - 自动加入初始素材、所选立意和有效答案。
  - 保留当前“提纲树”和“段落提示”两次模型调用，避免重新合成长 JSON。

- [ ] **Step 4: 由测试子代理验证立意/问题集错配、空答案和正常生成路径**

### Task 6: UI 完善、回归和真实 AI 冒烟

**Files:**
- Modify: `public/styles.css`
- Create: `docs/reports/我还没写先选立意与素材追问冒烟测试报告-1.md`

**Interfaces:**
- Consumes: 完整前后端流程。
- Produces: 桌面端和移动端均可完成的短期写作引导路径及编号报告。

- [ ] **Step 1: 完善阶段 UI**
  - 保持现有主题，增加清楚的步骤状态、选中态、必答标记、回答要点和局部错误提示。
  - 不使用嵌套卡片；长问题和回答提示允许换行，移动端无横向滚动。

- [ ] **Step 2: 由测试子代理运行相关自动测试**
  - `npm run test:short-guidance-frontend`
  - `npm run test:essay-guidance`
  - `npm run test:guided-writing-split`
  - `npm run test:essay-guidance-missing-key`
  - `npm run test:guidance-json-parse-no-retry`
  - 新增的浏览器流程测试。

- [ ] **Step 3: 由测试子代理执行真实 DeepSeek 冒烟**
  - 至少使用三组素材：素材较完整、只有一句素材、完全没有素材。
  - 每组选择非第一项立意，检查问题确实引用所选立意。
  - 质量人工判定：问题是否具体、是否重复已知事实、是否给出可回答的细节提示、是否避免编造。
  - 完成至少一组“选立意 -> 回答问题 -> 生成详细提纲 -> 生成段落提示”的全路径。

- [ ] **Step 4: 由测试子代理保存唯一编号冒烟报告并结束测试进程**
  - 报告记录测试输入、所选立意、生成问题摘要、关键断言、失败与修复情况、置信度。
  - 如测试启动本地服务，报告保存前必须确认服务进程已关闭。

## 四、验收标准

- 首轮生成后只显示立意方向，不显示预先为第一立意生成的问题。
- 用户必须明确选择立意，才能请求素材追问。
- 选择任意立意后，返回的问题与该立意和用户已有素材直接相关。
- 每个问题都包含提问目的和可操作的回答要点，不再是空泛字段清单。
- 切换立意不会沿用旧问题、旧答案或旧写作引导。
- 写作引导只接受同一 `questionSetId` 下的有效答案。
- 必答素材不足时不生成空泛提纲，并给出明确补充提示。
- 提纲树和段落提示继续保持详细字段，不退回简略标题。
- 所有相关自动测试、浏览器流程测试和真实 DeepSeek 冒烟通过。
- 测试过程未污染线上 D1，未执行正式部署。

## 五、不在本轮范围

- 不重做素材库、作文体检、局部修改、7 天训练计划、能力诊断或成长地图。
- 不新增长期能力画像或训练推荐逻辑。
- 不做整篇作文自动续写或代写。
- 不改账号、支付、管理员、Worker 名称或 D1 数据结构。

## 六、置信度评估

置信度：0.96。

依据：静态检查已经确认当前错误顺序位于 `public/app.js` 的 `buildOutlineDemo()` 和 `setBrainstormState()`，后端现有 `material-questions` 与 `guided-writing` 接口足以承载改造，无需新增平行 API。主要不确定性在于 DeepSeek 对更严格问题结构的稳定性，因此计划包含结构校验、真实素材三组冒烟和不合规输出的明确失败处理。
