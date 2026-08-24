const {
  analyzeFormattingSignals,
  clamp,
  countCjk,
  countMatches,
  findSegmentForPhrase,
  phraseMatchesText,
  splitParagraphs,
  splitSentences
} = require('./text-metrics');

function makeDiagnostic(category, severity, segment, reason, suggestion, scoreKey = '') {
  return {
    category,
    severity,
    segment: String(segment || '').trim().slice(0, 160),
    reason,
    suggestion,
    scoreKey
  };
}

function normalizeDiagnosticSegment(segment) {
  return String(segment || '')
    .replace(/\s+/g, '')
    .replace(/[，。！？；：、“”‘’（）《》【】,.!?;:"'()[\]{}<>]/g, '')
    .trim();
}

function charBigrams(text) {
  const raw = normalizeDiagnosticSegment(text);
  if (raw.length <= 1) return raw ? [raw] : [];
  const grams = [];
  for (let index = 0; index < raw.length - 1; index += 1) {
    grams.push(raw.slice(index, index + 2));
  }
  return grams;
}

function segmentSimilarity(left, right) {
  const a = normalizeDiagnosticSegment(left);
  const b = normalizeDiagnosticSegment(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 12 && longer.includes(shorter)) return shorter.length / longer.length;
  const aGrams = charBigrams(a);
  const bGrams = charBigrams(b);
  if (!aGrams.length || !bGrams.length) return 0;
  const counts = new Map();
  for (const gram of aGrams) counts.set(gram, (counts.get(gram) || 0) + 1);
  let overlap = 0;
  for (const gram of bGrams) {
    const count = counts.get(gram) || 0;
    if (count <= 0) continue;
    overlap += 1;
    counts.set(gram, count - 1);
  }
  return (2 * overlap) / (aGrams.length + bGrams.length);
}

function severityRank(value) {
  return { low: 1, medium: 2, high: 3 }[value] || 0;
}

function pushDiagnostic(list, diagnostic) {
  if (!diagnostic?.category || !diagnostic?.segment) return;
  const key = `${diagnostic.category}:${diagnostic.segment}:${diagnostic.reason}`;
  if (list.some((item) => `${item.category}:${item.segment}:${item.reason}` === key)) return;
  const similarIndex = list.findIndex((item) => segmentSimilarity(item.segment, diagnostic.segment) > 0.935);
  if (similarIndex >= 0) {
    if (severityRank(diagnostic.severity) > severityRank(list[similarIndex].severity)) {
      list[similarIndex] = diagnostic;
    }
    return;
  }
  list.push(diagnostic);
}

function dedupeSimilarDiagnostics(diagnostics = []) {
  const list = [];
  for (const diagnostic of Array.isArray(diagnostics) ? diagnostics : []) {
    pushDiagnostic(list, diagnostic);
  }
  return list;
}

function collectPhraseDiagnostics(text, phrases, { category, severity = 'medium', reason, suggestion, scoreKey, limit = 4 }) {
  const diagnostics = [];
  for (const phrase of Array.isArray(phrases) ? phrases : []) {
    if (!phrase || !phraseMatchesText(text, phrase)) continue;
    pushDiagnostic(diagnostics, makeDiagnostic(
      category,
      severity,
      findSegmentForPhrase(text, phrase),
      reason,
      suggestion,
      scoreKey
    ));
    if (diagnostics.length >= limit) break;
  }
  return diagnostics;
}

function analyzeFormatDiagnostics(text) {
  const diagnostics = [];
  const raw = String(text || '');
  const paragraphs = splitParagraphs(raw);
  const sentences = splitSentences(raw);
  const spacingIssue = raw.match(/(?:[\u4e00-\u9fa5][A-Za-z0-9]{1,}|[A-Za-z0-9]{1,}[\u4e00-\u9fa5])/g) || [];
  const dashCount = countMatches(raw, /——|--/g);
  const separatorStackCount = countMatches(raw, /([|｜/／、·\-_=])\s*\1{2,}/g);
  const deepHeading = raw.split(/\r?\n/).find((line) => /^#{4,}\s+/.test(line.trim()));
  const longParagraph = paragraphs.find((paragraph) => countCjk(paragraph) >= 220);
  const bulletLines = raw.split(/\r?\n/).filter((line) => /^\s*[-*•]\s+/.test(line));
  const bulletColonLines = bulletLines.filter((line) => /^\s*[-*•]\s*[^：:\n]{1,14}[：:]/.test(line));
  const lowInfoSentence = sentences.find((sentence) => (
    countCjk(sentence) >= 28
    && countMatches(sentence, /“|”|"|\d|：|;|；/g) === 0
    && /重要|关键|意义|价值|提升|促进|推动|体现|反映|说明|彰显|实现|助力/.test(sentence)
  ));

  if (spacingIssue.length >= 2) {
    pushDiagnostic(diagnostics, makeDiagnostic(
      '格式痕迹',
      'low',
      spacingIssue.slice(0, 4).join('、'),
      '中英文或数字贴合过密，容易显得像统一排版后的模板文本。',
      '需要保留英文缩写或数字时，按上下文补空格；中文年份、数量表达可按原语境决定。',
      'formattingScore'
    ));
  }
  if (dashCount >= 3) {
    pushDiagnostic(diagnostics, makeDiagnostic(
      '格式痕迹',
      'low',
      findSegmentForPhrase(raw, '——') || '多处破折号',
      '破折号解释过密，会让句子呈现统一的补充说明结构。',
      '把一部分解释改成短句，或直接删掉不提供新信息的说明。',
      'formattingScore'
    ));
  }
  if (separatorStackCount >= 1) {
    pushDiagnostic(diagnostics, makeDiagnostic(
      '格式痕迹',
      'low',
      '连续堆叠分隔符',
      '连续分隔符会暴露整理痕迹，阅读上也不够自然。',
      '保留一种分隔方式即可，避免用符号制造层次。',
      'formattingScore'
    ));
  }
  if (deepHeading) {
    pushDiagnostic(diagnostics, makeDiagnostic(
      '公式结构',
      'low',
      deepHeading,
      '标题层级超过三级，容易显得像自动生成的大纲。',
      '压缩标题层级，用段落承接细节。',
      'structureScore'
    ));
  }
  if (longParagraph) {
    pushDiagnostic(diagnostics, makeDiagnostic(
      '句长过匀',
      'medium',
      longParagraph,
      '段落过长，观点和例子挤在一起，读起来像连续铺陈。',
      '拆出一个短句或删掉重复解释，让段落有停顿。',
      'rhythmScore'
    ));
  }
  if (bulletLines.length >= 3 && bulletColonLines.length / bulletLines.length >= 0.8) {
    pushDiagnostic(diagnostics, makeDiagnostic(
      '公式结构',
      'low',
      bulletColonLines.slice(0, 3).join('\n'),
      '项目符号几乎都是“关键词：解释”的格式，结构过于工整。',
      '保留必要列表，把次要解释并回正文。',
      'structureScore'
    ));
  }
  if (/希望这对你有帮助|希望以上内容/.test(raw)) {
    pushDiagnostic(diagnostics, makeDiagnostic(
      '格式痕迹',
      'medium',
      findSegmentForPhrase(raw, '希望这对你有帮助') || findSegmentForPhrase(raw, '希望以上内容'),
      '出现聊天助手式收尾语，容易直接暴露生成痕迹。',
      '删除这类服务性尾句，改用文本本身的结论收束。',
      'formattingScore'
    ));
  }
  if (lowInfoSentence) {
    pushDiagnostic(diagnostics, makeDiagnostic(
      '正确但没信息量',
      'medium',
      lowInfoSentence,
      '句子判断正确，但没有给出动作、数据、场景或边界。',
      '优先压缩或删除；若必须保留，补一个具体依据。',
      'informationScore'
    ));
  }

  return diagnostics;
}

function diagnosticsFromDimensions(text, analysis) {
  const diagnostics = [];
  const scores = analysis.dimensionScores || {};
  const firstSentences = splitSentences(text).slice(0, 3).join('');

  if (scores.informationScore >= 55) {
    pushDiagnostic(diagnostics, makeDiagnostic(
      '正确但没信息量',
      scores.informationScore >= 75 ? 'high' : 'medium',
      analysis.informationDensity?.lowInfoSentences?.[0] || firstSentences,
      '抽象判断多，具体对象、动作、数据或例子偏少。',
      analysis.informationDensity?.suggestion || '删掉不带新信息的判断句。',
      'informationScore'
    ));
  }
  if (scores.evidenceScore >= 55) {
    pushDiagnostic(diagnostics, makeDiagnostic(
      '细节与依据不足',
      scores.evidenceScore >= 75 ? 'high' : 'medium',
      firstSentences,
      '文本缺少可验证的细节锚点，容易只剩“正确的空话”。',
      '保留原事实边界，补入已有材料中的对象、时间、动作或限制条件。',
      'evidenceScore'
    ));
  }
  if (scores.rhythmScore >= 55) {
    const chainHits = Number(analysis.informationDensity?.essayTemplateChainHits || 0);
    const goldMisuseCount = Number(analysis.informationDensity?.goldMisuseCount || 0);
    pushDiagnostic(diagnostics, makeDiagnostic(
      '句长过匀',
      chainHits >= 3 || goldMisuseCount >= 1 ? 'medium' : 'low',
      firstSentences,
      `${analysis.rhythm?.verdict || '句长波动偏低。'} 该项仅作为辅助信号。`,
      '不要单独因为句长过匀改写；只有模板链、低信息句或公式结构同时存在时再调整节奏。',
      'rhythmScore'
    ));
  }
  if ((analysis.informationDensity?.essayTemplateChainHits || 0) >= 3) {
    const chain = analysis.informationDensity.essayTemplateChain || {};
    pushDiagnostic(diagnostics, makeDiagnostic(
      '作文模板链',
      chain.complete ? 'high' : 'medium',
      firstSentences,
      `命中 ${chain.componentCount || analysis.informationDensity.essayTemplateChainHits} 个功能环节：${(chain.components || []).join('、')}`,
      '优先打断“泛化开头 -> 简短事件 -> 抽象收获 -> 今后表态”的固定推进方式。',
      'structureScore'
    ));
  }
  if ((analysis.informationDensity?.goldMisuseCount || 0) > 0) {
    pushDiagnostic(diagnostics, makeDiagnostic(
      '金句滥用',
      analysis.informationDensity.goldMisuseCount >= 3 ? 'medium' : 'low',
      splitSentences(text).slice(-2).join(''),
      '金句与低信息密度、模板链或多段收束共同出现，可能替代了叙事或论证。',
      '保留能承接前文事实的一句朴素收束，删除连续口号式升华。',
      'structureScore'
    ));
  }
  if (scores.formattingScore >= 55 && !analyzeFormattingSignals(text).chatTailCount) {
    pushDiagnostic(diagnostics, makeDiagnostic(
      '格式痕迹',
      'medium',
      '排版结构',
      '格式信号偏高，可能存在过密标题、符号或列表模板。',
      '减少符号层级，让正文承担层次。',
      'formattingScore'
    ));
  }

  return diagnostics;
}

function buildDiagnostics(text, knowledgeBase, analysis) {
  const diagnostics = [
    ...collectPhraseDiagnostics(text, knowledgeBase.clichePhrases, {
      category: 'AI 高频词',
      severity: 'medium',
      reason: '命中高频套话或空泛金句，容易把文章推向模板腔。',
      suggestion: '删掉不提供信息的词；必要时换成具体动作、对象或限制条件。',
      scoreKey: 'lexicalScore'
    }),
    ...collectPhraseDiagnostics(text, knowledgeBase.transitions, {
      category: '公式结构',
      severity: 'medium',
      reason: '连接词或总结句式偏工整，像按固定结构铺陈。',
      suggestion: '减少显性转场，直接进入判断或例子。',
      scoreKey: 'structureScore'
    }),
    ...collectPhraseDiagnostics(text, knowledgeBase.emotionalWords, {
      category: '宣传腔',
      severity: 'low',
      reason: '情绪词或价值判断词偏满，读起来像宣传式拔高。',
      suggestion: '保留事实和判断，删掉不能被验证的形容词。',
      scoreKey: 'lexicalScore'
    }),
    ...collectPhraseDiagnostics(text, knowledgeBase.overreachPatterns, {
      category: '反代入式表达',
      severity: 'medium',
      reason: '预设读者认知，容易产生居高临下的纠偏感。',
      suggestion: '直接陈述判断，不替读者安排误解。',
      scoreKey: 'stanceScore'
    }),
    ...analyzeFormatDiagnostics(text),
    ...diagnosticsFromDimensions(text, analysis)
  ];

  return dedupeSimilarDiagnostics(diagnostics).slice(0, 14);
}

function analyzeSegmentSignals(text, knowledgeBase) {
  let score = 0;
  const reasons = [];
  const categories = [];
  const clicheHitCount = (knowledgeBase.clichePhrases || []).filter((phrase) => phraseMatchesText(text, phrase)).length;
  const transitionHitCount = (knowledgeBase.transitions || []).filter((phrase) => phraseMatchesText(text, phrase)).length;
  const overreachHitCount = (knowledgeBase.overreachPatterns || []).filter((phrase) => phraseMatchesText(text, phrase)).length;
  const adjectiveCount = knowledgeBase.emotionalWordsRegex ? countMatches(text, knowledgeBase.emotionalWordsRegex) : 0;
  const parallelTriples = countMatches(text, /一[^，。；\n]{1,10}[，、]\s*一[^，。；\n]{1,10}[，、]\s*一[^，。；\n]{1,14}/g);
  const concreteDetailCount = countMatches(text, /“|”|"|\d|：|;|；/g);

  if (clicheHitCount >= 1) {
    score += clicheHitCount * 8;
    reasons.push('套话偏多');
    categories.push('AI 高频词');
  }
  if (transitionHitCount >= 2) {
    score += transitionHitCount * 3;
    reasons.push('结构衔接太工整');
    categories.push('公式结构');
  }
  if (overreachHitCount >= 1) {
    score += overreachHitCount * 6;
    reasons.push('反代入式表达');
    categories.push('反代入式表达');
  }
  if (adjectiveCount >= 3) {
    score += adjectiveCount * 2;
    reasons.push('抒情词偏密');
    categories.push('宣传腔');
  }
  if (parallelTriples >= 1) {
    score += 10;
    reasons.push('排比句明显');
    categories.push('公式结构');
  }
  if (countCjk(text) >= 60 && concreteDetailCount === 0) {
    score += 8;
    reasons.push('细节锚点偏少');
    categories.push('正确但没信息量');
  }
  return { score: clamp(score, 0, 100), reasons, categories: Array.from(new Set(categories)) };
}

function findSuspiciousSegments(text, knowledgeBase) {
  const paragraphs = splitParagraphs(text);
  const units = paragraphs.length > 1
    ? paragraphs.map((content, index) => ({ index, content, label: `第${index + 1}段` }))
    : splitSentences(text).map((content, index) => ({ index, content, label: `第${index + 1}句` }));

  return units.map((unit) => ({ ...unit, ...analyzeSegmentSignals(unit.content, knowledgeBase) }))
    .filter((unit) => unit.score >= 8)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

module.exports = {
  analyzeFormatDiagnostics,
  analyzeSegmentSignals,
  buildDiagnostics,
  findSuspiciousSegments,
  makeDiagnostic
};
