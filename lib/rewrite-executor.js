const { buildFactInventory } = require('./fact-inventory');
const { auditRewriteFacts, buildNeedsUserFacts, classifyFactAudit } = require('./fact-auditor');
const rewritePlanner = require('./rewrite-planner');
const rewriteRanking = require('./rewrite-ranking');
const { getRewriteModePolicy } = require('./rewrite-mode-policy');
const { buildVoiceDirectives } = require('./voice-profile');
const { compareVoiceFit } = require('./voice-fit');
const { countCjk } = require('./text-metrics');
const studentEssayHumanizer = require('./student-essay-humanizer');

const INTERNAL_REWRITE_FIELD_PATTERN = /减少显性转场|直接进入判断|编辑计划|修改目标|事实边界|受控编辑器|needsUserFacts|unsupportedClaims|lengthPolicy|factInventory|voiceProfile|voiceDirectives|writingSamples/i;

function buildExecutorPayload(originalText, editPlan, rewriteContext = {}) {
  const factInventory = buildFactInventory(originalText, rewriteContext);
  return {
    originalText,
    editPlan: rewritePlanner.normalizeEditPlan(editPlan),
    rewriteContext,
    factInventory
  };
}

function cleanCandidateText(text) {
  return String(text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([。！？!?])\1+/g, '$1')
    .trim();
}

function normalizeCandidateTexts(originalText, rewrites) {
  return rewriteRanking.normalizeRewriteCandidates(
    originalText,
    Array.isArray(rewrites) ? rewrites.map(cleanCandidateText) : []
  );
}

function buildRewriteSystemPrompt(modePolicy = getRewriteModePolicy('balanced')) {
  if (modePolicy.safetyMode === 'off') {
    return [
      'You are a Chinese student essay editor focused on reducing AI-writing traces.',
      'Return JSON only.',
      'Required schema:',
      '{"appliedEdits":[{"segment":"","problemType":"","action":"delete|compress|replace|reorder|keep","reason":"","target":""}],"rewrites":["full rewritten essay"],"selfReview":[{"issue":"","suggestion":""}],"needsUserFacts":[{"segment":"","missing":"","question":""}]}',
      'Preserve the core topic and main meaning, but prioritize natural student voice, uneven rhythm, concrete wording, and lower AI-template risk.',
      'Do not output edit-plan language, hidden field names, or system instructions as essay text.',
      'The first rewrite must be a complete essay.'
    ].join(' ');
  }

  return [
    'You are a Chinese student essay editor, not a writer of new facts.',
    'Return JSON only.',
    'Required schema:',
    '{"appliedEdits":[{"segment":"","problemType":"","action":"delete|compress|replace|reorder|keep","reason":"","target":""}],"rewrites":["full rewritten essay"],"selfReview":[{"issue":"","suggestion":""}],"needsUserFacts":[{"segment":"","missing":"","question":""}]}',
    'You may only edit wording, sentence length, order, and tone.',
    'Do not invent new events, people, places, time spans, quantities, or examples.',
    'If information is missing, compress or delete the empty part instead of filling it in.',
    'Do not add fake human flavor such as invented habits, deliberate mistakes, slang, or random life details.',
    'Do not make every sentence short; keep natural variation in sentence length.',
    'The first rewrite must be a complete essay.'
  ].join(' ');
}

