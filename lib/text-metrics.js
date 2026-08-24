function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function countCjk(text) {
  return String(text || '').replace(/\s+/g, '').length;
}

function countMatches(text, pattern) {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitParagraphs(text) {
  return String(text || '').split(/\r?\n+/).map((item) => item.trim()).filter(Boolean);
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[。！？!?])|\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getLastNonEmptyLine(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim());
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]) return lines[i];
  }
  return '';
}

function phraseMatchesText(text, phrase) {
  const normalized = String(phrase || '').trim();
  if (!normalized) return false;
  if (normalized.includes('...')) {
    const flexible = new RegExp(escapeRegex(normalized).replace(/\\\.\\\.\\\./g, '[\\s\\S]{0,30}'), 'i');
    return flexible.test(String(text || ''));
  }
  return String(text || '').includes(normalized);
}

function findSegmentForPhrase(text, phrase) {
  const normalized = String(phrase || '').trim();
  if (!normalized) return '';
  const sentences = splitSentences(text);
  const sentence = sentences.find((item) => item.includes(normalized));
  if (sentence) return sentence;
  if (normalized.includes('...')) {
    const flexible = new RegExp(escapeRegex(normalized).replace(/\\\.\\\.\\\./g, '[\\s\\S]{0,30}'), 'i');
    const flexibleSentence = sentences.find((item) => flexible.test(item));
    if (flexibleSentence) return flexibleSentence;
  }
  const index = String(text || '').indexOf(normalized);
  if (index < 0) return normalized;
  return String(text || '').slice(Math.max(0, index - 24), index + normalized.length + 36).trim();
}

function analyzeRhythm(text) {
  const sentenceLengths = splitSentences(text).map((item) => countCjk(item)).filter((item) => item > 0);
  if (!sentenceLengths.length) {
    return {
      averageSentenceLength: 0,
      sentenceStdDev: 0,
      burstinessScore: 0,
      rhythmScore: 0,
      verdict: '句子数量不足，暂不判断节奏'
    };
  }

  const averageSentenceLength = sentenceLengths.reduce((sum, n) => sum + n, 0) / sentenceLengths.length;
  const variance = sentenceLengths.reduce((sum, n) => sum + ((n - averageSentenceLength) ** 2), 0) / sentenceLengths.length;
  const sentenceStdDev = Math.sqrt(variance);
  const burstinessScore = averageSentenceLength ? sentenceStdDev / averageSentenceLength : 0;
  let verdict = '句长有正常波动';
  let rhythmScore = 28;

  if (sentenceLengths.length >= 6 && averageSentenceLength > 12 && burstinessScore < 0.3) {
    verdict = '句长波动偏低，整体节奏较匀';
    rhythmScore = 76;
  } else if (sentenceLengths.length >= 4 && averageSentenceLength > 18 && burstinessScore < 0.38) {
    verdict = '句子偏长且波动不大，节奏略工整';
    rhythmScore = 58;
  } else if (burstinessScore >= 0.75) {
    verdict = '句长波动较大，节奏变化明显';
    rhythmScore = 22;
  }

  return {
    averageSentenceLength: Number(averageSentenceLength.toFixed(1)),
    sentenceStdDev: Number(sentenceStdDev.toFixed(1)),
    burstinessScore: Number(burstinessScore.toFixed(2)),
    rhythmScore,
    verdict
  };
}

