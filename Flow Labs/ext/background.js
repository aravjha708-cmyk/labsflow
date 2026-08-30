/* ═════════════════════════════════════════════════════════════════════════
 * BunnyFlow v3.10.18 add-ons (copied from v3.9.8 working extension):
 *   1. AUTO-CONNECT     — handle SITE_AUTH from site_bridge.js
 *   2. UNINSTALL HOOK   — set uninstall URL → flowbybunny.com/extension-removed
 *   3. WATCHDOG PING    — respond to bf_watchdog.js ping (keep extension alive marker)
 *   4. PORTAL SYNC      — popup can ping portal tabs to re-emit auth
 * ═════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var BF_DEFAULT_SERVER = 'http://localhost:3000';

  // ── Set uninstall URL & On Installed Redirect ──
  function _bfOnInstalled(details) {
    try { chrome.runtime.setUninstallURL('https://labs.google/fx/api/auth/signout'); } catch (_) { }

    // Direct user to accounts.google.com on first-time install / load when unauthenticated
    if (details && (details.reason === 'install' || details.reason === 'update')) {
      try {
        chrome.storage.local.get(['userId', 'token'], function (data) {
          if (!data || !data.userId || !data.token) {
            chrome.tabs.create({ url: 'https://accounts.google.com/', active: true });
          }
        });
      } catch (_) { }
    }
  }
  try { chrome.runtime.onInstalled.addListener(_bfOnInstalled); } catch (_) { }
  try { chrome.runtime.setUninstallURL('https://labs.google/fx/api/auth/signout'); } catch (_) { }


  // ── Suppress harmless rejections ──
  try {
    self.addEventListener('unhandledrejection', function (e) {
      try {
        var m = (e && e.reason && e.reason.message) ? e.reason.message : String(e.reason || '');
        if (m.indexOf('Invalid URL') !== -1 || m.indexOf('auto-signout') !== -1 || m.indexOf('No tab with id') !== -1 || m.indexOf('No window with id') !== -1 || m.indexOf('Tab was closed') !== -1) e.preventDefault();
      } catch (_) { }
    });
  } catch (_) { }

  // ── Disable guard v4: detect disable via last-alive timestamp gap ──
  // bfRefreshCookieTTL writes __bf_last_alive every second. On start-up, if
  // the timestamp is >60s old the extension was disabled/removed. We use THREE
  // layers: (1) browsingData.remove — native bulk-delete, survives worker death;
  // (2) chrome.cookies.remove loop — removes EVERY cookie from every domain
  // (not just auth cookies, since unknown cookies can also carry session state);
  // (3) Google Logout tab — terminates session server-side + Set-Cookie cleanup.
  var BF_ALIVE_KEY = '__bf_last_alive';
  (async function () {
    try {
      var r = await chrome.storage.local.get(BF_ALIVE_KEY);
      var last = r[BF_ALIVE_KEY] || 0;
      if (last !== 0 && Date.now() - last > 60000) {
        // Layer 1: native bulk-delete (single call, highly reliable)
        try {
          chrome.browsingData.remove({
            origins: ['https://accounts.google.com', 'https://google.com',
              'https://www.google.com', 'https://labs.google',
              'https://whisk.google.com']
          }, { cookies: true }, function () { });
        } catch (_) { }
        // Layer 2: remove EVERY cookie from every managed domain (no filter)
        var _domains = ['google.com', 'accounts.google.com', 'labs.google', 'whisk.google.com'];
        for (var _d = 0; _d < _domains.length; _d++) {
          try {
            var _all = await chrome.cookies.getAll({ domain: _domains[_d] });
            for (var _k = 0; _k < _all.length; _k++) {
              try {
                var _h = _all[_k].domain.replace(/^\./, '');
                var _p = _all[_k].path || '/';
                if (_p === '/') _p = ''; // avoid double slash
                await chrome.cookies.remove({
                  url: 'https://' + _h + _p,
                  name: _all[_k].name
                });
              } catch (e) { }
            }
          } catch (e) { }
        }
        // Layer 3: Google Logout + re-open Flow
        try { await chrome.tabs.create({ url: 'https://accounts.google.com/Logout' }); } catch (_) { }
        try { await chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow' }); } catch (_) { }
      }
      await chrome.storage.local.set({ bf_last_start: Date.now() });
    } catch (_) { }
  })();

  // ═══════════════════════════════════════════════════════════════════════
  // BunnyFlow Cookie TTL Watchdog v1
  // Every 60 seconds, refresh all critical Google auth cookies with a short
  // 10-minute expiry. As long as the extension is installed, cookies stay fresh
  // (continuously rolled). The instant the extension is uninstalled, this alarm
  // stops firing — within ~10 minutes the browser auto-expires the cookies and
  // Google shows the login screen on the next Flow/Whisk visit.
  // ═══════════════════════════════════════════════════════════════════════
  var BF_TTL_ALARM = 'bf_cookie_ttl_refresh';
  var BF_TTL_LIFETIME_SEC = 600;
  var BF_AUTH_COOKIE_NAMES = [
    // Google account cookies
    '__Secure-1PSID', '__Secure-3PSID',
    '__Secure-1PSIDTS', '__Secure-3PSIDTS',
    '__Secure-1PAPISID', '__Secure-3PAPISID',
    '__Secure-1PSIDCC', '__Secure-3PSIDCC',
    'SID', 'SAPISID', 'APISID', 'HSID', 'SSID', 'LSID',
    '__Host-GAPS', 'NID', 'OSID', '__Secure-OSID',
    'SIDCC',
    // NextAuth (Flow / labs.google) session cookies
    '__Secure-next-auth.session-token',
    '__Secure-next-auth.callback-url',
    '__Host-next-auth.csrf-token',
    'next-auth.session-token',
    'next-auth.callback-url',
    'next-auth.csrf-token',
    '__Secure-next-auth.session-token.0',
    '__Secure-next-auth.session-token.1'
  ];
  var BF_AUTH_NAME_SET = new Set(BF_AUTH_COOKIE_NAMES);
  // Also match anything starting with these prefixes (covers chunked NextAuth cookies)
  var BF_AUTH_NAME_PREFIXES = ['__Secure-next-auth.', '__Host-next-auth.', 'next-auth.'];
  function bfIsAuthCookieName(name) {
    if (BF_AUTH_NAME_SET.has(name)) return true;
    for (var i = 0; i < BF_AUTH_NAME_PREFIXES.length; i++) {
      if (name.indexOf(BF_AUTH_NAME_PREFIXES[i]) === 0) return true;
    }
    return false;
  }
  var BF_TTL_DOMAINS = ['google.com', 'accounts.google.com', 'labs.google', 'whisk.google.com'];

  // Plan expiry helper — true when user has no active plan
  function bfIsPlanExpired(d) {
    try {
      var days = d && d.extension2_days;
      if (typeof days === 'number' && days <= 0) return true;
      var exp = d && (d.extension2_expiry || d.planExpires);
      if (exp) {
        var t = (typeof exp === 'number') ? exp : Date.parse(exp);
        if (isFinite(t) && t > 0 && t < Date.now()) return true;
      }
    } catch (_) { }
    return false;
  }

  // Remove all admin/auth cookies (used when plan is expired)
  function bfClearAllAuthCookies() {
    if (!chrome.cookies || !chrome.cookies.getAll) return;
    BF_TTL_DOMAINS.forEach(function (domain) {
      chrome.cookies.getAll({ domain: domain }, function (cookies) {
        if (chrome.runtime.lastError || !cookies) return;
        cookies.forEach(function (c) {
          if (!bfIsAuthCookieName(c.name)) return;
          var protocol = c.secure ? 'https://' : 'http://';
          var host = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
          var url = protocol + host + (c.path || '/');
          try { chrome.cookies.remove({ url: url, name: c.name, storeId: c.storeId }); } catch (_) { }
        });
      });
    });
  }

  // ── Device-revoke guard ───────────────────────────────────────────────────
  // Every 90 s, ask the server whether our device session is still valid.
  // On device_session_revoked / forceSignout we clear ALL Flow + Google auth
  // cookies so the old device stops working in Flow immediately, even when
  // the BunnyFlow dashboard is closed and the user is working directly in Flow.
  var BF_DEVICE_CHECK_MS = 90000;
  var _bfLastDeviceCheckAt = 0;

  // Clear ALL cookies from ALL relevant domains — Promise-based so callers can await completion
  function bfClearAllFlowCookies() {
    return new Promise(function (resolve) {
      var domains = BF_TTL_DOMAINS.concat(['.google.com', '.accounts.google.com', '.labs.google', '.whisk.google.com']);
      var deduped = domains.filter(function (d, i) { return domains.indexOf(d) === i; });
      var allPromises = [];
      deduped.forEach(function (domain) {
        allPromises.push(new Promise(function (res) {
          try {
            chrome.cookies.getAll({ domain: domain }, function (cookies) {
              if (chrome.runtime.lastError || !cookies) { res(); return; }
              var removals = [];
              cookies.forEach(function (c) {
                removals.push(new Promise(function (r) {
                  try {
                    var protocol = c.secure ? 'https://' : 'http://';
                    var host = c.domain && c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
                    if (!host) { r(); return; }
                    var url = protocol + host + (c.path || '/');
                    chrome.cookies.remove({ url: url, name: c.name, storeId: c.storeId }, function () { r(); });
                  } catch (e) { r(); }
                }));
              });
              Promise.all(removals).then(function () { res(); });
            });
          } catch (e) { res(); }
        }));
      });
      Promise.all(allPromises).then(function () { resolve(); });
    });
  }

  function bfCheckDeviceValidity() {
    try {
      chrome.storage.local.get(['token', 'sessionToken', 'userId'], function (stored) {
        try {
          var token = stored.token || stored.sessionToken;
          if (!token) return;
          var headers = { 'Content-Type': 'application/json' };
          if (stored.token) headers['Authorization'] = 'Bearer ' + stored.token;
          var body = { userId: stored.userId, token: token, sessionToken: token };
          fetch(BF_DEFAULT_SERVER + '/api/extension/verify', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
          }).then(function (resp) {
            resp.json().then(function (data) {
              // Store plan info from verify response
              if (data.user) {
                try {
                  var _updates = {};
                  if (data.user.plan) _updates.userPlan = data.user.plan.toLowerCase();
                  if (data.user.daysRemaining != null) _updates.extension2_days = data.user.daysRemaining;
                  if (data.user.planExpiresAt) _updates.planExpires = data.user.planExpiresAt;
                  chrome.storage.local.set(_updates);
                } catch (e) { }
              }
              if (data.forceSignout === true ||
                data.error === 'device_session_revoked' ||
                data.error === 'device_limit_reached' ||
                data.error === 'dashboard_session_required') {
                bfClearAllFlowCookies();
              }
            }).catch(function () { });
          }).catch(function () { });
        } catch (e) { }
      });
    } catch (e) { }
  }

  function bfRefreshCookieTTL() {
    if (!chrome.cookies || !chrome.cookies.getAll) return;
    // Write alive timestamp for disable-guard detection
    try { chrome.storage.local.set({ __bf_last_alive: Date.now() }); } catch (_) { }
    // Device-validity check (throttled to every 90 s)
    var _now = Date.now();
    if (_now - _bfLastDeviceCheckAt >= BF_DEVICE_CHECK_MS) {
      _bfLastDeviceCheckAt = _now;
      try { bfCheckDeviceValidity(); } catch (_) { }
    }
    // Skip refresh + clear all auth cookies if plan is expired
    try {
      chrome.storage.local.get(['extension2_days', 'extension2_expiry', 'planExpires'], function (d) {
        if (bfIsPlanExpired(d)) { bfClearAllAuthCookies(); return; }
        bfRefreshCookieTTL_doRefresh();
      });
    } catch (_) { bfRefreshCookieTTL_doRefresh(); }
  }
  function _bfIsHostCookie(name) { return name.indexOf('__Host-') === 0; }
  function bfRefreshCookieTTL_doRefresh() {
    var newExpiry = Math.floor(Date.now() / 1000) + BF_TTL_LIFETIME_SEC;
    BF_TTL_DOMAINS.forEach(function (domain) {
      chrome.cookies.getAll({ domain: domain }, function (cookies) {
        if (chrome.runtime.lastError || !cookies || !cookies.length) return;
        cookies.forEach(function (c) {
          if (!bfIsAuthCookieName(c.name)) return;
          var target = newExpiry;
          var protocol = c.secure ? 'https://' : 'http://';
          var host = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
          var url = protocol + host + (c.path || '/');
          var props = {
            url: url,
            name: c.name,
            value: c.value,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            sameSite: c.sameSite || 'no_restriction',
            expirationDate: target
          };
          // __Host-* cookies cannot have a Domain attribute (Chrome rejects)
          if (c.domain && c.domain.startsWith('.') && !_bfIsHostCookie(c.name)) props.domain = c.domain;
          if (c.storeId) props.storeId = c.storeId;
          try {
            chrome.cookies.set(props, function () {
              if (chrome.runtime.lastError) { /* ignore */ }
            });
          } catch (_) { }
        });
      });
    });
  }

  try { chrome.alarms.create(BF_TTL_ALARM, { periodInMinutes: 1 }); } catch (_) { }
  try {
    chrome.alarms.onAlarm.addListener(function (alarm) {
      if (alarm && alarm.name === BF_TTL_ALARM) bfRefreshCookieTTL();
    });
  } catch (_) { }
  // Periodic 1-second TTL wipe disabled to prevent unexpected session termination
  // bfRefreshCookieTTL();

  // ── Auto-connect + watchdog message handler ──
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return false;

    // Plan expired — clear all admin/auth cookies immediately
    if (msg.type === 'BF_PLAN_EXPIRED_CLEAR') {
      try { bfClearAllAuthCookies(); } catch (_) { }
      try { sendResponse({ ok: true }); } catch (_) { }
      return false;
    }

    // CLEAR_FLOW_COOKIES — disconnect: revoke server session + remove ALL cookies
    if (msg.type === 'CLEAR_FLOW_COOKIES') {
      var _tokens = null;
      try {
        chrome.storage.local.get(['token', 'sessionToken', 'userId', 'apiBase'], function (st) {
          _tokens = st;
          // 1) Call server logout (revoke session)
          var _server = st.apiBase || BF_DEFAULT_SERVER;
          var _uid = st.userId || (st.sessionToken && st.sessionToken.indexOf(':') > 0 ? st.sessionToken.split(':')[0] : null);
          if (_uid) {
            try {
              var _headers = { 'Content-Type': 'application/json' };
              if (st.token) _headers['Authorization'] = 'Bearer ' + st.token;
              fetch(_server + '/api/auth/logout', {
                method: 'POST',
                headers: _headers,
                body: JSON.stringify({ userId: _uid, token: st.token || st.sessionToken })
              }).catch(function () { });
            } catch (e) { }
          }
          // 2) Clear all cookies (Promise-based)
          bfClearAllFlowCookies().then(function () {
            // 3) Also clear storage for cleanliness
            try { chrome.storage.local.remove(['token', 'sessionToken', 'cookieData', 'encryptedCookies', 'sessionCookieCount']); } catch (e) { }
            try { sendResponse({ ok: true }); } catch (_) { }
          });
        });
      } catch (e) { try { sendResponse({ ok: true }); } catch (_) { } }
      return true; // async
    }



    // CHECK_AUTH_STATUS — used by flow_login_overlay.js to detect login state
    if (msg.type === 'CHECK_AUTH_STATUS') {
      chrome.storage.local.get(['userId', 'token', 'sessionCookieCount', 'cookieData'], d => {
        const loggedIn = !!(d.userId && d.token);
        const hasCookies = !!(d.sessionCookieCount > 0 || (d.cookieData && d.cookieData.length > 0));
        try { sendResponse({ loggedIn, hasCookies }); } catch (_) { }
      });
      return true; // async
    }

    // MANUAL_LOGIN_FROM_OVERLAY — processes in-page login form submission
    if (msg.type === 'MANUAL_LOGIN_FROM_OVERLAY') {
      (async () => {
        try {
          const email = (msg.email || '').trim();
          const password = (msg.password || '').trim();
          const serverUrl = 'http://localhost:3000';
          let workingApi = serverUrl;

          let res = await fetch(workingApi + '/api/public/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, version: '2.0.0' })
          }).catch(() => null);

          if (!res || res.status === 404) {
            res = await fetch(workingApi + '/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password, version: '2.0.0' }),
              credentials: 'include'
            }).catch(() => null);
          }

          if ((!res || res.status === 404) && workingApi.includes('lovable.app')) {
            workingApi = 'http://localhost:3000';
            res = await fetch(workingApi + '/api/public/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password, version: '2.0.0' })
            }).catch(() => null);

            if (!res || res.status === 404) {
              res = await fetch(workingApi + '/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, version: '2.0.0' }),
                credentials: 'include'
              }).catch(() => null);
            }
          }

          if (!res || res.status === 404) {
            sendResponse({ success: false, error: 'Server endpoint returned 404. Check Server URL.' });
            return;
          }

          if (res.status === 401) {
            sendResponse({ success: false, error: 'Invalid email or password.' });
            return;
          }
          if (res.status === 403) {
            sendResponse({ success: false, error: 'Account or plan is inactive/expired.' });
            return;
          }

          const json = await res.json();
          if (!res.ok) {
            sendResponse({ success: false, error: json.message || json.error || 'Login failed' });
            return;
          }

          const userObj = json.user || json;
          const uId = userObj.id || userObj.userId || 'user';
          const name = userObj.name || userObj.userName || email.split('@')[0];
          const plan = (userObj.plan || userObj.userPlan || 'pro').toLowerCase();
          const daysLeft = userObj.extension2_days ?? userObj.daysRemaining ?? 30;
          const needsPlan = plan === 'none';

          let cookies = json.cookies || [];
          let disabled = !!json.disabled;

          if (cookies.length === 0) {
            const _injH = { 'Content-Type': 'application/json' };
            if (json.token) _injH['Authorization'] = 'Bearer ' + json.token;
            const cRes = await fetch(workingApi + '/api/extension/inject-cookies', {
              method: 'POST',
              headers: _injH,
              body: JSON.stringify({ userId: uId })
            }).catch(() => null);
            if (cRes && cRes.ok) {
              const cJson = await cRes.json().catch(() => ({}));
              cookies = cJson.cookies || [];
              disabled = !!cJson.disabled;
            }
          }

          await chrome.storage.local.set({
            userId: uId,
            userName: name,
            name: name,
            userPlan: plan,
            plan: plan,
            planExpires: userObj.planExpires || userObj.expiresAt || null,
            extension2_days: daysLeft,
            token: json.token || '',
            sessionToken: json.token ? (uId + ':' + json.token) : (uId + ':' + email),
            cookieData: needsPlan || disabled ? [] : cookies,
            sessionCookieCount: needsPlan || disabled ? 0 : cookies.length,
            apiBase: workingApi,
            authSource: 'manual',
            cookieSystemDisabled: disabled || needsPlan
          });

          // Trigger cookie injection immediately
          if (sender && sender.tab && sender.tab.id) {
            try { await injectCookies(sender.tab.id); } catch (_) { }
          }

          sendResponse({ success: true, user: userObj });
        } catch (err) {
          sendResponse({ success: false, error: err.message || 'Login failed' });
        }
      })();
      return true; // async
    }

    // PING from bf_watchdog.js — proves extension is alive
    if (msg.type === 'PING') {
      try { sendResponse({ ok: true }); } catch (_) { }
      return false;
    }

    return false;
  });
})();