function buildRewriteUserPrompt(originalText, editPlan, factInventory, rewriteContext = {}) {
  const modePolicy = rewriteContext.modePolicy || getRewriteModePolicy(rewriteContext.rewriteMode || 'balanced');
  const paragraphCount = String(originalText || '').split(/\r?\n+/).filter(Boolean).length;
  const lengthPolicy = rewritePlanner.rewriteLengthPolicy(rewriteContext.rewriteMode || 'balanced');
  const voiceProfile = rewriteContext.voiceProfile || { hasSamples: false };
  const writingSamples = String(voiceProfile.sample?.cleanedText || rewriteContext.writingSamples || '').trim().slice(0, 1200);
  const voiceDirectives = Array.isArray(rewriteContext.voiceDirectives)
    ? rewriteContext.voiceDirectives
    : buildVoiceDirectives(voiceProfile);
  const studentEssayContext = studentEssayHumanizer.buildStudentEssayPromptContext({
    originalText,
    genre: rewriteContext.studentEssayGenre,
    ruleHits: rewriteContext.studentEssayRuleHits || [],
    editPlan,
    factInventory,
    voiceProfile,
    studentActions: rewriteContext.studentEssay || null
  });
  const factBoundaryPrompt = modePolicy.promptFactBoundary === 'off'
    ? [
        'Mode note:',
        'Aggressive mode is selected: prioritize AI-trace reduction. Do not run or expose fact-inventory constraints in the prompt. Keep the core topic recognizable and avoid internal instruction leakage.'
      ].join('\n')
    : [
        'factInventory JSON:',
        JSON.stringify(factInventory, null, 2),
        '',
        'Fact boundary rule:',
        modePolicy.promptFactBoundary === 'soft'
          ? 'Balanced mode: use the fact inventory as a soft reminder. Prefer preserving facts, but factual warnings must not replace a usable model rewrite with conservative fallback.'
          : 'Conservative mode: original essay and sourceBoundary are the only fact sources. Unsupported concrete facts must be removed, compressed, or surfaced in needsUserFacts.'
      ].join('\n');
  const lines = [
    'Rewrite this Chinese student composition as a careful editor.',
    `rewriteMode: ${rewriteContext.rewriteMode || 'balanced'}`,
    `genre: ${rewriteContext.genre || studentEssayContext.genre || factInventory?.profile?.genreGuess || 'unknown'}`,
    `tone: ${rewriteContext.tone || 'default'}`,
    `keepAboutParagraphs: ${paragraphCount}`,
    `lengthPolicy: ${JSON.stringify(lengthPolicy)}`,
    `studentEssayLengthRatio: ${JSON.stringify(studentEssayContext.lengthRatio)}`,
    `studentEssayWorkflowVersion: ${studentEssayContext.workflowVersion}`,
    `voiceCalibrationUsed: ${voiceProfile.hasSamples ? 'true' : 'false'}`,
    '',
    'Student essay humanizer core prompt:',
    studentEssayContext.corePrompt,
    '',
    'studentEssayRuleHits JSON (current essay only, max 8):',
    JSON.stringify(studentEssayContext.ruleHits, null, 2),
    '',
    'studentEssayActions JSON (filtered by genre and protected facts):',
    JSON.stringify(studentEssayContext.actions, null, 2),
    '',
    'studentEssayProtectedSpans JSON:',
    JSON.stringify(studentEssayContext.protectedSpans, null, 2),
    '',
    'studentEssayForbiddenActions JSON:',
    JSON.stringify(studentEssayContext.forbiddenActions, null, 2),
    '',
    factBoundaryPrompt,
    '',
    'voiceProfile JSON:',
    JSON.stringify(voiceProfile, null, 2),
    '',
    'voiceDirectives JSON:',
    JSON.stringify(voiceDirectives, null, 2),
    'writingSamples excerpt for low-priority reference only:',
    writingSamples || '(none)',
    '',
    'editPlan JSON:',
    JSON.stringify(editPlan, null, 2),
    '',
    'Rules:',
    modePolicy.promptFactBoundary === 'off'
      ? '1. Aggressive mode: prioritize lowering AI traces while keeping the core topic and main meaning recognizable.'
      : '1. Keep the original facts boundary.',
    modePolicy.promptFactBoundary === 'off'
      ? '2. Avoid obvious topic drift and keep a complete essay.'
      : '2. Do not add new people, scenes, tools, actions, or time spans.',
    '3. If a sentence is too empty, delete or compress it.',
    '4. If a part is safe, keep it.',
    modePolicy.promptFactBoundary === 'off'
      ? '5. Do not produce needsUserFacts in aggressive mode; keep the essay complete and focused on AI-trace reduction.'
      : modePolicy.promptFactBoundary === 'soft'
        ? '5. If a detail feels uncertain, keep the candidate usable and mention the uncertainty in selfReview, not as a blocking failure.'
        : '5. If a detail has no source, report it in needsUserFacts instead of inventing it.',
    modePolicy.promptFactBoundary === 'off'
      ? '6. Empty-to-plain rule: remove or rewrite empty template sentences directly; do not output fact-audit fields or source-boundary notes.'
      : "6. Empty-to-plain rule: when a segment is \u201c\u6b63\u786e\u4f46\u6ca1\u4fe1\u606f\u91cf\u201d or \u201c\u7ec6\u8282\u4e0e\u4f9d\u636e\u4e0d\u8db3\u201d, do NOT turn it into a new concrete scene. Either delete it, compress it, or use editPlan[i].plainRewriteTarget as a neutral judgement.",
    '7. Remove over-positioning: do not invent reader misunderstandings such as “很多人以为” or “你可能觉得” unless they are already in the source.',
    '8. Follow the writing sample only for sentence length, openings, wording habits, punctuation, and transitions.',
    modePolicy.promptFactBoundary === 'off'
      ? '9. Keep enough length and paragraph coverage for a complete essay; do not over-delete just to lower the score.'
      : '9. Prefer compressing and reordering fact-bearing sentences before deleting them. Do not cut below lengthPolicy.minAcceptRatio unless fact audit would otherwise fail.',
    '10. Keep paragraph roles recognizable: opening, body/event or observation, reflection, ending. Do not turn structural notes or edit-plan language into essay text.',
    '11. Writing samples are for voice calibration only. Learn sentence length, sentence variation, paragraph openings, wording habits, punctuation habits, and transitions.',
    '12. Use writing samples only as a low-priority surface style reference.',
    modePolicy.promptFactBoundary === 'off'
      ? '13. Apply voice calibration across the full essay at the surface level; keep the core topic recognizable.'
      : '13. Apply voice calibration across the full essay at the surface level, not only inside suspicious segments. Keep all factual content within original essay and sourceBoundary.',
    '14. Preserve plain or immature student wording when it matches the sample voice; do not upgrade it into generic polished commentary.',
    '15. Prioritize voiceDirectives over raw writingSamples. Raw samples are reference material, not a source of content.',
    modePolicy.promptFactBoundary === 'soft'
      ? '16. If voice calibration creates a small factual uncertainty, keep the candidate usable and report the uncertainty for manual confirmation.'
      : modePolicy.promptFactBoundary === 'off'
        ? '16. In aggressive mode, fact audit is disabled; do not mention fact audit in the essay.'
        : '16. If voice calibration conflicts with fact safety, fact safety wins.',
    'Original essay:',
    originalText
  ];
  return lines.join('\n');
}

