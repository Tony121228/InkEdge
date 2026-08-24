const storageKey = 'essayCoachFrontendDemoBlank';

const seedState = {
  tasks: [],
  abilities: [],
  issues: []
};

let state = loadState();
let pendingViewTimer = null;

const featureInterfaces = [
  { id: 'topic-analysis', title: '审题与立意助手', view: '我还没写', hook: 'buildOutlineDemo', status: '已预留', text: '识别题眼、生成立意方向、提示跑题风险。' },
  { id: 'material-questions', title: '素材追问助手', view: '我还没写 / 素材库', hook: 'buildOutlineDemo', status: '已预留', text: '按人物、时间、地点、动作、感受和细节追问。' },
  { id: 'outline-structure', title: '提纲生成与结构检查', view: '我还没写', hook: 'buildOutlineDemo', status: '已预留', text: '生成提纲，并提醒铺垫、重点和结尾结构风险。' },
  { id: 'essay-diagnostic', title: '作文体检报告', view: '我写完了', hook: 'diagnoseDemo', status: '已预留', text: '按审题、结构、素材、情感、语言和修改空间诊断。' },
  { id: 'local-revision', title: '局部修改助手', view: '我写完了', hook: 'suggestionDemo', status: '已预留', text: '对片段给问题说明、修改思路和示范句。' },
  { id: 'paragraph-coach', title: '段落陪写模式', view: '我还没写', hook: 'buildOutlineDemo', status: '已预留', text: '从画面、动作、想法逐步合成段落草稿。' },
  { id: 'style-profile', title: '文风档案', view: '成长', hook: 'styleProfileDemo', status: '已预留', text: '总结常用句长、开头方式、擅长表达和常见问题。' },
  { id: 'scoring-advice', title: '作文评分与提分建议', view: '我写完了', hook: 'diagnoseDemo', status: '已预留', text: '提供模拟评分参考和优先提分路径。' },
  { id: 'material-library', title: '作文素材库', view: '素材库', hook: 'saveMaterialDemo', status: '已预留', text: '沉淀生活素材卡，并按题目匹配可用素材。' },
  { id: 'reflection-growth', title: '修改复盘与成长记录', view: '我写完了 / 成长', hook: 'suggestionDemo', status: '已预留', text: '总结本次修改重点、学到方法和下次提醒。' },
  { id: 'ability-assessment', title: '作文能力诊断与分层', view: '成长', hook: 'assessmentDemo', status: '已预留', text: '生成阶段、能力短板、优势和训练重点。' },
  { id: 'personal-plan', title: '个性化训练计划', view: '训练计划', hook: 'hydrateTrainingPlanFromBackend', status: '已接 API', text: '读取当前计划和今日任务，支持 7 天、14 天、30 天和考前冲刺计划。' },
  { id: 'training-camps', title: '专项能力训练营', view: '训练计划', hook: 'startTrainingCamp', status: '已接训练计划 API', text: '训练营作为预设聚焦计划，点击后调用创建训练计划接口。' },
  { id: 'daily-tasks', title: '每日训练任务', view: '总览 / 训练计划', hook: 'renderTasks', status: '已预留', text: '展示每天 5-60 分钟不同强度任务。' },
  { id: 'stage-review', title: '阶段测评与动态调整', view: '成长', hook: 'renderGrowthModules', status: '已预留', text: '每 7 天复盘完成情况，调整下一阶段重点。' },
  { id: 'growth-map', title: '成长地图与激励体系', view: '成长', hook: 'renderGrowthModules', status: '已预留', text: '展示能力阶段、完成率、问题减少和成长节点。' },
  { id: 'error-notebook', title: '错因库与个人问题本', view: '错因本', hook: 'renderNotebook', status: '已预留', text: '沉淀反复问题、证据句、修改示例和关联训练。' },
  { id: 'usage-boundary', title: '训练计划中的 AI 使用边界', view: '成长', hook: 'renderGrowthModules', status: '已预留', text: '提示系统只提问、诊断、示范和局部修改，不默认代写。' }
];

