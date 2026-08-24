const { countCjk, splitParagraphs, splitSentences } = require('./text-metrics');
const essayStructure = require('./essay-structure');

const VALID_ACTIONS = new Set(['delete', 'compress', 'replace', 'reorder', 'keep']);

function normalizeRewriteContext(context) {
  const source = context && typeof context === 'object' ? context : {};
  const pick = (key, max = 500) => String(source[key] || '').trim().slice(0, max);
  return {
    genre: pick('genre', 40),
    tone: pick('tone', 40),
    sourceBoundary: pick('sourceBoundary', 700),
    writingSamples: pick('writingSamples', 1200),
    rewriteMode: pick('rewriteMode', 40)
  };
}

function summarizeRewriteContext(context) {
  const normalized = normalizeRewriteContext(context);
  const lines = [
    normalized.genre ? `体裁：${normalized.genre}` : '',
    normalized.tone ? `语气：${normalized.tone}` : '',
    normalized.writingSamples ? `作者样本：${normalized.writingSamples}` : ''
  ].filter(Boolean);
  if (!lines.length) return '用户未提供写作背景；只做克制的局部降 AI 痕迹改写，不补写经历、数据或人物。';
  return `${lines.join('\n')}\n有作者样本时，只学习句长、开头方式、常用词、标点和转场方式；不要冒充未提供的经历。`;
}

function chooseRewriteMode(requestedMode, originalProbability) {
  const normalized = String(requestedMode || '').trim();
  if (['conservative', 'balanced', 'aggressive'].includes(normalized)) {
    return normalized;
  }
  if (originalProbability < 45) return 'conservative';
  if (originalProbability >= 75) return 'aggressive';
  return 'balanced';
}

function actionLabel(action) {
  return {
    delete: '删除',
    compress: '压缩',
    replace: '替换',
    reorder: '重排',
    keep: '保留'
  }[action] || '处理';
}

function buildLocalEditPlan(text, { analysis = {}, diagnostics = [], suspiciousSegments = [], rewriteMode = 'balanced' } = {}) {
  const plan = [];
  const add = (segment, problemType, action, reason, target) => {
    const normalizedSegment = String(segment || '').trim();
    if (!normalizedSegment || plan.some((item) => item.segment === normalizedSegment)) return;
    plan.push({ segment: normalizedSegment, problemType, action, reason, target });
  };

  for (const sentence of analysis.informationDensity?.lowInfoSentences || []) {
    add(
      sentence,
      '正确但没信息量',
      rewriteMode === 'aggressive' ? 'delete' : 'compress',
      '抽象判断多，但没有对象、动作或依据。',
      '删到一句具体判断，或直接移除。'
    );
  }

  for (const hint of essayStructure.buildStructureEditHints(text)) {
    add(hint.segment, hint.problemType, hint.action, hint.reason, hint.target);
  }

  for (const diagnostic of diagnostics.slice(0, 8)) {
    let action = 'replace';
    if (diagnostic.category === '正确但没信息量') action = rewriteMode === 'conservative' ? 'compress' : 'delete';
    if (diagnostic.category === '句长过匀') action = 'reorder';
    if (diagnostic.category === '格式痕迹') action = 'compress';
    add(
      diagnostic.segment,
      diagnostic.category,
      action,
      diagnostic.reason,
      diagnostic.suggestion
    );
  }

  for (const segment of suspiciousSegments.slice(0, 4)) {
    add(
      segment.content,
      (segment.categories || [])[0] || '风格痕迹',
      rewriteMode === 'conservative' ? 'compress' : 'replace',
      (segment.reasons || []).join('、') || '局部 AI 痕迹偏明显。',
      '保留事实，只调整表达密度和句式节奏。'
    );
  }

  if (!plan.length) {
    const first = splitSentences(text).find((sentence) => countCjk(sentence) >= 12) || String(text || '').slice(0, 120);
    add(first, '整体风险较低', 'keep', '本地诊断没有发现必须改写的问题。', '保留原意，只做必要清理。');
  }

  return plan.slice(0, rewriteMode === 'aggressive' ? 10 : rewriteMode === 'balanced' ? 9 : 5);
}

