# 新 Agent 接手开发 README

生成时间：2026-08-23

本文面向第一次进入本仓库的 AI 编码 Agent。目标是让新 Agent 在不翻完整历史对话的情况下，快速理解项目架构、功能边界、代码职责、常见修改入口、验证方式和容易踩坑的规则。

开始任何修改前，必须先读：

1. `AGENTS.md`：本仓库最高优先级工作规范。
2. 本文件：项目结构、代码职责和接手指南。
3. 当前用户本轮明确指定的方案文档或截图说明。

## 一、项目一句话概览

这是一个 Node.js + Express 单体应用，前端是静态 HTML/CSS/JS，核心功能是：

- 输入中文作文或文本。
- 检测 AI 痕迹风险。
- 达到阈值后自动生成去 AI 味改写。
- 支持强力、平衡、保守三种改写模式。
- 支持账号登录、游客试用额度、管理员算力管理、临时 IP 额度查看。
- 可部署到普通 Node 环境，也可通过 `worker.mjs` 包装部署到 Cloudflare Worker，并用 D1 保存云端状态。

项目不是一个前后端分离工程，也没有 React/Vue 构建链。大多数功能改动会落在：

- `server.js`
- `public/app.js`
- `public/account.js`
- `public/styles.css`
- `lib/*.js`
- `knowledge-base/ai-signals/*.json`

## 二、运行与入口

### 本地运行

```powershell
npm install
npm run dev
```

默认地址：

```text
http://localhost:3000
```

健康检查：

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Windows 脚本策略拦截时：

```powershell
npm.cmd install
npm.cmd run dev
```

`package.json` 目前只有两个脚本：

- `npm run dev`
- `npm start`

两者都执行：

```text
node --env-file-if-exists=.env --use-env-proxy server.js
```

### Cloudflare Worker 入口

- `worker.mjs` 使用 `cloudflare:node` 的 `httpServerHandler` 包装 Express 应用。
- `wrangler.jsonc` 指向 `worker.mjs`。
- 静态资源目录是 `public/`。
- D1 绑定名是 `APP_STATE_DB`。
- Cloudflare 环境变量里设置 `CLOUDFLARE_WORKER=true`。

如果修改 Cloudflare 相关逻辑，重点看：

- `worker.mjs`
- `wrangler.jsonc`
- `migrations/`
- `server.js` 中 `IS_CLOUDFLARE_WORKER`、`loadCloudState`、`flushCloudState`、`attachCloudState` 相关代码。

## 三、重要目录与文件职责

### 根目录

- `server.js`
  - Express 服务入口。
  - 也是绝大多数后端逻辑所在文件。
  - 包含状态读写、账号认证、游客额度、管理员接口、检测接口、改写接口、后台改写任务、训练接口、Cloudflare 状态适配等。

- `worker.mjs`
  - Cloudflare Worker 包装入口。
  - 把 Worker 的 `env` 注入 `process.env`。
  - 启动 Express app 并导出 Worker handler。

- `wrangler.jsonc`
  - Cloudflare Worker 部署配置。
  - 包含静态资源绑定和 D1 数据库绑定。

- `AGENTS.md`
  - 后续 Agent 的工作规范。
  - 优先级高于普通 README。
  - 如果用户要求“以后都这样做”，通常需要同步写入 `AGENTS.md`。

- `README.md`
  - 面向普通项目说明的旧 README。
  - 部分内容可能落后于当前实现，例如早期超时信息。
  - 不建议把它当作唯一开发依据。

- `README_AGENT_HANDOFF.md`
  - 本文件。
  - 面向新 Agent 的开发接手文档。

### `public/`

首页和账号页都在这里，没有构建步骤。

- `public/index.html`
  - 主页面结构。
  - 包括作文输入区、检测结果区、改写结果区、登录弹窗等。

- `public/app.js`
  - 首页全部交互逻辑。
  - 包括文本检测、后台任务创建、轮询、结果渲染、改写过程渲染、登录弹窗、训练入口。
  - 如果“检测页 UI、改写栏、事实审计栏、编辑计划、问题清单、风格校准、按钮交互”有问题，优先看这里。

- `public/account.html`
  - 个人中心页面结构。
  - 包括账号概览、充值说明、用户管理后台、临时 IP 管理后台、算力流水。

