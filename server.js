const path = require('path');
const fs = require('fs');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const express = require('express');
const dns = require('dns').promises;
const https = require('https');
const { execSync } = require('child_process');
const { AsyncLocalStorage } = require('async_hooks');
const textMetrics = require('./lib/text-metrics');
const signalScoring = require('./lib/signal-scoring');
const diagnosticsEngine = require('./lib/diagnostics');
const rewritePlanner = require('./lib/rewrite-planner');
const rewriteRanking = require('./lib/rewrite-ranking');
const rewriteExecutor = require('./lib/rewrite-executor');
const { buildFactInventory } = require('./lib/fact-inventory');
const { auditRewriteFacts, buildNeedsUserFacts } = require('./lib/fact-auditor');
const { buildDisabledFactInventory, getRewriteModePolicy } = require('./lib/rewrite-mode-policy');
const rewritePolicy = require('./lib/rewrite-policy');
const { buildVoiceCalibrationNotes, buildVoiceDirectives, buildVoiceProfile } = require('./lib/voice-profile');
const { compareVoiceFit } = require('./lib/voice-fit');
const studentEssayHumanizer = require('./lib/student-essay-humanizer');
const essayGuidance = require('./lib/essay-guidance');
const trainingCamps = require('./lib/training-camps');
const longTermAbility = require('./lib/long-term-ability');
const BASE_DIR = typeof __dirname === 'string' ? __dirname : '.';

function loadEnvFile() {
  const envPath = path.join(BASE_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function detectWindowsProxy() {
  try {
    const out = execSync('netsh winhttp show proxy', { encoding: 'utf8' });
    const match = out.match(/Proxy Server\(s\)\s*:\s*(.+)/i);
    if (match && match[1] && !/Direct access/i.test(match[1])) return match[1].trim();
  } catch (_) {}
  return '';
}

loadEnvFile();

const app = express();
const PORT = process.env.PORT || 3000;
const IS_CLOUDFLARE_WORKER = process.env.CLOUDFLARE_WORKER === 'true';
const IS_PRODUCTION = IS_CLOUDFLARE_WORKER || process.env.NODE_ENV === 'production';
const COOKIE_SECURE = IS_PRODUCTION || process.env.COOKIE_SECURE === 'true';

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (IS_PRODUCTION) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '400kb' }));
app.use(express.static(path.join(BASE_DIR, 'public')));

const MAX_CHARS = 5000;
const DETECT_TIMEOUT_MS = 20000;
const REWRITE_TIMEOUT_MS = 120000;
const RETRY_COUNT = 2;
const RETRY_DELAY_MS = 600;
const VERIFY_CODE_TTL_MINUTES = 3;
const VERIFY_CODE_TTL_MS = VERIFY_CODE_TTL_MINUTES * 60 * 1000;
const VERIFY_CODE_COOLDOWN_MS = 60 * 1000;
const VERIFY_CODE_HOURLY_LIMIT = 5;
const VERIFY_CODE_MAX_ATTEMPTS = 5;
const AUTH_RATE_LIMITS = Object.freeze({
  sendIp: { limit: 10, windowMs: 60 * 60 * 1000 },
  sendTarget: { limit: 5, windowMs: 60 * 60 * 1000 },
  sendDomain: { limit: 30, windowMs: 60 * 60 * 1000 },
  sendGlobal: { limit: 100, windowMs: 60 * 60 * 1000 },
  verifyIp: { limit: 30, windowMs: 10 * 60 * 1000 },
  verifyTarget: { limit: 20, windowMs: 10 * 60 * 1000 },
  signupIp: { limit: 3, windowMs: 24 * 60 * 60 * 1000 },
  signupDomain: { limit: 5, windowMs: 24 * 60 * 60 * 1000 },
  signupGlobal: { limit: 50, windowMs: 24 * 60 * 60 * 1000 }
});
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const GUEST_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const GUEST_FREE_TRIAL_LIMIT = 100;
const GUEST_REWRITE_WINDOW_MS = 15 * 60 * 1000;
const GUEST_IP_USAGE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const REWRITE_TASK_TTL_MS = 72 * 60 * 60 * 1000;
const REWRITE_TASK_INTERRUPTED_AFTER_MS = 2 * 60 * 1000;
const REWRITE_TASK_MAX_PER_OWNER = 10;
const REWRITE_TRIGGER_THRESHOLD = 30;
const CONFIGURED_APP_SECRET = String(process.env.APP_SECRET || '').trim();
if (IS_PRODUCTION && CONFIGURED_APP_SECRET.length < 32) {
  throw new Error('APP_SECRET must contain at least 32 characters in production');
}
const APP_SECRET = CONFIGURED_APP_SECRET || crypto.randomBytes(32).toString('hex');
if (!CONFIGURED_APP_SECRET) {
  console.warn('[security-warning] APP_SECRET is not configured; using an ephemeral development secret');
}
const DATA_DIR = process.env.APP_DATA_DIR ? path.resolve(process.env.APP_DATA_DIR) : path.join(BASE_DIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'app-state.json');

const API_BASE_URL = process.env.AI_API_BASE_URL || ''; // set in .env
const API_KEY = process.env.AI_API_KEY || '';
const DETECT_MODEL = process.env.AI_DETECT_MODEL || ''; // set in .env
const REWRITE_MODEL = process.env.AI_REWRITE_MODEL || ''; // set in .env
const ESSAY_GUIDANCE_MODEL = process.env.AI_GUIDANCE_MODEL || REWRITE_MODEL;

const ENV_PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
const WIN_PROXY = IS_CLOUDFLARE_WORKER ? '' : detectWindowsProxy();

const KNOWLEDGE_BASE_FILES = {
  clichePhrases: path.join(BASE_DIR, 'knowledge-base/ai-signals/cliche-phrases.json'),
  transitions: path.join(BASE_DIR, 'knowledge-base/ai-signals/transitions.json'),
  emotionalWords: path.join(BASE_DIR, 'knowledge-base/ai-signals/emotional-words.json'),
  suspiciousSentences: path.join(BASE_DIR, 'knowledge-base/ai-signals/suspicious-sentences.json'),
  overreachPatterns: path.join(BASE_DIR, 'knowledge-base/ai-signals/overreach-patterns.json')
};
const TRAINING_LOG_PATH = path.join(BASE_DIR, 'knowledge-base/training-log.jsonl');

const DEFAULT_ADMIN_EMAIL = '18008069236@163.com';
const ADMIN_EMAILS = Array.from(new Set(
  [DEFAULT_ADMIN_EMAIL, ...(process.env.ADMIN_EMAILS || '').split(',')]
    .map((item) => normalizeEmail(item))
    .filter(Boolean)
));

const PAYMENT_CONFIG = {
  method: 'wechat_personal_business',
  qrSrc: process.env.WECHAT_PAY_QR_SRC || '/assets/wechat-merchant-qr.jpg',
  payeeName: process.env.WECHAT_PAY_PAYEE || '微信个人经营收款码',
  adminContact: '网易邮箱：18008069236@163.com\nQQ邮箱：3955307559',
  remarkHint: '转账备注请填写登录邮箱，管理员按 1 元 = 2000 算力核对后人工增加算力。'
};

const HARDCODED_DIRECT_HINT_PATTERNS = [
  'AI\\s*生成',
  '由\\s*AI\\s*生成',
  'AI\\s*辅助完成',
  'AI\\s*辅助创作',
  '豆包\\s*AI\\s*生成',
  'ChatGPT\\s*生成',
  'DeepSeek\\s*生成',
  '此文本可能由\\s*AI\\s*辅助完成'
];
const ANTI_AI_REASON_REGEX = /真实且具体|自然收束|没有刻意|没有过密|没有机械|生活化|更像真人|不像AI|非模板|不显得模板|细节丰富|具体场景|个人温度/;

const DEFAULT_STATE = {
  users: [],
  verificationCodes: [],
  sessions: [],
  guestUsages: [],
  guestIpUsages: [],
  powerLedger: [],
  rechargeOrders: [],
  rewriteTasks: [],
  authRateLimits: [],
  essaySessions: [],
  essayDiagnostics: [],
  essayMaterials: [],
  essayReflections: [],
  essayGuides: [],
  styleProfiles: [],
  abilityProfiles: [],
  trainingPlans: [],
  trainingTaskSubmissions: [],
  errorNotebookItems: []
};
const STATE_COLLECTIONS = Object.keys(DEFAULT_STATE);

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function normalizeStateShape(parsed = {}) {
  const next = cloneDefaultState();
  for (const key of STATE_COLLECTIONS) {
    next[key] = Array.isArray(parsed[key]) ? parsed[key] : [];
  }
  return next;
}

function ensureDir(target) {
  if (IS_CLOUDFLARE_WORKER) return;
  fs.mkdirSync(target, { recursive: true });
}

function loadState() {
  if (IS_CLOUDFLARE_WORKER) return cloneDefaultState();
  ensureDir(DATA_DIR);
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, `${JSON.stringify(DEFAULT_STATE, null, 2)}\n`, 'utf8');
    return cloneDefaultState();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8').replace(/^\uFEFF/, ''));
    return normalizeStateShape(parsed);
  } catch (_) {
    return cloneDefaultState();
  }
}

let processState = loadState();
const requestStateStorage = new AsyncLocalStorage();
const state = new Proxy({}, {
  get(_, property) {
    return (requestStateStorage.getStore()?.state || processState)[property];
  },
  set(_, property, value) {
    const context = requestStateStorage.getStore();
    if (context) context.state[property] = value;
    else processState[property] = value;
    return true;
  },
  ownKeys() {
    return Reflect.ownKeys(requestStateStorage.getStore()?.state || processState);
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  }
});
let cloudStateIoEnabled = false;
let cloudStateSchemaReady = false;
let cloudStateSavePromise = Promise.resolve();

