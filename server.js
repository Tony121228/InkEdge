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
const REWRITE_TIMEOUT_MS = 45000;
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

async function callModel({ model, systemPrompt, userPrompt, timeoutMs, usageTracker, maxTokens = 2200, responseFormat }
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
