const fs = require('fs');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Secret list JSON path is required.');
  process.exit(2);
}

let rows;
try {
  rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch (error) {
  console.error(`Unable to read Cloudflare Secret list: ${error.message}`);
  process.exit(1);
}

const names = new Set(Array.isArray(rows) ? rows.map((item) => item && item.name) : []);
const required = [
  'AI_API_KEY',
  'APP_SECRET',
  'SMTP_FROM',
  'SMTP_HOST',
  'SMTP_PASS',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER'
];
const missing = required.filter((name) => !names.has(name));
if (missing.length > 0) {
  console.error(`[ERROR] Missing Cloudflare Secret names: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('[OK] Secret names checked; values were not displayed.');
