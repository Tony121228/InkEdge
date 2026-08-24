const {
  ACTION_PATTERN,
  OBJECT_PATTERN,
  PERSON_PATTERN,
  PLACE_PATTERN,
  QUANTITY_PATTERN,
  FEELING_PATTERN,
  SENSORY_PATTERN,
  TIME_PATTERN,
  collectMatches
} = require('./fact-inventory');
const { splitSentences } = require('./text-metrics');

function sourceTextFor(originalText, factInventory = {}) {
  return `${String(originalText || '')}\n${String(factInventory.sourceBoundary || '')}`;
}

function sourceEvidenceFor(value, sourceItems, sourceText) {
  if (!value) return { supported: true, evidence: '' };
  const raw = String(sourceText || '');
  if (raw.includes(value)) {
    const sentence = splitSentences(raw).find((item) => item.includes(value));
    return { supported: true, evidence: sentence || value };
  }
  const source = (sourceItems || []).find((item) => item === value || item.includes(value) || value.includes(item));
  return source
    ? { supported: true, evidence: source }
    : { supported: false, evidence: null };
}

function claimFor(sentence, value, type, reason, evidence = null) {
  return {
    claim: sentence,
    value,
    type,
    reason,
    evidence
  };
}

const GENERIC_PERSONS = new Set(['人们', '同学', '同学们', '朋友', '父母', '老师', '路人', '少年', '小伙伴']);
const GENERIC_PLACES = new Set(['生活中', '学习中', '课堂上', '课后', '路上', '校园里', '在家里']);
const GENERIC_TIMES = new Set(['那天', '曾经', '从前', '小时候', '后来', '从此', '如今', '未来', '往后', '久而久之', '没过多久']);
const GENERIC_ACTIONS = new Set(['阅读', '学习', '坚持', '调整', '珍惜', '积累', '练笔', '完成']);
const ABSTRACT_OBJECTS = new Set(['作业', '错题', '知识点', '书本', '书籍', '文具']);
const COMMON_SENSORY_DETAILS = new Set(['翠绿', '嫩绿', '金色', '清香', '蝉鸣', '蛙声', '滚烫']);
const STRONG_FEELINGS = new Set(['委屈', '愧疚', '自卑', '沮丧', '慌乱', '满心']);
const WEAK_OBSERVATION_ACTIONS = new Set(['看着', '望着', '听着', '观察']);
const CORE_EVENT_ACTIONS = new Set(['领奖', '比赛', '听讲', '完成', '帮助', '整理', '打扫', '阅读', '学习', '练习', '坚持']);

function isConcreteTime(value) {
  return /\d|[一二三四五六七八九十百千万]+(?:年|月|天|小时|分钟|周|次)|今天|昨天|前天|上周|本周|周末|清晨|早上|上午|中午|午后|下午|傍晚|晚上|夜里|深夜|放学时|放学后|睡前|每(?:天|周|月|年|次)|好几(?:年|天|次|周)/.test(String(value || ''));
}

function hasSupportedCompanionFact(claim = {}, sourceText = '') {
  const sentence = String(claim.claim || '');
  const rawSource = String(sourceText || '');
  if (!sentence || !rawSource) return false;
  const companionValues = [
    ...collectMatches(sentence, PERSON_PATTERN),
    ...collectMatches(sentence, PLACE_PATTERN),
    ...collectMatches(sentence, OBJECT_PATTERN),
    ...collectMatches(sentence, TIME_PATTERN),
    ...collectMatches(sentence, ACTION_PATTERN).filter((item) => item !== claim.value)
  ];
  return companionValues.some((item) => rawSource.includes(item));
}

function isBalancedMildClaim(claim = {}, sourceText = '') {
  const value = String(claim.value || '').trim();
  const sentence = String(claim.claim || '');
  if (claim.type === 'newAction' && WEAK_OBSERVATION_ACTIONS.has(value)) {
    return hasSupportedCompanionFact(claim, sourceText);
  }
  if (claim.type === 'newAction' && CORE_EVENT_ACTIONS.has(value)) {
    return hasSupportedCompanionFact(claim, sourceText);
  }
  if (claim.type === 'newPlace' && /台上|课堂上|课后|生活中|学习中/.test(value)) {
    return hasSupportedCompanionFact(claim, sourceText);
  }
  if (claim.type === 'newFeeling' && !/突然|第一次|终于|从此|再也|彻底|满心/.test(sentence)) {
    return true;
  }
  return false;
}

