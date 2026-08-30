/* Flow Studio popup — daily-plan basis & session manager */
const DEFAULT_API = 'http://localhost:3000';
const RENEW_THRESHOLD_DAYS = 5; // show renew banner when <= 5 days left

function $(id) { return document.getElementById(id); }

// SVG icons for buttons
const ICON_REFRESH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
const ICON_LOGOUT = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
const ICON_LOGIN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>';
const ICON_CHECK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_SAVE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:2px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';

async function getApiBase() {
  const input = $('api-base')?.value?.trim();
  if (input) return input.replace(/\/+$/, '');
  const r = await chrome.storage.local.get('apiBase');
  return (r.apiBase || DEFAULT_API).replace(/\/+$/, '');
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
}

function computeDaysLeft(data) {
  if (!data) return null;
  const exp = data.extension2_expiry || data.planExpires || data.expirationDate || data.expiry || data.plan_expires || data.planExpiresAt;
  if (exp) {
    const d = new Date(exp);
    if (!isNaN(d.getTime())) {
      return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
    }
  }
  let days = parseInt(data.extension2_days ?? data.daysRemaining ?? data.daysLeft ?? data.days, 10);
  if (!isNaN(days)) return days;
  return null;
}

function updateRenewBanner(days, plan, supportUrl) {
  const banner = $('renew-banner');
  if (!banner) return;
  if (plan === 'none') {
    const title = document.querySelector('.renew-banner-title');
    if (title) title.textContent = 'Plan Not Assigned';
    $('renew-msg').innerHTML = 'Plan not assigned. Contact your seller/reseller to get access.';
    const btn = document.querySelector('.renew-btn');
    if (btn) {
      btn.textContent = 'Contact Seller';
      if (supportUrl) btn.href = supportUrl;
    }
    banner.style.display = 'block';
  } else if (days !== null && days <= RENEW_THRESHOLD_DAYS && days >= 0) {
    const title = document.querySelector('.renew-banner-title');
    if (title) title.textContent = 'Plan expiring soon';
    if (days === 0) {
      $('renew-msg').innerHTML = 'Your plan has <b>expired today</b>. Renew now to restore access.';
    } else if (days === 1) {
      $('renew-msg').innerHTML = 'Your plan expires in <b>1 day</b>. Renew to keep uninterrupted access.';
    } else {
      $('renew-msg').innerHTML = 'Your plan expires in <b>' + days + '</b> days. Renew to keep uninterrupted access.';
    }
    const btn = document.querySelector('.renew-btn');
    if (btn && supportUrl) btn.href = supportUrl;
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}

function tryAutoConnect(storedToken) {
  // Auto-connect disabled in favor of manual email and password sign in
  return;
}

(function () {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
  var _bfPopupReloaded = false;
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || _bfPopupReloaded) return;
    var authKeys = ['userId', 'token', 'sessionToken', 'authToken', 'jwt'];
    var gotAuth = authKeys.some(function (k) { return changes[k] && changes[k].newValue; });
    if (!gotAuth) return;
    var statusScreen = document.getElementById('status-screen');
    var isAlreadyConnected = statusScreen && (statusScreen.style.display === 'block' || statusScreen.style.display === '');
    if (isAlreadyConnected) return;
    _bfPopupReloaded = true;
    setTimeout(function () { window.location.reload(); }, 350);
  });
})();

