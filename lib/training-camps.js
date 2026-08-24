/**
 * 专项能力训练营模块（成员C）
 * ====================================================================
 * 职责：六个专项训练营（审题/立意/素材/细节/结构/语言修改）的目录、
 *       状态查询与"开营即生成专项训练计划"。
 *
 * 设计约定（与 lib/long-term-ability.js 一致）：
 *   - 纯业务逻辑：不碰 HTTP、不碰文件系统、不直接读 state。
 *   - 开营不调 AI：训练营计划由本地规则生成（专项任务序列），
 *     后续每日任务反馈 / 阶段复盘复用 long-term-ability 的 AI 链路。
 *   - 生成的计划与 POST /api/v1/training-plans 的数据结构完全一致
 *     （plan.days 一天一项，taskId 由路由层分配），因此任务提交、
 *     反馈、复盘、今日任务等既有接口对训练营计划直接可用。
 *
 * 路由层接入方式见 docs/长期能力提升模块接入说明-成员C.md 第 8 节。
 */

'use strict';

const DIMENSIONS = require('./long-term-ability').DIMENSIONS;

// ====================================================================
// 训练营目录（与前端 public/app.js renderTrainingCamps 的六张卡片一一对应）
// ====================================================================

const TRAINING_CAMPS = [
  {
    campId: 'shenti',
    title: '审题训练营',
    dimension: '审题能力',
    description: '圈关键词、判断题眼、排除跑题角度。',
    taskTypes: ['圈关键词', '判断题眼', '排除跑题角度', '一题多解', '提纲对照', '限时审题'],
    defaultDays: 7,
    defaultMinutes: 10
  },
  {
    campId: 'liyi',
    title: '立意训练营',
    dimension: '立意能力',
    description: '为同一材料选择不同立意。',
    taskTypes: ['一句话立意', '正反立意', '由小见大', '立意排序', '标题匹配', '限时立意'],
    defaultDays: 7,
    defaultMinutes: 10
  },
  {
    campId: 'sucai',
    title: '素材训练营',
    dimension: '选材能力',
    description: '记录真实经历并标注可用主题。',
    taskTypes: ['素材卡记录', '主题标注', '一材多用', '真实经历扩写', '素材取舍', '素材库整理'],
    defaultDays: 7,
    defaultMinutes: 15
  },
  {
    campId: 'xijie',
    title: '细节训练营',
    dimension: '细节能力',
    description: '动作扩写、对话扩写、心理扩写。',
    taskTypes: ['动作扩写', '对话扩写', '心理扩写', '五感观察', '细节替换空话', '限时细节'],
    defaultDays: 7,
    defaultMinutes: 15
  },
  {
    campId: 'jiegou',
    title: '结构训练营',
    dimension: '结构能力',
    description: '排序段落、补提纲、调整重点。',
    taskTypes: ['段落排序', '补提纲', '开头改写', '结尾改写', '重点段落扩写', '限时搭框架'],
    defaultDays: 7,
    defaultMinutes: 15
  },
  {
    campId: 'yuyan',
    title: '语言修改训练营',
    dimension: '语言能力',
    description: '删空话、改套话、保留学生表达。',
    taskTypes: ['删除空话', '套话改写', '保留学生表达', '长短句变化', '词语精准替换', '限时修改'],
    defaultDays: 7,
    defaultMinutes: 10
  }
];

const CAMP_BY_ID = new Map(TRAINING_CAMPS.map((camp) => [camp.campId, camp]));

// ====================================================================
// 1. 训练营目录 + 每个营的状态（从未开始 / 进行中 / 已完结）
// ====================================================================

function listTrainingCamps(state = {}, userId = '') {
  const plans = (state.trainingPlans || []).filter((plan) => !userId || plan.userId === userId);

  return TRAINING_CAMPS.map((camp) => {
    const campPlans = plans.filter((plan) => plan.campId === camp.campId);
    const activePlan = campPlans.find((plan) => plan.status === '进行中') || null;
    const completedCount = campPlans.filter((plan) => plan.status === '已完成').length;
    const lastPlan = campPlans[campPlans.length - 1] || null;

    let campStatus = '未开始';
    if (activePlan) campStatus = '进行中';
    else if (completedCount > 0) campStatus = '已完结';

    return {
      campId: camp.campId,
      title: camp.title,
      dimension: camp.dimension,
      description: camp.description,
      defaultDays: camp.defaultDays,
      defaultMinutes: camp.defaultMinutes,
      status: campStatus,
      activePlanId: activePlan ? (activePlan.planId || activePlan.id) : null,
      completedCount,
      lastStartedAt: lastPlan ? (lastPlan.createdAt || '') : ''
    };
  });
}

function getTrainingCamp(campId, state = {}, userId = '') {
  const camp = CAMP_BY_ID.get(String(campId || '').trim());
  if (!camp) return { error: 'CAMP_NOT_FOUND' };
  const entry = listTrainingCamps(state, userId).find((item) => item.campId === camp.campId);
  return { ...camp, ...entry };
}

// ====================================================================
// 2. 开营：生成专项训练计划（本地规则，无 AI）
// ====================================================================

const ALLOWED_CAMP_PLAN_DAYS = [3, 7, 14];

function buildCampPlan(input = {}) {
  const camp = CAMP_BY_ID.get(String(input.campId || '').trim());
  if (!camp) return { error: 'CAMP_NOT_FOUND' };

  const requestedDays = Number(input.totalDays);
  const totalDays = ALLOWED_CAMP_PLAN_DAYS.includes(requestedDays)
    ? requestedDays
    : camp.defaultDays;
  const dailyMinutes = Math.min(60, Math.max(5, Number(input.dailyMinutes) || camp.defaultMinutes));
  const goal = String(input.goal || '').trim().slice(0, 60)
    || `${camp.title}：集中提升${camp.dimension}`;

  const days = [];
  for (let day = 1; day <= totalDays; day += 1) {
    const taskType = camp.taskTypes[(day - 1) % camp.taskTypes.length];
    days.push({
      day,
      taskId: '', // 由路由层分配（与 POST /api/v1/training-plans 的处理一致）
      taskType,
      title: `第${day}天：${taskType}`,
      instruction: `${camp.description.replace(/。$/, '')}——请完成${taskType}练习。预计用时${dailyMinutes}分钟。`,
      expectedMinutes: dailyMinutes,
      relatedDimension: camp.dimension,
      status: '未开始'
    });
  }

  return {
    campId: camp.campId,
    campTitle: camp.title,
    planType: `camp_${totalDays}d`,
    totalDays,
    dailyMinutes,
    goal,
    focusDimensions: [camp.dimension],
    days
  };
}

// ====================================================================
// 3. 前端卡片数据适配（可选）：把目录转成 renderTrainingCamps 需要的卡片结构
// ====================================================================

function toCampCards(state = {}, userId = '') {
  return listTrainingCamps(state, userId).map((camp) => ({
    campId: camp.campId,
    title: camp.title,
    text: camp.description,
    statusLabel: camp.status === '未开始' ? '待开始' : camp.status,
    activePlanId: camp.activePlanId
  }));
}

// ====================================================================
// 导出
// ====================================================================

module.exports = {
  TRAINING_CAMPS,
  listTrainingCamps,
  getTrainingCamp,
  buildCampPlan,
  toCampCards
};