function loadState() {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : structuredClone(seedState);
  } catch {
    return structuredClone(seedState);
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function apiEnabled() {
  return Boolean(window.EssayCoachAPI?.isEnabled?.());
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

async function createSession(mode, payload = {}) {
  if (!apiEnabled()) return { sessionId: 'frontend-session' };
  return window.EssayCoachAPI.createEssaySession({ mode, ...payload });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithButtonLoading(button, action) {
  if (!button || button.disabled) return;

  const originalText = button.textContent;
  button.disabled = true;
  button.classList.add('button-loading');
  button.textContent = '正在加载中';

  try {
    await Promise.all([
      Promise.resolve().then(action),
      wait(650)
    ]);
  } finally {
    button.textContent = originalText;
    button.classList.remove('button-loading');
    button.disabled = false;
  }
}

function setView(viewName) {
  const nextView = $(`#view-${viewName}`);
  const currentView = $('.view.active');
  if (!nextView || currentView === nextView) return;

  if (pendingViewTimer) {
    clearTimeout(pendingViewTimer);
    pendingViewTimer = null;
  }

  $all('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === viewName);
  });

  if (!currentView) {
    nextView.classList.add('active', 'entering');
    requestAnimationFrame(() => nextView.classList.remove('entering'));
    return;
  }

  currentView.classList.add('leaving');
  pendingViewTimer = setTimeout(() => {
    currentView.classList.remove('active', 'leaving');
    nextView.classList.add('active', 'entering');
    requestAnimationFrame(() => nextView.classList.remove('entering'));
    pendingViewTimer = null;
  }, 220);
}

function renderDashboard() {
  renderTasks();
  renderAbilities();
  renderIssues();
  renderFeatureMatrix();
  renderTrainingPlan();
  renderTrainingCamps();
  renderNotebook();
  renderGrowthModules();

  const doneCount = state.tasks.filter((task) => task.done).length;
  const taskCount = state.tasks.length;
  $('#completedCount').textContent = `${doneCount}/${taskCount}`;
  $('#todayFocus').textContent = taskCount ? state.tasks[0].focus : '暂无计划';
  $('#todayProgress').style.width = taskCount ? `${Math.round((doneCount / taskCount) * 100)}%` : '0%';
  $('#todayMeta').textContent = taskCount
    ? `${taskCount} 个任务，预计 ${state.tasks.reduce((sum, task) => sum + task.minutes, 0)} 分钟`
    : '等待创建训练任务';
}

async function hydrateDashboardFromBackend() {
  if (!apiEnabled()) return;

  try {
    const dashboard = await window.EssayCoachAPI.getDashboard();
    const abilityProfile = dashboard.abilityProfile || dashboard.abilityProfileSummary || {};
    state = {
      tasks: asList(dashboard.todayTasks).map((task, index) => ({
        id: task.taskId || task.id || `task-${index + 1}`,
        title: task.title || '',
        minutes: task.expectedMinutes || task.minutes || 0,
        done: task.status === '已完成' || task.status === 'completed',
        focus: task.relatedDimension || task.focus || dashboard.focus || ''
      })),
      abilities: asList(abilityProfile.dimensionScores || abilityProfile.dimensions).map((item) => ({
        name: item.name || item.dimension || item[0],
        score: item.score ?? item[1] ?? 0
      })),
      issues: asList(dashboard.commonIssues || dashboard.recentIssues).map((item) => ({
        type: item.type || item.title || item[0],
        count: item.count || 0,
        suggestion: item.suggestion || item.description || item[1] || ''
      }))
    };
    renderDashboard();
    hydrateTrainingPlanFromBackend();
  } catch {
    renderDashboard();
  }
}

function renderTasks() {
  if (!state.tasks.length) {
    $('#taskList').innerHTML = '<div class="empty-state">暂无今日任务。</div>';
    return;
  }

  $('#taskList').innerHTML = state.tasks.map((task) => `
    <label class="task-item">
      <input type="checkbox" data-task-id="${task.id}" ${task.done ? 'checked' : ''}>
      <span>
        <strong>${escapeHtml(task.title)}</strong>
        <small>${escapeHtml(task.focus)} · ${task.minutes} 分钟</small>
      </span>
    </label>
  `).join('');

  $all('[data-task-id]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const task = state.tasks.find((item) => item.id === checkbox.dataset.taskId);
      if (task) {
        task.done = checkbox.checked;
        saveState();
        renderDashboard();
      }
    });
  });
}

