const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const targetStageId = process.env.TRAINING_STAGE_ID || 'paragraph_guides';
const stageOrder = [
  'topic_angle',
  'material_questions',
  'outline_tree',
  'paragraph_guides',
  'paragraph_drafting',
  'draft_diagnosis',
  'revision_reflection'
];
const aiStages = new Set(['topic_angle', 'material_questions', 'outline_tree', 'paragraph_guides', 'draft_diagnosis', 'revision_reflection']);

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(base, method, route, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, base);
    const payload = body == null ? '' : JSON.stringify(body);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'content-type': 'application/json' }
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

function stageInput(stageId) {
  const outlineTree = {
    title: '那一次，我学会了面对',
    theme: '害怕时仍然承担责任',
    children: [
      { nodeId: 'p1', role: '开头', label: '班会课展示失败后被老师点到', focus: '投影屏、安静的教室、手心出汗', children: [] },
      { nodeId: 'p2', role: '经过', label: '想逃避但意识到自己也有责任', focus: '低头、稿纸、同学目光', children: [] },
      { nodeId: 'p3', role: '转折', label: '主动说明错误并提出补救', focus: '承认没核对数据，说出补救办法', children: [] },
      { nodeId: 'p4', role: '结尾', label: '理解面对的含义', focus: '害怕仍然向前一步', children: [] }
    ]
  };
  const draftText = [
    '班会课上，小组展示刚结束，投影屏还停在那张算错的数据表上。教室里很安静，我听见自己的椅子轻轻碰了一下桌脚，手心已经出汗。',
    '老师问谁愿意说明情况时，我先低下头，差点把责任推给负责整理资料的同学。可是我知道，最后检查的人其实是我。',
    '我站到讲台旁，把手背到身后又松开，声音发紧地说：“这次是我没有提前核对数据，我们会重新整理。”说完第一句后，我终于敢抬头看大家。',
    '下课后，同学没有责怪我，反而一起留下来修改展示稿。我走出教室时心还跳得很快，但那一次我明白了，面对不是不害怕，而是不把害怕当成逃走的理由。'
  ].join('\n\n');
  if (stageId === 'topic_angle') {
    return { title: '那一次，我学会了面对', grade: '初二', genre: '记叙文', initialMaterial: '我在班会课上第一次主动承认小组展示失败里自己的责任。' };
  }
  if (stageId === 'material_questions') {
    return { selectedAngle: '承担责任的成长', initialMaterial: '我在班会课上第一次主动承认小组展示失败里自己的责任。', answers: [] };
  }
  if (stageId === 'outline_tree') {
    return {
      title: '那一次，我学会了面对',
      grade: '初二',
      genre: '记叙文',
      selectedAngle: '承担责任的成长',
      initialMaterial: '我在班会课上第一次主动承认小组展示失败里自己的责任。',
      materialAnswers: [
        { question: '什么时候？', answer: '周五下午班会课。' },
        { question: '在哪里？', answer: '教室讲台旁，投影屏还显示错误数据。' },
        { question: '你做了什么？', answer: '我主动承认没核对数据，并提出补救。' }
      ]
    };
  }
  if (stageId === 'paragraph_guides') return { outlineTree };
  if (stageId === 'draft_diagnosis') return { mergedDraft: draftText };
  if (stageId === 'revision_reflection') {
    return {
      revisedText: draftText,
      studentSelfReflection: '我学会了先写现场动作，再写自己心里的变化。'
    };
  }
  return {};
}

