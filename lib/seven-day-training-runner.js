'use strict';

function text(value, max = 1200) {
  return String(value || '').trim().slice(0, max);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => typeof item === 'string' ? item : item?.label || item?.title || item?.text || item?.question || '')
      .map((item) => text(item, 160))
      .filter(Boolean);
  }
  const single = text(value, 240);
  return single ? [single] : [];
}

function objectText(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  const subject = item.object || item.target || item.aspect || item.label || item.title || item.field || item.name || '';
  const detail = item.how || item.detail || item.text || item.description || item.suggestion || item.value || '';
  return [subject, detail].map((part) => text(part, 180)).filter(Boolean).join('：');
}

function stringList(value, fallback = []) {
  const items = Array.isArray(value) ? value : (value ? [value] : []);
  const normalized = items.map(objectText).map((item) => text(item, 240)).filter(Boolean);
  return normalized.length ? normalized : stringArray(fallback);
}

function contextFor(plan, input) {
  const ctx = plan?.context || {};
  return {
    title: text(input.title || ctx.title, 120),
    grade: text(input.grade || ctx.grade, 40),
    genre: text(input.genre || ctx.genre, 40),
    initialMaterial: text(input.initialMaterial || input.extraMaterial || ctx.initialMaterial, 1200),
    goal: text(input.goal || ctx.goal, 120)
  };
}

function nextStageId(plan, task) {
  const days = Array.isArray(plan?.days) ? plan.days : [];
  const index = days.findIndex((item) => item.taskId === task.taskId);
  return index >= 0 && days[index + 1] ? text(days[index + 1].stageId, 80) : '';
}

function localTopicArtifact(plan, input) {
  const ctx = contextFor(plan, input);
  const title = ctx.title || '这篇作文';
  const material = ctx.initialMaterial || '学生已经想到的一点真实素材';
  return {
    localFallback: true,
    topicKeywords: [title, ctx.genre || '记叙文'].filter(Boolean),
    coreQuestion: `这道题要写清楚“${title}”里真正值得写的一次经历，以及经历前后你的看法、动作或感受发生了什么变化。`,
    possibleAngles: [
      {
        angleId: 'angle_real_change',
        title: '一次真实变化',
        prompt: '把已有素材里的关键事件当作主线，写你从犹豫、陌生或害怕，到愿意认真面对的一次变化。',
        whyThisFitsTopic: `这个角度能扣住“${title}”中的变化或发现，不只是写一件事，而是写出你前后状态的不同。`,
        materialConnection: `优先使用这条真实素材：${material}。下一步要把其中的时间、地点、人物、动作和心理补清楚。`,
        writingPath: '先进入具体场景，再写事情推进中的困难或发现，接着写关键一刻，最后写变化后的具体感受。',
        keyDetailsToAsk: ['事情发生的准确时间和地点', '当时谁在场、他们有什么反应', '你做了哪个能被看见的关键动作', '那一刻心里想法和之前有什么不同'],
        riskReminder: '不要只写我懂得了道理，要用一个真实动作或具体发现证明变化发生了。',
        materialHint: '补充时间、地点、人物反应、关键动作和一句真实想法。'
      },
      {
        angleId: 'angle_helped_by_someone',
        title: '被提醒后的改变',
        prompt: '从素材中找一个影响你的人、物或场景，写它怎样让你意识到自己该换一种做法或看法。',
        whyThisFitsTopic: `如果题目需要写成长、发现或感悟，这个角度能把外部触发和内心改变连起来。`,
        materialConnection: `围绕“${material}”里最能触动你的细节展开，追问是谁、哪句话、哪个画面或哪次互动推动了变化。`,
        writingPath: '先写原来的想法或状态，再写触发你的提醒或画面，随后写你做出的改变，结尾回到题目关键词。',
        keyDetailsToAsk: ['提醒你的人或画面具体是什么', '对方说了什么或做了什么', '你当时身体和表情有什么反应', '你后来做出的改变是什么'],
        riskReminder: '不要把提醒写成空洞说教，要写出那句话或那个画面为什么正好击中你。',
        materialHint: '补充人物、对话、当时反应和事后做法。'
      },
      {
        angleId: 'angle_observation_to_feeling',
        title: '从观察到理解',
        prompt: '如果素材中有景物、活动或一次观察，可以写你先看到表面，后来发现更深一层意义的过程。',
        whyThisFitsTopic: `这个角度适合把“${title}”写成一次由看见到理解的变化，重点是观察越具体，感受越自然。`,
        materialConnection: `从“${material}”中挑出最有画面的对象，例如地点、景物、物件、声音或一个小动作，再写它带来的想法。`,
        writingPath: '先写进入场景时看到的对象，再写仔细观察时发现的细节，接着写一个让你改变看法的瞬间，最后写新的理解。',
        keyDetailsToAsk: ['最值得观察的对象是什么', '它的颜色、声音、动作或变化是什么', '你什么时候产生了新想法', '这个想法和题目有什么关系'],
        riskReminder: '不要只罗列景物，要让每个景物或动作都服务于最后的理解。',
        materialHint: '补充一个观察对象、两处感官细节和一次想法变化。'
      }
    ],
    riskyAngles: [
      { title: '空泛成长', reason: '只写“我懂得了道理”，缺少具体事件。' }
    ],
    suggestedNextQuestions: [
      '这件事发生在什么时候、什么地方？',
      '你当时做了哪个能被看见的动作？',
      '最后哪一刻说明你真的变了？'
    ]
  };
}