- `public/account.js`
  - 个人中心全部交互逻辑。
  - 包括登录、账号信息展示、算力流水、管理员用户列表、管理员调算力、临时 IP 管理后台。
  - 如果“个人中心、管理员后台、算力显示、游客 IP 列表、登录时间、充值联系人”有问题，优先看这里。

- `public/styles.css`
  - 全站样式。
  - 首页和账号页共用。
  - 修改 UI 时注意移动端媒体查询。

- `public/assets/`
  - 静态资源，例如微信收款二维码。

### `lib/`

改写和检测的主要可复用模块在这里。尽量把新逻辑放到合适模块，不要继续把所有东西塞进 `server.js`。

- `lib/signal-scoring.js`
  - 本地 AI 痕迹评分核心。
  - 负责根据文本画像、规则命中、文体权重等计算 AI 风险。
  - 重要导出：`analyzeAiSignals`、`mergeDetection`、`normalizeGenreGuess`。
  - 修改“本地 AI 率、风险维度、文体权重”时看这里。

- `lib/diagnostics.js`
  - 问题诊断和可疑片段定位。
  - 重要导出：`buildDiagnostics`、`findSuspiciousSegments`、`analyzeSegmentSignals`。
  - 修改“问题清单、可疑句子、诊断项”时看这里。

- `lib/text-metrics.js`
  - 文本基础指标。
  - 包括中文字数、分句、分段、节奏、信息密度、格式痕迹、作文模板链。
  - 修改“字数统计、节奏分析、文本画像、信息密度”时看这里。

- `lib/essay-structure.js`
  - 作文结构判断和结构编辑提示。
  - 用于识别模板句、结尾、事实锚点等。

- `lib/student-essay-humanizer.js`
  - 学生作文专项人味化规则。
  - 负责推断作文文体、检测学生作文规则命中、过滤可执行动作、给模型提供学生作文上下文、给候选评分。
  - 修改“作文文体规则、学生作文改写动作、学生作文质量评分”时看这里。

- `lib/rewrite-planner.js`
  - 改写计划生成和本地保守降级。
  - 重要导出：`chooseRewriteMode`、`buildLocalEditPlan`、`buildConservativeRewrite`、`normalizeEditPlan`、`buildBeforeAfter`、`summarizeDeletedOrCompressed`。
  - 修改“编辑计划、保守降级、本地删改策略、改写模式选择”时看这里。

- `lib/rewrite-policy.js`
  - 把普通编辑计划扩展为可执行计划。
  - 标记受保护事实、可编辑表层、禁止新增事实边界。
  - 修改“哪些动作允许交给模型、哪些事实必须保护”时看这里。

- `lib/rewrite-mode-policy.js`
  - 三种改写模式的策略表。
  - 当前模式大致是：
    - `aggressive`：强力模式，`safetyMode: 'off'`，不展示事实库存/事实审计。
    - `balanced`：平衡模式，事实作为提醒，不应阻断主结果。
    - `conservative`：保守模式，事实审计阻断更严格，必要时修复或降级。
  - 修改“三种模式差异、事实审计是否启用、是否展示事实库存”时看这里。

- `lib/fact-inventory.js`
  - 从原文和用户事实边界中提取事实库存。
  - 包括时间、人物、地点、动作、物品、数量、感受、感官细节。
  - 作者样本不能进入事实库存。
  - 修改“允许事实来源、事实边界识别”时看这里。

- `lib/fact-auditor.js`
  - 审计改写是否新增无来源事实。
  - 重要导出：`auditRewriteFacts`、`classifyFactAudit`、`buildNeedsUserFacts`。
  - 修改“事实审计、待补事实、unsupportedClaims、warningClaims、blockingClaims”时看这里。

- `lib/rewrite-executor.js`
  - 模型改写执行器。
  - 负责组装 prompt、调用模型、处理 JSON 修复、候选清洗、事实修复、风格校准、保守降级、候选排序。
  - 重要导出：`executeRewriteWithPlan`、`rankCandidates`、`conservativeFallback`。
  - 如果“模型调用失败、JSON 不稳定、强力/平衡/保守模式行为、修复/降级/排序”有问题，优先看这里。

- `lib/rewrite-ranking.js`
  - 改写候选去重、保留度、长度适配、段落覆盖、改后 AI 率统计。
  - 修改“候选排序、AI 率复检、长度惩罚、保留度评分”时看这里。

