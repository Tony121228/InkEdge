const accountAuthTrigger = document.getElementById('accountAuthTrigger');
const accountPageName = document.getElementById('accountPageName');
const accountPageMeta = document.getElementById('accountPageMeta');
const logoutBtn = document.getElementById('logoutBtn');
const loginRequiredCard = document.getElementById('loginRequiredCard');
const accountContent = document.getElementById('accountContent');
const roleBadge = document.getElementById('roleBadge');
const powerBalanceValue = document.getElementById('powerBalanceValue');
const giftedPowerValue = document.getElementById('giftedPowerValue');
const rechargedPowerValue = document.getElementById('rechargedPowerValue');
const consumedPowerValue = document.getElementById('consumedPowerValue');
const profileName = document.getElementById('profileName');
const profileEmail = document.getElementById('profileEmail');
const profilePhone = document.getElementById('profilePhone');
const profileCreatedAt = document.getElementById('profileCreatedAt');
const profileLastLoginAt = document.getElementById('profileLastLoginAt');
const profileDisplayNameInput = document.getElementById('profileDisplayNameInput');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const profileHint = document.getElementById('profileHint');
const rechargeHint = document.getElementById('rechargeHint');
const ledgerList = document.getElementById('ledgerList');
const paymentQr = document.getElementById('paymentQr');
const paymentPayee = document.getElementById('paymentPayee');
const paymentRemark = document.getElementById('paymentRemark');
const copyRemarkBtn = document.getElementById('copyRemarkBtn');
const adminPanel = document.getElementById('adminPanel');
const adminUserSearch = document.getElementById('adminUserSearch');
const adminRefreshBtn = document.getElementById('adminRefreshBtn');
const adminUserList = document.getElementById('adminUserList');
const adminGrantHint = document.getElementById('adminGrantHint');
const guestIpPanel = document.getElementById('guestIpPanel');
const guestIpRefreshBtn = document.getElementById('guestIpRefreshBtn');
const guestIpList = document.getElementById('guestIpList');
const guestIpHint = document.getElementById('guestIpHint');

const accountAuthModal = document.getElementById('accountAuthModal');
const accountAuthCloseBtn = document.getElementById('accountAuthCloseBtn');
const accountAuthHint = document.getElementById('accountAuthHint');
const accountTargetInput = document.getElementById('accountTargetInput');
const accountCodeInput = document.getElementById('accountCodeInput');
const accountSendCodeBtn = document.getElementById('accountSendCodeBtn');
const accountVerifyCodeBtn = document.getElementById('accountVerifyCodeBtn');
const accountAuthStatus = document.getElementById('accountAuthStatus');

const ADMIN_CONTACT_TEXT = '网易邮箱：18008069236@163.com\nQQ邮箱：3955307559';

let viewer = null;
let ledger = [];
let adminUsers = [];
let guestIpRecords = [];
let sendCodeCountdown = 0;
let sendCodeTimer = null;

function setStatus(element, message, type = 'info') {
  const colors = { info: '#98accd', success: '#58d68d', error: '#ff6e6e' };
  element.style.color = colors[type] || colors.info;
  element.textContent = message;
}

function setAccountAuthStatus(message, type = 'info') {
  setStatus(accountAuthStatus, message, type);
}

function setRechargeHint(message, type = 'info') {
  setStatus(rechargeHint, message, type);
}

function setProfileHint(message, type = 'info') {
  setStatus(profileHint, message, type);
}

function setAdminGrantHint(message, type = 'info') {
  setStatus(adminGrantHint, message, type);
}

function setGuestIpHint(message, type = 'info') {
  setStatus(guestIpHint, message, type);
}