function normalizeNeedsUserFacts(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      segment: String(item?.segment || '').trim().slice(0, 180),
      missing: String(item?.missing || '').trim().slice(0, 180),
      question: String(item?.question || '').trim().slice(0, 180)
    }))
    .filter((item) => item.segment || item.missing || item.question);
}

function candidateLengthRatio(originalText, candidateText) {
  return countCjk(candidateText) / Math.max(1, countCjk(originalText));
}

function isCandidateAcceptable(item, options = {}) {
  const modePolicy = options.modePolicy || getRewriteModePolicy(options.rewriteMode || 'balanced');
  if (!item?.text || !String(item.text).trim()) return false;
  if (INTERNAL_REWRITE_FIELD_PATTERN.test(String(item.text || ''))) return false;
  const audit = item.audit || {};
  const safety = audit.relaxedPassed === undefined ? classifyFactAudit(audit, { mode: modePolicy.auditMode }) : audit;
  if (candidateLengthRatio(options.originalText, item.text) < 0.45) return false;
  if (!modePolicy.factAuditBlocking) return true;
  if (audit.passed) return true;
  if (!options.relaxedSafety) return false;
  if (!safety.relaxedPassed) return false;
  if ((safety.blockingClaims || []).length) return false;
  if ((safety.unsupportedClaims || []).length > 2) return false;
  if ((safety.unsupportedClaims || []).some((claim) => claim.type === 'newQuantity')) return false;
  return true;
}

function acceptedStatus(baseStatus, item, modePolicy = getRewriteModePolicy('balanced')) {
  if (!modePolicy.factAuditEnabled) return baseStatus === 'safe' ? 'model_generated' : baseStatus;
  if (!modePolicy.factAuditBlocking && !item?.audit?.passed) return 'fact_warning';
  if (item?.audit?.passed) return baseStatus;
  if (baseStatus === 'repaired') return 'relaxed_repaired';
  return 'relaxed_safe';
}

function pickSafeCandidates(originalText, candidates, factInventory, analyzeSignals, options = {}) {
  const ranked = rankCandidates(originalText, candidates, factInventory, null, analyzeSignals, options);
  const modePolicy = options.modePolicy || getRewriteModePolicy(options.rewriteMode || 'balanced');
  const acceptableRanked = ranked.filter((item) => isCandidateAcceptable(item, { ...options, originalText, relaxedSafety: true, modePolicy }));
  return {
    ranked,
    safeRanked: ranked.filter((item) => item.audit?.passed && isCandidateAcceptable(item, { ...options, originalText, modePolicy })),
    relaxedRanked: acceptableRanked.filter((item) => !item.audit?.passed),
    acceptableRanked,
    unsafeRanked: ranked.filter((item) => !acceptableRanked.includes(item))
  };
}

function expandCandidatesWithSecondPass(originalText, candidates, editPlan, analyzeSignals, options = {}) {
  if (typeof analyzeSignals !== 'function') return candidates;
  const originalAnalysis = options.originalAnalysis || analyzeSignals(originalText);
  const expanded = [...candidates];
  for (const text of candidates) {
    const analysis = analyzeSignals(text);
    if (!rewritePlanner.needsSecondConservativePass(originalAnalysis, analysis, originalText, text)) continue;
    const secondPass = rewritePlanner.buildConservativeRewrite(originalText, editPlan, {
      rewriteMode: options.rewriteMode,
      baseText: text,
      forceSecondPass: true
    });
    if (secondPass && secondPass !== text) expanded.push(secondPass);
  }
  return expanded;
}

async function callRewriteModel(callModel, payload) {
  const basePayload = {
    ...payload,
    maxTokens: payload.maxTokens || 2200
  };
  try {
    const result = await callModel(basePayload);
    result.rewriteAttemptMeta = { firstAttempt: 'ok', jsonRepair: 'skipped', secondAttempt: 'skipped' };
    return result;
  } catch (firstError) {
    const meta = {
      firstAttempt: firstError?.failureCode || firstError?.message || 'failed',
      jsonRepair: 'skipped',
      secondAttempt: 'skipped'
    };
    if (firstError?.rawContent) {
      try {
        const repaired = await callModel({
          ...basePayload,
          maxTokens: Math.min(basePayload.maxTokens, 1600),
          systemPrompt: 'You repair malformed JSON. Return JSON only, following the original schema. Do not rewrite the essay content.',
          userPrompt: [
            'Repair this malformed model output into valid JSON for the required rewrite schema.',
            'Keep existing rewrite text exactly when possible.',
            'Raw model output:',
            firstError.rawContent
          ].join('\n')
        });
        repaired.rewriteAttemptMeta = { ...meta, jsonRepair: 'ok' };
        return repaired;
      } catch (repairError) {
        meta.jsonRepair = repairError?.failureCode || repairError?.message || 'failed';
      }
    }
    try {
      const second = await callModel({
        ...basePayload,
        userPrompt: [
          basePayload.userPrompt,
          '',
          'Previous rewrite output failed JSON parsing or transport validation. Retry once with strict valid JSON only.'
        ].join('\n')
      });
      second.rewriteAttemptMeta = { ...meta, secondAttempt: 'ok' };
      return second;
    } catch (secondError) {
      secondError.firstAttemptError = meta.firstAttempt;
      secondError.repairAttemptError = meta.jsonRepair;
      secondError.secondAttemptError = secondError?.failureCode || secondError?.message || 'failed';
      throw secondError;
    }
  }
}

