// Minimal auth UI logic ported from reference project
let viewer = null;

const authModal = document.getElementById('authModal');
const authTrigger = document.getElementById('authTrigger');
const authCloseBtn = document.getElementById('authCloseBtn');
const authTargetInput = document.getElementById('authTargetInput');
const authCodeInput = document.getElementById('authCodeInput');
const sendCodeBtn = document.getElementById('sendCodeBtn');
const verifyCodeBtn = document.getElementById('verifyCodeBtn');
const authStatus = document.getElementById('authStatus');
const accountName = document.getElementById('accountName');
const guestSignupHint = document.getElementById('guestSignupHint');
const authChannelHint = document.getElementById('authChannelHint');

function setAuthStatus(text, level) {
  if (!authStatus) return;
  authStatus.textContent = text || '';
  authStatus.className = 'hint ' + (level || 'info');
}

async function fetchJson(url, options) {
  options = options || {};
  const resp = await fetch(url, Object.assign({ credentials: 'include' }, options));
  const data = await resp.json().catch(function(){ return {}; });
  return { resp: resp, data: data };
}

async function loadViewer() {
  const result = await fetchJson('/api/me');
  viewer = result.data;
  renderViewer();
  return viewer;
}

function renderViewer() {
  var user = viewer && viewer.user;
  if (authChannelHint) authChannelHint.textContent = '使用邮箱验证码登录。';
  if (user) {
    if (accountName) accountName.textContent = user.displayName || '已登录用户';
    if (guestSignupHint && guestSignupHint.classList) guestSignupHint.classList.add('hidden');
  } else {
    if (accountName) accountName.textContent = '游客';
    if (guestSignupHint && guestSignupHint.classList) guestSignupHint.classList.remove('hidden');
  }
}

function openAuthModal() {
  if (!authModal) return;
  authModal.classList.remove('hidden');
  authModal.setAttribute('aria-hidden', 'false');
  setAuthStatus('');
  setTimeout(function(){ if (authTargetInput) authTargetInput.focus(); }, 10);
}

function closeAuthModal() {
  if (!authModal) return;
  authModal.classList.add('hidden');
  authModal.setAttribute('aria-hidden', 'true');
}

if (authTrigger) authTrigger.addEventListener('click', openAuthModal);
if (authCloseBtn) authCloseBtn.addEventListener('click', closeAuthModal);
if (authModal) authModal.addEventListener('click', function(e){ if (e.target === authModal) closeAuthModal(); });

if (sendCodeBtn) sendCodeBtn.addEventListener('click', async function(){
  const target = (authTargetInput && authTargetInput.value || '').trim();
  if (!target) { setAuthStatus('请输入邮箱', 'error'); return; }
  sendCodeBtn.disabled = true;
  try {
    const result = await fetchJson('/api/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: target }) });
    const resp = result.resp; const data = result.data;
    if (!resp.ok) { setAuthStatus(data.message || '验证码发送失败', 'error'); sendCodeBtn.disabled = false; return; }
    const expiresInMinutes = Math.max(1, Math.round(Number(data.expiresInSeconds || 180) / 60));
    setAuthStatus('验证码已发送到 ' + (data.maskedTarget || target) + '，' + expiresInMinutes + ' 分钟内有效。', 'success');
    var cd = Number(data.cooldownSeconds || 60);
    const tick = function(){ if (cd <= 0) { sendCodeBtn.textContent = '发送验证码'; sendCodeBtn.disabled = false; return; } sendCodeBtn.textContent = '重新发送 (' + (cd--) + 's)'; setTimeout(tick, 1000); };
    tick();
  } catch (e) {
    sendCodeBtn.disabled = false;
    setAuthStatus('验证码发送失败，请稍后重试', 'error');
  }
});

if (verifyCodeBtn) verifyCodeBtn.addEventListener('click', async function(){
  const target = (authTargetInput && authTargetInput.value || '').trim();
  const code = (authCodeInput && authCodeInput.value || '').trim();
  if (!target || !code) { setAuthStatus('请填写邮箱和验证码', 'error'); return; }
  verifyCodeBtn.disabled = true;
  try {
    const result = await fetchJson('/api/auth/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: target, code: code }) });
    const resp = result.resp; const data = result.data;
    if (!resp.ok) { setAuthStatus(data.message || '登录失败', 'error'); return; }
    if (authCodeInput) authCodeInput.value = '';
    const msg = (data.isNew && data.signupBonusGranted) ? ('登录成功，已赠送 ' + data.signupBonusGranted + ' 算力') : '登录成功';
    setAuthStatus(msg, 'success');
    await loadViewer();
    setTimeout(closeAuthModal, 600);
  } catch (e) {
    setAuthStatus('登录失败，请稍后重试', 'error');
  } finally {
    verifyCodeBtn.disabled = false;
  }
});

loadViewer().catch(function(){});