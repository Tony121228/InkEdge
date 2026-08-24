const storageKey = 'essayCoachFrontendDemoBlank';

const seedState = {
  tasks: [],
  abilities: [],
  issues: []
};

let state = loadState();
let pendingViewTimer = null;
let brainstormState = {
  sessionId: '',
  topic: '',
  grade: '',
  genre: '',
  initialMaterial: '',
  topicAnalysis: null,
  materialQuestions: null,
  selectedAngleId: '',
  selectedAngle: '',
  materialAnswers: [],
  guidedWriting: null
};

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
  { id: 'personal-plan', title: '个性化训练计划', view: '训练计划', hook: 'renderTrainingPlan', status: '已预留', text: '预留 7 天、14 天、30 天和考前冲刺计划。' },
  { id: 'training-camps', title: '专项能力训练营', view: '训练计划', hook: 'renderTrainingCamps', status: '已预留', text: '审题、素材、细节、结构、语言、修改等专项训练。' },
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
      new Promise((resolve) => setTimeout(resolve, 650))
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
  renderGrowthTimeline();

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

function renderTrainingPlan(){
  const target = document.querySelector('#trainingPlan');
  if (!target) return;
  target.innerHTML = `
    <article class="feature-card">
      <div class="feature-top"><span>入口</span><strong>专项</strong></div>
      <h3>专项能力训练营</h3>
      <p>选择能力重点，自动生成 7 天计划。</p>
      <a class="button primary" href="/training-camps.html">进入训练营</a>
    </article>
  `;
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

function renderTrainingCamps(){
  const target = document.querySelector('#trainingCamps');
  if (!target) return;
  target.innerHTML = 
    `
    <article class="feature-card">
      <div class="feature-top"><span>入口</span><strong>专项</strong></div>
      <h3>专项能力训练营</h3>
      <p>选择能力重点，自动生成 7 天计划。</p>
      <a class="button primary" href="/training-camps.html">进入训练营</a>
    </article>
    `;
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
        selectedAngle: firstAngle(topicAnalysis)?.title || '',
        existingMaterials: material,
        missingFields: []
      });
      setBrainstormState({ sessionId, topic, grade, genre, material, topicAnalysis, materialQuestions });
      renderInteractiveBrainstorm();
      return;
    } catch (error) {
      $('#brainstormResult').innerHTML = `<div class="empty-state">构思服务暂时不可用：${escapeHtml(error.message)}</div>`;
      return;
    }
  }

  setBrainstormState({
    sessionId: 'frontend-session',
    topic,
    grade,
    genre,
    material,
    topicAnalysis: demoTopicAnalysis(topic),
    materialQuestions: demoMaterialQuestions()
  });
  renderInteractiveBrainstorm();
}

function firstAngle(topicAnalysis) {
  return asList(topicAnalysis?.possibleAngles || topicAnalysis?.angles)[0] || null;
}

function angleKey(angle, index) {
  return String(angle?.angleId || angle?.id || angle?.title || angle?.angle || `angle_${index + 1}`);
}

function setBrainstormState({ sessionId, topic, grade, genre, material, topicAnalysis, materialQuestions }) {
  const angle = firstAngle(topicAnalysis);
  brainstormState = {
    sessionId,
    topic,
    grade,
    genre,
    initialMaterial: material,
    topicAnalysis,
    materialQuestions,
    selectedAngleId: angle ? angleKey(angle, 0) : '',
    selectedAngle: angle?.title || angle?.angle || '',
    materialAnswers: [],
    guidedWriting: null
  };
}

function demoTopicAnalysis(topic) {
  return {
    topicKeywords: ['那一刻', '变化'],
    coreQuestion: `${topic} 要写清楚一个真实变化发生的瞬间，而不是先讲大道理。`,
    possibleAngles: [
      { angleId: 'demo_angle_1', title: '一次主动面对问题', prompt: '写从逃避到主动处理的变化。', materialHint: '补时间、地点、动作和一句真实话。' },
      { angleId: 'demo_angle_2', title: '一次被人提醒后的改变', prompt: '写别人一句话带来的转折。', materialHint: '补人物、对话和当时反应。' }
    ],
    riskyAngles: [{ title: '只写道理', reason: '容易空泛，缺少真实事件。' }]
  };
}

