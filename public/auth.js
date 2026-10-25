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
const accountMeta = document.getElementById('accountMeta');
const authChannelHint = document.getElementById('authChannelHint');

function setAuthStatus(text, level = 'info') {
  if (!authStatus) return;
  authStatus.textContent = text || '';
  authStatus.className = `hint ${level}`;
}

async function fetchJson(url, options = {}) {
  const resp = await fetch(url, { credentials: 'include', ...options });
  const data = await resp.json().catch(() => ({}));
  return { resp, data };
}

async function loadViewer() {
  const { data } = await fetchJson('/api/me');
  viewer = data;
  renderViewer();
}

function renderViewer() {
  const user = viewer?.authenticated ? viewer.user : null;
  if (authChannelHint) authChannelHint.textContent = '使用邮箱验证码登录。';
  if (user) {
    accountName.textContent = user.displayName || '已登录用户';
    accountMeta.textContent = '个人中心';
    authTrigger.title = '进入个人中心';
  } else {
    accountName.textContent = '游客';
    accountMeta.textContent = '点击登录';
    authTrigger.title = '登录或注册';
  }
}

function openAuthModal() {
  authModal.classList.remove('hidden');
  authModal.setAttribute('aria-hidden', 'false');
  setAuthStatus('');
  setTimeout(() => authTargetInput?.focus(), 10);
}

function closeAuthModal() {
  authModal.classList.add('hidden');
  authModal.setAttribute('aria-hidden', 'true');
}

authTrigger?.addEventListener('click', () => {
  if (viewer?.authenticated) window.location.href = '/account.html';
  else openAuthModal();
});
authCloseBtn?.addEventListener('click', closeAuthModal);
authModal?.addEventListener('click', (event) => { if (event.target === authModal) closeAuthModal(); });

sendCodeBtn?.addEventListener('click', async () => {
  const target = authTargetInput.value.trim();
  if (!target) return setAuthStatus('请输入邮箱', 'error');
  sendCodeBtn.disabled = true;
  try {
    const { resp, data } = await fetchJson('/api/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }) });
    if (!resp.ok) { setAuthStatus(data.message || '验证码发送失败', 'error'); sendCodeBtn.disabled = false; return; }
    setAuthStatus(`验证码已发送到 ${data.maskedTarget || target}。`, 'success');
    let remaining = Number(data.cooldownSeconds || 60);
    const tick = () => {
      if (remaining <= 0) { sendCodeBtn.textContent = '发送验证码'; sendCodeBtn.disabled = false; return; }
      sendCodeBtn.textContent = `${remaining--}s`;
      setTimeout(tick, 1000);
    };
    tick();
  } catch (_) { sendCodeBtn.disabled = false; setAuthStatus('验证码发送失败，请稍后重试', 'error'); }
});

verifyCodeBtn?.addEventListener('click', async () => {
  const target = authTargetInput.value.trim();
  const code = authCodeInput.value.trim();
  if (!target || !code) return setAuthStatus('请填写邮箱和验证码', 'error');
  verifyCodeBtn.disabled = true;
  try {
    const { resp, data } = await fetchJson('/api/auth/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, code }) });
    if (!resp.ok) return setAuthStatus(data.message || '登录失败', 'error');
    authCodeInput.value = '';
    setAuthStatus('登录成功', 'success');
    await loadViewer();
    setTimeout(closeAuthModal, 400);
  } catch (_) { setAuthStatus('登录失败，请稍后重试', 'error'); }
  finally { verifyCodeBtn.disabled = false; }
});

loadViewer().catch(() => setAuthStatus('登录状态加载失败，请刷新重试', 'error'));