function renderAbilities() {
  if (!state.abilities.length) {
    $('#abilityList').innerHTML = '<div class="empty-state">暂无能力画像，请先完成测评或作文体检。</div>';
    return;
  }

  $('#abilityList').innerHTML = state.abilities.map((item) => `
    <div class="ability-row">
      <span>${escapeHtml(item.name)}</span>
      <div class="ability-track"><i style="width:${item.score}%"></i></div>
      <strong>${item.score}</strong>
    </div>
  `).join('');
}

function renderIssues() {
  if (!state.issues.length) {
    $('#recentIssues').innerHTML = '<div class="empty-state">暂无最近作文问题。</div>';
    return;
  }

  $('#recentIssues').innerHTML = state.issues.map((issue) => `
    <article class="issue-card">
      <div class="issue-count">${issue.count} 次</div>
      <h3>${escapeHtml(issue.type)}</h3>
      <p>${escapeHtml(issue.suggestion)}</p>
    </article>
  `).join('');
}

function renderTrainingPlan() {
  const target = $('#trainingPlan');
  if (!target) return;

  target.innerHTML = '<div class="empty-state">暂无训练计划。可以从下方专项能力训练营开始生成。</div>';
}

async function hydrateTrainingPlanFromBackend() {
  if (!apiEnabled()) return;

  const target = $('#trainingPlan');
  if (!target) return;

  target.innerHTML = '<div class="empty-state">正在加载训练计划...</div>';

  try {
    const [activePlan, todayTasks] = await Promise.allSettled([
      window.EssayCoachAPI.getActiveTrainingPlan(),
      window.EssayCoachAPI.getTodayTasks()
    ]);
    const plan = activePlan.status === 'fulfilled' ? activePlan.value : null;
    const tasksPayload = todayTasks.status === 'fulfilled' ? todayTasks.value : {};
    const tasks = asList(tasksPayload.tasks || tasksPayload.todayTasks);

    if (!plan && !tasks.length) {
      renderTrainingPlan();
      return;
    }

    target.innerHTML = `
      <article class="plan-card">
        <span>${escapeHtml(plan?.status || '进行中')}</span>
        <h3>${escapeHtml(plan?.goal || plan?.title || '当前训练计划')}</h3>
        <p>${escapeHtml(plan?.expectedOutcome || plan?.summary || '已连接训练计划接口。')}</p>
      </article>
      ${tasks.map((task) => `
        <article class="plan-card">
          <span>${escapeHtml(task.status || '待完成')}</span>
          <h3>${escapeHtml(task.title || '训练任务')}</h3>
          <p>${escapeHtml(task.instruction || task.relatedDimension || '')}</p>
        </article>
      `).join('')}
    `;
  } catch (error) {
    target.innerHTML = `<div class="empty-state">训练计划加载失败：${escapeHtml(error.message)}</div>`;
  }
}

function renderNotebook() {
  if (!state.issues.length) {
    $('#notebookList').innerHTML = '<div class="empty-state">暂无错因记录。</div>';
    return;
  }

  $('#notebookList').innerHTML = state.issues.map((issue, index) => `
    <article class="notebook-item">
      <div class="notebook-index">${index + 1}</div>
      <div>
        <h3>${escapeHtml(issue.type)}</h3>
        <p>${escapeHtml(issue.suggestion)}</p>
        <small>来源：作文体检、训练任务反馈、阶段复盘</small>
      </div>
    </article>
  `).join('');
}

function renderFeatureMatrix() {
  const matrix = $('#featureMatrix');
  if (!matrix) return;

  matrix.innerHTML = featureInterfaces.map((item) => `
    <article class="feature-card" data-interface="${escapeHtml(item.id)}" data-hook="${escapeHtml(item.hook)}">
      <div class="feature-top">
        <span>${escapeHtml(item.status)}</span>
        <strong>${escapeHtml(item.view)}</strong>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.text)}</p>
    </article>
  `).join('');
}