function saveState() {
  if (IS_CLOUDFLARE_WORKER) {
    const context = requestStateStorage.getStore();
    if (!context) throw new Error('Cloud state mutation attempted outside a request context');
    context.dirty = true;
    return;
  }
  ensureDir(DATA_DIR);
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(processState, null, 2)}\n`, 'utf8');
}

function getCloudStateDb() {
  return globalThis.CLOUDFLARE_ENV?.APP_STATE_DB || null;
}

function stateRecordId(collection, item, index) {
  return String(
    item?.id ||
    item?.guestId ||
    item?.ipHash ||
    item?.requestId ||
    item?.target && `${item.channel || 'code'}:${item.target}:${item.createdAt || index}` ||
    `${collection}:${index}`
  );
}

async function ensureCloudStateSchema(db) {
  if (!IS_CLOUDFLARE_WORKER || !db || cloudStateSchemaReady) return;
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS app_state_records (collection TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (collection, id))'
  ).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_app_state_records_collection ON app_state_records (collection)').run();
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS security_rate_limits (id TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)'
  ).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_security_rate_limits_expires_at ON security_rate_limits (expires_at)').run();
  cloudStateSchemaReady = true;
}

async function loadCloudState() {
  const db = getCloudStateDb();
  if (!db) return cloneDefaultState();
  await ensureCloudStateSchema(db);
  const rows = await db.prepare('SELECT collection, payload FROM app_state_records').all();
  const next = cloneDefaultState();
  for (const row of rows.results || []) {
    if (!STATE_COLLECTIONS.includes(row.collection)) continue;
    try {
      const item = JSON.parse(row.payload);
      next[row.collection].push(item);
    } catch (_) {}
  }
  return normalizeStateShape(next);
}

function buildStateRecordMap(collection, items) {
  const records = new Map();
  for (const [index, item] of (items || []).entries()) {
    records.set(stateRecordId(collection, item, index), item);
  }
  return records;
}

function cloudUpsertStatement(db, collection, id, item, baseItem, updatedAt) {
  const payload = JSON.stringify(item);
  if (collection === 'users' && baseItem) {
    const balanceDelta = Number(item.powerBalance || 0) - Number(baseItem.powerBalance || 0);
    return db.prepare(
      `INSERT INTO app_state_records (collection, id, payload, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(collection, id) DO UPDATE SET
         payload = json_set(excluded.payload, '$.powerBalance', COALESCE(CAST(json_extract(app_state_records.payload, '$.powerBalance') AS REAL), 0) + ?),
         updated_at = excluded.updated_at`
    ).bind(collection, id, payload, updatedAt, balanceDelta);
  }
  if (collection === 'verificationCodes' && baseItem) {
    const attemptDelta = Math.max(0, Number(item.attemptCount || 0) - Number(baseItem.attemptCount || 0));
    return db.prepare(
      `INSERT INTO app_state_records (collection, id, payload, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(collection, id) DO UPDATE SET
         payload = json_set(
           excluded.payload,
           '$.attemptCount', COALESCE(CAST(json_extract(app_state_records.payload, '$.attemptCount') AS INTEGER), 0) + ?,
           '$.consumedAt', CASE
             WHEN COALESCE(json_extract(excluded.payload, '$.consumedAt'), '') <> '' THEN json_extract(excluded.payload, '$.consumedAt')
             ELSE COALESCE(json_extract(app_state_records.payload, '$.consumedAt'), '')
           END,
           '$.lockedAt', CASE
             WHEN COALESCE(json_extract(excluded.payload, '$.lockedAt'), '') <> '' THEN json_extract(excluded.payload, '$.lockedAt')
             ELSE COALESCE(json_extract(app_state_records.payload, '$.lockedAt'), '')
           END
         ),
         updated_at = excluded.updated_at`
    ).bind(collection, id, payload, updatedAt, attemptDelta);
  }
  return db.prepare(
    `INSERT INTO app_state_records (collection, id, payload, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(collection, id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  ).bind(collection, id, payload, updatedAt);
}

async function persistCloudState(snapshot, baseline) {
  const db = getCloudStateDb();
  if (!db) return;
  await ensureCloudStateSchema(db);
  const updatedAt = nowIso();
  const statements = [];
  for (const collection of STATE_COLLECTIONS) {
    const before = buildStateRecordMap(collection, baseline?.[collection]);
    const after = buildStateRecordMap(collection, snapshot[collection]);
    for (const id of before.keys()) {
      if (!after.has(id)) {
        statements.push(db.prepare('DELETE FROM app_state_records WHERE collection = ? AND id = ?').bind(collection, id));
      }
    }
    for (const [id, item] of after.entries()) {
      const baseItem = before.get(id);
      if (baseItem && JSON.stringify(baseItem) === JSON.stringify(item)) continue;
      statements.push(cloudUpsertStatement(db, collection, id, item, baseItem, updatedAt));
    }
  }
  if (statements.length) await db.batch(statements);
}

async function flushCloudState(context) {
  if (!IS_CLOUDFLARE_WORKER || !context?.dirty) return;
  const snapshot = normalizeStateShape(context.state);
  context.dirty = false;
  cloudStateSavePromise = cloudStateSavePromise
    .catch(() => {})
    .then(() => persistCloudState(snapshot, context.baseline));
  await cloudStateSavePromise;
  context.baseline = normalizeStateShape(snapshot);
}

let cloudWorkerIdCounter = 0;

function randomId(prefix) {
  if (IS_CLOUDFLARE_WORKER && !cloudStateIoEnabled) {
    cloudWorkerIdCounter += 1;
    return `${prefix}_${cloudWorkerIdCounter}`;
  }
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function hashValue(value) {
  return crypto.createHmac('sha256', APP_SECRET).update(String(value || '')).digest('hex');
}

function normalizeEmail(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/[^\d+]/g, '');
  const compact = normalized.startsWith('+') ? `+${normalized.slice(1).replace(/\D/g, '')}` : normalized.replace(/\D/g, '');
  const digitsOnly = compact.replace(/^\+/, '');
  return digitsOnly.length >= 7 && digitsOnly.length <= 15 ? compact : '';
}

function detectAuthTarget(value) {
  const email = normalizeEmail(value);
  if (email) return { channel: 'email', value: email };
  return null;
}

function isAdminEmail(value) {
  const email = normalizeEmail(value);
  return !!email && ADMIN_EMAILS.includes(email);
}

function maskEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return '';
  const [local, domain] = normalized.split('@');
  if (!local || !domain) return normalized;
  if (local.length <= 2) return `${local[0] || '*'}*@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

function maskPhone(phone) {
  const normalized = normalizePhone(phone).replace(/^\+/, '');
  if (!normalized) return '';
  if (normalized.length <= 4) return normalized;
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}

function pickDisplayName({ email, phone, fallback = '用户' }) {
  if (email) return normalizeEmail(email).split('@')[0] || fallback;
  if (phone) return maskPhone(phone);
  return fallback;
}

function normalizeDisplayName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

function countCjk(text) {
  return String(text || '').replace(/\s+/g, '').length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function riskLevel(probability) {
  if (probability >= 70) return 'high';
  if (probability >= 50) return 'medium';
  return 'low';
}

function countMatches(text, pattern) {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
}

function parseCookies(cookieHeader) {
  const result = {};
  for (const segment of String(cookieHeader || '').split(';')) {
    const idx = segment.indexOf('=');
    if (idx <= 0) continue;
    const key = segment.slice(0, idx).trim();
    const value = segment.slice(idx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch (_) {
      continue;
    }
  }
  return result;
}

function appendSetCookie(res, cookie) {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', [cookie]);
    return;
  }
  const next = Array.isArray(current) ? current.concat(cookie) : [current, cookie];
  res.setHeader('Set-Cookie', next);
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.secure) parts.push('Secure');
  appendSetCookie(res, parts.join('; '));
}

function clearCookie(res, name) {
  appendSetCookie(res, `${name}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${COOKIE_SECURE ? '; Secure' : ''}`);
}

function readJsonArray(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (_) {
    return [];
  }
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildOptionalRegex(items, flags, transform = (item) => item) {
  const patterns = (Array.isArray(items) ? items : [])
    .map((item) => String(transform(item) || '').trim())
    .filter(Boolean);
  if (!patterns.length) return null;
  return new RegExp(patterns.join('|'), flags);
}

function getLastNonEmptyLine(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim());
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i]) return lines[i];
  }
  return '';
}

function getKnowledgeBase() {
  const emotionalWords = readJsonArray(KNOWLEDGE_BASE_FILES.emotionalWords);
  return {
    clichePhrases: readJsonArray(KNOWLEDGE_BASE_FILES.clichePhrases),
    transitions: readJsonArray(KNOWLEDGE_BASE_FILES.transitions),
    emotionalWords,
    suspiciousSentences: readJsonArray(KNOWLEDGE_BASE_FILES.suspiciousSentences),
    overreachPatterns: readJsonArray(KNOWLEDGE_BASE_FILES.overreachPatterns),
    directHintRegex: buildOptionalRegex(HARDCODED_DIRECT_HINT_PATTERNS, 'i'),
    emotionalWordsRegex: buildOptionalRegex(emotionalWords, 'g', escapeRegex)
  };
}

function normalizeKnowledgeItems(items, { maxLength = 40, minLength = 2 } = {}) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || '').trim().replace(/\s+/g, ' '))
    .filter((item) => item.length >= minLength && item.length <= maxLength)
    .filter((item) => !/[{}[\]<>]/.test(item))
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeSentenceItems(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || '').trim().replace(/\s+/g, ' '))
    .filter((item) => countCjk(item) >= 8 && countCjk(item) <= 120)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function mergeUniqueText(existing, incoming) {
  const merged = [...existing];
  const seen = new Set(existing.map((item) => String(item || '').trim().toLowerCase()));
  const added = [];
  for (const item of incoming) {
    const normalized = String(item || '').trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
    added.push(normalized);
  }
  return { merged, added };
}

function persistKnowledgeBase(trainingResult, sourceText) {
  if (IS_CLOUDFLARE_WORKER) {
    const knowledge = trainingResult?.knowledge || {};
    return {
      clichePhrases: normalizeKnowledgeItems(knowledge.clichePhrases),
      transitions: normalizeKnowledgeItems(knowledge.transitions),
      emotionalWords: normalizeKnowledgeItems(knowledge.emotionalWords, { maxLength: 20 }),
      suspiciousSentences: normalizeSentenceItems(trainingResult?.suspiciousSentences),
      overreachPatterns: normalizeKnowledgeItems(knowledge.overreachPatterns)
    };
  }
  ensureDir(path.dirname(TRAINING_LOG_PATH));
  const knowledge = trainingResult?.knowledge || {};
  const updates = {
    clichePhrases: normalizeKnowledgeItems(knowledge.clichePhrases),
    transitions: normalizeKnowledgeItems(knowledge.transitions),
    emotionalWords: normalizeKnowledgeItems(knowledge.emotionalWords, { maxLength: 20 }),
    suspiciousSentences: normalizeSentenceItems(trainingResult?.suspiciousSentences),
    overreachPatterns: normalizeKnowledgeItems(knowledge.overreachPatterns)
  };

  const added = {};
  for (const [key, filePath] of Object.entries(KNOWLEDGE_BASE_FILES)) {
    const existing = readJsonArray(filePath);
    const { merged, added: inserted } = mergeUniqueText(existing, updates[key] || []);
    fs.writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    added[key] = inserted;
  }

  fs.appendFileSync(
    TRAINING_LOG_PATH,
    `${JSON.stringify({
      createdAt: nowIso(),
      sourceLength: countCjk(sourceText),
      summary: trainingResult?.summary || '',
      addedCounts: Object.fromEntries(Object.entries(added).map(([key, value]) => [key, value.length]))
    })}\n`,
    'utf8'
  );

  return added;
}

function normalizeReasonBonuses(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      reason: String(item?.reason || '').trim(),
      bonus: Math.round(clamp(Number(item?.bonus || 0), 0, 15))
    }))
    .filter((item) => item.reason && item.bonus > 0 && !ANTI_AI_REASON_REGEX.test(item.reason))
    .slice(0, 4);
}

function normalizeModelReasons(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || '').trim())
    .filter((item) => item && !ANTI_AI_REASON_REGEX.test(item))
    .slice(0, 4);
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[。！？!?])|\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function makeDiagnostic(category, severity, segment, reason, suggestion) {
  return {
    category,
    severity,
    segment: String(segment || '').trim().slice(0, 160),
    reason,
    suggestion
  };
}

function pushDiagnostic(list, diagnostic) {
  if (!diagnostic?.category || !diagnostic?.segment) return;
  const key = `${diagnostic.category}:${diagnostic.segment}:${diagnostic.reason}`;
  if (list.some((item) => `${item.category}:${item.segment}:${item.reason}` === key)) return;
  list.push(diagnostic);
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

function phraseMatchesText(text, phrase) {
  const normalized = String(phrase || '').trim();
  if (!normalized) return false;
  if (normalized.includes('...')) {
    const flexible = new RegExp(escapeRegex(normalized).replace(/\\\.\\\.\\\./g, '[\\s\\S]{0,30}'), 'i');
    return flexible.test(String(text || ''));
  }
  return String(text || '').includes(normalized);
}

function collectPhraseDiagnostics(text, phrases, { category, severity = 'medium', reason, suggestion, limit = 4 }) {
  const diagnostics = [];
  for (const phrase of Array.isArray(phrases) ? phrases : []) {
    if (!phrase || !phraseMatchesText(text, phrase)) continue;
    pushDiagnostic(diagnostics, makeDiagnostic(
      category,
      severity,
      findSegmentForPhrase(text, phrase),
      reason,
      suggestion
    ));
    if (diagnostics.length >= limit) break;
  }
  return diagnostics;
}

function analyzeRhythm(text) {
  return textMetrics.analyzeRhythm(text);
}

function analyzeFormatDiagnostics(text) {
  return diagnosticsEngine.analyzeFormatDiagnostics(text);
}

function buildDiagnostics(text, knowledgeBase, rhythm) {
  return diagnosticsEngine.buildDiagnostics(text, knowledgeBase, {
    rhythm,
    informationDensity: textMetrics.analyzeInformationDensity(text),
    dimensionScores: {}
  });
}

function analyzeAiSignals(text, options = {}) {
  const knowledgeBase = getKnowledgeBase();
  const analysis = signalScoring.analyzeAiSignals(text, knowledgeBase, options);
  const diagnostics = diagnosticsEngine.buildDiagnostics(text, knowledgeBase, analysis);
  const studentEssayGenre = studentEssayHumanizer.inferStudentEssayGenre(text, diagnostics, analysis);
  const studentEssayRuleHits = studentEssayHumanizer.detectStudentEssayRuleHits(text, studentEssayGenre, {
    rhythm: analysis.rhythm,
    diagnostics,
    profile: analysis.profile,
    informationDensity: analysis.informationDensity
  });
  return {
    ...analysis,
    diagnostics,
    studentEssayGenre,
    studentEssayRuleHits
  };
}

function mergeDetection(modelResult, signalResult) {
  return signalScoring.mergeDetection(modelResult, signalResult, normalizeReasonBonuses, normalizeModelReasons);
}

function dedupeTexts(items) {
  return rewriteRanking.dedupeTexts(items);
}

function splitParagraphs(text) {
  return textMetrics.splitParagraphs(text);
}

function preserveScore(original, candidate) {
  return rewriteRanking.preserveScore(original, candidate);
}

function normalizeRewriteCandidates(originalText, items) {
  return rewriteRanking.normalizeRewriteCandidates(originalText, items);
}

function rebuildFullRewrite(originalText, suspiciousSegments, candidateText) {
  return rewriteRanking.rebuildFullRewrite(originalText, suspiciousSegments, candidateText);
}

function scoreRewriteCandidate(text, originalText = '') {
  return rewriteRanking.scoreRewriteCandidate(text, originalText, (value) => analyzeAiSignals(value));
}

function normalizeRewriteContext(context) {
  return rewritePlanner.normalizeRewriteContext(context);
}

function summarizeRewriteContext(context) {
  return rewritePlanner.summarizeRewriteContext(context);
}

function summarizeDeletedOrCompressed(originalText, rewriteText, editPlan = []) {
  return rewritePlanner.summarizeDeletedOrCompressed(originalText, rewriteText, editPlan);
}

function buildConservativeRewrite(originalText, editPlan = [], options = {}) {
  return rewritePlanner.buildConservativeRewrite(originalText, editPlan, options);
}

function cleanRewriteText(text) {
  return String(text || '')
    .replace(/([。！？])\1+/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildRewriteStats(originalText, rankedItems) {
  return rewriteRanking.buildRewriteStats(originalText, rankedItems);
}

function buildRewriteFailureReasons({ originalText, rewrittenText, originalAnalysis, rewrittenAnalysis, factAudit, needsUserFacts = [], beforeAfter }) {
  const reasons = [];
  const add = (code, message) => {
    if (!reasons.some((item) => item.code === code)) reasons.push({ code, message });
  };
  const originalLength = countCjk(originalText);
  const rewrittenLength = countCjk(rewrittenText);
  const ratio = originalLength ? rewrittenLength / originalLength : 1;
  const drop = Number(originalAnalysis?.probability || 0) - Number(rewrittenAnalysis?.probability || 0);
  const leakedInternalText = /减少显性转场|直接进入判断|编辑计划|修改目标|事实边界|受控编辑器|needsUserFacts|unsupportedClaims|lengthPolicy|factInventory/i.test(String(rewrittenText || ''));

  if (!String(rewrittenText || '').trim()) add('no_rewrite', '没有生成可用改写文本。');
  if (factAudit && !factAudit.passed && !factAudit.relaxedPassed) add('fact_audit_failed', `事实审计未通过：${factAudit.blockingClaims?.length || factAudit.unsupportedClaims?.length || 0} 条阻断信息。`);
  if (factAudit && !factAudit.passed && factAudit.relaxedPassed) add('relaxed_safety_warning', `事实审计宽松通过：${factAudit.warningClaims?.length || factAudit.unsupportedClaims?.length || 0} 条低风险信息需人工确认。`);
  if (needsUserFacts.length) add('needs_user_facts', '部分内容缺少可追溯事实，已转入补充事实清单。');
  if (ratio < 0.45) add('length_too_short', `改写保留比例过低：${ratio.toFixed(2)}，已低于宽松放行底线。`);
  else if (ratio < 0.55) add('length_warning', `改写保留比例偏低：${ratio.toFixed(2)}，需确认是否过度删除。`);
  if (Number(rewrittenAnalysis?.probability || 0) >= 50) add('ai_score_still_high', `改写后 AI 率仍为 ${Math.round(Number(rewrittenAnalysis?.probability || 0))}，未低于 50 阈值。`);
  if (drop < 5) add('score_drop_too_small', `本轮降分 ${Math.round(drop)}，低于 5 分目标。`);
  if (beforeAfter && !(beforeAfter.reducedDimensions || []).length && drop < 8) add('dimension_not_reduced', '主要风险维度没有明显下降，需要继续调整结构或模板表达。');
  if (leakedInternalText) add('internal_text_leak', '改写正文疑似混入了编辑计划或内部字段。');
  return reasons;
}

function analyzeSegmentSignals(text) {
  return diagnosticsEngine.analyzeSegmentSignals(text, getKnowledgeBase());
}

function findSuspiciousSegments(text) {
  return diagnosticsEngine.findSuspiciousSegments(text, getKnowledgeBase());
}

function createUsageTracker(apiType) {
  return { apiType, totalTokens: 0, estimated: false, modelCalls: 0 };
}

function estimateTokensFromPieces(...pieces) {
  const chars = pieces.flat().filter(Boolean).map((item) => countCjk(item)).reduce((sum, n) => sum + n, 0);
  return Math.max(1, Math.ceil(chars * 1.4));
}

function trackUsage(tracker, usage, pieces = []) {
  if (!tracker) return;
  let tokens = Number(usage?.total_tokens || 0);
  let estimated = false;
  if (!Number.isFinite(tokens) || tokens <= 0) {
    tokens = estimateTokensFromPieces(pieces);
    estimated = true;
  }
  tracker.totalTokens += Math.max(0, Math.round(tokens));
  tracker.estimated = tracker.estimated || estimated;
  tracker.modelCalls += 1;
}

function summarizeUsage(tracker) {
  return {
    totalTokens: tracker?.totalTokens || 0,
    estimated: !!tracker?.estimated,
    modelCalls: tracker?.modelCalls || 0
  };
}

function powerCostFromTokens(tokens) {
  return Math.max(1, Math.ceil(Math.max(0, Number(tokens || 0)) / 50));
}

function estimateMinimumPower(apiType, text) {
  const length = countCjk(text);
  const estimatedTokensByApi = {
    detect: (length * 2) + 600,
    rewrite: (length * 4) + 1400,
    train: (length * 4) + 1800
  };
  return powerCostFromTokens(estimatedTokensByApi[apiType] || (length * 2) + 400);
}

function isRetryableError(err) {
  if (err?.name === 'AbortError') return false;
  if (typeof err?.status === 'number') return err.status >= 500 || err.status === 429;
  return true;
}

async function withRetry(fn) {
  let lastErr;
  for (let i = 0; i <= RETRY_COUNT; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === RETRY_COUNT || !isRetryableError(err)) throw err;
      await sleep(RETRY_DELAY_MS * (i + 1));
    }
  }
  throw lastErr;
}

async function withTimeout(promiseFactory, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(content) {
  const raw = String(content || "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = (fence ? fence[1] : raw).trim();
  try { return JSON.parse(body); } catch (_) {}
  const block = body.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (block) {
    return JSON.parse(block[1]);
  }
  const afterColon = body.replace(/^\s*json\s*:/i, "").trim();
  try { return JSON.parse(afterColon); } catch (_) {}
  throw new Error("Invalid JSON model response");
}

function summarizeError(error) {
  return {
    name: error?.name || '',
    message: error?.message || String(error),
    code: error?.code || '',
    status: error?.status || null,
    errors: Array.isArray(error?.errors)
      ? error.errors.map((item) => ({ code: item.code || '', message: item.message || String(item), address: item.address || '', port: item.port || '' }))
      : undefined
  };
}

function postJsonWithHttps(url, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${API_KEY}`
      },
      timeout: timeoutMs
    }, (resp) => {
      let text = '';
      resp.setEncoding('utf8');
      resp.on('data', (chunk) => { text += chunk; });
      resp.on('end', () => {
        if (resp.statusCode < 200 || resp.statusCode >= 300) {
          const error = new Error(text);
          error.status = resp.statusCode;
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Request timeout'), { name: 'AbortError' })));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function postChatCompletions(payload, timeoutMs) {
  const url = `${API_BASE_URL}/chat/completions`;
  try {
    return await withTimeout(async (signal) => {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify(payload),
        signal
      });
      if (!resp.ok) {
        const error = new Error(await resp.text());
        error.status = resp.status;
        throw error;
      }
      return resp.json();
    }, timeoutMs);
  } catch (fetchError) {
    try {
      return await postJsonWithHttps(url, payload, timeoutMs);
    } catch (httpsError) {
      fetchError.cause = httpsError;
      throw fetchError;
    }
  }
}

async function callModel({ model, systemPrompt, userPrompt, timeoutMs, usageTracker, maxTokens = 2200, responseFormat }) {
  if (!API_KEY) {
    const error = new Error('Missing API key');
    error.status = 401;
    throw error;
  }
  return withRetry(async () => {
    const data = await postChatCompletions({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: (responseFormat || { type: 'json_object' }),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }, timeoutMs);
    const content = data?.choices?.[0]?.message?.content || '';
    trackUsage(usageTracker, data?.usage, [systemPrompt, userPrompt, content]);
    try {
      return { json: extractJson(content), usage: data?.usage || null, rawContent: content };
    } catch (error) {
      error.rawContent = content;
      error.failureCode = 'MODEL_JSON_PARSE';
      throw error;
    }
  });
}

async function detectByProvider(text, usageTracker, options = {}) {
  const requestedGenre = signalScoring.normalizeGenreGuess(options.genre);
  let signalResult = analyzeAiSignals(text, requestedGenre ? { genreGuess: requestedGenre, genreSource: 'user' } : {});
  const genreInstruction = requestedGenre
    ? `用户已指定文体为“${requestedGenre}”。文体已由用户决定，你不需要也不能重新判断文体；genreGuess 必须原样输出“${requestedGenre}”。`
    : '用户未指定文体，请你直接判断文体，不要照抄本地画像。';
  const result = await callModel({
    model: DETECT_MODEL,
    timeoutMs: DETECT_TIMEOUT_MS,
    usageTracker,
    systemPrompt: requestedGenre
      ? '你是文本风险复判助手，只输出 JSON。结果作为本地评分参考；用户已指定文体时，你只评估 AI 痕迹风险，不重新判断文体。JSON 需要包含 probability(0-100)、genreGuess、reasons(1-4 条)、reasonBonuses(可选数组)。'
      : '你是文本风险复判助手，只输出 JSON。结果作为本地评分参考；用户未指定文体时，文体判断必须直接由你输出。JSON 需要包含 probability(0-100)、genreGuess、reasons(1-4 条)、reasonBonuses(可选数组)。',
    userPrompt: `请结合文本画像和信息密度，判断这段文字的 AI 痕迹风险。
只输出 JSON。
字段要求：
1. probability：0 到 100 的整数。
2. genreGuess：从“散文、议论文、记叙文、日记、说明文、读后感、随笔”中选一个。${genreInstruction}
3. reasons：1 到 4 条简短理由。
4. reasonBonuses：可选，数组项格式为 { reason, bonus }，bonus 为 5 到 15。
5. 不要复述规则说明，不要输出多余解释。

文本：
${text}`
  });
  const modelGenre = requestedGenre ? '' : signalScoring.normalizeGenreGuess(result?.json?.genreGuess);
  if (!requestedGenre && modelGenre) {
    signalResult = analyzeAiSignals(text, { genreGuess: modelGenre, genreSource: 'model' });
  }

  const modelResult = {
    probability: Math.round(clamp(Number(result?.json?.probability || 0), 0, 100)),
    genreGuess: requestedGenre || modelGenre || signalResult?.profile?.genreGuess || '',
    reasons: normalizeModelReasons(result?.json?.reasons),
    reasonBonuses: normalizeReasonBonuses(result?.json?.reasonBonuses)
  };
  const merged = mergeDetection(modelResult, signalResult);
  return {
    ...merged,
    profile: {
      ...(merged.profile || {}),
      genreGuess: modelResult.genreGuess || merged.profile?.genreGuess || '',
      genreSource: requestedGenre ? 'user' : modelGenre ? 'model' : merged.profile?.genreSource || 'local'
    }
  };
}

async function rankRewritesByDetection(originalText, candidates, usageTracker) {
  const selected = normalizeRewriteCandidates(originalText, candidates)
    .map((text) => scoreRewriteCandidate(text, originalText))
    .sort((a, b) => (a.score - b.score) || (b.preserve - a.preserve))
    .slice(0, 2);
  if (!selected.length) return [];

  const ranked = await Promise.all(selected.map(async (candidate) => {
    try {
      const detected = await detectByProvider(candidate.text, usageTracker);
      return { text: candidate.text, probability: detected.probability, reasons: detected.reasons, preserve: candidate.preserve, analysis: detected };
    } catch (_) {
      return { text: candidate.text, probability: candidate.score, reasons: candidate.signal.reasons, preserve: candidate.preserve, analysis: candidate.signal };
    }
  }));

  const belowThreshold = ranked.filter((item) => item.probability < 50).sort((a, b) => (a.probability - b.probability) || (b.preserve - a.preserve));
  if (belowThreshold.length) return belowThreshold.slice(0, 1);
  return ranked.sort((a, b) => (a.probability - b.probability) || (b.preserve - a.preserve)).slice(0, 1);
}

function normalizeOriginalAnalysisForRewrite(text, rewriteGenre, originalAnalysis) {
  const probability = Number(originalAnalysis?.probability);
  if (!Number.isFinite(probability)) {
    return analyzeAiSignals(text, rewriteGenre ? { genreGuess: rewriteGenre, genreSource: 'user' } : {});
  }
  return {
    ...originalAnalysis,
    probability: Math.round(clamp(probability, 0, 100)),
    reasons: Array.isArray(originalAnalysis.reasons) ? originalAnalysis.reasons : [],
    diagnostics: Array.isArray(originalAnalysis.diagnostics) ? originalAnalysis.diagnostics : [],
    profile: originalAnalysis.profile || textMetrics.detectTextProfile(text),
    dimensionScores: originalAnalysis.dimensionScores || {},
    informationDensity: originalAnalysis.informationDensity || textMetrics.analyzeInformationDensity(text),
    formattingSignals: originalAnalysis.formattingSignals || textMetrics.analyzeFormattingSignals(text)
  };
}

async function rewriteByProvider(text, usageTracker, context = {}, options = {}) {
  const rewriteContext = normalizeRewriteContext(context);
  const rewriteGenre = signalScoring.normalizeGenreGuess(rewriteContext.genre);
  const originalAnalysis = normalizeOriginalAnalysisForRewrite(text, rewriteGenre, options.originalAnalysis);
  const rewriteMode = rewritePlanner.chooseRewriteMode(rewriteContext.rewriteMode, originalAnalysis.probability);
  const modePolicy = getRewriteModePolicy(rewriteMode);
  const voiceProfile = buildVoiceProfile(rewriteContext.writingSamples, rewriteContext.tone);
  const cleanedWritingSamples = voiceProfile.sample?.cleanedText || '';
  const voiceDirectives = buildVoiceDirectives(voiceProfile);
  const voiceCalibrationNotes = buildVoiceCalibrationNotes(voiceProfile);
  const suspiciousSegments = findSuspiciousSegments(text);
  const diagnostics = originalAnalysis.diagnostics || [];
  const factInventory = modePolicy.buildFactInventory
    ? buildFactInventory(text, rewriteContext)
    : buildDisabledFactInventory(text);
  const studentEssayGenre = originalAnalysis.studentEssayGenre || studentEssayHumanizer.inferStudentEssayGenre(text, diagnostics, originalAnalysis);
  const studentEssayRuleHits = originalAnalysis.studentEssayRuleHits || studentEssayHumanizer.detectStudentEssayRuleHits(text, studentEssayGenre, {
    rhythm: originalAnalysis.rhythm,
    diagnostics,
    profile: originalAnalysis.profile,
    informationDensity: originalAnalysis.informationDensity
  });
  const studentEssay = studentEssayHumanizer.filterStudentEssayActions({
    ruleHits: studentEssayRuleHits,
    genre: studentEssayGenre,
    factInventory
  });
  const studentPlanItems = (studentEssay.actions || []).map((item) => ({
    segment: item.excerpt,
    problemType: item.category,
    action: item.severity === 'high' ? 'replace' : 'compress',
    reason: `学生作文规则命中：${item.category}`,
    target: item.action
  }));
  const localEditPlan = rewritePlanner.normalizeEditPlan([
    ...rewritePlanner.buildLocalEditPlan(text, {
    analysis: originalAnalysis,
    diagnostics,
    suspiciousSegments,
    rewriteMode
    }),
    ...studentPlanItems
  ]);
  const executableEditPlan = rewritePolicy.buildExecutableEditPlan(localEditPlan, originalAnalysis.profile, {
    protectFacts: modePolicy.protectFactsInPlan
  });
  let execution;
  try {
    execution = await rewriteExecutor.executeRewriteWithPlan(
      text,
      executableEditPlan,
      factInventory,
      {
        ...rewriteContext,
        writingSamples: cleanedWritingSamples,
        rewriteMode,
        modePolicy,
        voiceProfile,
        voiceDirectives,
        studentEssayGenre,
        studentEssayRuleHits,
        studentEssay,
        originalAiScore: originalAnalysis.probability,
        originalAnalysis
      },
      callModel,
      usageTracker,
      {
        model: REWRITE_MODEL,
        timeoutMs: REWRITE_TIMEOUT_MS,
        maxTokens: 2400,
        analyzeSignals: analyzeAiSignals
      }
    );
  } catch (error) {
    const fallbackRewrite = buildConservativeRewrite(text, executableEditPlan, { rewriteMode });
    const fallbackAudit = auditRewriteFacts(text, fallbackRewrite, factInventory, { mode: modePolicy.auditMode });
    const fallbackReason = error?.name === 'AbortError' ? '模型请求超时，已降级为保守改写。' : '模型改写失败，已降级为保守改写。';
    execution = {
      rewriteStatus: fallbackAudit.passed ? 'conservative_fallback' : 'needs_user_facts',
      appliedEdits: executableEditPlan,
      rewrites: [fallbackRewrite],
      factAudit: fallbackAudit,
      needsUserFacts: modePolicy.factAuditEnabled ? buildNeedsUserFacts(fallbackAudit, diagnostics) : [],
      fallbackReason,
      fallbackTriggeredBy: 'model_failure',
      repairAttempted: false,
      repairUsed: false,
      selfReview: [{
        issue: fallbackReason,
        suggestion: '本版只按编辑计划删水分和压缩套话，不补写新事实。'
      }]
    };
  }

  const ranked = rewriteExecutor.rankCandidates(text, execution.rewrites, factInventory, execution.factAudit, analyzeAiSignals, {
    rewriteMode,
    modePolicy,
    writingSamples: cleanedWritingSamples,
    voiceProfile,
    studentEssayGenre,
    studentEssayRuleHits,
    originalAiScore: originalAnalysis.probability
  })
    .filter((item) => item.text && item.text.trim())
    .slice(0, 3);
  const finalRanked = ranked.length
    ? ranked.map((item) => ({
        text: cleanRewriteText(item.text),
        probability: Number(item.analysis?.probability || 0),
        reasons: item.analysis?.reasons || [],
        preserve: item.preserve,
        analysis: item.analysis || analyzeAiSignals(item.text),
        factAudit: item.audit,
        voiceFit: item.voiceFit,
        essayQuality: item.essayQuality,
        studentEssayAfterHits: item.studentEssayAfterHits || [],
        lengthFit: item.lengthFit,
        paragraphCoverage: item.paragraphCoverage
      }))
    : [{
        text,
        probability: originalAnalysis.probability,
        reasons: originalAnalysis.reasons,
        preserve: 100,
        analysis: originalAnalysis,
        factAudit: auditRewriteFacts(text, text, factInventory, { mode: modePolicy.auditMode }),
        voiceFit: null,
        essayQuality: null,
        studentEssayAfterHits: studentEssayRuleHits,
        lengthFit: rewriteRanking.lengthFitScore(text, text, rewriteMode),
        paragraphCoverage: rewriteRanking.paragraphCoverageScore(text, text)
      }];

  const primaryFactAudit = finalRanked[0]?.factAudit || execution.factAudit;
  const rewriteStats = buildRewriteStats(text, finalRanked).map((item, index) => ({
    ...item,
    factSafe: modePolicy.factAuditEnabled ? !!finalRanked[index]?.factAudit?.passed : null,
    relaxedFactSafe: modePolicy.factAuditEnabled ? !!finalRanked[index]?.factAudit?.relaxedPassed : null,
    factSafetySeverity: finalRanked[index]?.factAudit?.severity || '',
    unsupportedClaimCount: finalRanked[index]?.factAudit?.unsupportedClaims?.length || 0,
    warningClaimCount: finalRanked[index]?.factAudit?.warningClaims?.length || 0,
    blockingClaimCount: finalRanked[index]?.factAudit?.blockingClaims?.length || 0,
    voiceFit: finalRanked[index]?.voiceFit || null,
    essayQuality: finalRanked[index]?.essayQuality || null,
    studentEssayAfterHitCount: finalRanked[index]?.studentEssayAfterHits?.length || 0
  }));
  const bestAnalysis = finalRanked[0]?.analysis || (finalRanked[0]?.text ? analyzeAiSignals(finalRanked[0].text) : null);
  const beforeAfter = bestAnalysis ? rewritePlanner.buildBeforeAfter(originalAnalysis, bestAnalysis) : null;
  const deletedOrCompressed = finalRanked[0] ? summarizeDeletedOrCompressed(text, finalRanked[0].text, execution.appliedEdits || executableEditPlan) : [];
  const voiceFitScore = finalRanked[0]?.voiceFit || compareVoiceFit({
    originalText: text,
    rewrittenText: finalRanked[0]?.text || '',
    writingSamples: cleanedWritingSamples,
    voiceProfile,
    factAudit: primaryFactAudit
  });
  const remainingReview = beforeAfter?.remainingRisks?.map((item) => ({
    issue: item.dimension + ' is still ' + item.score,
    suggestion: 'This dimension remains high after retest; consider manual review.'
  })) || [];
  const rewriteFailureReasons = buildRewriteFailureReasons({
    originalText: text,
    rewrittenText: finalRanked[0]?.text || '',
    originalAnalysis,
    rewrittenAnalysis: bestAnalysis,
    factAudit: modePolicy.factAuditBlocking ? primaryFactAudit : null,
    needsUserFacts: modePolicy.factAuditBlocking ? execution.needsUserFacts || [] : [],
    beforeAfter
  });

  return {
    report: diagnostics,
    studentEssayGenre,
    studentEssayRuleHits,
    studentEssayActions: studentEssay.actions || [],
    profile: originalAnalysis.profile,
    dimensionScores: originalAnalysis.dimensionScores,
    informationDensity: originalAnalysis.informationDensity,
    rewriteMode,
    safetyMode: modePolicy.safetyMode,
    rewriteStatus: execution.rewriteStatus,
    factAuditEnabled: modePolicy.factAuditEnabled,
    factAuditSeverity: modePolicy.factAuditSeverity,
    factAuditBlocking: modePolicy.factAuditBlocking,
    factAuditWarnings: primaryFactAudit?.warningClaims || [],
    fallbackReason: execution.fallbackReason || '',
    fallbackTriggeredBy: execution.fallbackTriggeredBy || 'none',
    repairAttempted: !!execution.repairAttempted,
    repairUsed: !!execution.repairUsed,
    voiceCalibrationUsed: !!voiceProfile.hasSamples && !['conservative_fallback', 'needs_user_facts'].includes(execution.rewriteStatus),
    voiceProfile,
    voiceDirectives,
    voiceFitScore,
    essayRewriteQuality: finalRanked[0]?.essayQuality || null,
    studentEssayAfterHits: finalRanked[0]?.studentEssayAfterHits || [],
    rewriteSource: execution.rewriteStatus || '',
    factSafetyLevel: modePolicy.factAuditEnabled
      ? finalRanked[0]?.essayQuality?.factSafetyLevel || (primaryFactAudit?.passed ? 'strict_safe' : primaryFactAudit?.relaxedPassed ? 'relaxed_safe' : 'blocking')
      : 'not_audited',
    voiceCalibrationNotes,
    factInventory: modePolicy.displayFactInventory ? factInventory : null,
    factAudit: modePolicy.displayFactAudit ? primaryFactAudit : null,
    relaxedSafety: execution.relaxedSafety || {
      strictPassed: !!primaryFactAudit?.strictPassed,
      relaxedPassed: !!primaryFactAudit?.relaxedPassed,
      severity: primaryFactAudit?.severity || '',
      warningClaims: primaryFactAudit?.warningClaims || [],
      blockingClaims: primaryFactAudit?.blockingClaims || []
    },
    warningClaims: primaryFactAudit?.warningClaims || [],
    blockingClaims: primaryFactAudit?.blockingClaims || [],
    needsUserFacts: execution.needsUserFacts || [],
    editPlan: executableEditPlan,
    appliedEdits: execution.appliedEdits || executableEditPlan,
    deletedOrCompressed,
    rewrites: finalRanked.map((item) => item.text),
    selfReview: [
      ...(execution.selfReview || []).map((item) => typeof item === 'string' ? { issue: item, suggestion: 'Model self-review item.' } : item),
      ...remainingReview
    ].slice(0, 6),
    rewriteFailureReasons,
    rewriteStats,
    beforeAfter,
    suspiciousSegments: suspiciousSegments.map((item) => ({ label: item.label, content: item.content, reasons: item.reasons, categories: item.categories || [] }))
  };
}

async function trainByProvider(text, usageTracker) {
  const result = await callModel({
    model: DETECT_MODEL,
    timeoutMs: DETECT_TIMEOUT_MS,
    usageTracker,
    systemPrompt: '你是中文 AI 痕迹训练助手。要从疑似 AI 写作文本里提取可复用的 AI 语句和特征短语。只输出 JSON：summary、suspiciousSentences、knowledge(clichePhrases/transitions/emotionalWords/overreachPatterns/vagueAttributions/inflatedMeaning/englishSlop/formatPatterns)。',
    userPrompt: `请分析下面这篇文章，提取最值得加入知识库的 AI 痕迹内容：
1. suspiciousSentences：整句或整段中的典型 AI 语句，保留原句。
2. clichePhrases：模板化套话、拔高句、空泛金句。
3. transitions：过于工整的连接词、总结句、转折句。
4. emotionalWords：高频、偏抒情、容易把文章写得太标准化的词。
5. overreachPatterns：预设读者认知、替读者安排误解的反代入式表达。
6. vagueAttributions：模糊归因，例如“很多人都说”“某种程度上说明”。
7. inflatedMeaning：把普通事实拔高成意义、价值、时代判断的表达。
8. englishSlop：英文写作里常见的 slop 词或公式句。
9. formatPatterns：排版格式痕迹，例如过密标题、符号分隔、聊天助手尾句。

文章：
${text}`
  });

  return {
    summary: String(result?.json?.summary || '').trim() || '本次训练已完成。',
    suspiciousSentences: normalizeSentenceItems(result?.json?.suspiciousSentences).slice(0, 12),
    knowledge: {
      clichePhrases: normalizeKnowledgeItems(result?.json?.knowledge?.clichePhrases).slice(0, 20),
      transitions: normalizeKnowledgeItems(result?.json?.knowledge?.transitions).slice(0, 20),
      directHints: [],
      emotionalWords: normalizeKnowledgeItems(result?.json?.knowledge?.emotionalWords, { maxLength: 20 }).slice(0, 20),
      overreachPatterns: normalizeKnowledgeItems(result?.json?.knowledge?.overreachPatterns).slice(0, 20),
      vagueAttributions: normalizeKnowledgeItems(result?.json?.knowledge?.vagueAttributions).slice(0, 20),
      inflatedMeaning: normalizeKnowledgeItems(result?.json?.knowledge?.inflatedMeaning).slice(0, 20),
      englishSlop: normalizeKnowledgeItems(result?.json?.knowledge?.englishSlop).slice(0, 20),
      formatPatterns: normalizeKnowledgeItems(result?.json?.knowledge?.formatPatterns).slice(0, 20)
    }
  };
}

function pruneExpiredVerificationCodes() {
  const now = Date.now();
  state.verificationCodes = state.verificationCodes.filter((item) => {
    const expiresAt = new Date(item.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt + (24 * 60 * 60 * 1000) > now;
  });
}

function pruneExpiredSessions() {
  const now = Date.now();
  state.sessions = state.sessions.filter((item) => {
    const createdAt = new Date(item.createdAt).getTime();
    return Number.isFinite(createdAt) && (createdAt + (SESSION_MAX_AGE_SECONDS * 1000)) > now;
  });
}

function ensureBootstrapAdmin() {
  let changed = false;
  for (const email of ADMIN_EMAILS) {
    if (!email) continue;
    let user = state.users.find((item) => normalizeEmail(item.email) === email);
    if (!user) {
      user = {
        id: randomId('user'),
        email,
        phone: '',
        displayName: pickDisplayName({ email, fallback: '管理员' }),
        powerBalance: 0,
        role: 'admin',
        signupBonusGrantedAt: '',
        createdAt: nowIso(),
        lastLoginAt: ''
      };
      state.users.push(user);
      changed = true;
    } else {
      if (normalizeEmail(user.email) !== email) {
        user.email = email;
        changed = true;
      }
      if (!user.displayName) {
        user.displayName = pickDisplayName({ email, fallback: '管理员' });
        changed = true;
      }
    }
    if (user.role !== 'admin') {
      user.role = 'admin';
      changed = true;
    }
  }
  for (const user of state.users) {
    const email = normalizeEmail(user.email);
    if (isAdminEmail(email) && user.role !== 'admin') {
      user.role = 'admin';
      changed = true;
    }
    if (!isAdminEmail(email) && user.role === 'admin') {
      user.role = 'user';
      changed = true;
    }
  }
  const validSessionCount = state.sessions.length;
  state.sessions = state.sessions.filter((item) => item?.id && item?.tokenHash);
  if (state.sessions.length !== validSessionCount) changed = true;
  if (changed) saveState();
}

function findUserByTarget(channel, value) {
  if (channel === 'email') {
    return state.users.find((item) => normalizeEmail(item.email) === value) || null;
  }
  return state.users.find((item) => normalizePhone(item.phone) === value);
}

function isAdminUser(user) {
  return !!user && isAdminEmail(user.email);
}

function serializeUser(user) {
  if (!user) return null;
  const ledger = state.powerLedger.filter((item) => item.userId === user.id);
  const totals = {
    giftedPower: ledger.filter((item) => item.type === 'signup_bonus' || item.type === 'admin_grant').reduce((sum, item) => sum + Math.max(0, Number(item.delta || 0)), 0),
    rechargedPower: ledger.filter((item) => item.type === 'recharge' || item.type === 'manual_recharge').reduce((sum, item) => sum + Math.max(0, Number(item.delta || 0)), 0),
    consumedPower: Math.abs(ledger.filter((item) => item.type === 'consume').reduce((sum, item) => sum + Math.min(0, Number(item.delta || 0)), 0))
  };
  return {
    id: user.id,
    role: isAdminUser(user) ? 'admin' : 'user',
    displayName: user.displayName || pickDisplayName(user),
    email: user.email ? maskEmail(user.email) : '',
    phone: user.phone ? maskPhone(user.phone) : '',
    powerBalance: Number(user.powerBalance || 0),
    createdAt: user.createdAt || '',
    lastLoginAt: user.lastLoginAt || '',
    totals
  };
}

function serializeAdminUser(user) {
  const summary = serializeUser(user);
  return {
    ...summary,
    emailRaw: normalizeEmail(user.email),
    phoneRaw: normalizePhone(user.phone),
    ledgerCount: state.powerLedger.filter((item) => item.userId === user.id).length
  };
}

function serializeAdminGuestIpUsage(record) {
  const hasRealIp = !!String(record?.ip || '').trim();
  return {
    ipLabel: hasRealIp ? 'IP' : 'IPhash',
    ip: String(record?.ip || record?.ipHash || '-'),
    remainingPower: guestIpRemainingPower(record),
    lastSeenAt: record?.lastSeenAt || record?.firstSeenAt || ''
  };
}

function applyProfileUpdate(user, payload = {}) {
  const displayName = normalizeDisplayName(payload.displayName);
  if (!displayName) {
    const error = new Error('用户名不能为空');
    error.status = 400;
    error.failureCode = 'INVALID_PROFILE';
    throw error;
  }
  user.displayName = displayName;
  user.updatedAt = nowIso();
  saveState();
  return user;
}

function deleteUserAccount(targetUser, currentUser) {
  if (!targetUser) {
    const error = new Error('未找到用户');
    error.status = 404;
    error.failureCode = 'USER_NOT_FOUND';
    throw error;
  }
  if (currentUser && targetUser.id === currentUser.id) {
    const error = new Error('不能删除当前登录的管理员账号');
    error.status = 400;
    error.failureCode = 'CANNOT_DELETE_SELF';
    throw error;
  }
  if (isAdminUser(targetUser)) {
    const error = new Error('不能删除管理员账号');
    error.status = 400;
    error.failureCode = 'CANNOT_DELETE_ADMIN';
    throw error;
  }

  const targetId = targetUser.id;
  const before = {
    users: state.users.length,
    sessions: state.sessions.length,
    powerLedger: state.powerLedger.length,
    rechargeOrders: state.rechargeOrders.length
  };

  state.users = state.users.filter((item) => item.id !== targetId);
  state.sessions = state.sessions.filter((item) => item.userId !== targetId);
  state.powerLedger = state.powerLedger.filter((item) => item.userId !== targetId);
  state.rechargeOrders = state.rechargeOrders.filter((item) => item.userId !== targetId);
  saveState();

  return {
    removedUserId: targetId,
    removed: {
      users: before.users - state.users.length,
      sessions: before.sessions - state.sessions.length,
      powerLedger: before.powerLedger - state.powerLedger.length,
      rechargeOrders: before.rechargeOrders - state.rechargeOrders.length
    }
  };
}

function createSession(user) {
  const loggedInAt = nowIso();
  user.lastLoginAt = loggedInAt;
  const token = crypto.randomBytes(32).toString('base64url');
  const session = {
    id: randomId('sess'),
    tokenHash: hashValue(`session:${token}`),
    userId: user.id,
    createdAt: loggedInAt,
    lastSeenAt: loggedInAt
  };
  state.sessions.push(session);
  saveState();
  return { session, token };
}

function getSession(sessionToken) {
  if (!sessionToken) return null;
  pruneExpiredSessions();
  const tokenHash = hashValue(`session:${sessionToken}`);
  const session = state.sessions.find((item) => item.tokenHash === tokenHash);
  if (!session) return null;
  const user = state.users.find((item) => item.id === session.userId);
  if (!user) return null;
  session.lastSeenAt = nowIso();
  if (isAdminUser(user) && user.role !== 'admin') user.role = 'admin';
  saveState();
  return { session, user };
}

function removeSession(sessionToken) {
  const tokenHash = sessionToken ? hashValue(`session:${sessionToken}`) : '';
  const before = state.sessions.length;
  state.sessions = state.sessions.filter((item) => item.tokenHash !== tokenHash);
  if (state.sessions.length !== before) saveState();
}

function ensureGuestId(req, res) {
  const existing = req.cookies.guest_id;
  if (existing) return existing;
  const guestId = randomId('guest');
  setCookie(res, 'guest_id', guestId, { maxAge: GUEST_MAX_AGE_SECONDS, secure: COOKIE_SECURE });
  req.cookies.guest_id = guestId;
  return guestId;
}

function getGuestUsage(guestId) {
  if (!guestId) return null;
  let record = state.guestUsages.find((item) => item.guestId === guestId);
  if (!record) {
    record = {
      guestId,
      guestIdHash: hashValue(guestId),
      ipHash: '',
      userAgentHash: '',
      usedCount: 0,
      usedPower: 0,
      firstUsedAt: '',
      lastUsedAt: '',
      pendingRewriteHash: '',
      pendingRewriteExpiresAt: ''
    };
    state.guestUsages.push(record);
    saveState();
  }
  return record;
}

function normalizeClientIp(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const first = raw.split(',')[0].trim();
  const withoutIpv6Mapped = first.startsWith('::ffff:') ? first.slice(7) : first;
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(withoutIpv6Mapped)) {
    return withoutIpv6Mapped.replace(/:\d+$/, '');
  }
  return withoutIpv6Mapped;
}

function getClientIp(req) {
  return normalizeClientIp(
    req.headers['cf-connecting-ip']
    || req.headers['x-real-ip']
    || req.headers['x-forwarded-for']
    || req.ip
    || req.socket?.remoteAddress
    || ''
  );
}

function getClientIpHash(req) {
  return hashValue(getClientIp(req) || 'unknown');
}

function pruneExpiredGuestIpUsages() {
  const before = state.guestIpUsages.length;
  const cutoff = Date.now() - GUEST_IP_USAGE_TTL_MS;
  state.guestIpUsages = state.guestIpUsages.filter((item) => {
    const lastSeenAt = new Date(item.lastSeenAt || item.createdAt || 0).getTime();
    return Number.isFinite(lastSeenAt) && lastSeenAt >= cutoff;
  });
  if (state.guestIpUsages.length !== before) saveState();
}

function guestIpRemainingPower(record) {
  if (!record) return 0;
  const remaining = Number(record.remainingPower);
  return Number.isFinite(remaining) ? Math.max(0, Math.round(remaining)) : 0;
}

function findGuestIpUsageByHash(ipHash) {
  if (!ipHash) return null;
  return state.guestIpUsages.find((item) => item.ipHash === ipHash) || null;
}

function getGuestIpUsage(req, options = {}) {
  pruneExpiredGuestIpUsages();
  const clientIp = getClientIp(req);
  const ipHash = hashValue(clientIp || 'unknown');
  let record = findGuestIpUsageByHash(ipHash);
  if (!record) {
    const legacyRemaining = options.legacyGuestUsage ? guestRemainingPower(options.legacyGuestUsage) : GUEST_FREE_TRIAL_LIMIT;
    record = {
      ip: clientIp,
      ipHash,
      remainingPower: Math.min(GUEST_FREE_TRIAL_LIMIT, legacyRemaining),
      firstSeenAt: nowIso(),
      lastSeenAt: nowIso()
    };
    state.guestIpUsages.push(record);
  } else {
    if (clientIp) record.ip = clientIp;
    record.remainingPower = Math.min(GUEST_FREE_TRIAL_LIMIT, guestIpRemainingPower(record));
    record.lastSeenAt = nowIso();
  }
  saveState();
  return record;
}

function guestUsedPower(record) {
  if (!record) return 0;
  const usedPower = Number(record.usedPower);
  if (Number.isFinite(usedPower) && usedPower > 0) return Math.round(usedPower);
  return Number(record.usedCount || 0) > 0 ? GUEST_FREE_TRIAL_LIMIT : 0;
}

function guestRemainingPower(record) {
  return Math.max(0, GUEST_FREE_TRIAL_LIMIT - guestUsedPower(record));
}

function guestQuotaRemainingPower(record) {
  if (record && Object.prototype.hasOwnProperty.call(record, 'remainingPower')) {
    return guestIpRemainingPower(record);
  }
  return guestRemainingPower(record);
}

function guestDetectCost(text, usageTracker = null) {
  const tokens = Number(usageTracker?.totalTokens || 0);
  return tokens > 0 ? powerCostFromTokens(tokens) : estimateMinimumPower('detect', text);
}

function ensureGuestPower(record, text) {
  const needed = estimateMinimumPower('detect', text);
  if (guestQuotaRemainingPower(record) < needed) {
    const error = new Error('免费试用额度已用完，请登录后继续使用');
    error.status = 401;
    error.failureCode = 'LOGIN_REQUIRED';
    throw error;
  }
}

function consumeGuestSignupRemainder(ipRecord, cookieRecord = null) {
  const remaining = guestIpRemainingPower(ipRecord);
  if (ipRecord) {
    ipRecord.remainingPower = 0;
    ipRecord.signupBonusTransferredAt = nowIso();
    ipRecord.lastSeenAt = nowIso();
  }
  if (cookieRecord) {
    cookieRecord.usedPower = GUEST_FREE_TRIAL_LIMIT;
    cookieRecord.signupBonusTransferredAt = nowIso();
  }
  saveState();
  return remaining;
}

function hashText(text) {
  return hashValue(String(text || '').trim());
}

function consumeGuestIpPower(record, text, usageTracker = null) {
  ensureGuestPower(record, text);
  const cost = Math.min(guestIpRemainingPower(record), guestDetectCost(text, usageTracker));
  record.remainingPower = Math.max(0, guestIpRemainingPower(record) - cost);
  record.lastSeenAt = nowIso();
  return cost;
}

function markGuestTrialUsed(record, req, text, usageTracker = null, ipRecord = null) {
  const cost = ipRecord ? consumeGuestIpPower(ipRecord, text, usageTracker) : Math.min(guestRemainingPower(record), guestDetectCost(text, usageTracker));
  if (record) {
    const previousUsedPower = guestUsedPower(record);
    record.usedCount = Number(record.usedCount || 0) + 1;
    record.usedPower = Math.min(GUEST_FREE_TRIAL_LIMIT, previousUsedPower + cost);
    record.firstUsedAt = record.firstUsedAt || nowIso();
    record.lastUsedAt = nowIso();
    record.ipHash = getClientIpHash(req);
    record.userAgentHash = hashValue(req.headers['user-agent'] || '');
    record.pendingRewriteHash = hashText(text);
    record.pendingRewriteExpiresAt = new Date(Date.now() + GUEST_REWRITE_WINDOW_MS).toISOString();
  }
  saveState();
}

function canGuestRewrite(record, text) {
  if (!record || !record.pendingRewriteHash || !record.pendingRewriteExpiresAt) return false;
  const expiresAt = new Date(record.pendingRewriteExpiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  return record.pendingRewriteHash === hashText(text);
}

function consumeGuestRewrite(record) {
  if (!record) return;
  record.lastRewriteAt = nowIso();
  saveState();
}

function isEmailChannelEnabled() {
  return !!(process.env.SMTP_HOST && (process.env.SMTP_FROM || process.env.SMTP_USER));
}

function getAvailableAuthChannels() {
  return ['email'];
}

function emailDomain(value) {
  return normalizeEmail(value).split('@')[1] || '';
}

function buildRateLimitError() {
  const error = new Error('请求过于频繁，请稍后再试');
  error.status = 429;
  error.failureCode = 'RATE_LIMITED';
  return error;
}

async function consumeSecurityRateLimit(action, key, policy) {
  const limit = Math.max(1, Number(policy?.limit || 1));
  const windowMs = Math.max(1000, Number(policy?.windowMs || 60000));
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const expiresAt = new Date(windowStart + windowMs).toISOString();
  const id = `rate_${hashValue(`${action}:${key}:${windowStart}`)}`;

  if (IS_CLOUDFLARE_WORKER) {
    const db = getCloudStateDb();
    if (!db) throw new Error('Cloud security rate limit storage is unavailable');
    await ensureCloudStateSchema(db);
    const nowValue = nowIso();
    const row = await db.prepare(
      `INSERT INTO security_rate_limits (id, count, expires_at, updated_at) VALUES (?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         count = CASE WHEN security_rate_limits.expires_at <= ? THEN 1 ELSE security_rate_limits.count + 1 END,
         expires_at = CASE WHEN security_rate_limits.expires_at <= ? THEN excluded.expires_at ELSE security_rate_limits.expires_at END,
         updated_at = excluded.updated_at
       RETURNING count, expires_at`
    ).bind(id, expiresAt, nowValue, nowValue, nowValue).first();
    if (Number(row?.count || 0) > limit) throw buildRateLimitError();
    return Number(row?.count || 1);
  }

  state.authRateLimits = state.authRateLimits.filter((item) => new Date(item.expiresAt || 0).getTime() > now);
  let record = state.authRateLimits.find((item) => item.id === id);
  if (!record) {
    record = { id, action, count: 0, expiresAt, updatedAt: nowIso() };
    state.authRateLimits.push(record);
  }
  record.count = Number(record.count || 0) + 1;
  record.updatedAt = nowIso();
  saveState();
  if (record.count > limit) throw buildRateLimitError();
  return record.count;
}

async function enforceSendCodeRateLimits(req, target) {
  await consumeSecurityRateLimit('send-code-global', 'global', AUTH_RATE_LIMITS.sendGlobal);
  await consumeSecurityRateLimit('send-code-ip', getClientIpHash(req), AUTH_RATE_LIMITS.sendIp);
  await consumeSecurityRateLimit('send-code-target', hashValue(target), AUTH_RATE_LIMITS.sendTarget);
  await consumeSecurityRateLimit('send-code-domain', hashValue(emailDomain(target)), AUTH_RATE_LIMITS.sendDomain);
}

async function enforceVerifyCodeRateLimits(req, target) {
  await consumeSecurityRateLimit('verify-code-ip', getClientIpHash(req), AUTH_RATE_LIMITS.verifyIp);
  await consumeSecurityRateLimit('verify-code-target', hashValue(target), AUTH_RATE_LIMITS.verifyTarget);
}

async function enforceSignupRateLimits(req, target) {
  await consumeSecurityRateLimit('signup-global', 'global', AUTH_RATE_LIMITS.signupGlobal);
  await consumeSecurityRateLimit('signup-ip', getClientIpHash(req), AUTH_RATE_LIMITS.signupIp);
  await consumeSecurityRateLimit('signup-domain', hashValue(emailDomain(target)), AUTH_RATE_LIMITS.signupDomain);
}

function summarizeViewer(req, res) {
  const guestId = ensureGuestId(req, res);
  const guestUsage = getGuestUsage(guestId);
  const guestIpUsage = req.auth.user ? null : getGuestIpUsage(req, { legacyGuestUsage: guestUsage });
  const guestRemaining = req.auth.user ? guestRemainingPower(guestUsage) : guestIpRemainingPower(guestIpUsage);
  return {
    authenticated: !!req.auth.user,
    user: serializeUser(req.auth.user),
    guest: {
      usedCount: Number(guestUsage?.usedCount || 0),
      usedPower: Math.max(0, GUEST_FREE_TRIAL_LIMIT - guestRemaining),
      remainingCount: guestRemaining,
      remainingPower: guestRemaining,
      trialPowerLimit: GUEST_FREE_TRIAL_LIMIT
    },
    auth: {
      channels: getAvailableAuthChannels(),
      canUseEmail: isEmailChannelEnabled(),
      canUseSms: false,
      verificationMode: 'live'
    }
  };
}

function createLedgerEntry({ userId, type, delta, balanceAfter, tokenCount = 0, tokenEstimated = false, apiType = '', requestId = '', note = '' }) {
  const entry = {
    id: randomId('ledger'),
    userId,
    type,
    delta,
    balanceAfter,
    tokenCount,
    tokenEstimated,
    apiType,
    requestId,
    note,
    createdAt: nowIso()
  };
  state.powerLedger.push(entry);
  return entry;
}

function grantSignupBonus(user, bonusAmount = 200) {
  if (user.signupBonusGrantedAt) return 0;
  const delta = Math.max(0, Math.round(Number(bonusAmount || 0)));
  user.powerBalance = Number(user.powerBalance || 0) + delta;
  user.signupBonusGrantedAt = nowIso();
  createLedgerEntry({
    userId: user.id,
    type: 'signup_bonus',
    delta,
    balanceAfter: user.powerBalance,
    note: `新用户注册赠送 ${delta} 算力`
  });
  return delta;
}

function ensurePower(user, apiType, text) {
  if (isAdminUser(user)) return;
  const needed = estimateMinimumPower(apiType, text);
  if (Number(user.powerBalance || 0) < needed) {
    const error = new Error('算力不足，请先充值后继续使用');
    error.status = 402;
    error.failureCode = 'INSUFFICIENT_POWER';
    error.balance = Number(user.powerBalance || 0);
    error.minimumRequired = needed;
    throw error;
  }
}

function applyPowerConsumption(user, usageTracker, requestId, note = '') {
  if (isAdminUser(user)) return null;
  const tokens = usageTracker?.totalTokens || 0;
  if (!tokens) return null;
  const delta = -powerCostFromTokens(tokens);
  if ((Number(user.powerBalance || 0) + delta) < 0) {
    const error = new Error('算力不足，请先充值后继续使用');
    error.status = 402;
    error.failureCode = 'INSUFFICIENT_POWER';
    error.balance = Number(user.powerBalance || 0);
    error.minimumRequired = Math.abs(delta);
    throw error;
  }
  user.powerBalance = Number(user.powerBalance || 0) + delta;
  const entry = createLedgerEntry({
    userId: user.id,
    type: 'consume',
    delta,
    balanceAfter: user.powerBalance,
    tokenCount: tokens,
    tokenEstimated: !!usageTracker?.estimated,
    apiType: usageTracker?.apiType || '',
    requestId,
    note
  });
  saveState();
  return entry;
}

function grantManualPower(user, amount, requestId, note = '') {
  const delta = Math.round(Number(amount || 0));
  if (!Number.isFinite(delta) || delta === 0) {
    const error = new Error('请输入非 0 的算力调整数量');
    error.status = 400;
    throw error;
  }
  user.powerBalance = Number(user.powerBalance || 0) + delta;
  createLedgerEntry({
    userId: user.id,
    type: 'manual_recharge',
    delta,
    balanceAfter: user.powerBalance,
    apiType: delta > 0 ? '\u4eba\u5de5\u6838\u5bf9\u8f6c\u8d26\u540e\u589e\u52a0\u7b97\u529b' : '\u7ba1\u7406\u5458\u624b\u52a8\u6263\u51cf\u7b97\u529b',
    requestId,
    note
  });
  saveState();
  return serializeAdminUser(user);
}

function listUserLedger(userId) {
  return state.powerLedger.filter((item) => item.userId === userId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function parseSmtpResponse(buffer) {
  const lines = String(buffer || '').split('\r\n').filter(Boolean);
  if (!lines.length) return null;
  const last = lines[lines.length - 1];
  const match = last.match(/^(\d{3})([ -])(.*)$/);
  if (!match) return null;
  return match[2] === ' ' ? { code: Number(match[1]), lines } : null;
}

function waitForSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const parsed = parseSmtpResponse(buffer);
      if (!parsed) return;
      cleanup();
      resolve(parsed);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function sendSmtpCommand(socket, command, expectedCodes) {
  if (command) socket.write(`${command}\r\n`);
  const response = await waitForSmtpResponse(socket);
  if (!expectedCodes.includes(response.code)) {
    const error = new Error(`SMTP command failed: ${response.code}`);
    error.status = 502;
    throw error;
  }
  return response;
}

function wrapSocketWithTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername: host }, () => resolve(secureSocket));
    secureSocket.once('error', reject);
  });
}

