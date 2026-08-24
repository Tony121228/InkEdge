(function () {
  const config = window.ESSAY_COACH_CONFIG || {};

  function joinUrl(base, prefix, path) {
    const cleanBase = String(base || '').replace(/\/+$/, '');
    const cleanPrefix = String(prefix || '').replace(/^\/?/, '/').replace(/\/+$/, '');
    const cleanPath = String(path || '').replace(/^\/+/, '');
    return `${cleanBase}${cleanPrefix}/${cleanPath}`;
  }

  function isEnabled() {
    return Boolean(config.USE_BACKEND);
  }

  function timeoutMs() {
    const value = Number(config.REQUEST_TIMEOUT_MS);
    return Number.isFinite(value) && value > 0 ? value : 180000;
  }

  async function request(path, options = {}) {
    if (!isEnabled()) {
      throw new Error('Backend is not enabled.');
    }

    const controller = new AbortController();
    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs());

    try {
      const response = await fetch(joinUrl(config.API_BASE_URL, config.API_PREFIX, path), {
        method: options.method || 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        },
        body: options.body == null ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        const message = payload?.error?.message || payload?.message || `Request failed: ${response.status}`;
        throw new Error(message);
      }
      return payload.data ?? payload;
    } catch (error) {
      if (didTimeout || controller.signal.aborted) {
        throw new Error('请求超时，请稍后重试。作文指导生成可能需要更久，请避免重复点击。');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  window.EssayCoachAPI = {
    isEnabled,
    getMe: () => request('me'),
    getDashboard: () => request('dashboard'),
    createEssaySession: (body) => request('essay-sessions', { method: 'POST', body }),
    getEssaySession: (sessionId) => request(`essay-sessions/${encodeURIComponent(sessionId)}`),
    analyzeTopic: (sessionId, body) => request(`essay-sessions/${encodeURIComponent(sessionId)}/topic-analysis`, { method: 'POST', body }),
    getMaterialQuestions: (sessionId, body) => request(`essay-sessions/${encodeURIComponent(sessionId)}/material-questions`, { method: 'POST', body }),
    saveMaterial: (sessionId, body) => request(`essay-sessions/${encodeURIComponent(sessionId)}/materials`, { method: 'POST', body }),
    generateOutline: (sessionId, body) => request(`essay-sessions/${encodeURIComponent(sessionId)}/outline`, { method: 'POST', body }),
    generateGuidedWriting: (sessionId, body) => request(`essay-sessions/${encodeURIComponent(sessionId)}/guided-writing`, { method: 'POST', body }),
    diagnoseEssay: (sessionId, body) => request(`essay-sessions/${encodeURIComponent(sessionId)}/diagnose`, { method: 'POST', body }),
    getRevisionSuggestions: (sessionId, body) => request(`essay-sessions/${encodeURIComponent(sessionId)}/revision-suggestions`, { method: 'POST', body }),
    compareDrafts: (sessionId, body) => request(`essay-sessions/${encodeURIComponent(sessionId)}/compare-drafts`, { method: 'POST', body }),
    createReflection: (sessionId, body) => request(`essay-sessions/${encodeURIComponent(sessionId)}/reflection`, { method: 'POST', body }),
    createStyleProfile: (body) => request('style-profile', { method: 'POST', body }),
    initialAssessment: (body) => request('ability/initial-assessment', { method: 'POST', body }),
    getAbilityProfile: () => request('ability/profile'),
    updateProfileFromReflection: (body) => request('ability/profile/update-from-reflection', { method: 'POST', body }),
    createTrainingPlan: (body) => request('training-plans', { method: 'POST', body }),
    getActiveTrainingPlan: () => request('training-plans/active'),
    getTodayTasks: () => request('training-tasks/today'),
    getTrainingTask: (taskId) => request(`training-tasks/${encodeURIComponent(taskId)}`),
    submitTrainingTask: (taskId, body) => request(`training-tasks/${encodeURIComponent(taskId)}/submissions`, { method: 'POST', body }),
    getTrainingFeedback: (taskId, body) => request(`training-tasks/${encodeURIComponent(taskId)}/feedback`, { method: 'POST', body }),
    createStageReview: (planId, body) => request(`training-plans/${encodeURIComponent(planId)}/stage-review`, { method: 'POST', body }),
    createCampPlan: (campId, body) => request(`training-camps/${encodeURIComponent(campId)}/plans`, { method: 'POST', body }),
    getErrorNotebook: () => request('error-notebook'),
    createErrorNotebookItem: (body) => request('error-notebook/items', { method: 'POST', body }),
    getGrowthTimeline: () => request('growth/timeline')
  };
})();
