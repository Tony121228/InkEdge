# AGENTS.md

本文件给后续在本仓库工作的 AI 编码代理使用。请先阅读本文件，再修改代码。

## 接手阅读顺序

1. 先阅读本文件，确认本仓库的工作规范和禁忌。
2. 再阅读 `README_AGENT_HANDOFF.md`，快速了解项目架构、代码职责、常见修改入口、验证方式和近期易踩坑问题。
3. 最后阅读用户当前指定的方案、截图或需求文档，再开始修改。

## 项目概览

- 项目类型：Node.js + Express 单体应用。
- 入口文件：`server.js`。
- 前端静态文件：`public/`。
- AI 痕迹知识库：`knowledge-base/ai-signals/`。
- 作文去 AI 味参考：优先参考 `docs/作文参考资料/去AI 去味全网最全指南.docx` 和 `test/AI改写功能逻辑二次改造方案.md`。
- 新一轮 AI 作文冒烟样本：`docs/全新40篇500字优秀作文（新一轮全套）.md`；用于新增或复核作文检测/改写逻辑时的回归测试。篇目标题已统一为 Markdown 二级标题，冒烟脚本仍兼容历史裸编号标题。
- 本地运行状态：`data/app-state.json`，由服务端自动创建和更新，不应提交。
- GitHub 仓库：`https://github.com/Tony121228/ai-text-detector-counter-site`。

## 常用命令

```powershell
npm install
npm run dev
```

默认访问地址：

```text
http://localhost:3000
```

健康检查：

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Windows PowerShell 如果 `npm` 被脚本策略拦截，使用：

```powershell
npm.cmd install
npm.cmd run dev
```

## 环境变量

参考 `.env.example`。真实 `.env` 只保留在本地，不要提交。

关键变量：