function demoMaterialQuestions() {
  return {
    questions: [
      { field: 'time_place', question: '这件事发生在什么具体时间和地点？', purpose: '让开头有真实画面。' },
      { field: 'action', question: '你当时做了哪个动作，能看出变化？', purpose: '让经过具体。' },
      { field: 'dialogue', question: '有没有一句真实说过的话可以写进去？', purpose: '避免空泛总结。' }
    ],
    nextAction: 'continue_questions'
  };
}

function renderInteractiveBrainstorm() {
  const topicAnalysis = brainstormState.topicAnalysis || {};
  const materialQuestions = brainstormState.materialQuestions || {};
  const angles = asList(topicAnalysis.possibleAngles || topicAnalysis.angles);
  const questions = asList(materialQuestions.questions).length
    ? asList(materialQuestions.questions)
    : asList(topicAnalysis.suggestedNextQuestions).map((question, index) => ({ field: `question_${index + 1}`, question, purpose: '补充真实素材。' }));
  const selectedId = brainstormState.selectedAngleId || (angles[0] ? angleKey(angles[0], 0) : '');

  $('#brainstormResult').innerHTML = `
    <article class="panel result-panel">
      <h3>题目理解</h3>
      <div class="tag-row">
        <span>sessionId: ${escapeHtml(brainstormState.sessionId || '未返回')}</span>
        <span>${escapeHtml(brainstormState.grade || '未选择年级')}</span>
        <span>${escapeHtml(brainstormState.genre || '未选择文体')}</span>
      </div>
      <p><strong>题眼：</strong>${escapeHtml(asList(topicAnalysis.topicKeywords).join('、') || '待返回')}</p>
      <p><strong>核心问题：</strong>${escapeHtml(topicAnalysis.coreQuestion || '待返回')}</p>
    </article>
    <article class="panel result-panel">
      <h3>选择一个立意方向</h3>
      <div class="angle-choice-area">
        ${angles.length ? angles.map((angle, index) => {
          const id = angleKey(angle, index);
          return `
            <button class="angle-card ${id === selectedId ? 'selected' : ''}" type="button" data-angle-id="${escapeHtml(id)}" data-angle-title="${escapeHtml(angle.title || angle.angle || angle)}">
              <strong>${escapeHtml(angle.title || angle.angle || angle)}</strong>
              <span>${escapeHtml(angle.prompt || angle.materialHint || '围绕这个方向补充真实素材。')}</span>
            </button>
          `;
        }).join('') : '<div class="empty-state">暂未返回可选立意，请先补充题目。</div>'}
      </div>
    </article>
    <article class="panel result-panel">
      <h3>回答素材追问</h3>
      <div class="material-answer-area">
        ${questions.length ? questions.map((item, index) => `
          <label class="material-answer-item">
            <span>${escapeHtml(item.question || item)}</span>
            <small>${escapeHtml(item.purpose || '请只写真实发生过的信息。')}</small>
            <textarea class="material-answer-input" data-answer-index="${index}" data-field="${escapeHtml(item.field || `question_${index + 1}`)}" rows="3" placeholder="在这里回答，越具体越好"></textarea>
          </label>
        `).join('') : '<div class="empty-state">暂无追问问题。</div>'}
      </div>
      <p class="soft-note">已有素材：${escapeHtml(brainstormState.initialMaterial || '暂无，建议先补充真实经历。')}</p>
    </article>
    <article class="panel result-panel writing-guide-panel">
      <div class="writing-guide-head">
        <div>
          <h3>写作引导</h3>
          <p>根据你的选择和回答生成提纲树形图，以及每一段该写什么。</p>
        </div>
        <button class="primary" type="button" id="generateWritingGuideBtn">生成写作引导</button>
      </div>
      <div id="writingGuideArea" class="writing-guide-area"></div>
    </article>
  `;
  bindInteractiveBrainstormEvents();
}

