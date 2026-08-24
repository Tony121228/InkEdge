const {
  analyzeRhythm,
  countCjk,
  countMatches,
  splitParagraphs,
  splitSentences
} = require('./text-metrics');
const { analyzeFormatDiagnostics } = require('./diagnostics');
const { buildStructureEditHints, sentenceHasFactAnchor, sentenceLooksTemplate } = require('./essay-structure');

const MATERIAL_FIELDS = [
  { field: 'event', label: '事件', question: '这件事具体是什么？请用一句话说清楚。' },
  { field: 'people', label: '人物', question: '当时你身边还有谁？这个人做了什么或说了什么？' },
  { field: 'time', label: '时间', question: '这件事发生在什么时候？能不能具体到某一天或某个场景？' },
  { field: 'place', label: '地点', question: '事情发生在哪里？那个地方有什么容易让人看见的细节？' },
  { field: 'actions', label: '动作', question: '你当时最明显的一个动作是什么？别人能看见什么？' },
  { field: 'dialogue', label: '对话', question: '有没有一句真实说过的话可以写进去？' },
  { field: 'feelings', label: '感受', question: '那一刻你心里最直接的感受是什么？不要先写大道理。' },
  { field: 'sensoryDetails', label: '感官细节', question: '你当时看到、听到或摸到的一个具体细节是什么？' }
];

const DIMENSIONS = {
  topicFit: '审题贴合度',
  ideaClarity: '立意清晰度',
  materialSpecificity: '素材具体度',
  structureClarity: '结构清晰度',
  emotionNaturalness: '情感自然度',
  languageNaturalness: '语言自然度',
  studentVoiceFit: '学生口吻贴合度'
};

function normalizeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (!value) return [];
  return [String(value).trim()].filter(Boolean);
}

