const fs = require('fs');
const path = require('path');
const {
  analyzeRhythm,
  countCjk,
  countMatches,
  escapeRegex,
  findSegmentForPhrase,
  splitParagraphs,
  splitSentences
} = require('./text-metrics');

const MODULE_DIR = typeof __dirname === 'string' ? __dirname : './lib';
const ADAPTED_DIR = path.join(MODULE_DIR, '..', 'vendor', 'humanizer-tools', 'adapted');
const CORE_FILES = {
  corePrompt: 'STUDENT-ESSAY-HUMANIZER.md',
  rules: 'student-essay-rules.json',
  rubric: 'scoring-rubric.json',
  workflow: 'workflow.md',
  sourceMap: 'source-map.json'
};

let cachedCore = null;

function readText(fileName) {
  try {
    return fs.readFileSync(path.join(ADAPTED_DIR, fileName), 'utf8').replace(/^\uFEFF/, '');
  } catch (_) {
    return '';
  }
}

function readJson(fileName, fallback) {
  try {
    return JSON.parse(readText(fileName));
  } catch (_) {
    return fallback;
  }
}

function loadStudentEssayHumanizerCore() {
  if (cachedCore) return cachedCore;
  const rules = readJson(CORE_FILES.rules, { version: 0, maxPromptRules: 8, rules: [] });
  const rubric = readJson(CORE_FILES.rubric, { version: 0, genreLengthRatios: {} });
  const sourceMap = readJson(CORE_FILES.sourceMap, { version: 0 });
  cachedCore = {
    corePrompt: readText(CORE_FILES.corePrompt),
    rules,
    rubric,
    workflow: readText(CORE_FILES.workflow),
    sourceMap,
    workflowVersion: `workflow:${rules.version || 0}:${rubric.version || 0}`,
    sourceMapVersion: sourceMap.version || 0
  };
  return cachedCore;
}

function normalizeGenre(value) {
  const raw = String(value || '').trim();
  if (/记叙|日记|叙事/.test(raw)) return 'narrative';
  if (/写景|状物|景物|散文/.test(raw)) return 'scenery';
  if (/读后感|感悟|随笔|成长|反思/.test(raw)) return 'reflection';
  if (/议论|主题|论说|说明/.test(raw)) return 'argument';
  return 'other';
}

function inferStudentEssayGenre(text, diagnostics = [], analysis = {}) {
  const profileGenre = analysis?.profile?.genreGuess || analysis?.genreGuess || '';
  const normalized = normalizeGenre(profileGenre);
  if (normalized !== 'other') return normalized;
  const raw = String(text || '');
  const diagnosticText = (diagnostics || []).map((item) => `${item.category || ''}${item.reason || ''}`).join(' ');
  if (/读完|这本书|这篇文章|感悟|启发/.test(raw)) return 'reflection';
  if (/首先|其次|论点|观点|由此可见|综上所述|应该|必须/.test(raw)) return 'argument';
  if (/春天|夏天|秋天|冬天|景色|校园|家乡|花|树|河|风|雨/.test(raw) && !/发生|后来|当时|对我说/.test(raw)) return 'scenery';
  if (/我|我们|那天|后来|放学|回家|遇到|看见|发生|老师|妈妈|同学/.test(raw)) return 'narrative';
  if (/句长|节奏|结尾/.test(diagnosticText)) return 'reflection';
  return 'other';
}

function patternToRegex(pattern) {
  const value = String(pattern || '').trim();
  if (!value) return null;
  if (/^[a-z_]+$/.test(value)) return null;
  const source = escapeRegex(value).replace(/\\\.\\\*/g, '[\\s\\S]{0,40}');
  try {
    return new RegExp(source, 'i');
  } catch (_) {
    return null;
  }
}

function findRegexSegment(text, regex) {
  if (!regex) return '';
  const sentences = splitSentences(text);
  const sentence = sentences.find((item) => regex.test(item));
  if (sentence) return sentence;
  const match = String(text || '').match(regex);
  return match ? findSegmentForPhrase(text, match[0]) || match[0] : '';
}

function syntheticPatternHit(text, pattern, metrics = {}) {
  const rhythm = metrics.rhythm || analyzeRhythm(text);
  if (pattern === 'sentence_length_variance_low') {
    return rhythm.burstinessScore > 0 && rhythm.burstinessScore < 0.32 && splitSentences(text).length >= 5
      ? splitSentences(text).slice(0, 3).join('')
      : '';
  }
  if (pattern === 'em_dash_density_high') {
    const dashCount = countMatches(text, /——|--/g);
    return dashCount >= 2 ? findSegmentForPhrase(text, '——') || '多处破折号解释' : '';
  }
  return '';
}