function bindInteractiveBrainstormEvents() {
  $all('.angle-card').forEach((button) => {
    button.addEventListener('click', () => {
      brainstormState.selectedAngleId = button.dataset.angleId || '';
      brainstormState.selectedAngle = button.dataset.angleTitle || '';
      $all('.angle-card').forEach((item) => item.classList.toggle('selected', item === button));
    });
  });

  const guideButton = $('#generateWritingGuideBtn');
  if (guideButton) guideButton.addEventListener('click', (event) => runWithButtonLoading(event.currentTarget, generateWritingGuideDemo));
  if (brainstormState.guidedWriting) renderWritingGuide(brainstormState.guidedWriting);
  const finishBtn = document.getElementById('btn-user-finished');
  if(finishBtn){
    const wc = document.querySelector('.writing-wordcount');
    const inputs = Array.from(document.querySelectorAll('.user-write-input'));
    const recompute = ()=>{ const t = inputs.map(i=>i.value.trim()).filter(Boolean).join("\n\n"); if(wc) wc.textContent = t ? '当前合并字数：'+t.length : ''; return t; };
    inputs.forEach(i=> i.addEventListener('input', recompute));
    finishBtn.addEventListener('click', (ev)=> runWithButtonLoading(ev.currentTarget, ()=>{
      const combined = recompute();
      if(!combined){ alert('请先在每段输入框中写入内容'); return; }
      window.userDraftText = combined;
      document.dispatchEvent(new CustomEvent('user-essay-ready', { detail: { text: combined } }));
      const mainArea = document.getElementById('draftInput');
      if(mainArea){ mainArea.value = combined; mainArea.dispatchEvent(new Event('input', {bubbles:true})); }
      const navBtn = document.querySelector('.nav-item[data-view="revise"]');
      if(navBtn) navBtn.click(); else { try { setView('revise'); } catch(_) {} }
    }));
  }

}

function collectMaterialAnswers() {
  const questions = asList(brainstormState.materialQuestions?.questions);
  return $all('.material-answer-input').map((input) => {
    const index = Number(input.dataset.answerIndex || 0);
    const source = questions[index] || {};
    return {
      field: input.dataset.field || source.field || `question_${index + 1}`,
      question: source.question || '',
      answer: input.value.trim()
    };
  }).filter((item) => item.question || item.answer);
}

async function generateWritingGuideDemo() {
  const target = $('#writingGuideArea');
  if (!target) return;
  const materialAnswers = collectMaterialAnswers();
  brainstormState.materialAnswers = materialAnswers;

  if (!apiEnabled()) {
    target.innerHTML = '<div class="empty-state">写作引导服务未启用：请在配置中开启 USE_BACKEND 并设置 AI_API_KEY。</div>';
    return;
  }
  try {
    const selectedAngle = brainstormState.selectedAngle || firstAngle(brainstormState.topicAnalysis)?.title || "";
    const guidedWriting = await window.EssayCoachAPI.generateGuidedWriting(brainstormState.sessionId, {
      selectedAngleId: brainstormState.selectedAngleId,
      selectedAngle,
      materialAnswers,
      extraMaterial: brainstormState.initialMaterial,
      preferredStructure: brainstormState.genre
    });
    if (!guidedWriting || (typeof guidedWriting !== "object") || (!guidedWriting.outlineTree && !Array.isArray(guidedWriting.paragraphGuides))) {
      throw new Error("写作引导返回格式不合规");
    }
    brainstormState.guidedWriting = guidedWriting;
    renderWritingGuide(guidedWriting);
  } catch (error) {
    target.innerHTML = `<div class="empty-state">写作引导暂时不可用：${escapeHtml(error.message)}</div>`;
  }
}


function demoGuidedWriting(selectedAngle, materialAnswers) {
  const answerHint = materialAnswers.find((item) => item.answer)?.answer || '你刚补充的真实细节';
  return {
    outlineTree: {
      title: brainstormState.topic || '作文提纲',
      theme: selectedAngle || '写清楚一次真实变化',
      children: [
        { nodeId: 'p1', role: '开头', label: '用真实画面切入', focus: answerHint, children: [] },
        { nodeId: 'p2', role: '经过', label: '展开事件和动作', focus: '写清楚发生了什么', children: [] },
        { nodeId: 'p3', role: '结尾', label: '自然点题', focus: '回到题目关键词', children: [] }
      ]
    },
    paragraphGuides: [
      {
        paragraphId: 'p1',
        role: '开头',
        goal: '用一个真实画面进入事件。',
        mustInclude: ['时间地点', '人物', '一个动作'],
        writingPrompts: ['你第一眼看到什么？', '手上正在做什么？'],
        starterHint: '从一个动作或物件开始，不要先讲大道理。',
        avoid: ['不要直接写“我明白了”'],
        suggestedLength: '80-120字'
      }
    ],
    missingMaterialQuestions: [],
    nextAction: 'write_paragraph_1',
    studentTask: '先写第1段，只写真实画面，不急着总结道理。'
  };
}

