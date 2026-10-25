(function(){
  function $(selector){ return document.querySelector(selector); }
  function html(element, value){ if(element) element.innerHTML = value; }
  function text(element, value){ if(element) element.textContent = value; }
  function esc(value){ return String(value || '').replace(/[&<>"']/g, (char)=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); }
  function api(){ return window.EssayCoachAPI; }

  const stageOrder = [
    'topic_angle',
    'material_questions',
    'outline_tree',
    'paragraph_guides',
    'paragraph_drafting',
    'draft_diagnosis',
    'revision_reflection'
  ];

  const trainingState = {
    activePlan: null,
    selectedStageId: '',
    busy: false,
    error: '',
    selectedAngleId: '',
    selectedAngleTitle: '',
    selectedPriorityIssueId: ''
  };

  function dayItems(plan){
    return Array.isArray(plan && plan.days) ? plan.days : [];
  }

  function currentStage(plan){
    const days = dayItems(plan);
    if(!days.length) return null;
    const currentStageId = plan?.progress?.currentStageId || '';
    return days.find((day)=> day.stageId === currentStageId)
      || days.find((day)=> day.status !== '已完成')
      || days[0];
  }

  function selectedStage(plan){
    const days = dayItems(plan);
    return days.find((day)=> day.stageId === trainingState.selectedStageId) || currentStage(plan);
  }

  function nextStageFor(plan, stageId){
    const days = dayItems(plan);
    const index = days.findIndex((day)=> day.stageId === stageId);
    return index >= 0 ? days[index + 1] : null;
  }

  function stageCanRun(plan, stage){
    if(!plan || !stage || plan.status === '已完成') return false;
    const expectedStageId = plan?.progress?.currentStageId || currentStage(plan)?.stageId || '';
    return !!expectedStageId && (stage.stageId || '') === expectedStageId;
  }

  function runStageButton(plan, stage, label){
    const canRun = stageCanRun(plan, stage);
    return `<button class="primary" type="button" data-action="run-stage"${canRun ? '' : ' disabled aria-disabled="true" title="请先完成当前阶段"'}>${esc(canRun ? label : '请先完成当前阶段')}</button>`;
  }

  function stageArtifact(plan, stageId){
    return plan?.artifacts && plan.artifacts[stageId] ? plan.artifacts[stageId] : {};
  }

  function stageInput(plan, stageId){
    return plan?.stageInputs && plan.stageInputs[stageId] ? plan.stageInputs[stageId] : {};
  }

  function firstText(){
    for(const value of arguments){
      if(String(value || '').trim()) return String(value).trim();
    }
    return '';
  }

  function setStatus(message, tone){
    const target = $('#planActionStatus');
    if(!target) return;
    target.className = 'plan-action-status soft-note' + (tone ? ' is-' + tone : '');
    target.textContent = message || '';
  }

  function setButtonBusy(button, busy){
    if(!button) return;
    if(busy){
      button.dataset.originalText = button.dataset.originalText || button.textContent;
      button.disabled = true;
      button.classList.add('button-loading');
      button.textContent = '处理中';
      return;
    }
    button.disabled = false;
    button.classList.remove('button-loading');
    if(button.dataset.originalText) button.textContent = button.dataset.originalText;
  }

  function renderCreatePanel(){
    const plan = trainingState.activePlan;
    const hasPlan = !!(plan && plan.id);
    html($('#trainingCreatePanel'), `
      <div class="training-create-actions">
        <button data-plan-type="7d" class="primary plan-create-button" type="button">${hasPlan ? '重新生成 7 天计划' : '生成 7 天计划'}</button>
      </div>
    `);
  }

  function renderStageTimeline(plan){
    const days = dayItems(plan);
    if(!days.length){
      html($('#trainingStageTimeline'), '<div class="empty-state">还没有计划。生成后这里会显示 Day 1 到 Day 7。</div>');
      return;
    }
    html($('#trainingStageTimeline'), days.map((day, index)=>`
      <button class="training-stage-chip${day.stageId === trainingState.selectedStageId ? ' active' : ''}${day.status === '已完成' ? ' completed' : ''}" type="button" data-stage-id="${esc(day.stageId || '')}">
        <span>Day ${index + 1}</span>
        <strong>${esc(day.stageTitle || day.title || '训练阶段')}</strong>
      </button>
    `).join(''));
  }

  function listMarkup(items, emptyText){
    const values = Array.isArray(items) ? items.filter(Boolean) : [];
    if(!values.length) return `<p class="hint">${esc(emptyText || '暂无')}</p>`;
    return `<ul>${values.map((item)=>`<li>${esc(itemText(item))}</li>`).join('')}</ul>`;
  }

  function itemText(item){
    if(typeof item === 'string') return item;
    if(!item || typeof item !== 'object') return '';
    if(item.feedback || item.nextHint){
      const paragraph = item.paragraphId ? String(item.paragraphId).replace(/^p(\d+)$/i, '第 $1 段') : '';
      return [paragraph, item.feedback, item.nextHint].map((part)=>String(part || '').trim()).filter(Boolean).join('：');
    }
    const subject = item.object || item.target || item.aspect || item.label || item.title || item.field || item.name || '';
    const detail = item.how || item.detail || item.text || item.description || item.suggestion || item.value || item.question || '';
    return [subject, detail].map((part)=>String(part || '').trim()).filter(Boolean).join('：') || JSON.stringify(item);
  }

  function detailTextMarkup(title, value){
    const body = String(value || '').trim();
    if(!body) return '';
    return `<div class="guidance-detail-block"><strong>${esc(title)}</strong><p>${esc(body)}</p></div>`;
  }

  function detailListMarkup(title, items){
    const values = Array.isArray(items) ? items.filter(Boolean) : (items ? [items] : []);
    if(!values.length) return '';
    return `<div class="guidance-detail-block"><strong>${esc(title)}</strong><ul>${values.map((item)=>`<li>${esc(itemText(item))}</li>`).join('')}</ul></div>`;
  }

  function renderGuideDetails(guide){
    return `
      <div class="guidance-field-grid">
        ${detailListMarkup('写作对象', guide.writingTargets || guide.writingObjects)}
        ${detailListMarkup('分别怎么写', guide.howToWrite)}
        ${detailListMarkup('细节安排', guide.detailsToInclude || guide.detailPlan)}
        ${detailListMarkup('写作顺序', guide.developmentSteps)}
        ${detailListMarkup('感官细节', guide.sensoryDetails)}
        ${detailListMarkup('心理追问', guide.innerThoughtPrompts)}
        ${detailListMarkup('必须写入', guide.mustInclude)}
        ${detailListMarkup('写作追问', guide.writingPrompts)}
        ${detailListMarkup('避免', guide.avoid)}
        ${detailListMarkup('自查', guide.selfCheck || guide.studentChecklist)}
      </div>
    `;
  }

  function renderOutlineNode(node){
    if(!node) return '';
    const children = Array.isArray(node.children) ? node.children : [];
    return `
      <li>
        <div class="outline-node">
          <strong>${esc(node.role || node.label || node.title || '节点')}</strong>
          <span>${esc(node.label || node.title || '')}</span>
          ${node.focus ? `<p>${esc(node.focus)}</p>` : ''}
          <div class="outline-node-details">
            ${detailTextMarkup('这一段写什么', node.writeTask)}
            ${detailListMarkup('写作对象', node.writingObjects)}
            ${detailListMarkup('细节安排', node.detailPlan)}
            ${detailListMarkup('事件推进', node.eventBeats)}
            ${detailTextMarkup('心理变化', node.emotionShift)}
            ${detailTextMarkup('衔接提示', node.transitionHint)}
            ${detailListMarkup('自查', node.studentChecklist)}
          </div>
        </div>
        ${children.length ? `<ul>${children.map(renderOutlineNode).join('')}</ul>` : ''}
      </li>
    `;
  }

  function renderTopicAngleStage(stage, artifact, plan){
    const ctx = plan?.context || {};
    const input = stageInput(plan, 'topic_angle');
    const angles = Array.isArray(artifact.possibleAngles) ? artifact.possibleAngles : [];
    const selectedTitle = firstText(trainingState.selectedAngleTitle, stageInput(plan, 'material_questions').selectedAngle, angles[0]?.title);
    html($('#trainingStagePanel'), `
      <article class="panel result-panel">
        <div class="feature-top"><span>Day 1</span><strong>${esc(stage.status || '未开始')}</strong></div>
        <h3>${esc(stage.stageTitle || '选出最适合写的立意')}</h3>
        <p>${esc(artifact.coreQuestion || stage.instruction || '先生成 3 个可写角度，再选择其中一个继续追问素材。')}</p>
        <div class="seven-day-plan-form">
          <label>作文题目<input id="stageTitleInput" type="text" value="${esc(firstText(input.title, ctx.title))}" placeholder="作文题目"></label>
          <label>年级<input id="stageGradeInput" type="text" value="${esc(firstText(input.grade, ctx.grade))}" placeholder="年级"></label>
          <label>文体<input id="stageGenreInput" type="text" value="${esc(firstText(input.genre, ctx.genre, '记叙文'))}" placeholder="文体"></label>
          <label>真实素材<textarea id="stageMaterialInput" rows="5" placeholder="把你想到的真实经历写在这里">${esc(firstText(input.initialMaterial, ctx.initialMaterial))}</textarea></label>
        </div>
        ${runStageButton(plan, stage, '生成立意方向')}
      </article>
    `);
    html($('#trainingArtifactPanel'), `
      <article class="panel result-panel">
        <h3>可选立意方向</h3>
        ${angles.length ? `<div class="angle-choice-grid">${angles.map((angle, index)=>`
          <button class="stage-angle-choice${selectedTitle === angle.title ? ' active' : ''}" type="button" data-action="select-angle" data-angle-id="${esc(angle.angleId || `angle_${index + 1}`)}" data-angle-title="${esc(angle.title || '')}">
            <strong>${esc(angle.title || `方向 ${index + 1}`)}</strong>
            <span>${esc(angle.prompt || '')}</span>
            <div class="guidance-field-grid angle-guidance-details">
              ${detailTextMarkup('为什么扣题', angle.whyThisFitsTopic)}
              ${detailTextMarkup('怎样使用素材', angle.materialConnection)}
              ${detailTextMarkup('写作路径', angle.writingPath)}
              ${detailListMarkup('继续追问', angle.keyDetailsToAsk)}
              ${detailTextMarkup('风险提醒', angle.riskReminder)}
            </div>
            <small>${esc(angle.materialHint || '')}</small>
          </button>
        `).join('')}</div>` : '<div class="empty-state">点击生成后，这里会出现可选择的立意方向。</div>'}
      </article>
    `);
    html($('#trainingNextStepPanel'), `
      <article class="panel result-panel">
        <h3>下一步</h3>
        <p>已选方向：${esc(selectedTitle || '还未选择')}</p>
        ${listMarkup(artifact.suggestedNextQuestions, '选择立意后进入素材追问。')}
        ${angles.length ? '<button class="primary hollow" type="button" data-action="go-next-stage">进入素材追问</button>' : ''}
      </article>
    `);
  }

  function renderMaterialQuestionsStage(stage, artifact, plan){
    const questions = Array.isArray(artifact.questions) ? artifact.questions : [];
    const previousInput = stageInput(plan, 'material_questions');
    const selectedAngle = firstText(trainingState.selectedAngleTitle, previousInput.selectedAngle, stageArtifact(plan, 'topic_angle').possibleAngles?.[0]?.title, '一次真实变化');
    html($('#trainingStagePanel'), `
      <article class="panel result-panel">
        <div class="feature-top"><span>Day 2</span><strong>${esc(stage.status || '未开始')}</strong></div>
        <h3>${esc(stage.stageTitle || '追问真实素材')}</h3>
        <label>已选择的立意<input id="selectedAngleInput" type="text" value="${esc(selectedAngle)}"></label>
        ${runStageButton(plan, stage, questions.length ? '重新生成素材追问' : '生成素材追问')}
      </article>
    `);
    html($('#trainingArtifactPanel'), `
      <article class="panel result-panel">
        <h3>素材追问</h3>
        ${questions.length ? questions.map((item, index)=>{
          const oldAnswer = Array.isArray(previousInput.answers) ? previousInput.answers.find((answer)=>answer.field === item.field || answer.question === item.question)?.answer : '';
          return `<label class="stage-question-card">
            <strong>${esc(item.question || `问题 ${index + 1}`)}</strong>
            <span>${esc(item.purpose || '')}</span>
            <textarea class="stage-answer-input" data-question-index="${index}" data-question="${esc(item.question || '')}" data-field="${esc(item.field || '')}" rows="3" placeholder="把真实回答写在这里">${esc(oldAnswer || '')}</textarea>
          </label>`;
        }).join('') : '<div class="empty-state">先生成素材追问，再逐个回答。</div>'}
      </article>
    `);
    html($('#trainingNextStepPanel'), `
      <article class="panel result-panel">
        <h3>素材检查</h3>
        ${listMarkup(artifact.materialChecklist, '回答后会提示哪些素材还需要补。')}
        ${questions.length ? '<button class="primary hollow" type="button" data-action="go-next-stage">保存回答，生成提纲树</button>' : ''}
      </article>
    `);
  }

  function renderOutlineTreeStage(stage, artifact, plan){
    const outline = artifact.outlineTree;
    html($('#trainingStagePanel'), `
      <article class="panel result-panel">
        <div class="feature-top"><span>Day 3</span><strong>${esc(stage.status || '未开始')}</strong></div>
        <h3>${esc(stage.stageTitle || '生成提纲树')}</h3>
        <p>根据前一天的素材回答，把作文拆成清楚的开头、经过、变化和结尾。</p>
        ${runStageButton(plan, stage, outline ? '重新生成提纲树' : '生成提纲树')}
      </article>
    `);
    html($('#trainingArtifactPanel'), `
      <article class="panel result-panel">
        <h3>${esc(outline?.title || '提纲树')}</h3>
        ${outline ? `<p class="hint">${esc(outline.theme || '')}</p><ul class="outline-tree">${renderOutlineNode(outline)}</ul>` : '<div class="empty-state">生成后这里会显示树形提纲。</div>'}
      </article>
    `);
    html($('#trainingNextStepPanel'), '<article class="panel result-panel"><h3>下一步</h3><p>确认提纲后，进入每段该写什么的具体提示。</p><button class="primary hollow" type="button" data-action="go-next-stage">生成段落提示</button></article>');
  }

  function renderParagraphGuidesStage(stage, artifact, plan){
    const guides = Array.isArray(artifact.paragraphGuides) ? artifact.paragraphGuides : [];
    html($('#trainingStagePanel'), `
      <article class="panel result-panel">
        <div class="feature-top"><span>Day 4</span><strong>${esc(stage.status || '未开始')}</strong></div>
        <h3>${esc(stage.stageTitle || '生成段落写作提示')}</h3>
        <p>把提纲变成每一段的写作任务，让学生知道每段该写什么。</p>
        ${runStageButton(plan, stage, guides.length ? '重新生成段落提示' : '生成段落提示')}
      </article>
    `);
    html($('#trainingArtifactPanel'), `
      <article class="panel result-panel paragraph-guide-list">
        <h3>段落写作提示</h3>
        ${guides.length ? guides.map((guide, index)=>`
          <section class="paragraph-guide-card">
            <div class="number-badge">${index + 1}</div>
            <h4>${esc(guide.role || `第 ${index + 1} 段`)}</h4>
            <p>${esc(guide.goal || '')}</p>
            ${renderGuideDetails(guide)}
            ${guide.starterHint ? `<p><strong>开头提示：</strong>${esc(guide.starterHint)}</p>` : ''}
            <small>${esc(guide.suggestedLength || '')}</small>
          </section>
        `).join('') : '<div class="empty-state">生成后这里会出现每段写作提示。</div>'}
      </article>
    `);
    html($('#trainingNextStepPanel'), '<article class="panel result-panel"><h3>下一步</h3><p>按提示逐段写草稿，最后由系统合并成完整作文。</p><button class="primary hollow" type="button" data-action="go-next-stage">开始分段写作</button></article>');
  }

  function renderParagraphDraftingStage(stage, artifact, plan){
    const guides = Array.isArray(stageArtifact(plan, 'paragraph_guides').paragraphGuides) ? stageArtifact(plan, 'paragraph_guides').paragraphGuides : [];
    const previousInput = stageInput(plan, 'paragraph_drafting');
    const drafts = Array.isArray(previousInput.paragraphDrafts) ? previousInput.paragraphDrafts : [];
    html($('#trainingStagePanel'), `
      <article class="panel result-panel">
        <div class="feature-top"><span>Day 5</span><strong>${esc(stage.status || '未开始')}</strong></div>
        <h3>${esc(stage.stageTitle || '分段写草稿')}</h3>
        <p>在每段提示下直接写正文。点击按钮后会合并成完整作文，并给出段落反馈。</p>
        ${runStageButton(plan, stage, '我写完了，合并作文')}
      </article>
    `);
    html($('#trainingArtifactPanel'), `
      <article class="panel result-panel paragraph-draft-workspace">
        <h3>分段草稿</h3>
        ${(guides.length ? guides : [{ paragraphId:'p1', role:'第 1 段', goal:'先写一段真实内容。' }]).map((guide, index)=>{
          const draft = drafts.find((item)=> item.paragraphId === guide.paragraphId)?.text || '';
          return `<label class="paragraph-draft-card">
            <strong>${esc(guide.role || `第 ${index + 1} 段`)}</strong>
            <span>${esc(guide.goal || '')}</span>
            ${renderGuideDetails(guide)}
            <textarea class="paragraph-draft-input" data-paragraph-id="${esc(guide.paragraphId || `p${index + 1}`)}" rows="6" placeholder="${esc(guide.starterHint || '从这里开始写这一段')}">${esc(draft)}</textarea>
          </label>`;
        }).join('')}
      </article>
    `);
    html($('#trainingNextStepPanel'), `
      <article class="panel result-panel">
        <h3>合并结果</h3>
        ${artifact.mergedDraft ? `<textarea id="mergedDraftPreview" rows="8">${esc(artifact.mergedDraft)}</textarea>${listMarkup(artifact.paragraphFeedback, '暂无段落反馈')}<button class="primary hollow" type="button" data-action="go-next-stage">进入草稿诊断</button>` : '<div class="empty-state">提交后这里会显示合并后的完整草稿。</div>'}
      </article>
    `);
  }

  function renderDraftDiagnosisStage(stage, artifact, plan){
    const draft = firstText(stageInput(plan, 'draft_diagnosis').mergedDraft, stageArtifact(plan, 'paragraph_drafting').mergedDraft);
    const issues = Array.isArray(artifact.priorityIssues) ? artifact.priorityIssues : [];
    html($('#trainingStagePanel'), `
      <article class="panel result-panel">
        <div class="feature-top"><span>Day 6</span><strong>${esc(stage.status || '未开始')}</strong></div>
        <h3>${esc(stage.stageTitle || '诊断完整草稿')}</h3>
        <label>完整草稿<textarea id="diagnosisDraftInput" rows="8" placeholder="粘贴或保留上一步合并出的作文">${esc(draft)}</textarea></label>
        ${runStageButton(plan, stage, '诊断草稿')}
      </article>
    `);
    html($('#trainingArtifactPanel'), `
      <article class="panel result-panel">
        <h3>优先修改问题</h3>
        ${artifact.overallComment ? `<p>${esc(artifact.overallComment)}</p>` : ''}
        ${issues.length ? `<div class="issue-choice-list">${issues.map((issue)=>`
          <button class="priority-issue-choice${trainingState.selectedPriorityIssueId === issue.issueId ? ' active' : ''}" type="button" data-action="select-priority-issue" data-issue-id="${esc(issue.issueId || '')}">
            <strong>${esc(issue.title || '需要修改的问题')}</strong>
            <span>${esc(issue.explanation || '')}</span>
            <small>${esc(issue.suggestion || '')}</small>
          </button>
        `).join('')}</div>` : '<div class="empty-state">诊断后会出现优先修改问题。</div>'}
      </article>
    `);
    html($('#trainingNextStepPanel'), `
      <article class="panel result-panel">
        <h3>修改目标</h3>
        ${listMarkup(artifact.revisionTargets, '诊断后会生成修改目标。')}
        ${issues.length ? '<button class="primary hollow" type="button" data-action="go-next-stage">进入复盘</button>' : ''}
      </article>
    `);
  }

  function renderRevisionReflectionStage(stage, artifact, plan){
    const revised = firstText(stageInput(plan, 'revision_reflection').revisedText, stageArtifact(plan, 'paragraph_drafting').mergedDraft);
    html($('#trainingStagePanel'), `
      <article class="panel result-panel">
        <div class="feature-top"><span>Day 7</span><strong>${esc(stage.status || '未开始')}</strong></div>
        <h3>${esc(stage.stageTitle || '复盘与下一步')}</h3>
        <label>修改后的作文<textarea id="revisedDraftInput" rows="8" placeholder="贴入你修改后的作文">${esc(revised)}</textarea></label>
        <label>我这次学到的写法<textarea id="studentSelfReflectionInput" rows="4" placeholder="例如：我学会了用动作写紧张，而不是只写我很紧张">${esc(stageInput(plan, 'revision_reflection').studentSelfReflection || '')}</textarea></label>
        ${runStageButton(plan, stage, '完成复盘')}
      </article>
    `);
    html($('#trainingArtifactPanel'), `
      <article class="panel result-panel">
        <h3>训练复盘</h3>
        ${artifact.summary ? `<p>${esc(artifact.summary)}</p>` : '<div class="empty-state">完成复盘后，这里会沉淀本次训练结果。</div>'}
        <h4>已经练到</h4>
        ${listMarkup(artifact.learnedSkills, '暂无')}
        <h4>下一次继续练</h4>
        ${listMarkup(artifact.suggestedTrainingFocus, '暂无')}
      </article>
    `);
    html($('#trainingNextStepPanel'), '<article class="panel result-panel"><h3>完成状态</h3><p>提交复盘后，本次 7 天训练闭环完成。</p></article>');
  }

  function renderStagePanel(plan){
    const stage = selectedStage(plan);
    if(!stage){
      html($('#trainingStagePanel'), '<div class="empty-state">当前阶段工作区将在生成计划后出现。</div>');
      html($('#trainingArtifactPanel'), '<div class="empty-state">阶段结果会显示在这里。</div>');
      html($('#trainingNextStepPanel'), '<div class="empty-state">下一步提示会显示在这里。</div>');
      return;
    }
    trainingState.selectedStageId = stage.stageId || '';
    const artifact = stageArtifact(plan, stage.stageId);
    if(stage.stageId === 'topic_angle') return renderTopicAngleStage(stage, artifact, plan);
    if(stage.stageId === 'material_questions') return renderMaterialQuestionsStage(stage, artifact, plan);
    if(stage.stageId === 'outline_tree') return renderOutlineTreeStage(stage, artifact, plan);
    if(stage.stageId === 'paragraph_guides') return renderParagraphGuidesStage(stage, artifact, plan);
    if(stage.stageId === 'paragraph_drafting') return renderParagraphDraftingStage(stage, artifact, plan);
    if(stage.stageId === 'draft_diagnosis') return renderDraftDiagnosisStage(stage, artifact, plan);
    return renderRevisionReflectionStage(stage, artifact, plan);
  }

  function collectCurrentStageInput(plan, stage){
    const ctx = plan?.context || {};
    if(stage.stageId === 'topic_angle'){
      return {
        title: $('#stageTitleInput')?.value || ctx.title || '',
        grade: $('#stageGradeInput')?.value || ctx.grade || '',
        genre: $('#stageGenreInput')?.value || ctx.genre || '',
        initialMaterial: $('#stageMaterialInput')?.value || ctx.initialMaterial || ''
      };
    }
    if(stage.stageId === 'material_questions'){
      return {
        selectedAngle: $('#selectedAngleInput')?.value || trainingState.selectedAngleTitle || '',
        initialMaterial: ctx.initialMaterial || '',
        answers: Array.from(document.querySelectorAll('.stage-answer-input')).map((field)=>({
          field: field.dataset.field || '',
          question: field.dataset.question || '',
          answer: field.value || ''
        }))
      };
    }
    if(stage.stageId === 'outline_tree'){
      return {
        title: ctx.title || '',
        grade: ctx.grade || '',
        genre: ctx.genre || '',
        materialAnswers: stageInput(plan, 'material_questions').answers || []
      };
    }
    if(stage.stageId === 'paragraph_guides'){
      return {
        outlineTree: stageArtifact(plan, 'outline_tree').outlineTree || null
      };
    }
    if(stage.stageId === 'paragraph_drafting'){
      return {
        paragraphDrafts: Array.from(document.querySelectorAll('.paragraph-draft-input')).map((field)=>({
          paragraphId: field.dataset.paragraphId || '',
          text: field.value || ''
        }))
      };
    }
    if(stage.stageId === 'draft_diagnosis'){
      return {
        mergedDraft: $('#diagnosisDraftInput')?.value || stageArtifact(plan, 'paragraph_drafting').mergedDraft || ''
      };
    }
    return {
      revisedText: $('#revisedDraftInput')?.value || '',
      studentSelfReflection: $('#studentSelfReflectionInput')?.value || '',
      selectedPriorityIssueId: trainingState.selectedPriorityIssueId || ''
    };
  }

  function cacheCurrentStageInput(){
    const plan = trainingState.activePlan;
    const stage = selectedStage(plan);
    if(!plan || !stage) return;
    plan.stageInputs = {
      ...(plan.stageInputs || {}),
      [stage.stageId]: collectCurrentStageInput(plan, stage)
    };
  }

  function mergeStageRunResult(plan, result){
    const next = { ...(plan || {}) };
    const stageId = result.stageId || trainingState.selectedStageId;
    next.artifacts = { ...(next.artifacts || {}), [stageId]: result.artifact || {} };
    next.stageInputs = { ...(next.stageInputs || {}), [stageId]: result.input || stageInput(plan, stageId) };
    next.progress = result.planProgress || next.progress || {};
    next.status = result.planStatus || next.status || '进行中';
    next.days = dayItems(next).map((day)=> day.taskId === result.taskId ? { ...day, status: '已完成' } : day);
    trainingState.selectedStageId = stageId;
    return next;
  }

  async function runSelectedStage(button){
    const plan = trainingState.activePlan;
    const stage = selectedStage(plan);
    if(!api() || !plan?.id || !stage?.taskId) return;
    if(!stageCanRun(plan, stage)){
      setStatus('请按顺序完成当前阶段，再继续后面的训练。', 'error');
      return;
    }
    try{
      setButtonBusy(button, true);
      setStatus('正在生成本阶段指导...');
      const input = collectCurrentStageInput(plan, stage);
      const result = await api().runTrainingPlanTask(plan.id, stage.taskId, { input });
      const nextPlan = mergeStageRunResult(plan, { ...result, input });
      renderTrainingWorkspace(nextPlan);
      setStatus(result.uiHints?.successMessage || '本阶段已完成，可以继续下一步。', 'success');
    }catch(error){
      setStatus('阶段生成失败：' + (error && error.message ? error.message : '服务暂时不可用'), 'error');
    }finally{
      setButtonBusy(button, false);
    }
  }

  function renderTrainingWorkspace(plan){
    trainingState.activePlan = plan || null;
    const fallbackStage = currentStage(plan);
    if(plan && !trainingState.selectedStageId){
      trainingState.selectedStageId = fallbackStage?.stageId || stageOrder[0];
    }
    if(plan && trainingState.selectedStageId && !dayItems(plan).some((day)=> day.stageId === trainingState.selectedStageId)){
      trainingState.selectedStageId = fallbackStage?.stageId || '';
    }
    const hasPlan = !!(plan && plan.id);
    text($('#planStatus'), hasPlan ? (plan.status || '进行中') : '未创建');
    renderCreatePanel();
    renderStageTimeline(plan);
    renderStagePanel(plan);
  }

  async function refreshActivePlan(){
    renderTrainingWorkspace(null);
    if(!api()) return;
    try{
      const plan = await api().getActiveTrainingPlan();
      trainingState.selectedStageId = currentStage(plan)?.stageId || '';
      renderTrainingWorkspace(plan);
    }catch(error){
      setStatus('训练计划读取失败：' + (error && error.message ? error.message : '服务暂时不可用'), 'error');
    }
  }

  async function createPlan(button){
    if(!api()) return;
    const ctx = trainingState.activePlan?.context || {};
    try{
      setButtonBusy(button, true);
      setStatus('正在生成 7 天计划...');
      const plan = await api().createTrainingPlan({
        planType: '7d',
        dailyMinutes: 15,
        title: ctx.title || '',
        grade: ctx.grade || '',
        genre: ctx.genre || '',
        initialMaterial: ctx.initialMaterial || '',
        goal: '完成一篇单篇作文训练'
      });
      trainingState.selectedStageId = currentStage(plan)?.stageId || '';
      trainingState.selectedAngleId = '';
      trainingState.selectedAngleTitle = '';
      trainingState.selectedPriorityIssueId = '';
      renderTrainingWorkspace(plan);
      setStatus('7 天计划已创建。先从 Day 1 生成立意方向开始。', 'success');
    }catch(error){
      setStatus('生成计划失败：' + (error && error.message ? error.message : '服务暂时不可用'), 'error');
    }finally{
      setButtonBusy(button, false);
    }
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    refreshActivePlan();
    document.addEventListener('click', (event)=>{
      const createButton = event.target.closest('[data-plan-type="7d"]');
      if(createButton) return createPlan(createButton);

      const stageButton = event.target.closest('[data-stage-id]');
      if(stageButton){
        trainingState.selectedStageId = stageButton.dataset.stageId || '';
        renderTrainingWorkspace(trainingState.activePlan);
        return;
      }

      const angleButton = event.target.closest('[data-action="select-angle"]');
      if(angleButton){
        trainingState.selectedAngleId = angleButton.dataset.angleId || '';
        trainingState.selectedAngleTitle = angleButton.dataset.angleTitle || '';
        renderTrainingWorkspace(trainingState.activePlan);
        setStatus('已选择立意方向：' + trainingState.selectedAngleTitle, 'success');
        return;
      }

      const issueButton = event.target.closest('[data-action="select-priority-issue"]');
      if(issueButton){
        trainingState.selectedPriorityIssueId = issueButton.dataset.issueId || '';
        renderTrainingWorkspace(trainingState.activePlan);
        return;
      }

      const nextButton = event.target.closest('[data-action="go-next-stage"]');
      if(nextButton){
        cacheCurrentStageInput();
        const nextStage = nextStageFor(trainingState.activePlan, trainingState.selectedStageId);
        if(nextStage){
          trainingState.selectedStageId = nextStage.stageId || '';
          renderTrainingWorkspace(trainingState.activePlan);
        }
        return;
      }

      const runButton = event.target.closest('[data-action="run-stage"]');
      if(runButton) runSelectedStage(runButton);
    });
  });
})();