function localMaterialQuestions(plan, input) {
  const selectedAngle = text(input.selectedAngle || input.selectedAngleTitle || '一次真实变化', 120);
  return {
    localFallback: true,
    selectedAngle,
    questions: [
      { field: 'time', question: '这件事具体发生在什么时候？', purpose: '让素材有时间落点' },
      { field: 'place', question: '当时你在哪里，周围有什么能看见的东西？', purpose: '补场景画面' },
      { field: 'action', question: '你做了哪一个关键动作，别人能一眼看见？', purpose: '避免空泛叙述' },
      { field: 'feeling', question: '那一刻你心里最真实的想法是什么？', purpose: '写出变化原因' }
    ],
    materialChecklist: [
      { field: 'time', label: '时间', present: false, suggestion: '补一个具体时间' },
      { field: 'place', label: '地点', present: false, suggestion: '补一个具体地点' },
      { field: 'action', label: '动作', present: false, suggestion: '补一个关键动作' },
      { field: 'feeling', label: '感受', present: false, suggestion: '补一个真实想法' }
    ],
    nextAction: 'continue_questions'
  };
}

function materialAnswersText(input) {
  return asArray(input.materialAnswers)
    .map((item) => [item.question, item.answer].filter(Boolean).join('：'))
    .filter(Boolean)
    .join('；') || text(input.initialMaterial || input.extraMaterial, 800) || '学生补充的真实素材';
}