async function fetchJson(url, options = {}) {
  const resp = await fetch(url, options);
  const data = await resp.json().catch(() => ({}));
  return { resp, data };
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadViewer() {
  const { data } = await fetchJson('/api/me');
  viewer = data;
  renderViewer();
}

async function loadPaymentConfig() {
  if (!viewer?.user) return;
  const { resp, data } = await fetchJson('/api/payment/config');
  if (!resp.ok) {
    setRechargeHint(data.message || '获取收款码失败', 'error');
    return;
  }
  const payment = data.payment || {};
  paymentQr.src = payment.qrSrc || '/assets/wechat-merchant-qr.jpg';
  paymentPayee.textContent = payment.payeeName || '微信个人经营收款码';
  paymentRemark.textContent = payment.remarkAccount || payment.adminContact || ADMIN_CONTACT_TEXT;
  setRechargeHint(payment.remarkHint || '转账备注请填写登录邮箱，管理员按 1 元 = 2000 算力核对后人工增加算力。', 'info');
}

async function loadLedger() {
  if (!viewer?.user) {
    ledger = [];
    renderLedger();
    return;
  }
  const { resp, data } = await fetchJson('/api/power/ledger');
  ledger = resp.ok ? (data.ledger || []) : [];
  renderLedger();
}

async function loadAdminUsers() {
  if (viewer?.user?.role !== 'admin') {
    adminUsers = [];
    renderAdminUsers();
    return;
  }
  const query = encodeURIComponent(adminUserSearch.value.trim());
  const { resp, data } = await fetchJson(`/api/admin/users${query ? `?q=${query}` : ''}`);
  if (!resp.ok) {
    adminUsers = [];
    renderAdminUsers();
    setAdminGrantHint(data.message || '获取用户列表失败', 'error');
    return;
  }
  adminUsers = data.users || [];
  renderAdminUsers();
}

async function loadGuestIpUsages() {
  if (viewer?.user?.role !== 'admin') {
    guestIpRecords = [];
    renderGuestIpUsages();
    return;
  }
  const { resp, data } = await fetchJson('/api/admin/guest-ip-usages');
  if (!resp.ok) {
    guestIpRecords = [];
    renderGuestIpUsages();
    setGuestIpHint(data.message || '获取临时 IP 列表失败', 'error');
    return;
  }
  guestIpRecords = data.records || [];
  renderGuestIpUsages();
  setGuestIpHint('', 'info');
}

function renderViewer() {
  const user = viewer?.user;
  accountAuthHint.textContent = '使用邮箱验证码登录。';

  if (!user) {
    accountPageName.textContent = '游客';
    accountPageMeta.textContent = '请先登录';
    accountContent.classList.add('hidden');
    loginRequiredCard.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    adminPanel.classList.add('hidden');
    guestIpPanel.classList.add('hidden');
    return;
  }

  accountPageName.textContent = user.displayName || '已登录用户';
  accountPageMeta.textContent = `算力 ${user.powerBalance}`;
  loginRequiredCard.classList.add('hidden');
  accountContent.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
  adminPanel.classList.toggle('hidden', user.role !== 'admin');
  guestIpPanel.classList.toggle('hidden', user.role !== 'admin');

  roleBadge.textContent = user.role === 'admin' ? '管理员' : '普通用户';
  powerBalanceValue.textContent = String(user.powerBalance || 0);
  giftedPowerValue.textContent = String(user.totals?.giftedPower || 0);
  rechargedPowerValue.textContent = String(user.totals?.rechargedPower || 0);
  consumedPowerValue.textContent = String(user.totals?.consumedPower || 0);
  profileName.textContent = user.displayName || '-';
  profileEmail.textContent = user.email || '-';
  profilePhone.textContent = '邮箱验证码';
  profileCreatedAt.textContent = formatDate(user.createdAt);
  profileLastLoginAt.textContent = formatDate(user.lastLoginAt);
  profileDisplayNameInput.value = user.displayName || '';
}

function ledgerTypeText(item) {
  const mapping = {
    signup_bonus: '注册赠送',
    recharge: '历史充值',
    manual_recharge: '人工调整算力',
    consume: '算力消耗',
    refund: '返还',
    admin_grant: '管理员赠送'
  };
  return mapping[item.type] || item.type || '-';
}

function ledgerDetailText(item) {
  const note = String(item.note || '').trim();
  const manualRechargeType = item.delta >= 0 ? '人工核对转账后增加算力' : '管理员手动扣减算力';
  const legacyManualTypeNote = item.type === 'manual_recharge' && note === manualRechargeType;
  if (item.type === 'manual_recharge') {
    return {
      primary: legacyManualTypeNote ? '-' : (note || '-'),
      secondary: item.apiType || manualRechargeType
    };
  }
  if (item.apiType) {
    return {
      primary: note || '-',
      secondary: item.apiType
    };
  }
  return {
    primary: note || '-',
    secondary: item.tokenCount ? `${item.tokenCount} token` : '-'
  };
}

function renderLedger() {
  if (!ledger.length) {
    ledgerList.innerHTML = '<div class="account-empty">当前还没有算力流水。</div>';
    return;
  }
  ledgerList.innerHTML = ledger.map((item) => {
    const detail = ledgerDetailText(item);
    return `
    <article class="ledger-item">
      <div><strong>${escapeHtml(ledgerTypeText(item))}</strong><br><small>${escapeHtml(formatDate(item.createdAt))}</small></div>
      <div><strong>${escapeHtml(item.delta > 0 ? `+${item.delta}` : item.delta)}</strong><br><small>变动值</small></div>
      <div><strong>${escapeHtml(item.balanceAfter)}</strong><br><small>变动后余额</small></div>
      <div><strong>${escapeHtml(detail.primary)}</strong><br><small>${escapeHtml(detail.secondary)}</small></div>
      <div><strong>${item.tokenEstimated ? '估算' : '实际'}</strong><br><small>${escapeHtml(item.id)}</small></div>
    </article>
  `;
  }).join('');
}

function renderAdminUsers() {
  if (viewer?.user?.role !== 'admin') return;
  if (!adminUsers.length) {
    adminUserList.innerHTML = '<div class="account-empty">暂无匹配用户。</div>';
    return;
  }
  adminUserList.innerHTML = adminUsers.map((user) => {
    const deleteButton = user.role === 'admin'
      ? ''
      : '<button class="danger admin-delete-btn" type="button">删除</button>';
    return `
    <article class="admin-user-item" data-user-id="${user.id}">
      <div class="admin-user-main">
        <strong>${escapeHtml(user.displayName || '-')}</strong>
        <small>${escapeHtml(user.emailRaw || user.email || '-')} · ${user.role === 'admin' ? '管理员' : '普通用户'}</small>
        <small>注册 ${escapeHtml(formatDate(user.createdAt))} · 最近登录 ${escapeHtml(formatDate(user.lastLoginAt))}</small>
      </div>
      <div class="admin-user-balance">
        <span>余额</span>
        <strong>${escapeHtml(user.powerBalance || 0)}</strong>
      </div>
      <div class="admin-user-tools">
        <div class="admin-profile-form">
          <input class="text-input admin-display-name" type="text" maxlength="40" value="${escapeHtml(user.displayName || '')}" placeholder="用户名" />
          <button class="ghost admin-profile-save-btn" type="button">保存</button>
          ${deleteButton}
        </div>
        <div class="admin-grant-form">
          <input class="text-input admin-grant-amount" type="number" step="1" placeholder="调整算力，如 100 或 -50" />
          <input class="text-input admin-grant-note" type="text" placeholder="备注，如微信转账金额/扣减原因" />
          <button class="primary admin-grant-btn" type="button">调整算力</button>
        </div>
      </div>
    </article>
  `;
  }).join('');
}

function renderGuestIpUsages() {
  if (viewer?.user?.role !== 'admin') return;
  if (!guestIpRecords.length) {
    guestIpList.innerHTML = '<div class="account-empty">暂无临时 IP 记录。</div>';
    return;
  }
  guestIpList.innerHTML = guestIpRecords.map((record) => `
    <article class="admin-user-item admin-guest-ip-item">
      <div class="admin-readonly-field">
        <span>${escapeHtml(record.ipLabel || (/^[a-f0-9]{48,}$/i.test(String(record.ip || '')) ? 'IPhash' : 'IP'))}</span>
        <strong>${escapeHtml(record.ip || '-')}</strong>
      </div>
      <div class="admin-readonly-field">
        <span>剩余试用额度</span>
        <strong>${escapeHtml(record.remainingPower ?? 0)}</strong>
      </div>
      <div class="admin-readonly-field">
        <span>最后一次发送数据</span>
        <strong>${escapeHtml(formatDate(record.lastSeenAt))}</strong>
      </div>
    </article>
  `).join('');
}

function openAuthModal() {
  accountAuthModal.classList.remove('hidden');
  accountAuthModal.setAttribute('aria-hidden', 'false');
  setAccountAuthStatus('', 'info');
}

function closeAuthModal() {
  accountAuthModal.classList.add('hidden');
  accountAuthModal.setAttribute('aria-hidden', 'true');
}

function startSendCodeCountdown(seconds) {
  sendCodeCountdown = seconds;
  accountSendCodeBtn.disabled = true;
  accountSendCodeBtn.textContent = `${sendCodeCountdown}s`;
  if (sendCodeTimer) window.clearInterval(sendCodeTimer);
  sendCodeTimer = window.setInterval(() => {
    sendCodeCountdown -= 1;
    if (sendCodeCountdown <= 0) {
      window.clearInterval(sendCodeTimer);
      sendCodeTimer = null;
      accountSendCodeBtn.disabled = false;
      accountSendCodeBtn.textContent = '发送验证码';
      return;
    }
    accountSendCodeBtn.textContent = `${sendCodeCountdown}s`;
  }, 1000);
}

async function refreshAccountData() {
  await loadViewer();
  await loadPaymentConfig();
  await loadLedger();
  await loadAdminUsers();
  await loadGuestIpUsages();
}

accountAuthTrigger.addEventListener('click', () => {
  if (!viewer?.user) openAuthModal();
});

accountAuthCloseBtn.addEventListener('click', closeAuthModal);

accountAuthModal.addEventListener('click', (event) => {
  if (event.target === accountAuthModal) closeAuthModal();
});

accountSendCodeBtn.addEventListener('click', async () => {
  const target = accountTargetInput.value.trim();
  if (!target) {
    setAccountAuthStatus('请输入邮箱', 'error');
    return;
  }
  accountSendCodeBtn.disabled = true;
  try {
    const { resp, data } = await fetchJson('/api/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target })
    });
    if (!resp.ok) {
      setAccountAuthStatus(data.message || '验证码发送失败', 'error');
      accountSendCodeBtn.disabled = false;
      return;
    }
    const expiresInMinutes = Math.max(1, Math.round(Number(data.expiresInSeconds || 180) / 60));
    setAccountAuthStatus(`验证码已发送到 ${data.maskedTarget}，有效期 ${expiresInMinutes} 分钟`, 'success');
    startSendCodeCountdown(Number(data.cooldownSeconds || 60));
  } catch (_) {
    accountSendCodeBtn.disabled = false;
    setAccountAuthStatus('验证码发送失败，请稍后重试', 'error');
  }
});

