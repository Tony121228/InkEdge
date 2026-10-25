# 移除算力计费并修复用户数据绑定开发计划

## 1. 目标

本次改动解决两类问题：

1. 当前项目不采用算力计费，移除前台、后台、接口和业务流程中所有正在生效的算力/充值/试用额度内容。
2. 确保作文构思、作文体检、局部修改、素材、训练计划、能力画像、成长记录和后台任务在用户登录后按真实账号 ID 存储到当前项目绑定的 Cloudflare D1 `inkedge-state`，不能由客户端传入任意 `userId` 覆盖归属。

## 2. 当前问题证据

- `public/account.html` 仍有余额、充值说明、微信收款码、算力流水和临时 IP 额度后台。
- `public/account.js` 仍读取 `/api/payment/config`、`/api/power/ledger`、管理员调算力接口并渲染余额。
- `public/app.html`、`public/auth.js` 仍显示“算力”和注册赠送算力提示。
- `server.js` 的检测、改写、训练和后台任务入口仍调用 `ensurePower()`、`applyPowerConsumption()` 或游客额度扣减逻辑。
- 登录注册仍计算注册赠送算力，`serializeUser()` 和 `/api/me` 仍返回余额字段。
- 多个 `/api/v1` 接口使用 `req.body.userId` 或 `req.query.userId`，客户端可伪造归属；`currentStudentId()` 当前主要按 IP 生成游客 ID，没有把已登录用户统一切换为真实用户 ID。
- `guestIpPanel` 属于旧的游客额度/防刷管理面板，与本项目新的非计费定位冲突。

## 3. 设计决策

### 3.1 计费功能下线方式

- 前端删除账户概览中的余额统计、收费说明、费率、转账备注、算力流水、临时 IP 额度面板和管理员调算力控件；保留微信收款码图片及其非收费名称。
- 工作台账号按钮登录后只显示用户名或邮箱，不显示余额、试用额度或算力。
- 认证成功响应删除 `signupBonusGranted` 等计费字段；新用户不再获得注册算力。
- 检测、改写、训练和后台任务不再执行 `ensurePower()`、`applyPowerConsumption()`、游客试用额度扣减或 `INSUFFICIENT_POWER` 分支。
- `/api/payment/config` 仅返回微信收款码图片和名称；`/api/power/packages`、`/api/power/ledger`、`/api/power/recharge`、`/api/admin/power/grant`、`/api/admin/guest-ip-usages` 统一返回明确的 `410` 下线响应，避免旧前端或旧客户端误以为计费仍可用。
- `users` 中已有的 `powerBalance`、`giftedPower`、`rechargedPower`、`consumedPower`，以及 D1 中历史 `powerLedger`、`rechargeOrders`、`guestIpUsages` 记录不直接删除。它们只作为历史兼容数据保留，不再进入序列化响应、业务判断或页面；后续若要物理清理，另行设计并单独确认。

### 3.2 账号归属方式

- 增加统一认证中间件，确保每个请求在业务路由前都得到 `req.auth = { user, session }` 或匿名状态。
- `currentStudentId(req, res)` 优先返回 `req.auth.user.id`；只有匿名请求才生成/读取游客 owner ID。
- 所有作文、能力、训练、成长和素材接口忽略客户端传入的 `userId`，统一使用当前请求认证主体。客户端传入字段只保留兼容读取，不得影响归属。
- `getRewriteTaskOwner()` 统一使用登录用户 ID；匿名任务使用游客 owner ID。任务读取、重试、清理继续执行 owner 校验。
- 登录成功时，把当前游客 owner 下尚未归档的作文会话、素材、能力画像、训练计划、训练任务提交和改写任务转移到新用户 ID，避免用户先以游客开始写作、登录后记录丢失。
- 已有生产数据不做全库猜测式重绑。只有当前请求 Cookie/游客 owner 能明确对应到刚登录的账号时才迁移，避免把不同用户的历史记录合并。
- D1 仍使用现有 `APP_STATE_DB -> inkedge-state` 通用状态表和请求结束刷盘机制，不新建第二个用户库，不清空现有业务数据。

## 4. 实施步骤

### A. 服务端认证和归属