async function init() {
  const api = await getApiBase();
  if ($('api-base')) $('api-base').value = api;

  let data = await chrome.storage.local.get([
    'userId', 'userName', 'userPlan',
    'cookieData', 'authSource', 'cookieSystemDisabled',
    'sessionCookieCount', 'extension2_days', 'planExpires', 'expirationDate',
    'token', 'sessionToken', 'authToken', 'jwt', 'branding', 'updateInfo'
  ]);

  if (data.token) {
    // Re-validate session & refresh plan/expiry with /api/public/auth/me
    try {
      const meRes = await fetch(api + '/api/public/auth/me', {
        headers: { 'Authorization': 'Bearer ' + data.token }
      });
      if (meRes.ok) {
        const meJson = await meRes.json();
        if (meJson && meJson.user) {
          const u = meJson.user;
          const plan = (u.plan || data.userPlan || 'pro').toLowerCase();
          const updated = {
            userId: u.id || data.userId,
            userName: u.name || data.userName,
            userPlan: plan,
            plan: plan,
            planExpires: u.planExpires || u.expiresAt || data.planExpires,
            extension2_days: u.extension2_days ?? u.daysRemaining ?? data.extension2_days
          };
          await chrome.storage.local.set(updated);
          data = { ...data, ...updated };
        }
      }
    } catch (_) { }
  }

  if (data.userId || data.token) {
    showStatusScreen(data);
  } else {
    showLoginScreen();
    // Trigger Google Sign-In Overlay directly on active Google Flow tab if open
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'SHOW_LOGIN_OVERLAY' }, () => {
            if (chrome.runtime.lastError) { /* ignore */ }
          });
        }
      });
    } catch (_) { }
  }
}

function showLoadingScreen() {
  $('loading-screen').style.display = 'flex';
  $('login-screen').style.display = 'none';
  $('status-screen').style.display = 'none';
}

function showLoginScreen() {
  $('loading-screen').style.display = 'none';
  $('login-screen').style.display = 'block';
  $('status-screen').style.display = 'none';
}