async function sendVerificationEmail(target, code) {
  const host = process.env.SMTP_HOST || '';
  const port = Number(process.env.SMTP_PORT || (process.env.SMTP_SECURE === 'true' ? 465 : 587));
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.SMTP_FROM || user;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  if (!host || !from) {
    const error = new Error('\u90ae\u7bb1\u9a8c\u8bc1\u7801\u672a\u914d\u7f6e SMTP \u670d\u52a1');
    error.status = 503;
    throw error;
  }

  let socket = secure ? tls.connect({ host, port, servername: host }) : net.createConnection({ host, port });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  try {
    await sendSmtpCommand(socket, '', [220]);
    await sendSmtpCommand(socket, `EHLO ${process.env.SMTP_CLIENT_NAME || 'localhost'}`, [250]);
    if (!secure) {
      await sendSmtpCommand(socket, 'STARTTLS', [220]);
      socket = await wrapSocketWithTls(socket, host);
      await sendSmtpCommand(socket, `EHLO ${process.env.SMTP_CLIENT_NAME || 'localhost'}`, [250]);
    }
    if (user && pass) {
      await sendSmtpCommand(socket, 'AUTH LOGIN', [334]);
      await sendSmtpCommand(socket, Buffer.from(user).toString('base64'), [334]);
      await sendSmtpCommand(socket, Buffer.from(pass).toString('base64'), [235]);
    }
    await sendSmtpCommand(socket, `MAIL FROM:<${from}>`, [250]);
    await sendSmtpCommand(socket, `RCPT TO:<${target}>`, [250, 251]);
    await sendSmtpCommand(socket, 'DATA', [354]);
    const body = [
      `From: ${from}`,
      `To: ${target}`,
      'Subject: =?UTF-8?B?5L2g5YOPQUnlkJcg55m75b2V6aqM6K+B56CB?=',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      `\u4f60\u7684\u9a8c\u8bc1\u7801\u662f\uff1a${code}`,
      `\u9a8c\u8bc1\u7801 ${VERIFY_CODE_TTL_MINUTES} \u5206\u949f\u5185\u6709\u6548\uff0c\u8bf7\u52ff\u6cc4\u9732\u7ed9\u4ed6\u4eba\u3002`
    ].join('\r\n');
    socket.write(`${body}\r\n.\r\n`);
    await sendSmtpCommand(socket, '', [250]);
    await sendSmtpCommand(socket, 'QUIT', [221]);
  } finally {
    socket.end();
  }
}