function localOutlineArtifact(plan, input) {
  const ctx = contextFor(plan, input);
  const material = materialAnswersText(input);
  return {
    localFallback: true,
    outlineTree: {
      title: ctx.title || '作文提纲',
      theme: '写清楚一次真实变化',
      children: [
        {
          nodeId: 'p1',
          role: '开头',
          label: '用一个具体场景把读者带进事情发生的那一刻',
          focus: '交代时间、地点、人物和最先出现的动作或画面。',
          writeTask: '这一段要让读者知道事情在哪里开始、你当时处在什么状态，并埋下后文变化的原因。',
          writingObjects: ['时间和地点', '当时在场的人', '一个能看见的动作或物件', '你最初的心情'],
          detailPlan: [
            '时间和地点：写清楚是哪一天、哪节课、哪个场所或哪次活动，不用只写有一天。',
            '人物：点出和事件有关的人，写他们的位置、表情或一句话。',
            '动作或物件：抓住稿纸、讲台、树叶、书包、操场等真实物件，让开头有画面。',
            '心情：用身体反应写，不只写紧张、开心或难过。'
          ],
          eventBeats: ['进入场景', '出现任务或发现', '露出你最初的状态'],
          emotionShift: '从平常或期待，转向紧张、好奇、犹豫或被触动。',
          transitionHint: '结尾用一个问题、一次点名、一个发现或一个突然动作，把事情推向主体。',
          studentChecklist: ['是否有具体时间地点', '是否出现真实人物或物件', '是否让读者看出后文会发生变化'],
          children: []
        },
        {
          nodeId: 'p2',
          role: '经过',
          label: '写事情真正展开时，你看见了什么、做了什么、卡在哪里',
          focus: material,
          writeTask: '这一段要把已有素材拆成连续动作，写出事情推进中的困难、观察或矛盾。',
          writingObjects: ['事件中的关键动作', '周围人的反应', '场景里的声音或画面', '你当时想逃避或继续的原因'],
          detailPlan: [
            `已有素材：围绕“${material}”补出前后经过，不要换成另一个虚构事件。`,
            '动作：按先后顺序写两到三个动作，例如低头、停住、抬眼、伸手、靠近。',
            '人物反应：写一个眼神、表情、动作或一句话，让事件有压力或推动力。',
            '心理：写你为什么犹豫、害怕、惊讶或开始在意。'
          ],
          eventBeats: ['任务或发现变具体', '你遇到阻力或产生犹豫', '外界反应推动事情继续'],
          emotionShift: '从最初状态进入更明显的紧张、专注、担心、惊喜或疑问。',
          transitionHint: '用一个决定、一次靠近、一次抬头或一个新发现，把文章带到转折段。',
          studentChecklist: ['是否按顺序写动作', '是否用素材里的真实事实', '是否写出困难或发现的原因'],
          children: []
        },
        {
          nodeId: 'p3',
          role: '转折',
          label: '集中写改变发生的关键一刻，让读者看见你和之前不一样',
          focus: '抓住一个决定、一次发现、一句话或一个动作来写变化。',
          writeTask: '这一段要写出文章最重要的瞬间：你因为前面的经历做出了新动作或产生了新理解。',
          writingObjects: ['关键一刻的动作', '一句对话或内心话', '前后对比', '变化后的具体表现'],
          detailPlan: [
            '关键动作：写你抬头、开口、伸手、停下、靠近、继续观察等能被看见的动作。',
            '内心话：写一句当时闪过的真实想法，让变化有原因。',
            '前后对比：明确之前怎么想或怎么做，现在有什么不同。',
            '具体表现：变化后要有行动，不只说我明白了。'
          ],
          eventBeats: ['出现触发点', '你停顿或思考', '做出不同于之前的选择', '事情因此发生变化'],
          emotionShift: '从犹豫、害怕、粗心或只看热闹，转向承担、理解、认真观察或愿意尝试。',
          transitionHint: '用事情结束后的一个画面或别人反应，过渡到结尾的收束。',
          studentChecklist: ['是否有关键一刻', '是否写出前后不同', '是否用动作证明改变'],
          children: []
        },
        {
          nodeId: 'p4',
          role: '结尾',
          label: '回到题目，把这次经历留下的改变写得自然具体',
          focus: '写事情结束后的画面、余味和你现在的理解。',
          writeTask: '这一段要收住全文，让读者知道这件事为什么值得写，以及它给你留下了什么真实影响。',
          writingObjects: ['事情结束后的场景', '身体或环境中的余味', '题目关键词', '下一次你会怎么做'],
          detailPlan: [
            '结束场景：写掌声、夕阳、回程、教室、鸟鸣、风声等真实余味。',
            '感受：把抽象道理落到一个具体感受或下一次行动。',
            '扣题：自然带回题目关键词，不要突然喊口号。',
            '影响：写这件事之后你看人、看事或做事的小变化。'
          ],
          eventBeats: ['事情告一段落', '保留一个收束画面', '写出新的理解或下一步行动'],
          emotionShift: '从事件中的强烈情绪，沉淀为平静、坚定、珍惜、理解或成长。',
          transitionHint: '结尾收束全文，不再开启新事件。',
          studentChecklist: ['是否回到题目', '是否没有空喊大道理', '是否留下具体画面或行动'],
          children: []
        }
      ]
    }
  };
}

