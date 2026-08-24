# 墨锋InkEdge - 墨锋InkEdge

基于 PRD 的完整版 MVP：文本检测 + 风险分级 + 改写建议 + 知识库训练 + 复制 + 事件埋点。

## 功能范围（对齐 PRD）

- 文本输入与字数统计（5000 字限制）
- 敏感词提示/拦截
- AI 概率检测（第三方 API）
- 风险等级（低/中/高）与可视化进度条
- 中高风险自动生成改写建议（1-3 个版本）
- 训练功能：从整篇 AI 文本里提取“AI语句”并写入本地 knowledge-base
- 结果复制、改写复制、改写重生成
- 基础埋点接口 `/api/track`
- 超时与错误处理（检测 10 秒、改写 15 秒）
- 重试策略（服务端 2 次重试，针对 5xx/429）

## 启动

```bash
npm install
npm run dev
```

访问 `http://localhost:3000`

Windows PowerShell 如果直接执行 `npm` 被脚本策略拦截，可改用：

```powershell
npm.cmd install
npm.cmd run dev
```

## 环境变量

- `AI_API_BASE_URL`: 例如 `https://api.deepseek.com`
- `AI_API_KEY`: 第三方 API key
- `AI_DETECT_MODEL`: 检测模型名
- `AI_REWRITE_MODEL`: 改写模型名
- `HTTPS_PROXY`: 可选，HTTP/HTTPS 代理，例如 `http://127.0.0.1:7890`
- `HTTP_PROXY`: 可选，HTTP/HTTPS 代理，例如 `http://127.0.0.1:7890`

说明：项目启动脚本已启用 Node 的 `--use-env-proxy`，会在启动时读取 `.env` 中的代理变量并用于上游 API 请求。

## 接口

- `POST /api/detect`
  - 入参: `{ "text": "..." }`
  - 出参: `probability`, `riskLevel`, `reasons`, `rewrites`, `detectDurationMs` 等

- `POST /api/rewrite`
  - 入参: `{ "text": "..." }`
  - 出参: `rewrites`

- `POST /api/train`
  - 入参: `{ "text": "..." }`
  - 出参: `summary`, `suspiciousSentences`, `knowledge`, `added`, `addedCounts`

- `POST /api/track`
  - 入参: `{ "eventCode": "...", "payload": {} }`

- `GET /health`

## 知识库

- AI 痕迹规则已拆到 `knowledge-base/ai-signals/`
- 目前包含：
  - `cliche-phrases.json`
  - `transitions.json`
  - `direct-hints.json`
  - `emotional-words.json`
  - `suspicious-sentences.json`
- 每次训练还会追加一条 `knowledge-base/training-log.jsonl`
- 后续新增关键语句时，优先维护这些文件，而不是直接改 `server.js`

## 作文冒烟测试

- 去 AI 味核心参考：`docs/去AI 去味全网最全指南.docx`
- 新一轮 AI 作文样本：`docs/全新40篇500字优秀作文（新一轮全套）.md`
- 真人对照索引：`docs/真人优秀作文30篇.md`
- 可复跑脚本：`node test/smoke-guide-essay-regression.js --ai-doc "docs/全新40篇500字优秀作文（新一轮全套）.md" --report "test/作文去AI味指南冒烟测试报告-3.md" --json "test/.smoke-guide-essay-results-3.json"`

## 注意

若未配置 `AI_API_KEY`，检测与改写接口会返回认证失败提示。