async function dispatchVerificationCode(channel, target, code) {
  if (channel === 'email') return sendVerificationEmail(target, code);
  const error = new Error('\u4ec5\u652f\u6301\u90ae\u7bb1\u9a8c\u8bc1\u7801\u767b\u5f55');
  error.status = 400;
  throw error;
}

function ensureVerificationChannelEnabled(channel) {
  if (channel !== 'email') {
    const error = new Error('\u4ec5\u652f\u6301\u90ae\u7bb1\u9a8c\u8bc1\u7801\u767b\u5f55');
    error.status = 400;
    throw error;
  }
  if (!isEmailChannelEnabled()) {
    const error = new Error('\u5f53\u524d\u672a\u914d\u7f6e SMTP\uff0c\u6682\u65f6\u65e0\u6cd5\u53d1\u9001\u90ae\u7bb1\u9a8c\u8bc1\u7801');
    error.status = 503;
    throw error;
  }
}

function createVerificationCode(target, channel) {
  pruneExpiredVerificationCodes();
  const now = Date.now();
  const recentCodes = state.verificationCodes.filter((item) => item.target === target && item.channel === channel);
  const latest = recentCodes.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (latest) {
    const latestAt = new Date(latest.createdAt).getTime();
    if (Number.isFinite(latestAt) && (now - latestAt) < VERIFY_CODE_COOLDOWN_MS) {
      const error = new Error('\u9a8c\u8bc1\u7801\u53d1\u9001\u8fc7\u4e8e\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5');
      error.status = 429;
      throw error;
    }
  }
  const recentHourCount = recentCodes.filter((item) => now - new Date(item.createdAt).getTime() < 60 * 60 * 1000).length;
  if (recentHourCount >= VERIFY_CODE_HOURLY_LIMIT) {
    const error = new Error('\u5f53\u524d\u90ae\u7bb1\u53d1\u9001\u9a8c\u8bc1\u7801\u6b21\u6570\u8fc7\u591a\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5');
    error.status = 429;
    throw error;
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const codeSalt = crypto.randomBytes(16).toString('hex');
  state.verificationCodes.push({
    id: randomId('code'),
    target,
    channel,
    codeSalt,
    codeHash: hashValue(`${codeSalt}:${target}:${channel}:${code}`),
    expiresAt: new Date(now + VERIFY_CODE_TTL_MS).toISOString(),
    consumedAt: '',
    lockedAt: '',
    attemptCount: 0,
    createdAt: nowIso()
  });
  saveState();
  return code;
}

async function recordVerificationAttempt(record) {
  if (!IS_CLOUDFLARE_WORKER) return Number(record.attemptCount || 0) + 1;
  const db = getCloudStateDb();
  if (!db) throw new Error('Cloud verification attempt storage is unavailable');
  await ensureCloudStateSchema(db);
  const id = `verify_${hashValue(record.id)}`;
  const updatedAt = nowIso();
  const row = await db.prepare(
    `INSERT INTO security_rate_limits (id, count, expires_at, updated_at) VALUES (?, 1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET count = security_rate_limits.count + 1, updated_at = excluded.updated_at
     RETURNING count`
  ).bind(id, record.expiresAt, updatedAt).first();
  return Number(row?.count || 1);
}

async function verifyCode(target, channel, code) {
  pruneExpiredVerificationCodes();
  const now = Date.now();
  const candidates = state.verificationCodes.filter((item) => item.target === target && item.channel === channel && !item.consumedAt && !item.lockedAt).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const record = candidates[0];
  if (!record) {
    const error = new Error('验证码不存在或已失效');
    error.status = 400;
    throw error;
  }
  if (new Date(record.expiresAt).getTime() < now) {
    const error = new Error('验证码已过期，请重新获取');
    error.status = 400;
    throw error;
  }
  const attemptCount = await recordVerificationAttempt(record);
  record.attemptCount = Math.max(Number(record.attemptCount || 0) + 1, attemptCount);
  if (record.attemptCount > VERIFY_CODE_MAX_ATTEMPTS) {
    record.lockedAt = record.lockedAt || nowIso();
    saveState();
    const error = new Error('验证码尝试次数过多，请重新获取');
    error.status = 429;
    error.failureCode = 'VERIFY_CODE_LOCKED';
    throw error;
  }
  const candidateHash = hashValue(`${record.codeSalt || ''}:${target}:${channel}:${String(code || '').trim()}`);
  const storedBuffer = Buffer.from(String(record.codeHash || ''), 'hex');
  const candidateBuffer = Buffer.from(candidateHash, 'hex');
  const matches = storedBuffer.length === candidateBuffer.length && storedBuffer.length > 0
    && crypto.timingSafeEqual(storedBuffer, candidateBuffer);
  if (!matches) {
    if (record.attemptCount >= VERIFY_CODE_MAX_ATTEMPTS) record.lockedAt = nowIso();
    saveState();
    const error = new Error(record.lockedAt ? '验证码尝试次数过多，请重新获取' : '验证码错误，请重新输入');
    error.status = record.lockedAt ? 429 : 400;
    error.failureCode = record.lockedAt ? 'VERIFY_CODE_LOCKED' : 'VERIFY_CODE_INVALID';
    throw error;
  }
  record.consumedAt = nowIso();
  saveState();
  return record;
}

function upsertUserAfterVerification(channel, target, options = {}) {
  let user = findUserByTarget(channel, target);
  const isNew = !user;
  if (!user) {
    user = {
      id: randomId('user'),
      email: channel === 'email' ? target : '',
      phone: '',
      displayName: pickDisplayName({ email: channel === 'email' ? target : '' }),
      powerBalance: 0,
      role: 'user',
      signupBonusGrantedAt: '',
      createdAt: nowIso(),
      lastLoginAt: nowIso()
    };
    state.users.push(user);
  } else {
    if (channel === 'email') user.email = target;
    if (!user.displayName) user.displayName = pickDisplayName(user);
    user.lastLoginAt = nowIso();
  }
  user.role = isAdminEmail(user.email) ? 'admin' : 'user';
  const signupBonusGranted = isNew ? grantSignupBonus(user, options.signupBonusAmount ?? 200) : 0;
  saveState();
  return { user, isNew, signupBonusGranted };
}

function attachAuth(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  req.auth = { user: null, session: null };
  const sessionId = req.cookies.session_id;
  if (sessionId) {
    const match = getSession(sessionId);
    if (match) req.auth = match;
    else clearCookie(res, 'session_id');
  }
  next();
}

async function attachCloudState(req, res, next) {
  if (!IS_CLOUDFLARE_WORKER) return next();
  cloudStateIoEnabled = true;
  let loadedState;
  try {
    loadedState = await loadCloudState();
  } catch (error) {
    console.error('[cloud-state-load-error]', error?.message || error);
    return res.status(500).json({ message: '云端状态存储暂时不可用，请稍后重试', failureCode: 'CLOUD_STATE_UNAVAILABLE' });
  }

  const context = {
    state: normalizeStateShape(loadedState),
    baseline: normalizeStateShape(JSON.parse(JSON.stringify(loadedState))),
    dirty: false
  };
  return requestStateStorage.run(context, () => {
    try {
      markInterruptedRewriteTasks();
      pruneRewriteTasks();
      pruneExpiredGuestIpUsages();
      ensureBootstrapAdmin();
    } catch (error) {
      return next(error);
    }

    const originalEnd = res.end;
    res.end = function endWithCloudStateFlush(...args) {
      if (!context.dirty) return originalEnd.apply(this, args);
      flushCloudState(context)
        .then(() => originalEnd.apply(res, args))
        .catch((error) => {
          console.error('[cloud-state-save-error]', error?.message || error);
          originalEnd.apply(res, args);
        });
      return res;
    };

    return next();
  });
}

app.use(attachCloudState);
app.use(attachAuth);

function requireLogin(req) {
  if (!req.auth.user) {
    const error = new Error('请先登录后继续使用');
    error.status = 401;
    error.failureCode = 'LOGIN_REQUIRED';
    throw error;
  }
}

function requireAdmin(req) {
  requireLogin(req);
  if (!isAdminUser(req.auth.user)) {
    const error = new Error('该功能仅管理员可用');
    error.status = 403;
    error.failureCode = 'ADMIN_REQUIRED';
    throw error;
  }
}

function attachPowerMeta(responseBody, user, usageTracker) {
  if (!user) return responseBody;
  return {
    ...responseBody,
    account: {
      powerBalance: Number(user.powerBalance || 0),
      usage: summarizeUsage(usageTracker)
    }
  };
}

const runningRewriteTasks = new Set();

function findUserById(userId) {
  return state.users.find((item) => item.id === userId) || null;
}

function taskOwnerKey(ownerType, ownerId) {
  return `${ownerType}:${ownerId}`;
}

function getRewriteTaskOwner(req, res) {
  if (req.auth.user) return { ownerType: 'user', ownerId: req.auth.user.id };
  const guestId = ensureGuestId(req, res);
  const guestUsage = getGuestUsage(guestId);
  getGuestIpUsage(req, { legacyGuestUsage: guestUsage });
  return { ownerType: 'guest', ownerId: guestId };
}

function isRewriteTaskTerminal(status) {
  return ['completed', 'failed', 'interrupted'].includes(status);
}

function findRewriteTask(taskId) {
  return state.rewriteTasks.find((item) => item.id === taskId) || null;
}

function assertRewriteTaskOwner(task, owner) {
  if (!task || task.ownerType !== owner.ownerType || task.ownerId !== owner.ownerId) {
    const error = new Error('任务不存在或已过期');
    error.status = 404;
    error.failureCode = 'TASK_NOT_FOUND';
    throw error;
  }
}

function updateRewriteTask(task, patch = {}) {
  Object.assign(task, patch, { updatedAt: nowIso() });
  saveState();
  return task;
}

function dismissRewriteTasksForOwner(owner) {
  const dismissedAt = nowIso();
  let dismissedCount = 0;
  for (const task of state.rewriteTasks) {
    if (task.ownerType !== owner.ownerType || task.ownerId !== owner.ownerId || task.dismissedAt) continue;
    task.dismissedAt = dismissedAt;
    task.updatedAt = dismissedAt;
    dismissedCount += 1;
  }
  if (dismissedCount) saveState();
  return dismissedCount;
}

function pruneRewriteTasks() {
  const now = Date.now();
  const before = state.rewriteTasks.length;
  state.rewriteTasks = state.rewriteTasks.filter((task) => {
    const expiresAt = new Date(task.expiresAt || 0).getTime();
    return Number.isFinite(expiresAt) && expiresAt > now;
  });

  const grouped = new Map();
  for (const task of state.rewriteTasks) {
    const key = taskOwnerKey(task.ownerType, task.ownerId);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(task);
  }
  const kept = new Set();
  for (const tasks of grouped.values()) {
    tasks
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())
      .slice(0, REWRITE_TASK_MAX_PER_OWNER)
      .forEach((task) => kept.add(task.id));
  }
  state.rewriteTasks = state.rewriteTasks.filter((task) => kept.has(task.id));
  if (state.rewriteTasks.length !== before) saveState();
}

