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
const { runSevenDayTrainingTask } = require('./lib/seven-day-training-runner');
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
app.use((req, _res, next) => {
  req.cookies = parseCookies(req.headers.cookie || '');
  next();
});
const MAX_CHARS = 5000;
const DETECT_TIMEOUT_MS = 20000;
const REWRITE_TIMEOUT_MS = 300000;
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

const ADMIN_EMAILS = Array.from(new Set(
  (process.env.ADMIN_EMAILS || '').split(',')
    .map((item) => normalizeEmail(item))
    .filter(Boolean)
));

const PAYMENT_CONFIG = {
  qrSrc: process.env.WECHAT_PAY_QR_SRC || '/assets/wechat-merchant-qr.example.svg',
  payeeName: process.env.WECHAT_PAY_PAYEE || '微信收款码'
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
  trainingTaskSubmissions: []
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

function cloneStateSnapshot(parsed = {}) {
  return JSON.parse(JSON.stringify(normalizeStateShape(parsed)));
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
  context.baseline = cloneStateSnapshot(snapshot);
}

if (IS_CLOUDFLARE_WORKER) {
  app.use(async (req, res, next) => {
    try {
      const baseline = cloneStateSnapshot(await loadCloudState());
      const context = {
        state: cloneStateSnapshot(baseline),
        baseline,
        dirty: false
      };
      cloudStateIoEnabled = !!getCloudStateDb();
      requestStateStorage.run(context, () => {
        const originalEnd = res.end;
        let ending = false;
        res.end = function patchedCloudStateEnd(...args) {
          if (ending) return originalEnd.apply(this, args);
          ending = true;
          flushCloudState(context)
            .catch((error) => {
              console.error('[cloud-state-flush-error]', error?.message || error);
            })
            .finally(() => originalEnd.apply(this, args));
          return this;
        };
        next();
      });
    } catch (error) {
      next(error);
    }
  });
}

// Every route sees the same authenticated principal.  Anonymous requests use a
// stable guest cookie only for ownership of pre-login writing data.
app.use((req, _res, next) => {
  req.auth = authenticateRequest(req) || { user: null, session: null };
  next();
});

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

function getRuntimeEnvValue(name) {
  const processValue = process.env[name];
  if (typeof processValue === 'string' && processValue.trim()) return processValue.trim();
  const cloudValue = globalThis.CLOUDFLARE_ENV?.[name];
  return typeof cloudValue === 'string' ? cloudValue.trim() : '';
}

// Lightweight API helpers (restored)
function v1RequestId(req) {
  return String(req.headers?.['x-request-id'] || '').trim() || randomId('req');
}

function v1Success(req, res, data) {
  res.json({ success: true, requestId: v1RequestId(req), data });
}
function v1Error(req, res, status, code, message, details = null) {
  return res.status(status).json({
    success: false,
    requestId: v1RequestId(req),
    failureCode: code,
    message,
    error: { code, message },
    ...(details && typeof details === 'object' ? details : {})
  });
}

function notImplementedData(resource) {
  return {
    id: '',
    resource,
    status: '暂无数据',
    placeholder: true
  };
}

function currentStudentId(req, res) {
  if (req.auth?.user?.id) return req.auth.user.id;
  try {
    return ensureGuestId(req, res);
  } catch (_) {
    return 'guest_local';
  }
}

function activeTrainingPlansForUser(userId) {
  return (state.trainingPlans || []).filter((item) => (
    item && item.userId === userId && item.status === '进行中'
  ));
}

function planTimestamp(plan) {
  return Date.parse(plan?.updatedAt || plan?.createdAt || plan?.startDate || '') || 0;
}

function latestTrainingPlanForUser(userId) {
  let latest = null;
  let latestTime = -1;
  let latestIndex = -1;
  activeTrainingPlansForUser(userId).forEach((plan, index) => {
    const time = planTimestamp(plan);
    if (!latest || time > latestTime || (time === latestTime && index > latestIndex)) {
      latest = plan;
      latestTime = time;
      latestIndex = index;
    }
  });
  return latest;
}

function archiveActiveTrainingPlansForUser(userId, exceptPlanId = '') {
  const now = nowIso();
  for (const plan of activeTrainingPlansForUser(userId)) {
    if (exceptPlanId && (plan.id === exceptPlanId || plan.planId === exceptPlanId)) continue;
    plan.status = '已归档';
    plan.archivedAt = now;
    plan.updatedAt = now;
  }
}

function authenticateRequest(req) {
  if (req.auth) return req.auth;
  const cookies = req.cookies || parseCookies(req.headers?.cookie || '');
  const token = String(cookies.session_id || '').trim();
  if (!token) return null;
  const tokenHash = hashValue(`session:${token}`);
  const session = (state.sessions || []).find((item) => item.tokenHash === tokenHash);
  if (!session) return null;
  const user = (state.users || []).find((item) => item.id === session.userId);
  if (!user) return null;
  session.lastSeenAt = nowIso();
  req.auth = { user, session };
  return req.auth;
}

function serializeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email || '',
    phone: user.phone || '',
    displayName: user.displayName || pickDisplayName({ email: user.email, phone: user.phone }),
    role: user.role || (isAdminEmail(user.email) ? 'admin' : 'user'),
    createdAt: user.createdAt || '',
    lastLoginAt: user.lastLoginAt || ''
  };
}

function serializeAdminUser(user) {
  return serializeUser(user);
}

function requireLogin(req) {
  const auth = authenticateRequest(req);
  if (!auth?.user) {
    const error = new Error('请先登录');
    error.status = 401;
    error.failureCode = 'LOGIN_REQUIRED';
    throw error;
  }
  return auth;
}

function requireAdmin(req) {
  const auth = requireLogin(req);
  const role = auth.user.role || (isAdminEmail(auth.user.email) ? 'admin' : 'user');
  if (role !== 'admin') {
    const error = new Error('需要管理员权限');
    error.status = 403;
    error.failureCode = 'ADMIN_REQUIRED';
    throw error;
  }
  auth.user.role = 'admin';
  return auth;
}

function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  const now = nowIso();
  const session = {
    id: randomId('session'),
    userId: user.id,
    tokenHash: hashValue(`session:${token}`),
    createdAt: now,
    lastSeenAt: now
  };
  state.sessions.push(session);
  user.lastLoginAt = now;
  saveState();
  return { session, token };
}

function removeSession(token) {
  const tokenHash = hashValue(`session:${token}`);
  state.sessions = (state.sessions || []).filter((item) => item.tokenHash !== tokenHash);
  saveState();
}

function findUserByTarget(channel, value) {
  const normalized = channel === 'email' ? normalizeEmail(value) : normalizePhone(value);
  if (!normalized) return null;
  return (state.users || []).find((user) => (
    channel === 'email'
      ? normalizeEmail(user.email) === normalized
      : normalizePhone(user.phone) === normalized
  )) || null;
}

function upsertUserAfterVerification(channel, value) {
  const normalized = channel === 'email' ? normalizeEmail(value) : normalizePhone(value);
  let user = findUserByTarget(channel, normalized);
  const now = nowIso();
  if (user) {
    user.lastLoginAt = now;
    if (isAdminEmail(user.email)) user.role = 'admin';
    saveState();
    return { user, isNew: false };
  }
  user = {
    id: randomId('user'),
    email: channel === 'email' ? normalized : '',
    phone: channel === 'phone' ? normalized : '',
    displayName: pickDisplayName({ email: channel === 'email' ? normalized : '', phone: channel === 'phone' ? normalized : '' }),
    role: channel === 'email' && isAdminEmail(normalized) ? 'admin' : 'user',
    createdAt: now,
    lastLoginAt: now
  };
  state.users.push(user);
  saveState();
  return { user, isNew: true };
}

function rebindGuestOwnerData(guestId, userId) {
  const from = String(guestId || '').trim();
  const to = String(userId || '').trim();
  if (!from || !to || from === to) return false;
  let changed = false;
  const ownerCollections = [
    'essaySessions',
    'essayDiagnostics',
    'essayMaterials',
    'essayReflections',
    'essayGuides',
    'styleProfiles',
    'abilityProfiles',
    'trainingPlans',
    'trainingTaskSubmissions',
    'rewriteTasks'
  ];
  for (const collection of ownerCollections) {
    for (const item of state[collection] || []) {
      if (!item || typeof item !== 'object') continue;
      for (const key of ['userId', 'ownerId', 'studentId']) {
        if (item[key] === from) {
          item[key] = to;
          changed = true;
        }
      }
    }
  }
  if (changed) saveState();
  return changed;
}

function listUserLedger(userId) {
  return (state.powerLedger || [])
    .filter((item) => item.userId === userId)
    .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
}

function applyProfileUpdate(user, body = {}) {
  const displayName = normalizeDisplayName(body.displayName || body.name || '');
  if (displayName) user.displayName = displayName;
  user.updatedAt = nowIso();
  saveState();
  return user;
}

function grantManualPower(user, amount, operatorId, note = '') {
  const delta = Math.round(Number(amount || 0));
  const now = nowIso();
  user.powerBalance = Number(user.powerBalance || 0) + delta;
  if (delta > 0) user.rechargedPower = Number(user.rechargedPower || 0) + delta;
  state.powerLedger.push({
    id: randomId('ledger'),
    userId: user.id,
    type: 'admin_grant',
    amount: delta,
    balanceAfter: user.powerBalance,
    operatorId,
    note,
    createdAt: now
  });
  saveState();
  return serializeAdminUser(user);
}

function deleteUserAccount(user, operator) {
  if (!user) {
    const error = new Error('未找到用户');
    error.status = 404;
    error.failureCode = 'USER_NOT_FOUND';
    throw error;
  }
  if (operator?.id === user.id) {
    const error = new Error('不能删除当前管理员账号');
    error.status = 400;
    error.failureCode = 'CANNOT_DELETE_SELF';
    throw error;
  }
  state.users = (state.users || []).filter((item) => item.id !== user.id);
  state.sessions = (state.sessions || []).filter((item) => item.userId !== user.id);
  saveState();
  return { deletedUserId: user.id };
}

function guestIpRemainingPower(usage) {
  return Math.max(0, Math.round(Number(usage?.remainingPower ?? GUEST_FREE_TRIAL_LIMIT)));
}

function consumeGuestSignupRemainder(guestIpUsage, guestUsage) {
  if (guestIpUsage) guestIpUsage.remainingPower = 0;
  if (guestUsage) guestUsage.remainingPower = 0;
  saveState();
}

function ensureGuestId(req, res) {
  const existing = req.cookies?.guest_id;
  if (existing) return existing;
  const guestId = randomId('guest');
  setCookie(res, 'guest_id', guestId, { maxAge: GUEST_MAX_AGE_SECONDS, secure: COOKIE_SECURE });
  req.cookies = req.cookies || {};
  req.cookies.guest_id = guestId;
  return guestId;
}