accountVerifyCodeBtn.addEventListener('click', async () => {
  const target = accountTargetInput.value.trim();
  const code = accountCodeInput.value.trim();
  if (!target || !code) {
    setAccountAuthStatus('请填写邮箱和验证码', 'error');
    return;
  }
  accountVerifyCodeBtn.disabled = true;
  try {
    const { resp, data } = await fetchJson('/api/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, code })
    });
    if (!resp.ok) {
      setAccountAuthStatus(data.message || '登录失败', 'error');
      return;
    }
    closeAuthModal();
    accountCodeInput.value = '';
    await refreshAccountData();
    setRechargeHint(data.isNew && data.signupBonusGranted ? `登录成功，已赠送 ${data.signupBonusGranted} 算力` : '登录成功', 'success');
  } catch (_) {
    setAccountAuthStatus('登录失败，请稍后重试', 'error');
  } finally {
    accountVerifyCodeBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  const { resp } = await fetchJson('/api/auth/logout', { method: 'POST' });
  if (!resp.ok) return;
  await refreshAccountData();
  setRechargeHint('已退出登录', 'success');
});

saveProfileBtn.addEventListener('click', async () => {
  const displayName = profileDisplayNameInput.value.trim();
  if (!displayName) {
    setProfileHint('用户名不能为空', 'error');
    return;
  }
  saveProfileBtn.disabled = true;
  try {
    const { resp, data } = await fetchJson('/api/account/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName })
    });
    if (!resp.ok) {
      setProfileHint(data.message || '保存失败', 'error');
      return;
    }
    viewer.user = data.user;
    renderViewer();
    setProfileHint('个人资料已保存，邮箱保持不变。', 'success');
  } catch (_) {
    setProfileHint('保存失败，请稍后重试', 'error');
  } finally {
    saveProfileBtn.disabled = false;
  }
});