function markInterruptedRewriteTasks({ force = false } = {}) {
  let changed = false;
  const now = Date.now();
  for (const task of state.rewriteTasks) {
    if (isRewriteTaskTerminal(task.status)) continue;
    const updatedAt = new Date(task.updatedAt || task.createdAt || 0).getTime();
    const stale = !Number.isFinite(updatedAt) || (now - updatedAt) > REWRITE_TASK_INTERRUPTED_AFTER_MS;
    if (!force && !stale) continue;
    task.status = 'interrupted';
    task.phase = 'done';
    task.error = { message: '服务重启或任务中断，请重新发起', failureCode: 'TASK_INTERRUPTED' };
    task.finishedAt = nowIso();
    task.updatedAt = nowIso();
    changed = true;
  }
  if (changed) saveState();
}

function buildRewriteTask({ ownerType, ownerId, req, text, genre, context, autoRewrite }) {
  const createdAt = nowIso();
  return {
    id: randomId('task'),
    ownerType,
    ownerId,
    type: 'detect_rewrite',
    status: 'queued',
    phase: 'detect',
    inputText: text,
    inputHash: hashText(text),
    textLength: countCjk(text),
    genre: signalScoring.normalizeGenreGuess(genre),
    context: normalizeRewriteContext(context || {}),
    autoRewrite: autoRewrite !== false,
    detectResult: null,
    rewriteResult: null,
    error: null,
    usage: { detect: null, rewrite: null },
    billing: {
      detectChargedAt: null,
      detectLedgerEntryId: null,
      rewriteChargedAt: null,
      rewriteLedgerEntryId: null,
      rewriteAttempt: 0,
      guestDetectConsumedAt: null,
      guestRewriteConsumedAt: null
    },
    requestMeta: {
      ipHash: getClientIpHash(req),
      userAgentHash: hashValue(req.headers['user-agent'] || '')
    },
    dismissedAt: '',
    createdAt,
    updatedAt: createdAt,
    finishedAt: null,
    expiresAt: new Date(Date.now() + REWRITE_TASK_TTL_MS).toISOString()
  };
}

function serializeRewriteTask(task, user = null) {
  if (!task) return null;
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    phase: task.phase,
    inputText: task.inputText,
    textLength: task.textLength,
    genre: task.genre,
    context: task.context || {},
    autoRewrite: task.autoRewrite !== false,
    detectResult: task.detectResult || null,
    rewriteResult: task.rewriteResult || null,
    error: task.error || null,
    usage: task.usage || {},
    billing: {
      detectCharged: !!task.billing?.detectChargedAt || !!task.billing?.guestDetectConsumedAt,
      rewriteCharged: !!task.billing?.rewriteChargedAt || !!task.billing?.guestRewriteConsumedAt,
      rewriteAttempt: Number(task.billing?.rewriteAttempt || 0)
    },
    account: user ? { powerBalance: Number(user.powerBalance || 0) } : null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    finishedAt: task.finishedAt,
    expiresAt: task.expiresAt
  };
}

function selectActiveRewriteTask(owner) {
  pruneRewriteTasks();
  const owned = state.rewriteTasks
    .filter((task) => task.ownerType === owner.ownerType && task.ownerId === owner.ownerId && !task.dismissedAt)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
  return owned.find((task) => !isRewriteTaskTerminal(task.status)) || owned[0] || null;
}

function serializeTaskError(error, fallbackMessage) {
  if (error?.failureCode === 'INSUFFICIENT_POWER') {
    return {
      message: error.message,
      failureCode: 'INSUFFICIENT_POWER',
      balance: error.balance,
      minimumRequired: error.minimumRequired
    };
  }
  if (error?.failureCode) return { message: error.message || fallbackMessage, failureCode: error.failureCode };
  if (error?.name === 'AbortError') return { message: fallbackMessage, failureCode: 'UPSTREAM_TIMEOUT' };
  if (error?.status === 401 || error?.status === 403) return { message: '模型服务认证失败，请联系管理员', failureCode: 'UPSTREAM_AUTH' };
  if (error?.status >= 500 || error?.status === 429) return { message: '模型服务暂时不可用，请稍后重试', failureCode: 'UPSTREAM_UNAVAILABLE' };
  return { message: error?.message || fallbackMessage, failureCode: 'UPSTREAM_ERROR' };
}

function sendTaskHttpError(res, error, fallbackMessage = '任务处理失败') {
  const body = serializeTaskError(error, fallbackMessage);
  return res.status(error?.status || (body.failureCode === 'INSUFFICIENT_POWER' ? 402 : 500)).json(body);
}

function consumeGuestDetectForTask(task, record, ipRecord, usageTracker = null) {
  if (task.billing?.guestDetectConsumedAt) return;
  const text = task.inputText || '';
  if (!ipRecord) ensureGuestPower(record, text);
  const cost = ipRecord
    ? consumeGuestIpPower(ipRecord, text, usageTracker)
    : Math.min(guestRemainingPower(record), guestDetectCost(text, usageTracker));
  if (record) {
    const previousUsedPower = guestUsedPower(record);
    record.usedCount = Number(record.usedCount || 0) + 1;
    record.usedPower = Math.min(GUEST_FREE_TRIAL_LIMIT, previousUsedPower + cost);
    record.firstUsedAt = record.firstUsedAt || nowIso();
    record.lastUsedAt = nowIso();
    record.ipHash = task.requestMeta?.ipHash || record.ipHash || '';
    record.userAgentHash = task.requestMeta?.userAgentHash || record.userAgentHash || '';
    record.pendingRewriteHash = task.inputHash;
    record.pendingRewriteExpiresAt = new Date(Date.now() + GUEST_REWRITE_WINDOW_MS).toISOString();
  }
  task.billing.guestDetectConsumedAt = nowIso();
}

function consumeGuestRewriteForTask(task, record) {
  if (task.billing?.guestRewriteConsumedAt) return;
  if (!record) return;
  if (record.pendingRewriteHash && record.pendingRewriteHash !== task.inputHash) {
    const error = new Error('免费试用已结束，请登录后继续改写');
    error.status = 401;
    error.failureCode = 'LOGIN_REQUIRED';
    throw error;
  }
  record.lastRewriteAt = nowIso();
  task.billing.guestRewriteConsumedAt = nowIso();
}

function chargeTaskStageOnce(task, stage, user, guestUsage, usageTracker, note = '', guestIpUsage = null) {
  task.billing = task.billing || {};
  if (stage === 'detect') {
    if (task.billing.detectChargedAt || task.billing.guestDetectConsumedAt) return null;
    let entry = null;
    if (user) entry = applyPowerConsumption(user, usageTracker, `${task.id}:detect`, note);
    else consumeGuestDetectForTask(task, guestUsage, guestIpUsage, usageTracker);
    task.billing.detectChargedAt = nowIso();
    task.billing.detectLedgerEntryId = entry?.id || '';
    task.usage = { ...(task.usage || {}), detect: summarizeUsage(usageTracker) };
    saveState();
    return entry;
  }

  const attempt = Number(task.billing.rewriteAttempt || 0);
  if (task.billing.rewriteChargedAt || task.billing.guestRewriteConsumedAt) return null;
  let entry = null;
  if (user) entry = applyPowerConsumption(user, usageTracker, `${task.id}:rewrite:${attempt}`, note);
  else consumeGuestRewriteForTask(task, guestUsage);
  task.billing.rewriteChargedAt = nowIso();
  task.billing.rewriteLedgerEntryId = entry?.id || '';
  task.usage = { ...(task.usage || {}), rewrite: summarizeUsage(usageTracker) };
  saveState();
  return entry;
}

async function buildDetectResultPayload(text, genre, usageTracker) {
  const start = Date.now();
  const detected = await detectByProvider(text, usageTracker, { genre });
  const suspiciousSegments = findSuspiciousSegments(text);
  return {
    probability: detected.probability,
    riskLevel: riskLevel(detected.probability),
    reasons: detected.reasons,
    diagnostics: detected.diagnostics || [],
    studentEssayGenre: detected.studentEssayGenre || studentEssayHumanizer.inferStudentEssayGenre(text, detected.diagnostics || [], detected),
    studentEssayRuleHits: detected.studentEssayRuleHits || [],
    rhythm: detected.rhythm || analyzeRhythm(text),
    profile: detected.profile || textMetrics.detectTextProfile(text),
    dimensionScores: detected.dimensionScores || {},
    dimensionWeights: detected.dimensionWeights || signalScoring.BASE_WEIGHTS,
    informationDensity: detected.informationDensity || textMetrics.analyzeInformationDensity(text),
    formattingSignals: detected.formattingSignals || textMetrics.analyzeFormattingSignals(text),
    scoreBreakdown: detected.scoreBreakdown,
    rewrites: [],
    rewriteStats: [],
    suspiciousSegments: suspiciousSegments.map((item) => ({ label: item.label, content: item.content, reasons: item.reasons, categories: item.categories || [] })),
    needsRewrite: detected.probability >= REWRITE_TRIGGER_THRESHOLD,
    textLength: countCjk(text),
    detectDurationMs: Date.now() - start,
    thresholds: { rewriteAt: REWRITE_TRIGGER_THRESHOLD }
  };
}

function getTaskRuntimeActors(task) {
  const user = task.ownerType === 'user' ? findUserById(task.ownerId) : null;
  const guestUsage = task.ownerType === 'guest' ? getGuestUsage(task.ownerId) : null;
  const guestIpUsage = task.ownerType === 'guest' ? findGuestIpUsageByHash(task.requestMeta?.ipHash) : null;
  return { user, guestUsage, guestIpUsage };
}

async function runRewriteStage(taskId) {
  const task = findRewriteTask(taskId);
  if (!task || task.status === 'completed') return;
  const { user, guestUsage, guestIpUsage } = getTaskRuntimeActors(task);
  if (task.ownerType === 'user' && !user) {
    const error = new Error('账号不存在，请重新登录后再试');
    error.status = 401;
    error.failureCode = 'LOGIN_REQUIRED';
    throw error;
  }
  if (user) ensurePower(user, 'rewrite', task.inputText);

  updateRewriteTask(task, { status: 'rewriting', phase: 'rewrite', error: null });
  const usageTracker = createUsageTracker('rewrite');
  const result = await rewriteByProvider(task.inputText, usageTracker, task.context || {}, { originalAnalysis: task.detectResult });
  chargeTaskStageOnce(task, 'rewrite', user, guestUsage, usageTracker, '文本改写', guestIpUsage);
  const rewriteResult = attachPowerMeta(result, user, usageTracker);
  updateRewriteTask(task, {
    status: 'completed',
    phase: 'done',
    rewriteResult,
    finishedAt: nowIso(),
    error: null
  });
}

async function runRewriteTask(taskId) {
  const task = findRewriteTask(taskId);
  if (!task || isRewriteTaskTerminal(task.status)) return;
  const { user, guestUsage, guestIpUsage } = getTaskRuntimeActors(task);
  if (task.ownerType === 'user' && !user) {
    const error = new Error('账号不存在，请重新登录后再试');
    error.status = 401;
    error.failureCode = 'LOGIN_REQUIRED';
    throw error;
  }
  if (user) ensurePower(user, 'detect', task.inputText);

  updateRewriteTask(task, { status: 'detecting', phase: 'detect', error: null });
  const usageTracker = createUsageTracker('detect');
  const detectResultBase = await buildDetectResultPayload(task.inputText, task.genre, usageTracker);
  chargeTaskStageOnce(task, 'detect', user, guestUsage, usageTracker, '文本检测', guestIpUsage);
  const detectResult = attachPowerMeta({
    ...detectResultBase,
    guestTrialConsumed: task.ownerType === 'guest'
  }, user, usageTracker);
  updateRewriteTask(task, {
    status: detectResult.needsRewrite && task.autoRewrite !== false ? 'detected' : 'completed',
    phase: detectResult.needsRewrite && task.autoRewrite !== false ? 'rewrite' : 'done',
    detectResult,
    finishedAt: detectResult.needsRewrite && task.autoRewrite !== false ? null : nowIso()
  });

  if (detectResult.needsRewrite && task.autoRewrite !== false) {
    await runRewriteStage(task.id);
  }
}

function startRewriteTaskRunner(taskId, mode = 'full') {
  if (runningRewriteTasks.has(taskId)) return;
  runningRewriteTasks.add(taskId);
  setImmediate(async () => {
    const task = findRewriteTask(taskId);
    try {
      if (mode === 'rewrite') await runRewriteStage(taskId);
      else await runRewriteTask(taskId);
    } catch (error) {
      const current = findRewriteTask(taskId);
      if (current) {
        const fallbackMessage = current.phase === 'rewrite' ? '改写生成失败，请稍后重试' : '检测失败，请稍后重试';
        updateRewriteTask(current, {
          status: 'failed',
          phase: 'done',
          error: serializeTaskError(error, fallbackMessage),
          finishedAt: nowIso()
        });
      }
      console.error('[rewrite-task-error]', taskId, error?.status || '', error?.message || error);
    } finally {
      runningRewriteTasks.delete(taskId);
    }
  });
}