function getGuestUsage(guestId) {
  if (!guestId) return null;
  let record = (state.guestUsages || []).find((item) => item.guestId === guestId);
  if (!record) {
    record = {
      guestId,
      guestIdHash: hashValue(guestId),
      ip: '',
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

function findGuestIpUsageByIp(ip) {
  const normalizedIp = String(ip || '').trim();
  if (!normalizedIp) return null;
  return (state.guestIpUsages || []).find((item) => String(item.ip || '').trim() === normalizedIp) || null;
}

function getGuestIpUsage(req, options = {}) {
  pruneExpiredGuestIpUsages();
  const clientIp = getClientIp(req);
  let record = findGuestIpUsageByIp(clientIp);
  if (!record) {
    const legacyRemaining = options.legacyGuestUsage ? guestRemainingPower(options.legacyGuestUsage) : GUEST_FREE_TRIAL_LIMIT;
    record = {
      ip: clientIp,
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
  if (record && Object.prototype.hasOwnProperty.call(record, 'remainingPower')) return guestIpRemainingPower(record);
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
  const cost = ipRecord
    ? consumeGuestIpPower(ipRecord, text, usageTracker)
    : Math.min(guestRemainingPower(record), guestDetectCost(text, usageTracker));
  if (record) {
    const previousUsedPower = guestUsedPower(record);
    record.usedCount = Number(record.usedCount || 0) + 1;
    record.usedPower = Math.min(GUEST_FREE_TRIAL_LIMIT, previousUsedPower + cost);
    record.firstUsedAt = record.firstUsedAt || nowIso();
    record.lastUsedAt = nowIso();
    record.ip = getClientIp(req) || record.ip || '';
    record.userAgentHash = hashValue(req.headers['user-agent'] || '');
    record.pendingRewriteHash = hashText(text);
    record.pendingRewriteExpiresAt = new Date(Date.now() + GUEST_REWRITE_WINDOW_MS).toISOString();
  }
  saveState();
}

function canGuestRewrite(record, text) {
  if (!record || !record.pendingRewriteHash || !record.pendingRewriteExpiresAt) return false;
  const expiresAt = new Date(record.pendingRewriteExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt >= Date.now() && record.pendingRewriteHash === hashText(text);
}

function consumeGuestRewrite(record) {
  if (!record) return;
  record.lastRewriteAt = nowIso();
  saveState();
}

function pruneExpiredGuestIpUsages() {
  const now = Date.now();
  state.guestIpUsages = (state.guestIpUsages || []).filter((item) => {
    const seenAt = Date.parse(item.lastSeenAt || item.firstSeenAt || '');
    return !seenAt || now - seenAt <= GUEST_IP_USAGE_TTL_MS;
  });
}

function serializeAdminGuestIpUsage(item) {
  const ip = String(item?.ip || item?.ipHash || '').trim();
  return {
    ipLabel: item?.ip ? 'IP' : 'IPhash',
    ip,
    remainingPower: guestIpRemainingPower(item),
    lastSeenAt: item?.lastSeenAt || item?.firstSeenAt || ''
  };
}

function dashboardSnapshot(req, res) {
  const auth = authenticateRequest(req);
  const userId = auth?.user?.id || currentStudentId(req, res);
  const activePlan = latestTrainingPlanForUser(userId);
  const todayTasks = activePlan
    ? (activePlan.days || []).filter((task) => !task.status || task.status !== '已完成').slice(0, 3)
    : [];
  const abilityProfile = (state.abilityProfiles || []).find((item) => item.userId === userId) || notImplementedData('abilityProfile');
  return {
    user: serializeUser(auth?.user) || { id: userId, role: 'guest', email: '', displayName: '游客' },
    authenticated: !!auth?.user,
    todayTasks,
    focus: todayTasks[0]?.relatedDimension || activePlan?.focusDimensions?.[0] || '',
    abilityProfile,
    abilityProfileSummary: abilityProfile,
    activePlanSummary: activePlan || null,
    commonIssues: abilityProfile.commonIssues || []
  };
}

function pruneExpiredVerificationCodes() {
  const now = Date.now();
  state.verificationCodes = (state.verificationCodes || []).filter((item) => {
    const expiresAt = new Date(item.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt + (24 * 60 * 60 * 1000) > now;
  });
}

function isEmailChannelEnabled() {
  return !!(getRuntimeEnvValue('SMTP_HOST') && (getRuntimeEnvValue('SMTP_FROM') || getRuntimeEnvValue('SMTP_USER')));
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

  state.authRateLimits = (state.authRateLimits || []).filter((item) => new Date(item.expiresAt || 0).getTime() > now);
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
  await consumeSecurityRateLimit('send-code-ip', getClientIp(req) || 'unknown', AUTH_RATE_LIMITS.sendIp);
  await consumeSecurityRateLimit('send-code-target', hashValue(target), AUTH_RATE_LIMITS.sendTarget);
  await consumeSecurityRateLimit('send-code-domain', hashValue(emailDomain(target)), AUTH_RATE_LIMITS.sendDomain);
}

async function enforceVerifyCodeRateLimits(req, target) {
  await consumeSecurityRateLimit('verify-code-ip', getClientIp(req) || 'unknown', AUTH_RATE_LIMITS.verifyIp);
  await consumeSecurityRateLimit('verify-code-target', hashValue(target), AUTH_RATE_LIMITS.verifyTarget);
}

async function enforceSignupRateLimits(req, target) {
  await consumeSecurityRateLimit('signup-global', 'global', AUTH_RATE_LIMITS.signupGlobal);
  await consumeSecurityRateLimit('signup-ip', getClientIp(req) || 'unknown', AUTH_RATE_LIMITS.signupIp);
  await consumeSecurityRateLimit('signup-domain', hashValue(emailDomain(target)), AUTH_RATE_LIMITS.signupDomain);
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
  const host = getRuntimeEnvValue('SMTP_HOST');
  const smtpSecure = getRuntimeEnvValue('SMTP_SECURE') === 'true';
  const port = Number(getRuntimeEnvValue('SMTP_PORT') || (smtpSecure ? 465 : 587));
  const user = getRuntimeEnvValue('SMTP_USER');
  const pass = getRuntimeEnvValue('SMTP_PASS');
  const from = getRuntimeEnvValue('SMTP_FROM') || user;
  const clientName = getRuntimeEnvValue('SMTP_CLIENT_NAME') || 'localhost';
  const secure = smtpSecure || port === 465;
  if (!host || !from) {
    const error = new Error('邮箱验证码未配置 SMTP 服务');
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
    await sendSmtpCommand(socket, `EHLO ${clientName}`, [250]);
    if (!secure) {
      await sendSmtpCommand(socket, 'STARTTLS', [220]);
      socket = await wrapSocketWithTls(socket, host);
      await sendSmtpCommand(socket, `EHLO ${clientName}`, [250]);
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
      `你的验证码是：${code}`,
      `验证码 ${VERIFY_CODE_TTL_MINUTES} 分钟内有效，请勿泄露给他人。`
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
  const error = new Error('仅支持邮箱验证码登录');
  error.status = 400;
  throw error;
}

function ensureVerificationChannelEnabled(channel) {
  if (channel !== 'email') {
    const error = new Error('仅支持邮箱验证码登录');
    error.status = 400;
    throw error;
  }
  if (!isEmailChannelEnabled()) {
    const error = new Error('当前未配置 SMTP，暂时无法发送邮箱验证码');
    error.status = 503;
    throw error;
  }
}

function createVerificationCode(target, channel) {
  pruneExpiredVerificationCodes();
  const now = Date.now();
  const recentCodes = (state.verificationCodes || []).filter((item) => item.target === target && item.channel === channel);
  const latest = recentCodes.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (latest) {
    const latestAt = new Date(latest.createdAt).getTime();
    if (Number.isFinite(latestAt) && now - latestAt < VERIFY_CODE_COOLDOWN_MS) {
      const error = new Error('验证码发送过于频繁，请稍后再试');
      error.status = 429;
      throw error;
    }
  }
  const recentHourCount = recentCodes.filter((item) => now - new Date(item.createdAt).getTime() < 60 * 60 * 1000).length;
  if (recentHourCount >= VERIFY_CODE_HOURLY_LIMIT) {
    const error = new Error('当前邮箱发送验证码次数过多，请稍后再试');
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
  const candidates = (state.verificationCodes || [])
    .filter((item) => item.target === target && item.channel === channel && !item.consumedAt && !item.lockedAt)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
  const matches = storedBuffer.length === candidateBuffer.length && storedBuffer.length > 0 && crypto.timingSafeEqual(storedBuffer, candidateBuffer);
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

function summarizeViewer(req, res) {
  const auth = authenticateRequest(req);
  const guestId = ensureGuestId(req, res);
  const authMeta = {
    channels: getAvailableAuthChannels(),
    canUseEmail: isEmailChannelEnabled(),
    canUseSms: false,
    verificationMode: 'live'
  };
  if (auth?.user) {
    return {
      user: serializeUser(auth.user),
      authenticated: true,
      auth: authMeta
    };
  }
  const uid = currentStudentId(req, res);
  return {
    user: { id: uid, role: 'guest', email: '', displayName: '游客' },
    authenticated: false,
    auth: authMeta
  };
}

function createEssaySession(req, res) {
  const now = nowIso();
  const mode = normalizeEssayMode(req.body?.mode);
  const session = {
    id: randomId('essay_session'),
    sessionId: '',
    userId: currentStudentId(req, res),
    mode,
    title: String(req.body?.title || '').trim().slice(0, 120),
    genre: String(req.body?.genre || '').trim().slice(0, 40),
    grade: String(req.body?.grade || '').trim().slice(0, 40),
    draftText: String(req.body?.draftText || '').trim().slice(0, MAX_CHARS),
    initialMaterial: normalizeInitialMaterial(req.body?.initialMaterial || req.body?.existingMaterials || req.body?.material),
    additionalMaterial: '',
    additionalMaterialSessionId: '',
    additionalMaterialQuestionSetId: '',
    additionalMaterialSelectedAngleId: '',
    selectedAngle: '',
    ...(mode === 'brainstorm' ? {
      selectedAngleId: '',
      selectedAngleSnapshot: null,
      materialQuestionSet: null,
      materialAnswers: []
    } : {}),
    materials: [],
    status: mode === 'revise' ? 'draft_created' : 'created',
    createdAt: now,
    updatedAt: now
  };
  session.sessionId = session.id;
  state.essaySessions = state.essaySessions || [];
  state.essaySessions.push(session);
  saveState();
  return session;
}

function assertEssaySession(sessionId) {
  const id = String(sessionId || '').trim();
  const session = (state.essaySessions || []).find((item) => item.id === id || item.sessionId === id);
  if (!session) {
    const error = new Error('作文会话不存在');
    error.status = 404;
    error.failureCode = 'SESSION_NOT_FOUND';
    throw error;
  }
  return session;
}

function essaySessionOwnerId(session) {
  return String(session?.studentId || session?.userId || '').trim();
}

function assertOwnedEssaySession(req, res, sessionId) {
  const session = assertEssaySession(sessionId);
  const ownerId = essaySessionOwnerId(session);
  const viewerId = currentStudentId(req, res);
  if (ownerId && ownerId !== viewerId) {
    const error = new Error('作文会话不存在');
    error.status = 404;
    error.failureCode = 'SESSION_NOT_FOUND';
    throw error;
  }
  if (!ownerId) {
    session.studentId = viewerId;
  }
  return session;
}

function findEssayDiagnostic(diagnosticId) {
  const id = String(diagnosticId || '').trim();
  if (!id) return null;
  return (state.essayDiagnostics || []).find((item) => item.id === id || item.diagnosticId === id) || null;
}

function findCurrentEssayDiagnostic(session, diagnosticId = '') {
  const sessionDiagnostics = (state.essayDiagnostics || []).filter((item) => item.sessionId === session.id);
  const latestDiagnostic = sessionDiagnostics.at(-1) || null;
  if (!latestDiagnostic) return null;
  const requestedId = String(diagnosticId || '').trim();
  const diagnostic = requestedId
    ? sessionDiagnostics.find((item) => item.id === requestedId || item.diagnosticId === requestedId)
    : latestDiagnostic;
  if (!diagnostic || diagnostic.id !== latestDiagnostic.id) return null;
  if (session.latestDiagnosticId && session.latestDiagnosticId !== diagnostic.id) return null;
  return diagnostic;
}

function touchEssaySession(session, patch = {}) {
  Object.assign(session, patch, { updatedAt: nowIso() });
  saveState();
  return session;
}

function beginEssayOperation(session, stage) {
  const operation = {
    version: Math.max(0, Number(session.essayOperationVersion) || 0) + 1,
    token: randomId('essay_operation'),
    stage
  };
  session.essayOperationVersion = operation.version;
  session.latestEssayOperation = operation;
  session.updatedAt = nowIso();
  saveState();
  return operation;
}

function isCurrentEssayOperation(session, operation) {
  const current = session?.latestEssayOperation;
  return Boolean(current
    && current.version === operation.version
    && current.token === operation.token
    && current.stage === operation.stage);
}

function staleEssayOperation() {
  const error = new Error('作文会话已有更新的操作，本次结果已失效');
  error.status = 409;
  error.failureCode = 'STALE_ESSAY_OPERATION';
  error.stale = true;
  return error;
}

function assertCurrentEssayOperation(session, operation) {
  if (!isCurrentEssayOperation(session, operation)) throw staleEssayOperation();
}

async function awaitEssayOperation(session, operation, promise) {
  try {
    const result = await promise;
    assertCurrentEssayOperation(session, operation);
    return result;
  } catch (error) {
    if (!isCurrentEssayOperation(session, operation)) throw staleEssayOperation();
    throw error;
  }
}

function serializeEssaySession(session) {
  const diagnostics = (state.essayDiagnostics || []).filter((item) => item.sessionId === session.id);
  const reflections = (state.essayReflections || []).filter((item) => item.sessionId === session.id);
  const guides = (state.essayGuides || []).filter((item) => item.sessionId === session.id);
  const currentGuide = session.latestGuideId
    ? guides.find((item) => item.id === session.latestGuideId || item.guideId === session.latestGuideId)
    : null;
  return {
    ...session,
    sessionId: session.sessionId || session.id,
    latestDiagnostic: diagnostics.at(-1) || null,
    latestReflection: reflections.at(-1) || null,
    latestGuide: currentGuide || session.guidedWriting || null
  };
}

function withAbilityScoreAliases(dimensionScores = {}) {
  return {
    ...dimensionScores,
    topicAbility: dimensionScores.topicAbility ?? dimensionScores['审题能力'],
    ideaAbility: dimensionScores.ideaAbility ?? dimensionScores['立意能力'],
    materialAbility: dimensionScores.materialAbility ?? dimensionScores['选材能力'],
    structureAbility: dimensionScores.structureAbility ?? dimensionScores['结构能力'],
    detailAbility: dimensionScores.detailAbility ?? dimensionScores['细节能力'],
    languageAbility: dimensionScores.languageAbility ?? dimensionScores['语言能力'],
    revisionAbility: dimensionScores.revisionAbility ?? dimensionScores['修改能力'],
    examExpressionAbility: dimensionScores.examExpressionAbility ?? dimensionScores['考场表达能力']
  };
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

function normalizeEssayMode(value) {
  const mode = String(value || '').trim();
  return ['brainstorm', 'revise'].includes(mode) ? mode : 'brainstorm';
}

function normalizeInitialMaterial(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeInitialMaterial(item)).filter(Boolean).join('；').slice(0, MAX_CHARS);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).map((item) => normalizeInitialMaterial(item)).filter(Boolean).join('；').slice(0, MAX_CHARS);
  }
  return String(value || '').trim().slice(0, MAX_CHARS);
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

function getRewriteTaskOwner(req, res) {
  if (req.auth?.user?.id) return { ownerType: 'user', ownerId: req.auth.user.id };
  return { ownerType: 'guest', ownerId: ensureGuestId(req, res) };
}

function buildRewriteTask({ ownerType, ownerId, text, genre, context, autoRewrite = true }) {
  const now = nowIso();
  return {
    id: randomId('rewrite_task'),
    ownerType,
    ownerId,
    inputText: text,
    genre: genre || '',
    context: context || {},
    autoRewrite,
    status: 'queued',
    phase: 'detect',
    createdAt: now,
    updatedAt: now,
    detectResult: null,
    rewriteResult: null,
    error: null,
    finishedAt: null
  };
}

function findRewriteTask(id) {
  return (state.rewriteTasks || []).find((item) => item.id === id) || null;
}

function updateRewriteTask(task, patch = {}) {
  if (!task) return null;
  Object.assign(task, patch, { updatedAt: nowIso() });
  saveState();
  return task;
}

function serializeTaskError(error, fallback = '任务处理失败') {
  return { message: String(error?.message || fallback), failureCode: error?.failureCode || 'TASK_FAILED' };
}

function serializeRewriteTask(task) {
  if (!task) return null;
  return {
    id: task.id,
    taskId: task.id,
    ownerType: task.ownerType,
    status: task.status,
    phase: task.phase,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    finishedAt: task.finishedAt,
    detectResult: task.detectResult,
    rewriteResult: task.rewriteResult,
    error: task.error
  };
}

function assertRewriteTaskOwner(task, owner) {
  if (!task) {
    const error = new Error('任务不存在或已过期');
    error.status = 404;
    error.failureCode = 'TASK_NOT_FOUND';
    throw error;
  }
  if (task.ownerType !== owner.ownerType || task.ownerId !== owner.ownerId) {
    const error = new Error('无权访问该任务');
    error.status = 403;
    error.failureCode = 'TASK_FORBIDDEN';
    throw error;
  }
  return task;
}

function selectActiveRewriteTask(owner) {
  return (state.rewriteTasks || []).slice().reverse().find((task) => (
    task.ownerType === owner.ownerType && task.ownerId === owner.ownerId && !task.dismissedAt && !['done', 'failed'].includes(task.status)
  )) || null;
}

function dismissRewriteTasksForOwner(owner) {
  let count = 0;
  for (const task of state.rewriteTasks || []) {
    if (task.ownerType === owner.ownerType && task.ownerId === owner.ownerId && !task.dismissedAt) {
      task.dismissedAt = nowIso();
      count += 1;
    }
  }
  if (count) saveState();
  return count;
}

function pruneRewriteTasks() {
  const cutoff = Date.now() - REWRITE_TASK_TTL_MS;
  state.rewriteTasks = (state.rewriteTasks || []).filter((task) => Date.parse(task.updatedAt || task.createdAt || '') >= cutoff);
}

async function buildDetectResultPayload(text, genre, usageTracker) {
  const analysis = analyzeAiSignals(text, { genre });
  return {
    ok: true,
    text,
    probability: Number(analysis.probability || analysis.aiProbability || 0),
    aiProbability: Number(analysis.probability || analysis.aiProbability || 0),
    genre: genre || analysis.genre || '',
    analysis,
    diagnostics: analysis.diagnostics || [],
    suspiciousSegments: findSuspiciousSegments(text),
    usage: summarizeUsage(usageTracker)
  };
}

async function rewriteByProvider(text, usageTracker, context = {}) {
  const analysis = analyzeAiSignals(text, { genre: context?.genre });
  const plan = rewritePlanner.buildLocalEditPlan(text, { analysis, diagnostics: analysis.diagnostics || [], suspiciousSegments: analysis.suspiciousSegments || [], rewriteMode: context?.rewriteMode || 'balanced' });
  const localText = cleanRewriteText(buildConservativeRewrite(text, plan, { preserveFacts: true }) || text);
  const rewrittenAnalysis = analyzeAiSignals(localText, { genre: context?.genre });
  return {
    ok: true,
    originalText: text,
    rewrittenText: localText,
    candidates: [{ text: localText, source: 'local' }],
    originalAnalysis: analysis,
    rewrittenAnalysis,
    editPlan: plan,
    usage: summarizeUsage(usageTracker),
    localFallback: true
  };
}

async function runRewriteStage(taskId) {
  const task = findRewriteTask(taskId);
  if (!task) throw new Error('任务不存在或已过期');
  updateRewriteTask(task, { status: 'rewriting', phase: 'rewrite' });
  const usageTracker = createUsageTracker('rewrite');
  const result = await rewriteByProvider(task.inputText, usageTracker, task.context);
  updateRewriteTask(task, { status: 'done', phase: 'done', rewriteResult: result, finishedAt: nowIso() });
  return task;
}

async function runRewriteTask(taskId) {
  const task = findRewriteTask(taskId);
  if (!task) throw new Error('任务不存在或已过期');
  updateRewriteTask(task, { status: 'detecting', phase: 'detect' });
  const usageTracker = createUsageTracker('detect');
  const detected = await buildDetectResultPayload(task.inputText, task.genre, usageTracker);
  updateRewriteTask(task, { detectResult: detected });
  if (task.autoRewrite) await runRewriteStage(taskId);
  else updateRewriteTask(task, { status: 'done', phase: 'done', finishedAt: nowIso() });
  return task;
}

function startRewriteTaskRunner(taskId, phase = 'all') {
  setImmediate(() => (phase === 'rewrite' ? runRewriteStage(taskId) : runRewriteTask(taskId)).catch((error) => {
    const task = findRewriteTask(taskId);
    if (task) updateRewriteTask(task, { status: 'failed', phase: 'done', error: serializeTaskError(error), finishedAt: nowIso() });
  }));
}

function sendTaskHttpError(res, error, fallback) {
  return res.status(error?.status || 500).json({ message: error?.message || fallback, failureCode: error?.failureCode || 'TASK_FAILED' });
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
  if (err?.failureCode === 'MODEL_JSON_PARSE') return false;
  if (err?.name === 'AbortError') return false;
  if (typeof err?.status === 'number') return err.status >= 500 || err.status === 429;
  return true;
}

function remainingTimeoutMs(startedAt, totalMs) {
  const total = Number(totalMs);
  if (!Number.isFinite(total) || total <= 0) return 300000;
  const elapsed = Date.now() - startedAt;
  return Math.max(1, total - elapsed);
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
  const startedAt = Date.now();
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
    if (fetchError?.name === 'AbortError') throw fetchError;
    const fallbackTimeoutMs = remainingTimeoutMs(startedAt, timeoutMs);
    if (fallbackTimeoutMs < 1000) throw fetchError;
    try {
      return await postJsonWithHttps(url, payload, fallbackTimeoutMs);
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
  const startedAt = Date.now();
  return withRetry(async () => {
    const attemptTimeoutMs = remainingTimeoutMs(startedAt, timeoutMs);
    const data = await postChatCompletions({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: (responseFormat || { type: 'json_object' }),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }, attemptTimeoutMs);
    const choiceMessage = data?.choices?.[0]?.message || {};
    const content = choiceMessage.content || '';
    trackUsage(usageTracker, data?.usage, [systemPrompt, userPrompt, content]);
    if (!String(content || '').trim()) {
      const error = new Error('Empty model response');
      error.rawContent = JSON.stringify(choiceMessage);
      error.failureCode = 'MODEL_EMPTY_CONTENT';
      throw error;
    }
    try {
      return { json: extractJson(content), usage: data?.usage || null, rawContent: content };
    } catch (error) {
      error.rawContent = content;
      error.failureCode = 'MODEL_JSON_PARSE';
      throw error;
    }
  });
}

function stripGuidanceInternalMeta(value) {
  if (Array.isArray(value)) return value.map((item) => stripGuidanceInternalMeta(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'modelMeta')
      .map(([key, item]) => [key, stripGuidanceInternalMeta(item)])
  );
}

async function callEssayGuidanceModel(taskName, input, outputContract, options = {}) {
  if (!API_BASE_URL || !API_KEY || !ESSAY_GUIDANCE_MODEL) {
    const error = new Error('DeepSeek 指导模型暂时不可用');
    error.status = 503;
    error.failureCode = 'MODEL_UNAVAILABLE';
    throw error;
  }

  const isReferenceRewriteTask = String(taskName || '').includes('参考改写');
  const isRevisionSuggestionTask = String(taskName || '').includes('局部修改建议');
  const strictRevisionMode = isRevisionSuggestionTask && input?.keepFactsStrict === true;
  const systemPrompt = [
    '你是一个中文作文写作教练，只做短期单篇作文指导。',
    '你要帮助学生理解题目、补充真实素材、形成提纲和修改建议。',
    isReferenceRewriteTask
       ? '本次任务必须按照 input.revisionSuggestionText 所载的局部修改建议，落实到原文对应内容中；先识别建议针对的段落和问题，再按建议中的修改思路实际改写相应内容；input.revisionSuggestion 中的修改思路、示范和学生行动也应一并落实。还必须同时参考 input.priorityIssues 中体检报告优先问题卡片列出的作文问题，改进这些问题对应的内容。参考稿可以自由改写原文中的事件、人物、细节、结构和表达，不受原文事实边界限制。完成正文后，用 changes 简要说明具体改了哪些位置及改动内容，说明必须对应刚生成的正文。'
      : isRevisionSuggestionTask
        ? strictRevisionMode
          ? '本次局部修改示范按 input.keepFactsStrict 执行严格事实模式，只使用原文已有事实。'
          : '本次局部修改示范可以补充符合原文场景的合理环境、动作、感官和心理描写，帮助学生看见如何把问题段落写具体；保留核心经历与结果，并把新增描写列明，提醒学生核对是否符合真实情况。'
        : '不要替学生直接写完整作文；涉及用户真实素材、事实提取或诊断时，应忠实呈现用户提供的信息。',
    '必须只返回合法 JSON，不要输出 Markdown、解释文字或代码块。'
  ].join('\n');
  const userPrompt = JSON.stringify({
    taskName,
    input: stripGuidanceInternalMeta(input),
    outputContract,
    outputRules: [
      '只输出 JSON，不要输出 Markdown、解释文字或代码块。',
      '所有字段使用中文内容。',
      '数组字段即使没有内容也返回空数组。',
      '不要在任何 JSON 字符串值内部使用英文双引号；需要引用时使用中文引号「」或直接改写。',
      isReferenceRewriteTask
         ? '必须落实 input.revisionSuggestionText 中的具体要求，并结合 input.revisionSuggestion 中的修改思路、示范内容与学生行动，改写建议所指向的原文位置；还必须逐项参考 input.priorityIssues 中的体检优先问题，改进其中指出的作文问题；可以自由改写原文中的事件、人物、细节、结构和表达，不能只做标点或少量词语替换。'
        : isRevisionSuggestionTask
          ? strictRevisionMode
            ? '局部示范严格使用原文事实，并在 factCheck 中说明事实来源。'
            : '局部示范允许添加合理的描写性细节来展示写法；factCheck.addedDetails 必须列出新增部分，提醒学生逐项核实并按真实情况调整。'
          : '不替学生生成完整作文。',
      isReferenceRewriteTask
         ? '返回 changes 数组说明修改位置和实际改动，字段固定为 location、modification；每一项都要能在 revisedText 中找到对应内容。'
        : isRevisionSuggestionTask
          ? '局部示范要直观展示一种更具体的写法；新增描写是可修改的示范，不得把它说成学生已经确认的真实细节。'
          : '如果素材不足，用问题引导学生补充；事实提取与诊断应忠实于用户已提供的信息。',
      isReferenceRewriteTask
         ? '可以自由改写和重组原文的事件、人物、细节、结构和表达，使参考稿对体检问题和局部修改建议产生清楚可见的实质改动。'
        : isRevisionSuggestionTask && !strictRevisionMode
          ? '不要把示范性描写包装成已核实事实；在 factCheck.addedDetails 中列出新增细节，并明确提醒学生核实。'
          : '写作引导只提供段落任务、必须包含的信息和提示，不生成完整段落正文。'
    ]
  });
  const response = await callModel({
    model: ESSAY_GUIDANCE_MODEL,
    systemPrompt,
    userPrompt,
    timeoutMs: options.timeoutMs || REWRITE_TIMEOUT_MS,
    maxTokens: options.maxTokens || 2600,
    responseFormat: options.responseFormat
  });
  return {
    ...response.json,
    modelMeta: {
      provider: 'deepseek-compatible',
      model: ESSAY_GUIDANCE_MODEL,
      taskName,
      usage: response.usage || null
    }
  };
}

function v1ModelCatch(req, res, error, fallbackCode, fallbackMessage) {
  if (error?.failureCode === 'STALE_ESSAY_OPERATION') {
    return v1Error(req, res, 409, 'STALE_ESSAY_OPERATION', error.message, { stale: true });
  }
  if (error?.failureCode === 'MODEL_UNAVAILABLE') {
    return v1Error(req, res, error.status || 503, 'MODEL_UNAVAILABLE', error.message || 'DeepSeek 指导模型暂时不可用');
  }
  return v1Error(req, res, error.status || 500, error.failureCode || fallbackCode, error.message || fallbackMessage);
}

const GUIDANCE_OUTPUT_CONTRACTS = {
  topicAnalysis: '只返回合法 JSON 对象，固定键为 topicKeywords、coreQuestion、possibleAngles、riskyAngles、suggestedNextQuestions。possibleAngles 必须正好 3 项，每项字段为 angleId、title、prompt、whyThisFitsTopic、materialConnection、writingPath、keyDetailsToAsk、riskReminder、materialHint。每个方向都必须贴合 input.initialMaterial 或 planContext.initialMaterial 中的具体素材，说明这个方向为什么扣题、怎样使用已有素材、按什么顺序展开、下一步还要追问哪些细节。必须保留或改写用户素材锚点，例如地名、人物、活动、核心物件、关键动作和观察对象。不要只写成长、感悟、观察等空泛词。不要在任何字符串里使用英文双引号，强调时用中文引号。不要 Markdown，不要解释文字。',
  materialQuestions: '只返回合法 JSON 对象，固定键为 questionSetId、selectedAngleId、questions、materialChecklist、requiredAnswerCount、nextAction。selectedAngleId 必须与 input.selectedAngleId 完全一致。questions 必须生成 5-7 项，每项必须包含 questionId、field、category、question、purpose、materialAnchor、detailHints、required。questionId 在本次问题集中必须稳定且唯一；detailHints 必须是 2-4 个可直接回答的细节提示；required 必须是布尔值。问题必须沿 input.selectedAngle.writingPath 的事件链推进，优先引用 input.initialMaterial、input.existingMaterials 和 input.materialAnswers 里的真实素材锚点，不要重复追问已知事实，不要堆砌与所选立意无关的通用问题。素材不足时只能请学生如实补充或明确说明没有，不得暗示、诱导或代替学生虚构人物、时间、地点、对话、动作、心理或感官细节。materialChecklist 每项字段为 field、label、present、value、suggestion。requiredAnswerCount 必须是正整数且不得超过 required 为 true 的问题数；nextAction 只能是 answer_questions。不要 Markdown，不要解释文字。',
  outline: 'outlines:{outlineId,title,structure,paragraphs:{role,instruction}[]}[]; recommendedOutlineId:string; warnings:string[]',
  outlineTree: '只返回合法 JSON 对象，必须以 { 开头、以 } 结尾，固定键只有 outlineTree。outlineTree 包含 title、theme、children。children 正好 4 项，依次为开头、经过、转折、结尾；每项字段为 nodeId、role、label、focus、writeTask、writingObjects、detailPlan、eventBeats、emotionShift、transitionHint、studentChecklist、children。writingObjects、eventBeats、studentChecklist 必须是字符串数组。detailPlan 可以是字符串数组或对象数组，用来说明每个写作对象分别写哪些细节。children 可用于补充场景、动作、心理、对话、景物等子节点。每段都要具体说明学生这一段写什么、怎么推进、写哪些人物/景物/动作/心理/对话/物件。必须直接保留或改写用户素材锚点，包括地名、人物、活动、核心物件、关键动作或观察对象，不能生成脱离素材的通用提纲。不要返回作文正文，不要 Markdown。',
  paragraphGuides: '只返回合法 JSON 对象，固定键为 paragraphGuides、missingMaterialQuestions、nextAction、studentTask。paragraphGuides 生成 4 段，每段字段为 paragraphId、role、goal、writingTargets、howToWrite、detailsToInclude、developmentSteps、sensoryDetails、innerThoughtPrompts、mustInclude、writingPrompts、starterHint、avoid、selfCheck、suggestedLength。writingTargets 说明本段要写哪些对象；howToWrite 说明这些对象分别怎么写；detailsToInclude 列出必须落地的事实细节；developmentSteps 给出本段内部写作顺序；selfCheck 给学生写完后的检查项。必须直接保留或改写用户素材锚点，包括地名、人物、活动、核心物件、关键动作或观察对象，让每段提示贴住学生自己的经历。starterHint 只给起笔方向，不提供完整段落。不要返回作文正文，不要 Markdown。',
  diagnose: 'overallComment:string; dimensionScores:object; priorityIssues:{issueId,dimension,title,severity,explanation,suggestion,relatedSegmentId}[]; highlightedSegments:{segmentId,text,issueType,reason,suggestion}[]; suggestedRevisionPath:string[]',
  trainingDiagnosis: '只返回合法 JSON 对象，必须以 { 开头、以 } 结尾。固定键为 overallComment、dimensionScores、priorityIssues、highlightedSegments、revisionTargets。dimensionScores 必须是对象，不要数组，只含 topicFit、materialSpecificity、structureClarity 三个 0-100 数字。priorityIssues 生成 2-3 项，每项字段为 issueId、dimension、title、severity、explanation、suggestion、relatedSegmentId，要指出草稿中最影响写作效果的问题和具体修改动作。highlightedSegments 可返回需要修改的原文片段。revisionTargets 生成可执行的修改目标。不要 Markdown，不要改写全文。',
  revision: '只返回合法 JSON 对象，固定键为 issueExplanation、revisionStrategy、exampleRevision、studentAction、revisionGoal、factCheck。必须参考 input.revisionDepth 控制建议展开程度；revisionGoal 和 revisionDepth 可能包含学生的自定义要求。exampleRevision 是局部写法示范，不得改写全文，不得超过 120 字。为解决诊断指出的问题，可以在示范中补充符合场景的合理环境、动作、感官和心理描写，让学生看见具体写法；不要改变核心经历、主要人物关系或结果。factCheck 必须是对象，包含 summary、usedSourceFacts、addedDetails、coreFactsPreserved；addedDetails 必须逐项列出原文没有但示范新补充的描写，coreFactsPreserved 在核心经历和结果保持时为 true。明确提醒学生核对新增描写，不符合真实情况时自行替换或删除。不要 Markdown，不要解释文字。',
  referenceRewrite: '只返回合法 JSON 对象，固定键为 revisedText、changes。revisedText 是完整参考稿。changes 必须是数组，每项固定包含 location（对应原文/文章中的段落或位置）和 modification（该处具体改成或补充了什么）；说明要简洁、准确，并与 revisedText 实际内容一致。必须优先落实 input.revisionSuggestionText 中的局部修改要求，并参考 input.revisionSuggestion 的修改思路、示范和学生行动，明确改写其针对的原文位置；同时必须参考 input.priorityIssues 中体检报告优先问题卡片列出的作文问题，改进这些问题对应的内容。可以自由改写和重组原文中的事件、人物、细节、结构和表达，使参考稿产生清楚可见的实质变化。不要 Markdown，不要解释文字。',
  compare: 'improvements:string[]; remainingIssues:array; changedSegments:{segmentId,text}[]; learningNotes:string[]',
  reflection: 'summary:string; learnedSkills:string[]; recurringIssues:string[]; suggestedTrainingFocus:string[]; studentSelfReflection:string; finalTextLength:number',
  trainingReflection: '只返回合法 JSON 对象，固定键为 summary、learnedSkills、recurringIssues、suggestedTrainingFocus、studentSelfReflection、finalTextLength。learnedSkills、recurringIssues、suggestedTrainingFocus 都是字符串数组，要结合学生从立意、素材、提纲、段落、修改中实际完成的动作，指出已经掌握的写法、还会反复出现的问题和下一轮最值得练习的方向。不要 Markdown，不要作文正文。',
  styleProfile: 'summary:string; traits:string[]; strengths:string[]; habits:string[]; commonIssues:string[]; suggestions:string[]',
  guidedWriting: 'outlineTree:{title,theme,children:{nodeId,role,label,focus,writeTask,writingObjects:string[],detailPlan:array,eventBeats:string[],emotionShift,transitionHint,studentChecklist:string[],children:array}[]}; paragraphGuides:{paragraphId,role,goal,writingTargets:string[],howToWrite:array,detailsToInclude:string[],developmentSteps:string[],sensoryDetails:string[],innerThoughtPrompts:string[],mustInclude:string[],writingPrompts:string[],starterHint,avoid:string[],selfCheck:string[],suggestedLength}[]; missingMaterialQuestions:{field,question,purpose}[]; nextAction:"answer_more"|"write_paragraph_1"; studentTask:string。所有提纲和段落提示都要具体到写作对象、写法、细节和推进顺序，但不要替学生写完整作文。',
  materialCard: '只返回合法 JSON 对象，固定键为 title、scene、category、event、people、places、actions、sensoryDetails、emotions、suitableTopics、topicReasons、writingAngles、keywords、completenessScore。根据 input.rawMaterial 这一段学生真实素材自动分类，并生成 5-8 个适合作文题目。topicReasons 每项字段为 topic、reason。people、places、actions、sensoryDetails、emotions、suitableTopics、writingAngles、keywords 必须是字符串数组。不要编造素材中不存在的人物、地点、动作、心理或感官细节；题目可以根据素材主题生成。不要 Markdown，不要解释文字。'
};

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

function guidanceString(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function guidanceList(value, maxItems = 8, maxLength = 220) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          return Object.values(item).map((part) => guidanceString(part, maxLength)).filter(Boolean).join('：');
        }
        return guidanceString(item, maxLength);
      })
      .filter(Boolean)
      .slice(0, maxItems);
  }
  const text = guidanceString(value, maxLength);
  return text ? [text] : [];
}

function normalizeReferenceSuggestion(value) {
  if (typeof value === 'string') return guidanceString(value, 6000);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const normalized = {};
  for (const field of ['issueExplanation', 'revisionStrategy', 'exampleRevision', 'studentAction', 'revisionGoal', 'revisionDepth']) {
    const text = guidanceString(value[field], 1200);
    if (text) normalized[field] = text;
  }
  if (typeof value.factCheck === 'string') {
    normalized.factCheck = guidanceString(value.factCheck, 800);
  } else if (value.factCheck && typeof value.factCheck === 'object' && !Array.isArray(value.factCheck)) {
    normalized.factCheck = {
      summary: guidanceString(value.factCheck.summary, 400),
      usedSourceFacts: guidanceList(value.factCheck.usedSourceFacts, 8, 100),
      addedDetails: guidanceList(value.factCheck.addedDetails, 8, 160),
      coreFactsPreserved: value.factCheck.coreFactsPreserved === true,
      noNewFacts: value.factCheck.noNewFacts === true
    };
  }
  return normalized;
}

function invalidTopicAnalysisOutput(reason) {
  const error = new Error(`题目分析模型输出不符合要求：${reason}`);
  error.status = 502;
  error.failureCode = 'TOPIC_ANALYSIS_INVALID';
  return error;
}

function topicAnalysisString(value, field, maxLength, minimumInformationLength = 1) {
  if (typeof value !== 'string') throw invalidTopicAnalysisOutput(`${field} 必须是字符串`);
  const normalized = value.trim().slice(0, maxLength);
  if (!normalized) throw invalidTopicAnalysisOutput(`${field} 不能为空`);
  if (comparableGuidanceText(normalized).length < minimumInformationLength) {
    throw invalidTopicAnalysisOutput(`${field} 信息量不足`);
  }
  return normalized;
}

function topicAnalysisStringList(value, field, minItems, maxItems, maxLength, minimumInformationLength = 1) {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
    throw invalidTopicAnalysisOutput(`${field} 必须包含 ${minItems}-${maxItems} 项`);
  }
  return value.map((item, index) => (
    topicAnalysisString(item, `${field}[${index}]`, maxLength, minimumInformationLength)
  ));
}

function normalizeTopicAnalysisResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw invalidTopicAnalysisOutput('结果必须是 JSON 对象');
  }
  if (!Array.isArray(result.possibleAngles) || result.possibleAngles.length !== 3) {
    throw invalidTopicAnalysisOutput('possibleAngles 必须正好包含 3 项');
  }
  const possibleAngles = result.possibleAngles.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw invalidTopicAnalysisOutput(`possibleAngles[${index}] 必须是对象`);
    }
    const angleId = topicAnalysisString(item.angleId, `possibleAngles[${index}].angleId`, 80);
    if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]{2,79}$/u.test(angleId)) {
      throw invalidTopicAnalysisOutput(`possibleAngles[${index}].angleId 格式不合理`);
    }
    return {
      angleId,
      title: topicAnalysisString(item.title, `possibleAngles[${index}].title`, 120, 4),
      prompt: topicAnalysisString(item.prompt, `possibleAngles[${index}].prompt`, 360, 6),
      whyThisFitsTopic: topicAnalysisString(item.whyThisFitsTopic, `possibleAngles[${index}].whyThisFitsTopic`, 360, 6),
      materialConnection: topicAnalysisString(item.materialConnection, `possibleAngles[${index}].materialConnection`, 500, 6),
      writingPath: topicAnalysisString(item.writingPath, `possibleAngles[${index}].writingPath`, 500, 6),
      keyDetailsToAsk: topicAnalysisStringList(item.keyDetailsToAsk, `possibleAngles[${index}].keyDetailsToAsk`, 1, 6, 240, 5),
      riskReminder: topicAnalysisString(item.riskReminder, `possibleAngles[${index}].riskReminder`, 300, 6),
      materialHint: topicAnalysisString(item.materialHint, `possibleAngles[${index}].materialHint`, 360, 5)
    };
  });
  if (new Set(possibleAngles.map((angle) => angle.angleId)).size !== possibleAngles.length) {
    throw invalidTopicAnalysisOutput('angleId 必须唯一');
  }
  if (!Array.isArray(result.riskyAngles) || result.riskyAngles.length > 6) {
    throw invalidTopicAnalysisOutput('riskyAngles 必须是最多 6 项的数组');
  }
  const riskyAngles = result.riskyAngles.map((item, index) => {
    if (typeof item === 'string') {
      return {
        title: '风险提醒',
        reason: topicAnalysisString(item, `riskyAngles[${index}]`, 300)
      };
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw invalidTopicAnalysisOutput(`riskyAngles[${index}] 必须是对象或非空字符串`);
    }
    return {
      title: topicAnalysisString(item.title, `riskyAngles[${index}].title`, 120),
      reason: topicAnalysisString(item.reason, `riskyAngles[${index}].reason`, 300)
    };
  });
  return {
    topicKeywords: topicAnalysisStringList(result.topicKeywords, 'topicKeywords', 1, 10, 80),
    coreQuestion: topicAnalysisString(result.coreQuestion, 'coreQuestion', 500),
    possibleAngles,
    riskyAngles,
    suggestedNextQuestions: topicAnalysisStringList(result.suggestedNextQuestions, 'suggestedNextQuestions', 0, 10, 300),
    modelMeta: result.modelMeta || null
  };
}