function ruleAppliesToGenre(rule, genre) {
  const genres = Array.isArray(rule.genres) ? rule.genres : [];
  return !genres.length || genres.includes('all') || genres.includes(genre);
}

function severityRank(value) {
  return { high: 3, medium: 2, low: 1 }[value] || 0;
}

function detectStudentEssayRuleHits(text, genre = 'other', metrics = {}) {
  const core = loadStudentEssayHumanizerCore();
  const paragraphs = splitParagraphs(text);
  const hits = [];
  for (const rule of core.rules.rules || []) {
    if (!ruleAppliesToGenre(rule, genre)) continue;
    for (const pattern of rule.patterns || []) {
      const syntheticSegment = syntheticPatternHit(text, pattern, metrics);
      const regex = patternToRegex(pattern);
      const literalExcerpt = String(text || '').includes(String(pattern || ''))
        ? findSegmentForPhrase(text, pattern)
        : '';
      const excerpt = syntheticSegment || findRegexSegment(text, regex) || literalExcerpt;
      if (!excerpt) continue;
      const paragraphIndex = Math.max(0, paragraphs.findIndex((paragraph) => paragraph.includes(excerpt) || excerpt.includes(paragraph.slice(0, 20))));
      hits.push({
        id: rule.id,
        severity: rule.severity || 'medium',
        category: rule.category || 'student_essay_pattern',
        paragraphIndex,
        excerpt: String(excerpt).trim().slice(0, 180),
        action: rule.action || '保留事实，只做必要的学生作文表达调整。',
        doNotEditWhen: rule.doNotEditWhen || '',
        protectedReason: null
      });
      break;
    }
  }

  const max = Number(core.rules.maxPromptRules || 8);
  const seen = new Set();
  const categoryCounts = new Map();
  return hits
    .filter((hit) => {
      const key = `${hit.id}:${hit.excerpt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      const count = categoryCounts.get(hit.category) || 0;
      if (count >= 2) return false;
      categoryCounts.set(hit.category, count + 1);
      return true;
    })
    .sort((a, b) => (severityRank(b.severity) - severityRank(a.severity)) || (a.paragraphIndex - b.paragraphIndex))
    .slice(0, max);
}

function collectProtectedSpans(factInventory = {}) {
  const anchors = factInventory.anchors || {};
  return [
    ...(anchors.timeExpressions || []),
    ...(anchors.persons || []),
    ...(anchors.places || []),
    ...(anchors.actions || []),
    ...(anchors.objects || []),
    ...(anchors.quantities || []),
    ...(factInventory.quotedItems || [])
  ].map((item) => String(item || '').trim()).filter((item) => countCjk(item) >= 2).slice(0, 80);
}

function filterStudentEssayActions({ ruleHits = [], genre = 'other', factInventory = {}, protectedSpans = [] } = {}) {
  const spans = protectedSpans.length ? protectedSpans : collectProtectedSpans(factInventory);
  const actions = [];
  const forbiddenActions = [];
  for (const hit of ruleHits || []) {
    const matchedProtected = spans.find((span) => hit.excerpt && hit.excerpt.includes(span));
    const item = {
      ...hit,
      genre,
      protectedReason: matchedProtected ? `片段含受保护事实：${matchedProtected}` : null
    };
    if (matchedProtected && severityRank(hit.severity) <= 1) {
      forbiddenActions.push(item);
      continue;
    }
    actions.push(item);
  }
  return {
    genre,
    actions: actions.slice(0, 8),
    protectedSpans: spans.slice(0, 30),
    forbiddenActions: forbiddenActions.slice(0, 8)
  };
}

function buildStudentEssayPromptContext({ originalText, genre, ruleHits = [], editPlan = [], factInventory = {}, voiceProfile = {}, studentActions = null } = {}) {
  const core = loadStudentEssayHumanizerCore();
  const normalizedGenre = genre || inferStudentEssayGenre(originalText);
  const lengthRatio = core.rubric.genreLengthRatios?.[normalizedGenre] || core.rubric.genreLengthRatios?.other || { min: 0.6, max: 0.9 };
  const filtered = studentActions || filterStudentEssayActions({
    ruleHits,
    genre: normalizedGenre,
    factInventory
  });
  return {
    corePrompt: core.corePrompt,
    workflowVersion: core.workflowVersion,
    sourceMapVersion: core.sourceMapVersion,
    genre: normalizedGenre,
    lengthRatio,
    ruleHits: (ruleHits || []).slice(0, 8),
    actions: filtered.actions || [],
    protectedSpans: filtered.protectedSpans || [],
    forbiddenActions: filtered.forbiddenActions || [],
    editPlanSummary: (editPlan || []).slice(0, 10).map((item) => ({
      action: item.action,
      problemType: item.problemType,
      segment: item.segment,
      target: item.target
    })),
    voiceCalibrationUsed: !!voiceProfile?.hasSamples
  };
}

function scoreStudentEssayCandidate({ originalText, rewrittenText, genre = 'other', beforeHits = [], afterHits = [], factAudit = {}, aiScore = 0, originalAiScore = 0, internalLeak = false } = {}) {
  const core = loadStudentEssayHumanizerCore();
  const originalLength = countCjk(originalText);
  const rewrittenLength = countCjk(rewrittenText);
  const lengthRatio = originalLength ? rewrittenLength / originalLength : 1;
  const lengthPolicy = core.rubric.genreLengthRatios?.[genre] || core.rubric.genreLengthRatios?.other || { min: 0.6, max: 0.9 };
  const blockingClaims = factAudit.blockingClaims || [];
  const warningClaims = factAudit.warningClaims || [];
  const highBefore = (beforeHits || []).filter((item) => item.severity === 'high').length;
  const highAfter = (afterHits || []).filter((item) => item.severity === 'high').length;
  const hitDrop = Math.max(0, (beforeHits || []).length - (afterHits || []).length);
  const aiDrop = Math.max(0, Number(originalAiScore || 0) - Number(aiScore || 0));
  const paragraphsOriginal = splitParagraphs(originalText).length;
  const paragraphsRewritten = splitParagraphs(rewrittenText).length;
  const rhythm = analyzeRhythm(rewrittenText);

  const factSafety = blockingClaims.length || internalLeak
    ? 0
    : factAudit.passed ? 35 : Math.max(20, 30 - warningClaims.length * 4);
  const essayIntegrity = Math.max(0, Math.min(25,
    25
    - (lengthRatio < lengthPolicy.min ? Math.round((lengthPolicy.min - lengthRatio) * 80) : 0)
    - (paragraphsRewritten < Math.max(1, paragraphsOriginal - 1) ? 5 : 0)
    - (lengthRatio > lengthPolicy.max + 0.08 ? 4 : 0)
  ));
  const aiPatternReduction = Math.max(0, Math.min(20, Math.round(aiDrop * 0.45) + hitDrop * 3 - highAfter * 3));
  const studentNaturalness = /直播|职场|商业|流量|爆款|破防|绝绝子|yyds/i.test(rewrittenText) ? 2 : 12;
  const rhythmAndEnding = Math.max(0, Math.min(8,
    8
    - (rhythm.burstinessScore > 0 && rhythm.burstinessScore < 0.24 ? 3 : 0)
    - (/未来可期|奔赴远方|勇敢前行|成长的力量|绽放.*光芒/.test(splitSentences(rewrittenText).slice(-1)[0] || '') ? 4 : 0)
  ));
  const total = Math.round(factSafety + essayIntegrity + aiPatternReduction + studentNaturalness + rhythmAndEnding);
  const factSafetyLevel = blockingClaims.length || internalLeak
    ? 'blocking'
    : factAudit.passed ? 'strict_safe' : factAudit.relaxedPassed ? 'relaxed_safe' : 'blocking';

  return {
    total,
    factSafetyLevel,
    lengthRatio: Number(lengthRatio.toFixed(2)),
    genre,
    dimensions: {
      factSafety,
      essayIntegrity,
      aiPatternReduction,
      studentNaturalness,
      rhythmAndEnding
    },
    beforeHitCount: (beforeHits || []).length,
    afterHitCount: (afterHits || []).length,
    remainingHighSeverityHits: highAfter,
    warnings: [
      lengthRatio < lengthPolicy.min ? 'length_below_genre_minimum' : '',
      highAfter ? 'remaining_high_severity_rule_hit' : '',
      warningClaims.length ? 'relaxed_fact_warning' : ''
    ].filter(Boolean)
  };
}

module.exports = {
  loadStudentEssayHumanizerCore,
  inferStudentEssayGenre,
  detectStudentEssayRuleHits,
  filterStudentEssayActions,
  buildStudentEssayPromptContext,
  scoreStudentEssayCandidate
};
