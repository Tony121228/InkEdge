# 墨锋InkEdge前端接入说明

本包是纯静态前端，可以直接放到任意静态目录或后端静态资源目录中。

## 文件入口

- `public/index.html`：主工作台
- `public/account.html`：学习档案
- `public/config.js`：后端地址配置
- `public/api-client.js`：统一 API 客户端
- `public/app.js`：主工作台交互
- `public/account.js`：学习档案交互
- `public/styles.css`：界面和启动动画样式

## 启用后端

编辑 `public/config.js`：

```js
window.ESSAY_COACH_CONFIG = {
  API_BASE_URL: 'https://your-domain.example',
  API_PREFIX: '/api/v1',
  USE_BACKEND: true,
  REQUEST_TIMEOUT_MS: 20000
};
```

同域部署时，`API_BASE_URL` 可以留空，只把 `USE_BACKEND` 改为 `true`。

## 统一返回结构

建议后端统一返回：

```json
{
  "success": true,
  "data": {}
}
```

失败时：

```json
{
  "success": false,
  "error": {
    "code": "MODEL_UNAVAILABLE",
    "message": "服务暂时不可用"
  }
}
```

## 当前前端已预留端点

- `GET /api/v1/me`
- `GET /api/v1/dashboard`
- `POST /api/v1/essay-sessions`
- `GET /api/v1/essay-sessions/{sessionId}`
- `POST /api/v1/essay-sessions/{sessionId}/topic-analysis`
- `POST /api/v1/essay-sessions/{sessionId}/material-questions`
- `POST /api/v1/essay-sessions/{sessionId}/materials`
- `POST /api/v1/essay-sessions/{sessionId}/outline`
- `POST /api/v1/essay-sessions/{sessionId}/diagnose`
- `POST /api/v1/essay-sessions/{sessionId}/revision-suggestions`
- `POST /api/v1/essay-sessions/{sessionId}/compare-drafts`
- `POST /api/v1/essay-sessions/{sessionId}/reflection`
- `POST /api/v1/style-profile`
- `POST /api/v1/ability/initial-assessment`
- `GET /api/v1/ability/profile`
- `POST /api/v1/ability/profile/update-from-reflection`
- `POST /api/v1/training-plans`
- `GET /api/v1/training-plans/active`
- `GET /api/v1/training-plans/{planId}`
- `GET /api/v1/training-tasks/today`
- `GET /api/v1/training-tasks/{taskId}`
- `POST /api/v1/training-tasks/{taskId}/submissions`
- `POST /api/v1/training-tasks/{taskId}/feedback`
- `POST /api/v1/training-plans/{planId}/stage-review`
- `GET /api/v1/error-notebook`
- `POST /api/v1/error-notebook/items`
- `GET /api/v1/growth/timeline`

## 功能覆盖

前端已经为方向文档中的 18 项功能预留展示入口和调用钩子：

1. 审题与立意助手
2. 素材追问助手
3. 提纲生成与结构检查
4. 作文体检报告
5. 局部修改助手
6. 段落陪写模式
7. 文风档案
8. 作文评分与提分建议
9. 作文素材库
10. 修改复盘与成长记录
11. 作文能力诊断与分层
12. 个性化训练计划
13. 专项能力训练营
14. 每日训练任务
15. 阶段测评与动态调整
16. 成长地图与激励体系
17. 错因库与个人问题本
18. 训练计划中的 AI 使用边界

未启用后端时，页面会保持空状态或本地占位呈现；启用后端后，优先调用 `window.EssayCoachAPI` 中的对应方法。

## 训练营接入方式

前端不要求新增 `/training-camps` 路由。训练营按“预设聚焦计划”处理：

```json
{
  "planType": "7d",
  "dailyMinutes": 20,
  "focusDimensions": ["细节能力"],
  "target": "细节能力专项提升"
}
```

点击训练营卡片会调用：

```text
POST /api/v1/training-plans
```

当前训练营到能力维度的映射：

| 训练营 | focusDimensions |
|---|---|
| 审题训练营 | 审题能力 |
| 立意训练营 | 立意能力 |
| 素材训练营 | 选材能力 |
| 细节训练营 | 细节能力 |
| 结构训练营 | 结构能力 |
| 语言修改训练营 | 语言能力 |