function renderWritingGuide(guidedWriting) {
  const target = $('#writingGuideArea');
  var oldRow = document.querySelector('.writing-guide-panel .writing-finish-row'); if(oldRow){ oldRow.remove(); }
  if (!target) return;
  const missing = asList(guidedWriting?.missingMaterialQuestions);
  target.innerHTML = `
    <div class="writing-guide-area">
      <section class="guide-section">
        <h4>提纲树形图</h4>
        ${renderOutlineTree(guidedWriting?.outlineTree)}
      </section>
      <section class="guide-section">
        <h4>段落写作提示</h4>
        ${renderParagraphGuides(guidedWriting?.paragraphGuides)}
      </section>
      ${missing.length ? `
        <section class="guide-section">
          <h4>还需要补充</h4>
          <ul class="clean-list">${missing.map((item) => `<li>${escapeHtml(item.question || item)}</li>`).join('')}</ul>
        </section>
      ` : ""}
      <p class="student-task">${escapeHtml(guidedWriting?.studentTask || "先按第1段提示开始写。")}</p>
      <div class="writing-finish-row">
        <button class="primary" type="button" id="btn-user-finished">我写完了</button>
        <span class="writing-wordcount"></span>
      </div>
    </div>
  `;
  const finishBtn = document.getElementById('btn-user-finished');
  const wc = document.querySelector('.writing-wordcount');
  const inputs = Array.from(document.querySelectorAll('.user-write-input'));
  const recompute = ()=>{ const t = inputs.map(i=>i.value.trim()).filter(Boolean).join('\n\n'); if(wc) wc.textContent = t ? '当前合并字数：'+t.length : ''; return t; };
  inputs.forEach(i=> i.addEventListener("input", recompute));
  if(finishBtn){ finishBtn.addEventListener("click", (ev)=> runWithButtonLoading(ev.currentTarget, ()=>{
    const combined = recompute();
    if(!combined){ alert('请先在每段输入框中写入内容'); return; }
    window.userDraftText = combined;
    document.dispatchEvent(new CustomEvent('user-essay-ready', { detail: { text: combined } }));
    const mainArea = document.getElementById('draftInput');
    if(mainArea){ mainArea.value = combined; mainArea.dispatchEvent(new Event("input", {bubbles:true})); }
    const navBtn = document.querySelector('.nav-item[data-view="revise"]');
    if(navBtn) navBtn.click(); else try { setView('revise'); } catch(_) {}
  })); }
}


function renderOutlineTree(node) {
  if (!node || typeof node !== 'object') return '<div class="empty-state">待生成提纲树。</div>';
  const children = asList(node.children);
  return `
    <ul class="outline-tree">
      <li>
        <div class="tree-node">
          <strong>${escapeHtml(node.role || node.title || '提纲')}</strong>
          <span>${escapeHtml(node.label || node.theme || node.focus || '')}</span>
        </div>
        ${children.length ? children.map(renderOutlineTree).join('') : ''}
      </li>
    </ul>
  `;
}