if (!IS_CLOUDFLARE_WORKER) {
  markInterruptedRewriteTasks({ force: true });
  pruneRewriteTasks();
  pruneExpiredGuestIpUsages();
  ensureBootstrapAdmin();
}

function v1Success(req, res, data, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    error: null,
    requestId: req.requestId || randomId('req')
  });
}

function v1Error(req, res, status, code, message, details = null) {
  return res.status(status).json({
    success: false,
    data: null,
    error: { code, message, details },
    requestId: req.requestId || randomId('req')
  });
}

function currentStudentId(req, res) {
  if (req.auth.user) return req.auth.user.id;
  return ensureGuestId(req, res);
}

function normalizeEssayMode(mode) {
  const raw = String(mode || '').trim();
  return raw === 'revise' ? 'revise' : 'brainstorm';
}

function createEssaySession(req, res) {
  const now = nowIso();
  const session = {
    id: randomId('essay_session'),
    sessionId: '',
    userId: currentStudentId(req, res),
    mode: normalizeEssayMode(req.body?.mode),
    title: String(req.body?.title || '').trim().slice(0, 120),
    genre: String(req.body?.genre || '').trim().slice(0, 30),
    grade: String(req.body?.grade || '').trim().slice(0, 30),
    draftText: String(req.body?.draftText || '').trim().slice(0, MAX_CHARS),
    status: 'created',
    selectedAngle: '',
    materials: [],
    topicAnalysis: null,
    outline: null,
    createdAt: now,
    updatedAt: now
  };
  session.sessionId = session.id;
  state.essaySessions.push(session);
  saveState();
  return session;
}

function findEssaySession(sessionId) {
  return state.essaySessions.find((item) => item.id === sessionId || item.sessionId === sessionId) || null;
}

function assertEssaySession(sessionId) {
  const session = findEssaySession(sessionId);
  if (!session) {
    const error = new Error('作文会话不存在');
    error.status = 404;
    error.failureCode = 'SESSION_NOT_FOUND';
    throw error;
  }
  return session;
}

function touchEssaySession(session, patch = {}) {
  Object.assign(session, patch, { updatedAt: nowIso() });
  saveState();
  return session;
}

function findEssayDiagnostic(diagnosticId) {
  return state.essayDiagnostics.find((item) => item.id === diagnosticId || item.diagnosticId === diagnosticId) || null;
}

function serializeEssaySession(session) {
  const diagnostics = state.essayDiagnostics.filter((item) => item.sessionId === session.id);
  const reflections = state.essayReflections.filter((item) => item.sessionId === session.id);
  const guides = (state.essayGuides || []).filter((item) => item.sessionId === session.id);
  return {
    sessionId: session.id,
    userId: session.userId,
    mode: session.mode,
    title: session.title,
    genre: session.genre,
    grade: session.grade,
    status: session.status,
    draftText: session.draftText,
    topicAnalysis: session.topicAnalysis,
    materials: session.materials || [],
    outline: session.outline,
    latestGuide: guides.at(-1) || session.guidedWriting || null,
    latestDiagnostic: diagnostics.at(-1) || null,
    latestReflection: reflections.at(-1) || null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

function notImplementedData(moduleName) {
  return {
    status: 'reserved',
    module: moduleName,
    message: '长期能力提升模块已预留接口，当前版本先返回可供前端联调的占位结构。'
  };
}

function dashboardSnapshot(req, res) {
  const userId = currentStudentId(req, res);
  const recentEssays = state.essaySessions
    .filter((item) => item.userId === userId)
    .slice(-5)
    .reverse()
    .map((item) => ({
      sessionId: item.id,
      title: item.title,
      mode: item.mode,
      status: item.status,
      updatedAt: item.updatedAt
    }));
  const activePlan = state.trainingPlans.find((item) => item.userId === userId && item.status === '进行中') || null;
  return {
    todayTasks: essayGuidance.todayTasks().tasks,
    activePlan,
    abilityProfile: state.abilityProfiles.find((item) => item.userId === userId) || notImplementedData('abilityProfile'),
    recentEssays,
    commonIssues: state.errorNotebookItems.slice(-5).reverse()
  };
}

function essayGuidanceSystemPrompt() {
  return [
    '你是面向初高中学生的作文指导老师，只输出 JSON。',
    '你的任务是给当前这一篇作文提供短期指导：审题、追问素材、提纲、体检、局部修改建议和复盘。',
    '不替学生生成完整作文，不提供整篇范文，不承诺考试精确评分。',
    '不编造学生没有提供的时间、人物、地点、动作、对话、感官细节或心理感受。',
    '示例改法只能作为局部参考，必须提醒学生确认事实是否真实。',
    '语言要适合学生和家长理解，具体、克制、可执行。'
  ].join('\n');
}

function essayGuidanceTaskPrompt(taskName, input, outputContract) {
  return [
    `任务：${taskName}`,
    '',
    '请根据输入生成作文指导结果。',
    '只输出 JSON，不要输出 Markdown，不要解释 JSON 外的内容。',
    '必须遵守：不替学生生成完整作文；不编造事实；优先追问真实素材；只做指导、诊断和局部建议。',
    '',
    `输出 JSON 字段要求：${outputContract}`,
    '',
    `输入：${JSON.stringify(input, null, 2)}`
  ].join('\n');
}

function modelUnavailableError(message = 'DeepSeek 指导模型暂时不可用') {
  const error = new Error(message);
  error.status = 503;
  error.failureCode = 'MODEL_UNAVAILABLE';
  return error;
}

async function callEssayGuidanceModel(taskName, input, outputContract, options = {}) {
  if (!API_KEY) throw modelUnavailableError('AI_API_KEY 未配置，暂时无法生成作文指导');
  try {
    const usageTracker = createUsageTracker('essay_guidance');
    const wantsSchema = /guidedWriting/.test(String(outputContract||'')) && typeof GUIDED_WRITING_JSON_SCHEMA === 'object';
    const firstFormat = wantsSchema ? { type: 'json_schema', json_schema: { name: 'GuidedWriting', schema: GUIDED_WRITING_JSON_SCHEMA, strict: true } } : { type: 'json_object' };
    let result;
    try {
      result = await callModel({
        model: ESSAY_GUIDANCE_MODEL,
        timeoutMs: REWRITE_TIMEOUT_MS,
        usageTracker,
        maxTokens: options.maxTokens || 2600,
        systemPrompt: essayGuidanceSystemPrompt(),
        userPrompt: essayGuidanceTaskPrompt(taskName, input, outputContract),
        responseFormat: firstFormat
      });
    } catch (e1) {
      const msg = String(e1 && (e1.message||e1.name) || '');
      const shouldRetry = /response_format|json_schema|unsupported|MODEL_JSON_PARSE|Invalid JSON/i.test(msg);
      if (shouldRetry) {
        result = await callModel({
          model: ESSAY_GUIDANCE_MODEL,
          timeoutMs: REWRITE_TIMEOUT_MS,
          usageTracker,
          maxTokens: options.maxTokens || 2600,
          systemPrompt: essayGuidanceSystemPrompt(),
          userPrompt: essayGuidanceTaskPrompt(taskName, input, outputContract),
          responseFormat: { type: 'json_object' }
        });
      } else { throw e1; }
    }
    return { ...result.json, modelMeta: { provider: 'deepseek', model: ESSAY_GUIDANCE_MODEL, usage: summarizeUsage(usageTracker) } };
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) throw modelUnavailableError('AI 提供商认证失败，请检查 AI_API_KEY');
    if (error?.name === 'AbortError') throw modelUnavailableError('DeepSeek 指导模型请求超时，请稍后重试');
    if (error?.failureCode === 'MODEL_JSON_PARSE') throw modelUnavailableError('DeepSeek 返回格式异常，暂时无法生成作文指导');
    if (error?.status >= 500 || error?.status === 429) throw modelUnavailableError('DeepSeek 指导模型繁忙，请稍后重试');
    throw error;
  }
}
) {
  if (!API_KEY) throw modelUnavailableError('AI_API_KEY 未配置，暂时无法生成作文指导');
  try {
    const usageTracker = createUsageTracker('essay_guidance');
    const __respFmt = (/guidedWriting/.test(String(outputContract||'')) && typeof GUIDED_WRITING_JSON_SCHEMA === 'object' ? { type: 'json_schema', json_schema: { name: 'GuidedWriting', schema: GUIDED_WRITING_JSON_SCHEMA, strict: true } } : { type: 'json_object' });
    const result = await callModel({
      model: ESSAY_GUIDANCE_MODEL,
      timeoutMs: REWRITE_TIMEOUT_MS,
      usageTracker,
      maxTokens: options.maxTokens || 2600,
      systemPrompt: essayGuidanceSystemPrompt(),
      userPrompt: essayGuidanceTaskPrompt(taskName, input, outputContract),
      responseFormat: __respFmt
    });
    return {
      ...result.json,
      modelMeta: {
        provider: 'deepseek',
        model: ESSAY_GUIDANCE_MODEL,
        usage: summarizeUsage(usageTracker)
      }
    };
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) throw modelUnavailableError('AI 提供商认证失败，请检查 AI_API_KEY');
    if (error?.name === 'AbortError') throw modelUnavailableError('DeepSeek 指导模型请求超时，请稍后重试');
    if (error?.failureCode === 'MODEL_JSON_PARSE') throw modelUnavailableError('DeepSeek 返回格式异常，暂时无法生成作文指导');
    if (error?.status >= 500 || error?.status === 429) throw modelUnavailableError('DeepSeek 指导模型繁忙，请稍后重试');
    throw error;
  }
}

function v1ModelCatch(req, res, error, fallbackCode, fallbackMessage) {
  if (error?.failureCode === 'MODEL_UNAVAILABLE') {
    return v1Error(req, res, error.status || 503, 'MODEL_UNAVAILABLE', error.message || 'DeepSeek 指导模型暂时不可用');
  }
  return v1Error(req, res, error.status || 500, error.failureCode || fallbackCode, error.message || fallbackMessage);
}

const GUIDANCE_OUTPUT_CONTRACTS = {
  topicAnalysis: 'topicKeywords:string[]; coreQuestion:string; possibleAngles:{angleId,title,prompt,materialHint}[]; riskyAngles:{title,reason}[]; suggestedNextQuestions:string[]',
  materialQuestions: 'questions:{field,question,purpose}[]; materialChecklist:{field,label,present,value,suggestion}[]; nextAction:"continue_questions"|"generate_outline"; selectedAngle:string',
  outline: 'outlines:{outlineId,title,structure,paragraphs:{role,instruction}[]}[]; recommendedOutlineId:string; warnings:string[]',
  diagnose: 'overallComment:string; dimensionScores:object; priorityIssues:{issueId,dimension,title,severity,explanation,suggestion,relatedSegmentId}[]; highlightedSegments:{segmentId,text,issueType,reason,suggestion}[]; suggestedRevisionPath:string[]',
  revision: 'issueExplanation:string; revisionStrategy:string; exampleRevision:string; studentAction:string; revisionGoal:string',
  compare: 'improvements:string[]; remainingIssues:array; changedSegments:{segmentId,text}[]; learningNotes:string[]',
  reflection: 'summary:string; learnedSkills:string[]; recurringIssues:string[]; suggestedTrainingFocus:string[]; studentSelfReflection:string; finalTextLength:number',
  styleProfile: 'summary:string; traits:string[]; strengths:string[]; habits:string[]; commonIssues:string[]; suggestions:string[]',
  guidedWriting: 'outlineTree:{title,theme,children:{nodeId,role,label,focus,children}[]};

const GUIDED_WRITING_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    outlineTree: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        theme: { type: 'string' },
        children: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { nodeId: { type: 'string' }, role: { type: 'string' }, label: { type: 'string' }, focus: { type: 'string' }, children: { type: 'array', items: { type: 'object' } } },
            required: ['role','label','children']
          }
        }
      },
      required: ['title','theme','children']
    },
    paragraphGuides: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { paragraphId: { type: 'string' }, role: { type: 'string' }, goal: { type: 'string' }, mustInclude: { type: 'array', items: { type: 'string' } }, writingPrompts: { type: 'array', items: { type: 'string' } }, starterHint: { type: 'string' }, avoid: { type: 'array', items: { type: 'string' } }, suggestedLength: { type: 'string' } },
        required: ['role','goal']
      }
    },
    missingMaterialQuestions: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, question: { type: 'string' }, purpose: { type: 'string' } }, required: ['question'] } },
    nextAction: { type: 'string', enum: ['answer_more','write_paragraph_1'] },
    studentTask: { type: 'string' }
  },
  required: ['outlineTree','paragraphGuides','missingMaterialQuestions','nextAction','studentTask']
};
 paragraphGuides:{paragraphId,role,goal,mustInclude:string[],writingPrompts:string[],starterHint,avoid:string[],suggestedLength}[]; missingMaterialQuestions:{field,question,purpose}[]; nextAction:"answer_more"|"write_paragraph_1"; studentTask:string'
};

app.get('/api/v1/me', (req, res) => {
  const viewer = summarizeViewer(req, res);
  return v1Success(req, res, {
    user: viewer.user,
    abilityProfileSummary: state.abilityProfiles.find((item) => item.userId === currentStudentId(req, res)) || null,
    activePlanSummary: state.trainingPlans.find((item) => item.userId === currentStudentId(req, res) && item.status === '进行中') || null,
    quota: viewer.quota || null,
    authenticated: viewer.authenticated
  });
});

app.get('/api/v1/dashboard', (req, res) => {
  return v1Success(req, res, dashboardSnapshot(req, res));
});

app.post('/api/v1/style-profile', async (req, res) => {
  try {
    const rawSamples = Array.isArray(req.body?.writingSamples)
      ? req.body.writingSamples.map((item) => {
        if (typeof item === 'string') return item;
        return [item?.title, item?.content || item?.text || item?.draftText].filter(Boolean).join('\n');
      }).join('\n\n')
      : String(req.body?.writingSamples || req.body?.sampleEssay || '').trim();
    const writingSamples = String(rawSamples || '').trim().slice(0, MAX_CHARS);
    if (countCjk(writingSamples) < 20) {
      return v1Error(req, res, 400, 'WRITING_SAMPLE_TOO_SHORT', '请至少输入一小段作文样本，才能生成文风档案');
    }

    const result = await callEssayGuidanceModel('交互式写作引导', input, GUIDANCE_OUTPUT_CONTRACTS.guidedWriting, { maxTokens: 3200 });
);
        result.modelMeta = { provider: 'local-fallback', reason: String(err && err.message || 'MODEL_UNAVAILABLE') };
      } else { throw err; }
    }

    const now = nowIso();
    const profile = {
      ...result,
      id: randomId('style_profile'),
      profileId: '',
      userId: currentStudentId(req, res),
      createdAt: now,
      updatedAt: now
    };
    profile.profileId = profile.id;
    if (!Array.isArray(profile.traits) || !profile.traits.length) {
      profile.traits = Array.from(new Set([
        ...((Array.isArray(profile.habits) && profile.habits) || []),
        ...((Array.isArray(profile.strengths) && profile.strengths) || [])
      ])).slice(0, 6);
    }
    state.styleProfiles = (state.styleProfiles || []).filter((item) => item.userId !== profile.userId);
    state.styleProfiles.push(profile);
    saveState();
    return v1Success(req, res, profile);
  } catch (error) {
    return v1ModelCatch(req, res, error, 'STYLE_PROFILE_FAILED', '生成文风档案失败');
  }
});

app.post('/api/v1/essay-sessions', (req, res) => {
  const mode = normalizeEssayMode(req.body?.mode);
  const title = String(req.body?.title || '').trim();
  const draftText = String(req.body?.draftText || '').trim();
  if (!title && mode === 'brainstorm') return v1Error(req, res, 400, 'TITLE_REQUIRED', '请输入作文题目');
  if (mode === 'revise' && countCjk(draftText) < 20) return v1Error(req, res, 400, 'ESSAY_TOO_SHORT', '请至少输入一小段作文草稿');
  if (countCjk(draftText) > MAX_CHARS) return v1Error(req, res, 400, 'ESSAY_TOO_LONG', '作文超过5000字限制');
  const session = createEssaySession(req, res);
  const questions = essayGuidance.buildMaterialQuestions({
    existingMaterials: {},
    missingFields: ['event', 'people', 'actions', 'feelings', 'dialogue']
  }).questions.map((item) => item.question);
  return v1Success(req, res, {
    sessionId: session.id,
    nextStep: mode === 'revise' ? 'diagnose' : 'topic_analysis',
    initialQuestions: questions,
    session: serializeEssaySession(session)
  });
});