function renderTrainingCamps() {
  const target = $('#trainingCamps');
  if (!target) return;

  const camps = [
    { id: 'topic', title: '审题训练营', dimension: '审题能力', text: '圈关键词、判断题眼、排除跑题角度。' },
    { id: 'idea', title: '立意训练营', dimension: '立意能力', text: '为同一材料选择不同立意。' },
    { id: 'material', title: '素材训练营', dimension: '选材能力', text: '记录真实经历并标注可用主题。' },
    { id: 'detail', title: '细节训练营', dimension: '细节能力', text: '动作扩写、对话扩写、心理扩写。' },
    { id: 'structure', title: '结构训练营', dimension: '结构能力', text: '排序段落、补提纲、调整重点。' },
    { id: 'language', title: '语言修改训练营', dimension: '语言能力', text: '删空话、改套话、保留学生表达。' }
  ];

  target.innerHTML = camps.map((camp) => `
    <article class="feature-card training-camp-card" data-camp-id="${escapeHtml(camp.id)}" data-focus-dimension="${escapeHtml(camp.dimension)}">
      <div class="feature-top"><span>可开始</span><strong>${escapeHtml(camp.dimension)}</strong></div>
      <h3>${escapeHtml(camp.title)}</h3>
      <p>${escapeHtml(camp.text)}</p>
      <button type="button" class="camp-start-btn" data-camp-id="${escapeHtml(camp.id)}" data-focus-dimension="${escapeHtml(camp.dimension)}">开始训练营</button>
    </article>
  `).join('');

  target.querySelectorAll('.camp-start-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
      runWithButtonLoading(event.currentTarget, () => startTrainingCamp(event.currentTarget.dataset.focusDimension));
    });
  });
}

async function startTrainingCamp(focusDimension) {
  const target = $('#trainingPlan');
  if (!apiEnabled()) {
    target.innerHTML = `
      <article class="plan-card">
        <span>待接后端</span>
        <h3>${escapeHtml(focusDimension)}专项计划</h3>
        <p>启用后端后，将调用创建训练计划接口并传入 focusDimensions: ['${escapeHtml(focusDimension)}']。</p>
      </article>
    `;
    return;
  }

  try {
    const plan = await window.EssayCoachAPI.createTrainingPlan({
      planType: '7d',
      dailyMinutes: 20,
      focusDimensions: [focusDimension],
      target: `${focusDimension}专项提升`
    });
    target.innerHTML = `
      <article class="plan-card">
        <span>${escapeHtml(plan.status || '已创建')}</span>
        <h3>${escapeHtml(plan.goal || `${focusDimension}专项计划`)}</h3>
        <p>${escapeHtml(plan.expectedOutcome || '训练计划已创建。')}</p>
      </article>
    `;
    hydrateDashboardFromBackend();
  } catch (error) {
    target.innerHTML = `<div class="empty-state">训练营启动失败：${escapeHtml(error.message)}</div>`;
  }
}

function renderGrowthModules() {
  const growthMap = $('#growthMap');
  const usageBoundary = $('#usageBoundary');
  if (growthMap) {
    const stages = ['新手写作者', '能写完整事件', '能写具体细节', '能表达真实感受', '能独立修改作文', '能稳定完成考场作文'];
    growthMap.innerHTML = stages.map((stage, index) => `
      <div class="growth-step ${index === 0 ? 'active' : ''}">
        <span>${index + 1}</span>
        <strong>${escapeHtml(stage)}</strong>
      </div>
    `).join('');
  }

  if (usageBoundary) {
    const rules = [
      ['可以', '提问、诊断、示范、局部修改、生成提纲。'],
      ['需要学生完成', '真实经历、素材确认、最终取舍、完整作文定稿。'],
      ['不默认做', '整篇代写、编造经历、承诺考试精确评分。'],
      ['参与度指标', '记录学生补充素材、选择立意和自己修改的比例。']
    ];
    usageBoundary.innerHTML = rules.map(([title, text]) => `
      <article>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(text)}</p>
      </article>
    `).join('');
  }
}

