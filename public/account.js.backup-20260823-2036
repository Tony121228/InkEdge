function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function apiEnabled() {
  return Boolean(window.EssayCoachAPI?.isEnabled?.());
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function renderAbilities(abilities = []) {
  document.querySelector('#profileAbilities').innerHTML = abilities.length ? abilities.map((item) => {
    const name = item.name || item.dimension || item[0];
    const score = item.score ?? item[1] ?? 0;
    return `
      <div class="ability-row">
        <span>${escapeHtml(name)}</span>
        <div class="ability-track"><i style="width:${Number(score) || 0}%"></i></div>
        <strong>${escapeHtml(score)}</strong>
      </div>
    `;
  }).join('') : '<div class="empty-state">暂无能力画像。</div>';
}

function renderIssues(issues = []) {
  document.querySelector('#profileIssues').innerHTML = issues.length ? issues.map((item, index) => `
    <article class="notebook-item">
      <div class="notebook-index">${index + 1}</div>
      <div>
        <h3>${escapeHtml(item.title || item.type || item[0])}</h3>
        <p>${escapeHtml(item.suggestion || item.description || item[1] || '')}</p>
        <small>下一步会匹配专项训练任务</small>
      </div>
    </article>
  `).join('') : '<div class="empty-state">暂无错因记录。</div>';
}

function renderEssays(essays = []) {
  document.querySelector('#essayHistory').innerHTML = essays.length ? essays.map((item) => `
    <article class="issue-card">
      <div class="issue-count">${escapeHtml(item.change || item.status || '')}</div>
      <h3>${escapeHtml(item.title || '')}</h3>
      <p>${escapeHtml(item.summary || item.status || '')}</p>
    </article>
  `).join('') : '<div class="empty-state">暂无历史作文。</div>';
}

async function loadAccountData() {
  if (!apiEnabled()) {
    renderAbilities();
    renderIssues();
    renderEssays();
    return;
  }

  try {
    const [me, profile, plan, notebook] = await Promise.allSettled([
      window.EssayCoachAPI.getMe(),
      window.EssayCoachAPI.getAbilityProfile(),
      window.EssayCoachAPI.getActiveTrainingPlan(),
      window.EssayCoachAPI.getErrorNotebook()
    ]);

    const user = me.status === 'fulfilled' ? me.value.user || me.value : {};
    const abilityProfile = profile.status === 'fulfilled' ? profile.value : {};
    const activePlan = plan.status === 'fulfilled' ? plan.value : {};
    const errorNotebook = notebook.status === 'fulfilled' ? notebook.value : {};

    document.querySelector('.dashboard-copy h1').textContent = user.nickname
      ? `${user.nickname}的作文成长记录`
      : '学习档案';
    document.querySelector('.today-board .board-title').textContent = activePlan.goal || abilityProfile.currentFocus || '暂无';
    document.querySelector('.today-board .board-meta').textContent = activePlan.status || '等待创建训练计划';

    renderAbilities(asList(abilityProfile.dimensionScores || abilityProfile.dimensions));
    renderIssues(asList(errorNotebook.issues || errorNotebook.topRecurringIssues));
    renderEssays(asList(user.recentEssays || me.value?.recentEssays));
  } catch {
    renderAbilities();
    renderIssues();
    renderEssays();
  }
}

loadAccountData();
