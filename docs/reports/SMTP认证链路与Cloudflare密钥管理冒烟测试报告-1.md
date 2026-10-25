# SMTP认证链路与Cloudflare密钥管理冒烟测试报告-1

## 1. 执行范围

本次验证覆盖已确认执行的用户邮箱验证码登录链路、SMTP 配置读取、Cloudflare Worker Secret 管理，以及相关回归检查。测试未打印、未记录 SMTP 密码、授权码、API Key 或验证码值。

## 2. 本次实现

- 在 `server.js` 中补齐邮箱验证码登录依赖的运行时环境读取、客户端 IP 解析、验证码清理、D1/本地限流、验证码生成与校验逻辑。
- 按参考项目迁入 SMTP 对话流程：EHLO、STARTTLS、可选 AUTH LOGIN、MAIL FROM、RCPT TO、DATA 和 QUIT。
- 保留当前项目既有用户、算力、注册赠送和 `APP_STATE_DB -> inkedge-state` 状态同步实现，没有重建或清空 D1。
- 补齐游客试用状态辅助函数，使验证码登录前后的游客额度、会话和 `/api/me` 返回保持一致。
- `/api/me` 现在返回认证渠道、邮箱能力、游客试用额度和登录用户算力信息，前端账号区可据此正确渲染。

## 3. 自动化与链路结果

| 检查项 | 结果 |
| --- | --- |
| `node --check server.js` | 通过 |
| `node scripts/auth-ui-copy.test.js` | 通过 |
| `node scripts/auth-api-smoke.test.js` | 通过：游客查询、缺少 SMTP、无效验证码、退出登录 |
| 本地模拟 SMTP 端到端链路 | 通过：发送验证码、验证码校验、会话 Cookie、用户持久化 |
| `node scripts/dashboard-api.test.js` | 通过 |
| `node scripts/essay-session-ownership.test.js` | 通过 |
| `node scripts/reference-comparison.test.js` | 通过 |
| `npx wrangler deploy --dry-run` | 通过；Worker 绑定包含 `inkedge-state` D1 和静态资源 |

本地模拟 SMTP 使用内存 Socket，不连接真实邮件服务器；测试结束后已关闭临时 HTTP 服务，并逐个清理临时状态文件。

## 4. Cloudflare Secret 核对

通过 `npx wrangler secret list --name inkedge` 核对到以下 Secret 名称：

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

同时确认已有 `APP_SECRET` 和 `AI_API_KEY`。本次仅核对名称，不读取 Secret 值，也未执行 Worker 部署。

## 5. 未覆盖范围与注意事项

- 尚未向真实收件箱发送邮件，真实 SMTP 服务的证书、端口、发信策略和投递率需要在部署后使用测试邮箱验证。
- 未执行 `wrangler deploy`，本次只验证打包和绑定解析；代码上线需要单独确认部署。
- Cloudflare Worker 运行时仍依赖当前项目启用的 Node.js 兼容配置；若目标 SMTP 服务不允许 Worker TCP/TLS 连接，需要改用可访问的邮件发送服务或 Cloudflare Email Service。

## 6. 置信度评估

对“当前项目已具备可运行的邮箱验证码认证链路、SMTP Secret 已写入并能被 Worker 绑定读取”的判断置信度为 **0.92**。本地模拟 SMTP、认证 API、D1 绑定 dry-run 和现有回归均已通过；剩余不确定性主要来自真实 SMTP 网络连通性和邮件服务商的投递策略，这两项必须在正式环境通过真实测试邮箱确认。