function evaluateVoiceFitForCandidate(originalText, candidateText, factAudit, rewriteContext = {}) {
  const writingSamples = String(rewriteContext.voiceProfile?.sample?.cleanedText || rewriteContext.writingSamples || '').trim();
  return compareVoiceFit({
    originalText,
    rewrittenText: candidateText,
    writingSamples,
    voiceProfile: rewriteContext.voiceProfile || {},
    factAudit
  });
}

async function calibrateVoiceSurface({
  originalText,
  candidate,
  factInventory,
  editPlan,
  rewriteContext,
  callModel,
  usageTracker
}) {
  const voiceProfile = rewriteContext?.voiceProfile || { hasSamples: false };
  const writingSamples = String(voiceProfile.sample?.cleanedText || rewriteContext?.writingSamples || '').trim().slice(0, 1200);
  if (!voiceProfile.hasSamples || !writingSamples) return null;
  const voiceFit = candidate.voiceFit || evaluateVoiceFitForCandidate(
    originalText,
    candidate.text,
    candidate.audit,
    rewriteContext
  );
  if (!voiceFit.participates || voiceFit.passed || voiceFit.factSafetyPenalty > 0) return null;

  const voiceDirectives = Array.isArray(rewriteContext?.voiceDirectives)
    ? rewriteContext.voiceDirectives
    : buildVoiceDirectives(voiceProfile);
  const result = await callRewriteModel(callModel, {
    model: rewriteContext?.model,
    timeoutMs: rewriteContext?.timeoutMs,
    usageTracker,
    maxTokens: 1800,
    systemPrompt: [
      'You perform a second-pass surface voice calibration for a Chinese student essay.',
      'Return JSON only: {"rewrites":[""],"selfReview":[{"issue":"","suggestion":""}]}',
      'Do not add, remove, or change facts.',
      'Do not import facts from writing samples.',
      'Only adjust sentence length, rhythm, paragraph opening style, diction, punctuation, and ending style.'
    ].join(' '),
    userPrompt: [
      'Second-pass voice calibration. Keep facts identical to the candidate rewrite.',
      '',
      'voiceFit failure reasons:',
      JSON.stringify(voiceFit.failureReasons || [], null, 2),
      '',
      'voiceDirectives JSON:',
      JSON.stringify(voiceDirectives, null, 2),
      '',
      'voiceProfile JSON:',
      JSON.stringify(voiceProfile, null, 2),
      '',
      'factInventory JSON:',
      JSON.stringify(factInventory, null, 2),
      '',
      'editPlan JSON:',
      JSON.stringify(editPlan, null, 2),
      '',
      'writingSamples excerpt for low-priority surface reference only:',
      writingSamples || '(none)',
      '',
      'Hard boundaries:',
      'Original essay and sourceBoundary are the only fact sources.',
      '',
      'Original essay:',
      originalText,
      '',
      'Fact-safe candidate rewrite:',
      candidate.text
    ].join('\n')
  });

  const rewrites = normalizeCandidateTexts(originalText, result?.json?.rewrites);
  return {
    rewrites,
    selfReview: Array.isArray(result?.json?.selfReview) ? result.json.selfReview : []
  };
}