1. 在 Cookie 解析后挂载认证中间件，修复当前部分路由直接访问 `req.auth.user` 但没有统一初始化的问题。
2. 重写 `currentStudentId()` 的主体选择逻辑：登录用户使用真实用户 ID，匿名用户使用稳定游客 owner。
3. 增加游客 owner 到用户 ID 的一次性绑定函数，覆盖 `essaySessions`、`styleProfiles`、`abilityProfiles`、`trainingPlans`、`trainingTaskSubmissions` 和 `rewriteTasks` 等具备 owner 字段的数据。
4. 登录验证成功后执行绑定，再创建会话并返回用户信息。
5. 将所有 `req.body.userId`/`req.query.userId` 的业务归属入口改为服务端主体；保留管理员专用目标用户参数的接口语义，但不允许普通用户越权。
6. 添加跨请求归属回归测试，验证登录用户创建/读取作文会话、能力档案、训练计划和改写任务时均使用账号 ID，伪造另一个 `userId` 不生效。

### B. 移除计费业务

1. 从 `server.js` 的新用户结构、用户序列化、`/api/me`、认证响应和任务序列化中删除正在使用的计费字段。
2. 从检测、改写、训练、后台任务创建和重试路径删除余额预检、扣减、游客额度扣减和计费错误分支。
3. 删除或停用 `PAYMENT_CONFIG`、充值接口、流水接口、管理员调算力接口和游客 IP 额度接口的产品逻辑，统一返回下线状态。
4. 保留认证限流、验证码、会话安全和 D1 状态同步；这些属于登录安全，不属于计费。
5. 清理 `summarizeViewer()`、`/api/v1/me`、工作台任务结果中与余额/试用额度有关的返回对象。

### C. 前端界面

1. `public/account.html` 保留个人资料、登录状态、退出登录、微信收款码和管理员账号资料管理；移除收费说明、费率、转账备注、余额统计、算力流水、临时 IP 管理后台和相关提示。
2. `public/account.js` 移除支付、流水、游客 IP、余额和管理员调算力请求及渲染；已登录用户点击顶部账号名称直接跳转 `/account.html`，游客才打开登录弹窗。
3. `public/app.html` 和 `public/auth.js` 删除算力、试用额度、注册赠送等文案；登录后账号按钮只显示名称/邮箱。
4. 全项目运行时代码扫描中文“算力”、`powerBalance`、`recharge`、`INSUFFICIENT_POWER`、`guestIpUsages` 等标记，区分历史文档/旧数据字段和仍会被执行的代码，确保产品 UI 与业务路径不再出现。

### D. 测试和部署

1. 运行 `node --check server.js`、`node --check public/auth.js`、`node --check public/account.js`、`node --check public/app.js`。
2. 更新原有登录 UI 测试，增加“已登录点击账号跳转个人中心”和“页面不出现算力/充值文案”断言。
3. 新增认证数据归属测试：用户 A 创建的会话/画像/计划不能被用户 B 或伪造 `userId` 读取或修改；登录前游客记录在登录后绑定到该账号。
4. 运行作文构思、体检/局部修改、参考对照、训练计划、成长时间线、账号 API 回归测试，确认移除计费后业务不再因余额失败。
5. 启动临时本地服务做账号绑定和无计费链路冒烟测试，结束后关闭进程并逐个清理临时状态文件。
6. 使用 Wrangler dry-run 和 Cloudflare 部署脚本发布；部署后检查 `/health`、`/api/me`、`/app.html` 和 `/account.html`，确认 D1 仍可读写且线上 UI 无计费文案。
7. 将结果写入 `docs/reports/`，使用递增编号，不覆盖历史报告。

## 5. 数据安全和兼容边界

- 不删除目录，不清空 D1，不删除历史用户或作文数据。
- 不在测试和报告中输出验证码、SMTP 密码、API Key 或用户隐私。
- 历史算力字段保留在数据库只是为了避免破坏已有记录；产品接口不再公开或使用这些字段。
- 真实计费方案暂不实现，后续可在不恢复旧算力模型的前提下单独设计新的计费合同。
- 该改动不影响邮箱验证码登录本身，SMTP Secret 和验证码限流继续保留。

## 6. 置信度评估

对“可以在不破坏现有作文数据和登录系统的前提下移除算力计费，并修复已登录用户的数据归属”的方案置信度为 **0.91**。当前代码、最新部署报告和 D1 状态同步方式已直接核对；主要剩余风险是历史游客记录形态不完全一致，以及旧客户端可能继续调用已下线接口，这两项会通过兼容迁移和明确 `410` 响应控制。
