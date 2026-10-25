# 长期能力提升模块接入可行性评估（成员C）

时间：2026-08-23 10:30:51

## 结论
- 不能“直接接入”测试文件；需先补齐 `lib/long-term-ability.js` 模块。
- 现有 `server.js` 已存在对应的能力/训练相关 API 路由，可与该模块对齐对接，但单就 `long-term-ability.test.js` 而言，它不依赖 HTTP，仅依赖库文件本身。

## 依据与现状
- 已找到文档：
  - 设计文档：C:/Users/Shirly412/Documents/Codex/2026-08-23/offmap-x-1-2-10-3/outputs/三人分工作文训练系统API接口设计.md
  - 接入说明：C:/Users/Shirly412/Downloads/长期能力提升模块接入说明-成员C.md（包含对 `lib/long-term-ability.js` 的明确说明）
- 测试文件位置：C:/Users/Shirly412/Downloads/long-term-ability.test.js（头注：`node scripts/long-term-ability.test.js`；`require('../lib/long-term-ability')`）
- 项目当前文件：
  - 缺少：D:/tony/黑客松项目/lib/long-term-ability.js（未找到）
  - 现有能力相关路由：
    - POST /api/v1/能力初测：`/api/v1/ability/initial-assessment`（server.js:3251）
    - POST /api/v1/反思更新画像：`/api/v1/ability/profile/update-from-reflection`（server.js:3290）
    - POST /api/v1/训练计划生成：`/api/v1/training-plans`（server.js:3318）
    - 以及若干 plan/task 相关 GET/POST 路由（server.js:3336 起）。
- package.json 脚本：未定义 `long-term-ability` 的测试脚本（现有测试均为 Node 脚本，非 Jest）。

## 测试文件对模块的要求
`long-term-ability.test.js` 直接调用库导出的方法，至少需要：
- `assessInitialAbility`
- `updateProfileFromReflection`
- `buildTrainingPlanTasks`
- `todayTasksFromPlan`
- `reviewTaskSubmission`
- `runStageReview`
- `mergeErrorNotebookItem`
- `topRecurringIssues`
- `buildGrowthTimeline`

测试不依赖真实 AI 服务，使用 `fakeCallModel` 注入模拟返回；因此只要补齐库函数，即可离线跑通。

## 可接入方案
- 方案 A（推荐）：按“成员C接入说明”新增 `lib/long-term-ability.js`，导出上述方法；
  - 在 `server.js` 的相关路由内调用该库以对齐单一业务来源（当前实现部分逻辑散落在 `essayGuidance` 与内联代码中）。
- 方案 B（最小改动以跑测试）：仅新增 `lib/long-term-ability.js`，方法体内部桥接现有 `essayGuidance` 与当前状态存取；先保证测试可运行，后续再收敛路由调用。

## 具体落地步骤（最小集）
1. 新增文件：`lib/long-term-ability.js`（导出上述 9 个方法；先用现有逻辑桥接即可）。
2. 复制测试文件到项目：`scripts/long-term-ability.test.js`（来源：C:/Users/Shirly412/Downloads/long-term-ability.test.js）。
3. 在 `package.json` 增加脚本：`"test:long-term-ability": "node scripts/long-term-ability.test.js"`。
4. 本地执行：`npm run test:long-term-ability`（无需 AI_API_KEY）。

## 与“API 接口设计”一致性
- 现有路由已覆盖“初测/画像更新/训练计划”等路径，落库后可只在这些路由中转调用库函数，避免重复实现。

---
置信度：0.86（已读取两份文档、扫描 server.js 与包配置，并解析测试文件头与调用点；库文件缺失导致“直接接入”不可行）。