function resolveSessionAngle(session, selectedAngleId) {
  if (typeof selectedAngleId !== 'string' || !selectedAngleId.trim()) {
    const error = new Error('请先选择一个立意方向');
    error.status = 400;
    error.failureCode = 'ANGLE_REQUIRED';
    throw error;
  }
  const angleId = selectedAngleId.trim().slice(0, 80);
  const possibleAngles = Array.isArray(session?.topicAnalysis?.possibleAngles)
    ? session.topicAnalysis.possibleAngles
    : [];
  const selectedAngle = possibleAngles.find((angle) => (
    angle && typeof angle === 'object' && typeof angle.angleId === 'string' && angle.angleId.trim() === angleId
  ));
  if (!selectedAngle) {
    const error = new Error('所选立意不属于当前作文会话');
    error.status = 400;
    error.failureCode = 'ANGLE_NOT_FOUND';
    throw error;
  }
  const requiredFields = ['angleId', 'title', 'prompt', 'writingPath'];
  if (requiredFields.some((field) => typeof selectedAngle[field] !== 'string' || !selectedAngle[field].trim())) {
    const error = new Error('所选立意结构不完整');
    error.status = 400;
    error.failureCode = 'ANGLE_INVALID';
    throw error;
  }
  return selectedAngle;
}