- `lib/voice-profile.js`
  - 作者样本清洗和风格画像。
  - 负责表达 DNA、反模式、诚实边界、风格指令。
  - 当前产品文案里更倾向称“风格校准”，但部分代码仍叫 voice。

- `lib/voice-fit.js`
  - 计算改写结果和作者样本的风格贴合度。
  - 包括句长、波动、段首、转场、标点、用词、结尾、AI 模板降低、事实安全扣分。

### `knowledge-base/ai-signals/`

本地 AI 痕迹规则库。

- `cliche-phrases.json`
- `direct-hints.json`
- `emotional-words.json`
- `overreach-patterns.json`
- `suspicious-sentences.json`
- `transitions.json`

新增检测规则时，优先改这些 JSON，不要直接把规则硬编码到 `server.js`。

注意：`/api/train` 会写知识库并追加 `knowledge-base/training-log.jsonl`。训练日志不要提交。

### `scripts/`

这里放可提交的小型回归测试脚本。当前已有：

- `scripts/account-escape-html.test.js`
  - 确认 `escapeHtml(0)` 不会显示为空。

- `scripts/admin-guest-ip-usages.test.js`
  - 确认管理员临时 IP 接口返回 `ipLabel`、`ip`、`remainingPower`、`lastSeenAt`。

- `scripts/guest-ip-collapse-indicator.test.js`
  - 确认临时 IP 面板默认折叠，并使用三角形指示器。

- `scripts/rewrite-process-aggressive-null-fact-audit.test.js`
  - 确认强力模式 `factAudit = null` 时，`renderRewriteProcess()` 不崩溃，且编辑计划仍渲染。

如果新增 bugfix，优先在 `scripts/` 增加一个最小可运行回归脚本。`test/` 目录目前被 `.gitignore` 忽略，更适合放本地冒烟报告和临时测试结果。

### `docs/`

项目方案、报告、迭代记录和参考资料目录。注意当前 `.gitignore` 忽略 `docs/`，但用户经常要求把大段报告保存到这里。是否提交以用户要求为准。

常见参考：

- `docs/作文参考资料/去AI 去味全网最全指南.docx`
- `docs/全新40篇500字优秀作文（新一轮全套）.md`
- 各类开发计划、冒烟测试报告、流程清单。

### `data/`

本地运行状态目录。

- `data/app-state.json`
  - 本地用户、会话、游客额度、临时 IP 记录、算力流水、任务状态等都在这里。
  - 不要提交。
  - 调试账号/额度/任务时会被服务端读写。

Cloudflare Worker 环境不依赖本地 `data/app-state.json`，而是通过 D1 的 `app_state_records` 存状态。

## 四、后端总体架构

### 状态模型

`server.js` 里有 `DEFAULT_STATE`，主要集合包括：

- `users`
- `verificationCodes`
- `sessions`
- `guestUsages`
- `guestIpUsages`
- `powerLedger`
- `rechargeOrders`
- `rewriteTasks`
- `authRateLimits`

本地：

- `loadState()` 从 `data/app-state.json` 读。
- `saveState()` 写回 `data/app-state.json`。

Cloudflare：

- `attachCloudState()` 每个请求加载云端状态。
- 请求结束时如有 dirty 状态，调用 `flushCloudState()` 写回 D1。
- D1 表由 `migrations/0001_app_state_records.sql` 和 `0002_security_rate_limits.sql` 创建。

### 认证与账号

关键函数：

- `detectAuthTarget`
- `findUserByTarget`
- `createOrUpdateUser`
- `createSession`
- `getSession`
- `attachAuth`
- `requireLogin`
- `requireAdmin`
- `serializeUser`
- `serializeAdminUser`

登录方式：

- 邮箱验证码。
- 管理员邮箱来自 `ADMIN_EMAILS`，默认管理员邮箱是 `18008069236@163.com`。

最近登录：

- `createOrUpdateUser` 在用户登录/注册时更新 `lastLoginAt`。
- `getSession` 会更新 session 的 `lastSeenAt`，但用户最近登录时间不应每个请求都刷新。

### 算力与游客额度

相关概念：

- 登录用户：账号 `powerBalance`。
- 未登录游客：临时 IP 记录 `guestIpUsages`。
- 旧游客 Cookie 记录：`guestUsages`，仍作为兼容存在。

临时 IP 记录最小字段：

