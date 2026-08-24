'use strict';

/**
 * 长期能力提升模块（成员C）回归测试
 * 运行：node scripts/long-term-ability.test.js
 * 不依赖 server.js、不联网：AI 调用用假 callModel 模拟。
 */

const assert = require('assert');
const longTermAbility = require('../lib/long-term-ability');

function fakeCallModelFactory(responseByTask) {
  return async (taskName) => {
    if (taskName in responseByTask) return responseByTask[taskName];
    throw new Error('MODEL_UNAVAILABLE');
  };
}

(async () => {
  // 1. 初始测评：AI 正常返回
  const assessment = await longTermAbility.assessInitialAbility({
    callModel: fakeCallModelFactory({
      '长期能力初始测评': {
        dimensionScores: {
          审题能力: 88, 立意能力: 82, 选材能力: 61, 结构能力: 74,
          细节能力: 55, 语言能力: 68, 修改能力: 48, 考场表达能力: 90
        },
        dimensionComments: { 审题能力: '抓住题眼' },
        summary: '整体不错'
      }
    }),
    sampleEssay: '那是一个下雨天，我撑着伞走在回家的路上，看到一位老人摔倒了。',
    grade: '初一',
    target: '中考',
    title: '雨中情',
    genre: '记叙文'
  });
  assert.strictEqual(assessment.degraded, false);
  assert.strictEqual(assessment.stage, '提升期'); // 平均 70.75 -> floor 70 -> 提升期
  assert.strictEqual(assessment.strengths[0], '考场表达能力');
  assert.strictEqual(assessment.weaknesses[0], '修改能力');
  assert.strictEqual(assessment.currentFocus, '修改能力');
  assert.strictEqual(assessment.dimensionComments['审题能力'], '抓住题眼');
  assert.strictEqual(Object.keys(assessment.dimensionScores).length, 8);

  // 分数越界会被裁剪
  const clamped = await longTermAbility.assessInitialAbility({
    callModel: fakeCallModelFactory({
      '长期能力初始测评': { dimensionScores: { 审题能力: 150, 立意能力: -20 } }
    }),
    sampleEssay: 'x'
  });
  assert.strictEqual(clamped.dimensionScores['审题能力'], 100);
  assert.strictEqual(clamped.dimensionScores['立意能力'], 0);

  // 2. 初始测评：模型不可用降级为全 60
  const degraded = await longTermAbility.assessInitialAbility({
    callModel: fakeCallModelFactory({}),
    sampleEssay: 'x'
  });
  assert.strictEqual(degraded.degraded, true);
  assert.strictEqual(degraded.dimensionScores['细节能力'], 60);
  assert.strictEqual(degraded.stage, '进阶期');
  assert.ok(degraded.summary.includes('模型暂时不可用'));

  // 3. 无 callModel 时也应正常降级而不是抛错
  const noModel = await longTermAbility.assessInitialAbility({ sampleEssay: 'x' });
  assert.strictEqual(noModel.degraded, true);

  // 4. 复盘回流：+5/-5 与阶段重算
  const profile = {
    userId: 'student001',
    stage: '基础期',
    dimensionScores: {
      审题能力: 60, 立意能力: 60, 选材能力: 60, 结构能力: 60,
      细节能力: 60, 语言能力: 60, 修改能力: 60, 考场表达能力: 60
    }
  };
  const reflection = longTermAbility.updateProfileFromReflection({
    profile,
    dimensionEvidence: {
      细节能力: '有进步，动作描写更具体',
      修改能力: '仍显不足'
    }
  });
  assert.strictEqual(reflection.updatedProfile.dimensionScores['细节能力'], 65);
  assert.strictEqual(reflection.updatedProfile.dimensionScores['修改能力'], 55);
  assert.deepStrictEqual(reflection.changedDimensions.sort(), ['修改能力', '细节能力']);
  assert.strictEqual(reflection.updatedProfile.currentFocus, '修改能力');
  // 原画像对象不应被原地修改
  assert.strictEqual(profile.dimensionScores['细节能力'], 60);

  // 无历史画像时自动按 60 分基准初始化
  const fresh = longTermAbility.updateProfileFromReflection({
    dimensionEvidence: { 语言能力: '变好了' }
  });
  assert.strictEqual(fresh.updatedProfile.dimensionScores['语言能力'], 65);
  assert.ok(fresh.updatedProfile.dimensionScores['审题能力'] === 60);

  // 5. 训练计划任务生成
  const planTasks = longTermAbility.buildTrainingPlanTasks({
    planType: '7d',
    dailyMinutes: 15,
    focusDimensions: ['细节能力']
  });
  assert.strictEqual(planTasks.tasks.length, 7);
  assert.strictEqual(planTasks.tasks[0].taskType, '素材卡');
  assert.strictEqual(planTasks.tasks[0].relatedDimension, '细节能力');
  assert.strictEqual(planTasks.tasks[5].taskType, '修改复盘');
  assert.strictEqual(planTasks.tasks[6].taskType, '素材卡'); // 轮转回到第一天类型
  // 非法 planType 回退 7d；非法维度被过滤
  const fallbackPlan = longTermAbility.buildTrainingPlanTasks({ planType: '999d', focusDimensions: ['不存在的维度'] });
  assert.strictEqual(fallbackPlan.totalDays, 7);
  assert.strictEqual(fallbackPlan.tasks[0].relatedDimension, '审题能力');

  // 6. 今日任务：按开始日期取当天下标
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const yesterdayDate = new Date(today.getTime() - 86400000);
  const yesterdayStr = `${yesterdayDate.getFullYear()}-${pad(yesterdayDate.getMonth() + 1)}-${pad(yesterdayDate.getDate())}`;
  const plan = { startDate: yesterdayStr, days: planTasks.tasks };
  const todayResult = longTermAbility.todayTasksFromPlan(plan);
  assert.strictEqual(todayResult.dayIndex, 1);
  assert.strictEqual(todayResult.tasks[0].taskType, '审题');
  assert.strictEqual(todayResult.estimatedMinutes, 15);
  // 超出计划天数返回空
  const expired = longTermAbility.todayTasksFromPlan({ startDate: '2020-01-01', days: planTasks.tasks });
  assert.strictEqual(expired.tasks.length, 0);

  // 7. 任务反馈：AI 正常
  const feedback = await longTermAbility.reviewTaskSubmission({
    callModel: fakeCallModelFactory({
      训练任务反馈: {
        feedback: '动作描写具体，继续保持。',
        score: 82,
        improvedVersionHint: '补一句真实对话。',
        relatedIssues: ['对话缺失'],
        profileUpdateSuggestion: true
      }
    }),
    task: { taskType: '素材卡', title: '第1天：素材卡训练' },
    content: '今天放学路上看到一只小猫被困在花坛里，我蹲下来看了很久，最后把它抱了出来。'
  });
  assert.strictEqual(feedback.degraded, false);
  assert.strictEqual(feedback.score, 82);
  assert.deepStrictEqual(feedback.relatedIssues, ['对话缺失']);

  // 8. 任务反馈：降级为本地字数启发式
  const shortFeedback = await longTermAbility.reviewTaskSubmission({
    callModel: fakeCallModelFactory({}),
    task: { taskType: '素材卡' },
    content: '我很难过。'
  });
  assert.strictEqual(shortFeedback.degraded, true);
  assert.strictEqual(shortFeedback.score, 55);
  assert.ok(shortFeedback.relatedIssues.includes('素材具体度不足'));
  const longFeedback = await longTermAbility.reviewTaskSubmission({
    callModel: fakeCallModelFactory({}),
    task: { taskType: '素材卡' },
    content: '今天放学路上看到一只小猫被困在花坛里，我蹲下来看了很久，最后把它抱了出来，它的毛湿透了，一直在发抖。'
  });
  assert.strictEqual(longFeedback.score, 72);

  // 9. 阶段复盘：AI 正常 + 全部完成时建议更新计划状态
  const allDonePlan = {
    planType: '7d',
    goal: '中考备考',
    focusDimensions: ['细节能力'],
    days: planTasks.tasks.map((task) => ({ ...task, status: '已完成' }))
  };
  const review = await longTermAbility.runStageReview({
    callModel: fakeCallModelFactory({
      训练计划阶段复盘: {
        reviewSummary: '细节能力明显进步。',
        improvedDimensions: ['细节能力'],
        persistentIssues: ['结尾喊口号'],
        nextPlanSuggestion: '下一阶段练语言自然度。',
        adjustCurrentPlan: false
      }
    }),
    plan: allDonePlan,
    profile: { stage: '进阶期', strengths: ['审题能力'], weaknesses: ['修改能力'] },
    submissions: [{ taskId: 't1', content: 'x' }]
  });
  assert.strictEqual(review.degraded, false);
  assert.deepStrictEqual(review.improvedDimensions, ['细节能力']);
  assert.strictEqual(review.planStatusUpdate, '已完成');

  // 10. 阶段复盘：降级 + 计划不存在
  const localReview = await longTermAbility.runStageReview({
    callModel: fakeCallModelFactory({}),
    plan: { planType: '7d', goal: '', days: planTasks.tasks },
    profile: { weaknesses: ['细节能力'] }
  });
  assert.strictEqual(localReview.degraded, true);
  assert.ok(localReview.reviewSummary.includes('0/7'));
  assert.strictEqual(localReview.adjustCurrentPlan, true);
  const noPlan = await longTermAbility.runStageReview({ plan: null });
  assert.strictEqual(noPlan.error, 'PLAN_NOT_FOUND');

  // 11. 错因库：同类累加 + 高频统计
  let items = [];
  items = longTermAbility.mergeErrorNotebookItem(items, { issueType: '素材不够具体', source: '作文诊断', evidence: 'a' });
  items = longTermAbility.mergeErrorNotebookItem(items, { issueType: '素材不够具体', source: '作文诊断', evidence: 'b' });
  items = longTermAbility.mergeErrorNotebookItem(items, { issueType: '结尾喊口号', source: '作文诊断' });
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].occurrenceCount, 2);
  assert.strictEqual(items[0].evidence, 'b');
  assert.deepStrictEqual(longTermAbility.topRecurringIssues(items), ['素材不够具体']);

  // 12. 成长轨迹：从 state 聚合出真实数据
  const timeline = longTermAbility.buildGrowthTimeline({
    userId: 'student001',
    state: {
      abilityProfiles: [{ userId: 'student001', stage: '进阶期', updatedAt: '2026-08-23 10:00:00', dimensionScores: { 审题能力: 70 } }],
      trainingPlans: [{ userId: 'student001', planType: '7d', goal: '中考备考', status: '已完成', createdAt: '2026-08-20 09:00:00', planId: 'p1' }],
      trainingTaskSubmissions: [{ userId: 'student001', taskId: 't1', createdAt: '2026-08-22 20:00:00' }],
      errorNotebookItems: [{ userId: 'student001', issueType: 'a' }, { userId: 'student001', issueType: 'b' }, { userId: 'student001', issueType: 'c' }, { userId: 'student001', issueType: 'd' }, { userId: 'student001', issueType: 'e' }],
      essaySessions: [{ userId: 'student001', id: 's1', title: '雨中情', updatedAt: '2026-08-23 11:00:00' }]
    }
  });
  assert.ok(timeline.timeline.some((item) => item.event === '完成能力测评'));
  assert.ok(timeline.timeline.some((item) => item.event === '完成训练计划'));
  assert.ok(timeline.timeline.some((item) => item.event === '完成训练任务'));
  assert.deepStrictEqual(timeline.completedPlans, ['p1']);
  assert.ok(timeline.abilityChanges.length === 1);
  assert.ok(timeline.essayMilestones[0].title === '雨中情');
  assert.ok(timeline.badges.includes('初识写作'));
  assert.ok(timeline.badges.includes('坚持训练'));
  assert.ok(timeline.badges.includes('错题终结者'));
  // 时间线按时间正序
  const dates = timeline.timeline.map((item) => item.date);
  const sorted = dates.slice().sort((a, b) => String(a).localeCompare(String(b)));
  assert.deepStrictEqual(dates, sorted);

  console.log('scripts/long-term-ability.test.js: 全部断言通过');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