- `PORT`
- `APP_SECRET`
- `AI_API_BASE_URL`
- `AI_API_KEY`
- `AI_DETECT_MODEL`
- `AI_REWRITE_MODEL`
- `HTTP_PROXY`
- `HTTPS_PROXY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

注意：密钥、SMTP 授权码、真实用户数据、支付配置等敏感信息不得写入仓库。

## 代码结构

- `server.js`
  - Express 服务入口。
  - 提供认证、账号算力、支付配置、AI 检测、改写、训练、埋点和健康检查接口。
  - `/api/rewrite` 只做路由编排：检测画像、编辑计划、事实库存、模型执行、事实审计、降级和排序。
  - 主要接口包括：
    - `GET /api/me`
    - `POST /api/auth/send-code`
    - `POST /api/auth/verify-code`
    - `POST /api/auth/logout`
    - `GET /api/payment/config`
    - `GET /api/power/packages`
    - `GET /api/power/ledger`
    - `POST /api/power/recharge`
    - `GET /api/admin/users`
    - `POST /api/admin/power/grant`
    - `POST /api/detect`
    - `POST /api/rewrite`
    - `POST /api/train`
    - `POST /api/track`
    - `GET /health`
- `public/index.html`、`public/app.js`、`public/styles.css`
  - 主检测页面。
  - 展示检测画像、问题清单、改写过程、事实边界、事实审计和待补事实。
- `public/account.html`、`public/account.js`
  - 账号、算力、充值和管理相关页面。
- `lib/signal-scoring.js`、`lib/diagnostics.js`、`lib/text-metrics.js`
  - 本地 AI 痕迹评分、问题诊断、文本画像和节奏/信息密度分析。
- `lib/rewrite-planner.js`
  - 生成编辑计划，并提供本地保守降级改写。
- `lib/rewrite-policy.js`
  - 将编辑计划扩展为可执行计划，标记可编辑表层、受保护事实和禁止新增事实边界。
- `lib/fact-inventory.js`
  - 从原文和用户填写的事实边界中提取时间、人物、地点、动作、物品、数量、心理感受和感官细节。
  - 作者样本只能用于风格校准，不进入事实库存。
- `lib/fact-auditor.js`
  - 审计改写是否新增无来源事实，并生成 `unsupportedClaims` 与 `needsUserFacts`。
- `lib/voice-profile.js`
  - 清洗作者样本，构建声音画像、表达 DNA、反模式、诚实边界和可执行 `voiceDirectives`。
- `lib/sample-fact-blacklist.js`
  - 从作者样本中抽取禁止迁移的时间、人物、地点、数量、引用和长片段，并审计作者样本风格/原句泄漏。
- `lib/voice-fit.js`
  - 计算声音贴近度分项，包括句长、波动、段首、转场、标点、用词、结尾、AI 模板降低和事实安全扣分。
- `lib/rewrite-executor.js`
  - 按编辑计划调用模型生成、修复越界改写、降级为保守改写，并按事实安全优先排序候选。
- `lib/rewrite-ranking.js`
  - 改写候选去重、保留度评分、AI 率复检排序和统计。
- `knowledge-base/ai-signals/*.json`
  - AI 痕迹规则和可训练语句。
  - 新增规则时优先改这里，避免把知识库内容硬编码进 `server.js`。
- `更新到GitHub.bat`
  - 本地一键提交并推送脚本。
- `启动.bat`
  - 本地启动脚本。

## 修改原则

1. 保持改动小而清楚，优先沿用现有风格。
2. 不要重构无关代码，除非这是完成任务所必需。
3. 除非用户明确要求，不要修改历史文件、旧方案文档、旧调试记录或曾经归档的文件。
4. 涉及检测逻辑时，先看 `knowledge-base/ai-signals/` 是否能解决，再考虑改 `server.js`。
5. 涉及账号、算力、支付、认证时，要同时检查前端页面和服务端接口。
6. 不要提交运行生成的数据、日志、备份文件或密钥文件。
7. 修改公开页面时，确认移动端和桌面端布局都能正常阅读。
8. 不要把 `.env.example` 改成真实配置；它只能包含占位值或示例值。
9. 每次进行完改动结束会话是，需进行冒烟测试。

## 作文改写原则

1. 改写器应是“受控编辑器”，不是自由续写器。
2. 原文和用户填写的“事实边界（已有素材）”是唯一事实来源；作者样本只学句长、开头方式、用词、标点和转场。
3. 编辑计划是模型执行边界。`target` 只能描述修改目标，不能把“减少显性转场”这类操作建议写进正文。
4. 不能为了去 AI 味新增生活细节、时间线、人物、动作、物品、数量、心理活动或感官细节。
5. 原文缺事实时，优先删除空泛句、压缩宣传腔、改成朴素判断，或返回 `needsUserFacts` 向用户索取素材。
6. 事实审计优先于 AI 率。事实不安全的候选，即使 AI 率更低，也不能作为最佳版本。
7. 本地/保守降级只做删除和压缩 AI 嫌疑语句；不要承担风格校准、扩写、补写、重排式风格改造或单篇样例式硬编码改写。
8. 所有走本地/保守降级的记录，均不计入模型改写、风格校准、voiceFit 或风格通过率统计；报告里如需保留，只能作为单独的“本地安全降级”旁路记录，不得混入主统计。
9. 不要用“故意错别字、口水词、随机生活习惯、过度短句”来伪装真人感。

## Git 与发布

当前主分支是 `main`，远端是 `origin`：

```text
https://github.com/Tony121228/ai-text-detector-counter-site.git
```

提交改动时直接运行：

```text
更新到GitHub.bat
```

常规提交流程：

```powershell
git status --short --branch
git add -A
git commit -m "Update description"
git push
```

也可以在项目根目录双击：

```text
更新到GitHub.bat
```

该脚本会自动暂存全部改动、创建时间戳提交并推送。没有改动时会直接退出。

## 不要提交的内容

`.gitignore` 已覆盖主要本地文件。代理仍需主动检查，尤其是：

- `.env`
- `node_modules/`
- `data/`
- `data/app-state.json`
- `data/*.json`
- `data/*.bak*`
- `knowledge-base/training-log.jsonl`
- 邮件发送配置参数文件
- 任何包含真实密钥、token、手机号验证码、SMTP 授权码、用户数据或支付敏感信息的文件

提交前建议运行：

```powershell
git status --short --ignored
```

如需扫描明显密钥痕迹，可运行：

```powershell
rg -n "(?i)(api[_-]?key|secret|password|passwd|smtp_pass|token|authorization|bearer|sk-|github_pat|ghp_)" -g "!node_modules" -g "!.env" -g "!data/**"
```

## 验证建议

本项目目前没有自动化测试脚本。完成修改后至少做以下验证：

1. 启动服务：

```powershell
npm run dev
```

2. 检查健康接口：

```powershell
Invoke-RestMethod http://localhost:3000/health
```

3. 在浏览器打开：

```text
http://localhost:3000
```

4. 如果改了账号页，打开：

```text
http://localhost:3000/account.html
```

5. 如果改了 API，至少用一个正常输入和一个异常输入验证响应。
6. 如果改了作文检测或改写逻辑，用 `C:\Users\Shirly412\Downloads\二十篇不同主题500字优秀作文（全新20篇合集）.md` 做 20 篇冒烟测试，记录：
   - 原文 AI 率和改后 AI 率。
   - `factAudit.passed` 是否全部通过。
   - `unsupportedClaims` 是否为 0。
   - 是否出现编辑建议误入正文、事实新增、过度删除或改写后无降分。
7. 新一轮作文回归优先使用 `docs/全新40篇500字优秀作文（新一轮全套）.md`，报告保存到 `test/作文去AI味指南冒烟测试报告-3.md` 或后续递增编号。
8. 冒烟测试不要重置或污染真实 `data/app-state.json`。如需绕过游客试用限制，优先测本地模块链路，或使用临时状态目录/临时账号方案。
9. 冒烟测试时，若模型调用失败，需二次尝试调用；第二次仍失败时，才能标记为模型调用失败。

## 重要提醒

- `server.js` 会读写本地 `data/app-state.json`。调试时产生的数据不要提交。
- `/api/train` 会更新知识库并追加 `knowledge-base/training-log.jsonl`。训练日志不要提交。
- 未配置 `AI_API_KEY` 时，检测和改写接口可能返回认证失败，这是正常的本地配置问题。
- `/api/rewrite` 当前流程是：本地检测 -> 编辑计划 -> 事实库存 -> 模型改写 -> 事实审计 -> 修复一次 -> 保守降级 -> AI 率复检排序。
- 如果测试里看到“减少显性转场，直接进入判断或例子”等建议语出现在作文正文，说明 `target` 边界或保守降级逻辑又被破坏，需要优先修复。
- 这个仓库是公开仓库，所有提交内容默认会被他人看到。
