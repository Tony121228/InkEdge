# “我还没写”交互式写作引导功能开发计划

日期：2026-08-23

## 目标

把当前“我还没写”环节从一次性生成静态建议，改造成分步写作向导：

1. 用户填写题目、年级、文体、已有素材后，先生成可选择的立意方向和素材追问。
2. 用户可以选择一个立意方向，并在页面上回答追问问题。
3. 系统根据用户的选择和回答继续引导，而不是直接给空泛建议。
4. 新增“写作引导”栏，生成提纲树形图。
5. 根据提纲树为每一段生成写作提示，说明该段该写什么、要补哪些细节、避免什么写法。
6. 保持边界：只做单篇短期作文指导，不做长期能力提升；不代写整篇作文，不编造用户经历。

## 当前代码现状

当前前端入口：

- `public/index.html`
- `public/app.js`
- `public/api-client.js`

当前“我还没写”流程在 `public/app.js` 的 `buildOutlineDemo()`：

- 创建作文会话：`createEssaySession`
- 题目分析：`analyzeTopic`
- 素材追问：`getMaterialQuestions`
- 生成提纲：`generateOutline`
- 渲染静态结果：`renderBackendBrainstorm`

当前问题：

- 用户只能看到建议，不能选择立意方向。
- 素材追问只显示问题，没有回答框。
- 前端没有把用户回答回传给后端形成下一步引导。
- 提纲展示只是列表，不是树形结构。
- 没有按段落给出“该写什么、怎么写、要避开什么”的写作提示。

## 总体方案

采用“现有接口增强 + 新增写作引导接口”的方式，减少破坏范围。

前端仍保留当前“生成构思建议”按钮，但点击后的结果变为交互式区域：

1. 立意选择区
   - 展示 DeepSeek 返回的 `possibleAngles`
   - 每个立意作为可点击卡片或单选项
   - 默认选中推荐立意

2. 素材回答区
   - 展示素材追问问题
   - 每个问题下方新增回答框
   - 支持用户补充真实事件、人物、动作、对话、感受、感官细节

3. 写作引导区
   - 新增按钮：“生成写作引导”
   - 提交：作文会话 ID、选中的立意、素材回答、已有素材、题目/年级/文体
   - 返回：提纲树形图、段落写作提示、下一步写作任务

4. 段落写作提示区
   - 每一段显示：
     - 段落角色：开头、起因、经过、转折、感受、结尾等
     - 本段目标
     - 必须写入的真实信息
     - 可用提问
     - 开头提示
     - 避免事项
     - 建议字数范围
   - 只提示，不生成完整段落。

## 后端 API 设计

新增接口：

`POST /api/v1/essay-sessions/:sessionId/guided-writing`

请求体建议：

```json
{
  "selectedAngle": "考试后自己整理错题",
  "selectedAngleId": "angle_1",
  "materialAnswers": [
    {
      "field": "event",
      "question": "这件事发生在什么时候？",
      "answer": "期中考试后，数学卷子发下来那天晚上"
    }
  ],
  "extraMaterial": "用户在原素材框补充的内容",
  "preferredStructure": "记叙文"
}
```

响应体建议：

```json
{
  "guideId": "guide_xxx",
  "outlineTree": {
    "title": "那一刻，我长大了",
    "theme": "从被动难过到主动面对问题",
    "children": [
      {
        "nodeId": "p1",
        "role": "开头",
        "label": "从试卷画面切入",
        "children": []
      }
    ]
  },
  "paragraphGuides": [
    {
      "paragraphId": "p1",
      "role": "开头",
      "goal": "用一个真实画面进入事件",
      "mustInclude": ["试卷", "书桌", "当时的动作"],
      "writingPrompts": ["你第一眼看到卷子时手上在做什么？"],
      "starterHint": "可以从一个动作或物件开始，不要先讲大道理。",
      "avoid": ["不要写成长是一束光", "不要直接总结道理"],
      "suggestedLength": "80-120字"
    }
  ],
  "nextAction": "write_paragraph_1",
  "studentTask": "先写第1段，只写真实画面，不急着总结道理。"
}
```

后端实现位置：

- 在 `server.js` 中扩展 `GUIDANCE_OUTPUT_CONTRACTS`
- 新增 `guidedWriting` 输出契约
- 新增 `POST /api/v1/essay-sessions/:sessionId/guided-writing`
- 复用现有 `callEssayGuidanceModel()`，继续通过 DeepSeek API 调用
- 将生成结果写入 `state.essaySessions` 或新增 `state.essayGuides`

## DeepSeek 提示词要求

新增任务名建议：`交互式写作引导`

提示词边界：

- 必须基于用户已填写的题目、立意选择和素材回答。
- 不得编造用户没有提供的人物、地点、事件、对话。
- 不得生成完整作文或完整段落。
- 可以生成段落任务、问题、提示、结构树。
- 如果素材不足，必须指出缺少什么，并给出下一轮追问。
- 输出必须是 JSON。

输出契约建议：

```text
outlineTree:{title,theme,children:{nodeId,role,label,focus,children}[]};
paragraphGuides:{paragraphId,role,goal,mustInclude:string[],writingPrompts:string[],starterHint,avoid:string[],suggestedLength}[];
missingMaterialQuestions:{field,question,purpose}[];
nextAction:"answer_more"|"write_paragraph_1";
studentTask:string
```

## 前端改造计划

修改文件：

- `public/index.html`
- `public/app.js`
- `public/api-client.js`
- `public/styles.css`

具体步骤：

1. `api-client.js`
   - 新增 `generateGuidedWriting(sessionId, body)`
   - 路径：`essay-sessions/:sessionId/guided-writing`

