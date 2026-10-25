const accountAuthTrigger = document.getElementById('accountAuthTrigger');
const accountPageName = document.getElementById('accountPageName');
const accountPageMeta = document.getElementById('accountPageMeta');
const logoutBtn = document.getElementById('logoutBtn');
const loginRequiredCard = document.getElementById('loginRequiredCard');
const accountContent = document.getElementById('accountContent');
const roleBadge = document.getElementById('roleBadge');
const profileName = document.getElementById('profileName');
const profileEmail = document.getElementById('profileEmail');
const profilePhone = document.getElementById('profilePhone');
const profileCreatedAt = document.getElementById('profileCreatedAt');
const profileLastLoginAt = document.getElementById('profileLastLoginAt');
const profileDisplayNameInput = document.getElementById('profileDisplayNameInput');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const profileHint = document.getElementById('profileHint');
const rechargeHint = document.getElementById('rechargeHint');
const paymentQr = document.getElementById('paymentQr');
const paymentPayee = document.getElementById('paymentPayee');
const adminPanel = document.getElementById('adminPanel');
const adminUserSearch = document.getElementById('adminUserSearch');
const adminRefreshBtn = document.getElementById('adminRefreshBtn');
const adminUserList = document.getElementById('adminUserList');
const adminGrantHint = document.getElementById('adminGrantHint');
const accountAuthModal = document.getElementById('accountAuthModal');
const accountAuthCloseBtn = document.getElementById('accountAuthCloseBtn');
const accountAuthHint = document.getElementById('accountAuthHint');
const accountTargetInput = document.getElementById('accountTargetInput');
const accountCodeInput = document.getElementById('accountCodeInput');
const accountSendCodeBtn = document.getElementById('accountSendCodeBtn');
const accountVerifyCodeBtn = document.getElementById('accountVerifyCodeBtn');
const accountAuthStatus = document.getElementById('accountAuthStatus');

let viewer = null;
let adminUsers = [];
let sendCodeCountdown = 0;
let sendCodeTimer = null;

function getAuthenticatedUser() {
  return viewer?.authenticated && viewer.user?.role !== 'guest' ? viewer.user : null;
}

function setStatus(element, message, type = 'info') {
  if (!element) return;
  const colors = { info: '#98accd', success: '#58d68d', error: '#ff6e6e' };
  element.style.color = colors[type] || colors.info;
  element.textContent = message || '';
}

async function fetchJson(url, options = {}) {
  const resp = await fetch(url, { credentials: 'include', ...options });
  const data = await resp.json().catch(() => ({}));
  return { resp, data };
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false });
}