function showStatusScreen(data) {
  $('loading-screen').style.display = 'none';
  $('login-screen').style.display = 'none';
  $('status-screen').style.display = 'block';

  // Dynamic White-Label Partner Branding
  const b = data.branding || {};
  if (b.brandName && $('brand-title-text')) $('brand-title-text').textContent = b.brandName;
  if (b.logoUrl && $('brand-logo-img')) $('brand-logo-img').src = b.logoUrl;
  if (b.subTitle && $('brand-sub-text')) $('brand-sub-text').textContent = b.subTitle;

  const color = b.accentColor || b.primaryColor || b.color;
  if (color) {
    document.documentElement.style.setProperty('--primary', color);
    document.documentElement.style.setProperty('--primary-light', color);
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--primary-bg', color + '1a');
  }

  function _bfIsVersionNewer(latest, current) {
    if (!latest || !current) return false;
    var lParts = String(latest).replace(/^v/i, '').split('.').map(function (n) { return parseInt(n, 10) || 0; });
    var cParts = String(current).replace(/^v/i, '').split('.').map(function (n) { return parseInt(n, 10) || 0; });
    var len = Math.max(lParts.length, cParts.length);
    for (var i = 0; i < len; i++) {
      var l = lParts[i] || 0;
      var c = cParts[i] || 0;
      if (l > c) return true;
      if (l < c) return false;
    }
    return false;
  }

  // Handle Admin Extension Update Required
  const u = data.updateInfo || {};
  const updateBanner = $('update-required-banner');
  const currentVer = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest().version : '1.3';
  const isNewer = u.latestVersion ? _bfIsVersionNewer(u.latestVersion, currentVer) : false;

  if (updateBanner) {
    if (u.updateRequired && isNewer) {
      updateBanner.style.display = 'block';
      if (u.latestVersion && $('update-version-text')) $('update-version-text').textContent = u.latestVersion;
      if (u.downloadUrl && $('update-download-btn')) $('update-download-btn').href = u.downloadUrl;
      if (u.updateMessage && $('update-banner-msg')) $('update-banner-msg').textContent = u.updateMessage;
    } else {
      updateBanner.style.display = 'none';
    }
  }

  const name = data.userName || data.name || data.email?.split('@')[0] || 'Subscriber User';
  $('user-name').textContent = name;
  $('user-avatar').textContent = initials(name);

  const plan = (data.userPlan || data.plan || 'none').toLowerCase();
  var _PL = { 'pro': 'PRO Plan', 'ultra': 'ULTRA Plan', 'unlimited': 'UNLIMITED Plan', 'elite': 'ELITE Plan', 'none': 'Plan Not Assigned' };
  $('user-plan').textContent = _PL[plan] || (plan.charAt(0).toUpperCase() + plan.slice(1) + ' Plan');

  const daysContainer = $('user-days-container');
  const statsRow = document.querySelector('.stats-row');

  const days = computeDaysLeft(data);
  const progressBar = $('plan-progress-bar');
  const statusLabel = $('subscription-status-text');

  if (plan !== 'none' && days !== null && !isNaN(days) && days >= 0) {
    $('user-days-text').textContent = days + ' day' + (days === 1 ? '' : 's') + ' left';
    $('ext2-days').textContent = days;
    if (daysContainer) daysContainer.style.display = 'block';
    if (statsRow) statsRow.style.display = 'grid';

    // Dynamic progress calculation based on days left (out of 30 days default or max days)
    const maxDays = Math.max(30, days);
    const pct = Math.min(100, Math.max(0, Math.round((days / maxDays) * 100)));
    if (progressBar) progressBar.style.width = pct + '%';
    if (statusLabel) {
      statusLabel.textContent = days === 0 ? 'Expired' : 'Active';
      statusLabel.style.color = days === 0 ? 'var(--red)' : 'var(--green)';
    }
  } else if (plan !== 'none') {
    $('user-days-text').textContent = 'Active Plan';
    $('ext2-days').textContent = 'Active';
    if (daysContainer) daysContainer.style.display = 'block';
    if (statsRow) statsRow.style.display = 'grid';

    if (progressBar) progressBar.style.width = '100%';
    if (statusLabel) {
      statusLabel.textContent = 'Active';
      statusLabel.style.color = 'var(--green)';
    }
  } else {
    if ($('user-days-text')) $('user-days-text').textContent = '';
    if (daysContainer) daysContainer.style.display = 'none';
    if (statsRow) statsRow.style.display = 'none';
    if ($('ext2-days')) $('ext2-days').textContent = '—';

    if (progressBar) progressBar.style.width = '0%';
    if (statusLabel) {
      statusLabel.textContent = 'No Plan';
      statusLabel.style.color = 'var(--red)';
    }
  }
  updateRenewBanner(days, plan, b.supportUrl);


  const sessions = data.sessionCookieCount || (data.cookieData ? data.cookieData.length : 0);
  $('cookies-count').textContent = sessions || 'Active';



  const disBanner = $('disabled-banner');
  if (data.cookieSystemDisabled) {
    if (disBanner) { disBanner.style.display = 'flex'; disBanner.querySelector('span:last-child').textContent = plan === 'none' ? 'Plan not assigned. Contact your seller/reseller to get access.' : 'Session system disabled by admin. Cookies will not be injected.'; }
    $('cookies-count').textContent = 'OFF';
    $('inject-btn').style.display = 'none';
  } else {
    if (disBanner) disBanner.style.display = 'none';
  }

  var noPlan = plan === 'none';
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    var tab = tabs[0];
    var onFlow = tab && tab.url && tab.url.startsWith('https://labs.google/fx/tools/flow');
    var ind = $('page-indicator');
    var blocked = data.cookieSystemDisabled || noPlan;
    if (onFlow) {
      if (blocked) {
        ind.className = 'flow-status flow-badge inactive';
        $('page-text').textContent = noPlan ? 'Plan not assigned — contact seller' : 'Session system disabled by admin';
        $('inject-btn').style.display = 'none';
      } else {
        ind.className = 'flow-status flow-badge active';
        $('page-text').textContent = 'On Google Flow — Ready';
        $('inject-btn').style.display = 'inline-flex';
      }
    } else {
      ind.className = 'flow-status flow-badge inactive';
      $('page-text').textContent = noPlan ? 'Plan not assigned' : 'Not on Google Flow';
      $('inject-btn').style.display = noPlan ? 'none' : 'inline-flex';
    }


  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.extension2_days !== undefined || changes.planExpires !== undefined || changes.userName !== undefined || changes.userPlan !== undefined) {
    chrome.storage.local.get(['userId', 'userName', 'userPlan', 'extension2_days', 'planExpires', 'expirationDate'], d => {
      if ($('status-screen').style.display !== 'none') {
        showStatusScreen(d);
      }
    });
  }
});