copyRemarkBtn.addEventListener('click', async () => {
  const text = paymentRemark.textContent.trim();
  if (!text || text === '-') return;
  await navigator.clipboard.writeText(text);
  setRechargeHint('管理员联系方式已复制', 'success');
});

adminRefreshBtn.addEventListener('click', loadAdminUsers);
guestIpRefreshBtn.addEventListener('click', loadGuestIpUsages);
adminUserSearch.addEventListener('input', () => {
  window.clearTimeout(adminUserSearch._timer);
  adminUserSearch._timer = window.setTimeout(loadAdminUsers, 250);
});

adminUserList.addEventListener('click', async (event) => {
  const row = event.target.closest('.admin-user-item');
  if (!row) return;

  const saveButton = event.target.closest('.admin-profile-save-btn');
  if (saveButton) {
    const nameInput = row.querySelector('.admin-display-name');
    const displayName = nameInput.value.trim();
    if (!displayName) {
      setAdminGrantHint('用户名不能为空', 'error');
      return;
    }
    saveButton.disabled = true;
    try {
      const { resp, data } = await fetchJson('/api/admin/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: row.dataset.userId,
          displayName
        })
      });
      if (!resp.ok) {
        setAdminGrantHint(data.message || '保存用户资料失败', 'error');
        return;
      }
      setAdminGrantHint('用户资料已保存，邮箱未修改。', 'success');
      await refreshAccountData();
    } catch (_) {
      setAdminGrantHint('保存用户资料失败，请稍后重试', 'error');
    } finally {
      saveButton.disabled = false;
    }
    return;
  }

  const deleteButton = event.target.closest('.admin-delete-btn');
  if (deleteButton) {
    const user = adminUsers.find((item) => item.id === row.dataset.userId);
    const label = user?.emailRaw || user?.displayName || row.dataset.userId;
    if (!window.confirm(`确定删除账号 ${label} 吗？该账号的会话、算力流水和充值记录也会被清理。`)) return;
    deleteButton.disabled = true;
    try {
      const { resp, data } = await fetchJson('/api/admin/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: row.dataset.userId })
      });
      if (!resp.ok) {
        setAdminGrantHint(data.message || '删除用户失败', 'error');
        return;
      }
      setAdminGrantHint('账号已删除', 'success');
      await refreshAccountData();
    } catch (_) {
      setAdminGrantHint('删除用户失败，请稍后重试', 'error');
    } finally {
      deleteButton.disabled = false;
    }
    return;
  }

  const button = event.target.closest('.admin-grant-btn');
  if (!button) return;
  const amountInput = row.querySelector('.admin-grant-amount');
  const noteInput = row.querySelector('.admin-grant-note');
  const amount = Math.round(Number(amountInput.value || 0));
  if (!Number.isFinite(amount) || amount === 0) {
    setAdminGrantHint('请输入非 0 的算力调整数量，可填写负数', 'error');
    return;
  }
  button.disabled = true;
  try {
    const { resp, data } = await fetchJson('/api/admin/power/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: row.dataset.userId,
        amount,
        note: noteInput.value.trim()
      })
    });
    if (!resp.ok) {
      setAdminGrantHint(data.message || '调整算力失败', 'error');
      return;
    }
    amountInput.value = '';
    noteInput.value = '';
    setAdminGrantHint('调整算力成功', 'success');
    await refreshAccountData();
  } catch (_) {
    setAdminGrantHint('调整算力失败，请稍后重试', 'error');
  } finally {
    button.disabled = false;
  }
});

(async function init() {
  await refreshAccountData();
  if (window.location.hash === '#recharge') {
    document.getElementById('recharge')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
})();