async function buildOutlineDemo() {
  const topic = $('#topicInput').value.trim() || '未填写';
  const grade = $('#gradeInput').value || '未选择年级';
  const genre = $('#genreInput').value || '未选择文体';
  const material = $('#materialInput').value.trim();

  if (apiEnabled()) {
    try {
      const session = await createSession('brainstorm', { title: topic, grade, genre });
      const sessionId = session.sessionId || session.id;
      const topicAnalysis = await window.EssayCoachAPI.analyzeTopic(sessionId, { title: topic, grade, genre });
      const materialQuestions = await window.EssayCoachAPI.getMaterialQuestions(sessionId, {
        selectedAngle: topicAnalysis?.recommendedAngle || '',
        existingMaterials: material,
        missingFields: []
      });
      const outline = await window.EssayCoachAPI.generateOutline(sessionId, {
        selectedAngle: topicAnalysis?.recommendedAngle || '',
        materials: material ? [{ detail: material }] : [],
        preferredStructure: ''
      });
      renderBackendBrainstorm({ sessionId, topicAnalysis, materialQuestions, outline });
      return;
    } catch (error) {
      $('#brainstormResult').innerHTML = `<div class="empty-state">构思服务暂时不可用：${escapeHtml(error.message)}</div>`;
      return;
    }
  }

  $('#brainstormResult').innerHTML = `
    <article class="panel result-panel">
      <h3>题目理解</h3>
      <div class="tag-row">
        <span>${escapeHtml(grade)}</span>
        <span>${escapeHtml(genre)}</span>
        <span>sessionId: frontend-session</span>
      </div>
      <p><strong>题目：</strong>${escapeHtml(topic)}</p>
      <p><strong>核心问题：</strong>这道题重点不是写“我懂了一个道理”，而是写清楚哪一刻发生了变化。</p>
    </article>
    <article class="panel result-panel">
      <h3>素材追问</h3>
      <ol class="clean-list">
        <li>这件事发生在什么具体时间和地点？</li>
        <li>你最想放弃的那个动作是什么？</li>
        <li>同桌鼓励你时说了哪一句话，或者做了什么动作？</li>
        <li>跑完后身体最明显的感觉是什么？</li>
      </ol>
      <p class="soft-note">已有素材：${escapeHtml(material || '暂无，建议先补充真实经历。')}</p>
    </article>
    <article class="panel result-panel">
      <h3>提纲建议</h3>
      <div class="outline-grid">
        <div>
          <strong>开头</strong>
          <p>从操场、口哨声或起跑动作进入，不先讲大道理。</p>
        </div>
        <div>
          <strong>经过</strong>
          <p>写跑到一半时身体反应、想停下来的瞬间。</p>
        </div>
        <div>
          <strong>转折</strong>
          <p>写同桌陪跑或鼓励带来的变化。</p>
        </div>
        <div>
          <strong>结尾</strong>
          <p>回到题目关键词，写一个具体感受，不喊口号。</p>
        </div>
      </div>
    </article>
  `;
}

function renderBackendBrainstorm({ sessionId, topicAnalysis, materialQuestions, outline }) {
  const angles = asList(topicAnalysis?.possibleAngles || topicAnalysis?.angles);
  const questions = asList(materialQuestions?.questions);
  const outlines = asList(outline?.outlines);

  $('#brainstormResult').innerHTML = `
    <article class="panel result-panel">
      <h3>题目理解</h3>
      <div class="tag-row"><span>sessionId: ${escapeHtml(sessionId || '未返回')}</span></div>
      <p><strong>题眼：</strong>${escapeHtml(asList(topicAnalysis?.topicKeywords).join('、') || '待返回')}</p>
      <p><strong>核心问题：</strong>${escapeHtml(topicAnalysis?.coreQuestion || '待返回')}</p>
      <p><strong>可选立意：</strong>${escapeHtml(angles.map((item) => item.title || item.angle || item).join('；') || '待返回')}</p>
    </article>
    <article class="panel result-panel">
      <h3>素材追问</h3>
      <ol class="clean-list">${questions.length ? questions.map((item) => `<li>${escapeHtml(item.question || item)}</li>`).join('') : '<li>待返回</li>'}</ol>
    </article>
    <article class="panel result-panel">
      <h3>提纲建议</h3>
      <ol class="clean-list">${outlines.length ? outlines.map((item) => `<li>${escapeHtml(item.title || item.summary || item)}</li>`).join('') : '<li>待返回</li>'}</ol>
    </article>
  `;
}

