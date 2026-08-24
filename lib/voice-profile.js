const { analyzeRhythm, countCjk, countMatches, splitParagraphs, splitSentences } = require('./text-metrics');

const TRANSITION_WORDS = [
  '后来', '其实', '不过', '但是', '可是', '然后', '于是', '当时', '回头看', '慢慢', '有一次',
  '记得', '从那以后', '现在想来', '说实话', '我觉得', '我想', '所以'
];

const PLAIN_WORDS = ['其实', '不过', '后来', '当时', '我觉得', '我想', '有点', '慢慢', '没那么', '还好'];
const GRAND_WORDS = ['深刻', '重要', '价值', '意义', '时代', '格局', '赋能', '底层逻辑', '闪闪发光', '奔赴远方', '不负韶华'];
const FIRST_PERSON_PATTERN = /我|我们|自己/g;
const GARBLE_PATTERN = /�|锟|Ã|Â|Ð|ð|绛|鈥|聽|囧|\?{2,}/g;

const TONE_PRESETS = {
  冷静判断: { stance: 'direct', emotionalLevel: 'low', sentenceShape: 'mixed', notes: ['判断直接', '少用过度抒情'] },
  现场复盘: { stance: 'observational', emotionalLevel: 'medium', sentenceShape: 'mixed', transitions: ['后来', '当时', '回头看'] },
  亲身吐槽: { stance: 'first_person', emotionalLevel: 'medium', sentenceShape: 'mixed', notes: ['可以保留第一人称', '允许轻微口语'] },
  轻微讽刺: { stance: 'ironic_light', emotionalLevel: 'medium', sentenceShape: 'mixed', notes: ['轻微反讽', '避免刻意尖锐'] },
  克制说明: { stance: 'plain', emotionalLevel: 'low', sentenceShape: 'mixed', notes: ['朴素说明', '少用宏大词'] }
};

function ratioLabel(value, labels) {
  if (value >= 0.5) return labels.high;
  if (value >= 0.22) return labels.medium;
  return labels.low;
}

function unique(items, limit = 8) {
  return Array.from(new Set((items || []).map((item) => String(item || '').trim()).filter(Boolean))).slice(0, limit);
}

function topCounts(items, limit = 6) {
  const counts = new Map();
  for (const item of items || []) {
    const normalized = String(item || '').trim();
    if (!normalized || hasGarbledText(normalized)) continue;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, limit)
    .map(([value]) => value);
}