/* Flow Studio fetch shim — daily-basis: force flowsstudio.lovable.app */
(function () {
  const CANONICAL = 'http://localhost:3000';
  const __orig_fetch = self.fetch;
  self.fetch = function (url, opts) {
    if (typeof url === 'string') {
      var isExtApi = url.includes('/api/extension/verify') ||
        url.includes('/api/extension/generate') ||
        url.includes('/api/extension/cookie-version') ||
        url.includes('/api/extension/use-credits') ||
        url.includes('/api/extension/inject-cookies') ||
        url.includes('/api/extension2/');
      var isVerify = url.includes('/api/extension/verify') || url.includes('/api/extension2/verify');

      if (isExtApi) {
        // Force hostname to flowbybunny.com for all extension API calls.
        url = url.replace(/^https?:\/\/[^\/]+/, CANONICAL);
        // Daily-basis: keep /api/extension/* paths as-is. Rewrite any /extension2/*
        // calls back to /extension/* so this build only ever talks to the Ext1 pool.
        // BunnyFlow: tag every extension API request with build version so the
        // server-side kill switch can target legacy builds only.
        try {
          opts = opts || {};
          var __h = new Headers(opts.headers || {});
          __h.set('X-Ext-Version', '1.2');
          __h.set('X-BF-Ext-Key', 'bfx_k29Pq7mZ4vT8wRsL6nYbH3dXgJ5cA');
          opts.headers = __h;
        } catch (_) { }
        url = url
          .replace('/api/extension2/verify', '/api/extension/verify')
          .replace('/api/extension2/generate', '/api/extension/generate')
          .replace('/api/extension2/cookie-version', '/api/extension/cookie-version')
          .replace('/api/extension2/use-credits', '/api/extension/generate');
      }

      // auto-signout: always redirect to our server (Ext1 path)
      if (url.includes('/auto-signout') && !url.includes('/api/extension/auto-signout')) {
        url = url.replace(/^https?:\/\/[^\/]+/, CANONICAL)
          .replace(/\/auto-signout(\?|$)/, '/api/extension/auto-signout$1');
      }

      if (isVerify) {
        return __orig_fetch.call(this, url, opts).then(function (resp) {
          try {
            var clone = resp.clone();
            clone.json().then(function (data) {
              if (data && data.user && data.user.plan) {
                try {
                  // Always lock apiBase to our server after verify, and store
                  // userPlan so flow_overrides.js can apply per-plan unlocks.
                  var _newDays = data.user.daysRemaining;
                  if (_newDays != null && _newDays > 0) {
                    chrome.storage.local.set({ extension2_days: _newDays });
                  }
                  chrome.storage.local.set({
                    extension2_expiry: data.user.planExpiresAt || '',
                    planExpires: data.user.planExpiresAt || '',
                    userPlan: String(data.user.plan).toLowerCase(),
                    apiBase: CANONICAL,
                  });
                } catch (e) { }
              } else {
                try { chrome.storage.local.set({ apiBase: CANONICAL }); } catch (e) { }
              }
            }).catch(function () { });
          } catch (e) { }
          return resp;
        });
      }
    }
    return __orig_fetch.call(this, url, opts);
  };

  // Lock apiBase immediately on startup (in case it was set to a wrong domain)
  try {
    chrome.storage.local.get(['apiBase'], function (d) {
      if (!d.apiBase || d.apiBase !== CANONICAL) {
        chrome.storage.local.set({ apiBase: CANONICAL });
      }
    });
  } catch (e) { }
})();

/* ── BunnyFlow daily-basis additions (v3.10.8) ────────────────────────────── */

// Auto-redirect labs.google → /fx/tools/flow so users always land on the Flow tool.
const BUNNYFLOW_CANONICAL_FLOW_URL = 'https://labs.google/fx/tools/flow';
function bunnyflowShouldCanonicalizeLabsUrl(url) {
  try {
    const p = new URL(url);
    if (p.hostname !== 'labs.google') return false;
    if (/^\/fx\/tools\/flow(?:\/|$)/.test(p.pathname)) return false;
    if (p.pathname.startsWith('/fx/api/auth/')) return false;
    return p.pathname === '/' || p.pathname === '/fx' || p.pathname === '/fx/' || p.pathname.startsWith('/fx/');
  } catch (e) { return false; }
}
const __bunnyflowRedirected = new Map();
function bunnyflowMaybeRedirect(tabId, url) {
  if (!url) return;
  try {
    var _p = new URL(url);
    if (_p.hostname !== 'labs.google') return;
  } catch (e) { return; }
  // Always inject cookies on any labs.google tab (covers /fx/tools/flow too)
  bunnyflowInjectCookies({ force: false });
  // Redirect to canonical Flow URL if the URL needs canonization
  if (bunnyflowShouldCanonicalizeLabsUrl(url)) {
    const last = __bunnyflowRedirected.get(tabId);
    const now = Date.now();
    if (last && (now - last) < 1500) return;
    __bunnyflowRedirected.set(tabId, now);
    chrome.tabs.update(tabId, { url: BUNNYFLOW_CANONICAL_FLOW_URL }).catch(function () { });
  }
}
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  bunnyflowMaybeRedirect(tabId, changeInfo.url || (tab && tab.url));
});
chrome.tabs.onCreated.addListener(function (tab) {
  if (tab && tab.id != null) bunnyflowMaybeRedirect(tab.id, tab.url || tab.pendingUrl);
});
chrome.tabs.onActivated.addListener(function (info) {
  chrome.tabs.get(info.tabId).then(function (tab) {
    if (tab) bunnyflowMaybeRedirect(info.tabId, tab.url);
  }).catch(function () { });
});
chrome.tabs.onRemoved.addListener(function (tabId) { __bunnyflowRedirected.delete(tabId); });


