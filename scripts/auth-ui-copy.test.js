const assert = require('assert');
const fs = require('fs');

const appHtml = fs.readFileSync('public/app.html', 'utf8');
const accountHtml = fs.readFileSync('public/account.html', 'utf8');
const authJs = fs.readFileSync('public/auth.js', 'utf8');
const styles = fs.readFileSync('public/styles.css', 'utf8');

assert.match(appHtml, /id="authTrigger" class="account-chip"/);
assert.match(appHtml, /id="accountName">游客/);
assert.match(appHtml, /id="accountMeta">点击登录/);
assert.match(appHtml, /id="authModal" class="modal-shell hidden"/);
assert.match(appHtml, /id="sendCodeBtn"/);
assert.match(appHtml, /id="verifyCodeBtn"/);
assert.doesNotMatch(appHtml, /auth-adapter\.js|vendor-auth\/auth-widget/);

assert.match(accountHtml, /id="accountAuthModal" class="modal-shell hidden"/);
assert.match(accountHtml, /id="accountSendCodeBtn"/);
assert.match(accountHtml, /id="accountVerifyCodeBtn"/);
assert.match(authJs, /\/api\/auth\/send-code/);
assert.match(authJs, /\/api\/auth\/verify-code/);
assert.match(authJs, /accountMeta/);
assert.doesNotMatch(authJs, /算力|试用额度|充值|余额/);
assert.match(authJs, /viewer\?\.authenticated \? viewer\.user : null/);
assert.match(fs.readFileSync('public/account.js', 'utf8'), /getAuthenticatedUser/);
assert.match(styles, /\.account-chip\s*\{/);
assert.match(styles, /\.account-chip small\s*\{/);

console.log('PASS reference project login/register interface contract is copied to the InkEdge workbench');