- `ip`
- `ipHash`
- `remainingPower`
- `firstSeenAt`
- `lastSeenAt`

Cloudflare 部署时 IP 来源顺序：

1. `cf-connecting-ip`
2. `x-real-ip`
3. `x-forwarded-for`
4. `req.ip`
5. `req.socket.remoteAddress`

管理员个人中心有只读“临时IP管理后台”，接口是：

```text
GET /api/admin/guest-ip-usages
```

只显示：

- `ipLabel`：`IP` 或 `IPhash`
- `ip`
- `remainingPower`
- `lastSeenAt`

如果历史记录没有明文 IP，前端应显示 `IPhash` 标签，不能假装是真实 IP。

### 主要 API

当前 `server.js` 路由包括：

- `GET /api/me`
- `POST /api/auth/send-code`
- `POST /api/auth/verify-code`
- `POST /api/auth/logout`
- `POST /api/account/profile`
- `GET /api/payment/config`
- `GET /api/power/packages`
- `GET /api/power/ledger`
- `POST /api/power/recharge`
- `GET /api/admin/users`
- `GET /api/admin/guest-ip-usages`
- `POST /api/admin/power/grant`
- `POST /api/admin/users/update`
- `POST /api/admin/users/delete`
- `GET /api/debug/upstream`
- `POST /api/rewrite-tasks`
- `GET /api/rewrite-tasks/active`
- `POST /api/rewrite-tasks/clear-all`
- `GET /api/rewrite-tasks/:id`
- `POST /api/rewrite-tasks/:id/retry-rewrite`
- `POST /api/rewrite-tasks/:id/clear`
- `POST /api/detect`
- `POST /api/rewrite`
- `POST /api/train`
- `POST /api/track`
- `GET /health`

优先使用 `/api/rewrite-tasks` 路径驱动首页检测 + 自动改写。`/api/detect` 和 `/api/rewrite` 仍存在，可用于直接 API 调试或旧逻辑。

## 五、检测流程

检测入口通常是：

```text
POST /api/rewrite-tasks
```

后台任务执行：

1. 前端 `public/app.js` 调用 `createRewriteTask()`。
2. 后端 `app.post('/api/rewrite-tasks')` 创建任务。
3. `runRewriteTask()` 先执行检测阶段。
4. `buildDetectResultPayload()` 调用 `detectByProvider()`。
5. `detectByProvider()` 先本地 `analyzeAiSignals()`。
6. 再调用模型做检测复核。
7. 如果用户没有指定文体，模型文体可能触发一次本地重算。
8. `mergeDetection()` 合并模型分和本地分。
9. 检测结果写回任务。
10. 如果 AI 率达到 `REWRITE_TRIGGER_THRESHOLD`，进入改写阶段。

超时：

- 检测模型超时常量：`DETECT_TIMEOUT_MS`。

修改建议：

- 改 AI 痕迹命中：优先改 `knowledge-base/ai-signals/*.json`。
- 改评分权重：看 `lib/signal-scoring.js`。
- 改文本画像/节奏/信息密度：看 `lib/text-metrics.js`。
- 改问题清单/可疑句子：看 `lib/diagnostics.js`。
- 改学生作文专项判断：看 `lib/student-essay-humanizer.js`。

## 六、改写流程

后台任务进入改写阶段：

1. `runRewriteStage()` 调用 `rewriteByProvider()`。
2. `rewriteByProvider()` 复用检测阶段的 `originalAnalysis`。
3. `chooseRewriteMode()` 确认强力/平衡/保守模式。
4. `getRewriteModePolicy()` 读取模式策略。
5. `buildVoiceProfile()` 构建风格画像。
6. 按模式决定是否 `buildFactInventory()`。
7. 生成学生作文规则命中和动作。
8. `buildLocalEditPlan()` 生成本地编辑计划。
9. `buildExecutableEditPlan()` 转为可执行计划。
10. `executeRewriteWithPlan()` 调用模型改写。
11. 执行器内部处理 JSON 修复、候选排序、事实修复、风格校准、本地降级。
12. `server.js` 再次 `rankCandidates()` 做最终排序和补齐字段。
13. 构造 `rewriteStats`、`beforeAfter`、`deletedOrCompressed`、`rewriteFailureReasons`。
14. 返回前端渲染。

超时：

- 正式改写模型超时常量：`REWRITE_TIMEOUT_MS = 60000`。

