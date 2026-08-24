const {
  analyzeInformationDensity,
  analyzeRhythm,
  countMatches,
  splitParagraphs
} = require('./text-metrics');
const { sanitizeWritingSample, TRANSITION_WORDS } = require('./voice-profile');

const PUNCTUATION_MARKS = ['，', '。', '；', '、', '！', '？', '：', '“', '”'];
const PLAIN_WORDS = ['其实', '不过', '后来', '当时', '我觉得', '我想', '有点', '慢慢', '没那么', '还好'];
const GRAND_WORDS = ['深刻', '重要', '价值', '意义', '时代', '格局', '赋能', '底层逻辑', '闪闪发光', '奔赴远方', '不负韶华'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function vectorFor(text, items) {
  return items.map((item) => countMatches(text, new RegExp(escapeRegex(item), 'g')));
}

function cosine(a, b) {
  const dot = a.reduce((sum, value, index) => sum + value * (b[index] || 0), 0);
  const magA = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
  const magB = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0));
  if (!magA && !magB) return 1;
  if (!magA || !magB) return 0;
  return dot / (magA * magB);
}

function jaccard(a, b) {
  const setA = new Set((a || []).filter(Boolean));
  const setB = new Set((b || []).filter(Boolean));
  if (!setA.size && !setB.size) return 1;
  const intersection = Array.from(setA).filter((item) => setB.has(item)).length;
  return intersection / Math.max(1, new Set([...setA, ...setB]).size);
}

function closeness(a, b, scale) {
  const diff = Math.abs(Number(a || 0) - Number(b || 0));
  return clamp(1 - (diff / Math.max(1, scale)), 0, 1);
}

function paragraphOpening(paragraph) {
  const raw = String(paragraph || '').trim();
  if (!raw) return '';
  const transition = TRANSITION_WORDS.find((word) => raw.startsWith(word));
  if (transition) return transition;
  if (/^我/.test(raw)) return '我';
  if (/^(那|这|从|在|有|曾经|小时候|后来|如今)/.test(raw)) return raw.slice(0, 2);
  return raw.slice(0, 2);
}

function dictionVector(text) {
  const raw = String(text || '');
  return [
    PLAIN_WORDS.reduce((sum, word) => sum + countMatches(raw, new RegExp(word, 'g')), 0),
    GRAND_WORDS.reduce((sum, word) => sum + countMatches(raw, new RegExp(word, 'g')), 0),
    countMatches(raw, /我觉得|我想|其实|不过/g),
    countMatches(raw, /必须|一定|真正|深深|格外/g)
  ];
}

function endingStyleValue(text) {
  const paragraphs = splitParagraphs(text);
  const ending = paragraphs[paragraphs.length - 1] || '';
  if (!ending) return 0;
  if (/今后|未来|不负韶华|奔赴|闪闪发光|成为更好的自己/.test(ending)) return 0.2;
  if (ending.length <= 90) return 1;
  return 0.65;
}