function classifyClaim(claim = {}, options = {}) {
  const value = String(claim.value || '').trim();
  const text = `${claim.claim || ''}${value}`;
  let blocking = true;
  let safetyReason = '新增了较具体且无来源的事实，需阻断。';

  if (claim.type === 'newPerson') {
    blocking = !GENERIC_PERSONS.has(value);
    safetyReason = blocking ? '新增了具体人物或角色。' : '新增的是泛称人物，宽松放行为警告。';
  } else if (claim.type === 'newPlace') {
    blocking = !GENERIC_PLACES.has(value);
    safetyReason = blocking ? '新增了具体地点或场景。' : '新增的是泛化场景，宽松放行为警告。';
  } else if (claim.type === 'newTime') {
    blocking = isConcreteTime(value) && !GENERIC_TIMES.has(value);
    safetyReason = blocking ? '新增了具体时间或时间跨度。' : '新增的是泛化时间词，宽松放行为警告。';
  } else if (claim.type === 'newQuantity') {
    blocking = true;
    safetyReason = '新增数量仍保持阻断。';
  } else if (claim.type === 'newFeeling') {
    blocking = STRONG_FEELINGS.has(value) && /突然|第一次|终于|从此|再也|彻底|满心/.test(text);
    safetyReason = blocking ? '新增了强烈且具体的心理转折。' : '新增的是低风险情绪判断，宽松放行为警告。';
  } else if (claim.type === 'newSensoryDetail') {
    blocking = !COMMON_SENSORY_DETAILS.has(value);
    safetyReason = blocking ? '新增了具体感官细节。' : '新增的是作文常见感官词，宽松放行为警告。';
  } else if (claim.type === 'newAction') {
    blocking = !GENERIC_ACTIONS.has(value);
    safetyReason = blocking ? '新增了具体事件动作。' : '新增的是泛化动作，宽松放行为警告。';
  } else if (claim.type === 'newObject') {
    blocking = !ABSTRACT_OBJECTS.has(value);
    safetyReason = blocking ? '新增了具体物品或对象。' : '新增的是抽象学习对象，宽松放行为警告。';
  }

  if (options.mode === 'balanced' && blocking && isBalancedMildClaim(claim, options.sourceText)) {
    blocking = false;
    safetyReason = '平衡模式判断为轻微视角、陪衬动作或可由原文场景合理推出的表达，仅提醒人工确认。';
  }

  return {
    ...claim,
    safetySeverity: blocking ? 'blocking' : 'warning',
    safetyReason
  };
}

function classifyFactAudit(factAudit = {}, options = {}) {
  if (options.mode === 'off') {
    return {
      strictPassed: true,
      relaxedPassed: true,
      severity: 'off',
      blockingClaims: [],
      warningClaims: [],
      unsupportedClaims: [],
      enabled: false
    };
  }
  const unsupportedClaims = (factAudit.unsupportedClaims || []).map((claim) => classifyClaim(claim, options));
  const blockingClaims = unsupportedClaims.filter((item) => item.safetySeverity === 'blocking');
  const warningClaims = unsupportedClaims.filter((item) => item.safetySeverity !== 'blocking');
  const strictPassed = unsupportedClaims.length === 0;
  const relaxedPassed = strictPassed || (blockingClaims.length === 0 && warningClaims.length <= 2);
  return {
    strictPassed,
    relaxedPassed,
    severity: strictPassed ? 'strict' : relaxedPassed ? 'warning' : 'blocking',
    blockingClaims,
    warningClaims,
    unsupportedClaims,
    enabled: true,
    mode: options.mode || 'strict'
  };
}

function auditCategory({ type, pattern, sourceItems, sourceText, rewrittenText, reason }) {
  const unsupported = [];
  for (const sentence of splitSentences(rewrittenText)) {
    const matches = collectMatches(sentence, pattern);
    for (const value of matches) {
      const source = sourceEvidenceFor(value, sourceItems, sourceText);
      if (!source.supported) {
        unsupported.push(claimFor(sentence, value, type, reason, source.evidence));
      }
    }
  }
  return unsupported;
}

