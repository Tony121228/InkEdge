/**
 * 长期能力提升模块（成员C）
 * ====================================================================
 * 职责：能力画像（八维）、个性化训练计划、每日任务、任务反馈、
 *       阶段复盘、错因库统计、成长轨迹。
 *
 * 设计约定（与 lib/essay-guidance.js 保持一致）：
 *   - 纯业务逻辑：不碰 HTTP、不碰文件系统、不直接读 state。
 *   - AI 调用通过参数传入的 callModel(taskName, input, outputContract, options)
 *     完成，签名与 server.js 的 callEssayGuidanceModel 一致，方便路由层直接传入。
 *   - callModel 缺失或抛错时自动降级为本地规则，返回值带 degraded: true，
 *     不向外抛异常（画像、反馈、复盘三条 AI 链路都有降级）。
 *   - 数据写入 state 集合（abilityProfiles / trainingPlans /
 *     trainingTaskSubmissions / errorNotebookItems）由 server.js 路由层负责，
 *     本模块只返回"应写入的数据"，保持 server.js 侧改动最小。
 *
 * 维度体系沿用成员C原始 C++ 版本的八维（与 essay-guidance 的短期七维不同，
 * 八维用于长期画像，短期七维用于单篇诊断，两套并存不冲突）。
 */

'use strict';

const { countCjk } = require('./text-metrics');

// 八个能力维度（长期画像）
const DIMENSIONS = [
  '审题能力', '立意能力', '选材能力', '结构能力',
  '细节能力', '语言能力', '修改能力', '考场表达能力'
];

// 阶段划分（平均分：<50 基础期，<65 进阶期，<80 提升期，其余冲刺期）
function stageForAverage(avg) {
  if (avg < 50) return '基础期';
  if (avg < 65) return '进阶期';
  if (avg < 80) return '提升期';
  return '冲刺期';
}

// JSON 输出契约（风格与 server.js 的 GUIDANCE_OUTPUT_CONTRACTS 一致）
const OUTPUT_CONTRACTS = {
  initialAssessment:
    'dimensionScores:object(键为八维名称"审题能力/立意能力/选材能力/结构能力/细节能力/语言能力/修改能力/考场表达能力"，值为0-100整数); ' +
    'dimensionComments:object(键为维度名，值为一句话点评); summary:string(两三句话的整体评价)',
  taskFeedback:
    'feedback:string(120字以内的具体点评，指出做得好的地方和最该改的一处); ' +
    'score:integer(0-100); improvedVersionHint:string(一句话改进提示); ' +
    'relatedIssues:string[](归纳出的作文问题，如"素材不够具体"); ' +
    'profileUpdateSuggestion:boolean(是否建议更新长期能力画像)',
  stageReview:
    'reviewSummary:string(阶段总结，150字以内); improvedDimensions:string[](有进步的维度名); ' +
    'persistentIssues:string[](反复出现的问题); nextPlanSuggestion:string(下一阶段建议); ' +
    'adjustCurrentPlan:boolean(是否建议调整当前计划)'
};

// ====================================================================
// 工具函数
// ====================================================================

function clampScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 60;
  return Math.min(100, Math.max(0, Math.round(num)));
}

function normalizeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

// 把模型返回的分数对象规范化为完整八维（缺失维度按 60 兜底）
function normalizeDimensionScores(raw) {
  const scores = {};
  const source = (raw && typeof raw === 'object') ? raw : {};
  for (const dim of DIMENSIONS) {
    scores[dim] = clampScore(source[dim]);
  }
  return scores;
}

// 按分数排序，取最高两项为优势、最低两项为短板（沿用 C++ 版规则）
function deriveStrengthsAndWeaknesses(dimScores) {
  const sorted = Object.entries(dimScores).sort((a, b) => b[1] - a[1]);
  const strengths = [];
  const weaknesses = [];
  if (sorted.length > 0) {
    strengths.push(sorted[0][0]);
    weaknesses.push(sorted[sorted.length - 1][0]);
    if (sorted.length > 1) {
      strengths.push(sorted[1][0]);
      weaknesses.push(sorted[sorted.length - 2][0]);
    }
  }
  return { strengths, weaknesses };
}