### 三种模式边界

强力模式：

- `safetyMode: 'off'`
- `factAuditEnabled: false`
- `displayFactAudit: false`
- `displayFactInventory: false`
- 后端可返回 `factAudit: null`、`factInventory: null`。
- 前端必须兼容 `factAudit = null`，不能因此中断 `renderRewriteProcess()`。

平衡模式：

- 事实审计主要作为提醒。
- 不应把事实提醒变成“待补事实阻断”。
- 适合用户希望降 AI 率，同时允许人工确认轻微事实变化。

保守模式：

- 事实审计更严格。
- 事实不安全的候选不能作为最佳版本。
- 修复失败时进入本地保守降级。

### 本地/保守降级规则

本地/保守降级只能：

- 删除明显空泛句。
- 压缩模板表达。
- 保留原文事实。

不能：

- 补写新事实。
- 扩写生活细节。
- 迁移作者样本里的事实。
- 承担风格校准。
- 混入模型改写成功率统计。

## 七、前端首页渲染重点

`public/app.js` 是首页核心。

常见入口：

- `collectRewriteContext()`
  - 收集文体、改写模式、事实边界、风格要求、作者样本。

- `createRewriteTask()`
  - 创建后台检测/改写任务。

- `startTaskPolling()`
  - 轮询任务状态。

- `renderDetectResult()`
  - 渲染检测结果。

- `renderRewriteResult()`
  - 渲染改写结果。

- `renderRewrite()`
  - 渲染候选文本和候选下拉。

- `renderRewriteProcess()`
  - 渲染改写过程信息栏。
  - 包括模式、安全说明、改写统计、编辑计划、删除或压缩、反测对比、事实边界、事实审计、待补事实、未达标原因、风格校准、问题清单。
  - 强力模式下 `factAudit` 和 `factInventory` 可以是 `null`。
  - 增加任何信息栏时，必须保证某些字段为 `null` 或空数组时不会中断整个渲染。

前端常见 bug 类型：

- `escapeHtml(0)` 不应变空。
- `factAudit = null` 不应导致强力模式改写过程全部消失。
- 折叠区默认状态要符合用户要求。
- 本地降级提示要显示在改写过程上方。
- 所有 textarea 字体/排版应保持一致。

## 八、个人中心和管理员后台

相关文件：

- `public/account.html`
- `public/account.js`
- `public/styles.css`
- `server.js` 中 `/api/admin/*`、`/api/power/*`、`/api/me`。

功能包括：

- 登录/退出。
- 账号概览。
- 算力余额、累计赠送、累计充值、累计消耗。
- 微信转账充值说明。
- 算力流水。
- 管理员用户管理后台。
- 临时 IP 管理后台。

管理员用户管理：

- 接口：`GET /api/admin/users`
- 调整算力：`POST /api/admin/power/grant`
- 修改用户名：`POST /api/admin/users/update`
- 删除普通用户：`POST /api/admin/users/delete`

注意：

- 管理员可以给用户增加正数或负数算力。
- 删除用户要非常谨慎。
- 管理员不能删除自己，代码里已有保护。

临时 IP 管理：

- 接口：`GET /api/admin/guest-ip-usages`
- 前端只读，不允许修改。
- 面板默认折叠。
- 展开/收起使用三角形指示器，不使用文字按钮。
- 只显示 IP/IPhash、剩余试用额度、最后一次发送数据时间。

## 九、测试和验证策略

本项目没有统一测试框架。当前实践是：

- 语法检查：

```powershell
node --check server.js
node --check public/app.js
node --check public/account.js
```

- 小型回归脚本：

```powershell
node scripts/account-escape-html.test.js
node scripts/admin-guest-ip-usages.test.js
node scripts/guest-ip-collapse-indicator.test.js
node scripts/rewrite-process-aggressive-null-fact-audit.test.js
```

- 健康检查：

```powershell
Invoke-RestMethod http://localhost:3000/health
```

- 页面检查：

```text
http://localhost:3000
http://localhost:3000/account.html
```

### 作文检测/改写冒烟

如果改了作文检测或改写逻辑，通常要做作文冒烟测试，并保存为编号报告。

历史要求：