async function saveMaterialDemo() {
  const title = $('#materialTitleInput').value.trim();
  const scene = $('#materialSceneInput').value;
  const topic = $('#materialTopicInput').value.trim();
  const detail = $('#materialDetailInput').value.trim();

  if (apiEnabled()) {
    try {
      const session = await createSession('brainstorm', { title: topic });
      const sessionId = session.sessionId || session.id;
      const material = await window.EssayCoachAPI.saveMaterial(sessionId, {
        title,
        scene,
        event: detail,
        suitableTopics: topic ? [topic] : []
      });
      $('#materialResult').innerHTML = `
        <article class="panel result-panel">
          <h3>素材卡</h3>
          <p><strong>素材 ID：</strong>${escapeHtml(material.materialId || material.id || '待返回')}</p>
          <p><strong>完整度：</strong>${escapeHtml(material.completenessScore ?? '待返回')}</p>
          <p>${escapeHtml(material.summary || '已提交到后端。')}</p>
        </article>
      `;
      return;
    } catch (error) {
      $('#materialResult').innerHTML = `<div class="empty-state">素材库服务暂时不可用：${escapeHtml(error.message)}</div>`;
      return;
    }
  }

  $('#materialResult').innerHTML = `
    <article class="panel result-panel">
      <h3>素材卡预览</h3>
      <div class="tag-row">
        <span>${escapeHtml(scene || '未分类')}</span>
        <span>${escapeHtml(topic || '未关联题目')}</span>
      </div>
      <p><strong>标题：</strong>${escapeHtml(title || '未填写')}</p>
      <p><strong>素材完整度：</strong>${detail ? '待进一步追问' : '暂无素材，建议先补充真实事件。'}</p>
      <ol class="clean-list">
        <li>人物是否清楚？</li>
        <li>时间地点是否具体？</li>
        <li>有没有一个关键动作或对话？</li>
        <li>感受是否来自事件本身？</li>
      </ol>
    </article>
  `;
}

async function diagnoseDemo() {
  const draft = $('#draftInput').value.trim();
  const goal = $('#reviseGoalInput').value || '未选择';
  const wordCount = draft.length;

  if (apiEnabled()) {
    try {
      const session = await createSession('revise', { draftText: draft });
      const sessionId = session.sessionId || session.id;
      const diagnostic = await window.EssayCoachAPI.diagnoseEssay(sessionId, {
        draftText: draft,
        userGoal: goal
      });
      renderBackendDiagnostic({ sessionId, diagnostic, wordCount, goal });
      return;
    } catch (error) {
      $('#reviseResult').innerHTML = `<div class="empty-state">作文体检服务暂时不可用：${escapeHtml(error.message)}</div>`;
      return;
    }
  }

  $('#reviseResult').innerHTML = `
    <article class="panel result-panel">
      <h3>作文体检报告</h3>
      <div class="score-grid">
        ${scoreCard('审题贴合', 74)}
        ${scoreCard('结构清晰', 68)}
        ${scoreCard('素材具体', 46)}
        ${scoreCard('情感自然', 55)}
        ${scoreCard('语言学生感', 62)}
        ${scoreCard('修改空间', 82)}
      </div>
      <p class="soft-note">本次目标：${escapeHtml(goal)} · 草稿长度：${wordCount} 字</p>
    </article>
    <article class="panel result-panel">
      <h3>提分路径</h3>
      <ol class="clean-list">
        <li>先补一处真实细节。</li>
        <li>再调整重点段落比例。</li>
        <li>最后检查结尾是否过度拔高。</li>
      </ol>
    </article>
    <article class="panel result-panel">
      <h3>优先问题</h3>
      <div class="diagnosis-list">
        <div><strong>空泛判断偏多</strong><p>“坚持的重要性”“只要努力就一定会成功”像总结口号，缺少事件支撑。</p></div>
        <div><strong>重点画面太短</strong><p>跑到一半很累，但没有写身体反应、动作、同学怎么鼓励。</p></div>
        <div><strong>结尾拔高较快</strong><p>可以从跑完后的一个细节收束，而不是直接给大道理。</p></div>
      </div>
    </article>
  `;
}