function normalizeEssayMaterialCard(value, source = 'session_material_card') {
  const item = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : { rawMaterial: value };
  const topicReasons = Array.isArray(item.topicReasons)
    ? item.topicReasons.slice(0, 8).map((reason) => ({
      topic: guidanceString(reason?.topic || '', 120),
      reason: guidanceString(reason?.reason || reason || '', 240)
    })).filter((reason) => reason.topic || reason.reason)
    : [];
  const card = {
    source,
    materialId: guidanceString(item.materialId || item.id || '', 80),
    title: guidanceString(item.title || '', 120),
    scene: guidanceString(item.scene || '', 120),
    category: guidanceString(item.category || '', 80),
    rawMaterial: guidanceString(item.rawMaterial || item.material || item.detail || '', 2000),
    event: guidanceString(item.event || '', 600),
    people: guidanceList(item.people, 12, 120),
    places: guidanceList(item.places, 12, 120),
    actions: guidanceList(item.actions, 16, 180),
    sensoryDetails: guidanceList(item.sensoryDetails, 12, 180),
    emotions: guidanceList(item.emotions, 12, 180),
    suitableTopics: guidanceList(item.suitableTopics, 12, 120),
    topicReasons,
    writingAngles: guidanceList(item.writingAngles, 12, 180),
    keywords: guidanceList(item.keywords, 16, 80)
  };
  const hasContent = Object.entries(card).some(([key, field]) => (
    !['source', 'materialId'].includes(key) && (Array.isArray(field) ? field.length > 0 : Boolean(field))
  ));
  return hasContent ? card : null;
}

function normalizeEssayMaterialCards(value, source, maxItems = 20) {
  const items = (Array.isArray(value) ? value : (value ? [value] : [])).slice(0, maxItems);
  return items.map((item) => normalizeEssayMaterialCard(item, source)).filter(Boolean);
}

function normalizeMaterialAnswers(value, source = 'student_answer', options = {}) {
  if (!Array.isArray(value)) return [];
  const selectedAngleId = options.selectedAngleId;
  const questionSet = options.questionSet && typeof options.questionSet === 'object'
    ? options.questionSet
    : null;
  const questionSetMatches = !questionSet || (
    typeof questionSet.selectedAngleId === 'string' && questionSet.selectedAngleId.trim() === selectedAngleId
  );
  if (!questionSetMatches) return [];
  const knownQuestions = questionSet && Array.isArray(questionSet.questions)
    ? new Map(questionSet.questions
      .filter((question) => question && typeof question.questionId === 'string' && question.questionId.trim())
      .map((question) => [question.questionId.trim(), question]))
    : null;
  return value.slice(0, 30).map((item) => {
    if (!item || typeof item !== 'object') return null;
    if (typeof item.answer !== 'string' || !item.answer.trim()) return null;
    const answer = item.answer.trim().slice(0, 1200);
    const questionId = typeof item.questionId === 'string' ? item.questionId.trim().slice(0, 80) : '';
    const canonicalQuestion = knownQuestions ? knownQuestions.get(questionId) : null;
    if (knownQuestions && !canonicalQuestion) return null;
    const field = canonicalQuestion && typeof canonicalQuestion.field === 'string'
      ? canonicalQuestion.field.trim().slice(0, 80)
      : (typeof item.field === 'string' ? item.field.trim().slice(0, 80) : '');
    const question = canonicalQuestion && typeof canonicalQuestion.question === 'string'
      ? canonicalQuestion.question.trim().slice(0, 360)
      : (typeof item.question === 'string' ? item.question.trim().slice(0, 360) : '');
    if (!answer || (!questionId && !field && !question)) return null;
    return { source, questionId, field, question, answer };
  }).filter(Boolean);
}

function dedupeBy(items, keyForItem) {
  const result = new Map();
  for (const item of items) result.set(keyForItem(item), item);
  return Array.from(result.values());
}

function buildEssayMaterialContext(session, body, selectedAngle) {
  const selectedAngleId = selectedAngle.angleId.trim().slice(0, 80);
  const sessionCards = normalizeEssayMaterialCards(session?.materials, 'session_material_card');
  const requestCards = normalizeEssayMaterialCards(body?.existingMaterials || body?.materials, 'request_material_card');
  const existingMaterials = dedupeBy([...sessionCards, ...requestCards], (card) => (
    card.materialId || JSON.stringify([card.rawMaterial, card.event, card.title, card.actions])
  )).slice(0, 20);
  const answerOptions = { selectedAngleId, questionSet: session?.materialQuestionSet };
  const storedAnswers = normalizeMaterialAnswers(session?.materialAnswers, 'stored_student_answer', answerOptions);
  const priorAnswers = normalizeMaterialAnswers(
    body?.materialAnswers || body?.priorMaterialAnswers || body?.existingAnswers,
    'request_student_answer',
    answerOptions
  );
  const materialAnswers = dedupeBy([...storedAnswers, ...priorAnswers], (answer) => (
    answer.questionId || `${answer.field}\n${answer.question}\n${answer.answer}`
  )).slice(0, 30);
  const initialMaterial = normalizeInitialMaterial(session?.initialMaterial);
  return {
    title: guidanceString(session?.title, 120),
    genre: guidanceString(session?.genre, 40),
    grade: guidanceString(session?.grade, 40),
    selectedAngleId,
    selectedAngle,
    initialMaterial,
    existingMaterials,
    materialAnswers,
    missingFields: guidanceList(body?.missingFields, 12, 80),
    factSources: [
      ...(initialMaterial ? [{ source: 'session_initial_material', content: initialMaterial }] : []),
      ...existingMaterials.map((card) => ({ source: card.source, materialId: card.materialId, content: card.rawMaterial || card.event })),
      ...materialAnswers.map((answer) => ({ source: answer.source, questionId: answer.questionId, content: answer.answer }))
    ],
    qualityRules: [
      '沿所选立意的 writingPath 事件链追问，不偏离当前立意。',
      '优先引用学生已提供的真实素材锚点，不重复追问已知事实。',
      '只引导学生如实补充，不诱导或代替学生虚构任何细节。'
    ]
  };
}