function averageScores(dimScores) {
  const values = Object.values(dimScores || {});
  if (!values.length) return 0;
  return Math.floor(values.reduce((sum, item) => sum + Number(item || 0), 0) / values.length);
}

// 计算 YYYY-MM-DD 相差天数（later - earlier），解析失败返回 0
function daysBetween(earlier, later) {
  const parse = (value) => {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(value || '').trim());
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const first = parse(earlier);
  const second = parse(later);
  if (!first || !second) return 0;
  return Math.round((second.getTime() - first.getTime()) / 86400000);
}

function todayDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ====================================================================
// 1. 初始能力测评（AI 八维评分，失败降级为全 60 分基准画像）
// ====================================================================

async function assessInitialAbility(input = {}) {
  const sampleEssay = normalizeText(input.sampleEssay);
  const grade = normalizeText(input.grade, 20);
  const target = normalizeText(input.target, 40);
  const title = normalizeText(input.title, 80);
  const genre = normalizeText(input.genre, 20);
  const callModel = typeof input.callModel === 'function' ? input.callModel : null;

  let dimensionScores = {};
  let dimensionComments = {};
  let summary = '';
  let degraded = true;

  if (callModel) {
    try {
      const result = await callModel('长期能力初始测评', {
        grade,
        target,
        title,
        genre,
        sampleEssay
      }, OUTPUT_CONTRACTS.initialAssessment, { maxTokens: 1200 });
      dimensionScores = normalizeDimensionScores(result.dimensionScores);
      if (result.dimensionComments && typeof result.dimensionComments === 'object') {
        for (const dim of DIMENSIONS) {
          const comment = normalizeText(result.dimensionComments[dim], 120);
          if (comment) dimensionComments[dim] = comment;
        }
      }
      summary = normalizeText(result.summary, 300);
      degraded = false;
    } catch (error) {
      degraded = true;
    }
  }

  if (degraded) {
    // 降级：与 C++ 版一致，全部维度按 60 分基准生成画像
    for (const dim of DIMENSIONS) dimensionScores[dim] = 60;
    dimensionComments = {};
    summary = '模型暂时不可用，已按基准分数生成初始画像，建议稍后重新测评。';
  }

  const avg = averageScores(dimensionScores);
  const stage = stageForAverage(avg);
  const { strengths, weaknesses } = deriveStrengthsAndWeaknesses(dimensionScores);
  const currentFocus = weaknesses.length ? weaknesses[0] : '全面发展';

  return {
    stage,
    dimensionScores,
    dimensionComments,
    summary,
    averageScore: avg,
    strengths,
    weaknesses,
    currentFocus,
    firstTrainingFocus: currentFocus,
    degraded
  };
}

// ====================================================================
// 2. 复盘回流：根据单篇作文复盘证据更新画像（本地规则，无 AI）
// ====================================================================

function updateProfileFromReflection(input = {}) {
  const profile = (input.profile && typeof input.profile === 'object')
    ? input.profile
    : null;
  const dimensionEvidence = (input.dimensionEvidence && typeof input.dimensionEvidence === 'object')
    ? input.dimensionEvidence
    : {};

  // 没有历史画像时，按基准 60 分初始化（沿用 C++ 版规则）
  let dimensionScores;
  let stage;
  if (profile && profile.dimensionScores && Object.keys(profile.dimensionScores).length) {
    dimensionScores = { ...profile.dimensionScores };
    stage = profile.stage || '基础期';
  } else {
    dimensionScores = {};
    for (const dim of DIMENSIONS) dimensionScores[dim] = 60;
    stage = '基础期';
  }

  // 证据文字含"好/进步" +5，含"差/不足" -5，其余 0（沿用 C++ 版规则）
  const changedDimensions = [];
  for (const [dim, evidence] of Object.entries(dimensionEvidence)) {
    if (!DIMENSIONS.includes(dim)) continue;
    const text = String(evidence || '');
    let delta = 0;
    if (/好|进步/.test(text)) delta = 5;
    else if (/差|不足/.test(text)) delta = -5;
    if (delta === 0) continue;
    dimensionScores[dim] = Math.min(100, Math.max(0, clampScore(dimensionScores[dim]) + delta));
    changedDimensions.push(dim);
  }

  const avg = averageScores(dimensionScores);
  const newStage = stageForAverage(avg);
  const { strengths, weaknesses } = deriveStrengthsAndWeaknesses(dimensionScores);
  const currentFocus = weaknesses.length ? weaknesses[0] : '全面发展';

  const updatedProfile = {
    ...(profile || {}),
    stage: newStage,
    stageChanged: newStage !== stage,
    dimensionScores,
    strengths,
    weaknesses,
    currentFocus
  };

  return {
    updatedProfile,
    changedDimensions,
    nextSuggestedFocus: currentFocus
  };
}