function renderBackendDiagnostic({ sessionId, diagnostic, wordCount, goal }) {
  const scores = diagnostic?.dimensionScores || diagnostic?.dimensions || {};
  const issues = asList(diagnostic?.priorityIssues);
  const entries = Array.isArray(scores)
    ? scores.map((item) => [item.name || item.dimension, item.score || 0])
    : Object.entries(scores);

  $('#reviseResult').innerHTML = `
    <article class="panel result-panel" data-session-id="${escapeHtml(sessionId || '')}" data-diagnostic-id="${escapeHtml(diagnostic?.diagnosticId || diagnostic?.id || '')}">
      <h3>作文体检报告</h3>
      <p>${escapeHtml(diagnostic?.overallComment || diagnostic?.overallLevel || '后端已返回诊断结果。')}</p>
      <div class="score-grid">
        ${entries.length ? entries.map(([label, score]) => scoreCard(label, Number(score) || 0)).join('') : scoreCard('综合表现', 0)}
      </div>
      <p class="soft-note">本次目标：${escapeHtml(goal)} · 草稿长度：${wordCount} 字</p>
    </article>
    <article class="panel result-panel">
      <h3>优先问题</h3>
      <div class="diagnosis-list">
        ${issues.length ? issues.map((item) => `<div><strong>${escapeHtml(item.title || item.type || '问题')}</strong><p>${escapeHtml(item.description || item.suggestion || item)}</p></div>`).join('') : '<div><strong>待返回</strong><p>后端未返回优先问题。</p></div>'}
      </div>
    </article>
  `;
}

async function assessmentDemo() {
  const essay = $('#assessmentInput').value.trim();
  if (apiEnabled()) {
    try {
      const profile = await window.EssayCoachAPI.initialAssessment({ sampleEssay: essay });
      $('#assessmentResult').innerHTML = `
        <article class="panel result-panel">
          <h3>能力画像</h3>
          <p><strong>阶段：</strong>${escapeHtml(profile.stage || '待返回')}</p>
          <p><strong>优势：</strong>${escapeHtml(asList(profile.strengths).join('、') || '待返回')}</p>
          <p><strong>短板：</strong>${escapeHtml(asList(profile.weaknesses).join('、') || '待返回')}</p>
        </article>
      `;
      return;
    } catch (error) {
      $('#assessmentResult').innerHTML = `<div class="empty-state">能力测评服务暂时不可用：${escapeHtml(error.message)}</div>`;
      return;
    }
  }

  $('#assessmentResult').innerHTML = `
    <article class="panel result-panel">
      <h3>能力画像预览</h3>
      <p>${essay ? '已收到作文，后续可生成分层画像。' : '暂无作文内容，请先粘贴一篇最近作文。'}</p>
      <div class="score-grid">
        ${scoreCard('审题', essay ? 60 : 0)}
        ${scoreCard('立意', essay ? 60 : 0)}
        ${scoreCard('选材', essay ? 60 : 0)}
        ${scoreCard('修改', essay ? 60 : 0)}
      </div>
    </article>
  `;
}

async function styleProfileDemo() {
  const sample = $('#styleSampleInput').value.trim();
  if (apiEnabled()) {
    try {
      const profile = await window.EssayCoachAPI.createStyleProfile({ writingSamples: sample });
      $('#styleProfileResult').innerHTML = `
        <article class="panel result-panel">
          <h3>写作习惯卡</h3>
          <p>${escapeHtml(profile.summary || '后端已返回文风档案。')}</p>
          <ul class="clean-list">
            ${asList(profile.traits).map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>待返回</li>'}
          </ul>
        </article>
      `;
      return;
    } catch (error) {
      $('#styleProfileResult').innerHTML = `<div class="empty-state">文风档案服务暂时不可用：${escapeHtml(error.message)}</div>`;
      return;
    }
  }

  $('#styleProfileResult').innerHTML = `
    <article class="panel result-panel">
      <h3>写作习惯卡</h3>
      <p>${sample ? '已收到样本，后续可分析句长、开头、用词和常见问题。' : '暂无样本，请先粘贴自己的旧作文片段。'}</p>
      <ul class="clean-list">
        <li>常用句长：待分析</li>
        <li>常用开头：待分析</li>
        <li>擅长表达：待分析</li>
        <li>常见问题：待分析</li>
      </ul>
    </article>
  `;
}

