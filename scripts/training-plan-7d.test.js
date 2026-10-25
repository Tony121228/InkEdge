const http = require('http');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runSevenDayTrainingTask } = require('../lib/seven-day-training-runner');

function listen(app){
  return new Promise((resolve)=>{ const srv = app.listen(0,'127.0.0.1',()=> resolve(srv)); });
}
let cookie = '';
function req(base, method, path, body){
  return new Promise((resolve, reject)=>{
    const url = new URL(path, base);
    const payload = body ? JSON.stringify(body) : '';
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname+url.search, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }};
    const r = http.request(opts, (res)=>{ let t=''; res.setEncoding('utf8'); res.on('data',c=>t+=c); res.on('end',()=>{
      try{ if (res.headers['set-cookie']) cookie = res.headers['set-cookie'].map((item) => item.split(';')[0]).join('; '); resolve({ status: res.statusCode, json: t?JSON.parse(t):null }); } catch(e){ reject(e); }
    }); });
    r.on('error', reject); if(payload) r.end(payload); else r.end();
  });
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'training-plan-7d-'));
  process.env.APP_DATA_DIR = tempDir;
  process.env.AI_API_KEY = '';
  const app = require('../server');
  const srv = await listen(app);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const unsupported = await req(base, 'POST', '/api/v1/training-plans', { planType: '14d', dailyMinutes: 10 });
    assert.strictEqual(unsupported.status, 400, 'unsupported historical plan type should be rejected');
    assert.strictEqual(unsupported.json.error.code, 'TRAINING_PLAN_TYPE_UNSUPPORTED', 'unsupported plan type should use a stable error code');

    const first = await req(base, 'POST', '/api/v1/training-plans', { planType: '7d', dailyMinutes: 10, focusDimensions: ['审题能力'] });
    assert.strictEqual(first.status, 200, 'first plan create status');

    const create = await req(base, 'POST', '/api/v1/training-plans', {
      planType: '7d',
      dailyMinutes: 20,
      title: '那一刻，我长大了',
      grade: '初二',
      genre: '记叙文',
      initialMaterial: '我第一次独自上台演讲。',
      goal: '完成一篇记叙文',
      focusDimensions: ['素材具体度','语言自然度']
    });
    assert.strictEqual(create.status, 200, 'second plan create status');
    const plan = create.json.data;
    assert.ok(plan && plan.days && plan.days.length===7, '7 days present');
    assert.deepStrictEqual(plan.focusDimensions, ['细节能力', '语言能力'], 'short-term dimension aliases should map to long-term dimensions');
    assert.strictEqual(plan.days[0].relatedDimension, '细节能力', 'first day should use requested focus dimension');
    assert.deepStrictEqual(plan.days.map((day) => day.stageId), [
      'topic_angle',
      'material_questions',
      'outline_tree',
      'paragraph_guides',
      'paragraph_drafting',
      'draft_diagnosis',
      'revision_reflection'
    ], '7-day plan should expose fixed writing stages');
    assert.ok(plan.days[0].inputSchema.fields.some((field) => field.name === 'title'), 'first day should collect title input');
    assert.ok(plan.days[3].expectedOutput.includes('段落写作提示'), 'fourth day should produce paragraph prompts');
    assert.strictEqual(plan.context.title, '那一刻，我长大了', 'plan should persist writing title');
    assert.strictEqual(plan.context.grade, '初二', 'plan should persist grade');
    assert.strictEqual(plan.context.genre, '记叙文', 'plan should persist genre');
    assert.strictEqual(plan.context.initialMaterial, '我第一次独自上台演讲。', 'plan should persist initial material');
    assert.strictEqual(plan.context.goal, '完成一篇记叙文', 'plan should persist goal');
    assert.strictEqual(plan.days[0].inputSnapshot.title, '那一刻，我长大了', 'first day should include title snapshot');
    assert.deepStrictEqual(plan.artifacts, {}, 'new plan should start with empty artifacts');
    assert.strictEqual(plan.progress.currentStageId, 'topic_angle', 'new plan should start at first stage');
    assert.deepStrictEqual(plan.progress.completedStageIds, [], 'new plan should start with no completed stages');

    const active = await req(base, 'GET', '/api/v1/training-plans/active');
    assert.strictEqual(active.status, 200, 'active plan status');
    const a = active.json.data; assert.ok(a && a.id===plan.id && Array.isArray(a.days), 'active plan matches');

    const today = await req(base, 'GET', '/api/v1/training-tasks/today');
    assert.strictEqual(today.status, 200, 'today tasks status');
    const tasks = today.json.data.tasks || [];
    assert.ok(tasks.length >= 1, 'today tasks present');
    assert.strictEqual(tasks[0].taskId, plan.days[0].taskId, 'today task should come from active plan');
    assert.strictEqual(today.json.data.planId, plan.id, 'today tasks should expose active plan id');

    const outOfOrderTask = plan.days.find((day) => day.stageId === 'outline_tree');
    const outOfOrder = await req(base, 'POST', `/api/v1/training-plans/${plan.id}/tasks/${outOfOrderTask.taskId}/run`, {
      input: { materialAnswers: [] }
    });
    assert.strictEqual(outOfOrder.status, 409, 'future training stages should not run before previous stages complete');

    const stageInputs = {
      topic_angle: { title: '那一刻，我长大了', grade: '初二', genre: '记叙文', initialMaterial: '我第一次独自上台演讲。' },
      material_questions: {
        selectedAngle: '一次真实变化',
        initialMaterial: '我第一次独自上台演讲。',
        answers: [{ question: '什么时候？', answer: '周一班会课。' }]
      },
      outline_tree: { materialAnswers: [{ question: '什么时候？', answer: '周一班会课。' }] },
      paragraph_guides: { confirmedOutline: { title: '那一刻，我长大了' } },
      paragraph_drafting: {
        paragraphDrafts: [
          { paragraphId: 'p1', text: '班会课上，我握着稿纸走上讲台。' },
          { paragraphId: 'p2', text: '我的手一直在抖，但我还是开始讲。' }
        ]
      },
      draft_diagnosis: { mergedDraft: '班会课上，我握着稿纸走上讲台。\n\n我的手一直在抖，但我还是开始讲。' },
      revision_reflection: {
        revisedText: '班会课上，我握着稿纸走上讲台。我的手一直在抖，但我还是把稿子讲完了。',
        studentSelfReflection: '我学会了写动作细节。'
      }
    };
    const artifactChecks = {
      topic_angle: (artifact) => Array.isArray(artifact.possibleAngles)
        && artifact.possibleAngles.length >= 3
        && artifact.possibleAngles.every((angle) => angle.whyThisFitsTopic && angle.materialConnection && angle.writingPath && Array.isArray(angle.keyDetailsToAsk)),
      material_questions: (artifact) => Array.isArray(artifact.questions) && artifact.questions.length >= 1,
      outline_tree: (artifact) => artifact.outlineTree
        && Array.isArray(artifact.outlineTree.children)
        && artifact.outlineTree.children.every((node) => node.writeTask && Array.isArray(node.writingObjects) && Array.isArray(node.detailPlan) && Array.isArray(node.eventBeats) && Array.isArray(node.studentChecklist)),
      paragraph_guides: (artifact) => Array.isArray(artifact.paragraphGuides)
        && artifact.paragraphGuides.length >= 1
        && artifact.paragraphGuides.every((guide) => Array.isArray(guide.writingTargets) && Array.isArray(guide.howToWrite) && Array.isArray(guide.detailsToInclude) && Array.isArray(guide.developmentSteps) && Array.isArray(guide.selfCheck)),
      paragraph_drafting: (artifact) => typeof artifact.mergedDraft === 'string' && Array.isArray(artifact.paragraphFeedback),
      draft_diagnosis: (artifact) => Array.isArray(artifact.priorityIssues) && artifact.priorityIssues.length >= 1,
      revision_reflection: (artifact) => Array.isArray(artifact.learnedSkills) && Array.isArray(artifact.suggestedTrainingFocus)
    };

    for (const [index, day] of plan.days.entries()) {
      const run = await req(base, 'POST', `/api/v1/training-plans/${plan.id}/tasks/${day.taskId}/run`, {
        input: stageInputs[day.stageId]
      });
      assert.strictEqual(run.status, 200, `${day.stageId} run status`);
      assert.strictEqual(run.json.data.taskId, day.taskId, `${day.stageId} result should expose task id`);
      assert.strictEqual(run.json.data.stageId, day.stageId, `${day.stageId} result should expose stage id`);
      assert.ok(run.json.data.artifact, `${day.stageId} result should include artifact`);
      assert.ok(artifactChecks[day.stageId](run.json.data.artifact), `${day.stageId} should return frontend-renderable artifact`);
      assert.strictEqual(run.json.data.artifact.localFallback, true, `${day.stageId} should use local fallback without model key`);
      assert.strictEqual(run.json.data.nextStageId, plan.days[index + 1]?.stageId || '', `${day.stageId} should advance to the next stage`);
      assert.ok(run.json.data.planProgress, `${day.stageId} should return updated plan progress`);
      assert.ok(run.json.data.planStatus, `${day.stageId} should return updated plan status`);
    }

    const completedPlan = await req(base, 'GET', `/api/v1/training-plans/${plan.id}`);
    assert.strictEqual(completedPlan.status, 200, 'completed plan read status');
    assert.deepStrictEqual(completedPlan.json.data.progress.completedStageIds, plan.days.map((day) => day.stageId), 'all stages should be marked completed');
    assert.strictEqual(completedPlan.json.data.progress.currentStageId, '', 'completed plan should clear current stage');
    assert.strictEqual(completedPlan.json.data.status, '已完成', 'plan should be completed after the final stage');
    assert.ok(completedPlan.json.data.completedAt, 'completed plan should record completedAt');
    assert.strictEqual(completedPlan.json.data.stageInputs.topic_angle.title, '那一刻，我长大了', 'stage input should be persisted');
    assert.strictEqual(completedPlan.json.data.stageInputs.revision_reflection.studentSelfReflection, '我学会了写动作细节。', 'final reflection input should be persisted');

    const sparseModelDiagnosis = await runSevenDayTrainingTask({
      plan,
      task: plan.days.find((day) => day.stageId === 'draft_diagnosis'),
      input: { mergedDraft: '班会课上，我握着稿纸走上讲台。我的手一直在抖，但我还是讲完了。' },
      callModel: async () => ({ overallComment: '模型只返回了一句点评。' }),
      outputContracts: {}
    });
    assert.strictEqual(sparseModelDiagnosis.artifact.localFallback, false, 'sparse model response should still be treated as model output');
    assert.ok(Array.isArray(sparseModelDiagnosis.artifact.priorityIssues), 'sparse model diagnosis should be normalized with priority issues');
    assert.ok(sparseModelDiagnosis.artifact.priorityIssues.length >= 1, 'normalized diagnosis should include at least one priority issue');

    const failedModelOutline = await runSevenDayTrainingTask({
      plan,
      task: plan.days.find((day) => day.stageId === 'outline_tree'),
      input: { materialAnswers: [{ question: '什么时候？', answer: '周一班会课。' }] },
      callModel: async () => {
        const error = new Error('model returned invalid json');
        error.failureCode = 'MODEL_JSON_PARSE';
        throw error;
      },
      outputContracts: {}
    });
    assert.strictEqual(failedModelOutline.artifact.localFallback, true, 'failed model response should use local fallback');
    assert.strictEqual(failedModelOutline.artifact.modelFallbackReasonCode, 'MODEL_JSON_PARSE', 'fallback artifact should expose a safe reason code');
    assert.ok(failedModelOutline.artifact.outlineTree.children[0].writeTask, 'fallback outline should include detailed write task');
    assert.ok(Array.isArray(failedModelOutline.artifact.outlineTree.children[0].detailPlan), 'fallback outline should include detail plan');

    const looseParagraphGuides = await runSevenDayTrainingTask({
      plan,
      task: plan.days.find((day) => day.stageId === 'paragraph_guides'),
      input: { outlineTree: { title: '那一刻，我长大了', children: [] } },
      callModel: async () => ({
        paragraphGuides: [
          {
            paragraphId: 'p1',
            role: '开头',
            goal: '进入场景',
            writingTargets: '时间地点和出场人物',
            howToWrite: '先写地点，再写人物动作',
            detailsToInclude: '讲台、稿纸、同学目光',
            developmentSteps: '场景到动作再到心情',
            sensoryDetails: '教室安静',
            innerThoughtPrompts: '你当时为什么害怕？',
            mustInclude: '时间和地点',
            writingPrompts: '当时你站在哪里？',
            avoid: '不要讲大道理',
            selfCheck: '有没有具体画面？',
            suggestedLength: '80-120字'
          }
        ]
      }),
      outputContracts: {}
    });
    assert.strictEqual(looseParagraphGuides.artifact.localFallback, false, 'loose model guide should still be treated as model output');
    assert.ok(Array.isArray(looseParagraphGuides.artifact.paragraphGuides[0].mustInclude), 'mustInclude should be normalized to an array');
    assert.ok(Array.isArray(looseParagraphGuides.artifact.paragraphGuides[0].writingPrompts), 'writingPrompts should be normalized to an array');
    assert.ok(Array.isArray(looseParagraphGuides.artifact.paragraphGuides[0].avoid), 'avoid should be normalized to an array');
    assert.ok(Array.isArray(looseParagraphGuides.artifact.paragraphGuides[0].writingTargets), 'writingTargets should be normalized to an array');
    assert.ok(Array.isArray(looseParagraphGuides.artifact.paragraphGuides[0].howToWrite), 'howToWrite should be normalized to an array');
    assert.ok(Array.isArray(looseParagraphGuides.artifact.paragraphGuides[0].detailsToInclude), 'detailsToInclude should be normalized to an array');
    assert.ok(Array.isArray(looseParagraphGuides.artifact.paragraphGuides[0].developmentSteps), 'developmentSteps should be normalized to an array');
    assert.ok(Array.isArray(looseParagraphGuides.artifact.paragraphGuides[0].selfCheck), 'selfCheck should be normalized to an array');

    const looseDiagnosis = await runSevenDayTrainingTask({
      plan,
      task: plan.days.find((day) => day.stageId === 'draft_diagnosis'),
      input: { mergedDraft: '班会课上，我主动承认了错误。' },
      callModel: async () => ({
        overallComment: '这篇作文有真实事件。',
        dimensionScores: [
          { dimension: '扣题', score: 82 },
          { dimension: '素材具体度', score: 76 },
          { dimension: '结构清晰度', score: 80 }
        ],
        priorityIssues: [
          { title: '细节不足', suggestion: '补一个动作。' }
        ],
        revisionTargets: '补动作细节'
      }),
      outputContracts: {}
    });
    assert.strictEqual(looseDiagnosis.artifact.localFallback, false, 'loose diagnosis should still be treated as model output');
    assert.strictEqual(typeof looseDiagnosis.artifact.dimensionScores, 'object', 'dimensionScores should be an object');
    assert.strictEqual(looseDiagnosis.artifact.dimensionScores.topicFit, 82, 'dimension score array should map topic score');
    assert.ok(Array.isArray(looseDiagnosis.artifact.revisionTargets), 'revisionTargets should be normalized to an array');

    console.log('OK training plan 7d, days=', plan.days.length);
  } finally {
    srv.close();
    const stateFile = path.join(tempDir, 'app-state.json');
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  }
})();