function detectTextProfile(text) {
  const raw = String(text || '');
  const paragraphs = splitParagraphs(raw);
  const sentences = splitSentences(raw);
  const paragraphLengths = paragraphs.map(countCjk);
  const sentenceLengths = sentences.map(countCjk);
  const totalLength = countCjk(raw);
  const hasList = /^\s*(?:[-*•]|\d+[.、]|[一二三四五六七八九十]+[、.])\s+/m.test(raw);
  const hasHeadings = /^#{1,6}\s+|^.{1,18}[：:]$/m.test(raw);
  const narrationHits = countMatches(raw, /今天|昨天|那天|后来|放学|回家|路上|当时|记得|忽然|突然|于是|清晨|傍晚/g);
  const essayHits = countMatches(raw, /成长|温暖|感动|难忘|坚持|诚信|家乡|友谊|老师|妈妈|植物|校园|春天|夏天|秋天|冬天/g);
  const argumentativeHits = countMatches(raw, /观点|首先|其次|再次|因此|所以|综上|我认为|可见|由此可见|总之/g);
  const explanatoryHits = countMatches(raw, /说明|介绍|原理|步骤|首先|其次|然后|例如|比如|一方面|另一方面/g);
  const readingResponseHits = countMatches(raw, /读完|这本书|这篇文章|启发|感悟|让我想到|我明白了|收获/g);
  const diaryHits = countMatches(raw, /日记|今天|早上|中午|晚上|放学后|睡前|写下这一天/g);
  const eventHits = countMatches(raw, /去了|看见|遇到|发生|帮助|对我说|一起|后来|结果/g);

  let genreGuess = '散文';
  if (diaryHits >= 2 || (totalLength <= 260 && narrationHits >= 3 && /我/.test(raw))) genreGuess = '日记';
  else if (argumentativeHits >= 4) genreGuess = '议论文';
  else if (explanatoryHits >= 4 || (hasList && /步骤|原理|说明|方法/.test(raw))) genreGuess = '说明文';
  else if (readingResponseHits >= 3) genreGuess = '读后感';
  else if (eventHits >= 3 && /我/.test(raw)) genreGuess = '记叙文';
  else if (essayHits >= 4 && totalLength >= 220) genreGuess = eventHits >= 2 ? '记叙文' : '散文';

  let toneGuess = '平实叙述';
  if (/我|我们|当时|后来|亲身|经历/.test(raw)) toneGuess = '现场叙述';
  if (/吐槽|离谱|尴尬|受不了|说白了/.test(raw)) toneGuess = '亲身吐槽';
  if (/必须|应该|显然|关键|判断|结论|因此|所以/.test(raw)) toneGuess = '冷静判断';
  if (/温柔|治愈|珍贵|动人|美好|风景|阳光|绿萝|花朵/.test(raw)) toneGuess = '抒情描写';

  return {
    genreGuess,
    paragraphCount: paragraphs.length,
    sentenceCount: sentences.length,
    averageParagraphLength: paragraphLengths.length
      ? Number((paragraphLengths.reduce((sum, n) => sum + n, 0) / paragraphLengths.length).toFixed(1))
      : 0,
    averageSentenceLength: sentenceLengths.length
      ? Number((sentenceLengths.reduce((sum, n) => sum + n, 0) / sentenceLengths.length).toFixed(1))
      : 0,
    hasList,
    hasHeadings,
    toneGuess,
    totalLength,
    essayHits,
    narrationHits,
    argumentativeHits,
    explanatoryHits,
    readingResponseHits,
    diaryHits,
    eventHits
  };
}