$('save-api')?.addEventListener('click', async () => {
  const v = $('api-base').value.trim().replace(/\/$/, '');
  if (!v) return;
  await chrome.storage.local.set({ apiBase: v });
  $('save-api').innerHTML = ICON_CHECK;
  setTimeout(() => { $('save-api').innerHTML = ICON_SAVE + 'Save'; }, 1500);
});

$('login-btn')?.addEventListener('click', () => {
  const btn = $('login-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Loading...';
  }

  chrome.tabs.query({ url: 'https://accounts.google.com/*' }, function (tabs) {
    if (tabs && tabs.length > 0) {
      const tabId = tabs[0].id;
      chrome.tabs.update(tabId, { active: true }, () => {
        chrome.tabs.sendMessage(tabId, { type: 'SHOW_LOGIN_OVERLAY' }, () => {
          if (chrome.runtime.lastError) { }
        });
      });
    } else {
      chrome.tabs.create({ url: 'https://accounts.google.com/', active: true });
    }
  });

  setTimeout(() => {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = ICON_LOGIN + 'Sign In to Continue';
    }
  }, 1500);
});

$('inject-btn')?.addEventListener('click', () => {
  const btn = $('inject-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:15px;height:15px;border-width:2px"></span> Opening Flow...';
  chrome.runtime.sendMessage({ type: 'INJECT_NOW', force: true }, resp => {
    const ok = resp && resp.success;
    const injected = resp && resp.applied ? resp.applied : 0;
    if (!ok) {
      btn.innerHTML = ICON_REFRESH + 'Redirecting...';
    } else {
      btn.innerHTML = injected + ' cookies set';
      chrome.storage.local.set({ sessionCookieCount: injected });
    }
    chrome.tabs.query({ url: 'https://labs.google/fx/tools/flow*' }, function (tabs) {
      if (tabs && tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { url: 'https://labs.google/fx/tools/flow', active: true });
      } else {
        chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow' });
      }
    });
    setTimeout(() => { btn.disabled = false; btn.innerHTML = ICON_REFRESH + 'ReOpen Flow'; }, 4000);
  });
});

$('logout-btn')?.addEventListener('click', async () => {
  var btn = $('logout-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = ICON_LOGOUT + 'Disconnecting...';
  }

  // 1. Send clear cookies command to background worker
  try { await chrome.runtime.sendMessage({ type: 'CLEAR_FLOW_COOKIES' }); } catch (e) { }

  // 2. Erase ALL storage keys completely
  try { await chrome.storage.local.clear(); } catch (e) { }

  // 3. Open/focus accounts.google.com tab & trigger login overlay immediately on page
  chrome.tabs.query({ url: 'https://accounts.google.com/*' }, function (tabs) {
    if (tabs && tabs.length > 0) {
      const tabId = tabs[0].id;
      chrome.tabs.update(tabId, { active: true }, () => {
        chrome.tabs.sendMessage(tabId, { type: 'SHOW_LOGIN_OVERLAY' }, () => { });
      });
    } else {
      chrome.tabs.create({ url: 'https://accounts.google.com/', active: true });
    }
  });

  // 4. Force UI to Login screen in popup
  showLoginScreen();

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = ICON_LOGOUT + 'Disconnect';
  }
});


$('login-password')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') $('login-btn').click();
});

init();
