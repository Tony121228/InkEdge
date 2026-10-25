const { execFileSync } = require('child_process');
const path = require('path');

const forbiddenPaths = [
  /^\.env(?:\.|$)/i,
  /^docs\/SMTP配置\.txt$/i,
  /^data\//i,
  /^\.wrangler\//i,
  /^public\/assets\/wechat-merchant-qr\.(?:jpg|jpeg|png|svg)$/i
];

const contentRules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['OpenAI-style API key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['GitHub token', /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['literal bearer token', /\bBearer\s+[A-Za-z0-9._-]{24,}\b/]
];

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: path.resolve(__dirname, '..'),
    encoding: options.encoding || 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options
  });
}

function normalize(file) {
  return String(file || '').replace(/\\/g, '/');
}

function isForbiddenPath(file) {
  if (file === '.env.example') return false;
  return forbiddenPaths.some((pattern) => pattern.test(file));
}

function stagedFiles() {
  return git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .split('\0')
    .map(normalize)
    .filter(Boolean);
}

function headFiles() {
  return git(['ls-tree', '-r', '--name-only', '-z', 'HEAD'])
    .split('\0')
    .map(normalize)
    .filter(Boolean);
}

function stagedContent(file) {
  return git(['show', `:${file}`], { encoding: 'buffer' });
}

function headContent(file) {
  return git(['show', `HEAD:${file}`], { encoding: 'buffer' });
}

function looksBinary(buffer) {
  return buffer.subarray(0, 8192).includes(0);
}

function lineAt(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function scanText(file, text, failures) {
  for (const [label, pattern] of contentRules) {
    const match = pattern.exec(text);
    if (match) failures.push(`${file}:${lineAt(text, match.index)}: ${label}`);
  }

  const emailPattern = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi;
  let emailMatch;
  while ((emailMatch = emailPattern.exec(text))) {
    const domain = String(emailMatch[1] || '').toLowerCase();
    if (domain === 'example.com' || domain === 'example.org') continue;
    failures.push(`${file}:${lineAt(text, emailMatch.index)}: non-example email address`);
  }
}

function run() {
  const staged = stagedFiles();
  const useStaged = staged.length > 0;
  const files = useStaged ? staged : headFiles();
  const readContent = useStaged ? stagedContent : headContent;
  const failures = [];

  for (const file of files) {
    if (isForbiddenPath(file)) {
      failures.push(`${file}: forbidden sensitive path`);
      continue;
    }

    let buffer;
    try {
      buffer = readContent(file);
    } catch (_) {
      failures.push(`${file}: unable to inspect content`);
      continue;
    }
    if (looksBinary(buffer)) continue;
    scanText(file, buffer.toString('utf8'), failures);
  }

  if (failures.length) {
    console.error('Sensitive information scan failed:');
    failures.forEach((item) => console.error(`- ${item}`));
    process.exit(1);
  }

  console.log(`Sensitive information scan passed (${files.length} ${useStaged ? 'staged' : 'HEAD'} files checked).`);
}

run();