function localParagraphGuides(plan, input) {
  const outline = input.outlineTree || plan?.artifacts?.outline_tree?.outlineTree || localOutlineArtifact(plan, input).outlineTree;
  return {
    localFallback: true,
    outlineTree: outline,
    paragraphGuides: [
      {
        paragraphId: 'p1',
        role: '开头',
        goal: '直接进入事情发生的场景。',
        writingTargets: ['时间地点', '出场人物', '最先出现的物件或动作', '最初情绪'],
        howToWrite: [
          '时间地点：写成能定位的场景，例如某节课、一次活动、一个公园入口或回家路上。',
          '出场人物：交代谁和你一起在场，写位置、表情或动作。',
          '物件或动作：用一个具体东西开场，比如稿纸、讲台、树叶、鸟笼、背包。',
          '最初情绪：用身体反应或动作写，不要只写我很开心或我很紧张。'
        ],
        detailsToInclude: ['一个准确场景', '一个可见动作', '一个真实物件'],
        developmentSteps: ['先交代场景', '再写人物和动作', '最后露出你的最初心情或疑问'],
        sensoryDetails: ['光线、风声、教室安静、树叶颜色、脚步声等可感知细节'],
        innerThoughtPrompts: ['刚进入这个场景时，你心里最先冒出的念头是什么？'],
        mustInclude: ['时间或地点', '一个能看见的动作'],
        writingPrompts: ['你当时站在哪里？手上在做什么？'],
        starterHint: '那天……我……',
        avoid: ['不要先讲大道理'],
        selfCheck: ['开头是否有具体画面', '读者是否知道事件即将发生什么'],
        suggestedLength: '80-120字'
      },
      {
        paragraphId: 'p2',
        role: '主体',
        goal: '写清楚事情推进和你的犹豫。',
        writingTargets: ['事情推进', '困难或发现', '他人反应', '你的犹豫原因'],
        howToWrite: [
          '事情推进：按先后写两到三个动作，让读者看到事情在往前走。',
          '困难或发现：写清楚你卡住、惊讶、担心或产生兴趣的具体原因。',
          '他人反应：补一个眼神、动作、声音或一句话。',
          '犹豫原因：写你为什么想退缩、为什么停住或为什么继续观察。'
        ],
        detailsToInclude: ['两个连续动作', '一个外界反应', '一处心理变化'],
        developmentSteps: ['先接住开头的触发点', '再写困难或观察变具体', '最后把压力或发现推到转折前'],
        sensoryDetails: ['周围声音、人物目光、物体状态、空气或天气变化'],
        innerThoughtPrompts: ['这一刻你最想逃开、靠近、解释或继续看的原因是什么？'],
        mustInclude: ['具体动作', '一句对话或心理'],
        writingPrompts: ['你为什么卡住？别人说了什么？'],
        starterHint: '我本来想……可是……',
        avoid: ['不要只写“我很紧张”'],
        selfCheck: ['是否写出事情顺序', '是否有真实细节支撑情绪'],
        suggestedLength: '180-260字'
      },
      {
        paragraphId: 'p3',
        role: '变化',
        goal: '写出真正改变发生的一刻。',
        writingTargets: ['关键一刻', '转折动作', '内心话', '前后对比'],
        howToWrite: [
          '关键一刻：集中写一个决定、发现、对话或动作，不要铺开多个事件。',
          '转折动作：写你做了和前面不一样的动作，例如抬头、开口、伸手、停下。',
          '内心话：写一句当时真实冒出的想法，让改变有来处。',
          '前后对比：让读者看出你之前和之后的不同。'
        ],
        detailsToInclude: ['一个转折动作', '一句内心话或对话', '一个前后对比'],
        developmentSteps: ['先写触发改变的瞬间', '再写身体动作或一句话', '最后写事情因为这个选择发生什么变化'],
        sensoryDetails: ['手心、呼吸、声音、眼神、周围突然安静或热闹的变化'],
        innerThoughtPrompts: ['你为什么在这一秒决定不再按原来的方式做？'],
        mustInclude: ['转折动作', '前后对比'],
        writingPrompts: ['你做了哪个和之前不一样的动作？'],
        starterHint: '我停了一下，随后……',
        avoid: ['不要空喊“我长大了”'],
        selfCheck: ['是否能看见改变发生', '是否没有直接讲大道理'],
        suggestedLength: '150-220字'
      },
      {
        paragraphId: 'p4',
        role: '结尾',
        goal: '自然扣题，留下变化后的感受。',
        writingTargets: ['结束画面', '题目关键词', '真实余味', '今后的一个小改变'],
        howToWrite: [
          '结束画面：回到事件结束后的场景，写一个还留在眼前或耳边的细节。',
          '题目关键词：自然带回题目，不要突然喊口号。',
          '真实余味：写你现在再想起这件事时的具体感受。',
          '小改变：写这件事之后你下一次会怎么做。'
        ],
        detailsToInclude: ['一个收束画面', '题目关键词', '一个具体影响'],
        developmentSteps: ['先写事情结束', '再保留一个画面或声音', '最后写这件事给你的具体改变'],
        sensoryDetails: ['掌声、风声、脚步声、夕阳、教室或公园离开时的画面'],
        innerThoughtPrompts: ['这件事结束后，你看同一件事的眼光有什么变化？'],
        mustInclude: ['题目关键词', '一个具体余味'],
        writingPrompts: ['事情结束后你看见或听见了什么？'],
        starterHint: '后来再想起那一刻……',
        avoid: ['不要写万能道理'],
        selfCheck: ['结尾是否自然扣题', '是否留下具体画面而不是空泛总结'],
        suggestedLength: '80-120字'
      }
    ],
    missingMaterialQuestions: [],
    nextAction: 'write_paragraph_1',
    studentTask: '按每段提示先写出四段草稿。'
  };
}