// ====================================================================
// 3. 训练计划：按计划类型生成每日任务序列（本地规则，无 AI）
// ====================================================================

const PLAN_TOTAL_DAYS = { '7d': 7, '14d': 14, '30d': 30, examSprint: 10 };
const PLAN_TASK_TYPES = ['素材卡', '审题', '提纲', '段落', '完整作文', '修改复盘'];

function buildTrainingPlanTasks(input = {}) {
  const planType = PLAN_TOTAL_DAYS[input.planType] ? input.planType : '7d';
  const dailyMinutes = Math.min(120, Math.max(5, Number(input.dailyMinutes) || 15));
  const focusDimensions = (Array.isArray(input.focusDimensions) ? input.focusDimensions : [])
    .map((item) => String(item || '').trim())
    .filter((item) => DIMENSIONS.includes(item));

  const totalDays = PLAN_TOTAL_DAYS[planType];
  const tasks = [];

  for (let day = 1; day <= totalDays; day += 1) {
    const taskType = PLAN_TASK_TYPES[(day - 1) % PLAN_TASK_TYPES.length];
    const relatedDimension = focusDimensions.length
      ? focusDimensions[(day - 1) % focusDimensions.length]
      : DIMENSIONS[(day - 1) % DIMENSIONS.length];
    tasks.push({
      day,
      taskId: '',
      taskType,
      title: `第${day}天：${taskType}训练`,
      instruction: `请完成${taskType}练习，重点提升${relatedDimension}。预计用时${dailyMinutes}分钟。`,
      expectedMinutes: dailyMinutes,
      relatedDimension,
      status: '未开始'
    });
  }

  return { planType, totalDays, dailyMinutes, focusDimensions, tasks };
}

// 按开始日期推算今天的任务（沿用 C++ 版：一天一个任务，超出范围返回空）
function todayTasksFromPlan(plan) {
  if (!plan || !Array.isArray(plan.days) || !plan.days.length) {
    return { tasks: [], estimatedMinutes: 0, focus: null, dayIndex: -1 };
  }
  let dayIndex = daysBetween(plan.startDate, todayDate());
  if (dayIndex < 0) dayIndex = 0;
  if (dayIndex >= plan.days.length) {
    return { tasks: [], estimatedMinutes: 0, focus: null, dayIndex };
  }
  const tasks = [plan.days[dayIndex]];
  return {
    tasks,
    estimatedMinutes: tasks.reduce((sum, task) => sum + (Number(task.expectedMinutes) || 0), 0),
    focus: tasks[0] ? tasks[0].relatedDimension : null,
    dayIndex
  };
}

// ====================================================================
// 4. 任务提交反馈（AI 点评，失败降级为本地字数启发式）
// ====================================================================

function localTaskFeedback(task, content) {
  const length = countCjk(content);
  if (length >= 40) {
    return {
      feedback: '内容已有基本展开，下一步补一个可看见的动作或一句真实对话会更具体。',
      score: 72,
      improvedVersionHint: '保留已有事实，只补一个可看见的细节。',
      relatedIssues: [],
      profileUpdateSuggestion: true
    };
  }
  return {
    feedback: '内容偏短，建议先补清楚人物、地点和动作，再谈感受。',
    score: 55,
    improvedVersionHint: '先回答"当时谁在哪里做了什么"。',
    relatedIssues: ['素材具体度不足'],
    profileUpdateSuggestion: false
  };
}