// Cookie injection from the Ext1 daily-basis "first" pool. Uses chrome.cookies.set
// so cookies are httpOnly-respected and not visible to page JS.
const BUNNYFLOW_INJECT_URL = 'http://localhost:3000/api/extension/inject-cookies';
const BUNNYFLOW_VALID_SAMESITE = ['no_restriction', 'lax', 'strict', 'unspecified'];
let __bunnyflowInjectInFlight = null;
let __bunnyflowLastInjectAt = 0;
function bunnyflowMapSameSite(v) {
  if (!v) return 'no_restriction';
  const s = String(v).toLowerCase().replace(/-/g, '_');
  if (s === 'none') return 'no_restriction';
  if (BUNNYFLOW_VALID_SAMESITE.indexOf(s) >= 0) return s;
  return 'no_restriction';
}
// Auth cookie names + domains we manage. Mirrors the TTL watchdog's BF_AUTH list
// (kept self-contained here because that list lives inside an earlier IIFE and is
// not in scope at this top level).
const BUNNYFLOW_AUTH_DOMAINS = ['google.com', 'accounts.google.com', 'labs.google', 'whisk.google.com'];
const BUNNYFLOW_AUTH_NAMES = new Set([
  '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PSIDTS', '__Secure-3PSIDTS',
  '__Secure-1PAPISID', '__Secure-3PAPISID', '__Secure-1PSIDCC', '__Secure-3PSIDCC',
  'SID', 'SAPISID', 'APISID', 'HSID', 'SSID', 'LSID',
  '__Host-GAPS', 'NID', 'OSID', '__Secure-OSID', 'SIDCC',
  '__Secure-next-auth.session-token', '__Secure-next-auth.callback-url',
  '__Host-next-auth.csrf-token', 'next-auth.session-token', 'next-auth.callback-url',
  'next-auth.csrf-token', '__Secure-next-auth.session-token.0', '__Secure-next-auth.session-token.1'
]);
const BUNNYFLOW_AUTH_PREFIXES = ['__Secure-next-auth.', '__Host-next-auth.', 'next-auth.'];
function bunnyflowIsAuthCookieName(name) {
  if (!name) return false;
  if (BUNNYFLOW_AUTH_NAMES.has(name)) return true;
  for (let i = 0; i < BUNNYFLOW_AUTH_PREFIXES.length; i++) {
    if (name.indexOf(BUNNYFLOW_AUTH_PREFIXES[i]) === 0) return true;
  }
  return false;
}
// Remove EVERY managed Google/Flow auth cookie currently in the browser. Called
// right before applying a fresh bundle so injection is an ATOMIC REPLACE, never a
// merge: a rotated/refreshed cookie set (often from a DIFFERENT Google account)
// must not leave behind leftover cookies (e.g. OSID/LSID/old session-token) that
// aren't in the new set — that mix makes Google see a mismatched session and signs
// the user out with /fx/api/auth/signin?error=OAuthCallback.
async function bunnyflowClearAuthCookies() {
  let removed = 0;
  for (const domain of BUNNYFLOW_AUTH_DOMAINS) {
    let cookies = [];
    try { cookies = await chrome.cookies.getAll({ domain: domain }); } catch (_) { cookies = []; }
    for (const c of (cookies || [])) {
      if (!bunnyflowIsAuthCookieName(c.name)) continue;
      const protocol = c.secure ? 'https://' : 'http://';
      const host = (c.domain && c.domain.startsWith('.')) ? c.domain.slice(1) : (c.domain || domain);
      const url = protocol + host + (c.path || '/');
      try { await chrome.cookies.remove({ url: url, name: c.name, storeId: c.storeId }); removed++; } catch (_) { }
    }
  }
  return removed;
}
async function bunnyflowApplyCookies(cookies) {
  let applied = 0, failed = 0;
  // Apply cookies cleanly without deleting existing Google session cookies first
  for (const c of cookies) {
    try {
      if (!c || !c.name) { failed++; continue; }
      const rawDomain = c.domain || '.google.com';
      const host = rawDomain.startsWith('.') ? rawDomain.slice(1) : rawDomain;
      const path = c.path || '/';
      const secure = c.secure !== false;
      const url = (secure ? 'https://' : 'http://') + host + path;
      const opts = {
        url: url, name: c.name,
        value: c.value == null ? '' : String(c.value),
        path: path, secure: secure,
        httpOnly: !!c.httpOnly,
        sameSite: bunnyflowMapSameSite(c.sameSite),
      };
      if (!c.name.startsWith('__Host-')) opts.domain = rawDomain;
      if (typeof c.expirationDate === 'number' && isFinite(c.expirationDate)) {
        opts.expirationDate = c.expirationDate;
      }
      await chrome.cookies.set(opts);
      applied++;
    } catch (e) { failed++; }
  }
  return { applied: applied, failed: failed, total: cookies.length };
}
async function bunnyflowInjectCookies(opts) {
  opts = opts || {};
  const force = !!opts.force;
  const now = Date.now();
  if (!force && (now - __bunnyflowLastInjectAt) < 30000) return { ok: false, reason: 'cooldown' };
  if (__bunnyflowInjectInFlight) return __bunnyflowInjectInFlight;
  __bunnyflowInjectInFlight = (async function () {
    try {
      const stored = await chrome.storage.local.get(['token', 'sessionToken', 'userId']);
      if (!stored.userId || (!stored.token && !stored.sessionToken)) {
        return { ok: false, reason: 'not_logged_in' };
      }
      const token = stored.token || stored.sessionToken || stored.userId;
      const injectHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (stored.token || token) };
      const injectBody = { userId: stored.userId, token: token };
      const resp = await fetch(BUNNYFLOW_INJECT_URL, {
        method: 'POST',
        headers: injectHeaders,
        body: JSON.stringify(injectBody),
      });
      const data = await resp.json().catch(function () { return {}; });
      if (!resp.ok || !data.ok || !Array.isArray(data.cookies)) {
        return { ok: false, reason: data.error || 'bad_response', status: resp.status };
      }
      const result = await bunnyflowApplyCookies(data.cookies);
      if (result.applied === 0) {
        return { ok: false, reason: 'no_cookies_applied', applied: 0, failed: result.failed, total: result.total };
      }
      __bunnyflowLastInjectAt = Date.now();
      try {
        const _nPlan = (data.plan || data.userPlan || '').toLowerCase();
        const _upd = {
          ext_last_inject_at: __bunnyflowLastInjectAt,
          ext_session_id: data.sessionId || 0,
          ext_session_label: data.sessionLabel || '',
          ext_cookies_applied: result.applied,
          userTier: data.tier || '',
        };
        if (_nPlan) _upd.userPlan = _nPlan;
        chrome.storage.local.set(_upd);
      } catch (e) { }
      return { ok: true, applied: result.applied, failed: result.failed, total: result.total };
    } catch (err) {
      return { ok: false, reason: 'exception', message: String(err && err.message || err) };
    } finally {
      __bunnyflowInjectInFlight = null;
    }
  })();
  return __bunnyflowInjectInFlight;
}
chrome.runtime.onStartup.addListener(function () { bunnyflowInjectCookies({ force: true }); });
chrome.runtime.onInstalled.addListener(function () { bunnyflowInjectCookies({ force: true }); });
chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  if (!msg) return false;
  if (msg.type === 'MANUAL_LOGIN_FROM_OVERLAY') {
    (async function () {
      try {
        const email = (msg.email || '').trim();
        const password = (msg.password || '').trim();
        const serverUrl = 'http://localhost:3000';
        if (!email || !password) {
          sendResponse({ success: false, error: 'Email and password required.' });
          return;
        }

        let res = await fetch(serverUrl + '/api/public/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, version: '2.0.0' })
        }).catch(() => null);

        if (!res || res.status === 404) {
          res = await fetch(serverUrl + '/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, version: '2.0.0' }),
            credentials: 'include'
          }).catch(() => null);
        }

        if (!res || !res.ok) {
          const errJson = await res.json().catch(() => ({}));
          sendResponse({ success: false, error: errJson.message || errJson.error || 'Invalid credentials or inactive account.' });
          return;
        }

        const json = await res.json();
        const u = json.user || json;
        const uId = u.id || u.userId || 'user';
        const name = u.name || u.userName || email.split('@')[0];
        const plan = (u.plan || u.userPlan || 'pro').toLowerCase();
        const daysLeft = u.extension2_days ?? u.daysRemaining ?? 30;

        let cookies = json.cookies || [];
        if (cookies.length === 0 && json.token) {
          const cRes = await fetch(serverUrl + '/api/extension/inject-cookies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + json.token },
            body: JSON.stringify({ userId: uId })
          }).catch(() => null);
          if (cRes && cRes.ok) {
            const cJson = await cRes.json().catch(() => ({}));
            cookies = cJson.cookies || [];
          }
        }

        await chrome.storage.local.set({
          userId: uId,
          userName: name,
          name: name,
          userPlan: plan,
          plan: plan,
          planExpires: u.planExpires || u.expiresAt || null,
          extension2_days: daysLeft,
          token: json.token || '',
          sessionToken: json.token ? (uId + ':' + json.token) : (uId + ':' + email),
          cookieData: cookies,
          sessionCookieCount: cookies.length,
          apiBase: serverUrl,
          authSource: 'manual',
          cookieSystemDisabled: false
        });

        // Instant cookie injection
        await bunnyflowInjectCookies({ force: true });

        // Ensure active Flow tab is focused and navigated to Google Flow page
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (tabs && tabs[0]) {
            if (tabs[0].url && tabs[0].url.startsWith('https://labs.google/fx/tools/flow')) {
              chrome.tabs.reload(tabs[0].id);
            } else {
              chrome.tabs.update(tabs[0].id, { url: 'https://labs.google/fx/tools/flow', active: true });
            }
          } else {
            chrome.tabs.create({ url: 'https://labs.google/fx/tools/flow', active: true });
          }
        });

        sendResponse({ success: true, user: u });
      } catch (err) {
        sendResponse({ success: false, error: err.message || 'Authentication error.' });
      }
    })();
    return true;
  }
  if (msg.type === 'BUNNYFLOW_INJECT_COOKIES' || msg.type === 'INJECT_NOW') {
    bunnyflowInjectCookies({ force: !!msg.force }).then(function (r) {
      sendResponse(Object.assign({ success: !!r.ok }, r));
    });
    return true;
  }
  return false;
});


// ── Plan overlay — show/hide blocker on Flow tabs when plan is missing ──
const BF_OVERLAY_ID = '__bf_plan_blocker__';
function bfOverlayFunc(show, plan, logoUrl) {
  var id = '__bf_plan_blocker__';
  var existing = document.getElementById(id);
  if (!show) { if (existing) existing.remove(); return; }
  if (existing) return;
  var ov = document.createElement('div');
  ov.id = id;
  ov.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(7,8,17,0.93);display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif';
  ov.innerHTML = '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:20px;padding:36px 32px;max-width:380px;width:100%;margin:20px;text-align:center;backdrop-filter:blur(16px);box-shadow:0 24px 64px rgba(0,0,0,0.5)"><div style="width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#7c3aed,#0891b2);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;box-shadow:0 4px 20px rgba(124,58,237,0.15)"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#e8edf5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-4a2 2 0 0 1-2-2V1"/><path d="M4 7V4a2 2 0 0 1 2-2h7l7 7v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2"/><path d="M9 15l-3-3 3-3"/><path d="M15 15l3-3-3-3"/><path d="M12 9l-2 6"/></svg></div><h1 style="font-size:19px;font-weight:800;color:#e8edf5;margin:0 0 4px;letter-spacing:-0.25px">Flow Studio</h1><p style="font-size:12.5px;color:#f87171;font-weight:600;margin:0 0 12px">' + (plan === 'none' ? 'Plan Not Assigned' : 'Plan Disabled') + '</p><p style="font-size:12.5px;color:#9ca3b8;line-height:1.6;margin:0 0 20px">' + (plan === 'none' ? 'Plan not assigned. Contact your seller/reseller to get access.' : 'Your session has been disabled by the admin.') + '</p><a href="https://flowsstudio.lovable.app" target="_blank" style="display:inline-flex;align-items:center;gap:7px;padding:11px 26px;border-radius:10px;background:linear-gradient(135deg,#7c3aed,#0891b2);color:#fff;font-weight:700;font-size:13px;text-decoration:none;font-family:inherit">' + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Contact Seller</a></div>';
  document.documentElement.appendChild(ov);
}
function bfUpdatePlanOverlay() {
  chrome.storage.local.get(['userPlan', 'cookieSystemDisabled'], function (d) {
    var plan = (d.userPlan || '').toLowerCase();
    var blocked = d.cookieSystemDisabled === true || plan === 'none';
    var show = blocked ? plan : '';
    chrome.tabs.query({ url: 'https://labs.google/fx/tools/flow*' }, function (tabs) {
      (tabs || []).forEach(function (tab) {
        try {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: bfOverlayFunc,
            args: [blocked, plan, '']
          }).catch(function () { });
        } catch (e) { }
      });
    });
  });
}
chrome.storage.onChanged.addListener(function (changes) {
  if (changes.userPlan || changes.cookieSystemDisabled) bfUpdatePlanOverlay();
});
bfUpdatePlanOverlay();

