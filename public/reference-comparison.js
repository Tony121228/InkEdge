(function () {
  const CONTEXT_KEY = 'inkedgeReferenceComparisonContext';
  const elements = {
    essayTitle: document.getElementById('essayTitle'),
    revisionSuggestionPanel: document.getElementById('revisionSuggestionPanel'),
    priorityIssuesPanel: document.getElementById('priorityIssuesPanel'),
    priorityIssuesList: document.getElementById('priorityIssuesList'),
    revisionSuggestionText: document.getElementById('revisionSuggestionText'),
    changeSummaryPanel: document.getElementById('changeSummaryPanel'),
    changeSummaryList: document.getElementById('changeSummaryList'),
    generationStatus: document.getElementById('generationStatus'),
    errorPanel: document.getElementById('errorPanel'),
    errorMessage: document.getElementById('errorMessage'),
    retryButton: document.getElementById('retryButton'),
    comparisonGrid: document.querySelector('.comparison-grid'),
    originalEssay: document.getElementById('originalEssay'),
    referenceEssay: document.getElementById('referenceEssay'),
    generateButton: document.getElementById('generateButton'),
    copyButton: document.getElementById('copyButton'),
    copyStatus: document.getElementById('copyStatus')
  };

  function readContext() {
    try {
      const raw = window.sessionStorage.getItem(CONTEXT_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const context = {
        sessionId: typeof value.sessionId === 'string' ? value.sessionId.trim() : '',
        originalText: typeof value.originalText === 'string' ? value.originalText.trim() : '',
        diagnosticId: typeof value.diagnosticId === 'string' ? value.diagnosticId.trim() : '',
        revisionGoal: typeof value.revisionGoal === 'string' ? value.revisionGoal.trim() : '',
        revisionDepth: typeof value.revisionDepth === 'string' ? value.revisionDepth.trim() : '',
        revisionSuggestionText: typeof value.revisionSuggestionText === 'string' ? value.revisionSuggestionText.trim() : '',
        priorityIssues: Array.isArray(value.priorityIssues) ? value.priorityIssues.slice(0, 8) : [],
        diagnostic: value.diagnostic && typeof value.diagnostic === 'object' && !Array.isArray(value.diagnostic)
          ? value.diagnostic
          : null,
        suggestion: value.suggestion == null ? null : value.suggestion
      };
      return context.sessionId && context.originalText && context.diagnosticId ? context : null;
    } catch (_) {
      return null;
    }
  }

  const context = readContext();
  let revisedText = '';

  function setPlaceholder(target, message) {
    const paragraph = document.createElement('p');
    paragraph.className = 'placeholder';
    paragraph.textContent = message;
    target.replaceChildren(paragraph);
    target.classList.remove('has-content');
  }

  function setEssayText(target, value) {
    target.textContent = String(value || '');
    target.classList.add('has-content');
  }

  function setError(message) {
    elements.errorMessage.textContent = message;
    elements.errorPanel.hidden = false;
    elements.generationStatus.textContent = '需要处理';
  }

  function clearError() {
    elements.errorPanel.hidden = true;
    elements.errorMessage.textContent = '';
  }

  function setLoading(isLoading) {
    elements.comparisonGrid.setAttribute('aria-busy', String(isLoading));
    elements.generateButton.disabled = isLoading || !context;
    elements.retryButton.disabled = isLoading || !context;
    elements.copyButton.disabled = isLoading || !revisedText;
    elements.generateButton.textContent = isLoading
      ? '正在生成…'
      : revisedText ? '重新生成参考稿' : '生成参考稿';
    elements.generationStatus.textContent = isLoading
      ? '正在生成'
      : revisedText ? '已完成' : '准备生成';
  }

  function suggestionPayload() {
    if (!context.suggestion) return {};
    if (typeof context.suggestion === 'object' && !Array.isArray(context.suggestion)) {
      const suggestionId = String(context.suggestion.suggestionId || context.suggestion.revisionId || '').trim();
      if (suggestionId) return { suggestionId };
    }
    return { revisionSuggestion: context.suggestion };
  }

  function renderPriorityIssues(items) {
    const issues = Array.isArray(items) ? items.filter(Boolean).slice(0, 8) : [];
    elements.priorityIssuesList.replaceChildren();
    for (const issue of issues) {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      const explanation = document.createElement('p');
      const suggestion = document.createElement('p');
      title.textContent = String(issue?.title || issue?.type || '优先问题');
      explanation.textContent = String(issue?.explanation || issue?.description || '体检报告指出该问题需要优先处理。');
      suggestion.textContent = issue?.suggestion ? `修改建议：${String(issue.suggestion)}` : '';
      item.append(title, explanation);
      if (suggestion.textContent) item.append(suggestion);
      elements.priorityIssuesList.append(item);
    }
    elements.priorityIssuesPanel.hidden = issues.length === 0;
  }

  function renderChangeSummary(items) {
    const changes = Array.isArray(items) ? items : [];
    elements.changeSummaryList.replaceChildren();
    for (const change of changes) {
      const item = document.createElement('li');
      const location = document.createElement('strong');
      const modification = document.createElement('p');
      location.textContent = String(change?.location || '改动位置');
      modification.textContent = String(change?.modification || '');
      item.append(location, modification);
      elements.changeSummaryList.append(item);
    }
    elements.changeSummaryPanel.hidden = changes.length === 0;
  }

  async function generate() {
    if (!context) {
      setError('没有读取到本次作文的对照信息。请返回工作台，在作文体检或修改建议结果中点击“参考对照”进入。');
      return;
    }
    if (!window.EssayCoachAPI || typeof window.EssayCoachAPI.generateReferenceRewrite !== 'function') {
      setError('作文服务尚未就绪，请刷新页面后重试；仍无法使用时请返回工作台。');
      return;
    }

    clearError();
    setLoading(true);
    elements.copyStatus.textContent = '';
    if (!revisedText) setPlaceholder(elements.referenceEssay, '正在根据原文和修改方向生成参考稿…');

    const body = {
      originalText: context.originalText,
      diagnosticId: context.diagnosticId,
      revisionGoal: context.revisionGoal,
      revisionDepth: context.revisionDepth,
      revisionSuggestionText: context.revisionSuggestionText,
      priorityIssues: context.priorityIssues,
      ...suggestionPayload()
    };
    try {
      const result = await window.EssayCoachAPI.generateReferenceRewrite(context.sessionId, body);
      const canonicalOriginal = typeof result?.originalText === 'string' ? result.originalText : context.originalText;
      revisedText = typeof result?.revisedText === 'string' ? result.revisedText : '';
      if (!revisedText.trim()) throw new Error('服务没有返回可用的参考稿，请重试。');

      setEssayText(elements.originalEssay, canonicalOriginal);
      setEssayText(elements.referenceEssay, revisedText);
      renderChangeSummary(result?.changes);
      setLoading(false);
    } catch (error) {
      const message = error && error.message ? error.message : '生成参考稿失败，请重试。';
      setError(message);
      setLoading(false);
      if (!revisedText) setPlaceholder(elements.referenceEssay, '生成失败后可重试；作文原文仍保留在左侧。');
    }
  }

  async function copyReference() {
    if (!revisedText) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(revisedText);
      } else {
        const field = document.createElement('textarea');
        field.value = revisedText;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.append(field);
        field.select();
        const copied = document.execCommand('copy');
        field.remove();
        if (!copied) throw new Error('clipboard-unavailable');
      }
      elements.copyStatus.textContent = '参考稿已复制';
    } catch (_) {
      elements.copyStatus.textContent = '复制失败，请手动选择右侧参考稿进行复制。';
    }
  }

  elements.generateButton.addEventListener('click', generate);
  elements.retryButton.addEventListener('click', generate);
  elements.copyButton.addEventListener('click', copyReference);

  if (context) {
    const diagnosticTitle = context.diagnostic?.title || context.diagnostic?.essayTitle;
    elements.essayTitle.textContent = typeof diagnosticTitle === 'string' && diagnosticTitle.trim()
      ? diagnosticTitle.trim()
      : '当前作文';
    setEssayText(elements.originalEssay, context.originalText);
    if (context.revisionSuggestionText) {
      elements.revisionSuggestionText.textContent = context.revisionSuggestionText;
      elements.revisionSuggestionPanel.hidden = false;
    }
    renderPriorityIssues(context.priorityIssues || context.diagnostic?.priorityIssues);
    if ((context.priorityIssues || context.diagnostic?.priorityIssues || []).length) {
      elements.revisionSuggestionPanel.hidden = false;
    }
    setLoading(false);
    generate();
  } else {
    setPlaceholder(elements.originalEssay, '未读取到作文内容。');
    setPlaceholder(elements.referenceEssay, '请从作文修改结果进入参考对照。');
    elements.generateButton.disabled = true;
    elements.retryButton.disabled = true;
    setError('没有读取到本次作文的对照信息。请返回工作台，在作文体检或修改建议结果中点击“参考对照”进入。');
    elements.generationStatus.textContent = '上下文缺失';
  }
})();