async function reviewTaskSubmission(input = {}) {
  const task = input.task || {};
  const content = normalizeText(input.content);
  const callModel = typeof input.callModel === 'function' ? input.callModel : null;

  let feedback = null;
  let degraded = true;

  if (callModel && content) {
    try {
      const result = await callModel('训练任务反馈', {
        taskType: task.taskType || '',
        taskTitle: task.title || '',
        instruction: task.instruction || '',
        relatedDimension: task.relatedDimension || '',
        content
      }, OUTPUT_CONTRACTS.taskFeedback, { maxTokens: 900 });
      feedback = {
        feedback: normalizeText(result.feedback, 400) || '任务已提交，请继续加油。',
        score: clampScore(result.score),
        improvedVersionHint: normalizeText(result.improvedVersionHint, 200),
        relatedIssues: (Array.isArray(result.relatedIssues) ? result.relatedIssues : [])
          .map((item) => normalizeText(item, 40)).filter(Boolean).slice(0, 5),
        profileUpdateSuggestion: result.profileUpdateSuggestion !== false
      };
      degraded = false;
    } catch (error) {
      degraded = true;
    }
  }

  if (!feedback) feedback = localTaskFeedback(task, content);

  return { ...feedback, degraded };
}

// ====================================================================
// 5. 阶段复盘（AI 总结，失败降级为本地计划统计；附计划状态变更建议）
// ====================================================================

function localStageReview(plan, profile) {
  const tasks = Array.isArray(plan.days) ? plan.days : [];
  const completed = tasks.filter((task) => task.status === '已完成').length;
  const focus = Array.isArray(profile && profile.weaknesses) && profile.weaknesses.length
    ? profile.weaknesses[0]
    : '素材具体度';
  return {
    reviewSummary: `本阶段完成 ${completed}/${tasks.length} 个训练任务。` +
      (completed >= tasks.length / 2 ? '整体坚持得不错，' : '完成率偏低，建议降低每日用时、先保证完成，') +
      `下一阶段建议继续围绕${focus}训练。`,
    improvedDimensions: [],
    persistentIssues: (profile && Array.isArray(profile.weaknesses)) ? profile.weaknesses.slice(0, 3) : [],
    nextPlanSuggestion: `建议下一阶段重点训练${focus}，保持每日短时练习。`,
    adjustCurrentPlan: completed < tasks.length / 2
  };
}

async function runStageReview(input = {}) {
  const plan = input.plan || null;
  if (!plan) {
    return { error: 'PLAN_NOT_FOUND' };
  }
  const profile = input.profile || null;
  const submissions = Array.isArray(input.submissions) ? input.submissions : [];
  const callModel = typeof input.callModel === 'function' ? input.callModel : null;

  let review = null;
  let degraded = true;

  if (callModel) {
    try {
      const tasks = Array.isArray(plan.days) ? plan.days : [];
      const result = await callModel('训练计划阶段复盘', {
        planType: plan.planType || '',
        goal: plan.goal || '',
        focusDimensions: plan.focusDimensions || [],
        taskSummary: tasks.map((task) => ({
          title: task.title,
          taskType: task.taskType,
          relatedDimension: task.relatedDimension,
          status: task.status
        })),
        submissionCount: submissions.length,
        submissionSamples: submissions.slice(-5).map((item) => ({
          taskId: item.taskId,
          content: normalizeText(item.content, 200)
        })),
        abilityProfile: profile
          ? { stage: profile.stage, strengths: profile.strengths, weaknesses: profile.weaknesses }
          : null
      }, OUTPUT_CONTRACTS.stageReview, { maxTokens: 1200 });
      review = {
        reviewSummary: normalizeText(result.reviewSummary, 400),
        improvedDimensions: (Array.isArray(result.improvedDimensions) ? result.improvedDimensions : [])
          .map((item) => normalizeText(item, 20)).filter(Boolean).slice(0, 8),
        persistentIssues: (Array.isArray(result.persistentIssues) ? result.persistentIssues : [])
          .map((item) => normalizeText(item, 40)).filter(Boolean).slice(0, 8),
        nextPlanSuggestion: normalizeText(result.nextPlanSuggestion, 300),
        adjustCurrentPlan: Boolean(result.adjustCurrentPlan)
      };
      degraded = false;
    } catch (error) {
      degraded = true;
    }
  }

  if (!review) review = localStageReview(plan, profile);

  // 全部任务完成时建议把计划标记为已完成（沿用 C++ 版规则）
  const tasks = Array.isArray(plan.days) ? plan.days : [];
  const allDone = tasks.length > 0 && tasks.every((task) => task.status === '已完成');
  if (allDone) review.planStatusUpdate = '已完成';

  return { ...review, degraded };
}