function localParagraphFeedback(plan, input) {
  const drafts = asArray(input.paragraphDrafts).map((item) => text(item.text || item, 1200)).filter(Boolean);
  return {
    localFallback: true,
    mergedDraft: drafts.join('\n\n'),
    paragraphFeedback: drafts.map((draft, index) => ({
      paragraphId: `p${index + 1}`,
      feedback: draft.length >= 60 ? '这一段已有基本内容，下一步补一个更具体的动作或对话。' : '这一段偏短，先补清楚发生了什么。',
      nextHint: '保留事实，只补一个可看见的细节。'
    }))
  };
}

function localDiagnosis(plan, input) {
  const draftText = text(input.draftText || input.mergedDraft, 5000);
  const priorityIssues = [
    {
      issueId: 'issue_material_detail',
      dimension: '素材具体度',
      title: '细节还不够能看见',
      severity: draftText.length >= 300 ? 'medium' : 'high',
      explanation: '草稿需要检查每段是否有动作、地点或对话支撑。',
      suggestion: '先选一段，把“我很紧张”改成一个动作、一句声音或一个身体反应。',
      relatedSegmentId: 'draft'
    },
    {
      issueId: 'issue_topic_fit',
      dimension: '扣题',
      title: '结尾需要回到题目关键词',
      severity: 'medium',
      explanation: '完整作文最后要让读者看见这次经历和题目之间的关系。',
      suggestion: '结尾少讲大道理，多写这件事结束后你和以前有什么不同。',
      relatedSegmentId: 'ending'
    }
  ];
  return {
    localFallback: true,
    overallComment: draftText.length >= 300 ? '草稿已基本成形，可以进入针对性修改。' : '草稿还偏短，需要补足事件经过。',
    priorityIssues,
    highlightedSegments: [],
    dimensionScores: {
      topicFit: draftText.length >= 120 ? 68 : 55,
      materialSpecificity: draftText.length >= 180 ? 66 : 50,
      structureClarity: draftText.includes('\n') ? 70 : 58
    },
    revisionTargets: ['补具体动作', '删空泛道理', '加强前后变化']
  };
}

function localReflection(plan, input) {
  return {
    localFallback: true,
    summary: '已完成 7 天单篇作文训练闭环。',
    learnedSkills: ['审题选角度', '素材追问', '提纲拆段', '分段修改'],
    recurringIssues: ['素材仍需更具体'],
    suggestedTrainingFocus: ['下一次继续练“动作 + 感受”的细节表达'],
    studentSelfReflection: text(input.studentSelfReflection, 500),
    finalTextLength: text(input.revisedText || input.draftText, 5000).length
  };
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizedPriorityIssues(source, fallback) {
  if (Array.isArray(source.priorityIssues) && source.priorityIssues.length) return source.priorityIssues;
  if (Array.isArray(source.issues) && source.issues.length) {
    return source.issues.map((issue, index) => ({
      issueId: issue.issueId || `issue_${index + 1}`,
      dimension: issue.dimension || issue.type || '综合问题',
      title: issue.title || issue.message || issue.type || '需要优先修改的问题',
      severity: issue.severity || 'medium',
      explanation: issue.explanation || issue.message || '',
      suggestion: issue.suggestion || issue.nextHint || '先补一个真实细节，再删掉空泛表达。',
      relatedSegmentId: issue.relatedSegmentId || ''
    }));
  }
  return fallback.priorityIssues || [];
}

function normalizedDimensionScores(source, fallback) {
  const raw = source.dimensionScores;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw;
  }
  const fallbackScores = objectValue(fallback.dimensionScores);
  const normalized = { ...fallbackScores };
  for (const item of asArray(raw)) {
    const name = text(item?.dimension || item?.name || item?.label, 80);
    const score = Number(item?.score ?? item?.value);
    if (!Number.isFinite(score)) continue;
    if (/扣题|切题|立意|topic/i.test(name)) normalized.topicFit = score;
    else if (/素材|细节|真实|material/i.test(name)) normalized.materialSpecificity = score;
    else if (/结构|条理|structure/i.test(name)) normalized.structureClarity = score;
  }
  return normalized;
}