async function repairRewriteCandidate({
  originalText,
  factInventory,
  editPlan,
  rewriteContext,
  callModel,
  usageTracker,
  unsafeCandidate,
  analyzeSignals
}) {
  const modePolicy = rewriteContext?.modePolicy || getRewriteModePolicy(rewriteContext?.rewriteMode || 'balanced');
  const repair = await callRewriteModel(callModel, {
    model: rewriteContext?.model,
    timeoutMs: rewriteContext?.timeoutMs,
    usageTracker,
    maxTokens: 2200,
    systemPrompt: [
      'You repair Chinese essay rewrites.',
      'Return JSON only.',
      'Do not invent facts.',
      'For segments with problemType \u201c\u6b63\u786e\u4f46\u6ca1\u4fe1\u606f\u91cf\u201d / \u201c\u7ec6\u8282\u4e0e\u4f9d\u636e\u4e0d\u8db3\u201d / \u201c\u5ba3\u4f20\u8154\u201d / \u201c\u516c\u5f0f\u7ed3\u6784\u201d, never invent new scenes, actions, time spans, or life details. Replace them with compress/delete or with editPlan[i].plainRewriteTarget and surface them in needsUserFacts.',
      'Preserve safe fact-bearing sentences by compressing or reordering them before deletion.',
      'Do not return an over-short rewrite; keep the essay complete unless facts are unsafe.',
      'Writing samples and voiceProfile are style constraints only; never import facts from writing samples.',
    ].join(' '),
    userPrompt: [
      'Repair the rewrite so it stays within the original facts boundary.',
      '',
      'factInventory JSON:',
      JSON.stringify(factInventory, null, 2),
      '',
      'voiceProfile JSON:',
      JSON.stringify(rewriteContext?.voiceProfile || { hasSamples: false }, null, 2),
      '',
      'voiceDirectives JSON:',
      JSON.stringify(rewriteContext?.voiceDirectives || buildVoiceDirectives(rewriteContext?.voiceProfile || {}), null, 2),
      '',
      'writingSamples excerpt for voice calibration only:',
      String(rewriteContext?.voiceProfile?.sample?.cleanedText || rewriteContext?.writingSamples || '').trim().slice(0, 1200) || '(none)',
      '',
      'editPlan JSON:',
      JSON.stringify(editPlan, null, 2),
      '',
      'Unsupported claims detected:',
      JSON.stringify((unsafeCandidate?.audit?.unsupportedClaims || []).slice(0, 12), null, 2),
      '',
      'Original essay:',
      originalText,
      '',
      'Unsafe rewrite:',
      unsafeCandidate?.text || ''
    ].join('\n')
  });

  const rewrites = normalizeCandidateTexts(originalText, repair?.json?.rewrites);
  const ranked = pickSafeCandidates(originalText, rewrites, factInventory, analyzeSignals, {
    rewriteMode: rewriteContext?.rewriteMode,
    modePolicy,
    writingSamples: rewriteContext?.voiceProfile?.sample?.cleanedText || rewriteContext?.writingSamples,
    voiceProfile: rewriteContext?.voiceProfile,
    studentEssayGenre: rewriteContext?.studentEssayGenre,
    studentEssayRuleHits: rewriteContext?.studentEssayRuleHits,
    originalAiScore: rewriteContext?.originalAiScore
  });
  return {
    rewrites,
    ranked,
    selfReview: Array.isArray(repair?.json?.selfReview) ? repair.json.selfReview : [],
    needsUserFacts: normalizeNeedsUserFacts(repair?.json?.needsUserFacts)
  };
}

function buildFinalRewritePackage({
  originalText,
  candidates,
  factInventory,
  analyzeSignals,
  editPlan,
  sourceStatus = 'safe',
  selfReview = [],
  needsUserFacts = [],
  rewriteContext = {}
}) {
  const modePolicy = rewriteContext.modePolicy || getRewriteModePolicy(rewriteContext.rewriteMode || 'balanced');
  const expandedCandidates = expandCandidatesWithSecondPass(
    originalText,
    candidates,
    editPlan,
    analyzeSignals,
    {
      rewriteMode: rewriteContext.rewriteMode,
      originalAnalysis: rewriteContext.originalAnalysis
    }
  );
  const ranked = pickSafeCandidates(originalText, expandedCandidates, factInventory, analyzeSignals, {
    rewriteMode: rewriteContext.rewriteMode,
    modePolicy,
    writingSamples: rewriteContext.voiceProfile?.sample?.cleanedText || rewriteContext.writingSamples,
    voiceProfile: rewriteContext.voiceProfile,
    studentEssayGenre: rewriteContext.studentEssayGenre,
    studentEssayRuleHits: rewriteContext.studentEssayRuleHits,
    originalAiScore: rewriteContext.originalAiScore
  }).ranked;
  const selected = ranked.length ? ranked : [];
  const chosen = selected.filter((item) => isCandidateAcceptable(item, {
    originalText,
    relaxedSafety: true,
    rewriteMode: rewriteContext.rewriteMode,
    modePolicy
  }));
  const finalRanked = chosen.length ? chosen : selected;
  const finalRewrites = finalRanked.length ? finalRanked.map((item) => item.text) : [String(originalText || '').trim()];
  const finalAudit = finalRanked[0]?.audit || auditRewriteFacts(originalText, finalRewrites[0], factInventory, { mode: modePolicy.auditMode });
  const accepted = finalRanked[0] && isCandidateAcceptable(finalRanked[0], {
    originalText,
    relaxedSafety: true,
    rewriteMode: rewriteContext.rewriteMode,
    modePolicy
  });
  const rewriteStatus = accepted ? acceptedStatus(sourceStatus, finalRanked[0], modePolicy) : 'needs_user_facts';
  const auditNeedsUserFacts = modePolicy.factAuditBlocking ? buildNeedsUserFacts(finalAudit, []) : [];
  const visibleNeedsUserFacts = modePolicy.factAuditBlocking
    ? normalizeNeedsUserFacts([...needsUserFacts, ...auditNeedsUserFacts])
    : [];
  return {
    rewriteStatus,
    relaxedSafety: {
      strictPassed: !!finalAudit.strictPassed,
      relaxedPassed: !!finalAudit.relaxedPassed,
      severity: finalAudit.severity || (finalAudit.passed ? 'strict' : 'blocking'),
      warningClaims: finalAudit.warningClaims || [],
      blockingClaims: finalAudit.blockingClaims || []
    },
    appliedEdits: rewritePlanner.normalizeEditPlan(editPlan),
    rewrites: finalRewrites,
    factAudit: finalAudit,
    essayRewriteQuality: finalRanked[0]?.essayQuality || null,
    studentEssayAfterHits: finalRanked[0]?.studentEssayAfterHits || [],
    needsUserFacts: visibleNeedsUserFacts,
    selfReview,
    fallbackReason: rewriteContext.fallbackReason || '',
    fallbackTriggeredBy: rewriteContext.fallbackTriggeredBy || 'none',
    repairAttempted: !!rewriteContext.repairAttempted,
    repairUsed: !!rewriteContext.repairUsed
  };
}