// ====================================================================
// 6. 错因库统计
// ====================================================================

// 高频错因：出现次数（occurrenceCount 累加）大于 1 的错因类型，按频次倒序
function topRecurringIssues(items) {
  const frequency = {};
  for (const item of (Array.isArray(items) ? items : [])) {
    if (!item || !item.issueType) continue;
    const count = Number(item.occurrenceCount) || 1;
    frequency[item.issueType] = (frequency[item.issueType] || 0) + count;
  }
  return Object.entries(frequency)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

// 同类同来源的错因自动累加次数（沿用 C++ 版规则），返回新数组不修改原数组
function mergeErrorNotebookItem(items, item) {
  const list = Array.isArray(items) ? items.slice() : [];
  for (const existing of list) {
    if (existing.issueType === item.issueType && existing.source === item.source) {
      existing.occurrenceCount = (Number(existing.occurrenceCount) || 1) + 1;
      if (item.evidence) existing.evidence = item.evidence;
      if (item.suggestion) existing.suggestion = item.suggestion;
      return list;
    }
  }
  list.push({ ...item, occurrenceCount: 1 });
  return list;
}

// ====================================================================
// 7. 成长轨迹（从 state 集合聚合，不再返回空数组占位）
// ====================================================================

function buildGrowthTimeline(input = {}) {
  const state = input.state || {};
  const userId = String(input.userId || '').trim();

  const profiles = (state.abilityProfiles || []).filter((item) => !userId || item.userId === userId);
  const plans = (state.trainingPlans || []).filter((item) => !userId || item.userId === userId);
  const submissions = (state.trainingTaskSubmissions || []).filter((item) => !userId || item.userId === userId);
  const errorItems = (state.errorNotebookItems || []).filter((item) => !userId || item.userId === userId);
  const essaySessions = (state.essaySessions || []).filter((item) => !userId || item.userId === userId);

  const timeline = [];

  const profile = profiles[profiles.length - 1] || null;
  if (profile) {
    timeline.push({
      date: profile.updatedAt || profile.createdAt || '',
      event: '完成能力测评',
      details: `当前阶段：${profile.stage || '未知'}`
    });
  }

  for (const plan of plans) {
    timeline.push({
      date: plan.createdAt || '',
      event: '开始训练计划',
      details: `${plan.planType || ''}计划，目标：${plan.goal || '综合提升'}`
    });
    if (plan.status === '已完成') {
      timeline.push({ date: plan.updatedAt || plan.createdAt || '', event: '完成训练计划', details: plan.goal || '' });
    }
  }

  for (const submission of submissions.slice(-10)) {
    timeline.push({
      date: submission.createdAt || '',
      event: '完成训练任务',
      details: `任务 ${submission.taskId || ''}`
    });
  }

  timeline.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  const abilityChanges = [];
  if (profile && profile.dimensionScores) {
    abilityChanges.push({
      date: profile.updatedAt || '',
      details: Object.entries(profile.dimensionScores)
        .map(([dim, score]) => `${dim} ${score}`)
        .join('，')
    });
  }

  const completedPlans = plans.filter((plan) => plan.status === '已完成').map((plan) => plan.planId || plan.id);

  // 徽章：按可验证的数据触发
  const badges = [];
  if (profile) badges.push('初识写作');
  if (completedPlans.length >= 1) badges.push('坚持训练');
  if (submissions.length >= 10) badges.push('练习达人');
  if (errorItems.length >= 5) badges.push('错题终结者');

  return {
    timeline,
    abilityChanges,
    completedPlans,
    essayMilestones: essaySessions.slice(-5).map((item) => ({
      sessionId: item.id || item.sessionId || '',
      title: item.title || '',
      updatedAt: item.updatedAt || ''
    })),
    badges
  };
}

// ====================================================================
// 导出
// ====================================================================

module.exports = {
  DIMENSIONS,
  OUTPUT_CONTRACTS,
  stageForAverage,
  assessInitialAbility,
  updateProfileFromReflection,
  buildTrainingPlanTasks,
  todayTasksFromPlan,
  reviewTaskSubmission,
  runStageReview,
  topRecurringIssues,
  mergeErrorNotebookItem,
  buildGrowthTimeline
};