- 用 `C:\Users\Shirly412\Downloads\二十篇不同主题500字优秀作文（全新20篇合集）.md` 或 `docs/全新40篇500字优秀作文（新一轮全套）.md`。
- 报告命名要类似 `XXX-1.md`、`XXX-2.md`。
- 不覆盖已有报告。
- 本地/保守降级不能混入模型改写成功率统计。
- 模型调用失败要二次尝试，第二次仍失败才标记失败。
- 冒烟测试不要污染真实 `data/app-state.json`。

当前 `test/` 被 `.gitignore` 忽略，适合保存本地报告和机器 JSON。

## 十、常见修改需求应该改哪里

### 改检测分数、风险判断、文体识别

优先顺序：

1. `knowledge-base/ai-signals/*.json`
2. `lib/signal-scoring.js`
3. `lib/text-metrics.js`
4. `lib/diagnostics.js`
5. `server.js` 的 `detectByProvider()` 和 `mergeDetection()` 调用链

### 改问题清单或可疑片段

看：

- `lib/diagnostics.js`
- `lib/student-essay-humanizer.js`
- `public/app.js` 的 `renderDiagnostics()`、`renderOriginalPreview()`、`renderRewriteProcess()`

### 改改写模式

看：

- `lib/rewrite-mode-policy.js`
- `lib/rewrite-planner.js` 的 `chooseRewriteMode()`
- `lib/rewrite-executor.js`
- `server.js` 的 `rewriteByProvider()`
- `public/index.html` 的模式选择框
- `public/app.js` 的 `rewriteModeLabel()`、`rewriteSafetyNote()`、`renderRewriteProcess()`

### 改事实边界/事实审计/待补事实

看：

- `lib/fact-inventory.js`
- `lib/fact-auditor.js`
- `lib/rewrite-policy.js`
- `lib/rewrite-executor.js`
- `public/app.js` 的 `renderFactInventoryCard()` 和 `renderRewriteProcess()`

### 改风格校准

看：

- `lib/voice-profile.js`
- `lib/voice-fit.js`
- `lib/rewrite-executor.js` 的 `calibrateVoiceSurface()`
- `public/app.js` 的风格校准展示区域

注意：用户界面倾向使用“风格校准”，但部分内部代码仍叫 voice。

### 改本地降级

看：

- `lib/rewrite-planner.js` 的 `buildConservativeRewrite()`
- `lib/rewrite-executor.js` 的 `conservativeFallback()` 和降级分支
- `server.js` 的 `rewriteByProvider()` catch 分支
- `public/app.js` 的降级提示展示

### 改候选排序和改后 AI 率

看：

- `lib/rewrite-ranking.js`
- `lib/rewrite-executor.js` 的 `rankCandidates()`
- `server.js` 最终 `rankCandidates()` 调用和 `buildRewriteStats()`

### 改首页 UI

看：

- `public/index.html`
- `public/app.js`
- `public/styles.css`

常见区域：

- 原文框/改写框：`index.html` textarea + `styles.css`
- 改写过程：`renderRewriteProcess()`
- 信息栏折叠：`details.rewrite-audit`
- 结果卡片：`renderDetectResult()`、`renderRewriteResult()`

### 改个人中心 UI

看：

- `public/account.html`
- `public/account.js`
- `public/styles.css`

常见区域：

- 账号概览：`renderViewer()`
- 算力流水：`renderLedger()`
- 用户管理后台：`renderAdminUsers()`
- 临时 IP 管理后台：`renderGuestIpUsages()`

### 改账号、登录、验证码、管理员权限

看：

- `server.js`
  - `send-code`
  - `verify-code`
  - `createOrUpdateUser`
  - `createSession`
  - `requireAdmin`
  - `serializeUser`
- `public/account.js`
- `public/app.js` 登录弹窗相关逻辑

### 改游客试用额度和防刷

看：

- `server.js`
  - `GUEST_FREE_TRIAL_LIMIT`
  - `getGuestIpUsage()`
  - `ensureGuestPower()`
  - `markGuestTrialUsed()`
  - `consumeGuestSignupRemainder()`
  - `pruneExpiredGuestIpUsages()`
- Cloudflare 部署时注意 D1 状态持久化。

### 改 Cloudflare 部署和状态持久化

看：

- `worker.mjs`
- `wrangler.jsonc`
- `migrations/`
- `server.js` 的 cloud state 相关函数

## 十一、开发规范和项目约束

### 文件和文档

