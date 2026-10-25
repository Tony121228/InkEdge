# long-term-ability.js（下载版）代码审阅

时间：2026-08-23 10:39:17

## 快速结论
- 模块为 CommonJS 格式（module.exports），可直接放入项目 `lib/long-term-ability.js` 使用。
- 导出函数与测试脚本期望一致：
  assessInitialAbility、updateProfileFromReflection、buildTrainingPlanTasks、todayTasksFromPlan、reviewTaskSubmission、runStageReview、mergeErrorNotebookItem、topRecurringIssues、buildGrowthTimeline；另导出 DIMENSIONS、OUTPUT_CONTRACTS、stageForAverage。
- 依赖项：仅 `./text-metrics`（与项目已有 `lib/text-metrics.js` 路径相对一致，放入 lib 后可直接解析）。
- 纯业务逻辑：不读写文件、不直接操作 state；AI 调用通过入参 `callModel` 注入，并内置降级（`degraded: true`）。
- 与已存在路由（/api/v1/ability/*、/api/v1/training-plans 等）契合度高：路由层可作为薄编排，调用本模块返回结构后再写入 state。

## 关键兼容性点
- 导出方式：`module.exports = { ... }`，包含所有测试所需方法（已核对）。
- 函数签名：
  - assessInitialAbility(input = {})
  - updateProfileFromReflection(input = {})
  - buildTrainingPlanTasks(input = {})
  - todayTasksFromPlan(plan)
  - reviewTaskSubmission(input = {})
  - runStageReview(input = {})
  - mergeErrorNotebookItem(items, item)
  - topRecurringIssues(items)
  - buildGrowthTimeline(input = {})
- 降级分支：当 `callModel` 缺失或抛错时，返回结构包含 `degraded: true`，保证前端/测试可继续。

## 接入建议（最小变更）
1. 将下载文件保存为：`lib/long-term-ability.js`。
2. 将下载的测试脚本保存为：`scripts/long-term-ability.test.js`，并在 package.json 添加脚本：
   `"test:long-term-ability": "node scripts/long-term-ability.test.js"`。
3. 运行：`npm run test:long-term-ability`（无需 AI_API_KEY）。
4. 若要在路由层启用：在现有 /api/v1/ability* 与 /api/v1/training-plans* 路由中调用本模块函数，并保持写 state 的职责在路由层。

## 风险与注意
- 依赖路径：模块内部使用 `require('./text-metrics')`，必须与 `lib/text-metrics.js` 位于同级目录（即放入 lib）。
- 文案/维度：与短期指导（essay-guidance）存在“八维 vs 七维”的概念差异，注意前端展示文案和统计口径的统一。
- 未来扩展：如需与现有 `essayGuidance` 融合，可在路由层统一归口，避免重复计算。

---
置信度：0.90（已读取下载文件并解析导出、签名与依赖；与项目现状和测试脚本逐项比对）。