async function executeRewriteWithPlan(originalText, editPlan, factInventory, rewriteContext, callModel, usageTracker, opts = {}) {
  const analyzeSignals = typeof opts.analyzeSignals === 'function' ? opts.analyzeSignals : null;
  const model = opts.model;
  const timeoutMs = opts.timeoutMs;
  const modePolicy = rewriteContext.modePolicy || getRewriteModePolicy(rewriteContext.rewriteMode || 'balanced');
  const promptContext = {
    ...rewriteContext,
    model,
    timeoutMs,
    modePolicy,
    voiceDirectives: rewriteContext.voiceDirectives || buildVoiceDirectives(rewriteContext.voiceProfile || {})
  };

  const initialResult = await callRewriteModel(callModel, {
    model,
    timeoutMs,
    usageTracker,
    maxTokens: opts.maxTokens || 2200,
    systemPrompt: buildRewriteSystemPrompt(modePolicy),
    userPrompt: buildRewriteUserPrompt(originalText, editPlan, factInventory, promptContext)
  });

  const appliedEdits = rewritePlanner.normalizeEditPlan(
    initialResult?.json?.appliedEdits || initialResult?.json?.editPlan,
    editPlan
  );
  const modelRewrites = normalizeCandidateTexts(originalText, initialResult?.json?.rewrites);
  const modelSelfReview = Array.isArray(initialResult?.json?.selfReview) ? initialResult.json.selfReview : [];
  if (initialResult?.rewriteAttemptMeta) {
    modelSelfReview.push({
      issue: 'Model rewrite attempt trace.',
      suggestion: JSON.stringify(initialResult.rewriteAttemptMeta)
    });
  }
  const modelNeedsUserFacts = normalizeNeedsUserFacts(initialResult?.json?.needsUserFacts);
  const initialRanked = pickSafeCandidates(originalText, modelRewrites, factInventory, analyzeSignals, {
    rewriteMode: promptContext.rewriteMode,
    modePolicy,
    writingSamples: promptContext.voiceProfile?.sample?.cleanedText || promptContext.writingSamples,
    voiceProfile: promptContext.voiceProfile,
    studentEssayGenre: promptContext.studentEssayGenre,
    studentEssayRuleHits: promptContext.studentEssayRuleHits,
    originalAiScore: promptContext.originalAiScore
  });

  if (!modePolicy.factAuditBlocking) {
    const usableRanked = initialRanked.acceptableRanked;
    if (usableRanked.length) {
      let candidates = usableRanked.map((item) => item.text);
      let sourceStatus = modePolicy.factAuditEnabled && !usableRanked[0]?.audit?.passed ? 'fact_warning' : 'model_generated';
      let repairAttempted = false;
      let repairUsed = false;
      const shouldTrySoftRepair = modePolicy.factAuditCanRepair
        && modePolicy.factAuditEnabled
        && !usableRanked[0]?.audit?.passed
        && (usableRanked[0]?.audit?.blockingClaims || []).length > 0;
      if (shouldTrySoftRepair) {
        repairAttempted = true;
        try {
          const repaired = await repairRewriteCandidate({
            originalText,
            factInventory,
            editPlan: appliedEdits,
            rewriteContext: promptContext,
            callModel,
            usageTracker,
            unsafeCandidate: usableRanked[0],
            analyzeSignals
          });
          if (repaired.ranked.acceptableRanked?.length) {
            candidates = [
              ...repaired.ranked.acceptableRanked.map((item) => item.text),
              ...candidates
            ];
            sourceStatus = 'balanced_repaired';
            repairUsed = true;
            modelSelfReview.push(...repaired.selfReview);
            modelNeedsUserFacts.push(...repaired.needsUserFacts);
          }
        } catch (error) {
          modelSelfReview.push({
            issue: 'Balanced fact repair failed; original model rewrite kept.',
            suggestion: String(error.message || error).slice(0, 120)
          });
        }
      }
      return buildFinalRewritePackage({
        originalText,
        candidates,
        factInventory,
        analyzeSignals,
        editPlan: appliedEdits,
        sourceStatus,
        selfReview: [
          ...modelSelfReview,
          modePolicy.factAuditEnabled
            ? {
                issue: '平衡模式：事实审计仅作为提醒，不触发保守降级。',
                suggestion: '如有新增事实提醒，请人工确认；模型候选仍会展示。'
              }
            : {
                issue: '强力模式：优先降低 AI 痕迹，不执行事实审计。',
                suggestion: '请自行复核事实是否仍符合原文。'
              }
        ],
        needsUserFacts: modelNeedsUserFacts,
        rewriteContext: {
          ...promptContext,
          repairAttempted,
          repairUsed,
          fallbackTriggeredBy: 'none'
        }
      });
    }
  }

  if (initialRanked.safeRanked.length) {
    let candidates = initialRanked.safeRanked.map((item) => item.text);
    let sourceStatus = 'safe';
    const bestSafe = initialRanked.safeRanked[0];
    try {
      const calibrated = await calibrateVoiceSurface({
        originalText,
        candidate: bestSafe,
        factInventory,
        editPlan: appliedEdits,
        rewriteContext: promptContext,
        callModel,
        usageTracker
      });
      if (calibrated?.rewrites?.length) {
        candidates = [...calibrated.rewrites, ...candidates];
        sourceStatus = 'voice_calibrated';
        modelSelfReview.push(...calibrated.selfReview);
      }
    } catch (error) {
      modelSelfReview.push({
        issue: 'Second-pass voice calibration failed.',
        suggestion: String(error.message || error).slice(0, 120)
      });
    }
    return buildFinalRewritePackage({
      originalText,
      candidates,
      factInventory,
      analyzeSignals,
      editPlan: appliedEdits,
      sourceStatus,
      selfReview: modelSelfReview,
      needsUserFacts: modelNeedsUserFacts,
      rewriteContext: {
        ...promptContext,
        fallbackTriggeredBy: 'none'
      }
    });
  }

  if (initialRanked.relaxedRanked.length) {
    return buildFinalRewritePackage({
      originalText,
      candidates: initialRanked.relaxedRanked.map((item) => item.text),
      factInventory,
      analyzeSignals,
      editPlan: appliedEdits,
      sourceStatus: 'safe',
      selfReview: [
        ...modelSelfReview,
        {
          issue: 'Model rewrite passed relaxed safety only.',
          suggestion: 'Low-risk warning claims are exposed for manual confirmation.'
        }
      ],
      needsUserFacts: modelNeedsUserFacts,
      rewriteContext: {
        ...promptContext,
        fallbackTriggeredBy: 'none'
      }
    });
  }

  if (initialRanked.unsafeRanked.length && modePolicy.factAuditCanRepair) {
    let repairAttempted = false;
    try {
      repairAttempted = true;
      const repaired = await repairRewriteCandidate({
        originalText,
        factInventory,
        editPlan: appliedEdits,
        rewriteContext: promptContext,
        callModel,
        usageTracker,
        unsafeCandidate: initialRanked.unsafeRanked[0],
        analyzeSignals
      });
      if (repaired.ranked.acceptableRanked?.length) {
        return buildFinalRewritePackage({
          originalText,
          candidates: repaired.ranked.acceptableRanked.map((item) => item.text),
          factInventory,
          analyzeSignals,
          editPlan: appliedEdits,
          sourceStatus: 'repaired',
          selfReview: [...modelSelfReview, ...repaired.selfReview],
          needsUserFacts: [...modelNeedsUserFacts, ...repaired.needsUserFacts],
          rewriteContext: {
            ...promptContext,
            repairAttempted,
            repairUsed: true,
            fallbackTriggeredBy: 'none'
          }
        });
      }
      modelNeedsUserFacts.push(...repaired.needsUserFacts);
      modelSelfReview.push(...repaired.selfReview);
    } catch (_) {
      // Fall through to conservative fallback only when the selected mode allows fact-triggered fallback.
    }
  }

  const fallbackRewrite = rewritePlanner.buildConservativeRewrite(originalText, appliedEdits, { rewriteMode: promptContext.rewriteMode });
  const fallbackAudit = auditRewriteFacts(originalText, fallbackRewrite, factInventory, { mode: modePolicy.auditMode });
  const fallbackNeedsUserFacts = modePolicy.factAuditEnabled ? buildNeedsUserFacts(fallbackAudit, []) : [];
  const fallbackTriggeredBy = modePolicy.factAuditCanFallback && initialRanked.unsafeRanked.length ? 'fact_blocking' : 'model_failure';
  const fallbackReason = fallbackTriggeredBy === 'fact_blocking'
    ? '事实审计阻断或修复后仍不安全，保守模式降级。'
    : '模型没有返回可用作文，已降级为保守改写。';

  return buildFinalRewritePackage({
    originalText,
    candidates: [fallbackRewrite],
    factInventory,
    analyzeSignals,
    editPlan: appliedEdits,
    sourceStatus: fallbackAudit.passed ? 'conservative_fallback' : 'needs_user_facts',
    selfReview: [
      ...modelSelfReview,
      { issue: fallbackReason, suggestion: '本版只按编辑计划删水分和压缩套话，不补写新事实。' },
      ...(fallbackAudit.passed || !modePolicy.factAuditEnabled ? [] : [{ issue: 'Fallback rewrite still contains unsupported claims.', suggestion: 'Add factual source material or simplify the source text.' }])
    ],
    needsUserFacts: [...modelNeedsUserFacts, ...fallbackNeedsUserFacts],
    rewriteContext: {
      ...promptContext,
      fallbackReason,
      fallbackTriggeredBy
    }
  });
}