app.get('/api/v1/essay-sessions/:sessionId', (req, res) => {
  try {
    const session = assertEssaySession(req.params.sessionId);
    return v1Success(req, res, serializeEssaySession(session));
  } catch (error) {
    return v1Error(req, res, error.status || 500, error.failureCode || 'SESSION_ERROR', error.message || '读取作文会话失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/topic-analysis', async (req, res) => {
  try {
    const session = assertEssaySession(req.params.sessionId);
    const input = {
      title: req.body?.title || session.title,
      genre: req.body?.genre || session.genre,
      grade: req.body?.grade || session.grade,
      target: req.body?.target
    };
    const result = await callEssayGuidanceModel('题目理解与立意建议', input, GUIDANCE_OUTPUT_CONTRACTS.topicAnalysis);
    touchEssaySession(session, { topicAnalysis: result, status: 'topic_analyzed' });
    return v1Success(req, res, result);
  } catch (error) {
    return v1ModelCatch(req, res, error, 'TOPIC_ANALYSIS_FAILED', '题目分析失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/material-questions', async (req, res) => {
  try {
    const session = assertEssaySession(req.params.sessionId);
    const input = {
      title: session.title,
      genre: session.genre,
      grade: session.grade,
      selectedAngle: req.body?.selectedAngle || session.selectedAngle,
      existingMaterials: req.body?.existingMaterials || session.materials,
      missingFields: req.body?.missingFields
    };
    const result = await callEssayGuidanceModel('素材追问', input, GUIDANCE_OUTPUT_CONTRACTS.materialQuestions);
    touchEssaySession(session, { selectedAngle: String(req.body?.selectedAngle || session.selectedAngle || '').trim(), status: 'collecting_materials' });
    return v1Success(req, res, result);
  } catch (error) {
    return v1ModelCatch(req, res, error, 'MATERIAL_QUESTIONS_FAILED', '素材追问失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/materials', (req, res) => {
  try {
    const session = assertEssaySession(req.params.sessionId);
    const result = essayGuidance.saveMaterialCard(req.body || {});
    const material = {
      id: randomId('material'),
      materialId: '',
      sessionId: session.id,
      ...result.material,
      completenessScore: result.completenessScore,
      createdAt: nowIso()
    };
    material.materialId = material.id;
    state.essayMaterials.push(material);
    session.materials = [...(session.materials || []), material];
    touchEssaySession(session, { status: 'materials_saved' });
    return v1Success(req, res, {
      materialId: material.id,
      completenessScore: result.completenessScore,
      missingSuggestions: result.missingSuggestions,
      material
    });
  } catch (error) {
    return v1Error(req, res, error.status || 500, error.failureCode || 'MATERIAL_SAVE_FAILED', error.message || '保存素材失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/outline', async (req, res) => {
  try {
    const session = assertEssaySession(req.params.sessionId);
    const input = {
      title: session.title,
      genre: session.genre,
      grade: session.grade,
      selectedAngle: req.body?.selectedAngle || session.selectedAngle,
      materials: req.body?.materials || session.materials,
      preferredStructure: req.body?.preferredStructure
    };
    const result = await callEssayGuidanceModel('生成作文提纲', input, GUIDANCE_OUTPUT_CONTRACTS.outline);
    touchEssaySession(session, { outline: result, status: 'outlined' });
    return v1Success(req, res, result);
  } catch (error) {
    return v1ModelCatch(req, res, error, 'OUTLINE_FAILED', '生成提纲失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/guided-writing', async (req, res) => {
  try {
    const session = assertEssaySession(req.params.sessionId);
    const materialAnswers = Array.isArray(req.body?.materialAnswers)
      ? req.body.materialAnswers.map((item) => ({
        field: String(item?.field || '').trim().slice(0, 40),
        question: String(item?.question || '').trim().slice(0, 240),
        answer: String(item?.answer || '').trim().slice(0, 600)
      })).filter((item) => item.question || item.answer)
      : [];
    const input = {
      title: session.title,
      genre: session.genre,
      grade: session.grade,
      topicAnalysis: session.topicAnalysis,
      selectedAngleId: req.body?.selectedAngleId,
      selectedAngle: req.body?.selectedAngle || session.selectedAngle,
      materialAnswers,
      existingMaterials: session.materials || [],
      extraMaterial: String(req.body?.extraMaterial || '').trim().slice(0, 1200),
      preferredStructure: req.body?.preferredStructure || session.genre,
      boundary: '只生成提纲树、段落任务和追问提示，不生成完整作文或完整段落。'
    };
    const result = await callEssayGuidanceModel('交互式写作引导', input, GUIDANCE_OUTPUT_CONTRACTS.guidedWriting, { maxTokens: 3200 });
    const outlineTree = result.outlineTree && typeof result.outlineTree === 'object'
      ? result.outlineTree
      : { title: session.title || '作文提纲', theme: String(req.body?.selectedAngle || session.selectedAngle || '').trim(), children: [] };
    const paragraphGuides = Array.isArray(result.paragraphGuides) ? result.paragraphGuides : [];
    const missingMaterialQuestions = Array.isArray(result.missingMaterialQuestions) ? result.missingMaterialQuestions : [];
    const guide = {
      id: randomId('guide'),
      guideId: '',
      sessionId: session.id,
      selectedAngle: String(req.body?.selectedAngle || session.selectedAngle || '').trim().slice(0, 120),
      selectedAngleId: String(req.body?.selectedAngleId || '').trim().slice(0, 80),
      materialAnswers,
      outlineTree,
      paragraphGuides,
      missingMaterialQuestions,
      nextAction: result.nextAction === 'answer_more' ? 'answer_more' : 'write_paragraph_1',
      studentTask: String(result.studentTask || '').trim().slice(0, 400),
      modelMeta: result.modelMeta || null,
      createdAt: nowIso()
    };
    guide.guideId = guide.id;
    state.essayGuides = state.essayGuides || [];
    state.essayGuides.push(guide);
    touchEssaySession(session, {
      selectedAngle: guide.selectedAngle,
      guidedWriting: guide,
      status: 'guided_writing'
    });
    return v1Success(req, res, guide);
  } catch (error) {
    return v1ModelCatch(req, res, error, 'GUIDED_WRITING_FAILED', '生成写作引导失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/diagnose', async (req, res) => {
  try {
    const session = assertEssaySession(req.params.sessionId);
    const draftText = String(req.body?.draftText || session.draftText || '').trim();
    if (countCjk(draftText) < 20) return v1Error(req, res, 400, 'ESSAY_TOO_SHORT', '请至少输入一小段作文草稿');
    if (countCjk(draftText) > MAX_CHARS) return v1Error(req, res, 400, 'ESSAY_TOO_LONG', '作文超过5000字限制');
    const input = {
      draftText,
      title: req.body?.title || session.title,
      genre: req.body?.genre || session.genre,
      grade: req.body?.grade || session.grade,
      userGoal: req.body?.userGoal
    };
    const result = await callEssayGuidanceModel('单篇作文体检', input, GUIDANCE_OUTPUT_CONTRACTS.diagnose, { maxTokens: 3200 });
    const diagnostic = {
      id: randomId('diagnostic'),
      diagnosticId: '',
      sessionId: session.id,
      createdAt: nowIso(),
      ...result
    };
    diagnostic.diagnosticId = diagnostic.id;
    state.essayDiagnostics.push(diagnostic);
    touchEssaySession(session, { draftText, status: 'diagnosed' });
    return v1Success(req, res, diagnostic);
  } catch (error) {
    return v1ModelCatch(req, res, error, 'DIAGNOSE_FAILED', '作文体检失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/revision-suggestions', async (req, res) => {
  try {
    const session = assertEssaySession(req.params.sessionId);
    const diagnostic = findEssayDiagnostic(req.body?.diagnosticId) || state.essayDiagnostics.filter((item) => item.sessionId === session.id).at(-1);
    if (!diagnostic) return v1Error(req, res, 404, 'DIAGNOSTIC_NOT_FOUND', '请先完成作文体检');
    const input = {
      title: session.title,
      genre: session.genre,
      grade: session.grade,
      diagnostic,
      segmentId: req.body?.segmentId,
      revisionGoal: req.body?.revisionGoal,
      keepFactsStrict: req.body?.keepFactsStrict
    };
    const result = await callEssayGuidanceModel('局部修改建议', input, GUIDANCE_OUTPUT_CONTRACTS.revision);
    touchEssaySession(session, { status: 'revision_suggested' });
    return v1Success(req, res, result);
  } catch (error) {
    return v1ModelCatch(req, res, error, 'REVISION_SUGGESTION_FAILED', '局部修改建议失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/compare-drafts', async (req, res) => {
  try {
    assertEssaySession(req.params.sessionId);
    const input = {
      originalText: req.body?.originalText,
      revisedText: req.body?.revisedText,
      diagnosticId: req.body?.diagnosticId
    };
    const result = await callEssayGuidanceModel('修改前后对比', input, GUIDANCE_OUTPUT_CONTRACTS.compare);
    return v1Success(req, res, result);
  } catch (error) {
    return v1ModelCatch(req, res, error, 'COMPARE_FAILED', '对比草稿失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/reflection', async (req, res) => {
  try {
    const session = assertEssaySession(req.params.sessionId);
    const diagnostic = findEssayDiagnostic(req.body?.diagnosticId) || state.essayDiagnostics.filter((item) => item.sessionId === session.id).at(-1);
    if (!diagnostic) return v1Error(req, res, 404, 'DIAGNOSTIC_NOT_FOUND', '请先完成作文体检');
    const input = {
      title: session.title,
      genre: session.genre,
      grade: session.grade,
      diagnostic,
      finalText: req.body?.finalText,
      completedActions: req.body?.completedActions,
      studentSelfReflection: req.body?.studentSelfReflection
    };
    const result = await callEssayGuidanceModel('单篇作文复盘', input, GUIDANCE_OUTPUT_CONTRACTS.reflection);
    const reflection = {
      id: randomId('reflection'),
      reflectionId: '',
      sessionId: session.id,
      diagnosticId: diagnostic.id,
      createdAt: nowIso(),
      ...result
    };
    reflection.reflectionId = reflection.id;
    state.essayReflections.push(reflection);
    touchEssaySession(session, { status: 'reflected' });
    return v1Success(req, res, reflection);
  } catch (error) {
    return v1ModelCatch(req, res, error, 'REFLECTION_FAILED', '生成复盘失败');
  }
});

app.post('/api/v1/ability/initial-assessment', async (req, res) => {
  const sampleEssay = String(req.body?.sampleEssay || '').trim();
  if (countCjk(sampleEssay) < 20) return v1Error(req, res, 400, 'ESSAY_TOO_SHORT', '样本文本太短，暂时无法生成能力画像');
  const userId = String(req.body?.userId || '').trim() || currentStudentId(req, res);
  try {
    const result = await longTermAbility.assessInitialAbility({
      sampleEssay,
      grade: req.body?.grade,
      target: req.body?.target,
      title: req.body?.title,
      genre: req.body?.genre,
      callModel: callEssayGuidanceModel
    });
    const profile = {
      id: randomId('ability_profile'),
      profileId: '',
      userId,
      currentFocus: result.firstTrainingFocus,
      updatedAt: nowIso(),
      ...result
    };
    profile.profileId = profile.id;
    state.abilityProfiles = state.abilityProfiles.filter((item) => item.userId !== userId);
    state.abilityProfiles.push(profile);
    saveState();
    return v1Success(req, res, profile);
  } catch (err) {
    return v1Error(req, res, 500, 'ABILITY_ASSESS_FAILED', err?.message || '能力测评失败');
  }
});

app.get('/api/v1/ability/profile', (req, res) => {
  const userId = String(req.query?.userId || '').trim() || currentStudentId(req, res);
  const profile = state.abilityProfiles.find((item) => item.userId === userId) || {
    ...notImplementedData('abilityProfile'),
    stage: '未测评',
    dimensionScores: {},
    currentFocus: [],
    recentChanges: [],
    commonIssues: []
  };
  return v1Success(req, res, profile);
});

app.post('/api/v1/ability/profile/update-from-reflection', async (req, res) => {
  const userId = String(req.body?.userId || '').trim() || currentStudentId(req, res);
  const existing = state.abilityProfiles.find((item) => item.userId === userId) || null;
  // Accept both array and object for dimensionEvidence
  let dimensionEvidence = {};
  if (Array.isArray(req.body?.dimensionEvidence)) {
    for (const dim of req.body.dimensionEvidence) { const k = String(dim || '').trim(); if (k) dimensionEvidence[k] = '进步'; }
  } else if (req.body && typeof req.body.dimensionEvidence === 'object') {
    dimensionEvidence = req.body.dimensionEvidence;
  }
  try {
    const { updatedProfile, changedDimensions, nextSuggestedFocus } = await longTermAbility.updateProfileFromReflection({
      profile: existing,
      dimensionEvidence
    });
    const now = nowIso();
    const merged = { ...updatedProfile, userId, updatedAt: now, id: existing?.id || randomId('ability_profile') };
    if (!merged.profileId) merged.profileId = merged.id;
    state.abilityProfiles = state.abilityProfiles.filter((item) => item.userId !== userId);
    state.abilityProfiles.push(merged);
    saveState();
    return v1Success(req, res, { updatedProfile: merged, changedDimensions, nextSuggestedFocus });
  } catch (err) {
    return v1Error(req, res, 500, 'ABILITY_UPDATE_FAILED', err?.message || '能力画像更新失败');
  }
});

app.post('/api/v1/training-plans', async (req, res) => {
  const userId = String(req.body?.userId || '').trim() || currentStudentId(req, res);
  try {
    const result = await longTermAbility.buildTrainingPlanTasks(req.body || {});
    // Assign task ids and transform to plan.days (flat tasks array expected by module)
    const tasks = (result.tasks || []).map((t) => ({ ...t, taskId: randomId('task') }));
    const plan = {
      id: randomId('training_plan'),
      planId: '',
      userId,
      planType: String(result.planType || req.body?.planType || '7d'),
      status: '进行中',
      createdAt: nowIso(),
      startDate: nowIso().slice(0,10),
      focusDimensions: result.focusDimensions || [],
      totalDays: result.totalDays || tasks.length,
      dailyMinutes: result.dailyMinutes || 15,
      days: tasks
    };
    plan.planId = plan.id;
    state.trainingPlans.push(plan);
    saveState();
    return v1Success(req, res, plan);
  } catch (err) {
    return v1Error(req, res, 500, 'PLAN_CREATE_FAILED', err?.message || '训练计划生成失败');
  }
});

app.get('/api/v1/training-plans/active', (req, res) => {
  const userId = String(req.query?.userId || '').trim() || currentStudentId(req, res);
  return v1Success(req, res, state.trainingPlans.find((item) => item.userId === userId && item.status === '进行中') || notImplementedData('activeTrainingPlan'));
});

app.get('/api/v1/training-plans/:planId', (req, res) => {
  const plan = state.trainingPlans.find((item) => item.id === req.params.planId || item.planId === req.params.planId);
  if (!plan) return v1Error(req, res, 404, 'PLAN_NOT_FOUND', '训练计划不存在');
  return v1Success(req, res, plan);
});

app.get('/api/v1/training-tasks/today', (req, res) => {
  return v1Success(req, res, essayGuidance.todayTasks());
});

app.get('/api/v1/training-tasks/:taskId', (req, res) => {
  const plans = state.trainingPlans || [];
  const taskId = String(req.params?.taskId || '').trim();
  const allTasks = plans.flatMap((plan) => Array.isArray(plan.days) ? plan.days : [])
    .flatMap((day) => Array.isArray(day?.tasks) ? day.tasks : [day])
    .filter(Boolean);
  const task = allTasks.find((item) => item.taskId === taskId);
  if (!task) return v1Error(req, res, 404, 'TASK_NOT_FOUND', '训练任务不存在');
  return v1Success(req, res, {
    task,
    instructions: task.instruction,
    examples: ['把“我很感动”改成“我低头看见那张被折过的试卷，手指停了一下”。'],
    rubric: ['有具体动作', '有真实场景', '不新增虚假经历']
  });
});

app.post('/api/v1/training-tasks/:taskId/submissions', (req, res) => {
  const submission = {
    id: randomId('task_submission'),
    submissionId: '',
    taskId: req.params.taskId,
    userId: currentStudentId(req, res),
    content: String(req.body?.content || '').trim().slice(0, MAX_CHARS),
    attachments: Array.isArray(req.body?.attachments) ? req.body.attachments.slice(0, 5) : [],
    spentMinutes: Number(req.body?.spentMinutes || 0),
    createdAt: nowIso()
  };
  submission.submissionId = submission.id;
  state.trainingTaskSubmissions.push(submission);
  saveState();
  return v1Success(req, res, { submission, status: 'submitted' });
});

app.post('/api/v1/training-tasks/:taskId/feedback', async (req, res) => {
  const content = String(req.body?.content || '').trim();
  const taskId = String(req.params?.taskId || '').trim();
  // Find task across possible shapes
  const plans = state.trainingPlans || [];
  const flatTasks = plans.flatMap((plan) => Array.isArray(plan.days) ? plan.days : [])
    .flatMap((day) => Array.isArray(day?.tasks) ? day.tasks : [day])
    .filter((t) => t && t.taskId);
  const task = flatTasks.find((t) => t.taskId === taskId) || {};
  try {
    const result = await longTermAbility.reviewTaskSubmission({ task, content, callModel: callEssayGuidanceModel });
    return v1Success(req, res, result);
  } catch (err) {
    return v1Error(req, res, 500, 'TASK_FEEDBACK_FAILED', err?.message || '任务反馈失败');
  }
});

app.post('/api/v1/training-plans/:planId/stage-review', async (req, res) => {
  const plan = (state.trainingPlans || []).find((p) => p.id === req.params.planId || p.planId === req.params.planId) || null;
  if (!plan) return v1Error(req, res, 404, 'PLAN_NOT_FOUND', '训练计划不存在');
  const profile = (state.abilityProfiles || []).find((item) => item.userId === (plan.userId || currentStudentId(req, res))) || null;
  const submissions = (state.trainingTaskSubmissions || []).filter((s) => s && typeof s === 'object');
  try {
    const result = await longTermAbility.runStageReview({ plan, profile, submissions, callModel: callEssayGuidanceModel });
    return v1Success(req, res, result);
  } catch (err) {
    return v1Error(req, res, 500, 'STAGE_REVIEW_FAILED', err?.message || '阶段复盘失败');
  }
});

app.get('/api/v1/error-notebook', (req, res) => {
  return v1Success(req, res, {
    issues: state.errorNotebookItems,
    topRecurringIssues: state.errorNotebookItems.slice(-3).reverse(),
    relatedTasks: essayGuidance.todayTasks().tasks
  });
});

app.post('/api/v1/error-notebook/items', (req, res) => {
  const item = {
    id: randomId('error_item'),
    issueType: String(req.body?.issueType || '').trim() || '作文问题',
    source: String(req.body?.source || '').trim() || '作文诊断',
    evidence: String(req.body?.evidence || '').trim().slice(0, 240),
    suggestion: String(req.body?.suggestion || '').trim().slice(0, 240),
    createdAt: nowIso()
  };
  state.errorNotebookItems.push(item);
  saveState();
  return v1Success(req, res, item);
});

app.get('/api/v1/growth/timeline', (req, res) => {
  return v1Success(req, res, {
    timeline: [],
    abilityChanges: [],
    completedPlans: [],
    essayMilestones: state.essaySessions.slice(-5).map((item) => ({ sessionId: item.id, title: item.title, updatedAt: item.updatedAt })),
    badges: []
  });
});

app.get('/api/me', (req, res) => {
  res.json(summarizeViewer(req, res));
});

app.post('/api/auth/send-code', async (req, res) => {
  const authTarget = detectAuthTarget(req.body?.target || '');
  if (!authTarget) return res.status(400).json({ message: '\u8bf7\u8f93\u5165\u6709\u6548\u7684\u90ae\u7bb1' });
  try {
    ensureVerificationChannelEnabled(authTarget.channel);
    await enforceSendCodeRateLimits(req, authTarget.value);
    const code = createVerificationCode(authTarget.value, authTarget.channel);
    await dispatchVerificationCode(authTarget.channel, authTarget.value, code);
    return res.json({
      ok: true,
      channel: authTarget.channel,
      maskedTarget: maskEmail(authTarget.value),
      cooldownSeconds: Math.floor(VERIFY_CODE_COOLDOWN_MS / 1000),
      expiresInSeconds: Math.floor(VERIFY_CODE_TTL_MS / 1000),
      verificationMode: 'live'
    });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || '\u9a8c\u8bc1\u7801\u53d1\u9001\u5931\u8d25' });
  }
});

app.post('/api/auth/verify-code', async (req, res) => {
  const authTarget = detectAuthTarget(req.body?.target || '');
  const code = String(req.body?.code || '').trim();
  if (!authTarget) return res.status(400).json({ message: '\u8bf7\u8f93\u5165\u6709\u6548\u7684\u90ae\u7bb1' });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ message: '\u8bf7\u8f93\u5165 6 \u4f4d\u9a8c\u8bc1\u7801' });
  try {
    await enforceVerifyCodeRateLimits(req, authTarget.value);
    await verifyCode(authTarget.value, authTarget.channel, code);
    const guestId = ensureGuestId(req, res);
    const guestUsage = getGuestUsage(guestId);
    const existingUser = findUserByTarget(authTarget.channel, authTarget.value);
    if (!existingUser) await enforceSignupRateLimits(req, authTarget.value);
    const guestIpUsage = existingUser ? null : getGuestIpUsage(req, { legacyGuestUsage: guestUsage });
    const signupBonusAmount = existingUser ? 200 : guestIpRemainingPower(guestIpUsage) + 200;
    const { user, isNew, signupBonusGranted } = upsertUserAfterVerification(authTarget.channel, authTarget.value, { signupBonusAmount });
    if (isNew && signupBonusGranted > 0) consumeGuestSignupRemainder(guestIpUsage, guestUsage);
    const { session, token: sessionToken } = createSession(user);
    req.auth = { user, session };
    setCookie(res, 'session_id', sessionToken, { maxAge: SESSION_MAX_AGE_SECONDS, secure: COOKIE_SECURE });
    return res.json({ ok: true, isNew, signupBonusGranted, viewer: summarizeViewer(req, res) });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || '\u767b\u5f55\u5931\u8d25' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const sessionId = req.cookies.session_id;
  if (sessionId) removeSession(sessionId);
  clearCookie(res, 'session_id');
  res.json({ ok: true });
});

app.post('/api/account/profile', (req, res) => {
  try {
    requireLogin(req);
    applyProfileUpdate(req.auth.user, req.body || {});
    return res.json({ ok: true, user: serializeUser(req.auth.user) });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || '保存个人资料失败', failureCode: error.failureCode || '' });
  }
});

app.get('/api/payment/config', (req, res) => {
  try {
    requireLogin(req);
    return res.json({
      ok: true,
      payment: {
        ...PAYMENT_CONFIG,
        remarkAccount: PAYMENT_CONFIG.adminContact
      }
    });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || '\u83b7\u53d6\u6536\u6b3e\u7801\u5931\u8d25', failureCode: error.failureCode || '' });
  }
});

app.get('/api/power/packages', (req, res) => {
  res.status(410).json({ ok: false, message: '\u6a21\u62df\u5145\u503c\u5df2\u53d6\u6d88\uff0c\u8bf7\u4f7f\u7528\u5fae\u4fe1\u6536\u6b3e\u7801\u8f6c\u8d26\u540e\u7b49\u5f85\u7ba1\u7406\u5458\u4eba\u5de5\u52a0\u7b97\u529b' });
});

app.get('/api/power/ledger', (req, res) => {
  try {
    requireLogin(req);
    return res.json({ ok: true, ledger: listUserLedger(req.auth.user.id) });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || '\u83b7\u53d6\u7b97\u529b\u6d41\u6c34\u5931\u8d25', failureCode: error.failureCode || '' });
  }
});

app.post('/api/power/recharge', (req, res) => {
  res.status(410).json({ ok: false, message: '\u6a21\u62df\u5145\u503c\u5df2\u53d6\u6d88\uff0c\u8bf7\u8f6c\u8d26\u540e\u7531\u7ba1\u7406\u5458\u4eba\u5de5\u589e\u52a0\u7b97\u529b' });
});

app.get('/api/admin/users', (req, res) => {
  try {
    requireAdmin(req);
    const query = String(req.query?.q || '').trim().toLowerCase();
    const users = state.users
      .filter((user) => {
        if (!query) return true;
        return [user.id, user.email, user.phone, user.displayName]
          .some((value) => String(value || '').toLowerCase().includes(query));
      })
      .map(serializeAdminUser)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return res.json({ ok: true, users });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || '\u83b7\u53d6\u7528\u6237\u5217\u8868\u5931\u8d25', failureCode: error.failureCode || '' });
  }
});

app.get('/api/admin/guest-ip-usages', (req, res) => {
  try {
    requireAdmin(req);
    pruneExpiredGuestIpUsages();
    const records = state.guestIpUsages
      .map(serializeAdminGuestIpUsage)
      .sort((a, b) => new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime());
    return res.json({ ok: true, records });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || '获取临时 IP 列表失败', failureCode: error.failureCode || '' });
  }
});

app.post('/api/admin/power/grant', (req, res) => {
  try {
    requireAdmin(req);
    const amount = Math.round(Number(req.body?.amount || 0));
    if (!Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ message: '请输入非 0 的算力调整数量' });
    }
    const note = String(req.body?.note || '').trim();
    const userId = String(req.body?.userId || '').trim();
    let user = userId ? state.users.find((item) => item.id === userId) : null;
    if (!user) {
      const authTarget = detectAuthTarget(req.body?.target || '');
      if (!authTarget) return res.status(400).json({ message: '\u8bf7\u9009\u62e9\u7528\u6237\u6216\u8f93\u5165\u6709\u6548\u90ae\u7bb1' });
      user = findUserByTarget(authTarget.channel, authTarget.value);
    }
    if (!user) return res.status(404).json({ message: '\u672a\u627e\u5230\u7528\u6237' });
    const updatedUser = grantManualPower(user, amount, randomId('admin'), note);
    return res.json({ ok: true, user: updatedUser });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || '\u7ba1\u7406\u5458\u52a0\u7b97\u529b\u5931\u8d25', failureCode: error.failureCode || '' });
  }
});

app.post('/api/admin/users/update', (req, res) => {
  try {
    requireAdmin(req);
    const userId = String(req.body?.userId || '').trim();
    const user = state.users.find((item) => item.id === userId);
    if (!user) return res.status(404).json({ message: '未找到用户', failureCode: 'USER_NOT_FOUND' });
    applyProfileUpdate(user, req.body || {});
    return res.json({ ok: true, user: serializeAdminUser(user) });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || '管理员保存用户资料失败', failureCode: error.failureCode || '' });
  }
});

app.post('/api/admin/users/delete', (req, res) => {
  try {
    requireAdmin(req);
    const userId = String(req.body?.userId || '').trim();
    const user = state.users.find((item) => item.id === userId);
    const result = deleteUserAccount(user, req.auth.user);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || '管理员删除用户失败', failureCode: error.failureCode || '' });
  }
});

app.get('/api/debug/upstream', async (req, res) => {
  try {
    requireAdmin(req);
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || '无权限访问诊断信息', failureCode: error.failureCode || '' });
  }

  const startedAt = Date.now();
  const host = new URL(API_BASE_URL).hostname;
  const result = {
    baseUrl: API_BASE_URL,
    model: DETECT_MODEL,
    host,
    proxyConfigured: !!(ENV_PROXY || WIN_PROXY),
    steps: {}
  };

  try {
    const dnsStart = Date.now();
    const records = await dns.lookup(host, { all: true });
    result.steps.dns = { ok: true, ms: Date.now() - dnsStart, records: records.slice(0, 3) };
  } catch (error) {
    result.steps.dns = { ok: false, error: String(error.message || error) };
    return res.json({ ok: false, phase: 'dns', totalMs: Date.now() - startedAt, ...result });
  }

  try {
    const fetchStart = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(`${API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: DETECT_MODEL, temperature: 0, messages: [{ role: 'user', content: 'ping' }] }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const error = new Error(await resp.text());
      error.status = resp.status;
      throw error;
    }
    const text = await resp.text();
    result.steps.fetch = { ok: true, transport: 'fetch', status: resp.status, ms: Date.now() - fetchStart, bodyPreview: text.slice(0, 200) };
    return res.json({ ok: true, phase: 'done', totalMs: Date.now() - startedAt, ...result });
  } catch (fetchError) {
    result.steps.fetch = { ok: false, transport: 'fetch', error: summarizeError(fetchError), cause: summarizeError(fetchError.cause) };
    try {
      const httpStart = Date.now();
      const data = await postJsonWithHttps(`${API_BASE_URL}/chat/completions`, {
        model: DETECT_MODEL,
        temperature: 0,
        messages: [{ role: 'user', content: 'ping' }]
      }, 10000);
      const preview = JSON.stringify(data).slice(0, 200);
      result.steps.http = { ok: true, transport: 'https.request', status: 200, ms: Date.now() - httpStart, bodyPreview: preview };
      return res.json({ ok: true, phase: 'done', totalMs: Date.now() - startedAt, ...result });
    } catch (httpsError) {
      result.steps.http = { ok: false, transport: 'https.request', error: summarizeError(httpsError) };
      return res.json({ ok: false, phase: 'fetch', totalMs: Date.now() - startedAt, ...result });
    }
  }
});

app.post('/api/rewrite-tasks', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const genre = signalScoring.normalizeGenreGuess(req.body?.genre);
  const len = countCjk(text);
  if (!text) return res.status(400).json({ message: '请输入文本后再检测' });
  if (len > MAX_CHARS) return res.status(400).json({ message: '文本超过5000字限制，请删减后重试' });

  const owner = getRewriteTaskOwner(req, res);
  const guestUsage = owner.ownerType === 'guest' ? getGuestUsage(owner.ownerId) : null;
  const guestIpUsage = owner.ownerType === 'guest' ? getGuestIpUsage(req, { legacyGuestUsage: guestUsage }) : null;
  try {
    if (req.auth.user) {
      ensurePower(req.auth.user, 'detect', text);
    } else {
      try {
        ensureGuestPower(guestIpUsage, text);
      } catch (error) {
        return res.status(error.status || 401).json({ message: error.message, failureCode: error.failureCode || 'LOGIN_REQUIRED' });
      }
    }

    pruneRewriteTasks();
    const task = buildRewriteTask({
      ...owner,
      req,
      text,
      genre,
      context: req.body?.context,
      autoRewrite: req.body?.autoRewrite !== false
    });
    state.rewriteTasks.push(task);
    saveState();
    if (IS_CLOUDFLARE_WORKER) {
      try {
        await runRewriteTask(task.id);
      } catch (error) {
        updateRewriteTask(task, {
          status: 'failed',
          phase: 'done',
          error: serializeTaskError(error, '任务处理失败，请稍后重试'),
          finishedAt: nowIso()
        });
      }
      const user = owner.ownerType === 'user' ? findUserById(owner.ownerId) : null;
      return res.status(200).json({ ok: true, taskId: task.id, status: task.status, task: serializeRewriteTask(task, user) });
    }
    startRewriteTaskRunner(task.id);
    return res.status(202).json({ ok: true, taskId: task.id, status: task.status, task: serializeRewriteTask(task, req.auth.user) });
  } catch (error) {
    return sendTaskHttpError(res, error, '任务创建失败');
  }
});

app.get('/api/rewrite-tasks/active', (req, res) => {
  const owner = getRewriteTaskOwner(req, res);
  const task = selectActiveRewriteTask(owner);
  const user = owner.ownerType === 'user' ? findUserById(owner.ownerId) : null;
  res.json({ ok: true, task: serializeRewriteTask(task, user) });
});

app.post('/api/rewrite-tasks/clear-all', (req, res) => {
  const owner = getRewriteTaskOwner(req, res);
  const dismissedCount = dismissRewriteTasksForOwner(owner);
  res.json({ ok: true, dismissedCount });
});

app.get('/api/rewrite-tasks/:id', (req, res) => {
  const owner = getRewriteTaskOwner(req, res);
  const task = findRewriteTask(req.params.id);
  try {
    assertRewriteTaskOwner(task, owner);
    const user = owner.ownerType === 'user' ? findUserById(owner.ownerId) : null;
    res.json({ ok: true, task: serializeRewriteTask(task, user) });
  } catch (error) {
    return sendTaskHttpError(res, error, '任务不存在或已过期');
  }
});

app.post('/api/rewrite-tasks/:id/retry-rewrite', async (req, res) => {
  const owner = getRewriteTaskOwner(req, res);
  const task = findRewriteTask(req.params.id);
  try {
    assertRewriteTaskOwner(task, owner);
    if (!task.inputText) return res.status(400).json({ message: '任务缺少原文，无法重新改写', failureCode: 'TASK_INPUT_MISSING' });
    if (owner.ownerType === 'user') ensurePower(req.auth.user, 'rewrite', task.inputText);
    task.billing = task.billing || {};
    task.billing.rewriteAttempt = Number(task.billing.rewriteAttempt || 0) + 1;
    task.billing.rewriteChargedAt = null;
    task.billing.rewriteLedgerEntryId = null;
    task.billing.guestRewriteConsumedAt = null;
    updateRewriteTask(task, {
      status: 'rewriting',
      phase: 'rewrite',
      rewriteResult: null,
      error: null,
      finishedAt: null
    });
    if (IS_CLOUDFLARE_WORKER) {
      try {
        await runRewriteStage(task.id);
      } catch (error) {
        updateRewriteTask(task, {
          status: 'failed',
          phase: 'done',
          error: serializeTaskError(error, '重新改写失败，请稍后重试'),
          finishedAt: nowIso()
        });
      }
    } else {
      startRewriteTaskRunner(task.id, 'rewrite');
    }
    const user = owner.ownerType === 'user' ? req.auth.user : null;
    return res.status(202).json({ ok: true, taskId: task.id, status: task.status, task: serializeRewriteTask(task, user) });
  } catch (error) {
    return sendTaskHttpError(res, error, '重新改写失败');
  }
});

app.post('/api/rewrite-tasks/:id/clear', (req, res) => {
  const owner = getRewriteTaskOwner(req, res);
  const task = findRewriteTask(req.params.id);
  try {
    assertRewriteTaskOwner(task, owner);
    updateRewriteTask(task, { dismissedAt: nowIso() });
    return res.json({ ok: true });
  } catch (error) {
    return sendTaskHttpError(res, error, '清除任务失败');
  }
});

app.post('/api/detect', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const genre = signalScoring.normalizeGenreGuess(req.body?.genre);
  const len = countCjk(text);
  if (!text) return res.status(400).json({ message: '请输入文本后再检测' });
  if (len > MAX_CHARS) return res.status(400).json({ message: '文本超过5000字限制，请删减后重试' });

  const guestId = ensureGuestId(req, res);
  const guestUsage = getGuestUsage(guestId);
  const isLoggedIn = !!req.auth.user;
  const guestIpUsage = !isLoggedIn ? getGuestIpUsage(req, { legacyGuestUsage: guestUsage }) : null;

  try {
    if (!isLoggedIn) {
      try {
        ensureGuestPower(guestIpUsage, text);
      } catch (error) {
        return res.status(error.status || 401).json({ message: error.message, failureCode: error.failureCode || 'LOGIN_REQUIRED' });
      }
    } else {
      ensurePower(req.auth.user, 'detect', text);
    }

    const usageTracker = createUsageTracker('detect');
    const detected = await buildDetectResultPayload(text, genre, usageTracker);

    if (!isLoggedIn) markGuestTrialUsed(guestUsage, req, text, usageTracker, guestIpUsage);
    else applyPowerConsumption(req.auth.user, usageTracker, randomId('detect'), '文本检测');

    return res.json(attachPowerMeta({ ...detected, guestTrialConsumed: !isLoggedIn }, req.auth.user, usageTracker));
  } catch (error) {
    if (error?.failureCode === 'LOGIN_REQUIRED') return res.status(error.status || 401).json({ message: error.message, failureCode: 'LOGIN_REQUIRED' });
    if (error?.failureCode === 'INSUFFICIENT_POWER') {
      return res.status(402).json({ message: error.message, failureCode: 'INSUFFICIENT_POWER', balance: error.balance, minimumRequired: error.minimumRequired });
    }
    if (error?.name === 'AbortError') return res.status(504).json({ message: '检测超时，请重试', failureCode: 'UPSTREAM_TIMEOUT' });
    if (error?.status === 401 || error?.status === 403) return res.status(502).json({ message: '检测服务认证失败，请联系管理员', failureCode: 'UPSTREAM_AUTH' });
    if (error?.status >= 500 || error?.status === 429) return res.status(503).json({ message: '检测服务暂时不可用，请稍后重试', failureCode: 'UPSTREAM_UNAVAILABLE' });
    console.error('[detect-error]', error?.status || '', error?.message || error);
    return res.status(500).json({ message: '检测服务异常，请稍后重试', failureCode: 'UPSTREAM_ERROR' });
  }
});

app.post('/api/rewrite', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ message: '缺少待改写文本' });

  const guestId = ensureGuestId(req, res);
  const guestUsage = getGuestUsage(guestId);
  const isLoggedIn = !!req.auth.user;

  try {
    if (!isLoggedIn) {
      if (!canGuestRewrite(guestUsage, text)) {
        return res.status(401).json({ message: '免费试用已结束，请登录后继续改写', failureCode: 'LOGIN_REQUIRED' });
      }
    } else {
      ensurePower(req.auth.user, 'rewrite', text);
    }

    const usageTracker = createUsageTracker('rewrite');
    const result = await rewriteByProvider(text, usageTracker, req.body?.context);

    if (!isLoggedIn) consumeGuestRewrite(guestUsage);
    else applyPowerConsumption(req.auth.user, usageTracker, randomId('rewrite'), '文本改写');

    return res.json(attachPowerMeta(result, req.auth.user, usageTracker));
  } catch (error) {
    if (error?.failureCode === 'INSUFFICIENT_POWER') {
      return res.status(402).json({ message: error.message, failureCode: 'INSUFFICIENT_POWER', balance: error.balance, minimumRequired: error.minimumRequired });
    }
    if (error?.name === 'AbortError') return res.status(504).json({ message: '改写生成失败，请稍后重试', failureCode: 'UPSTREAM_TIMEOUT' });
    if (error?.status === 401 || error?.status === 403) return res.status(502).json({ message: '改写服务认证失败，请联系管理员', failureCode: 'UPSTREAM_AUTH' });
    if (error?.status >= 500 || error?.status === 429) return res.status(503).json({ message: '改写服务暂时不可用，请稍后重试', failureCode: 'UPSTREAM_UNAVAILABLE' });
    console.error('[rewrite-error]', error?.status || '', error?.message || error);
    return res.status(500).json({ message: '改写服务异常，请稍后重试', failureCode: 'UPSTREAM_ERROR' });
  }
});

app.post('/api/train', async (req, res) => {
  if (IS_CLOUDFLARE_WORKER) {
    return res.status(503).json({ message: '云端临时关闭训练知识库功能，请在本地管理端执行训练。', failureCode: 'TRAINING_DISABLED_ON_EDGE' });
  }
  const text = String(req.body?.text || '').trim();
  const len = countCjk(text);
  if (!text) return res.status(400).json({ message: '请输入训练文本' });
  if (len > MAX_CHARS) return res.status(400).json({ message: '训练文本超过5000字限制，请删减后重试' });

  try {
    requireAdmin(req);
    ensurePower(req.auth.user, 'train', text);
    const usageTracker = createUsageTracker('train');
    const trainingResult = await trainByProvider(text, usageTracker);
    const added = persistKnowledgeBase(trainingResult, text);
    const addedCounts = Object.fromEntries(Object.entries(added).map(([key, value]) => [key, value.length]));
    applyPowerConsumption(req.auth.user, usageTracker, randomId('train'), '训练知识库');
    return res.json(attachPowerMeta({
      ok: true,
      summary: trainingResult.summary,
      suspiciousSentences: trainingResult.suspiciousSentences,
      knowledge: trainingResult.knowledge,
      added,
      addedCounts
    }, req.auth.user, usageTracker));
  } catch (error) {
    if (error?.failureCode === 'ADMIN_REQUIRED') return res.status(403).json({ message: error.message, failureCode: 'ADMIN_REQUIRED' });
    if (error?.failureCode === 'LOGIN_REQUIRED') return res.status(401).json({ message: error.message, failureCode: 'LOGIN_REQUIRED' });
    if (error?.failureCode === 'INSUFFICIENT_POWER') {
      return res.status(402).json({ message: error.message, failureCode: 'INSUFFICIENT_POWER', balance: error.balance, minimumRequired: error.minimumRequired });
    }
    if (error?.name === 'AbortError') return res.status(504).json({ message: '训练超时，请稍后重试', failureCode: 'UPSTREAM_TIMEOUT' });
    if (error?.status === 401 || error?.status === 403) return res.status(502).json({ message: '训练服务认证失败，请联系管理员', failureCode: 'UPSTREAM_AUTH' });
    if (error?.status >= 500 || error?.status === 429) return res.status(503).json({ message: '训练服务暂时不可用，请稍后重试', failureCode: 'UPSTREAM_UNAVAILABLE' });
    console.error('[train-error]', error?.status || '', error?.message || error);
    return res.status(500).json({ message: '训练服务异常，请稍后重试', failureCode: 'UPSTREAM_ERROR' });
  }
});

const TRACK_EVENT_CODES = new Set([
  'page_view',
  'detect_started',
  'detect_completed',
  'rewrite_started',
  'rewrite_completed',
  'login_completed'
]);

app.post('/api/track', (req, res) => {
  const eventCode = String(req.body?.eventCode || '').trim();
  if (!TRACK_EVENT_CODES.has(eventCode)) {
    return res.status(400).json({ message: 'invalid eventCode', failureCode: 'INVALID_EVENT_CODE' });
  }
  const payloadText = JSON.stringify(req.body?.payload || {});
  if (Buffer.byteLength(payloadText, 'utf8') > 4096) {
    return res.status(413).json({ message: 'payload too large', failureCode: 'TRACK_PAYLOAD_TOO_LARGE' });
  }
  console.log('[track]', eventCode, payloadText.replace(/[\u0000-\u001f\u007f]/g, ' '));
  res.json({ ok: true });
});

app.get('/health', (_, res) => {
  res.json({
    ok: true,
    app: 'ai-text-detector-counter-site'
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const requestId = crypto.randomUUID();
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  console.error('[request-error]', requestId, req.method, req.path, String(error?.message || error).replace(/[\r\n\u0000-\u001f\u007f]/g, ' '));
  return res.status(status).json({
    message: status >= 500 ? '请求处理失败，请稍后重试' : (error?.message || '请求格式错误'),
    failureCode: error?.failureCode || (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'),
    requestId
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;

app.post('/api/v1/training-camps/:campId/plans', (req, res) => {
  const campId = String(req.params?.campId || '').trim();
  const result = trainingCamps.buildCampPlan({
    campId,
    totalDays: req.body?.totalDays,
    dailyMinutes: req.body?.dailyMinutes,
    goal: req.body?.goal
  });
  if (result && result.error) return v1Error(req, res, 404, result.error, '训练营不存在');
  const userId = String(req.body?.userId || '').trim() || currentStudentId(req, res);
  const plan = {
    id: randomId('training_plan'),
    planId: '',
    userId,
    planType: String(result.planType || 'camp_7d'),
    status: '进行中',
    createdAt: nowIso(),
    startDate: nowIso().slice(0,10),
    focusDimensions: result.focusDimensions || [],
    totalDays: result.totalDays || 7,
    dailyMinutes: result.dailyMinutes || 15,
    days: (result.days || []).map((d) => ({ ...d, taskId: d.taskId || randomId('task') }))
  };
  plan.planId = plan.id;
  state.trainingPlans.push(plan);
  saveState();
  return v1Success(req, res, plan);
});