function renderParagraphGuides(guides) {
  const list = asList(guides);
  if (!list.length) return "<div class=\"empty-state\">待生成段落提示。</div>";
  return `
    <div class=\"paragraph-guide-list\">
      ${list.map((guide, index) => `
        <article class=\"paragraph-guide-card\">
          <div class=\"paragraph-guide-index\">${index + 1}</div>
          <div>
            <h5>${escapeHtml(guide.role || `第${index + 1}段`)}</h5>
            <p>${escapeHtml(guide.goal || "写清楚这一段的具体任务。")}</p>
            <dl>
              <dt>必须写入</dt>
              <dd>${escapeHtml(asList(guide.mustInclude).join("、") || "真实细节")}</dd>
              <dt>写作提示</dt>
              <dd>${escapeHtml(asList(guide.writingPrompts).join("；") || guide.starterHint || "先写动作，再写感受。")}</dd>
              <dt>避免</dt>
              <dd>${escapeHtml(asList(guide.avoid).join("、") || "不要代写整段，不要编造经历。")}</dd>
              <dt>建议长度</dt>
              <dd>${escapeHtml(guide.suggestedLength || "按需要展开")}</dd>
            </dl>
          </div>
          <textarea class=\"user-write-input\" rows=\"5\" placeholder=\"在这里写这一段…\" data-user-paragraph-index=\"${index + 1}\"></textarea>
        </article>
      `).join("")}
    </div>
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
      const depth = $('#reviseDepthInput').value || '';
      const session = await createSession('revise', { draftText: draft });
      const sessionId = session.sessionId || session.id;
      const diagnostic = await window.EssayCoachAPI.diagnoseEssay(sessionId, {
        draftText: draft,
        userGoal: goal
      });
      const suggestion = await window.EssayCoachAPI.getRevisionSuggestions(sessionId, {
        diagnosticId: diagnostic.diagnosticId || diagnostic.id,
        revisionGoal: goal,
        keepFactsStrict: true
      });
      const reflection = depth === '生成复盘'
        ? await window.EssayCoachAPI.createReflection(sessionId, {
          diagnosticId: diagnostic.diagnosticId || diagnostic.id,
          finalText: draft,
          completedActions: ['已生成作文体检', '已生成局部修改建议'],
          studentSelfReflection: ''
        })
        : null;
      $('#reviseResult').insertAdjacentHTML('beforeend', `
        <article class="panel result-panel">
          <h3>作文体检摘要</h3>
          <p>${escapeHtml(diagnostic.overallComment || '已完成体检，下面给出局部修改建议。')}</p>
        </article>
        <article class="panel result-panel">
          <h3>局部修改建议</h3>
          <p><strong>问题说明：</strong>${escapeHtml(suggestion.issueExplanation || '待返回')}</p>
          <p><strong>修改思路：</strong>${escapeHtml(suggestion.revisionStrategy || '待返回')}</p>
          <p><strong>示范：</strong>${escapeHtml(suggestion.exampleRevision || '待返回')}</p>
        </article>
        ${reflection ? `
          <article class="panel result-panel">
            <h3>修改复盘</h3>
            <p>${escapeHtml(reflection.summary || '已生成本次修改复盘。')}</p>
            <ul class="clean-list">
              ${asList(reflection.learnedSkills).map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>待返回</li>'}
            </ul>
          </article>
        ` : ''}
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
  brainstormState = {
    sessionId: '',
    topic: '',
    grade: '',
    genre: '',
    initialMaterial: '',
    topicAnalysis: null,
    materialQuestions: null,
    selectedAngleId: '',
    selectedAngle: '',
    materialAnswers: [],
    guidedWriting: null
  };
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

// --- Inject per-paragraph writing inputs and completion flow ---
(function(){
  function onReady(cb){
    if(document.readyState==='complete'||document.readyState==='interactive'){setTimeout(cb,0)}else{document.addEventListener('DOMContentLoaded',cb)}
  }
  function findByText(root, text){
    text = String(text).trim();
    const walker = document.createTreeWalker(root||document.body, NodeFilter.SHOW_ELEMENT, null);
    const hits=[];
    while(walker.nextNode()){
      const el = walker.currentNode;
      try{
        if(!el.firstElementChild && (el.textContent||'').trim().includes(text)) hits.push(el);
      }catch(_){}}
    return hits;
  }
  function nearestSection(el){
    while(el && el!==document.body){
      if(el.tagName==='SECTION' || el.classList.contains('section') || el.classList.contains('card')) return el;
      el = el.parentElement;
    }
    return null;
  }
  onReady(function(){
    try{
      const label = '段落写作提示';
      const anchors = findByText(document.body, label);
      if(!anchors.length) return;
      const section = nearestSection(anchors[0]) || anchors[0].parentElement;
      if(!section) return;
      if(section.__userWriteInputsInjected) return;
      section.__userWriteInputsInjected = true;

      // Identify step blocks under the section
      let stepBlocks = Array.from(section.querySelectorAll('[data-step], .step, li, .tip, .hint'))
        .filter(el=>/\d+|步骤|要点|提示/.test((el.getAttribute('data-step')||'') + el.className + (el.textContent||'')));
      if(stepBlocks.length===0){
        // Fallback to immediate siblings after the anchor element
        const start = anchors[0];
        let cur = start.parentElement;
        stepBlocks = [];
        for(let i=0;i<8 && cur; i++){
          const items = cur.querySelectorAll('li, .step, [data-step]');
          if(items.length){ stepBlocks = Array.from(items); break; }
          cur = cur.nextElementSibling;
        }
      }
      if(stepBlocks.length===0){
        // Create at least three blank inputs as a fallback
        stepBlocks = new Array(3).fill(0).map(()=>{ const d=document.createElement('div'); d.className='step'; section.appendChild(d); return d; });
      }

      const createdAreas=[];
      stepBlocks.forEach((blk, idx)=>{
        if(blk.__userTextAreaAttached) return;
        blk.__userTextAreaAttached = true;
        const wrap = document.createElement('div');
        wrap.className = 'user-write-input';
        wrap.style.marginTop = '8px';
        const ta = document.createElement('textarea');
        ta.placeholder = '在这里写这一段…';
        ta.rows = 5;
        ta.style.width = '100%';
        ta.style.boxSizing = 'border-box';
        ta.setAttribute('data-user-paragraph-index', String(idx+1));
        wrap.appendChild(ta);
        blk.insertAdjacentElement('afterend', wrap);
        createdAreas.push(ta);
      });

      // Add the final action row
      const actionRow = document.createElement('div');
      actionRow.style.marginTop = '12px';
      actionRow.style.display = 'flex';
      actionRow.style.gap = '8px';

      const finishBtn = document.createElement('button');
      finishBtn.textContent = '我写完了';
      finishBtn.id = 'btn-user-finished';
      finishBtn.className = 'primary';

      const wordCount = document.createElement('span');
      wordCount.style.alignSelf = 'center';
      wordCount.style.opacity = '0.75';

      function recompute(){
        const txt = createdAreas.map(t=>t.value.trim()).filter(Boolean).join('\n\n');
        wordCount.textContent = txt ? `当前合并字数：${txt.length}` : '';
        return txt;
      }
      createdAreas.forEach(t=>{ t.addEventListener('input', recompute); });

      finishBtn.addEventListener('click', ()=>{
        const combined = recompute();
        if(!combined){ alert('请先在每段输入框中写入内容'); return; }
        // Make it available globally and via event
        window.userDraftText = combined;
        document.dispatchEvent(new CustomEvent('user-essay-ready', { detail: { text: combined } }));

        // Try to auto-fill the main input if present
        const candidates = Array.from(document.querySelectorAll('textarea,input[type="textarea"]'))
          .filter(el=>!createdAreas.includes(el))
          .filter(el=>{ const ph=(el.placeholder||'')+(el.id||'')+(el.name||''); return /粘贴|原文|作文|内容|text|input/i.test(ph); });
        const mainArea = candidates[0] || Array.from(document.querySelectorAll('textarea')).find(el=>!createdAreas.includes(el));
        if(mainArea){
          mainArea.value = combined;
          mainArea.dispatchEvent(new Event('input', {bubbles:true}));
        }
        // Navigate to the existing “我写完了” tab/section if available
        const goBtn = Array.from(document.querySelectorAll('button, a, [role="tab"], .tab'))
          .find(el=>/我写完了/.test((el.textContent||'').trim()));
        if(goBtn){ goBtn.click(); }
        // Graceful fallback: show a preview overlay for copy
        if(!goBtn && !mainArea){
          const overlay = document.createElement('div');
          overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
          const panel = document.createElement('div');
          panel.style.cssText='background:#fff;max-width:860px;width:100%;max-height:80vh;overflow:auto;padding:16px;border-radius:8px;';
          const h = document.createElement('h3'); h.textContent='用户稿件预览';
          const pre = document.createElement('textarea'); pre.style.width='100%'; pre.style.height='50vh'; pre.value=combined;
          const close = document.createElement('button'); close.textContent='复制并关闭'; close.className='primary';
          close.addEventListener('click', ()=>{ pre.select(); document.execCommand('copy'); document.body.removeChild(overlay); });
          panel.append(h, pre, close); overlay.appendChild(panel); document.body.appendChild(overlay);
        }
      });

      actionRow.append(finishBtn, wordCount);
      section.appendChild(actionRow);
    }catch(err){ console.warn('write-assist injection failed:', err); }
  });
})();


// API-backed growth timeline renderer (overrides static content)
async function renderGrowthTimeline(){
  var target = document.querySelector('#growthMap');
  if(!target) return;
  var payload = null;
  try { if (apiEnabled()) { payload = await window.EssayCoachAPI.getGrowthTimeline(); } } catch(_) {}
  var list = (payload && Array.isArray(payload.timeline)) ? payload.timeline : [];
  if(!list.length){ target.innerHTML = '<div class="empty-state">成长地图暂时为空。完成测评、训练或复盘后，这里会显示你的成长节点。</div>'; return; }
  var html = list.map(function(ev, i){ var isActive = i===list.length-1; var title = escapeHtml(ev.title||ev.stage||ev.type||'成长节点'); var when = escapeHtml(ev.at||ev.date||ev.updatedAt||''); var note = escapeHtml(ev.note||ev.summary||''); return '<div class="growth-step '+(isActive?'active':'')+'">\n  <span>'+(i+1)+'</span>\n  <div><strong>'+title+'</strong><div class="hint">'+(when?(when+(note?' · ':'')):'')+note+'</div></div>\n</div>'; }).join('');
  target.innerHTML = html;
}