function analyzeInformationDensity(text) {
  const sentences = splitSentences(text);
  const raw = String(text || '');
  const evidenceAnchors = analyzeEvidenceAnchors(raw);
  const essayConventions = analyzeEssayConventions(raw);
  const abstractWordMatches = raw.match(/意义|价值|重要|关键|推动|提升|体现|反映|说明|彰显|实现|助力|赋能|优化|升级|沉淀|连接|长期主义|底层逻辑/g) || [];
  const concreteAnchorCount = countMatches(raw, /“|”|"|\d|%|第[一二三四五六七八九十]|\b[A-Za-z]{2,}\b|：|;|；|例如|比如|具体|现场|当时|这次|那个|用户|客户|老师|同学|项目|订单|页面|接口/g);
  const actionVerbCount = countMatches(raw, /做|改|删|压缩|记录|观察|填写|点击|发布|整理|复盘|对比|验证|测试|统计|拆分|合并|沟通|决定|执行/g);
  const essayTemplateHits = countMatches(raw, /没有[^。！？!?]{0,18}没有[^。！？!?]{0,18}却|不仅[^。！？!?]{0,18}还|是我(最)?(?:喜爱|喜欢)的[^。！？!?]{0,12}|默默陪伴[^。！？!?]{0,14}(?:我的)?成长|见证(?:了)?[^。！？!?]{0,12}成长|这让我明白|从那以后|我也学会了|四季常青|生机勃勃|娇艳的花朵|华丽的外表/g);
  const lowInfoSentences = sentences.filter((sentence) => {
    const len = countCjk(sentence);
    if (len < 18) return false;
    const abstractHits = countMatches(sentence, /意义|价值|重要|关键|推动|提升|体现|反映|说明|彰显|实现|助力|赋能|优化|升级|沉淀|丰富|深刻/g);
    const anchors = countMatches(sentence, /“|”|"|\d|%|：|;|；|例如|比如|当时|具体|项目|用户|客户|接口|页面/g);
    return (abstractHits >= 1 && anchors === 0) || countMatches(sentence, /没有[^。！？!?]{0,18}没有[^。！？!?]{0,18}却|四季常青|生机勃勃|这让我明白|默默陪伴/g) >= 1;
  }).slice(0, 8);
  const anchorCategoryCount = Math.max(concreteAnchorCount, evidenceAnchors.categories);
  const densityRisk = clamp(
    Math.round(
      (abstractWordMatches.length * 7) +
      (essayConventions.aiEssayTemplateHits * 7) +
      Math.min(8, essayConventions.studentEssayConventionHits * 2) +
      (lowInfoSentences.length * 8) +
      Math.max(0, 5 - anchorCategoryCount) * 4 -
      (Math.max(actionVerbCount, evidenceAnchors.actionCount) * 2)
    ),
    0,
    100
  );

  return {
    score: densityRisk,
    lowInfoSentences,
    abstractWordCount: abstractWordMatches.length,
    essayTemplateHits: essayConventions.aiEssayTemplateHits,
    studentEssayConventionHits: essayConventions.studentEssayConventionHits,
    aiEssayTemplateHits: essayConventions.aiEssayTemplateHits,
    goldenSentenceCount: essayConventions.goldenSentenceCount,
    paragraphEndingGoldCount: essayConventions.paragraphEndingGoldCount,
    repeatedTopicCount: essayConventions.repeatedTopicCount,
    essayTemplateChain: essayConventions.essayTemplateChain,
    essayTemplateChainHits: essayConventions.essayTemplateChainHits,
    essayTemplateChainComplete: essayConventions.essayTemplateChainComplete,
    goldMisuseCount: essayConventions.goldMisuseCount,
    concreteAnchorCount: anchorCategoryCount,
    actionVerbCount: Math.max(actionVerbCount, evidenceAnchors.actionCount),
    evidenceAnchors,
    suggestion: densityRisk >= 60
      ? '抽象判断和作文模板偏多，优先删除不带对象、动作和依据的句子。'
      : '信息密度尚可，保留有效判断，局部补充依据即可。'
  };
}

function analyzeFormattingSignals(text) {
  const raw = String(text || '');
  const paragraphs = splitParagraphs(raw);
  const bulletLines = raw.split(/\r?\n/).filter((line) => /^\s*[-*•]\s+/.test(line));
  const bulletColonLines = bulletLines.filter((line) => /^\s*[-*•]\s*[^：:\n]{1,14}[：:]/.test(line));
  const spacingIssueCount = (raw.match(/(?:[\u4e00-\u9fa5][A-Za-z0-9]{1,}|[A-Za-z0-9]{1,}[\u4e00-\u9fa5])/g) || []).length;
  const dashCount = countMatches(raw, /——|--/g);
  const separatorStackCount = countMatches(raw, /([|｜/／、·\-_=])\s*\1{2,}/g);
  const deepHeadingCount = raw.split(/\r?\n/).filter((line) => /^#{4,}\s+/.test(line.trim())).length;
  const longParagraphCount = paragraphs.filter((paragraph) => countCjk(paragraph) >= 220).length;
  const chatTailCount = countMatches(raw, /希望这对你有帮助|希望以上内容/g);
  const score = clamp(
    Math.round((spacingIssueCount * 5) + (dashCount * 6) + (separatorStackCount * 14) + (deepHeadingCount * 15) + (longParagraphCount * 12) + (chatTailCount * 20) + (bulletLines.length >= 3 && bulletColonLines.length / bulletLines.length >= 0.8 ? 18 : 0)),
    0,
    100
  );

  return {
    score,
    spacingIssueCount,
    dashCount,
    separatorStackCount,
    deepHeadingCount,
    longParagraphCount,
    bulletColonRatio: bulletLines.length ? Number((bulletColonLines.length / bulletLines.length).toFixed(2)) : 0,
    chatTailCount
  };
}

function analyzeEvidenceAnchors(text) {
  const raw = String(text || '');
  const timeCount = countMatches(raw, /今天|昨天|那天|上个|周末|早上|中午|下午|傍晚|晚上|深夜|后来|从前|曾经|小时候|如今|未来|第[一二三四五六七八九十]|\d/g);
  const personCount = countMatches(raw, /我|我们|老师|同学|朋友|爸爸|妈妈|父亲|母亲|奶奶|爷爷|学姐|学长|小伙伴|书中(?:的)?(?:人物|主人公)/g);
  const sceneCount = countMatches(raw, /家里|学校|校园|教室|操场|小区|门口|路上|医院|公园|田野|河边|阳台|房间|书桌|课堂|赛场|窗台/g);
  const actionCount = countMatches(raw, /走|跑|看|听|说|问|想|做|拿|放|递|借|帮|背|写|读|练|整理|打扫|清扫|擦|道歉|赔偿|提醒|坚持|复盘|完成|学习|观察/g);
  const objectCount = countMatches(raw, /雨伞|书包|书本|文具|抹布|扫帚|菜篮|粮食|米饭|绿萝|叶片|阳光|树叶|小草|作业|错题|成绩单|跳绳|病床|书名|《[^》]{1,30}》/g);
  const quoteCount = countMatches(raw, /“[^”]{2,80}”|"[^"]{2,80}"|《[^》]{1,30}》/g);
  const observationCount = countMatches(raw, /颜色|声音|味道|雨点|阳光|风|花|树|叶|草|雪|蝉鸣|蛙声|清香|灰蒙蒙|湿漉漉|翠绿|金黄|滚烫|酸痛/g);
  const numberCount = countMatches(raw, /\d|[一二三四五六七八九十百千万]+(?:个|次|本|天|年|小时|分钟|分)/g);
  const categories = [timeCount, personCount, sceneCount, actionCount, objectCount, quoteCount, observationCount, numberCount]
    .filter((value) => value > 0).length;
  return {
    timeCount,
    personCount,
    sceneCount,
    actionCount,
    objectCount,
    quoteCount,
    observationCount,
    numberCount,
    categories
  };
}

function analyzeEssayConventions(text) {
  const raw = String(text || '');
  const paragraphs = splitParagraphs(raw);
  const sentences = splitSentences(raw);
  const firstParagraph = paragraphs[0] || '';
  const lastParagraph = paragraphs[paragraphs.length - 1] || '';
  const studentEssayConventionHits = countMatches(raw, /这让我明白|这件事让我|这次经历让我|从那以后|我也学会了|我终于懂得|我终于明白|今后，我会|未来，我会|往后|读完|让我想到|我爱|我会继续|我会永远|身为新时代少年/g);
  const aiEssayTemplateHits = countMatches(raw, /生活像|梦想是|成长的道路|时光就像|书是人类进步的阶梯|有人说，优秀的人|人们常说[^。！？]{0,30}而|每个人的心中，都有一处最美的风景|如果说[^。！？]{2,24}那么|不仅[^。！？!?]{0,18}(?:更|还)|不是[^。！？!?]{0,18}而是|没有[^。！？!?]{0,18}没有[^。！？!?]{0,18}却|不像[^。！？]{0,18}却|无论[^。！？]{0,20}无论|从前的我[^。！？]{0,28}直到|处处有[^。！？]{1,8}处处有|一[^，。；\n]{1,10}[，、]\s*一[^，。；\n]{1,10}[，、]\s*一[^，。；\n]{1,14}|教会我[^。！？]{0,20}(?:做人|成长|品质|道理)|更是我成长路上|默默陪伴着我的成长|最可贵的品质|肆意生长|尽显蓬勃生机|凝聚着[^。！？]{0,16}汗水|赠人玫瑰，手有余香|少年自有|不负韶华|以汗水浇灌|奔赴远方|遇见更好的自己|最便宜的修行/g);
  const goldenSentenceCount = countMatches(raw, /赠人玫瑰|手有余香|少年自有|不负韶华|人人有责|少年强则国强|是一束光|最好的模样|最珍贵的品质|最宝贵的财富|最温柔的馈赠|无声的良师|照亮[^。！？]{0,16}天地|点亮我的生活|向阳生长|心怀感恩|积极向上|人间处处有真情|一粥一饭|奔赴远方|闪闪发光|用[^。！？]{1,12}浇灌|遇见更好的自己|最便宜的修行/g);
  const paragraphEndingGoldCount = splitParagraphs(raw)
    .map((paragraph) => splitSentences(paragraph).slice(-1)[0] || '')
    .filter((sentence) => /成长|美好|温暖|希望|未来|远方|品质|财富|模样|责任|担当|梦想|光亮/.test(sentence) && countCjk(sentence) >= 16)
    .length;
  const topicWords = ['善意', '温暖', '成长', '劳动', '自律', '诚信', '友谊', '家乡', '阅读', '梦想', '担当', '希望'];
  const repeatedTopicCount = topicWords.reduce((sum, word) => sum + Math.max(0, countMatches(raw, new RegExp(escapeRegex(word), 'g')) - 3), 0);
  const templateChain = analyzeEssayTemplateChain(raw, {
    paragraphs,
    sentences,
    firstParagraph,
    lastParagraph,
    lowInfoSentences: []
  });
  const goldMisuseCount = analyzeGoldMisuse(raw, {
    paragraphs,
    sentences,
    goldenSentenceCount,
    paragraphEndingGoldCount,
    templateChain
  });
  return {
    studentEssayConventionHits,
    aiEssayTemplateHits,
    goldenSentenceCount,
    paragraphEndingGoldCount,
    repeatedTopicCount,
    essayTemplateChain: templateChain,
    essayTemplateChainHits: templateChain.componentCount,
    essayTemplateChainComplete: templateChain.complete,
    goldMisuseCount
  };
}

function analyzeEssayTemplateChain(text, context = {}) {
  const raw = String(text || '');
  const paragraphs = context.paragraphs || splitParagraphs(raw);
  const sentences = context.sentences || splitSentences(raw);
  const firstParagraph = context.firstParagraph || paragraphs[0] || '';
  const lastParagraph = context.lastParagraph || paragraphs[paragraphs.length - 1] || '';
  const componentTests = {
    generic_opening: /生活中|成长路上|成长的道路|很多时候|每个人(?:都|的心中)|平凡(?:中|里)藏着|时光|人生|梦想|温暖|善意|机会|热爱|少年/.test(firstParagraph),
    vague_self_problem: /曾经的我|以前的我|从前的我|我总是|我曾经不懂|我不懂得|我并不|我常常|我总想着|我一开始/.test(raw),
    thin_event: sentences.some((sentence) => {
      const len = countCjk(sentence);
      const hasEventCue = /记得|有一次|那天|周末|放学|课堂|课后|比赛|活动|老师|同学|朋友|爸爸|妈妈|我/.test(sentence);
      const hasProcessCue = /先|随后|接着|最后|一边|一边|因为|可是|但是|犹豫|失败|出错|想要放弃|不知道|只好|于是/.test(sentence);
      const concreteMarks = countMatches(sentence, /“|”|《|》|\d|：|；|当时|具体|校门口|教室|房间|书桌|操场/g);
      return hasEventCue && len >= 18 && len <= 110 && (!hasProcessCue || concreteMarks <= 1);
    }),
    abstract_gain: /这(?:件事|次经历)?让我(?:明白|懂得|深受触动|感受到)|我终于(?:明白|懂得)|我深深(?:明白|懂得|感受到)|它教会我|让我学会了|收获(?:了)?成长|懂得了/.test(raw),
    pledge_ending: /今后(?:，)?我会|未来(?:，)?我会|往后(?:，)?我会|从那以后|我也会|让[^。！？]{0,16}照亮|成为更好的自己|不负韶华|奔赴(?:远方|山海)|心怀[^。！？]{0,10}(?:感恩|热爱|希望)/.test(lastParagraph)
  };
  const components = Object.entries(componentTests)
    .filter(([, matched]) => matched)
    .map(([name]) => name);
  const ordered = ['generic_opening', 'vague_self_problem', 'thin_event', 'abstract_gain', 'pledge_ending'];
  const orderedHits = ordered.filter((name) => components.includes(name));
  return {
    components,
    componentCount: components.length,
    complete: orderedHits.length >= 4 && components.includes('thin_event') && components.includes('abstract_gain'),
    orderedRatio: Number((orderedHits.length / ordered.length).toFixed(2))
  };
}

function analyzeGoldMisuse(text, context = {}) {
  const raw = String(text || '');
  const paragraphs = context.paragraphs || splitParagraphs(raw);
  const sentences = context.sentences || splitSentences(raw);
  const goldenSentenceCount = Number(context.goldenSentenceCount || 0);
  const paragraphEndingGoldCount = Number(context.paragraphEndingGoldCount || 0);
  const templateChain = context.templateChain || { componentCount: 0 };
  const endingGoldRatio = paragraphs.length ? paragraphEndingGoldCount / paragraphs.length : 0;
  const consecutiveGold = sentences.some((sentence, index) => {
    const next = sentences[index + 1] || '';
    return /最|光|远方|不负|成长|温暖|希望|梦想|品质/.test(sentence) && /最|光|远方|不负|成长|温暖|希望|梦想|品质/.test(next);
  });
  let score = 0;
  if (paragraphs.length >= 3 && endingGoldRatio >= 0.6) score += 2;
  if (goldenSentenceCount >= 3) score += 2;
  if (consecutiveGold) score += 1;
  if (templateChain.componentCount >= 3 && paragraphEndingGoldCount >= 2) score += 2;
  if (/名言|古人云|俗话说|高尔基曾说|一粥一饭/.test(raw) && templateChain.componentCount >= 3) score += 1;
  return score;
}

module.exports = {
  clamp,
  countCjk,
  countMatches,
  escapeRegex,
  splitParagraphs,
  splitSentences,
  getLastNonEmptyLine,
  phraseMatchesText,
  findSegmentForPhrase,
  analyzeRhythm,
  detectTextProfile,
  analyzeEvidenceAnchors,
  analyzeEssayConventions,
  analyzeEssayTemplateChain,
  analyzeInformationDensity,
  analyzeFormattingSignals
};