function conservativeFallback(originalText, editPlan, factInventory, options = {}) {
  const modePolicy = options.modePolicy || getRewriteModePolicy(options.rewriteMode || 'balanced');
  const rewritten = rewritePlanner.buildConservativeRewrite(originalText, editPlan, options);
  const factAudit = auditRewriteFacts(originalText, rewritten, factInventory, { mode: modePolicy.auditMode });
  return {
    rewriteStatus: factAudit.passed ? 'safe' : 'conservative_fallback',
    rewrites: [rewritten],
    factAudit,
    needsUserFacts: modePolicy.factAuditEnabled ? buildNeedsUserFacts(factAudit, []) : [],
    rewriteStats: [],
    beforeAfter: null,
    appliedEdits: rewritePlanner.normalizeEditPlan(editPlan),
    fallbackTriggeredBy: 'model_failure',
    fallbackReason: '模型没有返回可用作文，已降级为保守改写。'
  };
}

function rankCandidates(originalText, candidates, factInventory, factAudit, analyzeSignals, options = {}) {
  const rewriteMode = options.rewriteMode || 'balanced';
  const modePolicy = options.modePolicy || getRewriteModePolicy(rewriteMode);
  const studentEssayGenre = options.studentEssayGenre || 'other';
  const beforeRuleHits = options.studentEssayRuleHits || [];
  const originalAiScore = Number(options.originalAiScore || 0);
  const ranked = rewriteRanking.dedupeTexts(candidates)
    .map((text) => {
      const analysis = typeof analyzeSignals === 'function' ? analyzeSignals(text) : null;
      const audit = auditRewriteFacts(originalText, text, factInventory, { mode: modePolicy.auditMode });
      const relaxedSafety = audit.relaxedPassed === undefined ? classifyFactAudit(audit, { mode: modePolicy.auditMode }) : audit;
      const preserve = rewriteRanking.preserveScore(originalText, text);
      const lengthFit = rewriteRanking.lengthFitScore(originalText, text, rewriteMode);
      const paragraphCoverage = rewriteRanking.paragraphCoverageScore(originalText, text);
      const internalLeak = INTERNAL_REWRITE_FIELD_PATTERN.test(String(text || ''));
      const studentEssayAfterHits = studentEssayHumanizer.detectStudentEssayRuleHits(text, studentEssayGenre, {
        rhythm: analysis?.rhythm,
        profile: analysis?.profile,
        informationDensity: analysis?.informationDensity
      });
      const essayQuality = studentEssayHumanizer.scoreStudentEssayCandidate({
        originalText,
        rewrittenText: text,
        genre: studentEssayGenre,
        beforeHits: beforeRuleHits,
        afterHits: studentEssayAfterHits,
        factAudit: audit,
        aiScore: Number(analysis?.probability || 0),
        originalAiScore,
        internalLeak
      });
      const voiceFit = options.voiceProfile
        ? evaluateVoiceFitForCandidate(originalText, text, audit, options)
        : null;
      return {
        text,
        analysis,
        audit,
        relaxedSafety,
        voiceFit,
        internalLeak,
        studentEssayAfterHits,
        essayQuality,
        preserve,
        lengthFit,
        paragraphCoverage,
        score: (
          (modePolicy.factAuditEnabled
            ? modePolicy.factAuditBlocking
              ? (audit.passed ? 400 : relaxedSafety.relaxedPassed ? 220 : 0)
              : (audit.passed ? 80 : relaxedSafety.relaxedPassed ? 45 : 10)
            : 0) +
          (essayQuality.total * 3) +
          (preserve * 2) -
          Number(analysis?.probability || 0) +
          lengthFit.bonus +
          paragraphCoverage.bonus -
          lengthFit.penalty -
          paragraphCoverage.penalty -
          ((relaxedSafety.warningClaims || []).length * (modePolicy.factAuditBlocking ? 40 : 8)) -
          ((relaxedSafety.blockingClaims || []).length * (modePolicy.factAuditBlocking ? 300 : 20)) -
          (voiceFit?.passed ? 20 : 0) -
          (internalLeak ? 800 : 0) -
          ((essayQuality.remainingHighSeverityHits || 0) * 60)
        )
      };
    })
    .sort((a, b) => (b.score - a.score) || (b.preserve - a.preserve));

  if (factAudit?.passed && !ranked.length) {
    return [{
      text: originalText,
      analysis: typeof analyzeSignals === 'function' ? analyzeSignals(originalText) : null,
      audit: factAudit,
      preserve: 100,
      score: 1000
    }];
  }
  return ranked;
}

module.exports = {
  buildExecutorPayload,
  buildFinalRewritePackage,
  conservativeFallback,
  executeRewriteWithPlan,
  rankCandidates
};
