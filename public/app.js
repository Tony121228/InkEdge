const storageKey = 'essayCoachFrontendDemoBlank';

const seedState = {
  tasks: [],
  abilities: [],
  issues: []
};

let state = loadState();
let pendingViewTimer = null;
let materialQuestionRequestToken = 0;
let guidedWritingRequestToken = 0;
let revisionFlowState = {
  sessionId: '',
  diagnosticId: '',
  originalText: '',
  goal: '',
  depth: '',
  diagnostic: null,
  suggestion: null
};
let brainstormState = {
  sessionId: '',
  topic: '',
  grade: '',
  genre: '',
  initialMaterial: '',
  topicAnalysis: null,
  materialQuestions: null,
  questionSetId: '',
  selectedAngleId: '',
  selectedAngle: '',
  materialAnswers: [],
  guidedWriting: null,
  materialQuestionsLoading: false,
  materialQuestionsError: '',
  additionalMaterial: '',
  additionalMaterialVisible: false
};

const featureInterfaces = [
  { id: 'topic-analysis', title: '审题与立意助手', view: '作文构思', hook: 'buildOutlineDemo', status: '已预留', text: '识别题眼、生成立意方向、提示跑题风险。' },
  { id: 'material-questions', title: '素材追问助手', view: '作文构思 / 素材库', hook: 'buildOutlineDemo', status: '已预留', text: '按人物、时间、地点、动作、感受和细节追问。' },
  { id: 'outline-structure', title: '提纲生成与结构检查', view: '作文构思', hook: 'buildOutlineDemo', status: '已预留', text: '生成提纲，并提醒铺垫、重点和结尾结构风险。' },
  { id: 'essay-diagnostic', title: '作文体检报告', view: '作文修改', hook: 'diagnoseDemo', status: '已预留', text: '按审题、结构、素材、情感、语言和修改空间诊断。' },
  { id: 'local-revision', title: '局部修改助手', view: '作文修改', hook: 'suggestionDemo', status: '已预留', text: '对片段给问题说明、修改思路和示范句。' },
  { id: 'paragraph-coach', title: '段落陪写模式', view: '作文构思', hook: 'buildOutlineDemo', status: '已预留', text: '从画面、动作、想法逐步合成段落草稿。' },
  { id: 'style-profile', title: '文风档案', view: '成长记录', hook: 'styleProfileDemo', status: '已预留', text: '总结常用句长、开头方式、擅长表达和常见问题。' },
  { id: 'scoring-advice', title: '作文评分与提分建议', view: '作文修改', hook: 'diagnoseDemo', status: '已预留', text: '提供模拟评分参考和优先提分路径。' },
  { id: 'material-library', title: '作文素材库', view: '素材库', hook: 'saveMaterialDemo', status: '已预留', text: '沉淀生活素材卡，并按题目匹配可用素材。' },
  { id: 'reflection-growth', title: '修改复盘与成长记录', view: '作文修改 / 成长记录', hook: 'suggestionDemo', status: '已预留', text: '总结本次修改重点、学到方法和下次提醒。' },
  { id: 'ability-assessment', title: '作文能力诊断与分层', view: '成长记录', hook: 'assessmentDemo', status: '已预留', text: '生成阶段、能力短板、优势和训练重点。' },
  { id: 'personal-plan', title: '7 天单篇作文训练', view: '写作计划', hook: 'loadTrainingWorkspaceSummary', status: '已可用', text: '从立意选择、素材追问、提纲树、段落提示到草稿诊断和复盘，按天推进一篇作文。' },
  { id: 'daily-tasks', title: '每日训练任务', view: '导航 / 写作计划', hook: 'renderTasks', status: '已预留', text: '展示每天 5-60 分钟不同强度任务。' },
  { id: 'stage-review', title: '阶段测评与动态调整', view: '成长记录', hook: 'renderGrowthModules', status: '已预留', text: '每 7 天复盘完成情况，调整下一阶段重点。' },
  { id: 'growth-map', title: '成长地图与激励体系', view: '成长记录', hook: 'renderGrowthModules', status: '已预留', text: '展示能力阶段、完成率、问题减少和成长节点。' },
  { id: 'usage-boundary', title: '训练计划中的 AI 使用边界', view: '成长记录', hook: 'renderGrowthModules', status: '已预留', text: '提示系统只提问、诊断、示范和局部修改，不默认代写。' }
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

function setTextIfPresent(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function setWidthIfPresent(selector, value) {
  const element = $(selector);
  if (element) element.style.width = value;
}

function apiEnabled() {
  return Boolean(window.EssayCoachAPI?.isEnabled?.());
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

const abilityDimensionNames = [
  '审题能力',
  '立意能力',
  '选材能力',
  '结构能力',
  '细节能力',
  '语言能力',
  '修改能力',
  '考场表达能力'
];

const dimensionLabelAliases = {
  topicAbility: '审题能力',
  ideaAbility: '立意能力',
  materialAbility: '选材能力',
  structureAbility: '结构能力',
  detailAbility: '细节能力',
  languageAbility: '语言能力',
  revisionAbility: '修改能力',
  examExpressionAbility: '考场表达能力',
  topicFit: '审题贴合',
  ideaClarity: '立意清晰',
  materialSpecificity: '素材具体',
  detailRichness: '细节充分',
  structureClarity: '结构清晰',
  languageNaturalness: '语言自然',
  revisionPotential: '修改空间'
};

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeDimensionScore(label, value) {
  let rawLabel = label;
  let rawValue = value;

  if (Array.isArray(value)) {
    rawLabel = rawLabel || value[0];
    rawValue = { score: value[1] };
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    rawLabel = value.name || value.dimension || value.label || value.title || rawLabel;
    rawValue = value;
  }

  const displayName = dimensionLabelAliases[rawLabel] || rawLabel || '未命名维度';
  const objectValue = rawValue && typeof rawValue === 'object' ? rawValue : {};
  const score = rawValue && typeof rawValue === 'object'
    ? objectValue.score ?? objectValue.value ?? objectValue.percent ?? objectValue.levelScore ?? 0
    : rawValue;

  return {
    key: String(rawLabel || displayName),
    name: String(displayName),
    sourceScore: Number(score),
    score: clampPercent(score),
    level: String(objectValue.level || objectValue.grade || objectValue.status || '').trim(),
    evidence: String(objectValue.evidence || objectValue.reason || objectValue.comment || objectValue.description || '').trim(),
    suggestion: String(objectValue.suggestion || objectValue.nextAction || objectValue.nextStep || objectValue.trainingFocus || '').trim()
  };
}

function dimensionScoreEntries(scores, options = {}) {
  const entries = [];
  if (Array.isArray(scores)) {
    scores.forEach((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) entries.push(normalizeDimensionScore('', item));
      else if (Array.isArray(item)) entries.push(normalizeDimensionScore(item[0], item[1]));
    });
  } else if (scores && typeof scores === 'object') {
    Object.entries(scores).forEach(([label, value]) => {
      entries.push(normalizeDimensionScore(label, value));
    });
  }

  const byName = new Map();
  entries.forEach((item) => {
    const existing = byName.get(item.name);
    if (!existing || item.evidence || item.suggestion || item.score > existing.score) {
      byName.set(item.name, item);
    }
  });

  if (options.ensureAbilityDimensions) {
    abilityDimensionNames.forEach((name) => {
      if (!byName.has(name)) {
        byName.set(name, {
          key: name,
          name,
          score: clampPercent(options.defaultScore ?? 0),
          level: '待积累',
          evidence: '还没有足够记录形成判断。',
          suggestion: '完成一次测评、作文体检或训练任务后会更新。'
        });
      }
    });
  }

  return Array.from(byName.values());
}

function asLooseList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function guidanceItemText(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  const subject = item.object || item.target || item.aspect || item.label || item.title || item.field || item.name || '';
  const detail = item.how || item.detail || item.text || item.description || item.suggestion || item.value || item.question || '';
  const textParts = [subject, detail].map((part) => String(part || '').trim()).filter(Boolean);
  if (textParts.length) return textParts.join('：');
  return Object.values(item).filter((value) => typeof value === 'string' || typeof value === 'number').map(String).join('；');
}

function guidanceDetailText(title, value) {
  const body = String(value || '').trim();
  if (!body) return '';
  return `<div class="guidance-detail-block"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p></div>`;
}

function guidanceDetailList(title, value) {
  const values = asLooseList(value).map(guidanceItemText).filter(Boolean);
  if (!values.length) return '';
  return `<div class="guidance-detail-block"><strong>${escapeHtml(title)}</strong><ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`;
}

function renderGuidanceDetails(item) {
  return `
    <div class="guidance-field-grid">
      ${guidanceDetailList('写作对象', item?.writingTargets || item?.writingObjects)}
      ${guidanceDetailList('分别怎么写', item?.howToWrite)}
      ${guidanceDetailList('细节安排', item?.detailsToInclude || item?.detailPlan)}
      ${guidanceDetailList('写作顺序', item?.developmentSteps || item?.eventBeats)}
      ${guidanceDetailList('感官细节', item?.sensoryDetails)}
      ${guidanceDetailList('心理追问', item?.innerThoughtPrompts)}
      ${guidanceDetailText('心理变化', item?.emotionShift)}
      ${guidanceDetailText('衔接提示', item?.transitionHint)}
      ${guidanceDetailList('核心元素', item?.mustInclude)}
      ${guidanceDetailList('写作提示', item?.writingPrompts)}
      ${guidanceDetailList('避免', item?.avoid)}
    </div>
  `;
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
  renderFeatureMatrix();
  loadTrainingWorkspaceSummary();
  renderGrowthModules();
  renderGrowthTimeline();

  const doneCount = state.tasks.filter((task) => task.done).length;
  const taskCount = state.tasks.length;
  setTextIfPresent('#completedCount', `${doneCount}/${taskCount}`);
  setTextIfPresent('#todayFocus', taskCount ? state.tasks[0].focus : '暂无计划');
  setWidthIfPresent('#todayProgress', taskCount ? `${Math.round((doneCount / taskCount) * 100)}%` : '0%');
  setTextIfPresent('#todayMeta', taskCount
    ? `${taskCount} 个任务，预计 ${state.tasks.reduce((sum, task) => sum + task.minutes, 0)} 分钟`
    : '等待创建训练任务');
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
      abilities: dimensionScoreEntries(abilityProfile.dimensionScores || abilityProfile.dimensions, { ensureAbilityDimensions: true }),
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
  const taskList = $('#taskList');
  if (!taskList) return;
  if (!state.tasks.length) {
    taskList.innerHTML = '<div class="empty-state">暂无今日任务。</div>';
    return;
  }

  taskList.innerHTML = state.tasks.map((task) => `
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
  const abilityList = $('#abilityList');
  if (!abilityList) return;
  if (!state.abilities.length) {
    abilityList.innerHTML = '<div class="empty-state">暂无能力画像，请先完成测评或作文体检。</div>';
    return;
  }

  abilityList.innerHTML = state.abilities.map((rawItem) => {
    const item = normalizeDimensionScore(rawItem.name || rawItem.dimension, rawItem);
    return `
    <div class="ability-row">
      <span>${escapeHtml(item.name)}</span>
      <div class="ability-track"><i style="width:${item.score}%"></i></div>
      <strong>${item.score}</strong>
    </div>
  `;
  }).join('');
}

function renderIssues() {
  const recentIssues = $('#recentIssues');
  if (!recentIssues) return;
  if (!state.issues.length) {
    recentIssues.innerHTML = '<div class="empty-state">暂无最近作文问题。</div>';
    return;
  }

  recentIssues.innerHTML = state.issues.map((issue) => `
    <article class="issue-card">
      <div class="issue-count">${issue.count} 次</div>
      <h3>${escapeHtml(issue.type)}</h3>
      <p>${escapeHtml(issue.suggestion)}</p>
    </article>
  `).join('');
}

function renderTrainingWorkspaceSummary(plan) {
  const target = $('#trainingWorkspace');
  if (!target) return;
  target.innerHTML = '<a class="button primary workspace-entry-button" href="/training-plans.html">进入工作台</a>';
}

async function loadTrainingWorkspaceSummary() {
  const target = $('#trainingWorkspace');
  if (!target) return;
  renderTrainingWorkspaceSummary(null);
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

function renderGrowthModules() {
  const growthMap = $('#growthMap');
  const usageBoundary = $('#usageBoundary');
  if (growthMap) {
    growthMap.innerHTML = '<div class="empty-state">正在读取成长记录…</div>';
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
      const session = await createSession('brainstorm', { title: topic, grade, genre, initialMaterial: material });
      const sessionId = session.sessionId || session.id;
      const topicAnalysis = await window.EssayCoachAPI.analyzeTopic(sessionId, {
        title: topic,
        grade,
        genre,
        initialMaterial: material,
        existingMaterials: material
      });
      setBrainstormState({ sessionId, topic, grade, genre, material, topicAnalysis });
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
    topicAnalysis: demoTopicAnalysis(topic, material)
  });
  renderInteractiveBrainstorm();
}

function firstAngle(topicAnalysis) {
  return asList(topicAnalysis?.possibleAngles || topicAnalysis?.angles)[0] || null;
}

function angleKey(angle, index) {
  return String(angle?.angleId || angle?.id || angle?.title || angle?.angle || `angle_${index + 1}`);
}

function setBrainstormState({ sessionId, topic, grade, genre, material, topicAnalysis }) {
  materialQuestionRequestToken += 1;
  guidedWritingRequestToken += 1;
  brainstormState = {
    sessionId,
    topic,
    grade,
    genre,
    initialMaterial: material,
    topicAnalysis,
    materialQuestions: null,
    questionSetId: '',
    selectedAngleId: '',
    selectedAngle: '',
    materialAnswers: [],
    guidedWriting: null,
    materialQuestionsLoading: false,
    materialQuestionsError: '',
    additionalMaterial: '',
    additionalMaterialVisible: false
  };
}

function demoTopicAnalysis(topic, material = '') {
  const materialText = String(material || '').trim();
  const materialBrief = materialText.length > 36 ? `${materialText.slice(0, 36)}...` : materialText;
  if (materialText) {
    return {
      topicKeywords: ['真实素材', '变化瞬间'],
      coreQuestion: `${topic} 可以先从你提供的素材“${materialBrief}”里找一个最能体现变化的瞬间，再判断它适合写哪一种成长。`,
      possibleAngles: [
        { angleId: 'demo_material_angle_1', title: '抓住素材里的转折点', prompt: '围绕这段真实经历中“原来怎样、后来怎样”的变化来立意。', writingPath: '先交代原来的状态，再写触发变化的关键动作，最后用真实结果证明变化。', materialHint: '保留你已经写下的人物、动作、紧张或坚持等真实细节。' },
        { angleId: 'demo_material_angle_2', title: '把素材写成前后对比', prompt: '用事件前后的想法、动作或心情变化支撑主题。', writingPath: '从事件前的想法写起，重点展开关键一刻，再对照事件后的做法。', materialHint: '补清楚变化发生前的状态、关键一刻和最后的结果。' },
        { angleId: 'demo_material_angle_3', title: '用一个细节承载主题', prompt: '选素材里最有画面感的动作、声音或表情，让立意落在细节上。', writingPath: '用一个细节切入，围绕它推进事件，并在结尾回到这个细节。', materialHint: '不要另编新事，优先追问这段素材里还能看见、听见什么。' }
      ],
      riskyAngles: [{ title: '脱离素材另写大道理', reason: '会让文章和真实经历断开，读起来空泛。' }]
    };
  }
  return {
    topicKeywords: ['那一刻', '变化'],
    coreQuestion: `${topic} 要写清楚一个真实变化发生的瞬间，而不是先讲大道理。`,
    possibleAngles: [
      { angleId: 'demo_angle_1', title: '一次主动面对问题', prompt: '写从逃避到主动处理的变化。', whyThisFitsTopic: '主动处理问题的动作和结果能够具体表现成长。', materialConnection: '可以回想一次原本想躲开、后来亲自解决的真实经历。', writingPath: '先写想逃避的表现，再写主动处理的连续动作，最后写结果。', keyDetailsToAsk: ['问题在什么情况下出现？', '你主动做了哪些连续动作？'], riskReminder: '不要只写自己明白了道理。', materialHint: '补时间、地点、动作和一句真实话。' },
      { angleId: 'demo_angle_2', title: '一次被人提醒后的改变', prompt: '写别人一句话带来的转折。', whyThisFitsTopic: '提醒前后的做法形成对比，可以清楚呈现变化。', materialConnection: '可以回想一次被家人、老师或同学提醒后真正改变做法的经历。', writingPath: '先写原来的做法，再写听到提醒时的反应，最后写实际改变。', keyDetailsToAsk: ['谁在什么情况下提醒了你？', '听完提醒后你具体改变了什么？'], riskReminder: '不要虚构对话或把提醒写成说教。', materialHint: '补人物、对话和当时反应。' },
      { angleId: 'demo_angle_3', title: '一次坚持到底的经历', prompt: '写遇到困难后没有放弃并完成目标的过程。', whyThisFitsTopic: '困难中的选择和持续行动能够证明人物真正发生了变化。', materialConnection: '可以回想一次学习、比赛或生活中差点放弃却继续行动的真实经历。', writingPath: '先写困难出现和退缩念头，再展开坚持时的关键动作，最后写完成后的认识。', keyDetailsToAsk: ['最想放弃的时刻发生了什么？', '哪个动作让事情继续推进？'], riskReminder: '不要只概括自己一直很努力。', materialHint: '补困难、身体反应、连续动作和最后结果。' }
    ],
    riskyAngles: [{ title: '只写道理', reason: '容易空泛，缺少真实事件。' }]
  };
}

function demoMaterialQuestions(selectedAngleId) {
  const angles = asList(brainstormState.topicAnalysis?.possibleAngles || brainstormState.topicAnalysis?.angles);
  const selectedAngle = angles.find((angle, index) => angleKey(angle, index) === selectedAngleId) || null;
  const initialMaterial = String(brainstormState.initialMaterial || '').trim();
  const materialBrief = initialMaterial ? initialMaterial.slice(0, 120) : '尚未提供已有素材';
  const anglePrompt = selectedAngle?.prompt || '围绕当前立意写清真实变化';
  const writingPath = selectedAngle?.writingPath || '按事情起因、经过和变化推进';
  const materialHint = selectedAngle?.materialHint || '只补充真实发生过的细节';
  const materialAnchor = `${materialBrief}；立意方向：${anglePrompt}`;
  return {
    questionSetId: `demo_questions_${selectedAngleId}`,
    selectedAngleId,
    selectedAngle,
    questions: [
      { questionId: 'demo_q1', field: 'trigger', category: '触发', question: `围绕“${anglePrompt}”，素材里哪一个具体情况让事情开始变化？`, purpose: '补清事件起点，让所选立意落到已有素材。', materialAnchor, detailHints: ['当时在哪里', '谁在场', `从“${materialBrief}”中找最先发生的事`], required: true },
      { questionId: 'demo_q2', field: 'action', category: '行动', question: `按照“${writingPath}”，你接着做了哪些真实动作？`, purpose: '让动作顺序服务于当前立意的写作路径。', materialAnchor, detailHints: ['先后顺序', '手上的动作', materialHint], required: true },
      { questionId: 'demo_q3', field: 'difficulty', category: '困难', question: `在“${anglePrompt}”这个方向中，最难的一步是什么，你怎样继续？`, purpose: '补出阻力以及变化真正发生的过程。', materialAnchor, detailHints: ['困难怎样出现', '身体或心情反应', '解决动作'], required: true },
      { questionId: 'demo_q4', field: 'reaction', category: '人物反应', question: `结合已有素材，身边的人对你的行动有什么真实反应？`, purpose: '用人物反应侧面支撑事件，不另编新事实。', materialAnchor, detailHints: ['表情或动作', '真实说过的话', materialHint], required: false },
      { questionId: 'demo_q5', field: 'change_evidence', category: '变化证据', question: `沿着“${writingPath}”，事情前后你的想法或做法有什么真实变化？`, purpose: '形成能够证明所选立意的前后对比。', materialAnchor, detailHints: ['以前怎样', '关键一刻怎样', '后来是否再次行动'], required: true }
    ],
    materialChecklist: [],
    requiredAnswerCount: 4,
    nextAction: 'answer_questions'
  };
}

function brainstormContextMatches(context) {
  return brainstormState.sessionId === context.sessionId
    && brainstormState.selectedAngleId === context.selectedAngleId
    && brainstormState.questionSetId === context.questionSetId;
}

async function generateMaterialQuestions() {
  if (!brainstormState.selectedAngleId || brainstormState.materialQuestionsLoading || brainstormState.questionSetId) return;
  const requestToken = ++materialQuestionRequestToken;
  ++guidedWritingRequestToken;
  const context = {
    sessionId: brainstormState.sessionId,
    selectedAngleId: brainstormState.selectedAngleId,
    questionSetId: brainstormState.questionSetId
  };
  brainstormState.materialQuestionsLoading = true;
  brainstormState.materialQuestionsError = '';
  renderInteractiveBrainstorm();

  try {
    const materialQuestions = apiEnabled()
      ? await window.EssayCoachAPI.getMaterialQuestions(context.sessionId, {
        selectedAngleId: context.selectedAngleId
      })
      : demoMaterialQuestions(context.selectedAngleId);
    if (requestToken !== materialQuestionRequestToken || !brainstormContextMatches(context)) return;
    if (!materialQuestions || typeof materialQuestions !== 'object' || !String(materialQuestions.questionSetId || '').trim()) {
      throw new Error('素材追问返回格式不完整');
    }
    brainstormState.materialQuestionsLoading = false;
    brainstormState.materialQuestions = materialQuestions;
    brainstormState.questionSetId = String(materialQuestions.questionSetId).trim();
    brainstormState.materialAnswers = [];
    brainstormState.guidedWriting = null;
    renderInteractiveBrainstorm();
  } catch (error) {
    if (requestToken !== materialQuestionRequestToken || !brainstormContextMatches(context)) return;
    brainstormState.materialQuestionsLoading = false;
    brainstormState.materialQuestionsError = error.message || '素材追问暂时不可用';
    renderInteractiveBrainstorm();
  }
}

function materialAnswerProgress() {
  const questions = asList(brainstormState.materialQuestions?.questions);
  const knownRequiredIds = new Set(questions
    .filter((question) => question?.required && question?.questionId)
    .map((question) => String(question.questionId)));
  const answeredRequired = collectMaterialAnswers()
    .filter((answer) => knownRequiredIds.has(answer.questionId)).length;
  const requiredAnswerCount = knownRequiredIds.size;
  return {
    answeredRequired,
    requiredAnswerCount,
    remaining: Math.max(0, requiredAnswerCount - answeredRequired)
  };
}

function renderInteractiveBrainstorm() {
  const topicAnalysis = brainstormState.topicAnalysis || {};
  const materialQuestions = brainstormState.materialQuestions;
  const angles = asList(topicAnalysis.possibleAngles || topicAnalysis.angles);
  const questions = asList(materialQuestions?.questions);
  const selectedId = brainstormState.selectedAngleId;
  const previousAnswers = new Map(asList(brainstormState.materialAnswers).map((answer) => [answer.questionId, answer.answer]));
  const hasQuestionSet = Boolean(materialQuestions && brainstormState.questionSetId);
  const progress = hasQuestionSet
    ? materialAnswerProgress()
    : { answeredRequired: 0, requiredAnswerCount: 0, remaining: 0 };

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
      <div class="angle-choice-area" role="radiogroup" aria-label="立意方向">
        ${angles.length ? angles.map((angle, index) => {
          const id = angleKey(angle, index);
          return `
            <article class="angle-card ${id === selectedId ? 'selected' : ''}" role="radio" tabindex="0" aria-checked="${id === selectedId ? 'true' : 'false'}" data-angle-id="${escapeHtml(id)}" data-angle-title="${escapeHtml(angle.title || angle.angle || angle)}">
              <strong>${escapeHtml(angle.title || angle.angle || angle)}</strong>
              <span>${escapeHtml(angle.prompt || angle.materialHint || '围绕这个方向补充真实素材。')}</span>
              <div class="guidance-field-grid angle-guidance-details">
                ${guidanceDetailText('为什么扣题', angle.whyThisFitsTopic)}
                ${guidanceDetailText('怎样使用素材', angle.materialConnection)}
                ${guidanceDetailText('写作路径', angle.writingPath)}
              </div>
              ${angle.materialHint ? `<small>${escapeHtml(angle.materialHint)}</small>` : ''}
            </article>
          `;
        }).join('') : '<div class="empty-state">暂未返回可选立意，请先补充题目。</div>'}
      </div>
      <div class="brainstorm-phase-action">
        <div>
          <strong>下一步：素材追问</strong>
          <span>${brainstormState.materialQuestionsLoading ? '正在按所选立意生成问题…' : (hasQuestionSet ? '素材追问已生成，请完成下方必答问题。' : (selectedId ? '确认这个立意后，再生成针对性的素材问题。' : '请先选择一个立意方向。'))}</span>
        </div>
        <button class="primary" type="button" id="generateMaterialQuestionsBtn" ${!selectedId || brainstormState.materialQuestionsLoading || hasQuestionSet ? 'disabled' : ''}>素材追问</button>
      </div>
      ${brainstormState.materialQuestionsError ? `<div class="material-question-error" role="alert">${escapeHtml(brainstormState.materialQuestionsError)}，可再次点击“素材追问”重试。</div>` : ''}
    </article>
    ${hasQuestionSet ? `<article class="panel result-panel">
      <h3>回答素材追问</h3>
      <div class="material-answer-area">
        ${questions.length ? questions.map((item, index) => `
          <label class="material-answer-item">
            <span class="material-question-meta">
              <span class="question-category">${escapeHtml(item.category || '素材')}</span>
              ${item.required ? '<span class="required-badge">必答</span>' : '<span class="optional-badge">选答</span>'}
            </span>
            <strong class="material-question-text">${escapeHtml(item.question || item)}</strong>
            <small><strong>追问目的：</strong>${escapeHtml(item.purpose || '请只写真实发生过的信息。')}</small>
            <small><strong>素材锚点：</strong>${escapeHtml(item.materialAnchor || brainstormState.selectedAngle)}</small>
            ${asList(item.detailHints).length ? `<span class="detail-hint-row">${asList(item.detailHints).slice(0, 4).map((hint) => `<span>${escapeHtml(hint)}</span>`).join('')}</span>` : ''}
            <textarea class="material-answer-input" data-question-id="${escapeHtml(item.questionId || '')}" data-field="${escapeHtml(item.field || `question_${index + 1}`)}" rows="3" placeholder="在这里回答，越具体越好">${escapeHtml(previousAnswers.get(item.questionId) || '')}</textarea>
          </label>
        `).join('') : '<div class="empty-state">暂无追问问题。</div>'}
      </div>
      <p class="soft-note">已有素材：${escapeHtml(brainstormState.initialMaterial || '暂无，建议先补充真实经历。')}</p>
      <div id="additionalMaterialPromptArea"></div>
    </article>
    <article class="panel result-panel writing-guide-panel">
      <div class="writing-guide-head">
        <div>
          <h3>写作引导</h3>
          <p>根据你的选择和回答生成提纲树形图，以及每一段该写什么。</p>
          <p class="answer-progress" id="materialAnswerProgress">${progress.remaining ? `还需回答 ${progress.remaining} 个必答问题` : '必答素材已补充，可以生成写作引导'}</p>
        </div>
        <button class="primary" type="button" id="generateWritingGuideBtn" ${progress.remaining ? 'disabled' : ''}>生成写作引导</button>
      </div>
      <div id="writingGuideArea" class="writing-guide-area"></div>
    </article>` : ''}
  `;
  bindInteractiveBrainstormEvents();
}

function bindInteractiveBrainstormEvents() {
  function selectAngle(card) {
    const selectedAngleId = card.dataset.angleId || '';
    if (!selectedAngleId || selectedAngleId === brainstormState.selectedAngleId) return;
    materialQuestionRequestToken += 1;
    guidedWritingRequestToken += 1;
    brainstormState.selectedAngleId = selectedAngleId;
    brainstormState.selectedAngle = card.dataset.angleTitle || '';
      brainstormState.questionSetId = '';
      brainstormState.materialQuestions = null;
      brainstormState.materialAnswers = [];
      brainstormState.guidedWriting = null;
      brainstormState.materialQuestionsLoading = false;
      brainstormState.materialQuestionsError = '';
      brainstormState.additionalMaterial = '';
      brainstormState.additionalMaterialVisible = false;
      renderInteractiveBrainstorm();
  }

  $all('.angle-card').forEach((card) => {
    card.addEventListener('click', () => selectAngle(card));
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectAngle(card);
    });
  });

  const materialButton = $('#generateMaterialQuestionsBtn');
  if (materialButton) materialButton.addEventListener('click', generateMaterialQuestions);
  $all('.material-answer-input').forEach((input) => input.addEventListener('input', updateMaterialAnswerProgress));
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
  const questions = new Map(asList(brainstormState.materialQuestions?.questions)
    .filter((question) => question?.questionId)
    .map((question) => [String(question.questionId), question]));
  return $all('.material-answer-input').map((input) => {
    const questionId = String(input.dataset.questionId || '');
    const source = questions.get(questionId);
    if (!source || typeof input.value !== 'string' || !input.value.trim()) return null;
    return {
      questionId,
      field: source.field || input.dataset.field || '',
      question: source.question || '',
      answer: input.value.trim()
    };
  }).filter(Boolean);
}

function updateMaterialAnswerProgress() {
  brainstormState.materialAnswers = collectMaterialAnswers();
  const progress = materialAnswerProgress();
  const status = $('#materialAnswerProgress');
  const guideButton = $('#generateWritingGuideBtn');
  if (status) status.textContent = progress.remaining
    ? `还需回答 ${progress.remaining} 个必答问题`
    : '必答素材已补充，可以生成写作引导';
  if (guideButton) guideButton.disabled = progress.remaining > 0;
}

async function generateWritingGuideDemo(options = {}) {
  const target = $('#writingGuideArea');
  if (!target) return;
  const hasAdditionalMaterial = Object.prototype.hasOwnProperty.call(options, 'additionalMaterial');
  const additionalMaterial = hasAdditionalMaterial ? String(options.additionalMaterial || '').trim() : brainstormState.additionalMaterial;
  if (hasAdditionalMaterial && !additionalMaterial) return;
  if (additionalMaterial.length > 2000) {
    const error = document.getElementById('additionalMaterialError');
    if (error) {
      error.textContent = '补充素材不能超过 2000 字。';
      error.hidden = false;
    }
    return;
  }
  if (hasAdditionalMaterial) brainstormState.additionalMaterial = additionalMaterial;
  const materialAnswers = collectMaterialAnswers();
  brainstormState.materialAnswers = materialAnswers;
  const progress = materialAnswerProgress();
  if (!brainstormState.questionSetId || progress.remaining > 0) {
    updateMaterialAnswerProgress();
    return;
  }

  const requestToken = ++guidedWritingRequestToken;
  const context = {
    sessionId: brainstormState.sessionId,
    selectedAngleId: brainstormState.selectedAngleId,
    questionSetId: brainstormState.questionSetId
  };
  const answerSnapshot = materialAnswers.map((answer) => ({ ...answer }));
  target.innerHTML = '<div class="empty-state">正在根据你的回答生成写作引导…</div>';

  if (!apiEnabled()) {
    const demoAnswers = additionalMaterial
      ? [...answerSnapshot, { questionId: 'additional_material', answer: additionalMaterial }]
      : answerSnapshot;
    const guidedWriting = demoGuidedWriting(brainstormState.selectedAngle, demoAnswers);
    if (requestToken !== guidedWritingRequestToken || !brainstormContextMatches(context)) return;
    brainstormState.additionalMaterialVisible = false;
    brainstormState.guidedWriting = guidedWriting;
    renderWritingGuide(guidedWriting);
    return;
  }
  try {
    const guidedWriting = await window.EssayCoachAPI.generateGuidedWriting(context.sessionId, {
      questionSetId: context.questionSetId,
      selectedAngleId: context.selectedAngleId,
      materialAnswers: answerSnapshot,
      preferredStructure: brainstormState.genre,
      ...(additionalMaterial ? { additionalMaterial } : {})
    });
    if (requestToken !== guidedWritingRequestToken || !brainstormContextMatches(context)) return;
    if (!guidedWriting || (typeof guidedWriting !== "object") || (!guidedWriting.outlineTree && !Array.isArray(guidedWriting.paragraphGuides))) {
      throw new Error("写作引导返回格式不合规");
    }
    brainstormState.additionalMaterialVisible = false;
    brainstormState.guidedWriting = guidedWriting;
    renderWritingGuide(guidedWriting);
  } catch (error) {
    if (requestToken !== guidedWritingRequestToken || !brainstormContextMatches(context)) return;
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
        {
          nodeId: 'p1',
          role: '开头',
          label: '用真实画面切入，让读者知道事情从哪里开始',
          focus: answerHint,
          writeTask: '交代时间、地点、人物和最先出现的动作或物件。',
          writingObjects: ['时间地点', '人物', '动作或物件'],
          detailPlan: ['把地点写具体', '用动作代替空泛情绪', '留下后文变化的苗头'],
          eventBeats: ['进入场景', '出现触发点'],
          emotionShift: '从平常状态转向被触动或开始在意。',
          transitionHint: '用一个问题、发现或动作接到主体。',
          studentChecklist: ['是否有具体画面', '是否出现真实动作'],
          children: []
        },
        {
          nodeId: 'p2',
          role: '主体',
          label: '展开事件和动作，写清楚困难、发现或观察过程',
          focus: '写清楚发生了什么。',
          writeTask: '把素材拆成连续动作，并写出你为什么停住、犹豫或改变注意力。',
          writingObjects: ['连续动作', '他人反应', '环境细节', '内心想法'],
          detailPlan: ['按先后写两三个动作', '补一个声音或表情', '写出当时的真实念头'],
          eventBeats: ['事情推进', '困难或发现变具体', '情绪加强'],
          emotionShift: '从旁观或紧张变得更投入。',
          transitionHint: '用关键动作或新发现进入转折。',
          studentChecklist: ['是否按顺序推进', '是否有细节支撑感受'],
          children: []
        },
        {
          nodeId: 'p3',
          role: '转折',
          label: '集中写改变发生的关键一刻',
          focus: '用一个动作、发现或一句话证明变化。',
          writeTask: '写你和前面不一样的选择或理解。',
          writingObjects: ['关键动作', '一句话或内心话', '前后对比'],
          detailPlan: ['写出身体动作', '补一句真实想法', '说明前后不同'],
          eventBeats: ['触发点出现', '你做出新选择', '事情有了变化'],
          emotionShift: '从犹豫转向理解或行动。',
          transitionHint: '接到事情结束后的画面。',
          studentChecklist: ['是否看得见变化', '是否没有直接讲大道理'],
          children: []
        },
        {
          nodeId: 'p4',
          role: '结尾',
          label: '回到题目，把经历留下的影响写具体',
          focus: '自然点题。',
          writeTask: '写事情结束后的画面和你之后的小变化。',
          writingObjects: ['结束画面', '题目关键词', '具体影响'],
          detailPlan: ['保留一个画面或声音', '自然带回题目', '写下一次你会怎么做'],
          eventBeats: ['事情结束', '画面收束', '写出影响'],
          emotionShift: '强烈情绪沉淀成新的理解。',
          transitionHint: '结尾不再开启新事件。',
          studentChecklist: ['是否自然扣题', '是否有具体余味'],
          children: []
        }
      ]
    },
    paragraphGuides: [
      {
        paragraphId: 'p1',
        role: '开头',
        goal: '用一个真实画面进入事件。',
        writingTargets: ['时间地点', '人物', '动作或物件'],
        howToWrite: ['先定位场景', '再写人物位置或动作', '最后写最初感受'],
        detailsToInclude: ['一个准确场景', '一个可见动作', '一个真实物件'],
        developmentSteps: ['场景', '人物动作', '心情或疑问'],
        sensoryDetails: ['光线、声音、风或物件触感'],
        innerThoughtPrompts: ['你当时心里先想到什么？'],
        mustInclude: ['时间地点', '人物', '一个动作'],
        writingPrompts: ['你第一眼看到什么？', '手上正在做什么？'],
        starterHint: '从一个动作或物件开始，不要先讲大道理。',
        avoid: ['不要直接写“我明白了”'],
        selfCheck: ['是否有画面', '是否是真实经历'],
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
  renderAdditionalMaterialQuestions(missing);
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


function renderAdditionalMaterialQuestions(missingQuestions) {
  const target = document.getElementById('additionalMaterialPromptArea');
  if (!target) return;
  const missing = asList(missingQuestions);
  if (!missing.length) {
    target.innerHTML = '';
    return;
  }
  const questionList = missing.map((item) => '<li>' + escapeHtml(item.question || item) + '</li>').join('');
  const toggleLabel = brainstormState.additionalMaterialVisible ? '收起补充' : '继续回答';
  let markup = '<section class="additional-material-prompt"><h4>还需要补充</h4><ul class="clean-list">' + questionList + '</ul>'
    + '<button class="secondary" type="button" id="continueMaterialAnswerBtn">' + toggleLabel + '</button>';
  if (brainstormState.additionalMaterialVisible) {
    markup += '<label class="additional-material-input-label">补充真实素材'
      + '<textarea id="additionalMaterialInput" rows="4" maxlength="2000" placeholder="根据上面的追问补充真实发生过的细节">'
      + escapeHtml(brainstormState.additionalMaterial || '') + '</textarea></label>'
      + '<p class="material-question-error" id="additionalMaterialError" role="alert" hidden></p>'
      + '<button class="primary" type="button" id="updateWritingGuideBtn">更新写作引导</button>';
  }
  markup += '</section>';
  target.innerHTML = markup;
  document.getElementById('continueMaterialAnswerBtn')?.addEventListener('click', () => {
    brainstormState.additionalMaterialVisible = !brainstormState.additionalMaterialVisible;
    renderAdditionalMaterialQuestions(missing);
    if (brainstormState.additionalMaterialVisible) document.getElementById('additionalMaterialInput')?.focus();
  });
  document.getElementById('updateWritingGuideBtn')?.addEventListener('click', (event) => {
    const value = String(document.getElementById('additionalMaterialInput')?.value || '').trim();
    const error = document.getElementById('additionalMaterialError');
    if (!value) {
      if (error) {
        error.textContent = '请先补充真实素材，再更新写作引导。';
        error.hidden = false;
      }
      document.getElementById('additionalMaterialInput')?.focus();
      return;
    }
    if (value.length > 2000) {
      if (error) {
        error.textContent = '补充素材不能超过 2000 字。';
        error.hidden = false;
      }
      return;
    }
    runWithButtonLoading(event.currentTarget, () => generateWritingGuideDemo({ additionalMaterial: value }));
  });
}

function renderOutlineTree(node) {
  if (!node || typeof node !== 'object') return '<div class="empty-state">待生成提纲树。</div>';
  const children = asList(node.children);
  return `
    <div class="outline-tree" role="group" aria-label="文章结构">
      <div class="outline-root">
        <strong>${escapeHtml(node.title || '文章结构')}</strong>
        ${node.theme ? `<span>${escapeHtml(node.theme)}</span>` : ''}
      </div>
      <ol class="outline-branches">
        ${children.map((child, index) => {
          const summary = child.label || child.focus || child.writeTask || '';
          return `<li class="outline-branch" style="--branch-index:${index}"><span class="outline-branch-role">${escapeHtml(child.role || `第${index + 1}段`)}</span><span class="outline-branch-summary">${escapeHtml(summary)}</span></li>`;
        }).join('')}
      </ol>
    </div>
  `;
}

function renderParagraphGuides(guides) {
  const list = asList(guides);
  if (!list.length) return '<div class="empty-state">待生成段落提示。</div>';
  return '<div class="paragraph-guide-list">' + list.map((guide, index) => {
    const role = guide.role || ('第' + (index + 1) + '段');
    const goal = guide.goal || '写清楚这一段的具体任务。';
    const open = index === 0 ? ' open' : '';
    return '<article class="paragraph-guide-card"><details class="paragraph-guide-details"' + open + '>'
      + '<summary><span class="paragraph-guide-index">' + (index + 1) + '</span><strong>' + escapeHtml(role)
      + '</strong><span>' + escapeHtml(goal) + '</span></summary>'
      + '<div class="paragraph-guide-content">' + renderGuidanceDetails(guide)
      + (guide.starterHint ? '<p><strong>开头提示：</strong>' + escapeHtml(guide.starterHint) + '</p>' : '')
      + (guide.suggestedLength ? '<p><strong>建议长度：</strong>' + escapeHtml(guide.suggestedLength) + '</p>' : '')
      + '</div></details><textarea class="user-write-input" rows="5" placeholder="在这里写这一段…" data-user-paragraph-index="'
      + (index + 1) + '"></textarea></article>';
  }).join('') + '</div>';
}

function materialListMarkup(title, values, className = 'material-keyword-list') {
  const list = asLooseList(values).map(guidanceItemText).filter(Boolean);
  if (!list.length) return '';
  return `
    <div class="material-card-section">
      <strong>${escapeHtml(title)}</strong>
      <div class="${className}">
        ${list.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
      </div>
    </div>
  `;
}

function materialTopicReasonsMarkup(reasons) {
  const list = asLooseList(reasons).filter(Boolean);
  if (!list.length) return '';
  return `
    <div class="material-card-section">
      <strong>适合题目</strong>
      <ul class="material-topic-list">
        ${list.map((item) => {
          if (typeof item === 'string') return `<li><span>${escapeHtml(item)}</span></li>`;
          const topic = item.topic || item.title || '';
          const reason = item.reason || item.explanation || '';
          return `<li><span>${escapeHtml(topic)}</span>${reason ? `<small>${escapeHtml(reason)}</small>` : ''}</li>`;
        }).join('')}
      </ul>
    </div>
  `;
}

function renderSmartMaterialCard(material) {
  const item = material?.material || material || {};
  const topics = asLooseList(item.suitableTopics).filter(Boolean);
  const topicReasons = asLooseList(item.topicReasons).length
    ? item.topicReasons
    : topics.map((topic) => ({ topic, reason: '这个题目可以围绕素材里的真实事件展开。' }));
  return `
    <article class="panel result-panel smart-material-card">
      <div class="smart-material-head">
        <div>
          <p class="eyebrow">AI Material Card</p>
          <h3>${escapeHtml(item.title || '素材卡')}</h3>
        </div>
        <div class="tag-row">
          <span>${escapeHtml(item.category || item.scene || '智能分类')}</span>
          ${item.completenessScore !== undefined ? `<span>完整度 ${escapeHtml(item.completenessScore)}</span>` : ''}
        </div>
      </div>
      ${item.event ? `<p class="material-event">${escapeHtml(item.event)}</p>` : ''}
      ${materialTopicReasonsMarkup(topicReasons)}
      ${materialListMarkup('写作角度', item.writingAngles, 'material-topic-list compact')}
      ${materialListMarkup('关键词', item.keywords, 'material-keyword-list')}
      ${materialListMarkup('人物/地点/动作', [
        ...asLooseList(item.people),
        ...asLooseList(item.places),
        ...asLooseList(item.actions)
      ], 'material-keyword-list')}
      ${materialListMarkup('感官和情绪', [
        ...asLooseList(item.sensoryDetails),
        ...asLooseList(item.emotions)
      ], 'material-keyword-list')}
      ${item.localFallback ? '<p class="material-fallback-note">AI 暂时不可用，已先用本地规则生成素材卡。</p>' : ''}
    </article>
  `;
}


async function saveMaterialDemo() {
  const detail = $('#materialDetailInput').value.trim();
  if (!detail) {
    $('#materialResult').innerHTML = '<div class="empty-state">请先输入一段真实素材。</div>';
    return;
  }

  if (apiEnabled()) {
    try {
      const sessionTitle = detail.slice(0, 24) || '作文素材库';
      const session = await createSession('brainstorm', { title: sessionTitle, initialMaterial: detail });
      const sessionId = session.sessionId || session.id;
      const material = await window.EssayCoachAPI.saveMaterial(sessionId, {
        rawMaterial: detail,
        event: detail
      });
      $('#materialResult').innerHTML = renderSmartMaterialCard(material.material || material);
      return;
    } catch (error) {
      $('#materialResult').innerHTML = `<div class="empty-state">素材库服务暂时不可用：${escapeHtml(error.message)}</div>`;
      return;
    }
  }

  const localCategory = /比赛|运动|跑|终点/.test(detail) ? '挫折与坚持' : /妈妈|爸爸|家|厨房/.test(detail) ? '亲情与责任' : '真实经历';
  $('#materialResult').innerHTML = `
    ${renderSmartMaterialCard({
      title: detail.slice(0, 18) || '素材卡预览',
      category: localCategory,
      scene: localCategory,
      event: detail,
      suitableTopics: ['那一次，我有了新发现', '难忘的一件事', '生活里的成长'],
      topicReasons: [
        { topic: '那一次，我有了新发现', reason: '可以写清事件里的变化。' },
        { topic: '难忘的一件事', reason: '可以围绕真实经历展开。' }
      ],
      writingAngles: ['补一个关键动作', '补一句真实对话'],
      keywords: detail.match(/[\u4e00-\u9fa5]{2,6}/g)?.slice(0, 8) || [],
      localFallback: true
    })}
  `;
}

function getRevisionSelection(kind) {
  const select = document.getElementById(kind === 'goal' ? 'reviseGoalInput' : 'reviseDepthInput');
  const custom = document.getElementById(kind === 'goal' ? 'reviseGoalCustom' : 'reviseDepthCustom');
  if (!select) return '';
  if (select.value !== 'custom') return select.value || '';
  const value = String(custom?.value || '').trim();
  if (!value) {
    custom?.focus();
    return null;
  }
  return value;
}

function showRevisionInputError(message) {
  const target = document.getElementById('reviseResult');
  if (target) target.innerHTML = `<div class="empty-state" role="alert">${escapeHtml(message)}</div>`;
}

function resetRevisionFlowState() {
  revisionFlowState = {
    sessionId: '',
    diagnosticId: '',
    originalText: '',
    goal: '',
    depth: '',
    diagnostic: null,
    suggestion: null
  };
}

function renderSuggestionAction() {
  const slot = document.getElementById('suggestionActionSlot');
  if (!slot) return;
  slot.innerHTML = `
    <div class="actions revision-follow-up-actions">
      <button type="button" id="suggestBtn" ${revisionFlowState.diagnosticId ? '' : 'disabled'}>生成局部修改建议</button>
    </div>
  `;
  const button = document.getElementById('suggestBtn');
  button?.addEventListener('click', (event) => runWithButtonLoading(event.currentTarget, suggestionDemo));
}

function bindCustomRevisionSelect(selectId, inputId) {
  const select = document.getElementById(selectId);
  const input = document.getElementById(inputId);
  if (!select || !input) return;
  const sync = () => {
    input.hidden = select.value !== 'custom';
    if (input.hidden) input.value = '';
  };
  select.addEventListener('change', sync);
  sync();
}

async function diagnoseDemo() {
  const draft = $('#draftInput').value.trim();
  const goal = getRevisionSelection('goal');
  if (goal == null) return showRevisionInputError('请填写自定义修改目标。');
  const wordCount = draft.length;

  resetRevisionFlowState();

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
        ${diagnosticScoreCard('审题贴合', 74)}
        ${diagnosticScoreCard('结构清晰', 68)}
        ${diagnosticScoreCard('素材具体', 46)}
        ${diagnosticScoreCard('情感自然', 55)}
        ${diagnosticScoreCard('语言学生感', 62)}
        ${diagnosticScoreCard('修改空间', 82)}
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
    <div id="suggestionActionSlot"></div>
  `;
  revisionFlowState = {
    sessionId: '',
    diagnosticId: 'local-diagnostic',
    originalText: draft,
    goal,
    depth: getRevisionSelection('depth') || '',
    diagnostic: {
      overallComment: '本地演示体检结果',
      priorityIssues: [
        { title: '空泛判断偏多', explanation: '缺少事件支撑。', suggestion: '补充具体动作和现场细节。' },
        { title: '重点画面太短', explanation: '身体反应和同学鼓励没有展开。', suggestion: '补充动作、对话和感受。' },
        { title: '结尾拔高较快', explanation: '结尾缺少具体画面收束。', suggestion: '用一个细节收束全文。' }
      ]
    },
    suggestion: null
  };
  renderSuggestionAction();
}

function renderBackendDiagnostic({ sessionId, diagnostic, wordCount, goal }) {
  const scores = diagnostic?.dimensionScores || diagnostic?.dimensions || {};
  const issues = asList(diagnostic?.priorityIssues);

  $('#reviseResult').innerHTML = `
      <article class="panel result-panel" data-session-id="${escapeHtml(sessionId || '')}" data-diagnostic-id="${escapeHtml(diagnostic?.diagnosticId || diagnostic?.id || '')}">
      <h3>作文体检报告</h3>
      <p>${escapeHtml(diagnostic?.overallComment || diagnostic?.overallLevel || '后端已返回诊断结果。')}</p>
      <div class="score-grid">
        ${renderDiagnosticScoreDetails(scores)}
      </div>
      <p class="soft-note">本次目标：${escapeHtml(goal)} · 草稿长度：${wordCount} 字</p>
    </article>
    <article class="panel result-panel">
      <h3>优先问题</h3>
      <div class="diagnosis-list">
        ${issues.length ? issues.map((item) => `<div><strong>${escapeHtml(item.title || item.type || '问题')}</strong><p>${escapeHtml(item.explanation || item.description || item.suggestion || item)}</p></div>`).join('') : '<div><strong>待返回</strong><p>后端未返回优先问题。</p></div>'}
      </div>
    </article>
    <div id="suggestionActionSlot"></div>
  `;
  revisionFlowState = {
    sessionId,
    diagnosticId: diagnostic?.diagnosticId || diagnostic?.id || '',
    originalText: $('#draftInput')?.value.trim() || '',
    goal,
    depth: getRevisionSelection('depth') || '',
    diagnostic,
    suggestion: null
  };
  renderSuggestionAction();
}

function bindReferenceComparisonButton(buttonId, context) {
  const button = document.getElementById(buttonId);
  if (!button) return;
  button.addEventListener('click', () => {
    if (!context.sessionId || !context.diagnosticId || !context.originalText) {
      showRevisionInputError('当前作文信息不完整，请重新生成体检或修改建议后再试。');
      return;
    }
    try {
      const revisionSuggestionText = context.revisionSuggestionText || [
        ['问题说明', context.suggestion?.issueExplanation],
        ['修改思路', context.suggestion?.revisionStrategy],
        ['示范', context.suggestion?.exampleRevision],
        ['学生行动', context.suggestion?.studentAction],
        ['修改目标', context.suggestion?.revisionGoal],
        ['修改深度', context.suggestion?.revisionDepth]
      ].filter(([, value]) => typeof value === 'string' && value.trim())
        .map(([label, value]) => `${label}：${value.trim()}`)
        .join('\n');
      sessionStorage.setItem('inkedgeReferenceComparisonContext', JSON.stringify({
        ...context,
         revisionSuggestionText,
         priorityIssues: asList(context.priorityIssues || context.diagnostic?.priorityIssues).slice(0, 8)
      }));
      window.location.assign('/reference-comparison.html');
    } catch {
      showRevisionInputError('无法保存本次对照内容，请检查浏览器存储空间后重试。');
    }
  });
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
          ${renderAbilityDimensionDetails(profile)}
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
      ${renderAbilityDimensionDetails({
        dimensionScores: {
          审题能力: essay ? 60 : 0,
          立意能力: essay ? 60 : 0,
          选材能力: essay ? 60 : 0,
          修改能力: essay ? 60 : 0
        }
      })}
    </article>
  `;
  revisionFlowState = {
    sessionId: '',
    diagnosticId: 'local-diagnostic',
    originalText: draft,
    goal,
    depth: getRevisionSelection('depth') || '',
    diagnostic: {
      overallComment: '本地演示体检结果',
      priorityIssues: [
        { title: '空泛判断偏多', explanation: '缺少事件支撑。', suggestion: '补充具体动作和现场细节。' },
        { title: '重点画面太短', explanation: '身体反应和同学鼓励没有展开。', suggestion: '补充动作、对话和感受。' },
        { title: '结尾拔高较快', explanation: '结尾缺少具体画面收束。', suggestion: '用一个细节收束全文。' }
      ]
    },
    suggestion: null
  };
  renderSuggestionAction();
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
  const normalized = normalizeDimensionScore(label, score);
  const detailParts = [
    normalized.level,
    normalized.evidence,
    normalized.suggestion ? `下一步：${normalized.suggestion}` : ''
  ].filter(Boolean);
  return `
    <div class="score-card">
      <span>${escapeHtml(normalized.name)}</span>
      <strong>${normalized.score}</strong>
      <div class="mini-track"><i style="width:${normalized.score}%"></i></div>
      ${detailParts.length ? `<p class="score-detail">${escapeHtml(detailParts.join('；'))}</p>` : ''}
    </div>
  `;
}

function diagnosticScoreCard(label, score) {
  const normalized = normalizeDimensionScore(label, score);
  const source = Number.isFinite(normalized.sourceScore) ? normalized.sourceScore : normalized.score;
  const value = Math.max(0, Math.min(10, source > 10 ? source / 10 : source));
  const display = Number.isInteger(value) ? String(value) : value.toFixed(1);
  const detailParts = [normalized.level, normalized.evidence, normalized.suggestion ? `下一步：${normalized.suggestion}` : ''].filter(Boolean);
  return `
    <div class="score-card" data-score-scale="10">
      <span>${escapeHtml(normalized.name)}</span>
      <strong>${display}/10</strong>
      <div class="mini-track" role="progressbar" aria-label="${escapeHtml(normalized.name)}" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${value}"><i style="width:${value * 10}%"></i></div>
      ${detailParts.length ? `<p class="score-detail">${escapeHtml(detailParts.join('；'))}</p>` : ''}
    </div>
  `;
}

function renderDiagnosticScoreDetails(scores) {
  const entries = dimensionScoreEntries(scores);
  if (!entries.length) return diagnosticScoreCard('综合表现', 0);
  return entries.map((item) => diagnosticScoreCard(item.name, item)).join('');
}

function renderAbilityDimensionDetails(profile) {
  const entries = dimensionScoreEntries(profile?.dimensionScores || profile?.dimensions || profile, {
    ensureAbilityDimensions: true
  });
  return `
    <div class="ability-dimension-list">
      ${entries.map((item) => `
        <article class="ability-dimension-item">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.level || '持续观察')}</span>
          </div>
          <div class="ability-bar"><i style="width:${item.score}%"></i></div>
          <p>${escapeHtml(item.evidence || '暂无明确证据，建议通过作文体检或专项训练积累。')}</p>
          <small>${escapeHtml(item.suggestion || '下一步会根据训练记录自动生成。')}</small>
          <b>${item.score}</b>
        </article>
      `).join('')}
    </div>
  `;
}

async function suggestionDemo() {
  const goal = getRevisionSelection('goal');
  const depth = getRevisionSelection('depth');
  if (goal == null) return showRevisionInputError('请填写自定义修改目标。');
  if (depth == null) return showRevisionInputError('请填写自定义修改深度。');
  if (!revisionFlowState.diagnosticId) {
    return showRevisionInputError('请先生成体检报告，确认优先问题后再生成局部修改建议。');
  }

  const draft = $('#draftInput').value.trim();
  if (draft !== revisionFlowState.originalText) {
    resetRevisionFlowState();
    return showRevisionInputError('作文内容已变化，请重新生成体检报告后再生成局部修改建议。');
  }

  revisionFlowState.goal = goal;
  revisionFlowState.depth = depth;

  if (apiEnabled()) {
    try {
      const sessionId = revisionFlowState.sessionId;
      const diagnosticId = revisionFlowState.diagnosticId;
      const suggestion = await window.EssayCoachAPI.getRevisionSuggestions(sessionId, {
        diagnosticId,
        revisionGoal: goal,
        revisionDepth: depth
      });
      const reflection = depth === '生成复盘'
        ? await window.EssayCoachAPI.createReflection(sessionId, {
          diagnosticId,
          finalText: draft,
          completedActions: ['已生成作文体检', '已生成局部修改建议'],
          studentSelfReflection: ''
        })
        : null;
      revisionFlowState.suggestion = suggestion;
      $('#reviseResult').insertAdjacentHTML('beforeend', `
        <article class="panel result-panel">
          <h3>局部修改建议</h3>
          <p><strong>问题说明：</strong>${escapeHtml(suggestion.issueExplanation || '待返回')}</p>
          <p><strong>修改思路：</strong>${escapeHtml(suggestion.revisionStrategy || '待返回')}</p>
          <p><strong>示范：</strong>${escapeHtml(suggestion.exampleRevision || '待返回')}</p>
          ${(Array.isArray(suggestion.factCheck?.addedDetails) && suggestion.factCheck.addedDetails.length) ? `
            <p><strong>新增描写，请核对：</strong>${suggestion.factCheck.addedDetails.map((item) => escapeHtml(item)).join('；')}</p>
          ` : ''}
          <button class="secondary reference-comparison-button" type="button" id="suggestionReferenceCompareBtn">参考对照</button>
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
      bindReferenceComparisonButton('suggestionReferenceCompareBtn', {
        sessionId,
        originalText: draft,
        diagnosticId,
        revisionGoal: goal,
        revisionDepth: depth,
        diagnostic: revisionFlowState.diagnostic,
        priorityIssues: asList(revisionFlowState.diagnostic?.priorityIssues),
        suggestion
      });
      return;
    } catch (error) {
      $('#reviseResult').insertAdjacentHTML('beforeend', `<div class="empty-state">局部修改服务暂时不可用：${escapeHtml(error.message)}</div>`);
      return;
    }
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
      <p class="soft-note">修改思路：在保留核心经历的基础上，示范补充环境、动作和感受等描写。新增细节请按真实情况核对、替换或删除。</p>
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
  materialQuestionRequestToken += 1;
  guidedWritingRequestToken += 1;
  resetRevisionFlowState();
  brainstormState = {
    sessionId: '',
    topic: '',
    grade: '',
    genre: '',
    initialMaterial: '',
    topicAnalysis: null,
    materialQuestions: null,
    questionSetId: '',
    selectedAngleId: '',
    selectedAngle: '',
    materialAnswers: [],
    guidedWriting: null,
    materialQuestionsLoading: false,
    materialQuestionsError: '',
    additionalMaterial: '',
    additionalMaterialVisible: false
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
  $all('[data-overview-goto]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.overviewGoto));
  });
  $('#buildOutlineBtn').addEventListener('click', (event) => runWithButtonLoading(event.currentTarget, buildOutlineDemo));
  $('#saveMaterialBtn').addEventListener('click', (event) => runWithButtonLoading(event.currentTarget, saveMaterialDemo));
  $('#diagnoseBtn').addEventListener('click', (event) => runWithButtonLoading(event.currentTarget, diagnoseDemo));
  bindCustomRevisionSelect('reviseGoalInput', 'reviseGoalCustom');
  bindCustomRevisionSelect('reviseDepthInput', 'reviseDepthCustom');
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
        // Navigate by stable view identity so copy changes do not break the flow.
        const goBtn = document.querySelector('.nav-item[data-view="revise"]');
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
  try {
    if (apiEnabled()) payload = await window.EssayCoachAPI.getGrowthTimeline();
  } catch(error) {
    target.innerHTML = '<div class="empty-state">成长地图暂时不可用：'+escapeHtml(error.message)+'</div>';
    return;
  }
  var list = (payload && Array.isArray(payload.timeline)) ? payload.timeline : [];
  var changes = (payload && Array.isArray(payload.abilityChanges)) ? payload.abilityChanges : [];
  var suggestions = (payload && Array.isArray(payload.nextSuggestions)) ? payload.nextSuggestions : [];
  if(!list.length){
    target.innerHTML = '<div class="empty-state">成长地图暂时为空。完成测评、训练或复盘后，这里会显示你的成长节点。</div>';
    return;
  }
  var changeHtml = changes.length ? '<section class="growth-detail-panel"><h4>最近能力变化</h4><div class="growth-change-list">'+changes.slice(-4).map(function(change){
    var delta = Number(change.delta || 0);
    return '<article><strong>'+escapeHtml(change.dimension || '能力')+'</strong><span>'+(escapeHtml(change.before ?? 0))+' → '+(escapeHtml(change.after ?? 0))+'</span><small>'+(delta >= 0 ? '+' : '')+escapeHtml(delta)+'</small></article>';
  }).join('')+'</div></section>' : '';
  var timelineHtml = list.map(function(ev, i){
    var title = escapeHtml(ev.title||ev.stage||ev.type||'成长节点');
    var when = escapeHtml((ev.createdAt||ev.at||ev.date||ev.updatedAt||'').slice(0, 10));
    var note = escapeHtml(ev.summary||ev.note||'');
    var evidence = escapeHtml(ev.evidence||'');
    var next = escapeHtml(ev.nextAction||'');
    return '<div class="growth-step '+(i===0?'active':'')+'">\n  <span>'+(list.length-i)+'</span>\n  <div><strong>'+title+'</strong><div class="hint">'+(when?(when+(note?' · ':'')):'')+note+'</div>'+(evidence?'<p>'+evidence+'</p>':'')+(next?'<small>'+next+'</small>':'')+'</div>\n</div>';
  }).join('');
  var suggestionHtml = suggestions.length ? '<section class="growth-detail-panel"><h4>下一步</h4><ul class="clean-list">'+suggestions.map(function(item){ return '<li>'+escapeHtml(item)+'</li>'; }).join('')+'</ul></section>' : '';
  target.innerHTML = '<div class="growth-summary-strip"><span>当前阶段</span><strong>'+escapeHtml(payload.currentStage || '训练中')+'</strong></div>'+changeHtml+'<div class="growth-timeline-list">'+timelineHtml+'</div>'+suggestionHtml;
}