function invalidMaterialQuestionOutput(reason) {
  const error = new Error(`素材追问模型输出不符合要求：${reason}`);
  error.status = 502;
  error.failureCode = 'MATERIAL_QUESTIONS_INVALID';
  return error;
}

function materialQuestionString(value, field, maxLength, allowEmpty = false) {
  if (typeof value !== 'string') {
    throw invalidMaterialQuestionOutput(`${field} 必须是字符串`);
  }
  const normalized = value.trim().slice(0, maxLength);
  if (!allowEmpty && !normalized) {
    throw invalidMaterialQuestionOutput(`${field} 不能为空`);
  }
  return normalized;
}

function comparableGuidanceText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function referenceTextDifferenceThreshold(sourceLength, revisedLength) {
  return Math.max(12, Math.ceil(Math.max(sourceLength, revisedLength) * 0.04));
}

function referenceTextEditDistanceAtLeast(source, revised, threshold) {
  const sourceChars = Array.from(source);
  const revisedChars = Array.from(revised);
  if (Math.abs(sourceChars.length - revisedChars.length) >= threshold) return true;

  let previous = new Uint32Array(revisedChars.length + 1);
  let current = new Uint32Array(revisedChars.length + 1);
  for (let column = 0; column <= revisedChars.length; column += 1) {
    previous[column] = Math.min(column, threshold);
  }

  for (let row = 1; row <= sourceChars.length; row += 1) {
    current.fill(threshold);
    current[0] = Math.min(row, threshold);
    const start = Math.max(1, row - threshold);
    const end = Math.min(revisedChars.length, row + threshold);
    let rowMinimum = current[0];
    for (let column = start; column <= end; column += 1) {
      const substitution = previous[column - 1] + (sourceChars[row - 1] === revisedChars[column - 1] ? 0 : 1);
      current[column] = Math.min(
        threshold,
        previous[column] + 1,
        current[column - 1] + 1,
        substitution
      );
      rowMinimum = Math.min(rowMinimum, current[column]);
    }
    if (rowMinimum >= threshold) return true;
    [previous, current] = [current, previous];
  }
  return previous[revisedChars.length] >= threshold;
}

function hasSubstantiveReferenceChanges(originalText, revisedText) {
  const source = comparableGuidanceText(originalText);
  const revised = comparableGuidanceText(revisedText);
  if (!source || !revised || source === revised) return false;
  const threshold = referenceTextDifferenceThreshold(source.length, revised.length);
  return referenceTextEditDistanceAtLeast(source, revised, threshold);
}

function guidanceInformationLength(value) {
  return comparableGuidanceText(value).length;
}

function isGenericMaterialAnchor(value) {
  let remainder = comparableGuidanceText(value);
  const genericTerms = [
    '这件事情', '这件事', '那件事情', '那件事', '相关', '主要', '具体', '真实', '重要',
    '事情', '事件', '素材', '经历', '过程', '人物', '动作', '感受', '变化', '情况', '细节',
    '内容', '当前', '已有', '所选', '立意', '题目'
  ];
  for (const term of genericTerms) remainder = remainder.split(term).join('');
  return remainder.length < 2;
}

function continuousGuidanceFragments(value, minimumLength) {
  const fragments = new Set();
  const segments = String(value || '')
    .normalize('NFKC')
    .split(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】\[\]{}<>《》「」\-_/\\]+/u)
    .map(comparableGuidanceText)
    .filter((segment) => segment.length >= minimumLength);
  for (const segment of segments) {
    const windowLength = Math.min(minimumLength, segment.length);
    for (let index = 0; index <= segment.length - windowLength; index += 1) {
      const fragment = segment.slice(index, index + windowLength);
      if (!isGenericMaterialAnchor(fragment)) fragments.add(fragment);
    }
  }
  return [...fragments];
}

function containsContinuousGuidanceReference(source, target, minimumLength = 4) {
  const targetText = comparableGuidanceText(target);
  return continuousGuidanceFragments(source, minimumLength).some((fragment) => targetText.includes(fragment));
}

function validateMaterialQuestionQuality(questions, context) {
  for (const [index, question] of questions.entries()) {
    if (guidanceInformationLength(question.question) < 6) {
      throw invalidMaterialQuestionOutput(`第 ${index + 1} 个 question 信息量不足`);
    }
    if (guidanceInformationLength(question.purpose) < 5) {
      throw invalidMaterialQuestionOutput(`第 ${index + 1} 个 purpose 信息量不足`);
    }
    if (guidanceInformationLength(question.materialAnchor) < 3 || isGenericMaterialAnchor(question.materialAnchor)) {
      throw invalidMaterialQuestionOutput(`第 ${index + 1} 个 materialAnchor 过于通用`);
    }
    if (question.detailHints.some((hint) => guidanceInformationLength(hint) < 2)) {
      throw invalidMaterialQuestionOutput(`第 ${index + 1} 个 detailHint 信息量不足`);
    }
  }

  const questionCorpus = questions.map((question) => [
    question.question,
    question.purpose,
    question.materialAnchor,
    ...question.detailHints
  ].join(' ')).join(' ');
  const selectedAngle = context.selectedAngle && typeof context.selectedAngle === 'object'
    ? context.selectedAngle
    : {};
  const angleSources = [
    selectedAngle.title,
    selectedAngle.prompt,
    selectedAngle.writingPath,
    selectedAngle.materialHint
  ].filter(Boolean);
  if (!angleSources.some((source) => containsContinuousGuidanceReference(source, questionCorpus, 4))) {
    throw invalidMaterialQuestionOutput('题组没有实质对应所选立意');
  }

  const initialMaterial = guidanceString(context.initialMaterial, 2000);
  if (initialMaterial) {
    if (!containsContinuousGuidanceReference(initialMaterial, questionCorpus, 2)) {
      throw invalidMaterialQuestionOutput('题组没有实质引用会话初始素材');
    }
  }
}

function normalizeMaterialQuestionResult(result, context) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw invalidMaterialQuestionOutput('结果不是 JSON 对象');
  }
  const selectedAngleId = materialQuestionString(result.selectedAngleId, 'selectedAngleId', 80);
  if (selectedAngleId !== context.selectedAngleId) {
    throw invalidMaterialQuestionOutput('立意 ID 与当前会话不一致');
  }
  materialQuestionString(result.questionSetId, 'questionSetId', 100);
  const nextAction = materialQuestionString(result.nextAction, 'nextAction', 40);
  if (nextAction !== 'answer_questions') {
    throw invalidMaterialQuestionOutput('nextAction 必须为 answer_questions');
  }
  if (!Array.isArray(result.questions) || result.questions.length < 5 || result.questions.length > 7) {
    throw invalidMaterialQuestionOutput('问题数量必须为 5-7 个');
  }

  const questions = result.questions.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw invalidMaterialQuestionOutput(`第 ${index + 1} 个问题不是对象`);
    }
    if (!Array.isArray(item.detailHints) || item.detailHints.length < 2 || item.detailHints.length > 4) {
      throw invalidMaterialQuestionOutput(`第 ${index + 1} 个问题必须有 2-4 个有效回答提示`);
    }
    const detailHints = item.detailHints.map((hint, hintIndex) => (
      materialQuestionString(hint, `第 ${index + 1} 个问题的第 ${hintIndex + 1} 个 detailHint`, 160)
    ));
    const normalized = {
      questionId: materialQuestionString(item.questionId, `第 ${index + 1} 个问题的 questionId`, 80),
      field: materialQuestionString(item.field, `第 ${index + 1} 个问题的 field`, 80),
      category: materialQuestionString(item.category, `第 ${index + 1} 个问题的 category`, 80),
      question: materialQuestionString(item.question, `第 ${index + 1} 个问题的 question`, 360).replace(/\s+/g, ' '),
      purpose: materialQuestionString(item.purpose, `第 ${index + 1} 个问题的 purpose`, 360),
      materialAnchor: materialQuestionString(item.materialAnchor, `第 ${index + 1} 个问题的 materialAnchor`, 360),
      detailHints,
      required: item.required
    };
    if (typeof item.required !== 'boolean') {
      throw invalidMaterialQuestionOutput(`第 ${index + 1} 个问题的 required 必须是布尔值`);
    }
    return normalized;
  });

  if (new Set(questions.map((question) => question.questionId)).size !== questions.length) {
    throw invalidMaterialQuestionOutput('questionId 必须唯一');
  }
  if (new Set(questions.map((question) => question.question)).size !== questions.length) {
    throw invalidMaterialQuestionOutput('归一化后的问题文本必须唯一');
  }
  validateMaterialQuestionQuality(questions, context);
  const requiredQuestionCount = questions.filter((question) => question.required).length;
  if (requiredQuestionCount < 1) {
    throw invalidMaterialQuestionOutput('至少需要一个必答问题');
  }
  if (!Array.isArray(result.materialChecklist)) {
    throw invalidMaterialQuestionOutput('materialChecklist 必须是数组');
  }
  const materialChecklist = result.materialChecklist.slice(0, 12).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw invalidMaterialQuestionOutput(`第 ${index + 1} 个 checklist 项不是对象`);
    }
    if (typeof item.present !== 'boolean') {
      throw invalidMaterialQuestionOutput(`第 ${index + 1} 个 checklist 项的 present 必须是布尔值`);
    }
    return {
      field: materialQuestionString(item.field, `第 ${index + 1} 个 checklist 项的 field`, 80),
      label: materialQuestionString(item.label, `第 ${index + 1} 个 checklist 项的 label`, 120),
      present: item.present,
      value: materialQuestionString(item.value, `第 ${index + 1} 个 checklist 项的 value`, 500, true),
      suggestion: materialQuestionString(item.suggestion, `第 ${index + 1} 个 checklist 项的 suggestion`, 360, true)
    };
  });
  return {
    questionSetId: randomId('question_set'),
    selectedAngleId: context.selectedAngleId,
    selectedAngle: context.selectedAngle,
    questions,
    materialChecklist,
    requiredAnswerCount: requiredQuestionCount,
    nextAction,
    generatedAt: nowIso()
  };
}

function normalizeGuidedOutlineNode(node, index = 0) {
  const source = node && typeof node === 'object' ? node : {};
  const role = guidanceString(source.role || source.label || `第${index + 1}段`, 40);
  const label = guidanceString(source.label || source.title || role, 100);
  return {
    nodeId: guidanceString(source.nodeId || source.id || `p${index + 1}`, 80),
    role,
    label,
    focus: guidanceString(source.focus || source.writeTask || '', 240),
    writeTask: guidanceString(source.writeTask || source.instruction || source.focus || `写清${label}里的真实画面和变化。`, 360),
    writingObjects: guidanceList(source.writingObjects || source.objects || source.mustInclude, 8),
    detailPlan: Array.isArray(source.detailPlan) ? source.detailPlan.slice(0, 8) : guidanceList(source.detailPlan || source.details, 8),
    eventBeats: guidanceList(source.eventBeats || source.beats || source.steps, 8),
    emotionShift: guidanceString(source.emotionShift || source.feelingChange || '', 240),
    transitionHint: guidanceString(source.transitionHint || source.transition || '', 200),
    studentChecklist: guidanceList(source.studentChecklist || source.selfCheck || source.checklist, 8),
    children: Array.isArray(source.children)
      ? source.children.slice(0, 6).map((child, childIndex) => normalizeGuidedOutlineNode(child, childIndex))
      : []
  };
}

function normalizeGuidedOutlineTree(value, session, body = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const children = Array.isArray(source.children) ? source.children : [];
  return {
    title: guidanceString(source.title || session?.title || '作文提纲', 120),
    theme: guidanceString(source.theme || body?.selectedAngle || session?.selectedAngle || '', 160),
    children: children.slice(0, 6).map((node, index) => normalizeGuidedOutlineNode(node, index))
  };
}

function normalizeGuidedParagraphGuide(guide, index = 0) {
  const source = guide && typeof guide === 'object' ? guide : {};
  const role = guidanceString(source.role || `第${index + 1}段`, 40);
  return {
    paragraphId: guidanceString(source.paragraphId || source.id || `p${index + 1}`, 80),
    role,
    goal: guidanceString(source.goal || source.writeTask || `写清${role}的核心内容。`, 360),
    writingTargets: guidanceList(source.writingTargets || source.targets || source.mustInclude, 10),
    howToWrite: Array.isArray(source.howToWrite) ? source.howToWrite.slice(0, 10) : guidanceList(source.howToWrite || source.method, 10),
    detailsToInclude: guidanceList(source.detailsToInclude || source.mustInclude || source.details, 10),
    developmentSteps: guidanceList(source.developmentSteps || source.steps || source.eventBeats, 10),
    sensoryDetails: guidanceList(source.sensoryDetails, 8),
    innerThoughtPrompts: guidanceList(source.innerThoughtPrompts || source.thoughtPrompts, 8),
    mustInclude: guidanceList(source.mustInclude || source.detailsToInclude, 10),
    writingPrompts: guidanceList(source.writingPrompts || source.prompts, 10),
    starterHint: guidanceString(source.starterHint || source.start || '', 260),
    avoid: guidanceList(source.avoid, 8),
    selfCheck: guidanceList(source.selfCheck || source.studentChecklist, 8),
    suggestedLength: guidanceString(source.suggestedLength || '', 40)
  };
}

function normalizeGuidedParagraphGuides(value) {
  return Array.isArray(value)
    ? value.slice(0, 6).map((guide, index) => normalizeGuidedParagraphGuide(guide, index))
    : [];
}

function guidedStudentTask(nextAction, paragraphGuides, fallback = '') {
  if (nextAction === 'answer_more') {
    return guidanceString(fallback || '先回答上面的补充问题，再生成正式写作引导。', 400);
  }
  const first = Array.isArray(paragraphGuides) ? paragraphGuides[0] : null;
  const firstRole = first?.role ? `“${first.role}”` : '第 1 段';
  return guidanceString(fallback || `先写${firstRole}，只写自己的真实经历和可看见的细节，不急着总结大道理。`, 400);
}