function htmlDecode(text) {
  return String(text || '')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function garbledRatio(text) {
  const raw = String(text || '');
  const length = Math.max(1, raw.replace(/\s+/g, '').length);
  return Number(((raw.match(GARBLE_PATTERN) || []).length / length).toFixed(4));
}

function hasGarbledText(text) {
  return garbledRatio(text) > 0.03 || /�|锟|鈥|聽/.test(String(text || ''));
}

function sanitizeWritingSample(input = '') {
  const warnings = [];
  const raw = htmlDecode(String(input || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const rawParagraphs = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const kept = [];
  let removedParagraphCount = 0;
  for (const paragraph of rawParagraphs) {
    const compactLength = countCjk(paragraph);
    const paragraphGarble = garbledRatio(paragraph);
    const looksBoilerplate = /作文网专稿|未经允许不得转载|我也要投稿|不够精彩|再来一篇|推荐阅读|上一篇|下一篇|http|www\./i.test(paragraph);
    const looksTitleOnly = compactLength <= 12 && !/[，。！？；]/.test(paragraph);
    if (paragraphGarble > 0.08 || looksBoilerplate || looksTitleOnly || /^\d+$/.test(paragraph)) {
      removedParagraphCount += 1;
      continue;
    }
    kept.push(paragraph);
  }

  const cleanedText = kept.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  const cleanLength = countCjk(cleanedText);
  const ratio = garbledRatio(cleanedText || raw);
  if (removedParagraphCount) warnings.push(`已移除 ${removedParagraphCount} 段疑似噪声或乱码内容。`);
  if (ratio > 0.03) warnings.push('作者样本存在疑似乱码，已降低声音画像置信度。');
  if (cleanLength < 80) warnings.push('清洗后作者样本少于 80 字，不执行风格校准。');

  return {
    cleanedText,
    cleanLength,
    garbledRatio: ratio,
    removedParagraphCount,
    warnings,
    accepted: cleanLength >= 80 && ratio <= 0.12
  };
}

function paragraphOpening(paragraph) {
  const raw = String(paragraph || '').trim();
  if (!raw || hasGarbledText(raw)) return '';
  const matched = TRANSITION_WORDS.find((word) => raw.startsWith(word));
  if (matched) return matched;
  const firstPunctuation = raw.search(/[，。！？；：,.!?;:]/);
  const head = firstPunctuation > 0 ? raw.slice(0, firstPunctuation) : raw.slice(0, 4);
  return countCjk(head) <= 4 ? head : raw.slice(0, 2);
}

function punctuationHabits(text) {
  const raw = String(text || '');
  const marks = ['，', '。', '；', '、', '！', '？', '：', '“', '”', ',', '.', ';', '!', '?'];
  return marks
    .map((mark) => ({ mark, count: countMatches(raw, new RegExp(mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((item) => item.mark);
}

function sentenceShapeFromRhythm(rhythm) {
  const average = Number(rhythm.averageSentenceLength || 0);
  const burstiness = Number(rhythm.burstinessScore || 0);
  if (average <= 14 && burstiness < 0.35) return '偏短句';
  if (average >= 28 && burstiness < 0.35) return '偏长句';
  if (burstiness >= 0.45) return '长短交替';
  return '中等句长';
}

function buildDictionNotes(text, sentences) {
  const raw = String(text || '');
  const notes = [];
  const plainHits = PLAIN_WORDS.reduce((sum, word) => sum + countMatches(raw, new RegExp(word, 'g')), 0);
  const grandHits = GRAND_WORDS.reduce((sum, word) => sum + countMatches(raw, new RegExp(word, 'g')), 0);
  const firstPersonHits = countMatches(raw, FIRST_PERSON_PATTERN);
  const firstPersonRatio = sentences.length ? firstPersonHits / sentences.length : 0;

  notes.push(ratioLabel(firstPersonRatio, {
    high: '第一人称明显',
    medium: '有一定第一人称',
    low: '第一人称较少'
  }));
  if (plainHits >= Math.max(2, grandHits)) notes.push('偏朴素');
  if (grandHits >= 3 && grandHits > plainHits) notes.push('宏大词偏多');
  if (countMatches(raw, /我觉得|我想|其实|不过/g) >= 2) notes.push('有直接判断');
  if (countMatches(raw, /。/g) >= countMatches(raw, /；/g) * 3) notes.push('少用分号');
  return unique(notes, 6);
}

function confidenceFor(sampleLength, sentenceCount, sampleGarbledRatio, accepted = true) {
  if (!accepted || sampleGarbledRatio > 0.12) return 'none';
  if (sampleLength >= 500 && sentenceCount >= 16 && sampleGarbledRatio <= 0.03) return 'high';
  if (sampleLength >= 220 && sentenceCount >= 8) return 'medium';
  if (sampleLength >= 80 && sentenceCount >= 3) return 'low';
  return 'none';
}

function sampleLimitNote(confidence) {
  if (confidence === 'none') return '未提供足够或可信的作者样本，不做风格校准。';
  if (confidence === 'low') return '样本较短，只做轻量风格校准。';
  if (confidence === 'medium') return '样本长度适中，可参考表层表达习惯。';
  return '样本较充分，可较稳定参考句长、开头、标点和转场。';
}

function openingStyle(openings) {
  if (!openings.length) return '无稳定段首习惯';
  if (openings.includes('我') || openings.some((item) => /^我/.test(item))) return '偏第一人称自然起笔';
  if (openings.some((item) => TRANSITION_WORDS.includes(item))) return '常用转场或时间词起笔';
  return '段首较朴素，少用统一套话';
}

function endingStyle(paragraphs) {
  const ending = paragraphs[paragraphs.length - 1] || '';
  if (!ending) return '';
  if (/今后|未来|不负韶华|奔赴|闪闪发光|成为更好的自己/.test(ending)) return '结尾有表态或升华倾向';
  if (countCjk(ending) <= 80) return '结尾偏短，自然收住';
  return '结尾偏展开';
}

function dictionLevel(notes) {
  if (notes.includes('宏大词偏多')) return '偏书面或抽象';
  if (notes.includes('偏朴素')) return '偏朴素';
  return '中性';
}

function buildVoiceProfile(writingSamples = '', tone = '') {
  const sanitized = sanitizeWritingSample(writingSamples);
  const sample = sanitized.cleanedText.slice(0, 2000);
  const tonePreset = TONE_PRESETS[String(tone || '').trim()] || null;
  if (!sanitized.accepted) {
    const confidence = 'none';
    return {
      hasSamples: false,
      accepted: false,
      cleanLength: sanitized.cleanLength,
      sampleLength: sanitized.cleanLength,
      sentenceCount: 0,
      warnings: sanitized.warnings,
      sample: sanitized,
      surface: {},
      expressionDNA: {},
      preference: { tonePreset },
      antiPatterns: ['不要把朴素词升级成更正确的词'],
      boundaries: {
        confidence,
        sampleLimitNote: sampleLimitNote(confidence),
        sampleLimitNoteText: sampleLimitNote(confidence),
        warnings: sanitized.warnings
      },
      boundary: {
        confidence,
        sampleLimitNote: sampleLimitNote(confidence),
        bannedUpgradePatterns: ['不要把朴素词升级成更正确的词']
      }
    };
  }

  const paragraphs = splitParagraphs(sample);
  const sentences = splitSentences(sample);
  const rhythm = analyzeRhythm(sample);
  const sampleLength = countCjk(sample);
  const openings = topCounts(paragraphs.map(paragraphOpening), 6);
  const transitionHabits = TRANSITION_WORDS.filter((word) => sample.includes(word)).slice(0, 8);
  const dictionNotes = buildDictionNotes(sample, sentences);
  const confidence = confidenceFor(sampleLength, sentences.length, sanitized.garbledRatio, sanitized.accepted);
  const antiPatterns = [
    '不要把朴素词升级成更正确的词',
    '不要把结尾改成通用口号',
    '不要为了像作者而新增人物、地点、动作、物品、数量、心理或感官细节'
  ];

  return {
    hasSamples: confidence !== 'none',
    accepted: confidence !== 'none',
    cleanLength: sampleLength,
    sampleLength,
    sentenceCount: sentences.length,
    warnings: sanitized.warnings,
    sample: { ...sanitized, cleanedText: sample },
    surface: {
      averageSentenceLength: rhythm.averageSentenceLength,
      sentenceStdDev: rhythm.sentenceStdDev,
      burstinessScore: rhythm.burstinessScore,
      sentenceShape: sentenceShapeFromRhythm(rhythm),
      paragraphOpeningPatterns: openings,
      punctuationHabits: punctuationHabits(sample),
      transitionHabits,
      firstPersonRatio: sentences.length ? Number((countMatches(sample, FIRST_PERSON_PATTERN) / sentences.length).toFixed(2)) : 0
    },
    expressionDNA: {
      openingStyle: openingStyle(openings),
      endingStyle: endingStyle(paragraphs),
      dictionLevel: dictionLevel(dictionNotes),
      certaintyStyle: dictionNotes.includes('有直接判断') ? '判断直接' : '判断较克制',
      reflectionStyle: /我明白|我懂得|我觉得|我想|其实/.test(sample) ? '有自我判断' : '较少直接反思',
      paragraphRhythm: paragraphs.length >= 4 ? '多段推进' : '段落较少'
    },
    preference: {
      dictionNotes,
      stanceNotes: dictionNotes.filter((note) => /第一人称|判断/.test(note)),
      endingStyle: endingStyle(paragraphs),
      tonePreset
    },
    antiPatterns,
    boundaries: {
      confidence,
      sampleLimitNote: sampleLimitNote(confidence),
      warnings: sanitized.warnings,
      sampleLimitNoteText: sampleLimitNote(confidence)
    },
    boundary: {
      confidence,
      sampleLimitNote: sampleLimitNote(confidence),
      bannedUpgradePatterns: antiPatterns
    }
  };
}

function buildVoiceDirectives(voiceProfile = {}) {
  const confidence = voiceProfile.boundaries?.confidence || voiceProfile.boundary?.confidence || 'none';
  if (confidence === 'none' || !voiceProfile.hasSamples) {
    const tonePreset = voiceProfile.preference?.tonePreset;
    return [
      '作者样本不足或不可信，不执行风格校准。',
      ...(tonePreset?.notes || []).map((note) => `仅保留语气预设：${note}`)
    ];
  }

  const surface = voiceProfile.surface || {};
  const dna = voiceProfile.expressionDNA || {};
  const directives = [
    `按样本句式保持“${surface.sentenceShape || '自然长短'}”，不要全改成短句。`,
    `句长均值参考约 ${surface.averageSentenceLength || 0} 字，允许自然波动，不机械贴近。`,
    `段落开头参考：${(surface.paragraphOpeningPatterns || []).slice(0, 4).join('、') || dna.openingStyle || '自然起笔'}；不要统一用“生活中”。`,
    `转场习惯参考：${(surface.transitionHabits || []).slice(0, 5).join('、') || '少量自然转场'}。`,
    `标点习惯参考：${(surface.punctuationHabits || []).slice(0, 5).join('、') || '中文常规标点'}。`,
    `表达 DNA：${[dna.openingStyle, dna.dictionLevel, dna.certaintyStyle, dna.reflectionStyle].filter(Boolean).join('；') || '朴素表达'}。`,
    '结尾自然收住，不写口号式金句。'
  ];
  if (confidence === 'low') directives.unshift('样本置信度低，只做轻量校准，事实安全优先。');
  return unique(directives, 10);
}

function buildVoiceCalibrationNotes(voiceProfile = {}) {
  const confidence = voiceProfile.boundaries?.confidence || voiceProfile.boundary?.confidence || 'none';
  if (!voiceProfile.hasSamples) return ['风格校准未执行：作者样本不足或不可信。'];
  const notes = ['已清洗作者样本并建立声音画像', '已参考作者样本的句长变化', '已参考段落开头方式', '已参考用词和标点习惯'];
  const transitions = voiceProfile.surface?.transitionHabits || [];
  if (transitions.length) notes.splice(4, 0, `已参考转场习惯：${transitions.slice(0, 4).join('、')}`);
  if (voiceProfile.boundaries?.sampleLimitNoteText || voiceProfile.boundary?.sampleLimitNote) {
    notes.push(voiceProfile.boundaries?.sampleLimitNoteText || voiceProfile.boundary.sampleLimitNote);
  }
  notes.push(`声音画像置信度：${confidence}`);
  return notes;
}

module.exports = {
  buildVoiceCalibrationNotes,
  buildVoiceDirectives,
  buildVoiceProfile,
  confidenceFor,
  garbledRatio,
  hasGarbledText,
  sanitizeWritingSample,
  TONE_PRESETS,
  TRANSITION_WORDS
};
