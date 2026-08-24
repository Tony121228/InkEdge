const { countCjk, splitParagraphs, splitSentences } = require('./text-metrics');

function sentenceHasFactAnchor(sentence) {
  const raw = String(sentence || '');
  const hasQuoteOrNumber = /“|”|"|《[^》]{1,30}》|\d|[一二三四五六七八九十]+(?:次|天|年|分钟|小时)/.test(raw);
  const hasTimeOrPlaceShape = /(?:那天|有一次|记得|周末|清晨|傍晚|放学|课后|课堂|比赛|活动|在[^，。！？]{1,12}(?:里|中|上|下|旁|边|前|后))/.test(raw);
  const hasSubjectAction = /(?:我|我们|他|她|老师|同学|父母|爸爸|妈妈|朋友|大家|有人)[^。！？]{0,24}(?:说|问|看|听|走|跑|拿|放|写|做|帮|递|借|整理|打扫|完成|练习|道歉|赔偿|提醒|发现|选择|决定|坚持|放弃|参加|回到|走进)/.test(raw);
  const hasObjectStructure = /(?:把|将|给|向|对)[^，。！？]{1,18}(?:放|拿|递|借|还|写|说|讲|整理|清理|送|交|告诉)/.test(raw);
  return hasQuoteOrNumber || hasTimeOrPlaceShape || hasSubjectAction || hasObjectStructure;
}

function sentenceLooksTemplate(sentence) {
  const raw = String(sentence || '').trim();
  return /生活像|梦想是|成长的道路|时光就像|书是人类进步的阶梯|有人说|每个人的心中|赠人玫瑰|手有余香|少年自有|不负韶华|以汗水浇灌|奔赴远方|遇见更好的自己|最便宜的修行|不仅[^。！？!?]{0,18}(?:更|还)|不是[^。！？!?]{0,18}而是|没有[^。！？!?]{0,18}没有[^。！？!?]{0,18}却/.test(raw);
}

function sentenceLooksPlainableEnding(sentence) {
  const raw = String(sentence || '').trim();
  return countCjk(raw) >= 16 && /今后|未来|往后|我会|我也相信|让我明白|终于懂得|教会我|是一束光|最好的模样|最宝贵的财富|最温柔的馈赠|闪闪发光|不负/.test(raw);
}

function paragraphRole(paragraph, index, total) {
  const sentences = splitSentences(paragraph);
  const hasFactAnchor = sentences.some(sentenceHasFactAnchor);
  const templateCount = sentences.filter(sentenceLooksTemplate).length;
  const endingCount = sentences.filter(sentenceLooksPlainableEnding).length;
  const hasTemplateChainCue = /曾经的我|以前的我|我总是|这件事让我|让我明白|今后我会|未来我会|从那以后/.test(paragraph);
  let role = 'body';
  if (index === 0) role = 'opening';
  else if (index === total - 1) role = 'ending';
  else if (hasFactAnchor) role = 'event_or_observation';
  else if (endingCount || templateCount) role = 'reflection';
  if (hasFactAnchor && hasTemplateChainCue && countCjk(paragraph) <= 150) role = 'thin_event';

  let risk = 'safe_content';
  let suggestedAction = hasFactAnchor ? 'keep_or_light_compress' : 'compress';
  if (role === 'opening' && templateCount) {
    risk = 'template_opening';
    suggestedAction = 'compress';
  } else if (role === 'thin_event') {
    risk = 'thin_event';
    suggestedAction = 'light_compress';
  } else if (role === 'ending' && (endingCount || templateCount)) {
    risk = 'golden_sentence_misuse';
    suggestedAction = 'plain_end';
  } else if (!hasFactAnchor && (endingCount || templateCount)) {
    risk = 'floating_reflection';
    suggestedAction = 'compress';
  }

  return {
    index,
    role,
    risk,
    hasFactAnchor,
    suggestedAction,
    sentenceCount: sentences.length,
    length: countCjk(paragraph),
    paragraph
  };
}

function analyzeEssayStructure(text) {
  const paragraphs = splitParagraphs(text);
  return paragraphs.map((paragraph, index) => paragraphRole(paragraph, index, paragraphs.length));
}

function buildStructureEditHints(text) {
  return analyzeEssayStructure(text)
    .filter((item) => item.risk !== 'safe_content' && countCjk(item.paragraph) >= 18)
    .map((item) => ({
      segment: item.paragraph,
      problemType: item.risk === 'template_opening'
        ? '模板化开头'
        : item.risk === 'golden_sentence_misuse'
          ? '金句滥用'
          : item.risk === 'thin_event'
            ? '事件偏薄'
            : '空泛承接',
      action: 'compress',
      reason: item.risk === 'golden_sentence_misuse'
        ? '结尾拔高较满，容易脱离前文事实。'
        : item.risk === 'thin_event'
          ? '段落有事实，但主要承担例子占位，优先轻压缩装饰和抽象收获。'
          : '段落功能偏模板，优先压缩为朴素承接。',
      target: item.suggestedAction === 'plain_end'
        ? '保留与前文事实相连的一句朴素收束，不新增细节。'
        : '压缩套话，保留必要事实和段落功能。'
    }))
    .slice(0, 3);
}

module.exports = {
  analyzeEssayStructure,
  buildStructureEditHints,
  sentenceHasFactAnchor,
  sentenceLooksPlainableEnding,
  sentenceLooksTemplate
};
