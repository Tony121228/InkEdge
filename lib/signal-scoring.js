const {
  analyzeFormattingSignals,
  analyzeInformationDensity,
  analyzeRhythm,
  clamp,
  countCjk,
  countMatches,
  detectTextProfile,
  getLastNonEmptyLine,
  phraseMatchesText,
  splitParagraphs
} = require('./text-metrics');
const { buildDiagnostics } = require('./diagnostics');

const BASE_WEIGHTS = {
  lexicalScore: 0.18,
  structureScore: 0.18,
  rhythmScore: 0.14,
  informationScore: 0.18,
  stanceScore: 0.14,
  evidenceScore: 0.12,
  formattingScore: 0.06
};

const ESSAY_GENRES = new Set(['散文', '议论文', '记叙文', '日记', '说明文', '读后感', '随笔']);

function isEssayGenre(profile) {
  return ESSAY_GENRES.has(profile?.genreGuess || '');
}

function normalizeGenreGuess(value) {
  const genre = String(value || '').trim();
  return ESSAY_GENRES.has(genre) ? genre : '';
}

function withGenreOverride(profile, genreGuess, source = '') {
  const normalized = normalizeGenreGuess(genreGuess);
  if (!normalized) return profile;
  return {
    ...profile,
    genreGuess: normalized,
    genreSource: source || profile?.genreSource || 'override'
  };
}

function adjustWeightsByGenre(profile) {
  const weights = { ...BASE_WEIGHTS };
  if (profile.genreGuess === '议论文') {
    weights.structureScore = 0.22;
    weights.informationScore = 0.2;
    weights.stanceScore = 0.16;
    weights.evidenceScore = 0.14;
  }
  if (profile.genreGuess === '说明文') {
    weights.informationScore = 0.24;
    weights.evidenceScore = 0.18;
    weights.structureScore = 0.16;
    weights.formattingScore = 0.04;
  }
  if (profile.genreGuess === '散文') {
    weights.lexicalScore = 0.2;
    weights.rhythmScore = 0.18;
    weights.informationScore = 0.16;
    weights.evidenceScore = 0.12;
  }
  if (profile.genreGuess === '记叙文') {
    weights.informationScore = 0.2;
    weights.evidenceScore = 0.16;
    weights.rhythmScore = 0.16;
  }
  if (profile.genreGuess === '日记') {
    weights.rhythmScore = 0.18;
    weights.informationScore = 0.2;
    weights.evidenceScore = 0.16;
    weights.formattingScore = 0.04;
  }
  if (profile.genreGuess === '读后感') {
    weights.lexicalScore = 0.2;
    weights.informationScore = 0.2;
    weights.stanceScore = 0.16;
    weights.evidenceScore = 0.1;
  }

  const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Number((value / total).toFixed(3))]));
}

function scoreDimension(raw, profile, key) {
  let value = raw;
  if (profile.genreGuess === '议论文' && key === 'structureScore') value += 8;
  if (profile.genreGuess === '说明文' && key === 'informationScore') value += 6;
  if (profile.genreGuess === '散文' && key === 'rhythmScore') value += 6;
  if (profile.genreGuess === '日记' && key === 'evidenceScore') value += 4;
  if (profile.genreGuess === '读后感' && key === 'stanceScore') value += 6;
  return clamp(Math.round(value), 0, 100);
}