function titleKeywords(title) {
  const raw = normalizeText(title, 80);
  const quoted = Array.from(raw.matchAll(/[《“"]([^》”"]{1,18})[》”"]/g)).map((match) => match[1]);
  const chunks = raw
    .replace(/[《》“”"：:，,。.!！?？]/g, ' ')
    .split(/\s+|、|和|与|的|我/)
    .map((item) => item.trim())
    .filter((item) => countCjk(item) >= 2 && countCjk(item) <= 10);
  return Array.from(new Set([...quoted, ...chunks])).slice(0, 6);
}

function inferTheme(title) {
  const raw = normalizeText(title, 120);
  if (/成长|长大|懂得|明白|改变|第一次/.test(raw)) return '成长';
  if (/亲情|家|父|母|妈妈|爸爸|爷爷|奶奶/.test(raw)) return '亲情';
  if (/朋友|同学|友谊|伙伴/.test(raw)) return '友情';
  if (/校园|老师|课堂|班级|同桌/.test(raw)) return '校园';
  if (/挫折|失败|困难|坚持|勇气/.test(raw)) return '挫折';
  if (/责任|担当|选择|诚信/.test(raw)) return '责任';
  if (/风景|家乡|春|夏|秋|冬|雨|花/.test(raw)) return '观察';
  return '真实经历';
}

function buildTopicAnalysis({ title, genre, grade, target } = {}) {
  const normalizedTitle = normalizeText(title, 120);
  const theme = inferTheme(normalizedTitle);
  const keywords = titleKeywords(normalizedTitle);
  const coreKeyword = keywords[0] || normalizedTitle || '题目';
  const coreQuestion = `这个题目真正要写的不是一句口号，而是围绕“${coreKeyword}”选一个具体时刻，写清楚事情怎样发生、你怎样判断、最后有什么变化。`;
  const possibleAngles = [
    {
      angleId: 'angle_growth_moment',
      title: `${theme}中的一个具体瞬间`,
      prompt: '适合写一件有转折的小事，把“我原来怎么想”和“后来怎么变”写出来。',
      materialHint: '优先找考试、比赛、家务、课堂、同伴相处中的真实经历。'
    },
    {
      angleId: 'angle_relationship',
      title: `从一个人身上看见${theme}`,
      prompt: '适合写一个人做出的具体动作或一句话，不要只写“他很关心我”。',
      materialHint: '补充人物、动作、对话和你的即时反应。'
    },
    {
      angleId: 'angle_object_scene',
      title: `用一个物品或场景承载${theme}`,
      prompt: '适合写课桌、试卷、雨伞、路灯、操场等可看见的对象。',
      materialHint: '补充地点、物品状态、声音或光线，让文章有画面。'
    }
  ];
  return {
    topicKeywords: keywords.length ? keywords : [normalizedTitle || '作文题目'],
    coreQuestion,
    possibleAngles,
    riskyAngles: [
      { title: '只写大道理', reason: '容易空泛，缺少能让读者相信的经历。' },
      { title: '套用万能开头结尾', reason: '会让文章像模板，和学生自己的经历距离太远。' }
    ],
    suggestedNextQuestions: MATERIAL_FIELDS.slice(0, 6).map((item) => item.question),
    context: { title: normalizedTitle, genre: normalizeText(genre, 20), grade: normalizeText(grade, 20), target: normalizeText(target, 40) }
  };
}

function materialValue(materials, field) {
  if (!materials) return '';
  if (Array.isArray(materials)) {
    return materials.map((item) => materialValue(item, field)).filter(Boolean).join('；');
  }
  const value = materials[field];
  if (Array.isArray(value)) return value.join('、');
  return String(value || '').trim();
}

function buildMaterialChecklist(existingMaterials = {}, missingFields = []) {
  const missingSet = new Set(normalizeArray(missingFields));
  return MATERIAL_FIELDS.map((item) => {
    const value = materialValue(existingMaterials, item.field);
    const present = !!value && countCjk(value) >= 2 && !missingSet.has(item.field);
    return {
      field: item.field,
      label: item.label,
      present,
      value: value.slice(0, 80),
      suggestion: present ? '已有素材，后续写作时注意保留事实边界。' : item.question
    };
  });
}

function buildMaterialQuestions({ selectedAngle, existingMaterials, missingFields } = {}) {
  const checklist = buildMaterialChecklist(existingMaterials, missingFields);
  const questions = checklist
    .filter((item) => !item.present)
    .slice(0, 5)
    .map((item) => ({
      field: item.field,
      question: item.suggestion,
      purpose: `补齐${item.label}，避免系统或学生自己编空话。`
    }));
  return {
    questions,
    materialChecklist: checklist,
    nextAction: questions.length >= 3 ? 'continue_questions' : 'generate_outline',
    selectedAngle: normalizeText(selectedAngle, 80)
  };
}

function scoreMaterialCompleteness(material = {}) {
  const checklist = buildMaterialChecklist(material);
  const presentCount = checklist.filter((item) => item.present).length;
  return Math.round((presentCount / checklist.length) * 100);
}

function saveMaterialCard(material = {}) {
  const completenessScore = scoreMaterialCompleteness(material);
  return {
    material: {
      event: normalizeText(material.event, 160),
      people: normalizeArray(material.people),
      time: normalizeText(material.time, 80),
      place: normalizeText(material.place, 80),
      actions: normalizeArray(material.actions),
      dialogue: normalizeText(material.dialogue, 160),
      feelings: normalizeArray(material.feelings),
      sensoryDetails: normalizeArray(material.sensoryDetails)
    },
    completenessScore,
    missingSuggestions: buildMaterialChecklist(material).filter((item) => !item.present).map((item) => item.suggestion)
  };
}

function materialSummary(materials = []) {
  const list = Array.isArray(materials) ? materials : [materials];
  const first = list[0] || {};
  return {
    event: materialValue(first, 'event') || '选定的一件真实小事',
    people: materialValue(first, 'people') || '我和相关人物',
    action: materialValue(first, 'actions') || '一个能看见的关键动作',
    feeling: materialValue(first, 'feelings') || '事情发生时的真实感受'
  };
}

function buildOutline({ selectedAngle, materials, preferredStructure, genre } = {}) {
  const summary = materialSummary(materials);
  const structure = normalizeText(preferredStructure, 60) || normalizeText(genre, 30) || '记叙文';
  const outlines = [
    {
      outlineId: 'outline_scene_first',
      title: '画面切入式',
      structure,
      paragraphs: [
        { role: '开头', instruction: `直接写${summary.event}中的一个画面，少用大口号。` },
        { role: '起因', instruction: `交代事情为什么发生，带出${summary.people}。` },
        { role: '经过', instruction: `重点写${summary.action}，让读者看见过程。` },
        { role: '转折', instruction: `写清楚你当时的想法怎样变化。` },
        { role: '结尾', instruction: `回扣“${normalizeText(selectedAngle, 30) || '题目'}”，用具体感受收束。` }
      ]
    },
    {
      outlineId: 'outline_contrast',
      title: '前后对比式',
      structure,
      paragraphs: [
        { role: '开头', instruction: '先写“我原来怎么想”，控制在两三句话。' },
        { role: '事件', instruction: `展开${summary.event}，保留人物和动作。` },
        { role: '关键瞬间', instruction: '单独写一个最能说明变化的细节。' },
        { role: '变化', instruction: `写${summary.feeling}，但要从事件里自然长出来。` }
      ]
    }
  ];
  return {
    outlines,
    recommendedOutlineId: outlines[0].outlineId,
    warnings: [
      '不要默认生成整篇作文，先让学生确认素材是否真实。',
      '如果关键事件只有一句话，先继续追问动作、对话和地点。'
    ]
  };
}

function estimateSpecificity(text) {
  const raw = normalizeText(text);
  const sentences = splitSentences(raw);
  const factSentences = sentences.filter(sentenceHasFactAnchor).length;
  const detailHits = countMatches(raw, /“|”|"|\d|那天|放学|清晨|傍晚|书桌|教室|操场|妈妈|老师|同学|试卷|本子/g);
  const base = 45 + factSentences * 8 + detailHits * 3;
  return Math.max(20, Math.min(95, base));
}

function dimensionItem(key, score, evidence, suggestion) {
  return {
    key,
    name: DIMENSIONS[key],
    score: Math.max(0, Math.min(100, Math.round(score))),
    level: score >= 80 ? '较好' : score >= 60 ? '可提升' : '优先修改',
    evidence,
    suggestion
  };
}

function buildDimensionScores({ text, title } = {}) {
  const raw = normalizeText(text);
  const titleHits = titleKeywords(title).filter((keyword) => raw.includes(keyword)).length;
  const paragraphs = splitParagraphs(raw);
  const sentences = splitSentences(raw);
  const templateSentences = sentences.filter(sentenceLooksTemplate);
  const rhythm = analyzeRhythm(raw);
  const specificity = estimateSpecificity(raw);
  return {
    topicFit: dimensionItem('topicFit', 58 + titleHits * 12, titleHits ? '正文回应了部分题目关键词。' : '正文和题目关键词连接还不明显。', '开头或结尾补一句和题目直接相关的具体判断。'),
    ideaClarity: dimensionItem('ideaClarity', /明白|懂得|改变|发现|学会/.test(raw) ? 70 : 55, '文章已有中心倾向，但需要让中心从事件中自然出现。', '把中心落到一个具体变化，不要只写“更好的自己”。'),
    materialSpecificity: dimensionItem('materialSpecificity', specificity, '按人物、动作、时间、地点和对话判断素材具体度。', '优先补一个动作、一个地点和一句真实对话。'),
    structureClarity: dimensionItem('structureClarity', paragraphs.length >= 3 ? 72 : 55, paragraphs.length >= 3 ? '段落层次基本可见。' : '段落数量偏少，起因、经过、变化容易挤在一起。', '按开头、起因、经过、转折、结尾拆开。'),
    emotionNaturalness: dimensionItem('emotionNaturalness', /从那以后|今后|未来|做更好的自己|一束光/.test(raw) ? 52 : 72, '检查情感是否直接拔高。', '情感句前面先补事实，不要让结尾突然喊口号。'),
    languageNaturalness: dimensionItem('languageNaturalness', templateSentences.length ? 50 : Math.max(60, 80 - rhythm.rhythmScore / 2), templateSentences.length ? '存在较模板化的表达。' : rhythm.verdict, '删掉万能句，改成学生能自然说出来的话。'),
    studentVoiceFit: dimensionItem('studentVoiceFit', countMatches(raw, /不负韶华|奔赴远方|闪闪发光|人生道路|成长是一束光/g) ? 48 : 68, '检查是否出现过度成熟或模板化口吻。', '保留朴素表达，少用过度漂亮的金句。')
  };
}

function buildPriorityIssues(dimensionScores, highlightedSegments) {
  const weakDimensions = Object.values(dimensionScores)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);
  return weakDimensions.map((item, index) => ({
    issueId: `issue_${index + 1}`,
    dimension: item.key,
    title: `${item.name}需要优先提升`,
    severity: item.score < 55 ? 'high' : 'medium',
    explanation: item.evidence,
    suggestion: item.suggestion,
    relatedSegmentId: highlightedSegments[index]?.segmentId || ''
  }));
}

function buildHighlightedSegments(text) {
  const diagnostics = analyzeFormatDiagnostics(text).map((item) => ({
    segment: item.segment,
    reason: item.reason,
    suggestion: item.suggestion,
    category: item.category
  }));
  const structureHints = buildStructureEditHints(text).map((item) => ({
    segment: item.segment,
    reason: item.reason,
    suggestion: item.target,
    category: item.problemType
  }));
  const sentenceHints = splitSentences(text)
    .filter((sentence) => sentenceLooksTemplate(sentence) || (!sentenceHasFactAnchor(sentence) && countCjk(sentence) >= 22))
    .slice(0, 4)
    .map((sentence) => ({
      segment: sentence,
      reason: sentenceLooksTemplate(sentence) ? '句子像万能模板，和真实经历连接较弱。' : '句子较空，需要补可看见的细节。',
      suggestion: '先问清楚人物、动作、地点或对话，再考虑改写。',
      category: '空泛表达'
    }));
  const merged = [...diagnostics, ...structureHints, ...sentenceHints];
  const seen = new Set();
  return merged
    .filter((item) => {
      const key = item.segment;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6)
    .map((item, index) => ({
      segmentId: `segment_${index + 1}`,
      text: item.segment,
      issueType: item.category || '表达问题',
      reason: item.reason,
      suggestion: item.suggestion
    }));
}

function buildDiagnosis({ draftText, title, genre, grade, userGoal } = {}) {
  const text = normalizeText(draftText);
  const dimensionScores = buildDimensionScores({ text, title, genre, grade });
  const highlightedSegments = buildHighlightedSegments(text);
  const priorityIssues = buildPriorityIssues(dimensionScores, highlightedSegments);
  const average = Object.values(dimensionScores).reduce((sum, item) => sum + item.score, 0) / Object.values(dimensionScores).length;
  return {
    overallComment: average >= 75
      ? '这篇作文已有基本内容，下一步可以集中打磨细节和表达自然度。'
      : '这篇作文可以先从补真实素材、拆清结构和压缩空泛句入手。',
    dimensionScores,
    priorityIssues,
    highlightedSegments,
    suggestedRevisionPath: priorityIssues.map((item) => item.title),
    context: { title: normalizeText(title, 120), genre: normalizeText(genre, 20), grade: normalizeText(grade, 20), userGoal: normalizeText(userGoal, 40) }
  };
}

function buildRevisionSuggestion({ diagnostic, segmentId, revisionGoal, keepFactsStrict } = {}) {
  const segment = (diagnostic?.highlightedSegments || []).find((item) => item.segmentId === segmentId) || diagnostic?.highlightedSegments?.[0] || null;
  const issueText = segment?.text || '选中的片段';
  const strictText = keepFactsStrict === false ? '可以适度调整表达，但仍不能编造新经历。' : '严格保留原有事实，不新增时间、地点、人物和动作。';
  return {
    issueExplanation: segment?.reason || '这个片段需要先明确问题，再做局部修改。',
    revisionStrategy: `${strictText} 先删掉空泛判断，再让学生补一个可验证细节。`,
    exampleRevision: `可以参考这样的局部写法：把“${issueText.slice(0, 24)}”改成“那一刻，我先写下自己真实看到或做过的一件小事，再补一句当时的想法。”`,
    studentAction: `请学生自己确认：这件事是否真实发生？有没有一个自己亲眼看到、亲手做过或亲耳听到的细节可以补进去？`,
    revisionGoal: normalizeText(revisionGoal, 80)
  };
}

function compareDrafts({ originalText, revisedText } = {}) {
  const before = buildDiagnosis({ draftText: originalText });
  const after = buildDiagnosis({ draftText: revisedText });
  const improvements = Object.keys(DIMENSIONS)
    .filter((key) => after.dimensionScores[key].score > before.dimensionScores[key].score)
    .map((key) => `${DIMENSIONS[key]}有所提升`);
  return {
    improvements: improvements.length ? improvements : ['修改后文本更完整，建议继续补具体素材。'],
    remainingIssues: after.priorityIssues,
    changedSegments: splitSentences(revisedText).slice(0, 4).map((text, index) => ({ segmentId: `changed_${index + 1}`, text })),
    learningNotes: ['先补事实，再调整表达。', '局部修改要能说清楚为什么这样改。']
  };
}

function buildReflection({ diagnostic, finalText, completedActions, studentSelfReflection } = {}) {
  const actions = normalizeArray(completedActions);
  const weak = (diagnostic?.priorityIssues || []).slice(0, 3).map((item) => item.title);
  const learnedSkills = Array.from(new Set([
    actions.some((item) => /素材|动作|细节|具体/.test(item)) ? '素材具体度' : '',
    actions.some((item) => /结构|段落|提纲/.test(item)) ? '结构清晰度' : '',
    actions.some((item) => /语言|空泛|结尾|口号/.test(item)) ? '语言自然度' : '',
    '修改复盘能力'
  ].filter(Boolean)));
  return {
    summary: `本次修改重点是${actions.length ? actions.join('、') : '识别问题并确认下一步修改方向'}。`,
    learnedSkills,
    recurringIssues: weak,
    suggestedTrainingFocus: weak.length ? weak : ['继续练习补充真实素材和局部修改说明'],
    studentSelfReflection: normalizeText(studentSelfReflection, 300),
    finalTextLength: countCjk(finalText)
  };
}

function buildAbilityAssessment({ sampleEssay, grade, target } = {}) {
  const diagnosis = buildDiagnosis({ draftText: sampleEssay });
  const scores = diagnosis.dimensionScores;
  return {
    stage: scores.materialSpecificity.score < 60 ? '基础期' : '进阶期',
    dimensionScores: {
      topicAbility: scores.topicFit.score,
      ideaAbility: scores.ideaClarity.score,
      materialAbility: scores.materialSpecificity.score,
      structureAbility: scores.structureClarity.score,
      detailAbility: scores.materialSpecificity.score,
      languageAbility: scores.languageNaturalness.score,
      revisionAbility: 55,
      examExpressionAbility: Math.round((scores.topicFit.score + scores.structureClarity.score) / 2)
    },
    strengths: Object.values(scores).filter((item) => item.score >= 70).map((item) => item.name).slice(0, 3),
    weaknesses: Object.values(scores).filter((item) => item.score < 65).map((item) => item.name).slice(0, 3),
    firstTrainingFocus: diagnosis.priorityIssues.map((item) => item.title).slice(0, 3),
    context: { grade: normalizeText(grade, 20), target: normalizeText(target, 40) }
  };
}

function buildTrainingPlan({ planType = '7d', dailyMinutes = 20, target = '日常提升', focusDimensions = [] } = {}) {
  const dayCount = planType === '30d' ? 30 : planType === '14d' ? 14 : 7;
  const focus = normalizeArray(focusDimensions);
  const defaultFocus = focus.length ? focus : ['素材具体度', '结构清晰度', '语言自然度'];
  const days = Array.from({ length: Math.min(dayCount, 7) }, (_, index) => ({
    day: index + 1,
    tasks: [{
      taskId: `task_day_${index + 1}_material`,
      taskType: index % 2 === 0 ? '素材卡' : '段落',
      title: index % 2 === 0 ? '补一张真实素材卡' : '把一个空泛段落改具体',
      instruction: `围绕${defaultFocus[index % defaultFocus.length]}练习，写出可看见的动作或场景。`,
      expectedMinutes: Number(dailyMinutes) || 20,
      relatedDimension: defaultFocus[index % defaultFocus.length],
      status: '未开始'
    }]
  }));
  return {
    goal: `${dayCount}天内围绕${defaultFocus.join('、')}做短练习，服务于${normalizeText(target, 40) || '作文提升'}。`,
    days,
    expectedOutcome: '能更稳定地把真实经历写具体，并知道每次修改先改哪里。'
  };
}

function todayTasks() {
  return {
    tasks: buildTrainingPlan({ planType: '7d', dailyMinutes: 20 }).days[0].tasks,
    estimatedMinutes: 20,
    focus: '素材具体度'
  };
}


module.exports = {
  buildAbilityAssessment,
  buildDiagnosis,
  buildMaterialQuestions,
  buildOutline,
  buildReflection,
  buildRevisionSuggestion,
  buildTopicAnalysis,
  buildTrainingPlan,
  compareDrafts,
  saveMaterialCard,
  todayTasks
};