function assertArtifactShape(stageId, artifact) {
  if (stageId === 'topic_angle') assert.ok(Array.isArray(artifact.possibleAngles) && artifact.possibleAngles.length >= 1, 'topic angle should return choices');
  else if (stageId === 'material_questions') assert.ok(Array.isArray(artifact.questions) && artifact.questions.length >= 1, 'material questions should return questions');
  else if (stageId === 'outline_tree') {
    assert.ok(artifact.outlineTree && Array.isArray(artifact.outlineTree.children), 'outline stage should return outlineTree');
    assert.ok(JSON.stringify(artifact).length > 1200, 'outline stage should return detailed guidance');
    assert.ok(artifact.outlineTree.children.every((node) => node.writeTask && Array.isArray(node.writingObjects) && Array.isArray(node.detailPlan)), 'outline nodes should include detailed guidance fields');
  }
  else if (stageId === 'paragraph_guides') {
    assert.ok(Array.isArray(artifact.paragraphGuides) && artifact.paragraphGuides.length >= 1, 'paragraph guide stage should return guides');
    assert.ok(JSON.stringify(artifact).length > 1800, 'paragraph guide stage should return detailed guidance');
    assert.ok(artifact.paragraphGuides.every((guide) => Array.isArray(guide.writingTargets) && Array.isArray(guide.howToWrite) && Array.isArray(guide.detailsToInclude) && Array.isArray(guide.developmentSteps) && Array.isArray(guide.selfCheck)), 'paragraph guides should include detailed writing fields');
  }
  else if (stageId === 'draft_diagnosis') assert.ok(Array.isArray(artifact.priorityIssues) && artifact.priorityIssues.length >= 1, 'diagnosis stage should return priority issues');
  else if (stageId === 'revision_reflection') assert.ok(Array.isArray(artifact.learnedSkills), 'reflection stage should return learned skills');
}

(async () => {
  assert.ok(aiStages.has(targetStageId), `TRAINING_STAGE_ID must be one of ${Array.from(aiStages).join(', ')}`);
  const targetIndex = stageOrder.indexOf(targetStageId);
  assert.ok(targetIndex >= 0, `${targetStageId} must exist in stage order`);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'training-real-stage-'));
  process.env.APP_DATA_DIR = tempDir;
  process.env.TRAINING_PLAN_MODEL_DEBUG = 'true';
  const app = require('../server');

  assert.ok(process.env.AI_API_KEY, 'AI_API_KEY must be configured in environment or .env');
  assert.ok(process.env.AI_API_BASE_URL, 'AI_API_BASE_URL must be configured in environment or .env');
  assert.ok(process.env.AI_GUIDANCE_MODEL || process.env.AI_REWRITE_MODEL, 'AI_GUIDANCE_MODEL or AI_REWRITE_MODEL must be configured');

  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await request(base, 'POST', '/api/v1/training-plans', {
      planType: '7d',
      title: '那一次，我学会了面对',
      grade: '初二',
      genre: '记叙文',
      initialMaterial: '我在班会课上第一次主动承认小组展示失败里自己的责任。',
      goal: '完成一篇记叙文'
    });
    assert.strictEqual(created.status, 200, 'training plan create should return 200');
    const plan = created.json.data;

    for (const stageId of stageOrder.slice(0, targetIndex + 1)) {
      const task = plan.days.find((day) => day.stageId === stageId);
      assert.ok(task, `plan should include ${stageId}`);
      const run = await request(base, 'POST', `/api/v1/training-plans/${plan.id}/tasks/${task.taskId}/run`, {
        input: stageInput(stageId)
      });
      assert.strictEqual(run.status, 200, `${stageId} stage run should return 200`);
      const artifact = run.json.data.artifact;
      if (aiStages.has(stageId)) {
        assert.strictEqual(
          artifact.localFallback,
          false,
          `${stageId} should use real model; reason=${artifact.modelFallbackReasonCode || 'unknown'}; preview=${artifact.modelFallbackDebugPreview || ''}`
        );
        assert.ok(artifact.modelMeta, `${stageId} should include model metadata`);
      }
      assertArtifactShape(stageId, artifact);
    }
    console.log(`OK real AI stage smoke ${targetStageId}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    const stateFile = path.join(tempDir, 'app-state.json');
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