function escapeHtml(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function loadViewer() {
  const { data } = await fetchJson('/api/me');
  viewer = data;
  renderViewer();
}

async function loadPaymentConfig() {
  if (!getAuthenticatedUser()) return;
  const { resp, data } = await fetchJson('/api/payment/config');
  if (!resp.ok) {
    setStatus(rechargeHint, data.message || '收款码暂时不可用', 'error');
    return;
  }
  const payment = data.payment || {};
  paymentQr.src = payment.qrSrc || '/assets/wechat-merchant-qr.example.svg';
  paymentPayee.textContent = payment.payeeName || '微信收款码';
}

function renderViewer() {
  const user = getAuthenticatedUser();
  accountAuthHint.textContent = '使用邮箱验证码登录。';
  if (!user) {
    accountPageName.textContent = '游客';
    accountPageMeta.textContent = '请先登录';
    accountContent.classList.add('hidden');
    loginRequiredCard.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    adminPanel.classList.add('hidden');
    return;
  }
  accountPageName.textContent = user.displayName || '已登录用户';
  accountPageMeta.textContent = '个人中心';
  loginRequiredCard.classList.add('hidden');
  accountContent.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
  adminPanel.classList.toggle('hidden', user.role !== 'admin');
  roleBadge.textContent = user.role === 'admin' ? '管理员' : '普通用户';
  profileName.textContent = user.displayName || '-';
  profileEmail.textContent = user.email || '-';
  profilePhone.textContent = '邮箱验证码';
  profileCreatedAt.textContent = formatDate(user.createdAt);
  profileLastLoginAt.textContent = formatDate(user.lastLoginAt);
  profileDisplayNameInput.value = user.displayName || '';
}

async function loadAdminUsers() {
  if (getAuthenticatedUser()?.role !== 'admin') return;
  const query = encodeURIComponent(adminUserSearch.value.trim());
  const { resp, data } = await fetchJson(`/api/admin/users${query ? `?q=${query}` : ''}`);
  if (!resp.ok) {
    adminUsers = [];
    renderAdminUsers();
    setStatus(adminGrantHint, data.message || '获取用户列表失败', 'error');
    return;
  }
  adminUsers = data.users || [];
  renderAdminUsers();
}

function renderAdminUsers() {
  if (getAuthenticatedUser()?.role !== 'admin') return;
  if (!adminUsers.length) {
    adminUserList.innerHTML = '<div class="account-empty">暂无匹配用户。</div>';
    return;
  }
  adminUserList.innerHTML = adminUsers.map((user) => {
    const deleteButton = user.role === 'admin' ? '' : '<button class="danger admin-delete-btn" type="button">删除</button>';
    return `<article class="admin-user-item" data-user-id="${escapeHtml(user.id)}"><div class="admin-user-main"><strong>${escapeHtml(user.displayName || '-')}</strong><small>${escapeHtml(user.email || '-')} · ${user.role === 'admin' ? '管理员' : '普通用户'}</small><small>注册 ${escapeHtml(formatDate(user.createdAt))} · 最近登录 ${escapeHtml(formatDate(user.lastLoginAt))}</small></div><div class="admin-user-tools"><div class="admin-profile-form"><input class="text-input admin-display-name" type="text" maxlength="40" value="${escapeHtml(user.displayName || '')}" placeholder="用户名" /><button class="ghost admin-profile-save-btn" type="button">保存</button>${deleteButton}</div></div></article>`;
  }).join('');
}

function openAuthModal() {
  accountAuthModal.classList.remove('hidden');
  accountAuthModal.setAttribute('aria-hidden', 'false');
  setStatus(accountAuthStatus, '');
  setTimeout(() => accountTargetInput.focus(), 10);
}

function closeAuthModal() {
  accountAuthModal.classList.add('hidden');
  accountAuthModal.setAttribute('aria-hidden', 'true');
}

function startCountdown(seconds) {
  clearInterval(sendCodeTimer);
  sendCodeCountdown = Math.max(1, Number(seconds || 60));
  accountSendCodeBtn.disabled = true;
  const tick = () => {
    if (sendCodeCountdown <= 0) { accountSendCodeBtn.disabled = false; accountSendCodeBtn.textContent = '发送验证码'; return; }
    accountSendCodeBtn.textContent = `${sendCodeCountdown--}s`;
    sendCodeTimer = setTimeout(tick, 1000);
  };
  tick();
}

accountAuthTrigger.addEventListener('click', () => {
  if (getAuthenticatedUser()) window.location.href = '/account.html';
  else openAuthModal();
});
accountAuthCloseBtn.addEventListener('click', closeAuthModal);
accountAuthModal.addEventListener('click', (event) => { if (event.target === accountAuthModal) closeAuthModal(); });

accountSendCodeBtn.addEventListener('click', async () => {
  const target = accountTargetInput.value.trim();
  if (!target) return setStatus(accountAuthStatus, '请输入邮箱', 'error');
  try {
    const { resp, data } = await fetchJson('/api/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }) });
    if (!resp.ok) return setStatus(accountAuthStatus, data.message || '验证码发送失败', 'error');
    setStatus(accountAuthStatus, `验证码已发送到 ${data.maskedTarget || target}。`, 'success');
    startCountdown(data.cooldownSeconds);
  } catch (_) { setStatus(accountAuthStatus, '验证码发送失败，请稍后重试', 'error'); }
});

accountVerifyCodeBtn.addEventListener('click', async () => {
  const target = accountTargetInput.value.trim();
  const code = accountCodeInput.value.trim();
  if (!target || !code) return setStatus(accountAuthStatus, '请填写邮箱和验证码', 'error');
  accountVerifyCodeBtn.disabled = true;
  try {
    const { resp, data } = await fetchJson('/api/auth/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, code }) });
    if (!resp.ok) return setStatus(accountAuthStatus, data.message || '登录失败', 'error');
    accountCodeInput.value = '';
    setStatus(accountAuthStatus, '登录成功', 'success');
    await loadViewer();
    await loadPaymentConfig();
    if (getAuthenticatedUser()?.role === 'admin') await loadAdminUsers();
    setTimeout(closeAuthModal, 400);
  } catch (_) { setStatus(accountAuthStatus, '登录失败，请稍后重试', 'error'); }
  finally { accountVerifyCodeBtn.disabled = false; }
});

logoutBtn.addEventListener('click', async () => {
  await fetchJson('/api/auth/logout', { method: 'POST' });
  window.location.reload();
});

saveProfileBtn.addEventListener('click', async () => {
  const displayName = profileDisplayNameInput.value.trim();
  saveProfileBtn.disabled = true;
  try {
    const { resp, data } = await fetchJson('/api/account/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) });
    if (!resp.ok) return setStatus(profileHint, data.message || '保存资料失败', 'error');
    viewer.user = data.user;
    renderViewer();
    setStatus(profileHint, '资料已保存', 'success');
  } catch (_) { setStatus(profileHint, '保存资料失败，请稍后重试', 'error'); }
  finally { saveProfileBtn.disabled = false; }
});

adminRefreshBtn.addEventListener('click', loadAdminUsers);
adminUserSearch.addEventListener('input', () => loadAdminUsers());
adminUserList.addEventListener('click', async (event) => {
  const row = event.target.closest('[data-user-id]');
  if (!row) return;
  const userId = row.dataset.userId;
  if (event.target.closest('.admin-profile-save-btn')) {
    const displayName = row.querySelector('.admin-display-name').value.trim();
    const { resp, data } = await fetchJson('/api/admin/users/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, displayName }) });
    setStatus(adminGrantHint, resp.ok ? '资料已保存' : (data.message || '保存失败'), resp.ok ? 'success' : 'error');
    if (resp.ok) loadAdminUsers();
  }
  if (event.target.closest('.admin-delete-btn')) {
    const user = adminUsers.find((item) => item.id === userId);
    if (!window.confirm(`确定删除账号 ${user?.email || userId} 吗？`)) return;
    const { resp, data } = await fetchJson('/api/admin/users/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
    setStatus(adminGrantHint, resp.ok ? '账号已删除' : (data.message || '删除失败'), resp.ok ? 'success' : 'error');
    if (resp.ok) loadAdminUsers();
  }
});

(async function init() {
  await loadViewer();
  await loadPaymentConfig();
  if (getAuthenticatedUser()?.role === 'admin') await loadAdminUsers();
})();
