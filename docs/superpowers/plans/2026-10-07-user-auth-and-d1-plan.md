# 用户登录注册系统与 Cloudflare D1 开发计划

## 1. 目标

在墨锋 InkEdge 项目中建立可上线的用户登录/注册体系，并按照“你像AI吗”文本检测反测站的实现方式使用 Cloudflare D1 保存云端状态。登录后用户应能跨设备识别身份，作文训练、检测改写、算力和个人资料应绑定到账号；游客试用和管理员能力继续保留。

本计划只描述实现和部署方案，Cloudflare 数据库创建、远端迁移和生产数据变更必须在计划确认后执行。

## 2. 已完成的代码审计结论

### 2.1 当前项目并非没有登录系统

当前项目已经存在以下实现：

- 邮箱验证码登录/注册接口：`/api/auth/send-code`、`/api/auth/verify-code`。
- 退出登录接口：`/api/auth/logout`。
- 基于 HttpOnly `session_id` Cookie 的会话。
- 会话过期、验证码过期、验证码尝试次数限制和认证频率限制。
- 游客额度转登录奖励、用户算力、算力流水、充值记录。
- 管理员用户列表、调算力、资料修改和删除账号。
- `public/account.html` 与 `public/account.js` 账号页面。
- 本地 `data/app-state.json` 和 Cloudflare D1 两种状态存储路径。

### 2.2 参考项目的复用情况

已检查 `D:/tony/“你像AI吗”文本检测反测站`：

- 参考项目使用同样的 Node.js + Express + 静态前端结构。
- 参考项目使用邮箱验证码登录，不使用密码直登。
- 参考项目的 `public/account.js` 与当前项目文件内容一致。
- 参考项目用 `app_state_records(collection, id, payload, updated_at)` 保存各状态集合，用 `security_rate_limits` 保存验证码尝试计数。
- 参考项目通过 `worker.mjs` 注入 `CLOUDFLARE_ENV`，通过 `APP_STATE_DB` 绑定 D1。

因此，本项目后续不应重复复制一套登录前端或另起一套认证协议；重点应是验证现有认证链路、补齐测试，并决定新 D1 与现有作文状态的边界。

## 3. 当前 Cloudflare 状态

当前项目已有 Cloudflare 配置：

- Worker：`inkedge`。
- 当前 D1 绑定：`APP_STATE_DB`。
- 当前数据库名：`inkedge-state`。
- 当前数据库 ID：已写入 `wrangler.jsonc`。
- 当前迁移：`migrations/0001_app_state_records.sql`、`migrations/0002_security_rate_limits.sql`。
- 当前 Worker 路由：`inkedge.aicreatorhome.cn/*`。

这意味着“新建 D1”不是代码中添加一个空配置那么简单，还要处理已有 `APP_STATE_DB` 中可能存在的作文会话、用户、算力和任务数据，避免双库读写不一致。

## 4. 推荐架构决策

### 推荐方案：新 D1 作为账号状态主库，保留现有数据兼容层

创建一个新的 D1，例如 `inkedge-auth-state`，绑定名暂定 `AUTH_STATE_DB`。数据表沿用参考项目的通用结构：

- `app_state_records`：以 `collection + id` 为主键，`payload` 保存 JSON。
- `security_rate_limits`：保存验证码尝试和过期时间。

账号相关集合进入新库：

- `users`
- `verificationCodes`
- `sessions`
- `authRateLimits`
- `guestUsages`
- `guestIpUsages`
- `powerLedger`
- `rechargeOrders`

作文业务集合暂时继续使用现有 `APP_STATE_DB`：

- `essaySessions`
- `essayDiagnostics`
- `essayMaterials`
- `essayReflections`
- `essayGuides`
- `trainingPlans`
- `trainingTaskSubmissions`
- `rewriteTasks`

需要额外处理的关联关系：作文会话和改写任务只保存 `userId`，不复制用户对象；读取用户信息时通过账号库查询。跨库不能使用同一个 D1 事务，因此扣算力与创建改写任务必须设计幂等键和失败补偿，不能简单把现有单库 flush 逻辑复制两份。

### 备选方案：新 D1 承载全部状态