function normalizedTopicAngles(source, fallback) {
  const fallbackAngles = asArray(fallback.possibleAngles);
  const sourceAngles = asArray(source.possibleAngles).length ? source.possibleAngles : asArray(source.angles);
  const angles = sourceAngles.length ? sourceAngles : fallbackAngles;
  return angles.map((angle, index) => {
    const fallbackAngle = fallbackAngles[index] || {};
    return {
      ...fallbackAngle,
      ...objectValue(angle),
      angleId: text(angle?.angleId || fallbackAngle.angleId || `angle_${index + 1}`, 60),
      title: text(angle?.title || fallbackAngle.title || `方向 ${index + 1}`, 120),
      prompt: text(angle?.prompt || fallbackAngle.prompt || '写一个真实具体的经历。', 800),
      whyThisFitsTopic: text(angle?.whyThisFitsTopic || fallbackAngle.whyThisFitsTopic, 800),
      materialConnection: text(angle?.materialConnection || fallbackAngle.materialConnection, 1000),
      writingPath: text(angle?.writingPath || fallbackAngle.writingPath, 1000),
      keyDetailsToAsk: stringList(angle?.keyDetailsToAsk, fallbackAngle.keyDetailsToAsk),
      riskReminder: text(angle?.riskReminder || fallbackAngle.riskReminder, 600),
      materialHint: text(angle?.materialHint || fallbackAngle.materialHint, 800)
    };
  });
}

function normalizedOutlineNode(node, fallbackNode = {}, index = 0) {
  const sourceNode = objectValue(node);
  const baseNode = objectValue(fallbackNode);
  const children = asArray(sourceNode.children).length
    ? asArray(sourceNode.children).map((child, childIndex) => normalizedOutlineNode(child, {}, childIndex))
    : asArray(baseNode.children);
  return {
    ...baseNode,
    ...sourceNode,
    nodeId: text(sourceNode.nodeId || baseNode.nodeId || `node_${index + 1}`, 60),
    role: text(sourceNode.role || baseNode.role || `第${index + 1}段`, 120),
    label: text(sourceNode.label || baseNode.label || sourceNode.title || baseNode.title, 400),
    focus: text(sourceNode.focus || baseNode.focus, 1000),
    writeTask: text(sourceNode.writeTask || baseNode.writeTask, 1000),
    writingObjects: stringList(sourceNode.writingObjects, baseNode.writingObjects),
    detailPlan: stringList(sourceNode.detailPlan, baseNode.detailPlan),
    eventBeats: stringList(sourceNode.eventBeats, baseNode.eventBeats),
    emotionShift: text(sourceNode.emotionShift || baseNode.emotionShift, 800),
    transitionHint: text(sourceNode.transitionHint || baseNode.transitionHint, 800),
    studentChecklist: stringList(sourceNode.studentChecklist, baseNode.studentChecklist),
    children
  };
}

function normalizedOutlineTree(source, fallback) {
  const fallbackOutline = objectValue(fallback.outlineTree);
  const rawOutline = objectValue(source.outlineTree);
  const outline = Object.keys(rawOutline).length ? rawOutline : fallbackOutline;
  const fallbackChildren = asArray(fallbackOutline.children);
  const children = asArray(outline.children).length ? asArray(outline.children) : fallbackChildren;
  return {
    ...fallbackOutline,
    ...outline,
    title: text(outline.title || fallbackOutline.title || '作文提纲', 180),
    theme: text(outline.theme || fallbackOutline.theme || '写清楚一次真实经历', 600),
    children: children.map((node, index) => normalizedOutlineNode(node, fallbackChildren[index] || {}, index))
  };
}

function normalizedParagraphGuides(source, fallback) {
  const fallbackGuides = asArray(fallback.paragraphGuides);
  const guides = asArray(source.paragraphGuides).length ? source.paragraphGuides : fallbackGuides;
  return guides.map((guide, index) => {
    const fallbackGuide = fallbackGuides[index] || {};
    return {
      paragraphId: text(guide?.paragraphId || fallbackGuide.paragraphId || `p${index + 1}`, 40),
      role: text(guide?.role || fallbackGuide.role || `第${index + 1}段`, 80),
      goal: text(guide?.goal || fallbackGuide.goal || '写清楚这一段的核心内容。', 200),
      writingTargets: stringList(guide?.writingTargets || guide?.targets, fallbackGuide.writingTargets),
      howToWrite: stringList(guide?.howToWrite || guide?.writingMethods, fallbackGuide.howToWrite),
      detailsToInclude: stringList(guide?.detailsToInclude || guide?.detailPlan, fallbackGuide.detailsToInclude),
      developmentSteps: stringList(guide?.developmentSteps || guide?.steps, fallbackGuide.developmentSteps),
      sensoryDetails: stringList(guide?.sensoryDetails, fallbackGuide.sensoryDetails),
      innerThoughtPrompts: stringList(guide?.innerThoughtPrompts, fallbackGuide.innerThoughtPrompts),
      mustInclude: stringList(guide?.mustInclude, fallbackGuide.mustInclude),
      writingPrompts: stringList(guide?.writingPrompts, fallbackGuide.writingPrompts),
      starterHint: text(guide?.starterHint || fallbackGuide.starterHint, 160),
      avoid: stringList(guide?.avoid, fallbackGuide.avoid),
      selfCheck: stringList(guide?.selfCheck, fallbackGuide.selfCheck),
      suggestedLength: text(guide?.suggestedLength || fallbackGuide.suggestedLength, 80)
    };
  });
}