function styleFeatures(text) {
  const raw = String(text || '');
  const paragraphs = splitParagraphs(raw);
  const rhythm = analyzeRhythm(raw);
  return {
    averageSentenceLength: Number(rhythm.averageSentenceLength || 0),
    burstinessScore: Number(rhythm.burstinessScore || 0),
    sentenceStdDev: Number(rhythm.sentenceStdDev || 0),
    punctuationVector: vectorFor(raw, PUNCTUATION_MARKS),
    transitionVector: vectorFor(raw, TRANSITION_WORDS),
    transitionHits: TRANSITION_WORDS.filter((word) => raw.includes(word)),
    openingPatterns: paragraphs.map(paragraphOpening).filter(Boolean).slice(0, 8),
    topPunctuation: PUNCTUATION_MARKS
      .map((mark) => ({ mark, count: countMatches(raw, new RegExp(escapeRegex(mark), 'g')) }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((item) => item.mark),
    dictionVector: dictionVector(raw),
    endingStyleValue: endingStyleValue(raw),
    informationDensity: analyzeInformationDensity(raw)
  };
}

function scoreTextAgainstSample(text, writingSamples) {
  const sanitized = sanitizeWritingSample(writingSamples);
  const sampleText = sanitized.cleanedText;
  const features = styleFeatures(text);
  const sampleFeatures = styleFeatures(sampleText);
  const components = {
    sentenceLengthFit: Math.round(closeness(features.averageSentenceLength, sampleFeatures.averageSentenceLength, 18) * 100),
    burstinessFit: Math.round(closeness(features.burstinessScore, sampleFeatures.burstinessScore, 0.5) * 100),
    openingFit: Math.round(jaccard(features.openingPatterns, sampleFeatures.openingPatterns) * 100),
    transitionFit: Math.round(cosine(features.transitionVector, sampleFeatures.transitionVector) * 100),
    punctuationFit: Math.round(cosine(features.punctuationVector, sampleFeatures.punctuationVector) * 100),
    dictionFit: Math.round(cosine(features.dictionVector, sampleFeatures.dictionVector) * 100),
    endingFit: Math.round(closeness(features.endingStyleValue, sampleFeatures.endingStyleValue, 1) * 100)
  };
  const total = Math.round(
    components.sentenceLengthFit * 0.18 +
    components.burstinessFit * 0.14 +
    components.openingFit * 0.14 +
    components.transitionFit * 0.13 +
    components.punctuationFit * 0.17 +
    components.dictionFit * 0.14 +
    components.endingFit * 0.10
  );
  return { total, components, features, sampleFeatures, sample: sanitized };
}

function aiTemplateReduction(originalText, rewrittenText) {
  const before = analyzeInformationDensity(originalText);
  const after = analyzeInformationDensity(rewrittenText);
  const beforeRisk = Number(before.aiEssayTemplateHits || 0) + Number(before.essayTemplateChainHits || 0) + Number(before.goldMisuseCount || 0);
  const afterRisk = Number(after.aiEssayTemplateHits || 0) + Number(after.essayTemplateChainHits || 0) + Number(after.goldMisuseCount || 0);
  if (!beforeRisk && !afterRisk) return 100;
  return Math.round(clamp((beforeRisk - afterRisk + 2) / Math.max(2, beforeRisk + 2), 0, 1) * 100);
}

function passThreshold(confidence) {
  if (confidence === 'high') return { gain: 6, total: 65 };
  if (confidence === 'medium') return { gain: 4, total: 58 };
  if (confidence === 'low') return { gain: 2, total: 52 };
  return null;
}

function failureReasonsFor(score, threshold) {
  if (!threshold) return ['样本画像不可用'];
  const reasons = [];
  const c = score.components || {};
  if (c.sentenceLengthFit < 50) reasons.push('句长未贴近');
  if (c.burstinessFit < 50) reasons.push('句长波动未贴近');
  if (c.openingFit < 35) reasons.push('段落开头未贴近');
  if (c.transitionFit < 35) reasons.push('转场未贴近');
  if (c.punctuationFit < 50) reasons.push('标点习惯未贴近');
  if (c.dictionFit < 45) reasons.push('朴素程度未贴近');
  if (c.endingFit < 55) reasons.push('结尾仍是通用口号');
  if (score.gain < threshold.gain && score.total < threshold.total) reasons.push('风格贴近度提升不足');
  return reasons;
}

function compareVoiceFit({ originalText, rewrittenText, writingSamples, voiceProfile = {}, factAudit = {} }) {
  const confidence = voiceProfile.boundaries?.confidence || voiceProfile.boundary?.confidence || 'none';
  const threshold = passThreshold(confidence);
  const original = scoreTextAgainstSample(originalText, writingSamples);
  const rewritten = scoreTextAgainstSample(rewrittenText, writingSamples);
  const templateReduction = aiTemplateReduction(originalText, rewrittenText);
  const factSafetyPenalty = factAudit?.passed === false ? 30 : 0;
  const total = clamp(Math.round((rewritten.total * 0.88) + (templateReduction * 0.12) - factSafetyPenalty), 0, 100);
  const gain = total - original.total;
  const score = {
    total,
    originalTotal: original.total,
    gain,
    confidence,
    sentenceLengthFit: rewritten.components.sentenceLengthFit,
    burstinessFit: rewritten.components.burstinessFit,
    openingFit: rewritten.components.openingFit,
    transitionFit: rewritten.components.transitionFit,
    punctuationFit: rewritten.components.punctuationFit,
    dictionFit: rewritten.components.dictionFit,
    endingFit: rewritten.components.endingFit,
    aiTemplateReduction: templateReduction,
    factSafetyPenalty,
    components: rewritten.components,
    features: rewritten.features,
    sampleFeatures: rewritten.sampleFeatures,
    threshold,
    participates: !!threshold
  };
  score.passed = !!threshold && (gain >= threshold.gain || total >= threshold.total) && factSafetyPenalty === 0;
  score.failureReasons = score.passed ? [] : failureReasonsFor(score, threshold);
  return score;
}

module.exports = {
  compareVoiceFit,
  scoreTextAgainstSample,
  styleFeatures
};