function calculateDimensionScores(text, knowledgeBase = {}, profile, rhythm, informationDensity, formattingSignals) {
  const raw = String(text || '');
  const paragraphs = splitParagraphs(raw);
  const totalLength = countCjk(raw);
  const clicheHitCount = (knowledgeBase.clichePhrases || []).filter((phrase) => phraseMatchesText(raw, phrase)).length;
  const transitionHitCount = (knowledgeBase.transitions || []).filter((phrase) => phraseMatchesText(raw, phrase)).length;
  const emotionalHitCount = knowledgeBase.emotionalWordsRegex ? countMatches(raw, knowledgeBase.emotionalWordsRegex) : 0;
  const overreachHitCount = (knowledgeBase.overreachPatterns || []).filter((phrase) => phraseMatchesText(raw, phrase)).length;
  const suspiciousSentenceHitCount = (knowledgeBase.suspiciousSentences || []).filter((sentence) => raw.includes(sentence)).length;
  const parallelTriples = countMatches(raw, /一[^，。；\n]{1,10}[，、]\s*一[^，。；\n]{1,10}[，、]\s*一[^，。；\n]{1,14}/g);
  const paragraphLengths = paragraphs.map(countCjk);
  const studentEssayConventionHits = Number(informationDensity.studentEssayConventionHits || 0);
  const aiEssayTemplateHits = Number(informationDensity.aiEssayTemplateHits || informationDensity.essayTemplateHits || 0);
  const goldenSentenceCount = Number(informationDensity.goldenSentenceCount || 0);
  const paragraphEndingGoldCount = Number(informationDensity.paragraphEndingGoldCount || 0);
  const repeatedTopicCount = Number(informationDensity.repeatedTopicCount || 0);
  const templateChain = informationDensity.essayTemplateChain || {};
  const templateChainHits = Number(informationDensity.essayTemplateChainHits || templateChain.componentCount || 0);
  const templateChainComplete = !!(informationDensity.essayTemplateChainComplete || templateChain.complete);
  const goldMisuseCount = Number(informationDensity.goldMisuseCount || 0);
  const anchorProfile = informationDensity.evidenceAnchors || {};
  const lowInfoCount = informationDensity.lowInfoSentences?.length || 0;
  const paragraphUniformityRisk = paragraphLengths.length >= 4
    ? (() => {
        const avg = paragraphLengths.reduce((sum, n) => sum + n, 0) / paragraphLengths.length;
        const std = Math.sqrt(paragraphLengths.reduce((sum, n) => sum + ((n - avg) ** 2), 0) / paragraphLengths.length);
        const uniform = avg > 40 && std / avg < 0.22;
        if (!uniform) return 0;
        const hasSupportSignals = templateChainHits >= 3 || lowInfoCount >= 2 || aiEssayTemplateHits >= 2 || goldMisuseCount >= 1;
        return hasSupportSignals ? 6 : 2;
      })()
    : 0;
  const directHintRisk = getLastNonEmptyLine(raw) && knowledgeBase.directHintRegex?.test(getLastNonEmptyLine(raw)) ? 90 : 0;
  const concreteDetailCount = Math.max(Number(informationDensity.concreteAnchorCount || 0), countMatches(raw, /“|”|"|\d|：|;|；|例如|比如|当时|具体/g));
  const studentGenericRisk = Math.min(10, studentEssayConventionHits * 2);
  const chainRisk = templateChainComplete
    ? 32
    : templateChainHits >= 3
      ? 20
      : templateChainHits >= 2
        ? 8
        : 0;
  const goldRisk = Math.min(14, goldMisuseCount * 5);
  const strongTemplateRisk = Math.min(48, (aiEssayTemplateHits * 8) + chainRisk + goldRisk + (repeatedTopicCount * 2));
  const emotionalRisk = isEssayGenre(profile) ? Math.min(10, emotionalHitCount) : (emotionalHitCount * 3);
  const anchorCategoryCount = Number(anchorProfile.categories || 0);
  const anchorRelief = isEssayGenre(profile)
    ? Math.min(28, (anchorCategoryCount * 5) + Math.min(10, Number(anchorProfile.actionCount || 0)))
    : 0;
  const essayEvidenceBase = totalLength >= 250 ? 66 : 38;
  const essayEvidenceRisk = Math.max(0, essayEvidenceBase - (concreteDetailCount * 8) - anchorRelief);
  const rhythmAuxiliary = templateChainHits >= 3 || aiEssayTemplateHits >= 2 || goldMisuseCount >= 1 || lowInfoCount >= 2;
  const rhythmRisk = rhythmAuxiliary
    ? Math.min(44, rhythm.rhythmScore || 0)
    : Math.min(24, rhythm.rhythmScore || 0);

  return {
    lexicalScore: scoreDimension((clicheHitCount * 10) + emotionalRisk + (suspiciousSentenceHitCount * 18) + directHintRisk + studentGenericRisk + strongTemplateRisk, profile, 'lexicalScore'),
    structureScore: scoreDimension((transitionHitCount * 6) + (parallelTriples * 14) + paragraphUniformityRisk + (profile.hasHeadings && profile.hasList ? 8 : 0) + Math.min(24, aiEssayTemplateHits * 5) + Math.min(18, templateChainHits * 5) + Math.min(12, goldMisuseCount * 4), profile, 'structureScore'),
    rhythmScore: scoreDimension(rhythmRisk + (rhythmAuxiliary ? 3 : 0), profile, 'rhythmScore'),
    informationScore: scoreDimension((informationDensity.score || 0) + Math.min(18, aiEssayTemplateHits * 4) + Math.min(16, templateChainHits * 4) + Math.min(6, studentEssayConventionHits), profile, 'informationScore'),
    stanceScore: scoreDimension((overreachHitCount * 18) + (aiEssayTemplateHits >= 2 ? 6 : 0), profile, 'stanceScore'),
    evidenceScore: scoreDimension(
      essayEvidenceRisk + Math.min(12, aiEssayTemplateHits * 3),
      profile,
      'evidenceScore'
    ),
    formattingScore: scoreDimension(formattingSignals.score || 0, profile, 'formattingScore')
  };
}

function calculateTemplatePressure(dimensionScores, profile, informationDensity) {
  const aiTemplateHits = Number(informationDensity.aiEssayTemplateHits || informationDensity.essayTemplateHits || 0);
  const studentConventionHits = Number(informationDensity.studentEssayConventionHits || 0);
  const goldenSentenceCount = Number(informationDensity.goldenSentenceCount || 0);
  const paragraphEndingGoldCount = Number(informationDensity.paragraphEndingGoldCount || 0);
  const repeatedTopicCount = Number(informationDensity.repeatedTopicCount || 0);
  const templateChain = informationDensity.essayTemplateChain || {};
  const templateChainHits = Number(informationDensity.essayTemplateChainHits || templateChain.componentCount || 0);
  const templateChainComplete = !!(informationDensity.essayTemplateChainComplete || templateChain.complete);
  const goldMisuseCount = Number(informationDensity.goldMisuseCount || 0);
  const essayGenreBonus = isEssayGenre(profile) && aiTemplateHits >= 1 ? 2 : 0;
  const studentConventionPressure = Math.min(6, studentConventionHits);
  const chainPressure = templateChainComplete ? 22 : templateChainHits >= 3 ? 14 : templateChainHits >= 2 ? 5 : 0;
  const strongTemplatePressure = Math.min(26, (aiTemplateHits * 4) + chainPressure + Math.min(8, goldMisuseCount * 3) + Math.min(4, repeatedTopicCount));
  const lowInfoBonus = Math.min(6, (informationDensity.lowInfoSentences?.length || 0) * 2);
  const moderateTemplateBonus = (aiTemplateHits >= 1 || templateChainHits >= 3) && Object.values(dimensionScores).filter((value) => Number(value || 0) >= 45).length >= 3 ? 4 : 0;
  const emptyEssayBonus = isEssayGenre(profile)
    && (aiTemplateHits >= 1 || templateChainHits >= 3)
    && (informationDensity.score || 0) >= 24
    && ((dimensionScores.evidenceScore || 0) >= 45 || (dimensionScores.structureScore || 0) >= 45)
      ? 6
      : 0;

  return clamp(essayGenreBonus + studentConventionPressure + strongTemplatePressure + lowInfoBonus + moderateTemplateBonus + emptyEssayBonus, 0, 36);
}

function calculateConsistencyBonus(dimensionScores, informationDensity, profile) {
  const strongDimensions = Object.values(dimensionScores).filter((value) => Number(value || 0) >= 55).length;
  const weakCoreDimensions = [
    dimensionScores.informationScore || 0,
    dimensionScores.structureScore || 0,
    dimensionScores.evidenceScore || 0
  ].filter((value) => value >= 30).length;

  if (strongDimensions >= 2) return 0;

  let bonus = 0;
  const aiTemplateHits = Number(informationDensity.aiEssayTemplateHits || informationDensity.essayTemplateHits || 0);
  const paragraphEndingGoldCount = Number(informationDensity.paragraphEndingGoldCount || 0);
  const templateChain = informationDensity.essayTemplateChain || {};
  const templateChainHits = Number(informationDensity.essayTemplateChainHits || templateChain.componentCount || 0);
  if (isEssayGenre(profile) && aiTemplateHits >= 1 && weakCoreDimensions >= 2) bonus += 5;
  if (aiTemplateHits >= 1 && (informationDensity.lowInfoSentences?.length || 0) >= 2) bonus += 4;
  if (aiTemplateHits >= 2) bonus += 5;
  if (isEssayGenre(profile) && aiTemplateHits >= 1 && paragraphEndingGoldCount >= 2) bonus += 4;
  if (isEssayGenre(profile) && templateChainHits >= 3 && weakCoreDimensions >= 2) bonus += 6;
  return clamp(bonus, 0, 14);
}

function weightedScore(dimensionScores, weights) {
  return clamp(Math.round(Object.entries(weights).reduce((sum, [key, weight]) => {
    return sum + (Number(dimensionScores[key] || 0) * weight);
  }, 0)), 0, 100);
}

function reasonsFromDimensions(dimensionScores, informationDensity, profile) {
  const labels = {
    lexicalScore: '词语和套话风险偏高',
    structureScore: '结构模板痕迹偏明显',
    rhythmScore: '句长节奏偏匀，仅作为辅助信号',
    informationScore: '信息密度偏低',
    stanceScore: '读者站位有越位感',
    evidenceScore: '细节与依据锚点不足',
    formattingScore: '格式排版有生成痕迹'
  };
  const reasons = Object.entries(dimensionScores)
    .filter(([, value]) => value >= 55)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${labels[key]}（${value}）`);
  if (profile.genreGuess) {
    const source = profile.genreSource === 'user' ? '用户指定' : profile.genreSource === 'model' ? '模型判断' : '文本画像判断';
    reasons.unshift(`${source}为${profile.genreGuess}，已按体裁调整阈值。`);
  }
  if ((informationDensity.essayTemplateChainHits || 0) >= 3) reasons.push(`作文模板链命中 ${informationDensity.essayTemplateChainHits} 个环节。`);
  if (informationDensity.lowInfoSentences?.length) reasons.push(`发现 ${informationDensity.lowInfoSentences.length} 句“正确但没信息量”的表达。`);
  return reasons.filter(Boolean).slice(0, 4);
}

function analyzeAiSignals(text, knowledgeBase, options = {}) {
  knowledgeBase = knowledgeBase || {};
  const profile = withGenreOverride(detectTextProfile(text), options.genreGuess, options.genreSource);
  const rhythm = analyzeRhythm(text);
  const informationDensity = analyzeInformationDensity(text);
  const formattingSignals = analyzeFormattingSignals(text);
  const weights = adjustWeightsByGenre(profile);
  const dimensionScores = calculateDimensionScores(text, knowledgeBase, profile, rhythm, informationDensity, formattingSignals);
  const diagnostics = buildDiagnostics(text, knowledgeBase, {
    profile,
    rhythm,
    informationDensity,
    formattingSignals,
    dimensionScores
  });
  const templateChain = informationDensity.essayTemplateChain || {};
  const templateChainHits = Number(informationDensity.essayTemplateChainHits || templateChain.componentCount || 0);
  const templateChainComplete = !!(informationDensity.essayTemplateChainComplete || templateChain.complete);
  const goldMisuseCount = Number(informationDensity.goldMisuseCount || 0);
  const diagnosticPressure = clamp(
    diagnostics.reduce((sum, item) => sum + (item.severity === 'high' ? 7 : item.severity === 'medium' ? 4 : 1), 0) +
    Math.min(10, (informationDensity.lowInfoSentences?.length || 0) * 2) +
    (informationDensity.essayTemplateHits >= 3 ? 4 : 0) +
    (templateChainComplete ? 8 : templateChainHits >= 3 ? 5 : 0) +
    Math.min(4, goldMisuseCount * 2),
    0,
    30
  );
  const templatePressure = calculateTemplatePressure(dimensionScores, profile, informationDensity);
  const consistencyBonus = calculateConsistencyBonus(dimensionScores, informationDensity, profile);
  const coreScore =
    Number(dimensionScores.informationScore || 0) +
    Number(dimensionScores.structureScore || 0) +
    Number(dimensionScores.evidenceScore || 0);
  const strongAiEvidence =
    Number(informationDensity.aiEssayTemplateHits || informationDensity.essayTemplateHits || 0) >= 2 ||
    (templateChainHits >= 3 && ((informationDensity.lowInfoSentences?.length || 0) >= 1 || goldMisuseCount >= 1 || Number(informationDensity.aiEssayTemplateHits || informationDensity.essayTemplateHits || 0) >= 1)) ||
    Number(informationDensity.aiEssayTemplateHits || informationDensity.essayTemplateHits || 0) >= 1 && Number(informationDensity.paragraphEndingGoldCount || 0) >= 2 ||
    (knowledgeBase.clichePhrases || []).filter((phrase) => phraseMatchesText(text, phrase)).length >= 4 ||
    (knowledgeBase.transitions || []).filter((phrase) => phraseMatchesText(text, phrase)).length >= 4 ||
    countMatches(text, /一[^，。；\n]{1,10}[，、]\s*一[^，。；\n]{1,10}[，、]\s*一[^，。；\n]{1,14}/g) >= 2 ||
    (knowledgeBase.suspiciousSentences || []).filter((sentence) => String(text || '').includes(sentence)).length >= 2;
  let probability = clamp(weightedScore(dimensionScores, weights) + diagnosticPressure + templatePressure + consistencyBonus, 0, 100);

  if (isEssayGenre(profile) && coreScore >= 95 && strongAiEvidence) {
    probability = Math.max(probability, coreScore >= 125 ? 78 : 65);
  }
  if (isEssayGenre(profile) && templateChainComplete && strongAiEvidence) {
    probability = Math.max(probability, 58);
  } else if (isEssayGenre(profile) && templateChainHits >= 3 && strongAiEvidence) {
    probability = Math.max(probability, 52);
  }
  if (
    isEssayGenre(profile)
    && goldMisuseCount >= 1
    && templateChainHits >= 2
    && (
      (informationDensity.lowInfoSentences?.length || 0) >= 1
      || Number(dimensionScores.lexicalScore || 0) >= 45
      || Number(informationDensity.aiEssayTemplateHits || informationDensity.essayTemplateHits || 0) >= 1
    )
  ) {
    probability = Math.max(probability, 50);
  }
  if (isEssayGenre(profile) && coreScore >= 110 && Number(informationDensity.aiEssayTemplateHits || informationDensity.essayTemplateHits || 0) >= 2) {
    probability = Math.max(probability, 80);
  }

  return {
    probability,
    reasons: reasonsFromDimensions(dimensionScores, informationDensity, profile).concat(
      diagnosticPressure >= 8 ? [`累计问题压力较高，已额外加权 ${diagnosticPressure} 分。`] : [],
      templatePressure >= 8 ? [`作文模板与低信息密度叠加，已额外加权 ${templatePressure} 分。`] : [],
      consistencyBonus >= 6 ? [`多维度表现一致偏空，已额外加权 ${consistencyBonus} 分。`] : []
    ).slice(0, 4),
    profile,
    rhythm,
    informationDensity,
    formattingSignals,
    dimensionScores,
    dimensionWeights: weights,
    diagnosticPressure,
    coreScore,
    strongAiEvidence
  };
}

function mergeDetection(modelResult, signalResult, normalizeReasonBonuses, normalizeModelReasons) {
  const modelProbability = clamp(Number(modelResult?.probability || 0), 0, 100);
  const signalProbability = clamp(Number(signalResult?.probability || 0), 0, 100);
  const modelReasonBonuses = normalizeReasonBonuses(modelResult?.reasonBonuses);
  const sortedBonuses = modelReasonBonuses.map((item) => item.bonus).sort((a, b) => b - a);
  const strongestBonus = sortedBonuses[0] || 0;
  const secondBonus = sortedBonuses[1] || 0;
  const thirdBonus = sortedBonuses[2] || 0;
  const rawModelReasonBonusTotal = clamp(
    Math.round((strongestBonus * 1) + (secondBonus * 0.45) + (thirdBonus * 0.2)),
    0,
    24
  );
  const modelReasonBonusTotal = clamp(
    Math.round(rawModelReasonBonusTotal * (modelProbability >= 65 ? 0.9 : modelProbability >= 50 ? 0.75 : 0.55)),
    0,
    12
  );
  let probability = Math.round((modelProbability * 0.25) + (signalProbability * 0.75) + modelReasonBonusTotal);

  if (signalProbability >= 70 && modelProbability <= 30) probability = Math.max(probability, 65);
  if (signalProbability >= 80 && modelProbability <= 20) probability = Math.max(probability, 75);

  const signalCoreScore =
    Number(signalResult?.coreScore || 0) ||
    Number(signalResult?.dimensionScores?.informationScore || 0) +
    Number(signalResult?.dimensionScores?.structureScore || 0) +
    Number(signalResult?.dimensionScores?.evidenceScore || 0);
  const strongAiEvidence = !!signalResult?.strongAiEvidence;
  const templateChain = signalResult?.informationDensity?.essayTemplateChain || {};
  const templateChainHits = Number(signalResult?.informationDensity?.essayTemplateChainHits || templateChain.componentCount || 0);
  const templateChainComplete = !!(signalResult?.informationDensity?.essayTemplateChainComplete || templateChain.complete);
  const goldMisuseCount = Number(signalResult?.informationDensity?.goldMisuseCount || 0);
  if (isEssayGenre(signalResult?.profile) && signalCoreScore >= 95 && strongAiEvidence) {
    probability = Math.max(probability, signalCoreScore >= 125 ? 78 : 65);
  }
  if (isEssayGenre(signalResult?.profile) && templateChainComplete && strongAiEvidence) {
    probability = Math.max(probability, 58);
  } else if (isEssayGenre(signalResult?.profile) && templateChainHits >= 3 && strongAiEvidence) {
    probability = Math.max(probability, 52);
  }
  if (
    isEssayGenre(signalResult?.profile)
    && goldMisuseCount >= 1
    && templateChainHits >= 2
    && (
      (signalResult?.informationDensity?.lowInfoSentences?.length || 0) >= 1
      || Number(signalResult?.dimensionScores?.lexicalScore || 0) >= 45
      || Number(signalResult?.informationDensity?.aiEssayTemplateHits || signalResult?.informationDensity?.essayTemplateHits || 0) >= 1
    )
  ) {
    probability = Math.max(probability, 50);
  }
  if (isEssayGenre(signalResult?.profile) && signalCoreScore >= 110 && Number(signalResult?.informationDensity?.aiEssayTemplateHits || signalResult?.informationDensity?.essayTemplateHits || 0) >= 2) {
    probability = Math.max(probability, 80);
  }

  const reasons = [
    ...(signalResult?.reasons || []),
    ...modelReasonBonuses.map((item) => `${item.reason}（+${item.bonus}）`),
    ...normalizeModelReasons(modelResult?.reasons)
  ].filter((item, index, list) => item && list.indexOf(item) === index).slice(0, 4);

  return {
    probability: clamp(probability, 0, 100),
    reasons,
    profile: signalResult?.profile,
    rhythm: signalResult?.rhythm,
    informationDensity: signalResult?.informationDensity,
    formattingSignals: signalResult?.formattingSignals,
    dimensionScores: signalResult?.dimensionScores,
    dimensionWeights: signalResult?.dimensionWeights,
    diagnosticPressure: signalResult?.diagnosticPressure || 0,
    diagnostics: signalResult?.diagnostics || [],
    scoreBreakdown: {
      signalProbability,
      modelProbability,
      rawModelReasonBonusTotal,
      modelReasonBonusTotal,
      modelReasonBonuses
    }
  };
}

module.exports = {
  BASE_WEIGHTS,
  adjustWeightsByGenre,
  normalizeGenreGuess,
  analyzeAiSignals,
  mergeDetection
};