function scoreCard(label, score) {
  return `
    <div class="score-card">
      <span>${label}</span>
      <strong>${score}</strong>
      <div class="mini-track"><i style="width:${score}%"></i></div>
    </div>
  `;
}

async function suggestionDemo() {
  if (apiEnabled()) {
    try {
      const draft = $('#draftInput').value.trim();
      const goal = $('#reviseGoalInput').value || '未选择';
      const session = await createSession('revise', { draftText: draft });
      const sessionId = session.sessionId || session.id;
      const suggestion = await window.EssayCoachAPI.getRevisionSuggestions(sessionId, {
        revisionGoal: goal,
        keepFactsStrict: true
      });
      $('#reviseResult').insertAdjacentHTML('beforeend', `
        <article class="panel result-panel">
          <h3>局部修改建议</h3>
          <p><strong>问题说明：</strong>${escapeHtml(suggestion.issueExplanation || '待返回')}</p>
          <p><strong>修改思路：</strong>${escapeHtml(suggestion.revisionStrategy || '待返回')}</p>
          <p><strong>示范：</strong>${escapeHtml(suggestion.exampleRevision || '待返回')}</p>
        </article>
      `);
      return;
    } catch (error) {
      $('#reviseResult').insertAdjacentHTML('beforeend', `<div class="empty-state">局部修改服务暂时不可用：${escapeHtml(error.message)}</div>`);
      return;
    }
  }

  if (!$('#reviseResult').innerHTML.trim()) {
    diagnoseDemo();
  }
  $('#reviseResult').insertAdjacentHTML('beforeend', `
    <article class="panel result-panel">
      <h3>局部修改建议</h3>
      <div class="compare-grid">
        <div>
          <span>原句</span>
          <p>跑到一半就很累。我想放弃，但是同学鼓励了我。</p>
        </div>
        <div>
          <span>示范</span>
          <p>跑到第二圈时，我的脚步越来越慢，喉咙像被风刮着。同桌没有超过我，只在旁边放慢速度说：“再跟我跑半圈。”</p>
        </div>
      </div>
      <p class="soft-note">修改思路：不替学生编新经历，只把已有“累、想放弃、同学鼓励”写成能看见的动作和一句话。</p>
    </article>
    <article class="panel result-panel">
      <h3>修改复盘</h3>
      <ul class="clean-list">
        <li>本次重点：把抽象道理改成具体画面。</li>
        <li>学到方法：先写动作，再写感受。</li>
        <li>下次提醒：结尾不要急着喊口号，可以回到一个小细节。</li>
      </ul>
    </article>
  `);
}

function resetDemo() {
  state = structuredClone(seedState);
  saveState();
  renderDashboard();
  $('#brainstormResult').innerHTML = '';
  $('#reviseResult').innerHTML = '';
}

function bindEvents() {
  $all('.nav-item').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });
  $('#buildOutlineBtn').addEventListener('click', (event) => runWithButtonLoading(event.currentTarget, buildOutlineDemo));
  $('#saveMaterialBtn').addEventListener('click', (event) => runWithButtonLoading(event.currentTarget, saveMaterialDemo));
  $('#diagnoseBtn').addEventListener('click', (event) => runWithButtonLoading(event.currentTarget, diagnoseDemo));
  $('#suggestBtn').addEventListener('click', (event) => runWithButtonLoading(event.currentTarget, suggestionDemo));
  $('#assessmentBtn').addEventListener('click', (event) => runWithButtonLoading(event.currentTarget, assessmentDemo));
  $('#styleProfileBtn').addEventListener('click', (event) => runWithButtonLoading(event.currentTarget, styleProfileDemo));
  $('#resetDemoBtn').addEventListener('click', resetDemo);
}

bindEvents();
renderDashboard();
hydrateDashboardFromBackend();
hydrateTrainingPlanFromBackend();