function normalizeEditPlan(items, fallbackPlan = []) {
  const source = Array.isArray(items) && items.length ? items : fallbackPlan;
  return source
    .map((item) => {
      const action = VALID_ACTIONS.has(String(item?.action || '').trim()) ? String(item.action).trim() : 'replace';
      return {
        segment: String(item?.segment || '').trim().slice(0, 180),
        problemType: String(item?.problemType || item?.category || '风格痕迹').trim().slice(0, 40),
        action,
        reason: String(item?.reason || '').trim().slice(0, 180),
        target: String(item?.target || item?.suggestion || '').trim().slice(0, 180)
      };
    })
    .filter((item) => item.segment)
    .slice(0, 10);
}

function planToPrompt(plan) {
  return normalizeEditPlan(plan).map((item, index) => {
    return `${index + 1}. ${actionLabel(item.action)}｜${item.problemType}\n片段：${item.segment}\n原因：${item.reason}\n目标：${item.target}`;
  }).join('\n');
}

function summarizeDeletedOrCompressed(originalText, rewriteText, editPlan = []) {
  const rewrite = String(rewriteText || '');
  const planned = normalizeEditPlan(editPlan)
    .filter((item) => ['delete', 'compress'].includes(item.action))
    .map((item) => ({
      segment: item.segment,
      action: actionLabel(item.action),
      reason: item.reason || '按编辑计划删水分或压缩表达。'
    }));
  const inferred = splitSentences(originalText)
    .filter((sentence) => countCjk(sentence) >= 12 && !rewrite.includes(sentence))
    .slice(0, 6)
    .map((sentence) => ({
      segment: sentence,
      action: '删除或压缩',
      reason: '原句可能是正确但没信息量、套话或重复解释。'
    }));
  const seen = new Set();
  return [...planned, ...inferred].filter((item) => {
    const key = item.segment;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function cleanTargetText(target) {
  const cleaned = String(target || '')
    .trim()
    .replace(/^(?:压缩为|改为|替换为|调整为|保留为|目标|建议)[:：]\s*/i, '')
    .replace(/^.*?[:：]\s*(?=我|它|这|那|春天|夏天|冬天|家乡|阅读|劳动|友谊|诚信|少年)/, '')
    .replace(/。?(?:只保留|保留|去掉|删除|避免|不新增|不改变).*$/u, '')
    .trim();
  if (/删到|直接移除|删掉|删除|只保留|去掉|补入|压缩|替换|改为|改成|换成|减少|直接进入|优先|避免|保留事实|可观察|具体判断|建议|目标/.test(cleaned)) {
    return '';
  }
  return cleaned;
}

function isEmptyTemplateSentence(sentence) {
  const raw = String(sentence || '').trim();
  if (countCjk(raw) < 16) return false;
  return /生活像|书是人类进步的阶梯|有人说|人们常说|每个人的心中|如果说[^。！？]{2,24}那么|成长的道路|一束温暖的光|双向奔赴|成长最好的模样|赠人玫瑰|手有余香|少年自有|不负韶华|往后余生|今后，我会|未来，我会|我会继续|我也相信|人人有责|少年强则国强|是一束光|是一场无声的成长|是成长路上|最好的模样|最珍贵的品质|最宝贵的财富|最温柔的馈赠|更爱这|以汗水浇灌|奔赴远方|闪闪发光|不负生活|不负时光|方能|用[^。！？]{1,12}浇灌|遇见更好的自己|最便宜的修行|最美的风景|最鲜活热烈的模样|更是我成长路上|无声的良师|父爱如山|父爱如海|自律者方得自由|真正的自律|人无信不立|中华民族的传统美德|家乡是根|心底最温柔的港湾|善举如微光|温暖的洪流|追梦的路上，没有捷径|以坚持对抗疲惫|少年的梦想|教会我[^。！？]{0,20}(?:做人|成长|品质|道理|生活)|藏着最可贵的品质|处处有[^。！？]{1,8}处处有/.test(raw);
}

function rewriteLengthPolicy(mode = 'balanced') {
  const normalized = String(mode || 'balanced');
  if (normalized === 'conservative') {
    return { minAcceptRatio: 0.7, targetMinRatio: 0.78, targetMaxRatio: 0.92, deleteBudgetRatio: 0.16 };
  }
  if (normalized === 'aggressive') {
    return { minAcceptRatio: 0.55, targetMinRatio: 0.6, targetMaxRatio: 0.8, deleteBudgetRatio: 0.25 };
  }
  return { minAcceptRatio: 0.62, targetMinRatio: 0.68, targetMaxRatio: 0.85, deleteBudgetRatio: 0.22 };
}

function hasConcreteAnchor(sentence) {
  return essayStructure.sentenceHasFactAnchor(sentence);
}

function canDeletePlanItem(item) {
  const type = String(item?.problemType || '');
  const segment = String(item?.segment || '');
  if (!/(AI 高频词|宣传腔|公式结构|正确但没信息量|细节与依据不足)/.test(type)) return false;
  if (hasConcreteAnchor(segment) && !isEmptyTemplateSentence(segment)) return false;
  return countCjk(segment) >= 16;
}

function softenTemplatePhrases(sentence) {
  return String(sentence || '')
    .replace(/真正/g, '')
    .replace(/深刻/g, '')
    .replace(/无比/g, '')
    .replace(/满满的/g, '')
    .replace(/格外/g, '')
    .replace(/更是/g, '也是')
    .replace(/方能/g, '才能')
    .replace(/默默绽放生机/g, '继续生长')
    .replace(/治愈又美好/g, '有自己的特点')
    .replace(/温柔又美好/g, '比较安静')
    .replace(/深受触动/g, '有些触动')
    .replace(/心怀感恩，真诚待人/g, '记得别人的好')
    .replace(/默默陪伴着我的成长/g, '放在阳台上')
    .replace(/生机勃勃/g, '长得不错')
    .replace(/努力向上/g, '慢慢生长')
    .replace(/向阳生长/g, '慢慢生长')
    .replace(/肆意生长/g, '长得很快')
    .replace(/尽显蓬勃生机/g, '很热闹')
    .replace(/热烈、鲜活、充满力量/g, '热闹')
    .replace(/热烈生活、勇敢绽放、全力以赴/g, '认真生活')
    .replace(/用知识丰盈自己，用努力成就未来/g, '把书读好')
    .replace(/它没有娇艳的花朵，没有华丽的外表，却四季常青、长得不错/g, '它不太起眼，却四季常青')
    .replace(/无论是明亮的阳台，还是昏暗的角落，无论是土培还是水培，它都能顽强生长，努力舒展枝叶/g, '明亮的阳台或昏暗角落里，土培水培都能生长')
    .replace(/以身作则，/g, '')
    .replace(/在耕耘中收获进步与成长/g, '在动手做事里慢慢改变')
    .replace(/以担当赋能成长，/g, '')
    .replace(/赋能/g, '帮助')
    .replace(/底层逻辑/g, '原因')
    .replace(/认知升级/g, '想法改变')
    .replace(/闭环/g, '完整过程')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactSegment(segment) {
  const sentences = splitSentences(segment);
  if (!sentences.length) return '';
  if (sentences.length === 1 && isEmptyTemplateSentence(sentences[0])) return '';
  const kept = sentences
    .filter((sentence, index) => !(index > 0 && isEmptyTemplateSentence(sentence)))
    .map(softenTemplatePhrases)
    .filter(Boolean);
  return (kept[0] || softenTemplatePhrases(sentences[0]) || '').trim();
}

function compressSentence(sentence) {
  const raw = softenTemplatePhrases(sentence);
  const compacted = raw
    .replace(/(?:从来都)?不需要惊天动地[，,]?/g, '')
    .replace(/往往就/g, '就')
    .replace(/最(?:珍贵|宝贵|温柔|美好|动人)的/g, '')
    .replace(/让平凡的岁月满是/g, '')
    .replace(/在[^。！？]{0,18}中不断成长/g, '')
    .replace(/以[^。！？]{0,12}为伴[，,]?/g, '')
    .replace(/以[^。！？]{0,12}修身[，,]?/g, '')
    .replace(/脚踏实地、?/g, '')
    .replace(/奋力拼搏、?/g, '')
    .replace(/心怀[^，。！？]{0,12}[，,]?/g, '')
    .replace(/认真温暖地/g, '认真')
    .replace(/纯粹又/g, '')
    .replace(/温柔与/g, '')
    .replace(/与美好/g, '')
    .replace(/、+/g, '、')
    .replace(/，。/g, '。')
    .replace(/，，/g, '，')
    .trim();
  return compacted;
}

function cleanupRewriteText(text) {
  return String(text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([。！？])\s+([^\n])/g, '$1$2')
    .replace(/([，。！？])\1+/g, '$1')
    .replace(/，。/g, '。')
    .replace(/、，/g, '，')
    .trim();
}

function sentenceHasTemplateChainResidue(sentence) {
  return /曾经的我|以前的我|从前的我|我总是|我曾经不懂|让我明白|终于懂得|教会我|今后(?:，)?我会|未来(?:，)?我会|从那以后|成为更好的自己|不负韶华|奔赴远方|闪闪发光/.test(String(sentence || ''));
}

function sentenceLooksAbstractGain(sentence) {
  return /这(?:件事|次经历)?让我(?:明白|懂得|感受到|深受触动)|我终于(?:明白|懂得)|教会我|让我学会|收获(?:了)?成长|懂得了|是一束光|最好的模样|最宝贵的财富|最温柔的馈赠/.test(String(sentence || ''));
}

function plainEndingSentence(sentence) {
  const compacted = compressSentence(sentence)
    .replace(/^(?:今后|未来|往后)(?:，)?我会(?:继续)?/g, '后来我会')
    .replace(/我也相信[^。！？]{0,40}/g, '')
    .replace(/(?:成为更好的自己|不负韶华|奔赴远方|闪闪发光)/g, '')
    .replace(/让[^。！？]{0,18}照亮[^。！？]{0,18}/g, '')
    .replace(/，。/g, '。')
    .trim();
  return compacted;
}

function pruneGenericTemplateSentences(text) {
  return splitParagraphs(text)
    .map((paragraph) => {
      const sentences = splitSentences(paragraph);
      if (sentences.length <= 1) return isEmptyTemplateSentence(paragraph) ? '' : softenTemplatePhrases(paragraph);
      const filtered = sentences.filter((sentence, index) => {
        if (sentences.length <= 2) return !isEmptyTemplateSentence(sentence);
        if (index === 0 && sentences.length <= 3) return !isEmptyTemplateSentence(sentence) || hasConcreteAnchor(sentence);
        return !isEmptyTemplateSentence(sentence);
      });
      return filtered.map(softenTemplatePhrases).join('');
    })
    .filter(Boolean)
    .join('\n\n');
}

function keepWithinParagraphBudget(originalParagraph, rewrittenParagraph, policy, risk) {
  const originalLength = countCjk(originalParagraph);
  if (!originalLength) return rewrittenParagraph;
  const ratio = countCjk(rewrittenParagraph) / originalLength;
  const minRatio = risk === 'safe_content'
    ? Math.max(0.78, policy.minAcceptRatio)
    : risk === 'thin_event'
      ? Math.max(0.68, policy.minAcceptRatio)
      : policy.minAcceptRatio;
  if (ratio >= minRatio || !essayStructure.sentenceHasFactAnchor(originalParagraph)) return rewrittenParagraph;

  const current = new Set(splitSentences(rewrittenParagraph));
  let restored = rewrittenParagraph;
  for (const sentence of splitSentences(originalParagraph)) {
    if (countCjk(restored) / originalLength >= minRatio) break;
    if (!hasConcreteAnchor(sentence) || current.has(sentence)) continue;
    const compact = compressSentence(sentence);
    if (countCjk(compact) < 10 || isEmptyTemplateSentence(compact)) continue;
    restored = restored ? `${restored}${compact}` : compact;
    current.add(sentence);
  }
  return restored;
}

function rewriteParagraphByRole(item, policy, pass = 1) {
  const paragraph = String(item?.paragraph || '').trim();
  const sentences = splitSentences(paragraph);
  if (!sentences.length) return '';

  const role = item?.role || 'body';
  const risk = item?.risk || 'safe_content';
  const compressed = sentences.map((sentence) => ({
    original: sentence,
    compact: compressSentence(sentence),
    hasFact: hasConcreteAnchor(sentence),
    emptyTemplate: isEmptyTemplateSentence(sentence),
    abstractGain: sentenceLooksAbstractGain(sentence),
    chainResidue: sentenceHasTemplateChainResidue(sentence),
    plainableEnding: essayStructure.sentenceLooksPlainableEnding(sentence)
  }));

  let kept = compressed;
  if (risk === 'template_opening' || role === 'opening') {
    const factBearing = compressed.filter((item) => item.hasFact && !item.emptyTemplate);
    const nonTemplate = compressed.filter((item) => !item.emptyTemplate && !item.chainResidue);
    kept = (factBearing.length ? factBearing : nonTemplate.length ? nonTemplate : compressed)
      .slice(0, pass >= 2 ? 1 : 2);
  } else if (risk === 'thin_event') {
    const factBearing = compressed.filter((item) => item.hasFact && !item.emptyTemplate);
    kept = (factBearing.length ? factBearing : compressed.filter((item) => !item.emptyTemplate))
      .filter((item, index) => index === 0 || !item.abstractGain || item.hasFact)
      .slice(0, pass >= 2 ? 2 : 3);
  } else if (risk === 'floating_reflection') {
    const factBearing = compressed.filter((item) => item.hasFact && !item.emptyTemplate);
    const plain = compressed.filter((item) => !item.emptyTemplate && !item.abstractGain && !item.chainResidue);
    kept = (factBearing.length ? factBearing : plain.length ? plain : compressed.filter((item) => !item.emptyTemplate))
      .slice(0, 1);
  } else if (risk === 'golden_sentence_misuse' || role === 'ending') {
    const factBearing = compressed.filter((item) => item.hasFact && !item.emptyTemplate);
    const plain = compressed.filter((item) => !item.emptyTemplate && !item.abstractGain && !item.plainableEnding);
    kept = (factBearing.length ? factBearing : plain.length ? plain : compressed.filter((item) => !item.emptyTemplate))
      .slice(0, pass >= 2 ? 1 : 2)
      .map((item) => ({ ...item, compact: plainEndingSentence(item.compact || item.original) }));
  } else if (pass >= 2) {
    kept = compressed.filter((item, index) => {
      if (item.emptyTemplate) return false;
      if (item.chainResidue && !item.hasFact) return false;
      if (item.abstractGain && !item.hasFact && index > 0) return false;
      return true;
    });
  } else {
    kept = compressed.filter((item, index) => !(index > 0 && item.emptyTemplate));
  }

  const rewritten = kept
    .map((item) => item.compact || item.original)
    .filter((sentence) => countCjk(sentence) >= 4)
    .join('');
  return keepWithinParagraphBudget(paragraph, cleanupRewriteText(rewritten), policy, risk);
}

function applyParagraphRoleRewrite(text, policy, pass = 1) {
  const paragraphs = essayStructure.analyzeEssayStructure(text);
  return cleanupRewriteText(paragraphs
    .map((item) => {
      if (item.risk === 'safe_content' && pass < 2) {
        return splitSentences(item.paragraph).map(softenTemplatePhrases).join('');
      }
      return rewriteParagraphByRole(item, policy, pass);
    })
    .filter(Boolean)
    .join('\n\n'));
}

function restoreLengthFromOriginal(originalText, rewrittenText, policy) {
  const originalLength = countCjk(originalText);
  if (!originalLength || countCjk(rewrittenText) / originalLength >= policy.minAcceptRatio) return rewrittenText;
  const current = new Set(splitSentences(rewrittenText));
  const candidates = splitSentences(originalText)
    .filter((sentence) => !current.has(sentence))
    .map((sentence) => ({ original: sentence, compact: compressSentence(sentence) }))
    .filter((item) => countCjk(item.compact) >= 10)
    .filter((item) => !isEmptyTemplateSentence(item.compact))
    .filter((item) => hasConcreteAnchor(item.original) || !isEmptyTemplateSentence(item.original))
    .map((item) => item.compact);
  let restored = String(rewrittenText || '').trim();
  for (const sentence of candidates) {
    if (countCjk(restored) / originalLength >= policy.targetMinRatio) break;
    if (restored.includes(sentence)) continue;
    restored = restored ? `${restored}${sentence}` : sentence;
  }
  return restored;
}

function needsSecondConservativePass(originalAnalysis, rewrittenAnalysis, originalText, rewrittenText) {
  const originalProbability = Number(originalAnalysis?.probability || 0);
  const rewrittenProbability = Number(rewrittenAnalysis?.probability || 0);
  const drop = originalProbability - rewrittenProbability;
  const lengthRatio = countCjk(rewrittenText) / Math.max(1, countCjk(originalText));
  const info = rewrittenAnalysis?.informationDensity || {};
  const lowInfoCount = Array.isArray(info.lowInfoSentences) ? info.lowInfoSentences.length : 0;
  const chainHits = Number(info.essayTemplateChainHits || info.essayTemplateChain?.componentCount || 0);
  const chainComplete = Boolean(info.essayTemplateChainComplete || info.essayTemplateChain?.complete);
  return rewrittenProbability >= 50
    || drop < 5
    || (lengthRatio > 0.82 && lowInfoCount > 0)
    || chainComplete
    || chainHits >= 3;
}

function buildConservativeRewrite(originalText, editPlan = [], options = {}) {
  let rewritten = String(options.baseText || originalText || '').trim();
  const beforePlan = rewritten;
  const policy = rewriteLengthPolicy(options.rewriteMode || 'balanced');
  const deleteBudget = Math.round(countCjk(beforePlan) * policy.deleteBudgetRatio);
  let deletedByBudget = 0;
  const plans = normalizeEditPlan(editPlan)
    .filter((item) => item.segment && rewritten.includes(item.segment));

  for (const item of plans) {
    if (item.action === 'keep') continue;
    if (item.action === 'delete' && deletedByBudget + countCjk(item.segment) <= deleteBudget && !hasConcreteAnchor(item.segment)) {
      rewritten = rewritten.replace(item.segment, '');
      deletedByBudget += countCjk(item.segment);
      continue;
    }

    const target = cleanTargetText(item.target);
    if (target && countCjk(target) >= 8 && countCjk(target) <= Math.max(120, countCjk(item.segment) + 20)) {
      rewritten = rewritten.replace(item.segment, target);
      continue;
    }

    if (item.action === 'compress' || item.action === 'replace' || item.action === 'delete') {
      const segmentLength = countCjk(item.segment);
      if (canDeletePlanItem(item) && deletedByBudget + segmentLength <= deleteBudget) {
        rewritten = rewritten.replace(item.segment, '');
        deletedByBudget += segmentLength;
        continue;
      }
      const compact = compactSegment(item.segment);
      if (compact) rewritten = rewritten.replace(item.segment, compact);
      else if (countCjk(item.segment) <= deleteBudget - deletedByBudget && !hasConcreteAnchor(item.segment)) {
        rewritten = rewritten.replace(item.segment, '');
        deletedByBudget += countCjk(item.segment);
      }
    }
  }

  if (rewritten === beforePlan) {
    rewritten = pruneGenericTemplateSentences(rewritten);
  } else {
    const pruned = pruneGenericTemplateSentences(rewritten);
    if (countCjk(pruned) >= countCjk(beforePlan) * policy.minAcceptRatio) rewritten = pruned;
  }

  const rolePruned = applyParagraphRoleRewrite(rewritten, policy, 1);
  if (countCjk(rolePruned) >= countCjk(originalText) * policy.minAcceptRatio) rewritten = rolePruned;

  const finalPruned = pruneGenericTemplateSentences(rewritten);
  rewritten = countCjk(finalPruned) ? finalPruned : rewritten;
  rewritten = restoreLengthFromOriginal(originalText, rewritten, policy);

  const shouldRunSecondPass = options.forceSecondPass
    || countCjk(rewritten) / Math.max(1, countCjk(originalText)) > policy.targetMaxRatio;
  if (shouldRunSecondPass) {
    const secondPass = applyParagraphRoleRewrite(rewritten, policy, 2);
    if (countCjk(secondPass) >= countCjk(originalText) * policy.minAcceptRatio) rewritten = secondPass;
  }

  return cleanupRewriteText(rewritten);
}

function buildBeforeAfter(originalAnalysis, rewrittenAnalysis) {
  const originalScores = originalAnalysis?.dimensionScores || {};
  const rewrittenScores = rewrittenAnalysis?.dimensionScores || {};
  const reducedDimensions = Object.keys(originalScores)
    .filter((key) => Number(originalScores[key] || 0) - Number(rewrittenScores[key] || 0) >= 8);
  const remainingRisks = Object.entries(rewrittenScores)
    .filter(([, value]) => Number(value || 0) >= 55)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ dimension: key, score: value }))
    .slice(0, 4);

  return {
    originalScore: originalAnalysis?.probability || 0,
    rewrittenScore: rewrittenAnalysis?.probability || 0,
    originalDimensionScores: originalScores,
    rewrittenDimensionScores: rewrittenScores,
    reducedDimensions,
    remainingRisks,
    explanation: reducedDimensions.length
      ? `这一版主要降低了 ${reducedDimensions.join('、')}。`
      : '这一版改动较保守，主要保留原文并清理局部风险。'
  };
}

module.exports = {
  actionLabel,
  buildBeforeAfter,
  buildConservativeRewrite,
  buildLocalEditPlan,
  chooseRewriteMode,
  needsSecondConservativePass,
  rewriteLengthPolicy,
  normalizeEditPlan,
  normalizeRewriteContext,
  planToPrompt,
  summarizeDeletedOrCompressed,
  summarizeRewriteContext
};