2. `app.js`
   - 新增 `brainstormState`
     - `sessionId`
     - `topicAnalysis`
     - `materialQuestions`
     - `selectedAngle`
     - `materialAnswers`
     - `guidedWriting`
   - 改造 `buildOutlineDemo()`
     - 第一阶段只生成题目分析和追问问题
     - 不立即生成最终提纲
     - 渲染可选择立意卡片和问题回答框
   - 新增 `renderInteractiveBrainstorm()`
     - 立意选择 UI
     - 问题回答 UI
     - “生成写作引导”按钮
   - 新增 `generateWritingGuideDemo()`
     - 收集用户选择和回答
     - 调用后端新接口
     - 渲染提纲树和段落提示
   - 新增 `renderOutlineTree()`
   - 新增 `renderParagraphGuides()`

3. `index.html`
   - 如果现有结构足够，可主要由 `app.js` 动态渲染，不强改 HTML。
   - 如需固定容器，可在“我还没写”区域新增：
     - `brainstormChoiceArea`
     - `materialAnswerArea`
     - `writingGuideArea`

4. `styles.css`
   - 新增样式：
     - 立意卡片选中态
     - 问题回答框
     - 写作引导栏
     - 树形提纲
     - 段落提示卡片
   - 保持当前主题系统兼容，包括深色/浅色主题。

## 交互流程

建议流程如下：

1. 用户进入“我还没写”
2. 输入题目、年级、文体、已有素材
3. 点击“生成构思建议”
4. 页面显示：
   - 题目关键词
   - 核心问题
   - 可选立意方向
   - 素材追问问题和回答框
5. 用户选择一个立意
6. 用户回答素材追问
7. 点击“生成写作引导”
8. 页面显示：
   - 提纲树形图
   - 每段写作提示
   - 下一步任务
9. 用户开始按第1段提示写作

## 测试计划

新增或扩展测试：

1. 前端静态契约测试
   - `scripts/short-guidance-frontend.test.js`
   - 检查：
     - `api-client.js` 包含 `generateGuidedWriting`
     - `app.js` 包含互动式渲染函数
     - `app.js` 包含提纲树和段落提示渲染
     - 保留 `REQUEST_TIMEOUT_MS: 180000`
     - 保留可读超时提示
     - 保留按钮 loading 防重复点击

2. 后端 API 测试
   - 扩展 `scripts/essay-guidance-api.test.js`
   - 模拟 DeepSeek 返回 `outlineTree` 和 `paragraphGuides`
   - 断言：
     - 新接口返回 200
     - 返回 `guideId`
     - 返回树形提纲
     - 返回段落提示
     - 模型调用次数增加

3. 缺 key 测试
   - 扩展 `scripts/essay-guidance-missing-key.test.js`
   - 新接口缺 key 时返回 `MODEL_UNAVAILABLE`

4. 本地冒烟
   - 打开 `http://127.0.0.1:3000/`
   - 测试“我还没写”
   - 生成立意与问题
   - 选择立意并回答问题
   - 生成写作引导
   - 确认页面显示树形提纲和分段提示

## 开发顺序

1. 先写失败测试
   - 前端契约测试
   - 后端新接口模拟测试

2. 后端实现
   - 新增状态字段
   - 新增输出契约
   - 新增 `/guided-writing` 接口
   - 接入 DeepSeek 提示词

3. 前端 API 客户端
   - 新增 `generateGuidedWriting`

4. 前端交互
   - 改造“生成构思建议”结果区
   - 增加立意选择
   - 增加问题回答框
   - 增加写作引导按钮
   - 增加提纲树和段落提示渲染

5. 样式
   - 补充树形图、回答框、段落提示卡片样式
   - 检查深色/浅色主题

6. 验证
   - 跑全部相关自动化测试
   - 本地真实/模拟冒烟
   - 保存编号测试报告

## 风险与控制

1. 风险：DeepSeek 输出结构不稳定
   - 控制：输出契约明确 JSON 字段；后端做数组兜底；前端对缺字段显示“待返回”或缺素材追问。

2. 风险：用户素材过少，提纲仍空泛
   - 控制：接口返回 `missingMaterialQuestions` 和 `nextAction: "answer_more"`，前端提示继续补充。

3. 风险：前端状态变复杂
   - 控制：集中维护 `brainstormState`，不要散落到多个全局变量。

4. 风险：误变成代写完整作文
   - 控制：提示词和前端文案都强调“提示和任务”，不输出完整段落。

5. 风险：接入新功能破坏之前 DeepSeek 超时修复
   - 控制：保留现有前端测试中 180 秒超时、中文超时提示、按钮 loading 断言。

## 不在本阶段做的内容

- 不做长期能力提升闭环。
- 不做用户历史能力画像更新。
- 不做完整作文代写。
- 不做段落自动续写。
- 不做账号体系或支付相关功能调整。

## 验收标准

1. “我还没写”不再只显示静态建议。
2. 用户可以选择立意方向。
3. 用户可以回答素材追问问题。
4. 用户提交回答后，可以生成写作引导。
5. 页面展示提纲树形图。
6. 页面展示每段该写什么的写作提示。
7. 后端新接口通过 DeepSeek API 生成引导内容。
8. 相关自动化测试通过。
9. 保存新的编号冒烟测试报告。

## 置信度评估

置信度：0.86

依据：现有后端已经具备题目分析、素材追问、提纲生成和 DeepSeek JSON 调用基础；前端已有“我还没写”入口和 API 客户端，改造成交互式流程的技术风险可控。主要不确定性在于 DeepSeek 对树形提纲和分段提示 JSON 的稳定性，需要通过后端契约、测试和前端兜底降低风险。
