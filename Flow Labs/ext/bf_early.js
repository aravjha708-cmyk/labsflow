(function () {
  'use strict';

  // ── PLAN-EXPIRED FULL-SCREEN BLOCK ──────────────────────────────────────
  // If the user's plan is expired, show a black full-screen overlay over the
  // Flow page with "Your plan has expired. Renew now." and prevent any access.
  // Runs at document_start so it appears before Flow even renders.
  function _bfShowExpiredOverlay() {
    try {
      if (document.getElementById('__bf_expired_overlay__')) return;
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(['branding'], function (st) {
        var b = (st && st.branding) || {};
        var brandName = b.brandName || 'Flow Studio';
        var logoUrl = b.logoUrl || chrome.runtime.getURL('icon128.png');
        var supportUrl = b.supportUrl || 'https://flowsstudio.lovable.app';

        var ov = document.createElement('div');
        ov.id = '__bf_expired_overlay__';
        ov.style.cssText = 'position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;background:#000!important;z-index:2147483647!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;color:#fff!important;font-family:-apple-system,BlinkMacSystemFont,Inter,Arial,sans-serif!important;text-align:center!important;padding:20px!important;';
        ov.innerHTML =
          '<img src="' + logoUrl + '" style="width:64px;height:64px;border-radius:12px;margin-bottom:24px;display:block;margin-left:auto;margin-right:auto">' +
          '<h1 style="font-size:38px;font-weight:800;margin:0 0 16px;color:#fff;">Plan Not Assigned</h1>' +
          '<p style="font-size:18px;color:#cbd5e1;margin:0 0 32px;max-width:520px;line-height:1.5;">Plan not assigned. Contact your seller/reseller to activate access to Google Flow.</p>' +
          '<a href="' + supportUrl + '" target="_blank" rel="noopener" style="background:linear-gradient(135deg, #7c3aed, #0891b2);color:#fff;padding:14px 36px;border-radius:10px;font-size:16px;font-weight:700;text-decoration:none;box-shadow:0 6px 24px rgba(124,58,237,.4);">Contact Seller</a>' +
          '<p style="margin-top:28px;font-size:13px;color:#64748b;">' + brandName + '</p>';
        (document.documentElement || document.body).appendChild(ov);
        try { document.documentElement.style.overflow = 'hidden'; } catch (_) { }
      });
    } catch (_) { }
  }
  function _bfShowUpdateOverlay(updateInfo) {
    try {
      if (document.getElementById('__bf_update_overlay__')) return;
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(['branding'], function (st) {
        var b = (st && st.branding) || {};
        var brandName = b.brandName || 'Flow Studio';
        var logoUrl = b.logoUrl || chrome.runtime.getURL('icon128.png');
        var u = updateInfo || {};
        var downloadUrl = u.downloadUrl || b.downloadUrl || 'https://flowsstudio.lovable.app/flowfox.zip';
        var latestVersion = u.latestVersion || u.version || 'v2.0';

        var ov = document.createElement('div');
        ov.id = '__bf_update_overlay__';
        ov.style.cssText = 'position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;background:#090a10!important;z-index:2147483647!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;color:#fff!important;font-family:-apple-system,BlinkMacSystemFont,Inter,Arial,sans-serif!important;text-align:center!important;padding:24px!important;';
        ov.innerHTML =
          '<img src="' + logoUrl + '" style="width:72px;height:72px;border-radius:16px;margin-bottom:24px;display:block;margin-left:auto;margin-right:auto;box-shadow:0 8px 32px rgba(124,58,237,0.3);">' +
          '<div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:700;margin-bottom:16px;display:inline-block;">NEW EXTENSION VERSION AVAILABLE (' + latestVersion + ')</div>' +
          '<h1 style="font-size:36px;font-weight:800;margin:0 0 16px;color:#fff;letter-spacing:-0.5px;">Extension Update Required</h1>' +
          '<p style="font-size:17px;color:#cbd5e1;margin:0 0 32px;max-width:540px;line-height:1.6;">An important update for ' + brandName + ' Extension (' + latestVersion + ') has been released by Admin. Please download and install the update to continue generating videos.</p>' +
          '<a href="' + downloadUrl + '" target="_blank" rel="noopener" style="background:linear-gradient(135deg, #7c3aed, #2563eb);color:#fff;padding:16px 42px;border-radius:12px;font-size:17px;font-weight:700;text-decoration:none;box-shadow:0 8px 32px rgba(124,58,237,.4);display:inline-flex;align-items:center;gap:10px;">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
          ' Download Extension Update (' + latestVersion + ')</a>' +
          '<div style="margin-top:24px;font-size:13px;color:#94a3b8;line-height:1.5;">After downloading, unzip the file and click <b>Reload 🔄</b> on the extension card in <code style="background:#1e293b;padding:2px 6px;border-radius:4px;color:#e2e8f0;">chrome://extensions</code></div>' +
          '<p style="margin-top:28px;font-size:13px;color:#64748b;">' + brandName + '</p>';
        (document.documentElement || document.body).appendChild(ov);
        try { document.documentElement.style.overflow = 'hidden'; } catch (_) { }
      });
    } catch (_) { }
  }

  function _bfIsVersionNewer(latest, current) {
    if (!latest || !current) return false;
    var lParts = String(latest).replace(/^v/i, '').split('.').map(function(n) { return parseInt(n, 10) || 0; });
    var cParts = String(current).replace(/^v/i, '').split('.').map(function(n) { return parseInt(n, 10) || 0; });
    var len = Math.max(lParts.length, cParts.length);
    for (var i = 0; i < len; i++) {
      var l = lParts[i] || 0;
      var c = cParts[i] || 0;
      if (l > c) return true;
      if (l < c) return false;
    }
    return false;
  }

  function _bfCheckExtensionUpdate() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(['updateInfo'], function (d) {
        var u = (d && d.updateInfo) || {};
        var currentVersion = (chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest().version : '1.3';
        var isNewer = u.latestVersion ? _bfIsVersionNewer(u.latestVersion, currentVersion) : false;
        
        if (u.updateRequired && isNewer) {
          _bfShowUpdateOverlay(u);
        } else {
          var existing = document.getElementById('__bf_update_overlay__');
          if (existing) {
            try { existing.remove(); } catch (_) { }
            try { document.documentElement.style.overflow = ''; } catch (_) { }
          }
        }
      });
    } catch (_) { }
  }
  _bfCheckExtensionUpdate();
  setInterval(_bfCheckExtensionUpdate, 5000);

  function _bfCheckPlanExpired() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(['extension2_days', 'extension2_expiry', 'planExpires'], function (d) {
        var expired = false;
        try {
          if (typeof d.extension2_days === 'number' && d.extension2_days <= 0) expired = true;
          var exp = d.extension2_expiry || d.planExpires;
          if (exp) {
            var t = (typeof exp === 'number') ? exp : Date.parse(exp);
            if (isFinite(t) && t > 0 && t < Date.now()) expired = true;
          }
        } catch (_) { }
        if (expired) {
          _bfShowExpiredOverlay();
          // Tell background to clear admin cookies for this user
          try { chrome.runtime.sendMessage({ type: 'BF_PLAN_EXPIRED_CLEAR' }, function () { }); } catch (_) { }
        } else {
          var ex = document.getElementById('__bf_expired_overlay__');
          if (ex) ex.remove();
        }
      });
    } catch (_) { }
  }
  // Re-check periodically in case plan expires while the tab is open or storage updates
  _bfCheckPlanExpired();
  setInterval(_bfCheckPlanExpired, 30000);
  try {
    if (chrome && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;
        if (changes.extension2_days || changes.extension2_expiry || changes.planExpires) {
          _bfCheckPlanExpired();
        }
      });
    }
  } catch (_) { }

  // ── 1. CSS ────────────────────────────────────────────────────────────────
  const CSS = `
    [data-bf-hide]{display:none!important;visibility:hidden!important;}
    [data-bf-ban] {display:none!important;}
    [data-bf-locked]{opacity:0.35!important;}
    [data-bf-unlocked]{opacity:1!important;pointer-events:auto!important;cursor:pointer!important;}
    .bf-ov{position:absolute!important;inset:0!important;z-index:2147483647!important;cursor:not-allowed!important;background:transparent!important;}
    .bf-lk{position:absolute!important;right:8px!important;top:50%!important;transform:translateY(-50%)!important;font-size:11px!important;z-index:2147483647!important;pointer-events:none!important;}
    /* INSTANT 4K LOCK for non-Ultra users (applied via [data-bf-plan] on <html>) */
    html:not([data-bf-plan="ultra"]) [data-bf-4k-lock]{
      pointer-events:none!important;
      opacity:0.35!important;
      cursor:not-allowed!important;
      filter:grayscale(1)!important;
      position:relative!important;
    }
    html:not([data-bf-plan="ultra"]) [data-bf-4k-lock]::after{
      content:"LOCKED"!important;font-size:9px!important;letter-spacing:0.5px!important;
      position:absolute!important;
      right:6px!important;top:50%!important;
      transform:translateY(-50%)!important;
      font-size:13px!important;
      pointer-events:none!important;
      z-index:2147483647!important;
    }
  `;
  function inject() {
    if (document.getElementById('__bf__')) return;
    const s = document.createElement('style');
    s.id = '__bf__'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  inject();
  new MutationObserver(inject).observe(document.documentElement, { childList: true });

  // ── INSTANT 4K LOCK ──────────────────────────────────────────────────────
  // Marks any "4K Upscaled / 50 credits" option with data-bf-4k-lock the moment
  // it appears in the DOM. CSS above instantly disables it for non-Ultra users.
  const _4K_RE = /\b4\s*k\b/i;
  const _4K_HINT_RE = /upscal|50\s*credit|credit/i;
  function _bfMark4kElement(el) {
    try {
      if (!el || el.nodeType !== 1) return;
      if (el.hasAttribute('data-bf-4k-lock')) return;
      var txt = (el.textContent || '').trim();
      if (txt.length < 2 || txt.length > 60) return;
      if (!_4K_RE.test(txt)) return;
      // Confirm it's the 4K download/upscale option (not random "4k" text)
      // by checking text contains 'upscal' / 'credit', OR neighbour text does.
      var combinedTxt = txt;
      var p = el.parentElement;
      if (p) combinedTxt += ' ' + ((p.textContent || '').trim());
      if (!_4K_HINT_RE.test(combinedTxt)) return;
      el.setAttribute('data-bf-4k-lock', '1');
    } catch (_) { }
  }
  function _bfScan4k(root) {
    try {
      var r = root || document;
      // Look at common option/menu element types
      var nodes = r.querySelectorAll(
        '[role="option"],[role="menuitem"],[role="listitem"],li,button,[role="button"],div'
      );
      for (var i = 0; i < nodes.length; i++) _bfMark4kElement(nodes[i]);
    } catch (_) { }
  }
  // Observe ALL DOM changes — when 4K option dropdown opens, mark it instantly
  var _bf4kObs = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.addedNodes && m.addedNodes.length) {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType !== 1) continue;
          _bfMark4kElement(n);
          if (n.querySelectorAll) _bfScan4k(n);
        }
      }
      // Text changes (React hydration) — recheck the target
      if (m.type === 'characterData' && m.target && m.target.parentElement) {
        _bfMark4kElement(m.target.parentElement);
      }
    }
  });
  _bf4kObs.observe(document.documentElement, {
    childList: true, subtree: true, characterData: true
  });
  // Initial sweep when body becomes available
  function _bf4kInit() { _bfScan4k(document); }
  if (document.body) _bf4kInit();
  else document.addEventListener('DOMContentLoaded', _bf4kInit);

  // Block clicks on locked 4K element for non-Ultra users (capture phase)
  document.addEventListener('click', function (e) {
    try {
      if (_isUltra()) return;
      var el = e.target;
      for (var i = 0; i < 6 && el; i++) {
        if (el.getAttribute && el.getAttribute('data-bf-4k-lock') === '1') {
          e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
          return;
        }
        el = el.parentElement;
      }
    } catch (_) { }
  }, true);
  ['mousedown', 'pointerdown', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      try {
        if (_isUltra && _isUltra()) return;
        var el = e.target;
        for (var i = 0; i < 6 && el; i++) {
          if (el.getAttribute && el.getAttribute('data-bf-4k-lock') === '1') {
            e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
            return;
          }
          el = el.parentElement;
        }
      } catch (_) { }
    }, true);
  });

  // ── 2. CLICK INTERCEPT — block clicks on locked model OPTIONS only ──────────
  // Strategy: use capture-phase document click listener instead of blocking
  // addEventListener registration (which would also block the dropdown toggle button).
  //
  // Locked model OPTIONS are inside a dropdown list and have role=option/menuitem/listitem.
  // The dropdown TOGGLE button (showing current model name) must NOT be blocked so we
  // can programmatically open the dropdown.
  const _LP_RE = /lower.{0,5}priority/i;
  const _LITE_RE = /veo.{0,20}lite/i;
  const _FREE_RE = /nano.{0,5}banana|pro.{0,5}imagen/i;
  const _LOCK_RE = /\bveo\b.{0,40}(quality|fast)\b/i;
  const _OPT_SEL = '[role="option"],[role="menuitem"],[role="listitem"],li';

  var _userPlan = 'basic';
  // Read plan from dataset on documentElement (set by content script or background)
  function _isUltra() {
    if (_userPlan === 'ultra') return true;
    var p = document.documentElement.getAttribute('data-bf-plan');
    if (p) { _userPlan = p.toLowerCase(); return _userPlan === 'ultra'; }
    return false;
  }

  // Block clicks/pointerdown on locked model options in the dropdown list
  var _blockEvents = ['click', 'mousedown', 'pointerdown', 'touchstart'];
  _blockEvents.forEach(function (evName) {
    document.addEventListener(evName, function (e) {
      try {
        // Find the nearest option ancestor
        var el = e.target;
        var optEl = null;
        for (var i = 0; i < 5 && el; i++) {
          if (el.matches && el.matches(_OPT_SEL)) { optEl = el; break; }
          el = el.parentElement;
        }
        if (!optEl) return;
        var txt = (optEl.textContent || '').trim();
        if (txt.length < 3 || txt.length > 150) return;
        var isLP = _LP_RE.test(txt);
        var isLite = _LITE_RE.test(txt);
        var isFree = _FREE_RE.test(txt);
        // Block only locked (non-LP, non-Lite, non-FREE) model options
        // Ultra plan users can click Fast/Quality models
        if (!isLP && !isLite && !isFree && _LOCK_RE.test(txt) && !_isUltra()) {
          e.stopPropagation();
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      } catch (_) { }
    }, true /* capture phase */);
  });

  // ── 2b. BLOCK SEND BUTTON when non-LP model is active ────────────────────
  // ── SELF-CONTAINED SEND BUTTON LOCK ─────────────────────────────────────────
  // bf_early.js runs in MAIN world. This block independently:
  //  1. Reads the current model text directly from the DOM
  //  2. Finds the send button by position heuristics
  //  3. Applies red colour + cursor:not-allowed inline (every 300ms)
  //  4. Blocks all click + Enter events when non-LP model is active
  // No dependency on bunny_extra.js or data-bf-model-locked attribute.

  var _bfSendBtn = null;  // cached send button reference
  var _bfLocked = false; // current lock state

  // Detect whether the active video model is non-LP (returns true = should lock)
  // IMPORTANT: must skip dropdown list items — only read the combobox/selector element
  function _shouldLockSend() {
    // Scan ALL visible model-related buttons.
    // If ANY shows Lower Priority / Veo Lite → allowed (return false).
    // Only lock if Veo UI is present but NONE of the candidates show an allowed model.
    // This prevents false-positive locks on Frames page where multiple Veo buttons exist.
    try {
      var hasVeoUI = false;
      var hasAllowed = false;
      var btns = document.querySelectorAll('[role="combobox"],button,[role="button"]');
      for (var i = 0; i < btns.length; i++) {
        var el = btns[i];
        var txt = (el.textContent || '').trim();
        if (txt.length < 3 || txt.length > 120) continue;
        if (!/veo|lower.{0,5}priority/i.test(txt)) continue;
        var r = el.getBoundingClientRect();
        if (r.width < 10) continue;
        // Skip dropdown list items
        var elRole = (el.getAttribute('role') || '').toLowerCase();
        if (elRole === 'option' || elRole === 'menuitem' || elRole === 'listitem') continue;
        if (el.closest('[role="listbox"],[role="menu"],[role="list"],[role="option"],[role="menuitem"]')) continue;
        // This is a model selector candidate
        hasVeoUI = true;
        if (_LP_RE.test(txt) || _LITE_RE.test(txt) || (_isUltra() && _LOCK_RE.test(txt))) {
          hasAllowed = true;
          break; // LP or Ultra-allowed model found — definitely unlocked, stop scanning
        }
      }
      if (!hasVeoUI) return false;  // no model UI at all → don't lock (e.g. image tab)
      return !hasAllowed;           // lock only if no LP/Lite found among all candidates
    } catch (_) { }
    return false;
  }

  // _unlockVeoLiteVisual interval REMOVED — content.js is empty (0 bytes),
  // no lock is applied to Veo Lite by content.js, so no unlock needed.
  // This interval was running querySelectorAll('[role="option"],...,li') every 150ms
  // which caused expensive DOM queries on Frames pages with many li elements.

  // Find the send button: most bottom-right SVG button in lower screen area
  function _findBfSendBtn() {
    try {
      var best = null, bestScore = -1;
      var wh = window.innerHeight, ww = window.innerWidth;
      var all = document.querySelectorAll('button,[role="button"]');
      for (var i = 0; i < all.length; i++) {
        var b = all[i];
        var r = b.getBoundingClientRect();
        if (r.width < 20 || r.width > 90 || r.height < 20 || r.height > 90) continue;
        if (r.bottom < wh * 0.5) continue;
        if (r.right < ww * 0.35) continue;
        if (!b.querySelector('svg')) continue;
        var txt = (b.textContent || '').replace(/\s+/g, '');
        if (txt.length > 5) continue; // reject text buttons
        var score = (r.right / ww) * 3 + (r.bottom / wh);
        if (score > bestScore) { bestScore = score; best = b; }
      }
      return best;
    } catch (_) { return null; }
  }

  function _applyBfLock(btn) {
    if (!btn) return;
    btn.style.setProperty('background', '#ef4444', 'important');
    btn.style.setProperty('background-color', '#ef4444', 'important');
    btn.style.setProperty('background-image', 'none', 'important');
    btn.style.setProperty('border-color', '#b91c1c', 'important');
    btn.style.setProperty('cursor', 'not-allowed', 'important');
    btn.style.setProperty('opacity', '1', 'important');
    btn.setAttribute('data-bf-locked', '1');
    btn.title = _isUltra() ? '❤️ Model restricted' : '❤️ Select Lower Priority model';
  }

  function _removeBfLock(btn) {
    if (!btn) return;
    ['background', 'background-color', 'background-image', 'border-color', 'cursor', 'opacity']
      .forEach(function (p) { btn.style.removeProperty(p); });
    btn.removeAttribute('data-bf-locked');
    btn.title = '';
  }

  function _flashModelSelector() {
    try {
      var btns = document.querySelectorAll('[role="button"],[role="combobox"],button');
      for (var j = 0; j < btns.length; j++) {
        var mt = (btns[j].textContent || '').trim();
        if (mt.length > 2 && mt.length < 100 && /veo/i.test(mt) &&
          btns[j].getBoundingClientRect().width > 10) {
          var b2 = btns[j];
          b2.style.outline = '2px solid #ef4444';
          b2.style.borderRadius = '6px';
          setTimeout(function () { b2.style.outline = ''; b2.style.borderRadius = ''; }, 1200);
          break;
        }
      }
    } catch (_) { }
  }

  // Main enforcement loop — runs every 300ms
  function _bfEnforceSendLock() {
    try {
      var shouldLock = _shouldLockSend();

      if (shouldLock) {
        document.documentElement.setAttribute('data-bf-model-locked', '1');
        // Find button fresh (React may have replaced the element)
        var btn = _findBfSendBtn();
        if (btn && btn !== _bfSendBtn) {
          // New element — remove lock from old, apply to new
          if (_bfSendBtn) _removeBfLock(_bfSendBtn);
          _bfSendBtn = btn;
        }
        if (_bfSendBtn) _applyBfLock(_bfSendBtn);
        _bfLocked = true;
      } else {
        document.documentElement.removeAttribute('data-bf-model-locked');
        if (_bfSendBtn) { _removeBfLock(_bfSendBtn); _bfSendBtn = null; }
        _bfLocked = false;
      }
    } catch (_) { }
  }

  // Start enforcement loop as soon as body exists
  function _startSendLockLoop() {
    _bfEnforceSendLock();
    setInterval(_bfEnforceSendLock, 1000);
  }
  if (document.body) {
    _startSendLockLoop();
  } else {
    document.addEventListener('DOMContentLoaded', _startSendLockLoop);
  }

  // ── AUTO-SELECT LP: switch to Lower Priority on page load (MAIN world) ──────
  // Runs independently in MAIN world so .click() is more direct.
  // Stops as soon as LP is confirmed selected.

  var _bfLpDone = false;

  function _bfIsAllowedSelected() {
    var btns = document.querySelectorAll('[role="button"],[role="combobox"],button');
    for (var i = 0; i < btns.length; i++) {
      var txt = (btns[i].textContent || '').trim();
      if (txt.length > 2 && txt.length < 100 &&
        (/lower.{0,5}priority/i.test(txt) || /veo.{0,20}lite/i.test(txt)) &&
        btns[i].getBoundingClientRect().width > 10) return true;
    }
    return false;
  }

  function _bfOpenModelDropdown() {
    var btns = document.querySelectorAll('[role="button"],[role="combobox"],button');
    for (var i = 0; i < btns.length; i++) {
      var txt = (btns[i].textContent || '').trim();
      if (txt.length < 3 || txt.length > 120) continue;
      if (!/veo|fast|quality|standard/i.test(txt)) continue;
      if (/lower.{0,5}priority/i.test(txt)) continue;
      var r = btns[i].getBoundingClientRect();
      if (r.width < 10 || r.height < 6) continue;
      try { btns[i].click(); } catch (_) { }
      return true;
    }
    return false;
  }

  function _bfClickLPOption() {
    var opts = document.querySelectorAll(
      '[role="option"],[role="menuitem"],[role="listitem"],li,[tabindex="0"],[tabindex="-1"]'
    );
    for (var i = 0; i < opts.length; i++) {
      var txt = (opts[i].textContent || '').trim();
      if (txt.length < 3 || txt.length > 150) continue;
      if (!/lower.{0,5}priority/i.test(txt)) continue;
      var r = opts[i].getBoundingClientRect();
      if (r.width < 2 && r.height < 2) continue;
      try {
        opts[i].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        opts[i].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        opts[i].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        opts[i].click();
      } catch (_) { }
      return true;
    }
    return false;
  }

  var _bfLpAttempts = 0;
  function _bfAutoSelectLP() {
    if (_bfLpDone || _bfLpAttempts > 25) return;
    _bfLpAttempts++;
    if (_bfIsAllowedSelected()) { _bfLpDone = true; return; }
    if (_bfClickLPOption()) {
      // Clicked — check after 600ms if it worked
      setTimeout(function () {
        if (_bfIsAllowedSelected()) _bfLpDone = true;
        else _bfOpenModelDropdown(); // try again
      }, 600);
      return;
    }
    // Dropdown not open — open it
    _bfOpenModelDropdown();
  }

  // Auto-LP loop DISABLED — was causing white screen by clicking wrong buttons
  // when Google Flow updates their UI. Send-button lock still enforces LP selection.
  _bfLpDone = true; // mark as done so nothing tries to click

  // Block click on any locked button (data-bf-locked) OR when model is non-LP
  document.addEventListener('click', function (e) {
    try {
      var el = e.target;
      for (var i = 0; i < 8 && el; i++) {
        // Direct lock attribute on element (set by _applyBfLock above)
        if (el.getAttribute && el.getAttribute('data-bf-locked') === '1') {
          e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
          _flashModelSelector();
          return;
        }
        el = el.parentElement;
      }
      // NOTE: Broad lower-screen click blocking removed — it was breaking video
      // thumbnail clicks and download buttons on mobile. The send button is already
      // blocked via data-bf-locked attribute set by _applyBfLock().
    } catch (_) { }
  }, true);

  // Block Enter key in prompt area when locked
  document.addEventListener('keydown', function (e) {
    try {
      if (e.key !== 'Enter' || e.shiftKey) return;
      if (!_bfLocked) return;
      var active = document.activeElement;
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT'
        || active.getAttribute('contenteditable') === 'true'
        || active.getAttribute('contenteditable') === '')) {
        e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
        _flashModelSelector();
      }
    } catch (_) { }
  }, true);

  // ─────────────────────────────────────────────────────────────────────────
  // ── 3. GENERATION DETECTION — network intercept ONLY ─────────────────────
  // IMPORTANT: Layers A/B/C/D (img/video src watchers, PerformanceObserver)
  // were removed because they fire for EVERY thumbnail/frame image loaded
  // in Frames-to-Video projects (10-30+ images), causing rapid API bursts
  // that freeze the browser tab ("Page Unresponsive").
  //
  // Detection now relies SOLELY on Layer E (fetch/XHR network intercept)
  // which scans API JSON responses for videoUri/imageUri patterns.
  // Google Flow always returns completed generation results via API calls,
  // so no generations are missed.
  // ─────────────────────────────────────────────────────────────────────────

  // ── Layer E: Network intercept (fetch + XHR + SSE) ───────────────────────
  // ONLY intercepts actual Google Flow API calls that return JSON generation results.
  // DOES NOT intercept storage.googleapis.com (video/image files) to prevent page freeze.
  //
  // _BF_API matches only the Flow API endpoints that return JSON with videoUri/imageUri.
  // _BF_SKIP matches URLs we must NEVER read (media storage, fonts, analytics).
  var _BF_API = /labs\.google\/(?:fx\/)?api|labs\.google\/[^?]*\/generate|labs\.google\/[^?]*\/operation|labs\.google\/[^?]*\/project/i;
  var _BF_SKIP = /storage\.googleapis\.com|googleusercontent\.com|fonts|analytics|gtag|signout|\.(mp4|webm|mov|jpg|jpeg|png|webp|gif|mp3|ogg|wav)/i;

  var _bf_url = '', _bf_nv = 0, _bf_ni = 0;

  function _bf_reset() {
    if (location.href !== _bf_url) { _bf_url = location.href; _bf_nv = 0; _bf_ni = 0; }
  }

  // BF HANG FIX v3.10.4: global rate limiter - max 3 inspections per 2 seconds
  var _bf_inspectCount = 0, _bf_inspectReset = 0;
  function _bf_inspect(text) {
    if (!text || text.length < 10 || text.length > 300000) return;
    // Rate limit: prevent burst during frames/pic-to-video
    var now = Date.now();
    if (now - _bf_inspectReset > 2000) { _bf_inspectCount = 0; _bf_inspectReset = now; }
    if (_bf_inspectCount >= 3) return; // skip if too many calls recently
    _bf_inspectCount++;
    try {
      _bf_reset();
      var hasV = /videoUri|video_uri|generatedVideo/i.test(text);
      var hasI = /imageUri|image_uri|generatedImage/i.test(text);
      if (!hasV && !hasI) return;
      if (hasV) {
        var totalV = Math.min((text.match(/videoUri|video_uri|generatedVideo/ig) || []).length, 8);
        if (totalV > _bf_nv) {
          document.dispatchEvent(new CustomEvent('__bf_gen__', { detail: { type: 'video', count: totalV - _bf_nv } }));
          _bf_nv = totalV;
        }
      }
      if (hasI && !hasV) {
        var totalI = Math.min((text.match(/imageUri|image_uri|generatedImage/ig) || []).length, 8);
        if (totalI > _bf_ni) {
          document.dispatchEvent(new CustomEvent('__bf_gen__', { detail: { type: 'image', count: totalI - _bf_ni } }));
          _bf_ni = totalI;
        }
      }
    } catch (e) { }
  }

  // fetch — only inspect actual Flow API calls, skip ALL media/storage URLs
  // CONCURRENCY THROTTLE: max 2 simultaneous response body reads to prevent
  // freeze on Frames/pic-to-video pages where many concurrent API calls happen
  var _bf_concurrent = 0;
  var _BF_MAX_CONCURRENT = 2;
  // Skip frame/image-upload endpoints that fire many times during pic-to-video
  var _BF_SKIP_FRAMES = /\/frame|\/frames\/|\/image\/upload|\/upload\/image|\/asset\/|uploadType=multipart|uploadType=media|\/media\/upload|\/batch|\/pic.to.vid|\/pic_to_vid/i;

  var _origFetch = window.fetch;
  window.fetch = function (input, init) {
    // BF FETCH FIX: transparent passthrough. Return the ORIGINAL fetch promise so a
    // network failure ("Failed to fetch") keeps Google Flow's native stack and is
    // handled by Flow's own code -- our wrapper never appears as the error source and
    // never creates a new "Uncaught (in promise)" rejection. Inspection is passive.
    var _p = _origFetch.call(this, input, init);
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      // Only inspect calls to Flow generation API endpoints
      if (_BF_API.test(url) && !_BF_SKIP.test(url) && !_BF_SKIP_FRAMES.test(url)) {
        _p.then(function (resp) {
          try {
            // Skip if too many concurrent reads (prevents freeze on frames pages)
            if (_bf_concurrent >= _BF_MAX_CONCURRENT) return;
            // Double-check: skip if content-type is not JSON/text
            var ct = (resp.headers && resp.headers.get('content-type')) || '';
            if (ct && !/json|text|grpc/i.test(ct)) return;
            // Skip if content-length suggests large binary (> 50KB)
            var cl = parseInt((resp.headers && resp.headers.get('content-length')) || '0', 10);
            if (cl > 51200) return;
            _bf_concurrent++;
            resp.clone().text().then(function (t) {
              _bf_inspect(t);
              _bf_concurrent = Math.max(0, _bf_concurrent - 1);
            }).catch(function () {
              _bf_concurrent = Math.max(0, _bf_concurrent - 1);
            });
          } catch (e) { }
        }, function () { /* swallow on OUR observer only; original _p still rejects for Flow */ });
      }
    } catch (e) { }
    return _p;
  };

  // XHR — only inspect Flow API calls (skip frames/upload endpoints)
  var _xhrMap = new WeakMap();
  var _xhrOpen = XMLHttpRequest.prototype.open;
  var _xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url) {
    _xhrMap.set(this, String(url || ''));
    return _xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this, url = _xhrMap.get(xhr) || '';
    if (_BF_API.test(url) && !_BF_SKIP.test(url) && !_BF_SKIP_FRAMES.test(url)) {
      xhr.addEventListener('load', function () {
        var ct = xhr.getResponseHeader('content-type') || '';
        if (ct && !/json|text|grpc/i.test(ct)) return;
        var cl = parseInt(xhr.getResponseHeader('content-length') || '0', 10);
        if (cl > 51200) return;
        _bf_inspect(xhr.responseText || '');
      }, { once: true });
    }
    return _xhrSend.apply(xhr, arguments);
  };

  // EventSource (SSE) — Flow generation progress events
  var _OrigES = window.EventSource;
  if (_OrigES) {
    window.EventSource = function (url, opts) {
      var es = new _OrigES(url, opts);
      var u = String(url || '');
      if (_BF_API.test(u) && !_BF_SKIP.test(u)) {
        ['message', 'generation', 'update', 'result'].forEach(function (ev) {
          es.addEventListener(ev, function (e) { _bf_inspect(e.data || ''); });
        });
      }
      return es;
    };
    Object.setPrototypeOf(window.EventSource, _OrigES);
  }

})();