function normalizeStageArtifact(stageId, artifact, plan, input) {
  const source = objectValue(artifact);
  let fallback;
  if (stageId === 'topic_angle') fallback = localTopicArtifact(plan, input);
  else if (stageId === 'material_questions') fallback = localMaterialQuestions(plan, input);
  else if (stageId === 'outline_tree') fallback = localOutlineArtifact(plan, input);
  else if (stageId === 'paragraph_guides') fallback = localParagraphGuides(plan, input);
  else if (stageId === 'paragraph_drafting') fallback = localParagraphFeedback(plan, input);
  else if (stageId === 'draft_diagnosis') fallback = localDiagnosis(plan, input);
  else fallback = localReflection(plan, input);

  const normalized = { ...fallback, ...source };
  if (stageId === 'topic_angle') {
    normalized.possibleAngles = normalizedTopicAngles(source, fallback);
  } else if (stageId === 'material_questions') {
    normalized.questions = asArray(source.questions).length ? source.questions : fallback.questions;
    normalized.materialChecklist = asArray(source.materialChecklist).length ? source.materialChecklist : fallback.materialChecklist;
  } else if (stageId === 'outline_tree') {
    normalized.outlineTree = normalizedOutlineTree(source, fallback);
  } else if (stageId === 'paragraph_guides') {
    normalized.outlineTree = source.outlineTree ? normalizedOutlineTree(source, fallback) : fallback.outlineTree;
    normalized.paragraphGuides = normalizedParagraphGuides(source, fallback);
  } else if (stageId === 'paragraph_drafting') {
    normalized.mergedDraft = typeof source.mergedDraft === 'string' ? source.mergedDraft : fallback.mergedDraft;
    normalized.paragraphFeedback = asArray(source.paragraphFeedback).length ? source.paragraphFeedback : fallback.paragraphFeedback;
  } else if (stageId === 'draft_diagnosis') {
    normalized.priorityIssues = normalizedPriorityIssues(source, fallback);
    normalized.overallComment = source.overallComment || source.overall || fallback.overallComment;
    normalized.highlightedSegments = asArray(source.highlightedSegments);
    normalized.dimensionScores = normalizedDimensionScores(source, fallback);
    normalized.revisionTargets = stringArray(source.revisionTargets).length ? stringArray(source.revisionTargets) : stringArray(fallback.revisionTargets);
  } else {
    normalized.learnedSkills = asArray(source.learnedSkills).length ? source.learnedSkills : fallback.learnedSkills;
    normalized.suggestedTrainingFocus = asArray(source.suggestedTrainingFocus).length ? source.suggestedTrainingFocus : fallback.suggestedTrainingFocus;
  }
  return normalized;
}

async function modelOrFallback({ taskName, modelInput, outputContract, callModel, fallback, maxTokens = 1800 }) {
  if (typeof callModel !== 'function') return fallback();
  try {
    const result = await callModel(taskName, modelInput, outputContract, { maxTokens });
    return { ...result, localFallback: false };
  } catch (error) {
    const fallbackArtifact = {
      ...fallback(),
      modelFallbackReasonCode: error?.failureCode || error?.code || 'MODEL_CALL_FAILED'
    };
    if (process?.env?.TRAINING_PLAN_MODEL_DEBUG === 'true') {
      fallbackArtifact.modelFallbackDebugPreview = text(error?.rawContent || error?.message || '', 600);
    }
    return fallbackArtifact;
  }
}

function selectedAngleDetail(plan, input = {}) {
  const selected = text(
    input.selectedAngle
      || input.selectedAngleTitle
      || plan?.stageInputs?.material_questions?.selectedAngle
      || plan?.stageInputs?.topic_angle?.selectedAngleTitle,
    160
  );
  const angles = asArray(plan?.artifacts?.topic_angle?.possibleAngles);
  return angles.find((angle) => (
    angle?.angleId === selected
      || angle?.title === selected
      || text(angle?.title, 160) === selected
  )) || null;
}