- 不要覆盖旧文档，除非用户明确要求。
- 新测试报告要编号，例如 `XXX-1.md`、`XXX-2.md`。
- 大段方案、报告、需求评估应保存成文档，不要只发聊天。
- 删除文件时只能一个一个删除。
- 严禁删除含有文件的文件夹。
- 只能删除空文件夹。

### 中文读取

用户明确要求：涉及中文读取时，禁止用 PowerShell 或任何终端命令直接读取中文内容。要避免乱码。

实际工作建议：

- 如果必须检查文件内容，优先用 Node 读取并输出 JSON 编码、Unicode 安全片段或 ASCII 摘要。
- 不要在终端直接 `type`、`cat`、`Get-Content` 大段中文文档。
- 最终文档可以正常写中文。

### Git 和敏感数据

不要提交：

- `.env`
- `node_modules/`
- `data/`
- `data/app-state.json`
- `data/*.json`
- `data/*.bak*`
- `knowledge-base/training-log.jsonl`
- 任何真实密钥、token、SMTP 授权码、验证码、用户隐私、支付敏感信息。

提交前至少看：

```powershell
git status --short
```

如需扫描密钥痕迹，用：

```powershell
rg -n "(?i)(api[_-]?key|secret|password|passwd|smtp_pass|token|authorization|bearer|sk-|github_pat|ghp_)" -g "!node_modules" -g "!.env" -g "!data/**"
```

### 修改原则

1. 保持改动小而清楚。
2. 不重构无关代码。
3. 优先沿用现有 UI 和代码风格。
4. 改账号/算力/支付/认证时，同时检查前端和后端。
5. 改公开页面时，检查桌面和移动端布局。
6. 改作文检测/改写逻辑时，要做相应冒烟测试。
7. 新增回归测试优先放 `scripts/`，除非是本地临时冒烟结果。
8. 不要让本地降级结果混进模型改写成功统计。

## 十二、最近已知关键修复点

这些是后续 Agent 容易误伤的点：

1. 强力模式没有事实审计和事实库存是设计，不是后端缺字段。
   - `factAudit` 可为 `null`。
   - `factInventory` 可为 `null`。
   - 前端不能因此中断渲染。

2. `escapeHtml(0)` 必须显示 `"0"`。
   - 不要写回 `String(text || '')`。
   - 应使用 `String(text ?? '')`。

3. 临时 IP 管理后台是只读。
   - 不能加编辑或删除入口，除非用户明确要求。
   - 默认折叠。
   - 展开/收起用三角形，不用文字。

4. `IP` 与 `IPhash` 标签要区分。
   - 真实 IP 显示 `IP`。
   - 历史记录只有哈希时显示 `IPhash`。

5. 管理员调算力允许负数。
   - 不要再限制只能正数。

6. 用户指定文体必须优先于 AI 自动判断。
   - 检测和改写链路都要尊重用户指定文体。

7. 平衡模式事实提醒不应变成强阻断。
   - 保守模式才承担严格事实阻断。

## 十三、建议的新 Agent 接手流程

1. 读 `AGENTS.md`。
2. 读 `README_AGENT_HANDOFF.md`。
3. 根据任务类型定位文件：
   - 检测：`lib/signal-scoring.js`、`lib/diagnostics.js`、`lib/text-metrics.js`、`knowledge-base/ai-signals/`
   - 改写：`lib/rewrite-*.js`、`lib/fact-*.js`、`lib/voice-*.js`
   - 首页 UI：`public/index.html`、`public/app.js`、`public/styles.css`
   - 个人中心：`public/account.html`、`public/account.js`、`public/styles.css`
   - 账号/额度/管理员：`server.js`
4. 写最小回归测试或至少确定验证命令。
5. 用 `apply_patch` 改文件。
6. 跑语法检查和相关测试。
7. 如果是较大程序改动，按 `AGENTS.md` 要求做冒烟测试并保存编号报告。
8. 最终回复只总结关键改动、验证结果和文件路径。

## 十四、文档可信度

可信度：0.90

依据：本文根据当前仓库文件结构、`server.js` 路由和函数、`public/` 前端实现、`lib/` 模块导出、`wrangler.jsonc`、`worker.mjs`、现有脚本测试以及最近已完成的功能修复整理。少数历史背景来自项目现有文档和已知开发约束；若后续代码继续演进，应同步更新本文件和 `AGENTS.md` 的阅读入口。