function auditRewriteFacts(originalText, rewrittenText, factInventory = {}, options = {}) {
  const mode = options.mode || options.auditMode || 'strict';
  if (mode === 'off' || factInventory?.disabled) {
    return {
      passed: true,
      strictPassed: true,
      relaxedPassed: true,
      severity: 'off',
      unsupportedClaims: [],
      blockingClaims: [],
      warningClaims: [],
      alteredClaims: [],
      omittedRequiredFacts: [],
      safeToPublish: true,
      enabled: false,
      mode: 'off'
    };
  }
  const anchors = factInventory.anchors || {};
  const sourceText = sourceTextFor(originalText, factInventory);
  const unsupportedClaims = [
    ...auditCategory({
      type: 'newTime',
      pattern: TIME_PATTERN,
      sourceItems: anchors.timeExpressions,
      sourceText,
      rewrittenText,
      reason: '改写新增了原文或素材边界中没有出现的时间、时段或持续时间。'
    }),
    ...auditCategory({
      type: 'newPerson',
      pattern: PERSON_PATTERN,
      sourceItems: anchors.persons,
      sourceText,
      rewrittenText,
      reason: '改写新增了原文或素材边界中没有出现的人物。'
    }).filter((item) => !['我', '我们', '它'].includes(item.value)),
    ...auditCategory({
      type: 'newPlace',
      pattern: PLACE_PATTERN,
      sourceItems: anchors.places,
      sourceText,
      rewrittenText,
      reason: '改写新增了原文或素材边界中没有出现的地点。'
    }),
    ...auditCategory({
      type: 'newObject',
      pattern: OBJECT_PATTERN,
      sourceItems: anchors.objects,
      sourceText,
      rewrittenText,
      reason: '改写新增了原文或素材边界中没有出现的物品或具体对象。'
    }),
    ...auditCategory({
      type: 'newAction',
      pattern: ACTION_PATTERN,
      sourceItems: anchors.actions,
      sourceText,
      rewrittenText,
      reason: '改写新增了原文或素材边界中没有出现的动作或过程。'
    }),
    ...auditCategory({
      type: 'newQuantity',
      pattern: QUANTITY_PATTERN,
      sourceItems: anchors.quantities,
      sourceText,
      rewrittenText,
      reason: '改写新增了原文或素材边界中没有出现的数量。'
    }),
    ...auditCategory({
      type: 'newFeeling',
      pattern: FEELING_PATTERN,
      sourceItems: anchors.feelings,
      sourceText,
      rewrittenText,
      reason: '改写新增了原文或素材边界中没有出现的心理活动或情绪判断。'
    }),
    ...auditCategory({
      type: 'newSensoryDetail',
      pattern: SENSORY_PATTERN,
      sourceItems: anchors.sensoryDetails,
      sourceText,
      rewrittenText,
      reason: '改写新增了原文或素材边界中没有出现的感官细节。'
    })
  ];

  const deduped = [];
  const seen = new Set();
  for (const item of unsupportedClaims) {
    const key = `${item.type}:${item.value}:${item.claim}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  const limitedClaims = deduped.slice(0, 12);
  const classification = classifyFactAudit({ unsupportedClaims: limitedClaims }, { mode, sourceText });
  return {
    passed: deduped.length === 0,
    strictPassed: classification.strictPassed,
    relaxedPassed: classification.relaxedPassed,
    severity: classification.severity,
    unsupportedClaims: classification.unsupportedClaims,
    blockingClaims: classification.blockingClaims,
    warningClaims: classification.warningClaims,
    alteredClaims: [],
    omittedRequiredFacts: [],
    safeToPublish: classification.strictPassed,
    enabled: classification.enabled,
    mode: classification.mode
  };
}

function buildNeedsUserFacts(factAudit = {}, diagnostics = []) {
  const needs = [];
  const lowInfoDiagnostic = diagnostics.find((item) => /信息|依据|细节/.test(`${item.category || ''}${item.reason || ''}${item.suggestion || ''}`));
  if (lowInfoDiagnostic) {
    needs.push({
      segment: lowInfoDiagnostic.segment,
      missing: '缺少可以支撑这句判断的具体过程、动作或对象。',
      question: '这句话背后具体发生了什么？请补充已有事实，不需要写得很长。'
    });
  }
  for (const claim of factAudit.unsupportedClaims || []) {
    needs.push({
      segment: claim.claim,
      missing: `缺少“${claim.value}”这类新增事实的来源。`,
      question: `原文里没有“${claim.value}”。如果它真实存在，请补充来源；否则系统会删除或压缩它。`
    });
  }
  return needs.slice(0, 6);
}

module.exports = {
  auditRewriteFacts,
  classifyFactAudit,
  buildNeedsUserFacts
};