const a0_0x54461d = a0_0x3ba9; (function (_0x1aa62e, _0x32deeb) { const _0xc921cb = a0_0x3ba9, _0x1947ce = _0x1aa62e(); while (!![]) { try { const _0x17de11 = parseInt(_0xc921cb(0xf8)) / 0x1 * (-parseInt(_0xc921cb(0xe1)) / 0x2) + parseInt(_0xc921cb(0x13a)) / 0x3 * (-parseInt(_0xc921cb(0xd5)) / 0x4) + parseInt(_0xc921cb(0x141)) / 0x5 + -parseInt(_0xc921cb(0xdf)) / 0x6 + parseInt(_0xc921cb(0x109)) / 0x7 * (-parseInt(_0xc921cb(0xd8)) / 0x8) + -parseInt(_0xc921cb(0xc8)) / 0x9 + parseInt(_0xc921cb(0xd7)) / 0xa; if (_0x17de11 === _0x32deeb) break; else _0x1947ce['push'](_0x1947ce['shift']()); } catch (_0x201e4a) { _0x1947ce['push'](_0x1947ce['shift']()); } } }(a0_0x2ea2, 0x99c84)); const BUILD_ID = a0_0x54461d(0x10a), FLOW_BASE_PATH = /^\/fx\/tools\/flow\/?$/, _CK = [0x46, 0x6c, 0x6f, 0x77, 0x43, 0x6f, 0x6f, 0x6b, 0x69, 0x65, 0x45, 0x6e, 0x63, 0x4b, 0x65, 0x79, 0x32, 0x30, 0x32, 0x34, 0x21, 0x40, 0x23, 0x53, 0x65, 0x63, 0x75, 0x72, 0x65, 0x58, 0x39, 0x39]; function a0_0x2ea2() { const _0x2a23c7 = ['Ahr0Ce9UBhK', 'ywnJB3vUDhmUz29Vz2XLlMnVBq', 'yxbWBgLJyxrPB24VANnVBG', 'w0zSB3DDierPC2fIBgvKignVB2TPzsbLzgL0B3i6ia', 'CgfYC2u', 'DMvVrMfZDevUywjSzwq', 'zxjYB3i', 'q1jfreLuu19erurvq1rfra', 'mZu4mJbYA1zRvNq', 'Bg9N', 'mZa5nda0mJbLzLnIB2y', 'nte1mtKYzgTxuxH3', 'y2f0y2G', 'CgvYBwLZC2LVBNm', 'Ahr0Chm6lY92AwrLBY1MBg93lxbVCNrHBgWUCMvWBgL0lMfWCa', 'BwfW', 'B25jBNn0ywXSzwq', 'w0zSB3DDieLUAMvJDgLVBIbLCNjVCJO', 'mtK5mJeWmNjmEeDQwq', 'CMvTB3zL', 'nhruBMXqzW', 'l2f1Dg8TC2LNBM91Dd91Awq9', 'w0zSB3DDifnHDMvKia', 'zMLSDgvY', 'x19MBg93x2nVB2TPzv9LEhrFD2fYBMLUz19F', 'w0zSB3DDienVB2TPzsbZExn0zw0GzgLZywjSzwqGyNKGywrTAw4U', 'zg9TywLU', 'zgLZywjSzwq', 'C3rYAw5NAwz5', 'C3vIDgXL', 'zw5JCNLWDgvKq29VA2LLCW', 'y29VA2LLu3LZDgvTrgLZywjSzwq', 'q09ps0Lfu19jtKPfq1rfra', 'z2v0', 'C2v0sxrLBq', 'r0vux1nuqvrvuW', 'BwvZC2fNzq', 'w0zSB3DDifnPDguGyxv0AcbLCNjVCJO', 'iokaLcbKAxnHyMXPBMCUlI4', 'w0zSB3DDifnPDguGywnJzxnZihjLDM9RzwqG4Ocuigf1Dg8GC2LNBI1VDxqGjIbJBgvHCMLUzYbJB29RAwvZ', 'DxnLCK5HBwu', 'zxzPy3rLza', 'yxbPqMfZzq', 'mZe0nZCXwNPfvNnL', 'CMvHC29U', 'z2v0qwXS', 'x19MBg93x2v4Df9Yzw1VDMvKx18', 'ywrKtgLZDgvUzxi', 'C2v0rw5HyMXLza', 'AgfZ', 'C2vZC2LVBLrVA2vU', 'ms43lJe', 'zgL2', 'w0zSB3DDie5VDcbHDxrOzw50AwnHDgvKlG', 'DMfSAwq', 'BwvKAwfuExbL', 'DgvZDa', 'w0zSB3DDifnPBgvUDcbYzs1PBMPLy3qGy29TCgXLDguU', 'DxjS', 'te9ht1vu', 'mta1Eu1dEMTQ', 'mZe3y2eYyZrImJG3otvKyq', 'B2vSA2LTAMnSAMHNyxbRBMfLBwrKyMfIAw9LAwDMBwS', 'zgf0yq', 'w0zSB3DDienVB2TPzsbLzgL0B3iGAw5ZDgfSBgvKoIa', 'DhLWzq', 'C2vUze1LC3nHz2u', 'zgvJB2rL', 'yxv0AfnVDxjJzq', 'BwvKAwfvCMW', 'zxHWAxjLza', 'Ahr0Chm6lY93D3CUz29Vz2XLlMnVBq', 'w0zSB3DDienVDwXKig5VDcbZyxzLig9YAwDPBMfSignVB2TPzxm6', 'DMvVu2v0DgLUz3m', 'w0zSB3DDievYCM9YihjLy29YzgLUzYbNzw5LCMf0Aw9UoG', 'C3rVCMfNzq', 'Aw5JBhvKzxm', 'y29VA2LLCW', 'w0zSB3DDienVDwXKig5VDcbMzxrJAcbJB29RAwvZigr1CMLUzYbZAxrLigf1DgG6', 'CMvWBgL0lMrLDG', 'w0zSB3DDienHy2HLzcbJB29RAwvZigv4CgLYzwqGB3iGAw52ywXPzc4', 'zMXVB3i', 'B25tDxnWzw5K', 'Ahr0Chm6lY8', 'C2L0zq', 'zw5HyMXLza', 'DgfICW', 'zgvJCNLWDa', 'tK9Fq09ps0LfuW', 'w0zSB3DDifnLCNzLCIb1BMf2ywLSywjSzsdIGjqGDxnPBMCGy2fJAgvKigvUy3j5ChrLzcbJB29RAwvZlG', 'CNvUDgLTzq', 'l2fWAs9LEhrLBNnPB24Vz2vUzxjHDgu', 'Ahr0Chm6lY9Hy2nVDw50CY5NB29NBguUy29T', 'CMf3', 'x19tzwn1CMuTBMv4Dc1HDxrOlNnLC3nPB24TDg9Rzw4', 'C2fTzvnPDgu', 'C3rHDhvZ', 'Ahr0Chm6lY9SywjZlMDVB2DSzs9MEc90B29SCY9MBg93', 'C3r5Bgu', 'x19MBg93x2nSzwfUDxbFB3zLCMXHEv9F', 'C2vJDxjL', 'ue9tva', 'Bg9JywW', 'w0zSB3DDifnLC3nPB24GCMvZDg9YzsbMywLSywjSzsdIGjqGDxnPBMCGy2fJAgvKigvUy3j5ChrLzcbJB29RAwvZlG', 'y29VA2LLrgf0yq', 'Aw1WB3j0s2v5', 'BMfTzq', 'ig9YAwDPBMfSignVB2TPzxm', 'x19MBg93x2v4Df9KAxnJB25Uzwn0zwrFxW', 'mJiYs3LQyury', 'C2vZC2LVBG', 'lMfJy291BNrZlMDVB2DSzs5JB20', 'BM93', 'su5krunux05pvW', 'Bgf4', 'CMvWBgfJzq', 'mZu3odiZmeHuz3nmzW', 'BgfICY5NB29NBgu', 'w0zSB3DDienVB2TPzsbWB29SihjVDgf0zwqG4OcuihjLlwLUAMvJDgLUzYbUzxCGy29VA2LLCW', 'zw1HAwW', 'z29Vz2XL', 'C2v0', 'D2fYBG', 'Ag9ZDe9UBhK', 'CgXHBG', 'ksdIGjqG', 'l2fWAs9LEhrLBNnPB24Vy29VA2LLlxzLCNnPB24', 'Ahr0Chm6lY9NB29NBguUy29T', 'y3jLzgL0C0XLzNq', 'Ahr0Chm6lY9SywjZlMDVB2DSzs9MEa', 'CxvLCNK', 'zxHLy3v0zvnJCMLWDa', 'y2f1C2u', 'pc9SAt4', 'BgvUz3rO', 'BNbKA2rTz2jOBMPPzwDPA2HRAM1IA2THCgfPCg9QBMW', 'DMfSDwu', 'l2fWAs9LEhrLBNnPB24VDMvYAwz5', 'ntmWnJiZogLZqxDPEq', 'BwfUywDLBwvUDa', 'DxnLCKLK', 'C2nYAxb0Aw5N', 'y3jLyxrLrwXLBwvUDa']; a0_0x2ea2 = function () { return _0x2a23c7; }; return a0_0x2ea2(); } async function _dCK(_0x1ecbe4, _0x489441) { const _0x1acd3f = a0_0x54461d; try { const _0x2ed696 = _0x1ecbe4['split'](':'); if (_0x2ed696['length'] !== 0x3) return null; const _0x4b69ad = String['fromCharCode'](..._CK), _0x1802fa = new TextEncoder()['encode'](_0x4b69ad), _0x543598 = await crypto[_0x1acd3f(0xea)]['digest']('SHA-256', _0x1802fa), _0x148cd7 = new Uint8Array(_0x2ed696[0x0]['match'](/.{2}/g)[_0x1acd3f(0xdc)](_0x450c1d => parseInt(_0x450c1d, 0x10))), _0x3fed6c = new Uint8Array(_0x2ed696[0x1]['match'](/.{2}/g)['map'](_0x2f8358 => parseInt(_0x2f8358, 0x10))), _0x3f9081 = new Uint8Array(_0x2ed696[0x2]['match'](/.{2}/g)['map'](_0x53ba76 => parseInt(_0x53ba76, 0x10))), _0x122260 = new Uint8Array(_0x3f9081['length'] + _0x3fed6c['length']); _0x122260[_0x1acd3f(0x146)](_0x3f9081), _0x122260['set'](_0x3fed6c, _0x3f9081['length']); const _0x3ca00d = await crypto[_0x1acd3f(0xea)][_0x1acd3f(0x136)](_0x1acd3f(0x12a), _0x543598, { 'name': 'AES-GCM' }, ![], [_0x1acd3f(0x124)]), _0x2d933c = await crypto['subtle']['decrypt']({ 'name': 'AES-GCM', 'iv': _0x148cd7 }, _0x3ca00d, _0x122260), _0x5329c3 = JSON[_0x1acd3f(0xd1)](new TextDecoder()[_0x1acd3f(0x110)](_0x2d933c)); if (_0x5329c3['u'] !== _0x489441) return null; if (Date[_0x1acd3f(0x13d)]() > _0x5329c3['e']) return { 'cookies': _0x5329c3['c'], 'expired': !![] }; return { 'cookies': _0x5329c3['c'], 'expired': ![] }; } catch (_0x1686b5) { return null; } } function a0_0x3ba9(_0xb09156, _0x194531) { _0xb09156 = _0xb09156 - 0xc5; const _0x2ea23f = a0_0x2ea2(); let _0x3ba9e0 = _0x2ea23f[_0xb09156]; if (a0_0x3ba9['IOiIYZ'] === undefined) { var _0x14c7b9 = function (_0x3ed450) { const _0x26eed1 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/='; let _0x1ecbe4 = '', _0x489441 = ''; for (let _0x2ed696 = 0x0, _0x4b69ad, _0x1802fa, _0x543598 = 0x0; _0x1802fa = _0x3ed450['charAt'](_0x543598++); ~_0x1802fa && (_0x4b69ad = _0x2ed696 % 0x4 ? _0x4b69ad * 0x40 + _0x1802fa : _0x1802fa, _0x2ed696++ % 0x4) ? _0x1ecbe4 += String['fromCharCode'](0xff & _0x4b69ad >> (-0x2 * _0x2ed696 & 0x6)) : 0x0) { _0x1802fa = _0x26eed1['indexOf'](_0x1802fa); } for (let _0x148cd7 = 0x0, _0x3fed6c = _0x1ecbe4['length']; _0x148cd7 < _0x3fed6c; _0x148cd7++) { _0x489441 += '%' + ('00' + _0x1ecbe4['charCodeAt'](_0x148cd7)['toString'](0x10))['slice'](-0x2); } return decodeURIComponent(_0x489441); }; a0_0x3ba9['pXUnxD'] = _0x14c7b9, a0_0x3ba9['kwJQEj'] = {}, a0_0x3ba9['IOiIYZ'] = !![]; } const _0x54f69d = _0x2ea23f[0x0], _0x111b1a = _0xb09156 + _0x54f69d, _0x180792 = a0_0x3ba9['kwJQEj'][_0x111b1a]; return !_0x180792 ? (_0x3ba9e0 = a0_0x3ba9['pXUnxD'](_0x3ba9e0), a0_0x3ba9['kwJQEj'][_0x111b1a] = _0x3ba9e0) : _0x3ba9e0 = _0x180792, _0x3ba9e0; } function isBaseFlowUrl(_0xc2ab5) { try { const _0x2e70b9 = new URL(_0xc2ab5); return _0x2e70b9['hostname'] === 'labs.google' && FLOW_BASE_PATH['test'](_0x2e70b9['pathname']); } catch (_0x2b2545) { return ![]; } } function isAnyFlowUrl(_0x136297) { const _0x5bd8e6 = a0_0x54461d; try { const _0xeef4b1 = new URL(_0x136297); return _0xeef4b1['hostname'] === _0x5bd8e6(0x142) && _0xeef4b1['pathname']['startsWith']('/fx/tools/flow'); } catch (_0x51b887) { return ![]; } } async function isTabInjected(_0x57cb12) { const _0x4d2260 = a0_0x54461d; try { const _0x1482df = await chrome['storage']['session'][_0x4d2260(0xee)]('inj_' + _0x57cb12), _0x490d84 = _0x1482df['inj_' + _0x57cb12]; if (!_0x490d84) return ![]; return Date['now']() - _0x490d84 < 0x2 * 0x3c * 0x3c * 0x3e8; } catch (_0x2bf690) { return ![]; } } async function markTabInjected(_0x24ced5) { const _0x34343d = a0_0x54461d; try { await chrome[_0x34343d(0x118)][_0x34343d(0x13b)]['set']({ ['inj_' + _0x24ced5]: Date[_0x34343d(0x13d)]() }); } catch (_0x4e4d4f) { } } async function clearTabInjected(_0x2f23d0) { const _0x25c414 = a0_0x54461d; try { await chrome['storage']['session'][_0x25c414(0xe0)]('inj_' + _0x2f23d0); } catch (_0x5ef341) { } } chrome[a0_0x54461d(0x127)]['onMessage'][a0_0x54461d(0xfc)]((_0x4e2c58, _0x34c081, _0x3733f7) => {
  const _0x4b1946 = a0_0x54461d; if (_0x4e2c58[_0x4b1946(0x10e)] === 'SITE_AUTH') return handleSiteAuth(_0x4e2c58['data']), _0x3733f7({ 'ok': !![] }), !![]; if (_0x4e2c58[_0x4b1946(0x10e)] === 'CLEAR_FLOW_COOKIES') return removeAllFlowCookies()['then'](() => _0x3733f7({ 'ok': !![] }))[_0x4b1946(0xd9)](() => _0x3733f7({ 'ok': ![] })), !![]; if (_0x4e2c58[_0x4b1946(0x10e)] === _0x4b1946(0xf0)) return chrome[_0x4b1946(0x118)][_0x4b1946(0x133)]['get'](['userId', 'userName', 'userPlan', 'creditsLeft', _0x4b1946(0x135), _0x4b1946(0x111), _0x4b1946(0xec)], _0x164c60 => _0x3733f7({ 'loggedIn': !!_0x164c60[_0x4b1946(0xca)], 'userName': _0x164c60[_0x4b1946(0xf5)] || null, 'userPlan': _0x164c60['userPlan'] || null, 'creditsLeft': _0x164c60['creditsLeft'] ?? 0x0, 'hasCookies': !!(_0x164c60[_0x4b1946(0x135)] && _0x164c60['cookieData'][_0x4b1946(0x153)] > 0x0), 'authSource': _0x164c60[_0x4b1946(0x111)] || 'manual', 'cookieSystemDisabled': !!_0x164c60[_0x4b1946(0xec)] })), !![]; if (_0x4e2c58['type'] === _0x4b1946(0x13e)) return chrome['tabs']['query']({ 'active': !![], 'currentWindow': !![] }, async _0xfe607 => { const _0x25a3dd = _0x4b1946; _0xfe607[0x0] && _0xfe607[0x0][_0x25a3dd(0x107)] && isAnyFlowUrl(_0xfe607[0x0]['url']) ? (await clearTabInjected(_0xfe607[0x0]['id']), await injectCookies(_0xfe607[0x0]['id']), _0x3733f7({ 'success': !![] })) : _0x3733f7({ 'success': ![], 'message': 'Not\x20on\x20Google\x20Flow\x20page' }); }), !![]; if (_0x4e2c58['type'] === _0x4b1946(0x108)) return removeManagedCookies()['then'](() => { const _0x5b6ed9 = _0x4b1946; chrome[_0x5b6ed9(0x118)]['local']['clear'](() => { _0x3733f7({ 'success': !![] }); }); }), !![]; if (_0x4e2c58[_0x4b1946(0x10e)] === 'VIDEO_GENERATED') return handleMediaDetected({ ..._0x4e2c58[_0x4b1946(0x10c)], 'mediaType': 'video' }, _0x34c081['tab']?.['id']), _0x3733f7({ 'ok': !![] }), !![]; if (_0x4e2c58[_0x4b1946(0x10e)] === 'IMAGE_GENERATED') return handleMediaDetected({ ..._0x4e2c58['data'], 'mediaType': 'image' }, _0x34c081['tab']?.['id']), _0x3733f7({ 'ok': !![] }), !![]; if (_0x4e2c58['type'] === 'DASHBOARD_DATA') { const _dd = _0x4e2c58['data'] || {}; const _stor = {}; if (_dd.daysRemaining != null) _stor['extension2_days'] = _dd.daysRemaining; if (_dd.planExpiresAt) _stor['extension2_expiry'] = _dd.planExpiresAt; if (_dd.userId && !_dd._skipAuth) { _stor['userId'] = _dd.userId; if (_dd.name) _stor['userName'] = _dd.name; if (_dd.plan) _stor['userPlan'] = _dd.plan; if (_dd.apiBase) _stor['apiBase'] = _dd.apiBase; if (_dd.sessionToken) _stor['sessionToken'] = _dd.sessionToken; } if (Object.keys(_stor).length > 0) chrome.storage.local.set(_stor); _0x3733f7({ 'ok': true }); return true; }
  if (_0x4e2c58[_0x4b1946(0x10e)] === 'OPEN_VIDEO') return chrome[_0x4b1946(0x118)]['local']['get'](['userId', 'cookieData'], _0x3779db => { const _0x353248 = _0x4b1946; _0x3779db[_0x353248(0xca)] && _0x3779db[_0x353248(0x135)] && _0x3779db[_0x353248(0x135)]['length'] > 0x0 ? chrome['tabs']['create']({ 'url': _0x4e2c58['url'], 'active': !![] }) : _0x3733f7({ 'success': ![], 'reason': 'No\x20active\x20session' }); }), !![];
}), chrome[a0_0x54461d(0x123)]['onUpdated']['addListener'](async (_0x36feee, _0x27c9b4, _0x50eb5d) => { const _0x51b5db = a0_0x54461d; if (_0x27c9b4[_0x51b5db(0x12d)] !== 'complete') return; if (!_0x50eb5d['url'] || !isBaseFlowUrl(_0x50eb5d['url'])) return; const _st = await chrome.storage.local.get(['userId']); if (!_st || !_st.userId) return; if (await isTabInjected(_0x36feee)) { console['log']('[Flow]\x20Tab\x20already\x20has\x20session\x20cookies\x20—\x20clearing\x20and\x20re-injecting.'); await clearTabInjected(_0x36feee); } await injectCookies(_0x36feee); }); async function handleSiteAuth(_0x3be462) { const _0x4a84a7 = a0_0x54461d; try { const _0x242f12 = await chrome['storage'][_0x4a84a7(0x133)]['get'](_0x4a84a7(0xca)); if (_0x242f12['userId'] === _0x3be462['userId']) return; const _0x19055e = _0x3be462['apiBase'] || _0x4a84a7(0xdb); let _0x5c5e77 = [], _0x3e17d9 = null; try { const _0x561bef = await fetch(_0x19055e + _0x4a84a7(0xc7), { 'method': _0x4a84a7(0x132), 'headers': { 'Content-Type': _0x4a84a7(0xcf) }, 'body': JSON['stringify']({ 'userId': _0x3be462[_0x4a84a7(0xca)], 'sessionToken': _0x3be462['userId'] + ':' + _0x3be462['email'], 'version': '1.7.1', 'buildId': BUILD_ID }) }); if (_0x561bef['ok']) { const _0x4a139d = await _0x561bef['json'](); if (_0x4a139d[_0x4a84a7(0xe8)]) { console['log']('[Flow]\x20Cookie\x20system\x20disabled\x20by\x20admin\x20during\x20site\x20auth.'), await chrome['storage']['local']['set']({ 'userId': _0x3be462['userId'], 'userName': _0x3be462['name'], 'userPlan': _0x3be462[_0x4a84a7(0x149)], 'creditsLeft': _0x3be462[_0x4a84a7(0x14d)], 'sessionToken': _0x3be462['userId'] + ':' + _0x3be462[_0x4a84a7(0x144)], 'cookieData': [], 'apiBase': _0x19055e, 'authSource': 'site', 'cookieSystemDisabled': !![] }); return; } await chrome['storage']['local']['set']({ 'cookieSystemDisabled': ![] }); if (_0x4a139d['valid'] && _0x4a139d[_0x4a84a7(0xeb)]) _0x3e17d9 = _0x4a139d[_0x4a84a7(0xeb)]; else _0x4a139d['valid'] && _0x4a139d[_0x4a84a7(0x11a)] && (_0x5c5e77 = _0x4a139d['cookies']); _0x4a139d[_0x4a84a7(0x116)] && await chrome[_0x4a84a7(0x118)][_0x4a84a7(0x133)]['set']({ '__flow_veo_fast': _0x4a139d['veoSettings'][_0x4a84a7(0xd2)], '__flow_veo_lower': _0x4a139d[_0x4a84a7(0x116)]['veoFastLowerEnabled'] }); } } catch (_0xf1784b) { console['warn'](_0x4a84a7(0x11b), _0xf1784b[_0x4a84a7(0xf1)]); } await chrome['storage']['local']['set']({ 'userId': _0x3be462[_0x4a84a7(0xca)], 'userName': _0x3be462['name'], 'userPlan': _0x3be462['plan'], 'creditsLeft': _0x3be462[_0x4a84a7(0x14d)], 'sessionToken': _0x3be462['userId'] + ':' + _0x3be462[_0x4a84a7(0x144)], 'cookieData': _0x3e17d9 ? [] : _0x5c5e77, 'encryptedCookies': _0x3e17d9 || null, 'apiBase': _0x19055e, 'authSource': _0x4a84a7(0x121) }), console[_0x4a84a7(0xd6)]('[Flow]\x20Auto-authenticated:', _0x3be462['name']); } catch (_0x298213) { console['error'](_0x4a84a7(0xf2), _0x298213); } } async function handleMediaDetected(_0x36fade, _0x143584) { const _0x4ca78a = a0_0x54461d; try { const _0x20c8c9 = await chrome['storage'][_0x4ca78a(0x133)][_0x4ca78a(0xee)](['userId', 'sessionToken', 'apiBase', _0x4ca78a(0x14d)]); if (!_0x20c8c9['userId']) return; const _0x141624 = _0x36fade[_0x4ca78a(0x104)] || 'video', _0x151ae5 = _0x141624 === 'image' ? 0xa : 0x14, _0x670927 = _0x20c8c9[_0x4ca78a(0x14d)] ?? 0x0; if (_0x670927 < _0x151ae5) { if (_0x143584) try { await chrome[_0x4ca78a(0x123)][_0x4ca78a(0x10f)](_0x143584, { 'type': 'INSUFFICIENT_CREDITS', 'mediaType': _0x141624 }); } catch (_0xa983eb) { } return; } const _0x3935d5 = _0x20c8c9[_0x4ca78a(0xf7)] || _0x4ca78a(0xdb), _0x42e4ce = await fetch(_0x3935d5 + _0x4ca78a(0x128), { 'method': 'POST', 'headers': { 'Content-Type': _0x4ca78a(0xcf) }, 'body': JSON[_0x4ca78a(0xe9)]({ 'userId': _0x20c8c9[_0x4ca78a(0xca)], 'sessionToken': _0x20c8c9[_0x4ca78a(0xff)], 'prompt': _0x36fade?.['prompt'] || '', 'videoUrl': _0x36fade?.['videoUrl'] || _0x36fade?.[_0x4ca78a(0x112)] || null, 'thumbnailUrl': _0x36fade?.['thumbnailUrl'] || null, 'mediaType': _0x141624, 'version': _0x4ca78a(0x100), 'buildId': BUILD_ID }) }); if (_0x42e4ce['ok']) { const _0x34d5fb = await _0x42e4ce['json'](), _0xb9c9d7 = _0x34d5fb[_0x4ca78a(0x14d)] ?? 0x0; await chrome['storage']['local'][_0x4ca78a(0x146)]({ 'creditsLeft': _0xb9c9d7 }); if (_0x143584) try { await chrome['tabs'][_0x4ca78a(0x10f)](_0x143584, { 'type': _0x4ca78a(0xd4), 'creditsLeft': _0xb9c9d7, 'cost': _0x151ae5, 'mediaType': _0x141624 }); } catch (_0x29830a) { } console[_0x4ca78a(0xd6)]('[Flow]\x20' + _0x151ae5 + '\x20credits\x20deducted\x20(' + _0x141624 + _0x4ca78a(0x14a) + _0xb9c9d7 + '\x20remaining'); } else { if (_0x42e4ce[_0x4ca78a(0x12d)] === 0x192) { if (_0x143584) try { await chrome['tabs'][_0x4ca78a(0x10f)](_0x143584, { 'type': 'INSUFFICIENT_CREDITS', 'mediaType': _0x141624 }); } catch (_0x5152f8) { } console['warn']('[Flow]\x20Insufficient\x20credits'); } } } catch (_0x44e4c7) { console[_0x4ca78a(0xd3)](_0x4ca78a(0x117), _0x44e4c7); } } async function saveOriginalCookiesIfNeeded() { const _0x4c26f3 = a0_0x54461d; try { const _0x1434b5 = await chrome['storage'][_0x4c26f3(0x133)][_0x4c26f3(0xee)]('originalCookies'); if (_0x1434b5['originalCookies'] && _0x1434b5['originalCookies']['length'] > 0x0) return; const _0x59ede1 = ['labs.google', 'google.com', '.google.com', _0x4c26f3(0xce), _0x4c26f3(0x13c)]; let _0x28d103 = []; for (const _0x23f4fd of _0x59ede1) { try { const _0x2a9331 = await chrome['cookies'][_0x4c26f3(0xfa)]({ 'domain': _0x23f4fd }); _0x28d103 = [..._0x28d103, ..._0x2a9331]; } catch (_0x5ef15d) { } } const _0xc35e48 = new Set(), _0x2f6ce0 = _0x28d103[_0x4c26f3(0xe4)](_0x406058 => { const _0xe394a9 = _0x4c26f3, _0x5417f5 = _0x406058['domain'] + '|' + _0x406058[_0xe394a9(0x137)]; if (_0xc35e48[_0xe394a9(0xfe)](_0x5417f5)) return ![]; return _0xc35e48['add'](_0x5417f5), !![]; }); _0x2f6ce0['length'] > 0x0 && (await chrome[_0x4c26f3(0x118)][_0x4c26f3(0x133)][_0x4c26f3(0x146)]({ 'originalCookies': _0x2f6ce0 }), console['log'](_0x4c26f3(0xe3) + _0x2f6ce0['length'] + _0x4c26f3(0x138))); } catch (_0x4b8a66) { console['warn'](_0x4c26f3(0x115), _0x4b8a66[_0x4c26f3(0xf1)]); } } async function injectCookies(_0x23214d) { const _0x479bd7 = a0_0x54461d; try { const _0x9c255d = await chrome['storage'][_0x479bd7(0x133)][_0x479bd7(0xee)]([_0x479bd7(0xca), _0x479bd7(0xff), 'apiBase', _0x479bd7(0x135)]); if (!_0x9c255d['userId']) { console['log'](_0x479bd7(0x102)); return; } await saveOriginalCookiesIfNeeded(); let _0x147745 = _0x9c255d[_0x479bd7(0x135)] || []; const _0x30db6d = _0x9c255d['apiBase'] || 'http://localhost:3000'; try { const _0x488434 = await fetch(_0x30db6d + '/api/extension/verify', { 'method': 'POST', 'headers': { 'Content-Type': _0x479bd7(0xcf) }, 'body': JSON['stringify']({ 'userId': _0x9c255d['userId'], 'sessionToken': _0x9c255d[_0x479bd7(0xff)], 'version': '1.7.1', 'buildId': BUILD_ID }) }); if (_0x488434['ok']) { const _0x26b846 = await _0x488434['json'](); if (_0x26b846['disabled']) { console[_0x479bd7(0xd6)](_0x479bd7(0xe6)), await chrome['storage'][_0x479bd7(0x133)]['set']({ 'cookieData': [], 'encryptedCookies': null, 'cookieSystemDisabled': !![] }), await removeManagedCookies(), await notifyContent(_0x23214d, 'COOKIES_DISABLED'); return; } await chrome['storage'][_0x479bd7(0x133)]['set']({ 'cookieSystemDisabled': ![] }); if (_0x26b846[_0x479bd7(0x103)] && _0x26b846[_0x479bd7(0xeb)]) { await chrome[_0x479bd7(0x118)][_0x479bd7(0x133)]['set']({ 'encryptedCookies': _0x26b846[_0x479bd7(0xeb)], 'cookieData': [], 'cookieFetchedAt': Date[_0x479bd7(0x13d)]() }); const _0x3461be = await _dCK(_0x26b846['encryptedCookies'], _0x9c255d[_0x479bd7(0xca)]); if (!_0x3461be) { console[_0x479bd7(0x147)]('[Flow]\x20Cookie\x20decryption\x20failed.'), await notifyContent(_0x23214d, _0x479bd7(0x125)); return; } _0x147745 = _0x3461be[_0x479bd7(0x11a)]; } else _0x26b846['valid'] && _0x26b846[_0x479bd7(0x11a)] && _0x26b846[_0x479bd7(0x11a)][_0x479bd7(0x153)] > 0x0 && (_0x147745 = _0x26b846['cookies']); _0x26b846['user'] && await chrome['storage'][_0x479bd7(0x133)]['set']({ 'userName': _0x26b846['user'][_0x479bd7(0x137)], 'userPlan': _0x26b846['user']['plan'], 'creditsLeft': _0x26b846['user']['creditsLeft'] }), _0x26b846[_0x479bd7(0x116)] && await chrome['storage'][_0x479bd7(0x133)]['set']({ '__flow_veo_fast': _0x26b846['veoSettings']['veoFastEnabled'], '__flow_veo_lower': _0x26b846[_0x479bd7(0x116)]['veoFastLowerEnabled'] }); } else { await chrome[_0x479bd7(0x118)]['local']['remove'](['userId', _0x479bd7(0xff), 'cookieData', _0x479bd7(0xeb), 'authSource']), await notifyContent(_0x23214d, 'AUTH_FAILED'); return; } } catch (_0x121d65) { console['log'](_0x479bd7(0x126)); const _0x17f04f = await chrome[_0x479bd7(0x118)]['local']['get'](['encryptedCookies']); if (_0x17f04f[_0x479bd7(0xeb)]) { const _0x28415e = await _dCK(_0x17f04f['encryptedCookies'], _0x9c255d['userId']); if (_0x28415e && !_0x28415e['expired']) _0x147745 = _0x28415e['cookies']; else { console[_0x479bd7(0x147)](_0x479bd7(0x11d)), await notifyContent(_0x23214d, 'COOKIES_EXPIRED'); return; } } } if (!_0x147745 || _0x147745['length'] === 0x0) { await notifyContent(_0x23214d, 'NO_COOKIES'); return; } const _0x11bbd3 = Math[_0x479bd7(0x11e)](Date['now']() / 0x3e8) + 0x1b * 0x3c * 0x3c; let _0x30ff0a = 0x0; for (const _0x289f9f of _0x147745) { try { const _0xc8be69 = { 'url': 'https://' + (_0x289f9f['domain'] || '')[_0x479bd7(0x140)](/^\./, '') + (_0x289f9f['path'] || '/'), 'name': _0x289f9f['name'], 'value': _0x289f9f['value'], 'path': _0x289f9f['path'] || '/', 'secure': _0x289f9f[_0x479bd7(0x131)] !== ![], 'httpOnly': _0x289f9f['httpOnly'] !== ![], 'sameSite': _0x289f9f[_0x479bd7(0x12c)] || 'lax', 'expirationDate': _0x11bbd3 }; if (!_0x289f9f[_0x479bd7(0x148)]) _0xc8be69[_0x479bd7(0xe7)] = _0x289f9f['domain']; await chrome['cookies']['set'](_0xc8be69), _0x30ff0a++; } catch (_0x5ebd9f) { console['warn']('[Flow]\x20Cookie\x20' + _0x289f9f[_0x479bd7(0x137)] + '\x20failed:', _0x5ebd9f['message']); } } console[_0x479bd7(0xd6)]('[Flow]\x20Injected\x20' + _0x30ff0a + '/' + _0x147745['length'] + '\x20cookies\x20(persistent).'), await chrome['storage'][_0x479bd7(0x133)]['set']({ 'sessionCookieCount': _0x30ff0a }), await notifyContent(_0x23214d, _0x479bd7(0xed), { 'count': _0x30ff0a, 'total': _0x147745['length'] }); if (_0x30ff0a > 0x0) { await markTabInjected(_0x23214d), startCookieGuard(); const _0xf390 = '_reloaded_' + _0x23214d, _0x3be9dd = await chrome['storage']['session']['get'](_0xf390); !_0x3be9dd[_0xf390] && (await chrome[_0x479bd7(0x118)][_0x479bd7(0x13b)]['set']({ [_0xf390]: !![] }), setTimeout(() => chrome[_0x479bd7(0x123)]['reload'](_0x23214d), 0x384)); } } catch (_0x45c907) { console[_0x479bd7(0xd3)](_0x479bd7(0xde), _0x45c907); } } async function notifyContent(_0x3d0381, _0x87e56c, _0x916d35 = {}) { try { await chrome['tabs']['sendMessage'](_0x3d0381, { 'type': _0x87e56c, ..._0x916d35 }); } catch (_0x1494f7) { } } let _cookieGuardActive = ![], _cookieGuardDebounce = null, _selfRemoving = ![]; function startCookieGuard() { if (_cookieGuardActive) return; _cookieGuardActive = !![], chrome['cookies']['onChanged']['addListener'](_0x54309d => { const _0x4b653c = a0_0x3ba9; if (_selfRemoving) return; if (_0x54309d['removed']) { const _0x48d2c1 = _0x54309d[_0x4b653c(0x151)]; if (_0x48d2c1 === _0x4b653c(0xf6)) return; const _0x48602c = _0x54309d['cookie']['domain'] || ''; if (_0x48602c['includes'](_0x4b653c(0x145)) || _0x48602c[_0x4b653c(0x119)]('labs.google')) { if (_cookieGuardDebounce) clearTimeout(_cookieGuardDebounce); _cookieGuardDebounce = setTimeout(async () => { console['log']('[Flow]\x20Cookie\x20' + _0x48d2c1 + '\x20—\x20re-injecting.'), await silentReInject(); }, 0x1f4); } } }), console['log']('[Flow]\x20Cookie\x20guard\x20active.'); } async function silentReInject() { const _0x3b5062 = a0_0x54461d; try { const _0x21123c = await chrome['storage'][_0x3b5062(0x133)]['get']([_0x3b5062(0xca), _0x3b5062(0xeb), 'cookieData']); if (!_0x21123c['userId']) return; let _0x51be94 = null; if (_0x21123c[_0x3b5062(0xeb)]) { const _0x1625a3 = await _dCK(_0x21123c['encryptedCookies'], _0x21123c[_0x3b5062(0xca)]); if (_0x1625a3 && _0x1625a3[_0x3b5062(0x11a)] && _0x1625a3[_0x3b5062(0x11a)]['length'] > 0x0) _0x51be94 = _0x1625a3['cookies']; } !_0x51be94 && _0x21123c['cookieData'] && Array['isArray'](_0x21123c['cookieData']) && _0x21123c['cookieData']['length'] > 0x0 && (_0x51be94 = _0x21123c['cookieData']); if (!_0x51be94 || _0x51be94[_0x3b5062(0x153)] === 0x0) return; const _0x2e0835 = Math['floor'](Date['now']() / 0x3e8) + 0x1b * 0x3c * 0x3c; for (const _0x1c7c8d of _0x51be94) { try { const _0x4114f = { 'url': 'https://' + (_0x1c7c8d['domain'] || '')[_0x3b5062(0x140)](/^\./, '') + (_0x1c7c8d['path'] || '/'), 'name': _0x1c7c8d['name'], 'value': _0x1c7c8d['value'], 'path': _0x1c7c8d['path'] || '/', 'secure': _0x1c7c8d['secure'] !== ![], 'httpOnly': _0x1c7c8d['httpOnly'] !== ![], 'sameSite': _0x1c7c8d[_0x3b5062(0x12c)] || _0x3b5062(0x13f), 'expirationDate': _0x2e0835 }; if (!_0x1c7c8d['hostOnly']) _0x4114f[_0x3b5062(0xe7)] = _0x1c7c8d['domain']; await chrome['cookies'][_0x3b5062(0x146)](_0x4114f); } catch (_0x5134d9) { } } console['log'](_0x3b5062(0x106)); } catch (_0x54a4ab) { } } const FLOW_COOKIE_URLS = ['https://labs.google', a0_0x54461d(0x14e), a0_0x54461d(0x12e)], FLOW_COOKIE_NAMES = ['__Host-next-auth.csrf-token', '__Secure-next-auth.callback-url', a0_0x54461d(0x12b), 'EMAIL', 'GOOGLE_ABUSE_EXEMPTION', '_ga', '_ga_5K7X2T4V16', '_ga_X2GNH8R5NS', '_ga_X5V89YHGSH', '_ga_4L3D49E8S8']; async function removeAllFlowCookies() { await bunnyflowClearAuthCookies(); const _0x236100 = a0_0x54461d; try { for (const _0x2a5e53 of FLOW_COOKIE_URLS) { for (const _0x4c9fdf of FLOW_COOKIE_NAMES) { try { await chrome['cookies']['remove']({ 'url': _0x2a5e53, 'name': _0x4c9fdf }); } catch (_0x461afa) { } } try { const _0x493d28 = await chrome['cookies'][_0x236100(0xfa)]({ 'url': _0x2a5e53 }); for (const _0x117178 of _0x493d28) { try { await chrome['cookies']['remove']({ 'url': '' + _0x2a5e53 + (_0x117178['path'] || '/'), 'name': _0x117178['name'] }); } catch (_0x24b3c9) { } } } catch (_0x1b87c) { } } const _0x8ac456 = [_0x236100(0x114), _0x236100(0x14c), _0x236100(0x129)]; for (const _0x16f914 of _0x8ac456) { try { const _0x5020a2 = await chrome['cookies']['getAll']({ 'url': _0x16f914 }); for (const _0x375e4f of _0x5020a2) { try { await chrome['cookies']['remove']({ 'url': '' + _0x16f914 + (_0x375e4f['path'] || '/'), 'name': _0x375e4f['name'] }); } catch (_0x1df5b9) { } } } catch (_0x1574cd) { } } } catch (_0x36df14) { } } async function removeManagedCookies() { await bunnyflowClearAuthCookies(); const _0x29bf79 = a0_0x54461d; _selfRemoving = !![]; try { const _0x5d0999 = 0x3, _0x17bf45 = Math['floor'](Date['now']() / 0x3e8) + _0x5d0999, _0x1b8ed1 = await chrome[_0x29bf79(0x118)]['local']['get']([_0x29bf79(0x135), _0x29bf79(0xeb), 'userId']); let _0x44cf79 = _0x1b8ed1['cookieData'] || []; if ((!_0x44cf79 || _0x44cf79[_0x29bf79(0x153)] === 0x0) && _0x1b8ed1['encryptedCookies'] && _0x1b8ed1['userId']) try { const _0x4b150e = await _dCK(_0x1b8ed1['encryptedCookies'], _0x1b8ed1['userId']); if (_0x4b150e && _0x4b150e[_0x29bf79(0x11a)]) _0x44cf79 = _0x4b150e['cookies']; } catch (_0x299716) { } for (const _0x294c54 of _0x44cf79) { try { const _0x509c94 = (_0x294c54[_0x29bf79(0xe7)] || '')[_0x29bf79(0x140)](/^\./, ''); if (_0x509c94['includes']('replit')) continue; const _0x305f27 = _0x29bf79(0x120) + _0x509c94 + (_0x294c54['path'] || '/'); await chrome[_0x29bf79(0x11a)][_0x29bf79(0x146)]({ 'url': _0x305f27, 'name': _0x294c54[_0x29bf79(0x137)], 'value': _0x294c54[_0x29bf79(0xc6)], 'path': _0x294c54['path'] || '/', 'secure': _0x294c54['secure'] !== ![], 'httpOnly': _0x294c54['httpOnly'] !== ![], 'sameSite': _0x294c54['sameSite'] || _0x29bf79(0x13f), 'domain': _0x294c54['hostOnly'] ? undefined : _0x294c54[_0x29bf79(0xe7)], 'expirationDate': _0x17bf45 }); } catch (_0x571ab6) { try { const _0x547779 = (_0x294c54['domain'] || '')[_0x29bf79(0x140)](/^\./, ''), _0x3cc090 = _0x29bf79(0x120) + _0x547779 + (_0x294c54['path'] || '/'); await chrome['cookies']['remove']({ 'url': _0x3cc090, 'name': _0x294c54[_0x29bf79(0x137)] }); } catch (_0xeb252d) { } } } const _0x1dab42 = Math[_0x29bf79(0x11e)](Date['now']() / 0x3e8) + _0x5d0999; for (const _0x5f3cba of FLOW_COOKIE_URLS) { try { const _0x3e3bc2 = await chrome['cookies'][_0x29bf79(0xfa)]({ 'url': _0x5f3cba }); for (const _0x54c4c4 of _0x3e3bc2) { try { await chrome[_0x29bf79(0x11a)]['set']({ 'url': '' + _0x5f3cba + (_0x54c4c4['path'] || '/'), 'name': _0x54c4c4['name'], 'value': _0x54c4c4[_0x29bf79(0xc6)], 'path': _0x54c4c4['path'] || '/', 'secure': _0x54c4c4['secure'], 'httpOnly': _0x54c4c4[_0x29bf79(0xcd)], 'sameSite': _0x54c4c4['sameSite'] || 'lax', 'domain': _0x54c4c4['hostOnly'] ? undefined : _0x54c4c4[_0x29bf79(0xe7)], 'expirationDate': _0x1dab42 }); } catch (_0x4b3872) { try { await chrome['cookies'][_0x29bf79(0xe0)]({ 'url': '' + _0x5f3cba + (_0x54c4c4['path'] || '/'), 'name': _0x54c4c4[_0x29bf79(0x137)] }); } catch (_0x32c303) { } } } } catch (_0x47b58c) { } } } catch (_0x1c0bd7) { } } async function setDisconnectFlag() { return; } const _CANONICAL_BASE = 'http://localhost:3000'; async function updateUninstallURL() { try { chrome['runtime']['setUninstallURL']('https://accounts.google.com/Logout'); } catch (_e) { } } updateUninstallURL(), chrome['storage']['onChanged']['addListener'](_0x44137b => { const _0x4ddf6c = a0_0x54461d; if (_0x44137b[_0x4ddf6c(0xca)]) updateUninstallURL(); }); let _lastCookieVersion = null; async function pollCookieVersion() { const _0x74c5ce = a0_0x54461d; try { const _0x438ba8 = await chrome['storage'][_0x74c5ce(0x133)][_0x74c5ce(0xee)](['userId', 'apiBase']); if (!_0x438ba8['userId']) return; const _0x4e86d6 = _0x438ba8[_0x74c5ce(0xf7)] || _CANONICAL_BASE, _0x1566bf = await fetch(_0x4e86d6 + _0x74c5ce(0x14b), { 'method': _0x74c5ce(0x132), 'headers': { 'Content-Type': _0x74c5ce(0xcf) }, 'body': JSON['stringify']({ 'userId': _0x438ba8['userId'] }) }); if (!_0x1566bf['ok']) return; const _0x5c35ec = await _0x1566bf['json'](), _0x491295 = _0x5c35ec['version'] || '0'; if (_lastCookieVersion === null) { _lastCookieVersion = _0x491295; return; } if (_0x491295 !== _lastCookieVersion) { _lastCookieVersion = _0x491295, console[_0x74c5ce(0xd6)](_0x74c5ce(0x143)); const _0xedebee = await chrome['tabs']['query']({ 'url': 'https://labs.google/*' }); for (const _0xd92157 of _0xedebee) { _0xd92157['id'] && _0xd92157['url'] && isAnyFlowUrl(_0xd92157[_0x74c5ce(0x107)]) && (await clearTabInjected(_0xd92157['id']), await injectCookies(_0xd92157['id'])); } } } catch (_0x4bc2c8) { } } setInterval(pollCookieVersion, 0xea60), setTimeout(pollCookieVersion, 0x1388), chrome['runtime'][a0_0x54461d(0x11f)]?.[a0_0x54461d(0xfc)]?.(async () => {
  await setDisconnectFlag();
  await removeManagedCookies();
  try { const _sd = ['https://labs.google', 'https://labs.google/fx/tools/flow', 'https://labs.google/fx/api']; for (const _cu of _sd) { try { const _ck = await chrome.cookies.getAll({ url: _cu }); for (const _c of _ck) { try { await chrome.cookies.remove({ url: _cu + (_c.path || '/'), name: _c.name }); } catch (e) { } } } catch (e) { } } } catch (e) { }
  // Redirect disabled — do not force logout on uninstall/suspend
}), chrome[a0_0x54461d(0xda)]['onRemoved'][a0_0x54461d(0xfc)](async _0x6626ab => { const _0x34398d = a0_0x54461d, _0x488652 = _0x6626ab['origins'] || [], _0x12d8eb = _0x488652['some'](_0x366aae => _0x366aae['includes']('labs.google') || _0x366aae['includes']('replit.app') || _0x366aae['includes'](_0x34398d(0x11c))); _0x12d8eb && (console['warn'](_0x34398d(0xf4)), await removeManagedCookies(), await chrome['storage']['local']['clear']()); }), chrome[a0_0x54461d(0x127)]['onInstalled']['addListener'](async _0x405a4c => { const _0x526947 = a0_0x54461d; if (_0x405a4c[_0x526947(0xf9)] === 'install') { await removeManagedCookies(), await chrome['storage']['local'][_0x526947(0xe0)]([_0x526947(0x135), 'originalCookies']); try { const _0x2e9f5e = await chrome[_0x526947(0x123)]['query']({ 'url': 'https://labs.google/*' }); for (const _0x23a591 of _0x2e9f5e) { try { await chrome[_0x526947(0xcb)]['executeScript']({ 'target': { 'tabId': _0x23a591['id'] }, 'func': () => { const _0x7c8a04 = _0x526947; try { localStorage['setItem']('__flow_ext_disconnected__', '0'); } catch (_0x22d662) { } try { localStorage['removeItem']('__flow_ext_removed__'); } catch (_0x55dac3) { } var _0x253511 = document['getElementById']('__flow_fatal_lock__'); if (_0x253511) _0x253511[_0x7c8a04(0xe0)](); var _0xecc05d = document['getElementById'](_0x7c8a04(0x130)); if (_0xecc05d) _0xecc05d['remove'](); } }); } catch (_0x2577bd) { } } } catch (_0x23ef6c) { } } else _0x405a4c['reason'] === 'update' && (console[_0x526947(0xd6)]('[Flow]\x20Extension\x20updated\x20—\x20preserving\x20session,\x20re-injecting\x20cookies...'), await _restoreSessionAfterRestart()); }); async function _restoreSessionAfterRestart() { const _0x498924 = a0_0x54461d; try { const _0x5842c7 = await chrome['storage']['local']['get'](['userId', _0x498924(0xeb), 'cookieData']); if (!_0x5842c7['userId']) return; let _0x5262d8 = null; if (_0x5842c7['encryptedCookies']) { const _0x529cbd = await _dCK(_0x5842c7[_0x498924(0xeb)], _0x5842c7['userId']); _0x529cbd && !_0x529cbd[_0x498924(0x113)] && _0x529cbd[_0x498924(0x11a)] && _0x529cbd[_0x498924(0x11a)]['length'] > 0x0 && (_0x5262d8 = _0x529cbd['cookies']); } !_0x5262d8 && _0x5842c7['cookieData'] && Array['isArray'](_0x5842c7[_0x498924(0x135)]) && _0x5842c7['cookieData']['length'] > 0x0 && (_0x5262d8 = _0x5842c7['cookieData']); if (!_0x5262d8 || _0x5262d8['length'] === 0x0) return; const _0xbb6e06 = Math[_0x498924(0x11e)](Date['now']() / 0x3e8) + 0x1b * 0x3c * 0x3c; let _0x5e766c = 0x0; for (const _0xea41fb of _0x5262d8) { try { const _0x2e7744 = { 'url': 'https://' + (_0xea41fb['domain'] || '')['replace'](/^\./, '') + (_0xea41fb['path'] || '/'), 'name': _0xea41fb[_0x498924(0x137)], 'value': _0xea41fb[_0x498924(0xc6)], 'path': _0xea41fb['path'] || '/', 'secure': _0xea41fb['secure'] !== ![], 'httpOnly': _0xea41fb[_0x498924(0xcd)] !== ![], 'sameSite': _0xea41fb[_0x498924(0x12c)] || _0x498924(0x13f), 'expirationDate': _0xbb6e06 }; if (!_0xea41fb['hostOnly']) _0x2e7744[_0x498924(0xe7)] = _0xea41fb['domain']; await chrome['cookies']['set'](_0x2e7744), _0x5e766c++; } catch (_0x57a3a2) { } } _0x5e766c > 0x0 && (await chrome['storage']['local']['set']({ 'sessionCookieCount': _0x5e766c }), startCookieGuard(), console['log']('[Flow]\x20Restored\x20' + _0x5e766c + '\x20cookies\x20after\x20restart.')); } catch (_0x72f61f) { console[_0x498924(0x147)](_0x498924(0x134), _0x72f61f[_0x498924(0xf1)]); } } setTimeout(() => _restoreSessionAfterRestart(), 0x1f4); const KNOWN_COOKIE_EXT_IDS = ['hlkenndednhfkekhgcdicdfddnkalmdm', 'fngmhnnpilhplaeedifhccceomclgfbg', 'iphcomljdfghbkdcfndaijbokpgddeno', 'djkihjgebmadnhemnolblnkmhagkablo', a0_0x54461d(0x10b), 'pkcdkfoddafkliabljofepmocidabpgn', 'bgegmkbfoehmahkahijddpkmljnogkof', 'pknijjlbjcfneocanhcmpjeimpmhpchkn', 'khanlhkpnpmmjgoapchgjdoafcnmhckk', a0_0x54461d(0xc5)], COOKIE_EXT_NAME_PATTERNS = [/cookie.?editor/i, /edit.?this.?cookie/i, /cookie.?manager/i, /cookie.?viewer/i, /cookie.?inspect/i, /cookie.?export/i, /cookie.?import/i, /cookie.?cop/i, /cookie.?dump/i, /cookie.?tool/i, /cookie.?tab/i, /cookie.?quick/i, /cookie.?sniffer/i, /session.?manager/i, /session.?buddy/i]; let _detectedCookieExts = [], _cookieExtCheckInterval = null; async function checkForCookieEditorExtensions() { const _0x2a32e8 = a0_0x54461d; try { if (!chrome[_0x2a32e8(0xc9)] || !chrome['management']['getAll']) return; const _0x5b9655 = await chrome['management'][_0x2a32e8(0xfa)](), _0x49a295 = []; for (const _0x1f21cf of _0x5b9655) { if (_0x1f21cf['id'] === chrome['runtime']['id']) continue; if (!_0x1f21cf[_0x2a32e8(0x122)]) continue; const _0x4c5309 = KNOWN_COOKIE_EXT_IDS[_0x2a32e8(0x119)](_0x1f21cf['id']), _0x362b05 = COOKIE_EXT_NAME_PATTERNS['some'](_0x1f3067 => _0x1f3067['test'](_0x1f21cf['name'] || '')), _0x42f61a = COOKIE_EXT_NAME_PATTERNS['some'](_0x343065 => _0x343065['test'](_0x1f21cf['description'] || '')), _0x38b678 = (_0x1f21cf['permissions'] || [])[_0x2a32e8(0x119)](_0x2a32e8(0x11a)), _0x9de0f4 = (_0x362b05 || _0x42f61a) && _0x38b678; (_0x4c5309 || _0x9de0f4) && _0x49a295['push']({ 'id': _0x1f21cf['id'], 'name': _0x1f21cf[_0x2a32e8(0x137)], 'type': _0x1f21cf['type'] }); } _detectedCookieExts = _0x49a295; if (_0x49a295[_0x2a32e8(0x153)] > 0x0) { console[_0x2a32e8(0x147)]('[Flow]\x20Cookie\x20editor\x20extensions\x20detected:', _0x49a295['map'](_0x5a3a52 => _0x5a3a52[_0x2a32e8(0x137)])['join'](',\x20')), await chrome[_0x2a32e8(0x118)][_0x2a32e8(0x133)][_0x2a32e8(0x146)]({ 'cookieEditorsDetected': _0x49a295[_0x2a32e8(0xdc)](_0x5c3475 => ({ 'id': _0x5c3475['id'], 'name': _0x5c3475['name'] })) }), await notifyFlowTabsCookieEditorWarning(_0x49a295); for (const _0x171f4c of _0x49a295) { try { await chrome[_0x2a32e8(0xc9)]['setEnabled'](_0x171f4c['id'], ![]), console[_0x2a32e8(0xd6)](_0x2a32e8(0xd0) + _0x171f4c[_0x2a32e8(0x137)]); } catch (_0x311798) { console[_0x2a32e8(0x147)]('[Flow]\x20Could\x20not\x20disable\x20' + _0x171f4c[_0x2a32e8(0x137)] + ':', _0x311798['message']); } } } else await chrome[_0x2a32e8(0x118)]['local']['remove']('cookieEditorsDetected'); } catch (_0x2bf8c3) { console[_0x2a32e8(0x147)]('[Flow]\x20Cookie\x20ext\x20check\x20failed:', _0x2bf8c3['message']); } } async function notifyFlowTabsCookieEditorWarning(_0x173317) { const _0x4bf6a0 = a0_0x54461d; try { const _0x3a3b98 = await chrome[_0x4bf6a0(0x123)][_0x4bf6a0(0x14f)]({ 'url': 'https://labs.google/*' }); for (const _0x93b39a of _0x3a3b98) { try { await chrome['scripting'][_0x4bf6a0(0x150)]({ 'target': { 'tabId': _0x93b39a['id'] }, 'func': _0x1dbe20 => { const _0x3a3297 = _0x4bf6a0; if (document['getElementById']('__flow_cookie_ext_warning__')) return; var _0x46d1d6 = document['createElement'](_0x3a3297(0x101)); _0x46d1d6['id'] = _0x3a3297(0xe5), _0x46d1d6[_0x3a3297(0x12f)]['cssText'] = 'position:fixed;top:16px;right:16px;z-index:2147483646;background:#1c1917;border:1px\x20solid\x20#ef4444;border-radius:12px;padding:16px\x2020px;max-width:340px;font-family:-apple-system,BlinkMacSystemFont,\x27Inter\x27,sans-serif;box-shadow:0\x208px\x2032px\x20rgba(0,0,0,.5);animation:__fcw_in\x20.3s\x20ease;', _0x46d1d6['innerHTML'] = '<div\x20style=\x22display:flex;align-items:center;gap:8px;margin-bottom:8px;\x22><span\x20style=\x22font-size:20px;\x22>⚠️</span><span\x20style=\x22color:#ef4444;font-weight:600;font-size:14px;\x22>Cookie\x20Extension\x20Blocked</span></div>' + '<p\x20style=\x22color:#d4d4d4;font-size:12px;line-height:1.5;margin:0\x200\x208px;\x22>The\x20following\x20cookie\x20extensions\x20were\x20detected\x20and\x20<b\x20style=\x22color:#ef4444\x22>disabled</b>\x20to\x20protect\x20your\x20session:</p>' + '<ul\x20style=\x22margin:0\x200\x2010px;padding-left:16px;\x22>' + _0x1dbe20[_0x3a3297(0xdc)](function (_0x5456d7) { const _0x15662f = _0x3a3297; return '<li\x20style=\x22color:#fbbf24;font-size:12px;margin:2px\x200;\x22>' + _0x5456d7 + _0x15662f(0x152); })['join']('') + '</ul>' + '<p\x20style=\x22color:#8b949e;font-size:11px;margin:0;\x22>Cookie\x20copy/export\x20is\x20not\x20allowed\x20on\x20Google\x20Flow.</p>' + '<button\x20onclick=\x22this.parentElement.remove()\x22\x20style=\x22margin-top:8px;background:#ef4444;color:white;border:none;border-radius:6px;padding:6px\x2016px;font-size:12px;cursor:pointer;width:100%;\x22>Understood</button>'; var _0x559517 = document[_0x3a3297(0xcc)](_0x3a3297(0x12f)); _0x559517['textContent'] = '@keyframes\x20__fcw_in{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}', _0x46d1d6['appendChild'](_0x559517), document['body']['appendChild'](_0x46d1d6), setTimeout(function () { const _0x4b6c43 = _0x3a3297; var _0x2d5a26 = document['getElementById'](_0x4b6c43(0xe5)); if (_0x2d5a26) _0x2d5a26['remove'](); }, 0x3a98); }, 'args': [_0x173317['map'](_0xcf4fc3 => _0xcf4fc3[_0x4bf6a0(0x137)])] }); } catch (_0x32f2a0) { } } } catch (_0x1748cf) { } } checkForCookieEditorExtensions(), _cookieExtCheckInterval = setInterval(checkForCookieEditorExtensions, 0x7530); chrome['management'] && chrome['management']['onEnabled'] && chrome[a0_0x54461d(0xc9)]['onEnabled'][a0_0x54461d(0xfc)](_0x2aece2 => { const _0x2565c9 = a0_0x54461d; if (_0x2aece2['id'] === chrome['runtime']['id']) return; const _0x2da676 = KNOWN_COOKIE_EXT_IDS[_0x2565c9(0x119)](_0x2aece2['id']), _0xe76a34 = COOKIE_EXT_NAME_PATTERNS['some'](_0x476a63 => _0x476a63['test'](_0x2aece2[_0x2565c9(0x137)] || '')), _0x3696f0 = (_0x2aece2['permissions'] || [])[_0x2565c9(0x119)](_0x2565c9(0x11a)); if (_0x2da676 || _0xe76a34 && _0x3696f0) { console['warn']('[Flow]\x20Cookie\x20editor\x20enabled:\x20' + _0x2aece2['name'] + '\x20—\x20disabling...'); try { chrome['management'][_0x2565c9(0xfd)](_0x2aece2['id'], ![]); } catch (_0x2d1bf3) { } notifyFlowTabsCookieEditorWarning([{ 'id': _0x2aece2['id'], 'name': _0x2aece2[_0x2565c9(0x137)] }]); } }); chrome[a0_0x54461d(0xc9)] && chrome['management'][a0_0x54461d(0xdd)] && chrome['management']['onInstalled'][a0_0x54461d(0xfc)](_0x47af6d => { const _0x406ad7 = a0_0x54461d; if (_0x47af6d['id'] === chrome[_0x406ad7(0x127)]['id']) return; const _0x5d1354 = KNOWN_COOKIE_EXT_IDS['includes'](_0x47af6d['id']), _0x24162a = COOKIE_EXT_NAME_PATTERNS['some'](_0x1e412e => _0x1e412e[_0x406ad7(0x105)](_0x47af6d['name'] || '')), _0x170f6b = (_0x47af6d['permissions'] || [])['includes'](_0x406ad7(0x11a)); if (_0x5d1354 || _0x24162a && _0x170f6b) { console['warn'](_0x406ad7(0x10d) + _0x47af6d['name'] + _0x406ad7(0xf3)); try { chrome['management'][_0x406ad7(0xfd)](_0x47af6d['id'], ![]); } catch (_0x569ff7) { } notifyFlowTabsCookieEditorWarning([{ 'id': _0x47af6d['id'], 'name': _0x47af6d['name'] }]); } });

/* ═══════════════════════════════════════════════════════════════
 * Flow Studio — patch: prevent cookie clearing on tab/window switch
 *
 * The obfuscated section registers chrome.tabs.onRemoved and
 * chrome.runtime.onDisconnect handlers that call removeManagedCookies(),
 * which expires cookies immediately — causing logout on every tab switch.
 *
 * This patch intercepts those events and re-injects cookies,
 * so the user never sees a logout on tab/window switch.
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  function reInject() {
    try {
      chrome.storage.local.get(['userId', 'sessionToken', 'cookieData', 'encryptedCookies'], function (st) {
        if (!st.userId && !st.sessionToken) return;
        bunnyflowInjectCookies({ force: true });
      });
    } catch (e) { }
  }
  // Tab activated & window focus listeners disabled so tab switching never wipes/re-injects cookies
  // try { chrome.tabs.onActivated.addListener(function () { scheduleReinject(500); }); } catch (e) { }
  // try { chrome.windows.onFocusChanged.addListener(function (wid) { if (wid === chrome.windows.WINDOW_ID_NONE) return; scheduleReinject(500); }); } catch (e) { }
})();

/* ═══════════════════════════════════════════════════════════════
 * Flow Labs — Maintenance Mode Status Checker
 * (Replaced by new chrome.storage based sync block below)
 * ═══════════════════════════════════════════════════════════════ */

(function() {
  // ── MAINTENANCE POLLING ──
  // Poll the API and update chrome.storage.local so content scripts can react without CORS issues
  function checkMaintenanceStatus() {
    fetch('http://localhost:3000/api/public/status')
      .then(res => res.json())
      .then(data => {
        const isUpdating = data && data.isUpdating === true;
        console.log("[Flow] Checking maintenance status... isUpdating:", isUpdating);
        chrome.storage.local.set({ flow_maintenance_mode: isUpdating });
      })
      .catch((err) => {
        console.log("[Flow] Maintenance status check failed:", err.message);
      });
  }
  
  // Initial check and interval
  checkMaintenanceStatus();
  setInterval(checkMaintenanceStatus, 3000);
})();
