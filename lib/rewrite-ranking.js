const { analyzeRhythm, clamp, countCjk, countMatches, splitParagraphs, splitSentences } = require('./text-metrics');

function dedupeTexts(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    if (typeof item !== 'string') return false;
    const normalized = item.trim().replace(/\s+/g, ' ');
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function preserveScore(original, candidate) {
  const originalParagraphs = splitParagraphs(original);
  const candidateParagraphs = splitParagraphs(candidate);
  if (!originalParagraphs.length || !candidateParagraphs.length) return 0;
  const keptParagraphs = originalParagraphs.filter((paragraph) => candidate.includes(paragraph)).length;
  const lengthRatio = countCjk(candidate) / Math.max(1, countCjk(original));
  const paragraphRatio = candidateParagraphs.length / Math.max(1, originalParagraphs.length);
  return clamp(Math.round((keptParagraphs / originalParagraphs.length) * 70 + Math.min(lengthRatio, 1) * 20 + Math.min(paragraphRatio, 1) * 10), 0, 100);
}

function normalizeRewriteCandidates(originalText, items) {
  const originalLength = countCjk(originalText);
  const deduped = dedupeTexts(items);
  return deduped.filter((item) => {
    const ratio = countCjk(item) / Math.max(1, originalLength);
    if (ratio < 0.4) return false;
    if (splitParagraphs(item).length < 1) return false;
    return true;
  }).slice(0, 3);
}

function lengthFitScore(originalText, candidateText, mode = 'balanced') {
  const originalLength = countCjk(originalText);
  if (!originalLength) return { ratio: 1, bonus: 0, penalty: 0, warning: '' };
  const ratio = countCjk(candidateText) / originalLength;
  const ranges = {
    conservative: { min: 0.72, max: 0.92, accept: 0.55 },
    balanced: { min: 0.62, max: 0.85, accept: 0.5 },
    aggressive: { min: 0.55, max: 0.8, accept: 0.45 }
  };
  const policy = ranges[mode] || ranges.balanced;
  let bonus = 0;
  let penalty = 0;
  let warning = '';
  if (ratio >= policy.min && ratio <= policy.max) bonus = 35;
  else if (ratio >= policy.accept && ratio < policy.min) bonus = 12;
  if (ratio >= 0.45 && ratio < 0.55) warning = 'length_warning';
  if (ratio < policy.accept) penalty += Math.round((policy.accept - ratio) * 160);
  if (ratio < 0.45) penalty += Math.round((0.45 - ratio) * 260) + 25;
  if (ratio > 0.98) penalty += 8;
  return { ratio: Number(ratio.toFixed(2)), bonus, penalty, warning };
}

function paragraphCoverageScore(originalText, candidateText) {
  const originalCount = splitParagraphs(originalText).length;
  const candidateCount = splitParagraphs(candidateText).length;
  if (!originalCount || !candidateCount) return { ratio: 0, bonus: 0, penalty: 10 };
  const ratio = candidateCount / originalCount;
  return {
    ratio: Number(ratio.toFixed(2)),
    bonus: ratio >= 0.65 && ratio <= 1.2 ? 18 : 0,
    penalty: ratio < 0.5 ? 16 : 0
  };
}

function rebuildFullRewrite(originalText, suspiciousSegments, candidateText) {
  const originalParagraphs = splitParagraphs(originalText);
  const candidateParagraphs = splitParagraphs(candidateText);
  if (!candidateParagraphs.length || !suspiciousSegments.length) return candidateText;
  if (countCjk(candidateText) / Math.max(1, countCjk(originalText)) >= 0.6) return candidateText;
  if (candidateParagraphs.length > suspiciousSegments.length) return candidateText;
  const rebuilt = [...originalParagraphs];
  suspiciousSegments.slice().sort((a, b) => a.index - b.index).forEach((segment, idx) => {
    if (candidateParagraphs[idx]) rebuilt[segment.index] = candidateParagraphs[idx];
  });
  return rebuilt.join('\n\n');
}

function scoreRewriteCandidate(text, originalText = '', analyzeSignals) {
  const signal = analyzeSignals(text);
  let penalty = signal.probability;
  const sentenceCount = splitSentences(text).length;
  if (originalText && text.trim() === originalText.trim()) penalty += 30;
  if (sentenceCount < 4) penalty += 8;
  if (/总之|因此|让我们|原来|温柔可期|人间烟火/.test(text)) penalty += 12;
  if (countMatches(text, /我记得|那天|其实|后来|当时|比如/g) < 2 && originalText && countMatches(originalText, /我记得|那天|其实|后来|当时|比如/g) >= 2) penalty += 4;
  const preserve = originalText ? preserveScore(originalText, text) : 0;
  if (originalText && preserve < 45) penalty += 28;
  return { text, score: clamp(Math.round(penalty), 0, 100), signal, preserve };
}

function buildRewriteStats(originalText, rankedItems) {
  const originalLength = countCjk(originalText);
  return rankedItems.map((item, index) => {
    const rewrittenLength = countCjk(item.text);
    const compressionRate = originalLength
      ? Number(Math.max(0, 1 - (rewrittenLength / originalLength)).toFixed(2))
      : 0;
    return {
      index,
      probability: item.probability,
      reasons: item.reasons,
      preserve: item.preserve,
      originalLength,
      rewrittenLength,
      compressionRate,
      rhythm: analyzeRhythm(item.text),
      lengthFit: item.lengthFit || lengthFitScore(originalText, item.text),
      paragraphCoverage: item.paragraphCoverage || paragraphCoverageScore(originalText, item.text)
    };
  });
}

module.exports = {
  dedupeTexts,
  preserveScore,
  lengthFitScore,
  paragraphCoverageScore,
  normalizeRewriteCandidates,
  rebuildFullRewrite,
  scoreRewriteCandidate,
  buildRewriteStats
};