function inferMaterialCategory(rawMaterial) {
  const raw = String(rawMaterial || '');
  if (/运动|跑|比赛|终点|操场|800米|接力|跳远/.test(raw)) return '挫折与坚持';
  if (/妈妈|爸爸|爷爷|奶奶|家|厨房|书包|生病|发烧/.test(raw)) return '亲情与责任';
  if (/同学|朋友|伙伴|老师|班级|课堂|校园/.test(raw)) return '校园与成长';
  if (/错题|考试|试卷|分数|竞赛|作业/.test(raw)) return '学习与反思';
  if (/公园|树|雨|鸟|花|风|秋|春|观察/.test(raw)) return '自然观察';
  return '真实经历';
}

function inferMaterialScene(rawMaterial, category) {
  const raw = String(rawMaterial || '');
  if (/操场|跑道|运动会|终点/.test(raw)) return '校园运动会';
  if (/厨房|书包|妈妈|爸爸|家里/.test(raw)) return '家庭生活';
  if (/教室|课堂|老师|同学|班级/.test(raw)) return '校园生活';
  if (/公园|山|鸟林|树林|湖/.test(raw)) return '自然观察';
  return category || '生活场景';
}

function inferMaterialTitle(rawMaterial, category) {
  const raw = guidanceString(rawMaterial, 120);
  const matches = [
    raw.match(/(800米[^，。；\s]{0,8})/),
    raw.match(/(最后一圈)/),
    raw.match(/(第一次[^，。；\s]{0,12})/),
    raw.match(/(一碗粥)/),
    raw.match(/(错题本)/),
    raw.match(/(鸟林[^，。；\s]{0,8})/)
  ].filter(Boolean);
  if (matches.length) return guidanceString(matches[0][1], 40);
  return `${category || '素材'}片段`;
}

function localSuitableTopics(category, rawMaterial) {
  const raw = String(rawMaterial || '');
  if (/800米|最后一圈|终点|操场/.test(raw)) {
    return ['坚持的力量', '那一次，我没有放弃', '身边的鼓励', '难忘的运动会', '越过终点以后'];
  }
  if (/妈妈|发烧|煮粥|书包/.test(raw)) {
    return ['那一刻，我长大了', '一件小事里的责任', '我学会了照顾别人', '藏在书包里的爱', '第一次主动承担'];
  }
  if (/错题|考试|试卷|分数/.test(raw)) {
    return ['一次失败后的收获', '我学会了面对错误', '错题本里的成长', '那一次，我没有逃避', '从挫折中站起来'];
  }
  if (/公园|鸟|秋|雨|树|观察/.test(raw)) {
    return ['一次秋游踏青', '观察带来的发现', '藏在自然里的课堂', '难忘的一次出行', '我发现了耐心的意义'];
  }
  return [`难忘的${category || '经历'}`, '那一次，我有了新发现', '生活中的一件小事', '一次真实的成长', '我记住了那个瞬间'];
}

function normalizeTopicReasons(value, topics) {
  const list = Array.isArray(value) ? value : [];
  const normalized = list.map((item) => {
    if (item && typeof item === 'object') {
      return {
        topic: guidanceString(item.topic || item.title, 80),
        reason: guidanceString(item.reason || item.explanation, 240)
      };
    }
    return { topic: guidanceString(item, 80), reason: '这个题目能承接素材中的真实事件和变化。' };
  }).filter((item) => item.topic);
  const existing = new Set(normalized.map((item) => item.topic));
  for (const topic of topics) {
    if (!existing.has(topic)) {
      normalized.push({ topic, reason: '这个题目能围绕素材里的真实动作、感受和变化展开。' });
    }
    if (normalized.length >= 8) break;
  }
  return normalized.slice(0, 8);
}

function normalizeSmartMaterialCard(value, rawMaterial, meta = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const category = guidanceString(source.category || inferMaterialCategory(rawMaterial), 80);
  const scene = guidanceString(source.scene || inferMaterialScene(rawMaterial, category), 80);
  const topics = guidanceList(source.suitableTopics, 8, 80);
  const suitableTopics = topics.length >= 3 ? topics : localSuitableTopics(category, rawMaterial);
  const eventText = guidanceString(source.event || rawMaterial, 1000);
  const completeness = Number(source.completenessScore);
  return {
    title: guidanceString(source.title || inferMaterialTitle(rawMaterial, category), 80),
    scene,
    category,
    event: eventText || guidanceString(rawMaterial, 1000),
    people: guidanceList(source.people, 8, 60),
    places: guidanceList(source.places || source.place, 8, 80),
    actions: guidanceList(source.actions, 10, 120),
    sensoryDetails: guidanceList(source.sensoryDetails, 10, 140),
    emotions: guidanceList(source.emotions || source.feelings, 10, 100),
    suitableTopics,
    topicReasons: normalizeTopicReasons(source.topicReasons, suitableTopics),
    writingAngles: guidanceList(source.writingAngles, 8, 160),
    keywords: guidanceList(source.keywords, 12, 40),
    completenessScore: Number.isFinite(completeness) ? clamp(completeness, 0, 100) : Math.max(40, Math.min(100, 45 + countCjk(rawMaterial))),
    localFallback: Boolean(meta.localFallback || source.localFallback),
    modelFallbackReasonCode: guidanceString(meta.modelFallbackReasonCode || source.modelFallbackReasonCode, 80),
    modelMeta: source.modelMeta || meta.modelMeta || null
  };
}

async function buildSmartMaterialCard(rawMaterial, session) {
  try {
    const modelResult = await callEssayGuidanceModel('素材智能分类与题目生成', {
      rawMaterial,
      title: session?.title,
      grade: session?.grade,
      genre: session?.genre
    }, GUIDANCE_OUTPUT_CONTRACTS.materialCard, { maxTokens: 2600 });
    return normalizeSmartMaterialCard(modelResult, rawMaterial);
  } catch (error) {
    const fallback = essayGuidance.saveMaterialCard({ event: rawMaterial });
    return normalizeSmartMaterialCard(fallback.material, rawMaterial, {
      localFallback: true,
      modelFallbackReasonCode: error?.failureCode || error?.code || '',
      modelMeta: null
    });
  }
}