async function runSevenDayTrainingTask({ plan, task, input = {}, callModel, outputContracts = {} } = {}) {
  const stageId = task?.stageId || '';
  let artifact;
  if (stageId === 'topic_angle') {
    artifact = await modelOrFallback({
      taskName: '7天训练-审题与立意',
      modelInput: { planContext: plan?.context || {}, input },
      outputContract: outputContracts.topicAnalysis,
      callModel,
      fallback: () => localTopicArtifact(plan, input),
      maxTokens: 4000
    });
  } else if (stageId === 'material_questions') {
    artifact = await modelOrFallback({
      taskName: '7天训练-素材追问',
      modelInput: {
        planContext: plan?.context || {},
        selectedAngle: text(input.selectedAngle || input.selectedAngleTitle, 120),
        selectedAngleDetail: selectedAngleDetail(plan, input),
        initialMaterial: text(input.initialMaterial || plan?.context?.initialMaterial, 1200),
        answers: asArray(input.answers)
      },
      outputContract: outputContracts.materialQuestions,
      callModel,
      fallback: () => localMaterialQuestions(plan, input),
      maxTokens: 4000
    });
  } else if (stageId === 'outline_tree') {
    artifact = await modelOrFallback({
      taskName: '7天训练-提纲树',
      modelInput: {
        planContext: plan?.context || {},
        selectedAngle: text(plan?.stageInputs?.material_questions?.selectedAngle || input.selectedAngle, 120),
        selectedAngleDetail: selectedAngleDetail(plan, input),
        initialMaterial: text(plan?.context?.initialMaterial || input.initialMaterial, 1200),
        materialAnswers: asArray(input.materialAnswers),
        materialQuestions: asArray(plan?.artifacts?.material_questions?.questions)
      },
      outputContract: outputContracts.outlineTree || outputContracts.guidedWriting,
      callModel,
      fallback: () => localOutlineArtifact(plan, input),
      maxTokens: 5200
    });
  } else if (stageId === 'paragraph_guides') {
    artifact = await modelOrFallback({
      taskName: '7天训练-段落写作提示',
      modelInput: {
        planContext: plan?.context || {},
        selectedAngle: text(plan?.stageInputs?.material_questions?.selectedAngle || input.selectedAngle, 120),
        selectedAngleDetail: selectedAngleDetail(plan, input),
        initialMaterial: text(plan?.context?.initialMaterial || input.initialMaterial, 1200),
        materialAnswers: asArray(plan?.stageInputs?.outline_tree?.materialAnswers || input.materialAnswers),
        outlineTree: input.outlineTree || plan?.artifacts?.outline_tree?.outlineTree || null
      },
      outputContract: outputContracts.paragraphGuides || outputContracts.guidedWriting,
      callModel,
      fallback: () => localParagraphGuides(plan, input),
      maxTokens: 6500
    });
  } else if (stageId === 'paragraph_drafting') {
    artifact = localParagraphFeedback(plan, input);
  } else if (stageId === 'draft_diagnosis') {
    artifact = await modelOrFallback({
      taskName: '7天训练-整文体检',
      modelInput: {
        planContext: plan?.context || {},
        draftText: text(input.draftText || input.mergedDraft, 5000)
      },
      outputContract: outputContracts.trainingDiagnosis || outputContracts.diagnose,
      callModel,
      fallback: () => localDiagnosis(plan, input),
      maxTokens: 3600
    });
  } else {
    artifact = await modelOrFallback({
      taskName: '7天训练-修改复盘',
      modelInput: { planContext: plan?.context || {}, input },
      outputContract: outputContracts.trainingReflection || outputContracts.reflection,
      callModel,
      fallback: () => localReflection(plan, input),
      maxTokens: 2600
    });
  }
  artifact = normalizeStageArtifact(stageId, artifact, plan, input);

  return {
    planId: plan?.id || plan?.planId || '',
    taskId: task?.taskId || '',
    stageId,
    artifact,
    nextStageId: nextStageId(plan, task),
    status: 'completed',
    uiHints: {
      stageTitle: task?.stageTitle || task?.title || '',
      relatedDimension: task?.relatedDimension || '',
      expectedOutput: task?.expectedOutput || ''
    }
  };
}

module.exports = {
  runSevenDayTrainingTask
};