如果希望完全复刻参考项目的低复杂度实现，可将新 D1 作为新的 `APP_STATE_DB`，所有状态集合迁移到新库，旧库保留只读备份。这一方案跨库一致性风险最低，但它不是“仅用户数据独立存储”，且必须先完成旧 D1 数据迁移和回滚备份。

开发前需要用户确认采用推荐方案还是备选方案。未确认前不创建远端数据库。

## 5. 实施阶段

### 阶段 A：认证基线验证

- 补充登录、注册、退出、会话过期、错误验证码、验证码锁定和频率限制测试。
- 确认登录前游客额度、注册奖励和登录后账号额度转移规则。
- 检查首页、作文工作台、账号页对 `GET /api/me` 的处理是否一致。
- 检查 Cookie 的 `HttpOnly`、`SameSite=Lax`、生产 `Secure` 和 `APP_SECRET` 配置要求。

### 阶段 B：账号数据访问层拆分

- 把当前单库状态访问拆成账号库和作文业务库两个明确的集合边界。
- 保留本地开发时 `data/app-state.json` 的兼容行为。
- 为账号库增加独立的加载、差异写回、删除和并发合并逻辑。
- 对用户算力和验证码尝试保留参考项目中的增量合并策略，防止并发请求覆盖余额或尝试次数。
- 为跨库操作增加幂等请求 ID、失败重试和可观测日志。

### 阶段 C：Cloudflare D1 资源和迁移

- 在 Cloudflare 账户中创建新 D1，数据库名称待确认。
- 增加新迁移文件，创建 `app_state_records` 和 `security_rate_limits`。
- 更新 `wrangler.jsonc`，新增 `AUTH_STATE_DB` 绑定。
- 使用 `wrangler d1 migrations apply` 分别验证本地和远端迁移。
- 不在代码、文档或提交中写入 Cloudflare API Token。
- 如旧库已有生产用户，先导出并核对用户、会话、算力流水和验证码状态，再做一次性迁移；验证码和会话不建议迁移，迁移时应全部失效并要求重新登录。

### 阶段 D：前端和产品流程验收

- 账号页继续复用现有登录弹窗，补齐加载、错误、验证码倒计时和退出状态。
- 首页和作文工作台在未登录时显示登录入口，在需要账号或算力时给出明确提示。
- 登录成功后刷新用户、算力和游客额度状态，不丢失当前作文草稿。
- 移动端和桌面端复核账号页布局。

### 阶段 E：测试和上线前检查

- 单元/接口测试：正常登录、首次注册、重复登录、验证码过期、错误码锁定、频率限制、退出和会话失效。
- 数据测试：用户资料、算力流水、游客额度转移、管理员操作和跨请求并发写入。
- Cloudflare 测试：D1 迁移、Worker 绑定、生产 Cookie、无 `APP_SECRET` 拒绝启动。
- 浏览器冒烟：首页登录、账号页、作文检测、局部修改、训练记录和退出登录。
- 每轮测试生成编号报告保存到 `docs/reports/`，测试启动的本地服务必须关闭。

## 6. 需要的外部前提

- Cloudflare CLI 已登录到目标账户，并有创建 D1、修改 Worker 绑定和执行迁移的权限。
- 确认新 D1 的数据库名称和采用“账号独立库”还是“全状态新库”。
- 生产环境配置至少包括 `APP_SECRET`、邮箱 SMTP 配置和管理员邮箱。
- 如存在旧生产用户，需要先确认是否迁移历史账号、算力流水和充值记录。

## 7. 回滚策略

- 创建新 D1 前保留当前 `wrangler.jsonc` 和旧数据库绑定配置。
- 迁移阶段只新增绑定和代码开关，不直接删除旧表或旧库。
- 远端验证失败时关闭新库开关，恢复旧 `APP_STATE_DB` 读写。
- 会话和验证码不做跨库恢复，回滚后统一要求重新登录，避免复用可能已泄露或失效的认证状态。

## 8. 置信度评估

对“当前项目已包含参考项目同源登录系统”和“参考项目采用通用 D1 状态表”的判断置信度：**0.98**。对推荐的双库拆分方案的工程可行性置信度：**0.86**，主要不确定性是跨库扣算力、改写任务和用户状态的一致性；对直接复刻参考项目的单库方案置信度：**0.94**，但它不满足严格意义上的账号数据独立存储。远端 Cloudflare 创建和迁移尚未执行，相关结果不应视为已完成。