app.get('/api/v1/me', (req, res) => {
  const viewer = summarizeViewer(req, res);
  const userId = currentStudentId(req, res);
  return v1Success(req, res, {
    user: viewer.user,
    abilityProfileSummary: state.abilityProfiles.find((item) => item.userId === userId) || null,
    activePlanSummary: latestTrainingPlanForUser(userId) || null,
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

    const result = await callEssayGuidanceModel('文风档案生成', { writingSamples }, GUIDANCE_OUTPUT_CONTRACTS.styleProfile);

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
    const session = assertOwnedEssaySession(req, res, req.params.sessionId);
    return v1Success(req, res, serializeEssaySession(session));
  } catch (error) {
    return v1Error(req, res, error.status || 500, error.failureCode || 'SESSION_ERROR', error.message || '读取作文会话失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/topic-analysis', async (req, res) => {
  try {
    const session = assertOwnedEssaySession(req, res, req.params.sessionId);
    const initialMaterial = normalizeInitialMaterial(
      req.body?.initialMaterial || req.body?.existingMaterials || req.body?.material || session.initialMaterial || session.materials
    );
    const input = {
      title: req.body?.title || session.title,
      genre: req.body?.genre || session.genre,
      grade: req.body?.grade || session.grade,
      target: req.body?.target,
      initialMaterial,
      existingMaterials: initialMaterial
    };
    const operation = beginEssayOperation(session, 'topic-analysis');
    const modelResult = await awaitEssayOperation(
      session,
      operation,
      callEssayGuidanceModel('题目理解与立意建议', input, GUIDANCE_OUTPUT_CONTRACTS.topicAnalysis)
    );
    const result = normalizeTopicAnalysisResult(modelResult);
    touchEssaySession(session, {
      topicAnalysis: result,
      initialMaterial: initialMaterial || session.initialMaterial || '',
      selectedAngleId: '',
      selectedAngle: '',
      selectedAngleSnapshot: null,
      materialQuestionSet: null,
      materialAnswers: [],
      additionalMaterial: '',
      additionalMaterialSessionId: '',
      additionalMaterialQuestionSetId: '',
      additionalMaterialSelectedAngleId: '',
      guidedWriting: null,
      latestGuideId: '',
      status: 'topic_analyzed'
    });
    return v1Success(req, res, result);
  } catch (error) {
    return v1ModelCatch(req, res, error, 'TOPIC_ANALYSIS_FAILED', '题目分析失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/material-questions', async (req, res) => {
  try {
    const session = assertOwnedEssaySession(req, res, req.params.sessionId);
    const selectedAngle = resolveSessionAngle(session, req.body?.selectedAngleId);
    const input = buildEssayMaterialContext(session, req.body || {}, selectedAngle);
    const operation = beginEssayOperation(session, 'material-questions');
    const modelResult = await awaitEssayOperation(
      session,
      operation,
      callEssayGuidanceModel('素材追问', input, GUIDANCE_OUTPUT_CONTRACTS.materialQuestions)
    );
    const questionSet = normalizeMaterialQuestionResult(modelResult, input);
    touchEssaySession(session, {
      selectedAngleId: input.selectedAngleId,
      selectedAngle: guidanceString(selectedAngle.title, 120),
      selectedAngleSnapshot: selectedAngle,
      materialQuestionSet: questionSet,
      materialAnswers: [],
      additionalMaterial: '',
      additionalMaterialSessionId: '',
      additionalMaterialQuestionSetId: '',
      additionalMaterialSelectedAngleId: '',
      guidedWriting: null,
      latestGuideId: '',
      status: 'collecting_materials'
    });
    return v1Success(req, res, questionSet);
  } catch (error) {
    return v1ModelCatch(req, res, error, 'MATERIAL_QUESTIONS_FAILED', '素材追问失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/materials', async (req, res) => {
  try {
    const session = assertOwnedEssaySession(req, res, req.params.sessionId);
    const rawMaterial = String(req.body?.rawMaterial || req.body?.event || req.body?.detail || '').trim().slice(0, 2000);
    if (countCjk(rawMaterial) < 10) {
      return v1Error(req, res, 400, 'MATERIAL_TOO_SHORT', '请至少输入一段具体素材');
    }
    const smartMaterial = await buildSmartMaterialCard(rawMaterial, session);
    const material = {
      id: randomId('material'),
      materialId: '',
      sessionId: session.id,
      ...smartMaterial,
      rawMaterial,
      createdAt: nowIso()
    };
    material.materialId = material.id;
    state.essayMaterials = state.essayMaterials || [];
    state.essayMaterials.push(material);
    session.materials = [...(session.materials || []), material];
    touchEssaySession(session, { status: 'materials_saved' });
    return v1Success(req, res, {
      materialId: material.id,
      completenessScore: material.completenessScore,
      missingSuggestions: [],
      material
    });
  } catch (error) {
    return v1Error(req, res, error.status || 500, error.failureCode || 'MATERIAL_SAVE_FAILED', error.message || '保存素材失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/outline', async (req, res) => {
  try {
    const session = assertOwnedEssaySession(req, res, req.params.sessionId);
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
    const session = assertOwnedEssaySession(req, res, req.params.sessionId);
    const hasSubmittedAdditionalMaterial = Object.prototype.hasOwnProperty.call(req.body || {}, 'additionalMaterial');
    let additionalMaterial = '';
    if (hasSubmittedAdditionalMaterial) {
      if (typeof req.body.additionalMaterial !== 'string' || !req.body.additionalMaterial.trim()) {
        return v1Error(req, res, 400, 'ADDITIONAL_MATERIAL_REQUIRED', '请填写要补充的真实素材');
      }
      additionalMaterial = req.body.additionalMaterial.trim();
    }
    if (!API_BASE_URL || !API_KEY || !ESSAY_GUIDANCE_MODEL) {
      const error = new Error('DeepSeek 指导模型暂时不可用');
      error.status = 503;
      error.failureCode = 'MODEL_UNAVAILABLE';
      throw error;
    }
    const requestedAngleId = typeof req.body?.selectedAngleId === 'string' && req.body.selectedAngleId.trim()
      ? req.body.selectedAngleId
      : session.selectedAngleId;
    const selectedAngle = resolveSessionAngle(session, requestedAngleId);
    const questionSetId = typeof req.body?.questionSetId === 'string' ? req.body.questionSetId.trim().slice(0, 100) : '';
    if (!questionSetId) {
      const error = new Error('请先生成并使用当前素材追问题组');
      error.status = 400;
      error.failureCode = 'QUESTION_SET_REQUIRED';
      throw error;
    }
    const questionSet = session.materialQuestionSet && typeof session.materialQuestionSet === 'object'
      ? session.materialQuestionSet
      : null;
    if (!questionSet || questionSet.questionSetId !== questionSetId) {
      const error = new Error('素材追问题组已失效，请重新生成');
      error.status = 400;
      error.failureCode = 'QUESTION_SET_MISMATCH';
      throw error;
    }
    if (questionSet.selectedAngleId !== selectedAngle.angleId) {
      const error = new Error('素材追问题组与当前立意不一致');
      error.status = 400;
      error.failureCode = 'ANGLE_MISMATCH';
      throw error;
    }
    if (hasSubmittedAdditionalMaterial) {
      if (additionalMaterial.length > 2000) {
        return v1Error(req, res, 400, 'ADDITIONAL_MATERIAL_TOO_LONG', '补充素材不能超过2000字');
      }
    } else if (
      session.additionalMaterialSessionId === session.id
      && session.additionalMaterialQuestionSetId === questionSetId
      && session.additionalMaterialSelectedAngleId === selectedAngle.angleId
    ) {
      additionalMaterial = String(session.additionalMaterial || '').trim();
    }
    const materialAnswers = dedupeBy(
      normalizeMaterialAnswers(req.body?.materialAnswers, 'student_answer', {
        selectedAngleId: selectedAngle.angleId,
        questionSet
      }),
      (answer) => answer.questionId
    ).slice(0, 30);
    const requiredQuestionIds = new Set((Array.isArray(questionSet.questions) ? questionSet.questions : [])
      .filter((question) => question?.required && question?.questionId)
      .map((question) => String(question.questionId)));
    const answeredRequiredCount = materialAnswers
      .filter((answer) => requiredQuestionIds.has(answer.questionId)).length;
    if (answeredRequiredCount < requiredQuestionIds.size) {
      const error = new Error(`还需回答 ${requiredQuestionIds.size - answeredRequiredCount} 个必答素材问题`);
      error.status = 400;
      error.failureCode = 'MATERIAL_ANSWERS_INCOMPLETE';
      throw error;
    }
    const materialContext = buildEssayMaterialContext(
      { ...session, materialAnswers: [] },
      {},
      selectedAngle
    );
    const input = {
      ...materialContext,
      questionSetId,
      selectedAngleId: selectedAngle.angleId,
      selectedAngle,
      additionalMaterial,
      materialAnswers,
      factSources: [
        ...materialContext.factSources,
        ...(additionalMaterial ? [{
          source: 'student_additional_material',
          sessionId: session.id,
          questionSetId,
          selectedAngleId: selectedAngle.angleId,
          content: additionalMaterial
        }] : []),
        ...materialAnswers.map((answer) => ({
          source: answer.source,
          questionId: answer.questionId,
          content: answer.answer
        }))
      ],
      preferredStructure: guidanceString(req.body?.preferredStructure || session.genre, 80),
      boundary: '只生成提纲树、段落任务和追问提示，不生成完整作文或完整段落。'
    };
    const operation = beginEssayOperation(session, 'guided-writing');
    const outlineResult = await awaitEssayOperation(
      session,
      operation,
      callEssayGuidanceModel(
        '短期写作引导：生成提纲树',
        input,
        GUIDANCE_OUTPUT_CONTRACTS.outlineTree,
        { maxTokens: 4200 }
      )
    );
    const outlineTree = normalizeGuidedOutlineTree(outlineResult.outlineTree, session, req.body);
    const paragraphResult = await awaitEssayOperation(
      session,
      operation,
      callEssayGuidanceModel(
        '短期写作引导：生成段落写作提示',
        { ...input, outlineTree },
        GUIDANCE_OUTPUT_CONTRACTS.paragraphGuides,
        { maxTokens: 5200 }
      )
    );
    const paragraphGuides = normalizeGuidedParagraphGuides(paragraphResult.paragraphGuides);
    const missingMaterialQuestions = Array.isArray(paragraphResult.missingMaterialQuestions) ? paragraphResult.missingMaterialQuestions : [];
    const nextAction = paragraphResult.nextAction === 'answer_more' ? 'answer_more' : 'write_paragraph_1';
    const guide = {
      id: randomId('guide'),
      guideId: '',
      sessionId: session.id,
      questionSetId,
      selectedAngle: guidanceString(selectedAngle.title, 120),
      selectedAngleId: selectedAngle.angleId,
      materialAnswers,
      outlineTree,
      paragraphGuides,
      missingMaterialQuestions,
      nextAction,
      studentTask: guidedStudentTask(nextAction, paragraphGuides, paragraphResult.studentTask),
      modelMeta: {
        provider: 'deepseek-compatible',
        outline: outlineResult.modelMeta || null,
        paragraphGuides: paragraphResult.modelMeta || null
      },
      createdAt: nowIso()
    };
    guide.guideId = guide.id;
    state.essayGuides = state.essayGuides || [];
    state.essayGuides.push(guide);
    touchEssaySession(session, {
      selectedAngleId: selectedAngle.angleId,
      selectedAngle: guide.selectedAngle,
      selectedAngleSnapshot: selectedAngle,
      materialAnswers,
      additionalMaterial,
      additionalMaterialSessionId: additionalMaterial ? session.id : '',
      additionalMaterialQuestionSetId: additionalMaterial ? questionSetId : '',
      additionalMaterialSelectedAngleId: additionalMaterial ? selectedAngle.angleId : '',
      guidedWriting: guide,
      latestGuideId: guide.id,
      status: 'guided_writing'
    });
    return v1Success(req, res, guide);
  } catch (error) {
    return v1ModelCatch(req, res, error, 'GUIDED_WRITING_FAILED', '生成写作引导失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/diagnose', async (req, res) => {
  try {
    const session = assertOwnedEssaySession(req, res, req.params.sessionId);
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
    touchEssaySession(session, { draftText, latestDiagnosticId: diagnostic.id, status: 'diagnosed' });
    return v1Success(req, res, diagnostic);
  } catch (error) {
    return v1ModelCatch(req, res, error, 'DIAGNOSE_FAILED', '作文体检失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/revision-suggestions', async (req, res) => {
  try {
    const session = assertOwnedEssaySession(req, res, req.params.sessionId);
    const diagnostic = findCurrentEssayDiagnostic(session, req.body?.diagnosticId);
    if (!diagnostic) return v1Error(req, res, 404, 'DIAGNOSTIC_NOT_FOUND', '请先完成作文体检');
    const factBoundary = req.body?.keepFactsStrict
      ? [
        '必须严格保持事实边界：不得新增人物、地点、时间、事件、结果、对话、心理变化或关键物件。',
        '只允许使用 draftText、diagnostic.highlightedSegments 和 diagnostic.priorityIssues 中已经出现的事实。',
        '如果示范修改需要学生补充新事实，必须把问题写进 studentAction，不能直接写进 exampleRevision。',
        'exampleRevision 只能做局部示范，不改写全文。'
      ].join('\n')
      : '保留核心经历和结果；允许局部示范补充合理的环境、动作、感官、心理等描写，并在 factCheck.addedDetails 中列出，提醒学生核对。';
    const input = {
      title: session.title,
      genre: session.genre,
      grade: session.grade,
      draftText: session.draftText,
      diagnostic,
      segmentId: req.body?.segmentId,
      revisionGoal: guidanceString(req.body?.revisionGoal, 240),
      revisionDepth: guidanceString(req.body?.revisionDepth, 240),
      keepFactsStrict: req.body?.keepFactsStrict,
      factBoundary
    };
    const strictRevisionContract = input.keepFactsStrict === true
      ? ' 当 input.keepFactsStrict=true 时，exampleRevision 不得新增人物、地点、时间、事件、结果、对话、心理变化或关键物件，只允许使用 draftText、diagnostic.highlightedSegments 和 diagnostic.priorityIssues 中已经出现的事实；需要学生补充的新事实只能写进 studentAction，不能写进 exampleRevision。'
      : '';
    const result = await callEssayGuidanceModel(
      '局部修改建议',
      input,
      `${GUIDANCE_OUTPUT_CONTRACTS.revision}${strictRevisionContract}`
    );
    const suggestionId = randomId('revision_suggestion');
    const suggestion = {
      ...result,
      suggestionId,
      revisionId: suggestionId,
      diagnosticId: diagnostic.id,
      revisionGoal: input.revisionGoal,
      revisionDepth: input.revisionDepth,
      createdAt: nowIso()
    };
    const revisionSuggestions = Array.isArray(session.revisionSuggestions) ? session.revisionSuggestions : [];
    touchEssaySession(session, {
      status: 'revision_suggested',
      revisionSuggestions: [...revisionSuggestions, suggestion].slice(-10)
    });
    return v1Success(req, res, suggestion);
  } catch (error) {
    return v1ModelCatch(req, res, error, 'REVISION_SUGGESTION_FAILED', '局部修改建议失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/reference-rewrite', async (req, res) => {
  try {
    const session = assertOwnedEssaySession(req, res, req.params.sessionId);
    const originalText = String(session.draftText || '').trim();
    if (countCjk(originalText) < 20) {
      return v1Error(req, res, 400, 'ESSAY_TOO_SHORT', '作文草稿过短，请返回工作台重新完成体检');
    }
    if (countCjk(originalText) > MAX_CHARS) {
      return v1Error(req, res, 400, 'ESSAY_TOO_LONG', '作文超过5000字限制');
    }
    if (req.body?.originalText && String(req.body.originalText).trim() !== originalText) {
      return v1Error(req, res, 409, 'DRAFT_CONTEXT_MISMATCH', '当前作文内容已变化，请返回工作台重新完成体检');
    }

    const diagnostic = findCurrentEssayDiagnostic(session, req.body?.diagnosticId);
    if (!diagnostic) {
      return v1Error(req, res, 404, 'DIAGNOSTIC_NOT_FOUND', '当前作文没有可用的体检结果，请返回工作台重新体检');
    }

    const suggestionId = String(req.body?.suggestionId || req.body?.revisionId || '').trim();
    const sessionSuggestions = Array.isArray(session.revisionSuggestions) ? session.revisionSuggestions : [];
    let revisionSuggestion = null;
    if (suggestionId) {
      revisionSuggestion = sessionSuggestions.find((item) => (
        (item.suggestionId === suggestionId || item.revisionId === suggestionId)
        && item.diagnosticId === diagnostic.id
      )) || null;
      if (!revisionSuggestion) {
        return v1Error(req, res, 404, 'REVISION_SUGGESTION_NOT_FOUND', '修改建议已失效，请返回工作台重新生成建议');
      }
    } else if (req.body?.revisionSuggestion != null) {
      revisionSuggestion = req.body.revisionSuggestion;
    }
    if (revisionSuggestion != null) {
      revisionSuggestion = normalizeReferenceSuggestion(revisionSuggestion);
      if (revisionSuggestion == null) {
        return v1Error(req, res, 400, 'INVALID_REVISION_SUGGESTION', '修改建议格式无效');
      }
      let suggestionLength = 0;
      try {
        suggestionLength = JSON.stringify(revisionSuggestion).length;
      } catch (_) {
        return v1Error(req, res, 400, 'INVALID_REVISION_SUGGESTION', '修改建议格式无效');
      }
      if (suggestionLength > 6000) {
        return v1Error(req, res, 400, 'REVISION_SUGGESTION_TOO_LONG', '修改建议内容过长，请重新生成');
      }
    }

    const diagnosticContext = {
      overallComment: guidanceString(diagnostic.overallComment, 1200),
      dimensionScores: diagnostic.dimensionScores && typeof diagnostic.dimensionScores === 'object' ? diagnostic.dimensionScores : {},
      priorityIssues: Array.isArray(diagnostic.priorityIssues) ? diagnostic.priorityIssues.slice(0, 8) : [],
      highlightedSegments: Array.isArray(diagnostic.highlightedSegments) ? diagnostic.highlightedSegments.slice(0, 12) : [],
      suggestedRevisionPath: guidanceList(diagnostic.suggestedRevisionPath, 8, 240)
    };
    const revisionGoal = guidanceString(req.body?.revisionGoal || revisionSuggestion?.revisionGoal, 240);
    const revisionDepth = guidanceString(req.body?.revisionDepth || revisionSuggestion?.revisionDepth, 240);
    const revisionSuggestionText = guidanceString(req.body?.revisionSuggestionText, 4000);
    const input = {
      title: guidanceString(session.title, 120),
      genre: guidanceString(session.genre, 40),
      grade: guidanceString(session.grade, 40),
      originalText,
      diagnostic: diagnosticContext,
      priorityIssues: diagnosticContext.priorityIssues,
      revisionSuggestion,
      revisionSuggestionText,
      revisionGoal,
      revisionDepth
    };
    const result = await callEssayGuidanceModel(
      '根据体检报告生成润色参考改写',
      input,
      GUIDANCE_OUTPUT_CONTRACTS.referenceRewrite,
      { maxTokens: 7000 }
    );
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return v1Error(req, res, 502, 'REFERENCE_REWRITE_INVALID', '模型返回的参考改写格式无效，请重试');
    }
    const revisedText = String(result.revisedText || '').trim();
    if (countCjk(revisedText) < 20 || countCjk(revisedText) > MAX_CHARS) {
      return v1Error(req, res, 502, 'REFERENCE_REWRITE_INVALID', '模型没有生成长度有效的参考改写，请重试');
    }
    return v1Success(req, res, { originalText, revisedText, changes: result.changes });
  } catch (error) {
    return v1ModelCatch(req, res, error, 'REFERENCE_REWRITE_FAILED', '生成参考改写失败');
  }
});

app.post('/api/v1/essay-sessions/:sessionId/compare-drafts', async (req, res) => {
  try {
    assertOwnedEssaySession(req, res, req.params.sessionId);
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
    const session = assertOwnedEssaySession(req, res, req.params.sessionId);
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
  const userId = currentStudentId(req, res);
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
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ...result,
      dimensionScores: withAbilityScoreAliases(result.dimensionScores)
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
  const userId = currentStudentId(req, res);
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
  const userId = currentStudentId(req, res);
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
    const recentChanges = changedDimensions.map((dimension) => {
      const before = Number(existing?.dimensionScores?.[dimension] ?? 60);
      const after = Number(updatedProfile?.dimensionScores?.[dimension] ?? before);
      return {
        dimension,
        before,
        after,
        delta: after - before,
        evidence: String(dimensionEvidence[dimension] || '').trim().slice(0, 240),
        createdAt: now
      };
    });
    const merged = {
      ...updatedProfile,
      userId,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      id: existing?.id || randomId('ability_profile'),
      recentChanges: [...(existing?.recentChanges || []), ...recentChanges].slice(-20)
    };
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
  const userId = currentStudentId(req, res);
  try {
    const requestedPlanType = String(req.body?.planType || '7d').trim() || '7d';
    if (requestedPlanType !== '7d') {
      return v1Error(req, res, 400, 'TRAINING_PLAN_TYPE_UNSUPPORTED', '当前只支持 7 天单篇作文训练计划');
    }
    const result = await longTermAbility.buildTrainingPlanTasks(req.body || {});
    // Assign task ids and transform to plan.days (flat tasks array expected by module)
    const tasks = (result.tasks || []).map((t) => ({ ...t, taskId: randomId('task') }));
    const createdAt = nowIso();
    const plan = {
      id: randomId('training_plan'),
      planId: '',
      userId,
      planType: String(result.planType || req.body?.planType || '7d'),
      status: '进行中',
      createdAt,
      startDate: createdAt.slice(0,10),
      focusDimensions: result.focusDimensions || [],
      totalDays: result.totalDays || tasks.length,
      dailyMinutes: result.dailyMinutes || 15,
      context: result.context || {},
      artifacts: {},
      progress: { currentStageId: 'topic_angle', completedStageIds: [] },
      days: tasks
    };
    plan.planId = plan.id;
    archiveActiveTrainingPlansForUser(userId, plan.id);
    state.trainingPlans.push(plan);
    saveState();
    return v1Success(req, res, plan);
  } catch (err) {
    return v1Error(req, res, 500, 'PLAN_CREATE_FAILED', err?.message || '训练计划生成失败');
  }
});

app.get('/api/v1/training-plans/active', (req, res) => {
  const userId = currentStudentId(req, res);
  return v1Success(req, res, latestTrainingPlanForUser(userId) || notImplementedData('activeTrainingPlan'));
});

app.get('/api/v1/training-plans/:planId', (req, res) => {
  const plan = state.trainingPlans.find((item) => item.id === req.params.planId || item.planId === req.params.planId);
  if (!plan) return v1Error(req, res, 404, 'PLAN_NOT_FOUND', '训练计划不存在');
  if (plan.userId !== currentStudentId(req, res)) return v1Error(req, res, 403, 'PLAN_FORBIDDEN', '无权查看该训练计划');
  return v1Success(req, res, plan);
});

function findPlanTask(planId, taskId) {
  const plan = (state.trainingPlans || []).find((item) => item.id === planId || item.planId === planId);
  if (!plan) return { error: 'PLAN_NOT_FOUND' };
  const task = (plan.days || []).find((item) => item.taskId === taskId);
  if (!task) return { error: 'TASK_NOT_FOUND', plan };
  return { plan, task };
}

function nextStageIdForTask(plan, task) {
  const days = Array.isArray(plan?.days) ? plan.days : [];
  const index = days.findIndex((item) => item.taskId === task.taskId);
  return index >= 0 && days[index + 1] ? days[index + 1].stageId || '' : '';
}

app.post('/api/v1/training-plans/:planId/tasks/:taskId/run', async (req, res) => {
  const found = findPlanTask(req.params.planId, req.params.taskId);
  if (found.error === 'PLAN_NOT_FOUND') return v1Error(req, res, 404, 'PLAN_NOT_FOUND', '训练计划不存在');
  if (found.error === 'TASK_NOT_FOUND') return v1Error(req, res, 404, 'TASK_NOT_FOUND', '训练任务不存在');
  if (found.plan.userId !== currentStudentId(req, res)) return v1Error(req, res, 403, 'PLAN_FORBIDDEN', '无权操作该训练计划');
  const stageId = found.task.stageId || found.task.taskId || '';
  const days = Array.isArray(found.plan.days) ? found.plan.days : [];
  const completedStageIds = new Set(found.plan.progress?.completedStageIds || []);
  const expectedStage = days.find((day) => (day.stageId || day.taskId || '') === found.plan.progress?.currentStageId)
    || days.find((day) => !completedStageIds.has(day.stageId || day.taskId || '') && day.status !== '已完成')
    || null;
  const expectedStageId = expectedStage ? (expectedStage.stageId || expectedStage.taskId || '') : '';
  if (found.plan.status === '已完成' || !expectedStageId || stageId !== expectedStageId) {
    return v1Error(req, res, 409, 'TRAINING_STAGE_OUT_OF_ORDER', expectedStage
      ? `请先完成当前阶段：${expectedStage.stageTitle || expectedStage.title || '训练任务'}`
      : '当前训练计划已完成，不能继续运行阶段任务');
  }
  try {
    const result = await runSevenDayTrainingTask({
      plan: found.plan,
      task: found.task,
      input: req.body?.input || {},
      callModel: callEssayGuidanceModel,
      outputContracts: GUIDANCE_OUTPUT_CONTRACTS
    });
    found.plan.artifacts = found.plan.artifacts || {};
    found.plan.artifacts[found.task.stageId || found.task.taskId] = result.artifact;
    found.plan.stageInputs = found.plan.stageInputs || {};
    found.plan.stageInputs[found.task.stageId || found.task.taskId] = req.body?.input || {};
    found.task.status = '已完成';
    found.task.completedAt = nowIso();
    found.plan.progress = found.plan.progress || { currentStageId: '', completedStageIds: [] };
    found.plan.progress.completedStageIds = Array.from(new Set([...(found.plan.progress.completedStageIds || []), found.task.stageId || found.task.taskId]));
    if (!result.nextStageId && (found.task.stageId || '') === 'revision_reflection') {
      found.plan.status = '已完成';
      found.plan.completedAt = nowIso();
      found.plan.progress.currentStageId = '';
    } else {
      found.plan.progress.currentStageId = result.nextStageId || found.task.stageId || '';
    }
    found.plan.updatedAt = nowIso();
    saveState();
    return v1Success(req, res, {
      ...result,
      planProgress: found.plan.progress,
      planStatus: found.plan.status,
      uiHints: {
        currentStageId: found.task.stageId || found.task.taskId || '',
        nextStageId: result.nextStageId || '',
        completed: found.plan.status === '已完成'
      }
    });
  } catch (err) {
    return v1Error(req, res, 500, 'TRAINING_TASK_RUN_FAILED', err?.message || '训练任务执行失败');
  }
});

app.get('/api/v1/training-tasks/today', (req, res) => {
  const userId = currentStudentId(req, res);
  const plan = latestTrainingPlanForUser(userId);
  if (!plan) return v1Success(req, res, essayGuidance.todayTasks());
  const today = longTermAbility.todayTasksFromPlan(plan);
  return v1Success(req, res, {
    ...today,
    planId: plan.id || plan.planId || '',
    planType: plan.planType || '',
    totalDays: Array.isArray(plan.days) ? plan.days.length : 0,
    source: 'activeTrainingPlan'
  });
});

app.get('/api/v1/training-tasks/:taskId', (req, res) => {
  const plans = state.trainingPlans || [];
  const taskId = String(req.params?.taskId || '').trim();
  const ownerId = currentStudentId(req, res);
  const allTasks = plans.filter((plan) => plan.userId === ownerId).flatMap((plan) => Array.isArray(plan.days) ? plan.days : [])
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
  const ownerId = currentStudentId(req, res);
  const flatTasks = plans.filter((plan) => plan.userId === ownerId).flatMap((plan) => Array.isArray(plan.days) ? plan.days : [])
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
  if (plan.userId !== currentStudentId(req, res)) return v1Error(req, res, 403, 'PLAN_FORBIDDEN', '无权操作该训练计划');
  const profile = (state.abilityProfiles || []).find((item) => item.userId === (plan.userId || currentStudentId(req, res))) || null;
  const submissions = (state.trainingTaskSubmissions || []).filter((s) => s && typeof s === 'object');
  try {
    const result = await longTermAbility.runStageReview({ plan, profile, submissions, callModel: callEssayGuidanceModel });
    return v1Success(req, res, result);
  } catch (err) {
    return v1Error(req, res, 500, 'STAGE_REVIEW_FAILED', err?.message || '阶段复盘失败');
  }
});

function growthTimestamp(value) {
  return Date.parse(value || '') || 0;
}

function growthEvent(type, title, summary, createdAt, extra = {}) {
  return {
    eventId: randomId('growth_event'),
    type,
    title,
    summary,
    createdAt: createdAt || nowIso(),
    evidence: extra.evidence || '',
    nextAction: extra.nextAction || '',
    refId: extra.refId || ''
  };
}

function taskTitleForSubmission(submission, plans) {
  for (const plan of plans) {
    const task = (plan.days || []).find((item) => item.taskId === submission.taskId);
    if (task) return task.title || task.stageTitle || '训练任务';
  }
  return '训练任务';
}

function buildGrowthTimelineForUser(userId) {
  const profiles = (state.abilityProfiles || []).filter((item) => item.userId === userId);
  const profile = profiles.slice().sort((a, b) => growthTimestamp(b.updatedAt || b.createdAt) - growthTimestamp(a.updatedAt || a.createdAt))[0] || null;
  const sessions = (state.essaySessions || []).filter((item) => essaySessionOwnerId(item) === userId || item.userId === userId);
  const sessionIds = new Set(sessions.map((item) => item.id || item.sessionId).filter(Boolean));
  const diagnostics = (state.essayDiagnostics || []).filter((item) => sessionIds.has(item.sessionId));
  const plans = (state.trainingPlans || []).filter((item) => item.userId === userId);
  const submissions = (state.trainingTaskSubmissions || []).filter((item) => item.userId === userId);
  const completedPlans = plans.filter((item) => item.status === '已完成');

  const abilityChanges = (profile?.recentChanges || []).map((item) => ({
    dimension: guidanceString(item.dimension, 40),
    before: Number(item.before ?? 0),
    after: Number(item.after ?? 0),
    delta: Number(item.delta ?? 0),
    evidence: guidanceString(item.evidence, 240),
    createdAt: item.createdAt || profile.updatedAt || profile.createdAt || ''
  })).filter((item) => item.dimension);

  const timeline = [];
  if (profile && !profile.placeholder) {
    timeline.push(growthEvent(
      'ability_assessment',
      '完成能力诊断',
      profile.summary || `当前阶段：${profile.stage || '未测评'}`,
      profile.createdAt || profile.updatedAt,
      {
        evidence: [
          profile.stage ? `阶段：${profile.stage}` : '',
          Array.isArray(profile.strengths) && profile.strengths.length ? `优势：${profile.strengths.slice(0, 2).join('、')}` : '',
          Array.isArray(profile.weaknesses) && profile.weaknesses.length ? `短板：${profile.weaknesses.slice(0, 2).join('、')}` : ''
        ].filter(Boolean).join('；'),
        nextAction: profile.currentFocus ? `继续训练${profile.currentFocus}` : '完成一次作文训练',
        refId: profile.id || profile.profileId || ''
      }
    ));
  }

  for (const change of abilityChanges.slice(-8)) {
    timeline.push(growthEvent(
      'ability_change',
      `${change.dimension}有变化`,
      `从 ${change.before} 到 ${change.after}，变化 ${change.delta >= 0 ? '+' : ''}${change.delta}`,
      change.createdAt,
      { evidence: change.evidence, nextAction: `继续观察${change.dimension}` }
    ));
  }

  for (const submission of submissions.slice(-8)) {
    timeline.push(growthEvent(
      'training_submission',
      '完成训练任务',
      taskTitleForSubmission(submission, plans),
      submission.createdAt,
      {
        evidence: guidanceString(submission.content, 160),
        nextAction: '查看反馈并继续下一项训练',
        refId: submission.taskId
      }
    ));
  }

  for (const diagnostic of diagnostics.slice(-8)) {
    const session = sessions.find((item) => item.id === diagnostic.sessionId || item.sessionId === diagnostic.sessionId) || {};
    timeline.push(growthEvent(
      'essay_diagnosis',
      '完成作文体检',
      diagnostic.overallComment || session.title || '作文体检报告',
      diagnostic.createdAt || session.updatedAt,
      {
        evidence: Array.isArray(diagnostic.priorityIssues)
          ? diagnostic.priorityIssues.slice(0, 2).map((item) => item.title || item.suggestion).filter(Boolean).join('；')
          : '',
        nextAction: '按优先问题修改作文',
        refId: diagnostic.id || diagnostic.diagnosticId || ''
      }
    ));
  }

  for (const plan of plans.slice(-8)) {
    const completedCount = (plan.days || []).filter((day) => day.status === '已完成').length;
    timeline.push(growthEvent(
      plan.status === '已完成' ? 'training_plan_completed' : 'training_plan_started',
      plan.status === '已完成' ? '完成 7 天训练计划' : '开始 7 天训练计划',
      `${completedCount}/${(plan.days || []).length || 7} 个阶段已完成`,
      plan.completedAt || plan.updatedAt || plan.createdAt,
      {
        evidence: Array.isArray(plan.focusDimensions) ? `训练重点：${plan.focusDimensions.join('、')}` : '',
        nextAction: plan.status === '已完成' ? '查看复盘并开始下一轮' : '继续完成当前阶段',
        refId: plan.id || plan.planId || ''
      }
    ));
  }

  const essayMilestones = sessions.slice(-5).map((item) => ({
    sessionId: item.id || item.sessionId || '',
    title: item.title || '作文练习',
    status: item.status || '',
    updatedAt: item.updatedAt || item.createdAt || ''
  }));
  const sortedTimeline = timeline
    .filter((item) => item.title)
    .sort((a, b) => growthTimestamp(b.createdAt) - growthTimestamp(a.createdAt))
    .slice(0, 30);
  const nextSuggestions = [];
  if (!profile || profile.placeholder) nextSuggestions.push('先完成一次能力诊断，建立初始画像。');
  if (!plans.some((item) => item.status === '进行中')) nextSuggestions.push('创建一份 7 天训练计划，把最近一篇作文练完整。');
  if (diagnostics.length) nextSuggestions.push('选择最近体检里的一个高优先级问题，完成一次局部修改。');
  if (!nextSuggestions.length) nextSuggestions.push('继续完成当前训练阶段，并在修改后写一段复盘。');

  return {
    timeline: sortedTimeline,
    abilityChanges,
    completedPlans,
    essayMilestones,
    badges: [
      profile && !profile.placeholder ? { badgeId: 'ability_started', title: '完成能力诊断' } : null,
      submissions.length ? { badgeId: 'first_training_submission', title: '完成训练任务' } : null,
      diagnostics.length ? { badgeId: 'first_diagnosis', title: '完成作文体检' } : null
    ].filter(Boolean),
    currentStage: profile?.stage || (sortedTimeline.length ? '训练中' : ''),
    nextSuggestions
  };
}

app.get('/api/v1/growth/timeline', (req, res) => {
  const userId = currentStudentId(req, res);
  return v1Success(req, res, buildGrowthTimelineForUser(userId));
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
    const existingUser = findUserByTarget(authTarget.channel, authTarget.value);
    if (!existingUser) await enforceSignupRateLimits(req, authTarget.value);
    const { user, isNew } = upsertUserAfterVerification(authTarget.channel, authTarget.value);
    rebindGuestOwnerData(guestId, user.id);
    const { session, token: sessionToken } = createSession(user);
    req.auth = { user, session };
    setCookie(res, 'session_id', sessionToken, { maxAge: SESSION_MAX_AGE_SECONDS, secure: COOKIE_SECURE });
    return res.json({ ok: true, isNew, viewer: summarizeViewer(req, res) });
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
      payment: PAYMENT_CONFIG
    });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || '\u83b7\u53d6\u6536\u6b3e\u7801\u5931\u8d25', failureCode: error.failureCode || '' });
  }
});

app.get('/api/power/packages', (req, res) => {
  res.status(410).json({ ok: false, message: '\u8be5\u63a5\u53e3\u5df2\u4e0b\u7ebf' });
});

app.get('/api/power/ledger', (req, res) => {
  res.status(410).json({ ok: false, message: '\u8be5\u63a5\u53e3\u5df2\u4e0b\u7ebf' });
});

app.post('/api/power/recharge', (req, res) => {
  res.status(410).json({ ok: false, message: '\u8be5\u63a5\u53e3\u5df2\u4e0b\u7ebf' });
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
  return res.status(410).json({ ok: false, message: '\u8be5\u63a5\u53e3\u5df2\u4e0b\u7ebf' });
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
  return res.status(410).json({ ok: false, message: '\u8be5\u63a5\u53e3\u5df2\u4e0b\u7ebf' });
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
  try {
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

  try {
    const usageTracker = createUsageTracker('detect');
    const detected = await buildDetectResultPayload(text, genre, usageTracker);
    return res.json(detected);
  } catch (error) {
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

  try {
    const usageTracker = createUsageTracker('rewrite');
    const result = await rewriteByProvider(text, usageTracker, req.body?.context);
    return res.json(result);
  } catch (error) {
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
    const usageTracker = createUsageTracker('train');
    const trainingResult = await trainByProvider(text, usageTracker);
    const added = persistKnowledgeBase(trainingResult, text);
    const addedCounts = Object.fromEntries(Object.entries(added).map(([key, value]) => [key, value.length]));
    return res.json({
      ok: true,
      summary: trainingResult.summary,
      suspiciousSentences: trainingResult.suspiciousSentences,
      knowledge: trainingResult.knowledge,
      added,
      addedCounts
    });
  } catch (error) {
    if (error?.failureCode === 'ADMIN_REQUIRED') return res.status(403).json({ message: error.message, failureCode: 'ADMIN_REQUIRED' });
    if (error?.failureCode === 'LOGIN_REQUIRED') return res.status(401).json({ message: error.message, failureCode: 'LOGIN_REQUIRED' });
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
    app: 'inkedge'
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
  const userId = currentStudentId(req, res);
  const createdAt = nowIso();
  const plan = {
    id: randomId('training_plan'),
    planId: '',
    userId,
    planType: String(result.planType || 'camp_7d'),
    status: '进行中',
    createdAt,
    startDate: createdAt.slice(0,10),
    focusDimensions: result.focusDimensions || [],
    totalDays: result.totalDays || 7,
    dailyMinutes: result.dailyMinutes || 15,
    days: (result.days || []).map((d) => ({ ...d, taskId: d.taskId || randomId('task') }))
  };
  plan.planId = plan.id;
  archiveActiveTrainingPlansForUser(userId, plan.id);
  state.trainingPlans.push(plan);
  saveState();
  return v1Success(req, res, plan);
});
