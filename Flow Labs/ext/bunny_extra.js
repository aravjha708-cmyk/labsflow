// BunnyFlow Extra v4.4 — plan expiry blocking + visual cleanup
// This file handles visual cleanup (badge removal) + video hiding + plan enforcement
(function () {
  'use strict';

  // ── 0. PLAN EXPIRY CHECK ──────────────────────────────────────────────────
  // Runs in isolated world so has chrome.storage access
  function getDaysRemaining(data) {
    if (data.daysRemaining != null) return Math.max(0, parseInt(data.daysRemaining) || 0);
    if (data.planExpiresAt) {
      const ms = new Date(data.planExpiresAt).getTime() - Date.now();
      return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
    }
    return null;
  }

  function showExpiredOverlay(serverUrl) {
    const overlay = document.createElement('div');
    overlay.id = '__bf_expired__';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647',
      background: 'rgba(10,6,18,0.97)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, sans-serif', color: '#fff',
    });
    const dashUrl = serverUrl ? serverUrl.replace(/\/+$/, '') + '/dashboard' : '#';
    overlay.innerHTML = `
      <div style="text-align:center;max-width:400px;padding:32px">
        <img src="${chrome.runtime.getURL('logo.png')}" style="width:56px;height:56px;border-radius:10px;margin-bottom:16px;display:block;margin-left:auto;margin-right:auto">
        <h2 style="font-size:22px;font-weight:700;margin:0 0 8px;color:#f87171">Plan Expired</h2>
        <p style="color:#9ca3af;font-size:14px;margin:0 0 24px;line-height:1.6">
          Your BunnyFlow plan has expired.<br>
          Contact your admin to renew access.
        </p>
        <a href="${dashUrl}" target="_blank"
           style="display:inline-block;padding:10px 24px;background:#7c3aed;color:#fff;
                  border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">
          Go to Dashboard
        </a>
      </div>`;
    function inject() {
      if (!document.getElementById('__bf_expired__') && document.body) {
        document.body.appendChild(overlay);
      }
    }
    inject();
    new MutationObserver(inject).observe(document.documentElement, { childList: true, subtree: true });
  }

  function showWarningBanner(days, serverUrl) {
    if (document.getElementById('__bf_warn__')) return;
    var banner = document.createElement('div');
    banner.id = '__bf_warn__';
    banner.style.cssText =
      'position:fixed!important;bottom:16px!important;right:16px!important;' +
      'z-index:2147483647!important;background:linear-gradient(135deg,#7f1d1d,#991b1b)!important;' +
      'color:#fff!important;border-radius:10px!important;' +
      'padding:12px 14px!important;font-size:13px!important;font-family:system-ui,sans-serif!important;' +
      'display:flex!important;align-items:center!important;gap:10px!important;' +
      'box-shadow:0 4px 20px rgba(0,0,0,0.5)!important;max-width:300px!important;';

    // Icon
    var icon = document.createElement('span');
    icon.style.fontSize = '18px';
    icon.textContent = '\u26a0\ufe0f';

    // Text block
    var textWrap = document.createElement('span');
    textWrap.style.flex = '1';

    var strong = document.createElement('strong');
    strong.textContent = days + ' day' + (days === 1 ? '' : 's') + ' left';
    var label = document.createTextNode(' on your BunnyFlow plan.');
    textWrap.appendChild(strong);
    textWrap.appendChild(label);

    // Renew link
    var br = document.createElement('br');
    var link = document.createElement('a');
    link.href = 'http://localhost:3000/pricing';
    link.target = '_blank';
    link.style.cssText = 'color:#fca5a5!important;font-weight:600!important;text-decoration:none!important;';
    link.textContent = 'Renew now \u2192';
    textWrap.appendChild(br);
    textWrap.appendChild(link);

    // Close button
    var xBtn = document.createElement('button');
    xBtn.style.cssText = 'background:none!important;border:none!important;color:#fca5a5!important;' +
      'cursor:pointer!important;font-size:16px!important;margin-left:auto!important;padding:0!important;';
    xBtn.textContent = '\u2715';
    xBtn.addEventListener('click', function() { banner.remove(); });

    banner.appendChild(icon);
    banner.appendChild(textWrap);
    banner.appendChild(xBtn);

    if (document.body) document.body.appendChild(banner);
    else document.addEventListener('DOMContentLoaded', function() { document.body.appendChild(banner); });
  }

  function injectCSS() {
    if (document.getElementById('__bf__')) return;
    const s = document.createElement('style');
    s.id = '__bf__'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  injectCSS();
  new MutationObserver(injectCSS).observe(document.documentElement, { childList: true });

  // ── 2. MATCHERS ───────────────────────────────────────────────────────────
  const LOCK_RE  = /veo.*(quality|fast(?!.*lower))/i;
  const LP_RE    = /lower.{0,5}priority/i;
  const FREE_RE  = /nano.{0,5}banana|pro.{0,5}imagen|^imagen\b|veo.*lite/i;

  let _userPlan = 'basic';
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(['userPlan'], function(res) {
      if (res.userPlan) _userPlan = res.userPlan.toLowerCase();
      applyPlanClass();
      if (_userPlan === 'ultra') setTimeout(function() { unlockFreeModels(); }, 0);
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.userPlan) {
        _userPlan = changes.userPlan.newValue.toLowerCase();
        applyPlanClass();
        if (_userPlan === 'ultra') setTimeout(function() { unlockFreeModels(); }, 0);
      }
    });
  }
  function isUltra() { return _userPlan === 'ultra'; }
  function applyPlanClass() {
    // Set data-bf-plan on <html> — CSS uses this for instant React-proof locking
    document.documentElement.dataset.bfPlan = _userPlan || 'basic';
  }
  // Apply immediately (before async storage resolves) so CSS lock is instant
  applyPlanClass();

  const OPT_SEL = '[role="option"],[role="menuitem"],[role="listitem"],li,[tabindex="0"],[tabindex="-1"]';

  function shouldFreeUnlock(txt) {
    if (!txt || txt.length > 120) return false;
    if (isUltra() && LOCK_RE.test(txt)) return true;
    return LP_RE.test(txt) || FREE_RE.test(txt);
  }

  // ── 3. LOCK non-free video models ─────────────────────────────────────────
  function lockModels() {
    if (isUltra()) return; // Ultra: nothing to lock
    document.querySelectorAll(OPT_SEL).forEach(el => {
      const txt = (el.textContent || '').trim();
      if (txt.length > 120) return;
      if (LP_RE.test(txt) || FREE_RE.test(txt)) return; // never touch LP/free models
      if (!LOCK_RE.test(txt)) return; // only Fast / Quality

      // Always re-enforce — inline styles survive React re-renders, attribute may not
      el.dataset.bfLocked = '1';
      el.style.setProperty('opacity', '0.35',        'important');
      el.style.setProperty('cursor',  'not-allowed', 'important');

      // Attach block listener once per DOM node (new nodes from React get fresh listener)
      if (!el._bfBlock) {
        const block = e => { e.stopPropagation(); e.preventDefault(); };
        ['click','mousedown','pointerdown','touchstart','keydown'].forEach(ev =>
          el.addEventListener(ev, block, true));
        el._bfBlock = true;
      }
    });
  }

  // ── 4. FORCE-UNLOCK free models (LP + free image models) ─────────────────
  // bf_early.js already prevents persistent_lock.js from adding click-blocking
  // listeners on LP/free elements via addEventListener intercept.
  // This function handles VISUAL cleanup: removes lock badge icons/overlays
  // that persistent_lock.js may still inject as DOM children.

  function removeLockBadges(el) {
    // ONLY remove elements WE injected — never touch Google Flow's own elements
    Array.from(el.children).forEach(child => {
      const isOurs = child.classList.contains('bf-ov') || child.classList.contains('bf-lk');
      if (isOurs) child.remove();
    });
  }

  function unlockFreeModels() {
    document.querySelectorAll(OPT_SEL).forEach(el => {
      if (el.dataset.bfUnlocked === '1') return; // already done, skip repeated style-sets
      const txt = el.textContent || '';
      if (!shouldFreeUnlock(txt)) return;

      // Remove visual lock badges left by persistent_lock.js
      removeLockBadges(el);

      // Force pointer events + visual unlock
      el.style.setProperty('pointer-events', 'auto',    'important');
      el.style.setProperty('opacity',        '1',        'important');
      el.style.setProperty('cursor',         'pointer',  'important');
      delete el.dataset.bfLocked;
      el.removeAttribute('disabled');
      el.removeAttribute('aria-disabled');
      el.dataset.bfUnlocked = '1';
    });
  }

  // ── 5. VIDEO / THUMBNAIL HIDING (home page only) ──────────────────────────
  const DATE_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b.{0,5}\d{1,2}|\d{1,2}:\d{2}\s*(am|pm)|tháng|\d{4}-\d{2}-\d{2}/i;
  const NEWP_RE = /new\s*project|dự án mới|\+\s*d|create new/i;
  const BNNER_RE = /nano banana|is here!|new model|veo\s+\d|imagen/i;

  function isHome() { return !/\/project\//.test(location.pathname); }

  function cardParent(el, depth) {
    depth = depth || 8;
    let cur = el;
    for (let i = 0; i < depth; i++) {
      const p = cur.parentElement;
      if (!p || p === document.body || p === document.documentElement) break;
      if (p.children.length > 6) return cur;
      if (['ARTICLE','LI'].includes(p.tagName) || p.getAttribute('role') === 'gridcell') return p;
      cur = p;
    }
    return cur;
  }

  function hideVideos() {
    if (!isHome()) return;

    // Hide all project card links and their parent cards
    document.querySelectorAll('a[href*="/project/"]').forEach(a => {
      if (a.dataset.bfSeen) return;
      a.dataset.bfSeen = '1';
      if (NEWP_RE.test(a.textContent || '')) return;
      const card = cardParent(a);
      card.dataset.bfHide = '1';
      // Also hide the link itself in case card hiding misses it
      a.dataset.bfHide = '1';
    });

    // Hide list/article/gridcell items that contain dates (project cards)
    document.querySelectorAll('li,article,[role="gridcell"],[role="listitem"]').forEach(el => {
      if (el.dataset.bfSeen) return;
      el.dataset.bfSeen = '1';
      const txt = el.textContent || '';
      if (txt.length > 350 || !DATE_RE.test(txt) || NEWP_RE.test(txt)) return;
      el.dataset.bfHide = '1';
    });

    // Hide any div/section with an image/video AND a date (= project thumbnail card)
    document.querySelectorAll('div,section').forEach(el => {
      if (el.dataset.bfSeen) return;
      const txt = el.textContent || '';
      if (txt.length > 280 || txt.length < 3 || !DATE_RE.test(txt) || NEWP_RE.test(txt)) return;
      if (!el.querySelector('img,video,[role="img"]')) return;
      if (el.querySelectorAll('[data-bf-hide]').length > 0) return;
      el.dataset.bfSeen = '1';
      cardParent(el).dataset.bfHide = '1';
    });

    // Hide "Your projects" / "Recent" section titles and banner ads
    document.querySelectorAll('div,section').forEach(el => {
      if (el.dataset.bfSeen) return;
      const txt = el.textContent || '';
      if (txt.length > 500 || txt.length < 5 || !BNNER_RE.test(txt) || NEWP_RE.test(txt)) return;
      el.dataset.bfSeen = '1';
      el.dataset.bfBan = '1';
    });

    // Also hide any container whose ALL children are [data-bf-hide] (= entire project grid)
    document.querySelectorAll('ul,ol,div[class*="grid"],div[class*="list"]').forEach(el => {
      if (el.dataset.bfSeen) return;
      const kids = Array.from(el.children);
      if (kids.length < 2) return;
      const allHidden = kids.every(k => k.dataset.bfHide === '1' || k.dataset.bfBan === '1');
      if (allHidden) {
        el.dataset.bfSeen = '1';
        el.dataset.bfHide = '1';
      }
    });
  }

  // ── 5b. GENERATION WATCHER & CREDIT DEDUCTION ───────────────────────────────
  // Detects when videos/images complete on Google Flow and calls
  // POST /api/extension/use-credits to deduct from the user's BunnyFlow account.
  //
  // Strategy: track how many <video> elements exist at page-load (baseCount).
  // Any increase after that = new generation completed → charge credits.
  // Images are detected similarly via <img> inside generation result containers.

  // ─── CREDIT DEDUCTION ─────────────────────────────────────────────────────
  // Rules:
  //   • Deduct 20 credits ONLY after a video is SUCCESSFULLY generated.
  //   • Download is FREE — no credits deducted on download.
  //   • Prevent double deductions with a per-page cooldown.
  //
  // Detection approach — two independent layers:
  //   Layer 1 (PRIMARY)  : Progress-bar disappearance watcher in watchGenerations()
  //     Google Flow shows "33%", "67%"... while generating.
  //     When those percentage text elements disappear, generation is complete.
  //   Layer 2 (BACKUP)   : Network intercept in bf_early.js watches API responses
  //     for videoUri / .mp4 patterns and dispatches __bf_gen__ event.
  //
  // Either layer fires callUseCredits() which sends one POST to BunnyFlow backend.
  // Both layers share a cooldown to prevent double charging.
  // ─────────────────────────────────────────────────────────────────────────────

  const _API_BASE = '';

  // Cooldown: after any charge, ignore further charge attempts for N ms.
  // Prevents double deduction if both layers fire for the same completion.
  let _chargeTs   = 0;
  const _COOLDOWN = 5000; // 8 seconds per charge event

  // ─── Auth ──────────────────────────────────────────────────────────────────
  // background.js stores sessionToken as "userId:jwt".
  // Extract the real JWT by splitting on the first colon.
  function _extractJwt(all) {
    if (all.sessionToken && typeof all.sessionToken === 'string' && all.sessionToken.includes(':')) {
      const jwt = all.sessionToken.substring(all.sessionToken.indexOf(':') + 1);
      if (jwt && jwt.length > 20) return jwt;
    }
    return all.token || all.session || all.authToken || all.jwt || null;
  }

  // ─── Credit API call ───────────────────────────────────────────────────────
  function callUseCredits(type, count) {
    return; /* BunnyFlow v3.10.32: credits system disabled per user request */
    if (typeof chrome === 'undefined' || !chrome.storage) return;

    // Per-charge cooldown — prevent double deduction
    const now = Date.now();
    if (now - _chargeTs < _COOLDOWN) return;
    _chargeTs = now;

    chrome.storage.local.get(null, function(all) {
      const token   = _extractJwt(all);
      const apiBase = all.apiBase || all.origin || _API_BASE;
      if (!token || token.length < 20) return;

      for (let i = 0; i < (count || 1); i++) {
        fetch(apiBase + '/api/extension/use-credits', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
            'X-Ext-Version': '1.2',
          },
          body: JSON.stringify({ type: type || 'video' }),
        })
        .then(function(res) { return res.ok ? res.json() : null; })
        .then(function(data) {
          if (data && data.creditsRemaining != null && chrome.storage) {
            chrome.storage.local.set({ credits: data.creditsRemaining, creditsLeft: data.creditsRemaining });
          }
        })
        .catch(function() {});
      }
    });

    // Also notify background.js so its own credit path can fire
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      try {
        chrome.runtime.sendMessage({
          type: type === 'video' ? 'VIDEO_GENERATED' : 'IMAGE_GENERATED',
          data: { mediaType: type || 'video', prompt: '', videoUrl: null, thumbnailUrl: null }
        }, function() {});
      } catch(e) {}
    }
  }

  // ─── Layer 2: Network intercept backup ────────────────────────────────────
  // bf_early.js dispatches __bf_gen__ when it finds videoUri in API responses.
  // Use this only if Layer 1 (progress bars) hasn't fired recently.
  document.addEventListener('__bf_gen__', function(e) {
    if (!e.detail || !e.detail.count || e.detail.count <= 0) return;
    callUseCredits(e.detail.type || 'video', e.detail.count);
  });

  // ─── Layer 1: Progress-bar disappearance (PRIMARY) ────────────────────────
  // Counts leaf DOM elements that contain only a percentage number (e.g. "33%").
  // When those disappear after being present → generation completed.
  let _progSeen  = 0; // max % bars seen in current generation run
  let _progPolls = 0; // consecutive polls with % bars visible
  let _genLastUrl = '';

  function countProgressBars() {
    var count = 0;
    var all = document.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.childElementCount === 0) {
        var txt = (el.textContent || '').trim();
        // Match only pure percentage text: "33%" "100%" etc.
        if (/^[1-9]\d?%$|^100%$/.test(txt)) count++;
      }
    }
    return count;
  }

  function watchGenerations() {
    if (isHome()) {
      _progSeen = 0; _progPolls = 0; _genLastUrl = '';
      return;
    }

    // Reset counters on page navigation
    if (location.href !== _genLastUrl) {
      _genLastUrl = location.href;
      _progSeen = 0; _progPolls = 0;
      return;
    }

    var current = countProgressBars();

    if (current > 0) {
      // Generation in progress
      if (current > _progSeen) _progSeen = current;
      _progPolls++;

      // Ensure current generation is tracked
      if (!_currGenId || !_genMap[_currGenId]) {
        _currGenId = _newGenId();
        _genMap[_currGenId] = { status: 'pending', deducted: false };
      }
    } else if (_progPolls >= 1 && _progSeen > 0) {
      // Progress bars gone → generation succeeded
      var completed = _progSeen;
      var genId     = _currGenId;
      _progSeen     = 0;
      _progPolls    = 0;

      // Task 2: use tracking — mark success → deduct only once
      if (genId && _genMap[genId] && !_genMap[genId].deducted) {
        _markGenSuccess(genId);
        // If more than 1 video was generating, charge for the rest directly
        for (var extra = 1; extra < completed; extra++) {
          var xId = _newGenId();
          _genMap[xId] = { status: 'pending', deducted: false };
          _markGenSuccess(xId);
        }
      } else {
        // Fallback: no tracking record → charge directly
        callUseCredits('video', completed);
      }

      _currGenId = null;
    }
  }

  // ── MISSING FUNCTIONS (restored) ─────────────────────────────────────────

  // Variable declarations referenced in onNav() and below
  let lpSwitchPending = false;
  let _genBaseVideo   = -1;  // kept for onNav() compat

  // Simple generation tracking: Task 2
  // Each generation gets a unique ID, status, and deducted flag.
  // Only deduct when status = 'success' AND deducted = false.
  const _genMap = {};   // { [genId]: { status, deducted } }
  let   _currGenId = null;

  function _newGenId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function _markGenSuccess(genId) {
    if (!genId || !_genMap[genId]) return;
    const rec = _genMap[genId];
    if (rec.status === 'success' && rec.deducted) return; // already handled
    rec.status   = 'success';
    if (!rec.deducted) {
      rec.deducted = true;
      callUseCredits('video', 1);
    }
  }

  // ── AUTO-SELECT LOWER PRIORITY MODEL ─────────────────────────────────────
  // Every time user lands on Flow (fresh load, redirect, SPA nav):
  //  1. Check if LP is already selected → done
  //  2. If not, open the model dropdown by clicking the current model button
  //  3. Wait 400ms for dropdown to appear, then click LP option
  //  4. If LP option not found yet, retry up to 8 times (every 300ms)
  //
  // MODEL_RE: matches any non-LP video model name (Veo, Fast, Quality, etc.)
  const MODEL_BTN_RE = /veo|fast|quality|standard|turbo|flash|ultra/i;

  let _lpDone    = false;   // true once LP successfully clicked this page load
  let _lpOpening = false;   // true while we're in the open→click sequence

  function _isLPSelected() {
    // Check all visible buttons/selectors for LP text
    const all = document.querySelectorAll('[role="button"],[role="combobox"],button,select');
    for (var i = 0; i < all.length; i++) {
      const txt = (all[i].textContent || all[i].value || '').trim();
      if (txt.length > 2 && txt.length < 100 && /lower.{0,5}priority/i.test(txt)) return true;
    }
    return false;
  }

  function _clickLPInDropdown() {
    // Try to find and click the LP option in an open dropdown
    const opts = document.querySelectorAll(
      '[role="option"],[role="menuitem"],[role="listitem"],li,[tabindex="0"],[tabindex="-1"]'
    );
    for (var i = 0; i < opts.length; i++) {
      const opt = opts[i];
      const txt = (opt.textContent || '').trim();
      if (txt.length < 3 || txt.length > 150) continue;
      if (!/lower.{0,5}priority/i.test(txt)) continue;
      // Verify it's visible
      const rect = opt.getBoundingClientRect();
      if (rect.width < 2 && rect.height < 2) continue;

      // Found LP option — fire proper mouse event sequence
      try {
        opt.dispatchEvent(new MouseEvent('mouseover',  { bubbles: true, cancelable: true }));
        opt.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        opt.dispatchEvent(new MouseEvent('mousedown',  { bubbles: true, cancelable: true }));
        opt.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, cancelable: true }));
        opt.dispatchEvent(new MouseEvent('mouseup',    { bubbles: true, cancelable: true }));
        opt.dispatchEvent(new MouseEvent('click',      { bubbles: true, cancelable: true }));
        opt.click();
      } catch(e) {}

      _lpDone    = true;
      _lpOpening = false;
      lpSwitchPending = true;
      setTimeout(function() { lpSwitchPending = false; }, 2500);
      return true;
    }
    return false;
  }

  function _openModelDropdown() {
    // Find the model selector button (currently showing a non-LP model name)
    const btns = document.querySelectorAll('[role="button"],[role="combobox"],button');
    for (var i = 0; i < btns.length; i++) {
      const btn = btns[i];
      const txt = (btn.textContent || '').trim();
      if (txt.length < 3 || txt.length > 120) continue;
      // Must look like a model name (Veo, Fast, Quality, etc.) and not be LP
      if (!MODEL_BTN_RE.test(txt)) continue;
      if (/lower.{0,5}priority/i.test(txt)) continue;
      // Must be visible
      const rect = btn.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 6) continue;
      try { btn.click(); } catch(e) {}
      return true;
    }
    return false;
  }

  // MutationObserver: fires instantly when LP option appears in the DOM
  // (when the dropdown opens). This is faster and more reliable than polling.
  var _lpObserver = null;

  function _startLPObserver() {
    if (_lpObserver) return; // already watching
    _lpObserver = new MutationObserver(function() {
      if (_lpDone || isHome()) return;
      if (_clickLPInDropdown()) {
        _stopLPObserver(); // LP clicked — stop observing
      }
    });
    _lpObserver.observe(document.body || document.documentElement,
      { childList: true, subtree: true });
  }

  function _stopLPObserver() {
    if (_lpObserver) { _lpObserver.disconnect(); _lpObserver = null; }
  }

  function _trySelectLP(retries) {
    if (_lpDone || isHome()) { _stopLPObserver(); return; }
    // Already LP?
    if (_isLPSelected()) { _lpDone = true; _lpOpening = false; _stopLPObserver(); return; }
    // LP option visible in open dropdown? Click it now.
    if (_clickLPInDropdown()) { _stopLPObserver(); return; }
    // Not found yet — open the dropdown if retries left
    if (retries <= 0) { _lpOpening = false; _stopLPObserver(); return; }
    _openModelDropdown();
    // Wait 400ms then try again
    setTimeout(function() { _trySelectLP(retries - 1); }, 400);
  }

  function autoSelectLP() {
    return; /* BunnyFlow v3.10.36: auto model selection disabled */
    if (isHome() || lpSwitchPending) return;
    if (_lpDone && _isLPSelected()) return;
    if (_isLPSelected()) { _lpDone = true; return; }
    if (_lpOpening) return; // already in progress
    // Start: watch the DOM for LP option + poll
    _lpOpening = true;
    _lpDone    = false;
    _startLPObserver();           // instant reaction when dropdown opens
    _trySelectLP(20);             // fallback: up to 20 retries × 400ms = 8 seconds
  }

  // ── ENFORCE LP MODEL: lock send button via HTML attribute + CSS ─────────────
  // Sets/removes data-bf-model-locked on <html> element.
  // CSS (above) turns send button RED when attribute is present.
  // bf_early.js capture-phase listener blocks actual clicks when attribute is set.

  function _getCurrentModelText() {
    const btns = document.querySelectorAll('[role="button"],[role="combobox"],button');
    for (var i = 0; i < btns.length; i++) {
      const txt = (btns[i].textContent || '').trim();
      if (txt.length < 3 || txt.length > 100) continue;
      if (!/veo|lower.{0,5}priority/i.test(txt)) continue;
      if (btns[i].getBoundingClientRect().width < 10) continue;
      return txt;
    }
    return '';
  }

  // ── SEND BUTTON LOCK: fixed overlay + attribute + inline style (triple lock) ──
  // Approach: a single <div id="__bf_slo__"> overlays the send button.
  // Its position is updated every 200ms so it never drifts.
  // bf_early.js (MAIN world) blocks the real button via data-bf-model-locked.
  // Inline styles on the button itself are also applied as a 3rd layer.

  var _slo = null; // the overlay div
  var _sloBtnObs = null; // MutationObserver watching the found button

  function _getOrCreateOverlay() {
    if (_slo && document.contains(_slo)) return _slo;
    _slo = document.createElement('div');
    _slo.id = '__bf_slo__';
    Object.assign(_slo.style, {
      position:     'fixed',
      zIndex:       '2147483646',
      borderRadius: '50%',
      cursor:       'not-allowed',
      background:   '#ef4444',
      opacity:      '0.92',
      display:      'none',
      pointerEvents:'auto',
    });
    _slo.title = 'Select "Lower Priority" model to generate video';
    _slo.style.pointerEvents = 'none';
    document.documentElement.appendChild(_slo);
    return _slo;
  }

  function _flashModelSel() {
    var btns = document.querySelectorAll('[role="button"],[role="combobox"],button');
    for (var j = 0; j < btns.length; j++) {
      var mt = (btns[j].textContent || '').trim();
      if (mt.length > 2 && mt.length < 100 && /veo/i.test(mt)
          && btns[j].getBoundingClientRect().width > 10) {
        var b2 = btns[j];
        b2.style.outline = '2px solid #ef4444';
        b2.style.borderRadius = '6px';
        setTimeout(function() { b2.style.outline = ''; b2.style.borderRadius = ''; }, 1200);
        break;
      }
    }
  }

  // Find the send button: rightmost + bottommost SVG-only button in lower-right of screen
  function _findSendBtn() {
    var best = null, bestScore = -1;
    var wh = window.innerHeight, ww = window.innerWidth;
    var allBtns = document.querySelectorAll('button,[role="button"]');
    for (var i = 0; i < allBtns.length; i++) {
      var b = allBtns[i];
      if (!b.offsetParent && b.style.display === 'none') continue;
      var r = b.getBoundingClientRect();
      if (r.width < 24 || r.width > 80) continue;   // small-ish button
      if (r.height < 24 || r.height > 80) continue;
      if (r.bottom < wh * 0.55) continue;            // lower 45% of screen
      if (r.right < ww * 0.45) continue;             // right 55% of screen
      if (!b.querySelector('svg,img')) continue;      // has icon
      // reject text-heavy buttons (tabs, labels)
      var txt = (b.textContent || '').replace(/\s+/g, '');
      if (txt.length > 6) continue;
      // score: prioritise rightmost, bottommost
      var score = (r.right / ww) * 2 + (r.bottom / wh);
      if (score > bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  function _applyLockStyles(btn) {
    if (!btn) return;
    btn.style.setProperty('background',       '#ef4444', 'important');
    btn.style.setProperty('background-color', '#ef4444', 'important');
    btn.style.setProperty('background-image', 'none',    'important');
    btn.style.setProperty('border-color',     '#b91c1c', 'important');
    btn.style.setProperty('opacity',          '1',       'important');
    btn.style.setProperty('cursor',           'not-allowed', 'important');
    btn.dataset.bfLocked = '1';
  }

  function _removeLockStyles(btn) {
    if (!btn) return;
    ['background','background-color','background-image','border-color','opacity','cursor']
      .forEach(function(p) { btn.style.removeProperty(p); });
    delete btn.dataset.bfLocked;
    btn.title = '';
  }

  function _positionOverlay(btn) {
    var ov = _getOrCreateOverlay();
    if (!btn) { ov.style.display = 'none'; return; }
    var r = btn.getBoundingClientRect();
    if (r.width < 1) { ov.style.display = 'none'; return; }
    ov.style.left   = r.left   + 'px';
    ov.style.top    = r.top    + 'px';
    ov.style.width  = r.width  + 'px';
    ov.style.height = r.height + 'px';
    ov.style.display = 'block';
  }

  var _sendBtnCache = null;
  var _btnObserver  = null;

  function _observeBtn(btn) {
    if (_btnObserver) { _btnObserver.disconnect(); _btnObserver = null; }
    if (!btn) return;
    _btnObserver = new MutationObserver(function() {
      // If React wiped our styles, reapply immediately
      if (document.documentElement.hasAttribute('data-bf-model-locked')) {
        _applyLockStyles(btn);
        _positionOverlay(btn);
      }
    });
    _btnObserver.observe(btn, { attributes: true, attributeFilter: ['style','class'] });
  }

  function enforceLPModel() {
    return; /* BunnyFlow v3.10.36: model enforcement disabled */
    var ov = _getOrCreateOverlay();

    if (isHome()) {
      document.documentElement.removeAttribute('data-bf-model-locked');
      if (_sendBtnCache) { _removeLockStyles(_sendBtnCache); _sendBtnCache = null; }
      if (_btnObserver) { _btnObserver.disconnect(); _btnObserver = null; }
      ov.style.display = 'none';
      return;
    }

    var modelTxt = _getCurrentModelText();
    if (!modelTxt) {
      // Image tab or no model visible → unlock
      document.documentElement.removeAttribute('data-bf-model-locked');
      if (_sendBtnCache) { _removeLockStyles(_sendBtnCache); _sendBtnCache = null; }
      if (_btnObserver) { _btnObserver.disconnect(); _btnObserver = null; }
      ov.style.display = 'none';
      return;
    }

    var isLP = /lower.{0,5}priority/i.test(modelTxt);

    if (isLP) {
      // UNLOCK
      document.documentElement.removeAttribute('data-bf-model-locked');
      if (_sendBtnCache) { _removeLockStyles(_sendBtnCache); }
      if (_btnObserver) { _btnObserver.disconnect(); _btnObserver = null; }
      _sendBtnCache = null;
      ov.style.display = 'none';
    } else {
      // LOCK
      document.documentElement.setAttribute('data-bf-model-locked', '1');
      var btn = _findSendBtn();
      if (btn && btn !== _sendBtnCache) {
        // New button found (React replaced it) → re-observe
        if (_sendBtnCache) _removeLockStyles(_sendBtnCache);
        _sendBtnCache = btn;
        _observeBtn(btn);
      }
      if (_sendBtnCache) {
        _applyLockStyles(_sendBtnCache);
        _positionOverlay(_sendBtnCache);
      } else {
        ov.style.display = 'none';
      }
    }
  }

  // hookSendButton: intercept the generate button to record a pending generation ID.
  // On click → create a new gen record with status=pending.
  // watchGenerations() will mark it success when progress bars disappear.
  function hookSendButton() {
    if (isHome()) return;
    const BTN_SEL = '[aria-label*="send" i],[aria-label*="generat" i],[aria-label*="create" i]';
    document.querySelectorAll(BTN_SEL).forEach(function(btn) {
      if (btn.dataset.bfSendHooked) return;
      btn.dataset.bfSendHooked = '1';
      btn.addEventListener('click', function() {
        _currGenId = _newGenId();
        _genMap[_currGenId] = { status: 'pending', deducted: false };
        // Expire old records (keep last 10)
        const keys = Object.keys(_genMap);
        if (keys.length > 10) delete _genMap[keys[0]];
      }, { capture: true });
    });
    // Also hook any form submission (textarea + Enter)
    document.querySelectorAll('textarea,input[type="text"]').forEach(function(inp) {
      if (inp.dataset.bfKeyHooked) return;
      inp.dataset.bfKeyHooked = '1';
      inp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          _currGenId = _newGenId();
          _genMap[_currGenId] = { status: 'pending', deducted: false };
        }
      }, { capture: true });
    });
  }

  // ── HIDE "Not enough credits" GOOGLE FLOW ERROR TOASTS ──────────────────
  const _CRED_RE = /not enough credits|enough credits to save|credits to save this/i;
  const _TOAST_SELS = [
    '[role="alert"]', '[role="status"]',
    'snack-bar-container', 'mat-snack-bar-container',
    '.snackbar', '.toast', '.notification', '.alert-message',
    '[class*="snack"]', '[class*="toast"]', '[class*="notif"]',
    '[class*="error"]', '[class*="credits"]',
  ].join(',');

  function hideErrorMessages() {
    try {
      // Hide any element containing the "not enough credits" text
      document.querySelectorAll(_TOAST_SELS).forEach(el => {
        if (_CRED_RE.test(el.textContent || '')) {
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('visibility', 'hidden', 'important');
          el.style.setProperty('opacity', '0', 'important');
          el.setAttribute('data-bf-ban', '1');
        }
      });
      // Also scan all elements with inline error-like styles that mention credits
      document.querySelectorAll('[aria-live]').forEach(el => {
        if (_CRED_RE.test(el.textContent || '')) {
          el.style.setProperty('display', 'none', 'important');
          el.setAttribute('data-bf-ban', '1');
        }
      });
    } catch(e) {}
  }

  // ── AUTO-SET VEO LITE IN NEW PROJECT CREATION PANEL ─────────────────────
  // When user clicks "+ New Project" on Flow home page, a creation panel opens
  // showing "Veo 3.1 - Fast" by default. This auto-switches it to "Veo 3.1 - Lite"
  // (or "Lower Priority" as fallback) as soon as the panel appears.

  const LITE_SEL_RE = /veo.*lite|lower.{0,5}priority/i;
  let _liteHomeDone    = false;
  let _liteHomeOpening = false;
  var _liteHomeObs     = null;

  function _creationPanelOpen() {
    // Panel detected by "Generating will use N credits" text being visible
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      if (all[i].childElementCount > 0) continue;
      var t = (all[i].textContent || '').trim();
      if (/generating will use \d+\s*credit/i.test(t)) return true;
    }
    // Also detect by: visible "Video" tab + "Veo" model button on home page
    if (!isHome()) return false;
    var modelBtns = document.querySelectorAll('[role="button"],[role="combobox"],button');
    for (var j = 0; j < modelBtns.length; j++) {
      var txt = (modelBtns[j].textContent || '').trim();
      if (txt.length < 3 || txt.length > 80) continue;
      if (!/veo.*fast|veo.*quality|veo.*standard/i.test(txt)) continue;
      var r = modelBtns[j].getBoundingClientRect();
      if (r.width > 10 && r.height > 6) return true;
    }
    return false;
  }

  function _isLiteOrLPSelected() {
    var btns = document.querySelectorAll('[role="button"],[role="combobox"],button,select');
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || btns[i].value || '').trim();
      if (t.length > 2 && t.length < 100 && LITE_SEL_RE.test(t)) return true;
    }
    return false;
  }

  function _clickLiteOrLP() {
    var opts = document.querySelectorAll(
      '[role="option"],[role="menuitem"],[role="listitem"],li,[tabindex="0"],[tabindex="-1"]'
    );
    var liteOpt = null, lpOpt = null;
    for (var i = 0; i < opts.length; i++) {
      var t   = (opts[i].textContent || '').trim();
      if (t.length < 3 || t.length > 150) continue;
      var r   = opts[i].getBoundingClientRect();
      if (r.width < 2 && r.height < 2) continue;
      if (/veo.*lite/i.test(t) && !liteOpt) liteOpt = opts[i];
      if (/lower.{0,5}priority/i.test(t) && !lpOpt) lpOpt = opts[i];
    }
    var target = liteOpt || lpOpt; // prefer Lite over LP
    if (!target) return false;
    try {
      target.dispatchEvent(new MouseEvent('mouseover',  { bubbles: true, cancelable: true }));
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent('mousedown',  { bubbles: true, cancelable: true }));
      target.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent('mouseup',    { bubbles: true, cancelable: true }));
      target.dispatchEvent(new MouseEvent('click',      { bubbles: true, cancelable: true }));
      target.click();
    } catch(e) {}
    _liteHomeDone    = true;
    _liteHomeOpening = false;
    return true;
  }

  function _openVeoDropdownHome() {
    var btns = document.querySelectorAll('[role="button"],[role="combobox"],button');
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || '').trim();
      if (t.length < 3 || t.length > 120) continue;
      if (!/veo|fast|quality|standard/i.test(t)) continue;
      if (LITE_SEL_RE.test(t)) continue; // already lite/LP — skip
      var r = btns[i].getBoundingClientRect();
      if (r.width < 10 || r.height < 6) continue;
      try { btns[i].click(); } catch(e) {}
      return true;
    }
    return false;
  }

  function _stopLiteHomeObs() {
    if (_liteHomeObs) { _liteHomeObs.disconnect(); _liteHomeObs = null; }
  }

  function _trySelectLiteHome(retries) {
    if (!_creationPanelOpen()) { _liteHomeOpening = false; _stopLiteHomeObs(); return; }
    if (_isLiteOrLPSelected()) { _liteHomeDone = true; _liteHomeOpening = false; _stopLiteHomeObs(); return; }
    if (_clickLiteOrLP()) { _stopLiteHomeObs(); return; }
    if (retries <= 0) { _liteHomeOpening = false; _stopLiteHomeObs(); return; }
    _openVeoDropdownHome();
    setTimeout(function() { _trySelectLiteHome(retries - 1); }, 350);
  }

  function autoSetVeoLiteOnNewProject() {
    return; /* BunnyFlow v3.10.36: auto model selection disabled */
    if (!isHome()) return;
    if (!_creationPanelOpen()) { _liteHomeDone = false; return; } // reset so next open triggers
    if (_liteHomeDone && _isLiteOrLPSelected()) return;
    if (_isLiteOrLPSelected()) { _liteHomeDone = true; return; }
    if (_liteHomeOpening) return;
    _liteHomeOpening = true;
    _liteHomeDone    = false;
    // MutationObserver: reacts instantly when dropdown opens
    if (!_liteHomeObs) {
      _liteHomeObs = new MutationObserver(function() {
        if (!_creationPanelOpen()) { _stopLiteHomeObs(); _liteHomeOpening = false; return; }
        if (_clickLiteOrLP()) _stopLiteHomeObs();
      });
      _liteHomeObs.observe(document.body || document.documentElement,
        { childList: true, subtree: true });
    }
    _trySelectLiteHome(18); // up to 18 retries × 350ms = ~6 seconds
  }

  // ── Auto-select Lite for non-Ultra on ANY Flow page ────────────────────────
  var _liteSelectDone = false;
  var _liteSelectObs  = null;

  function _isLiteSelected() {
    var btns = document.querySelectorAll('[role="button"],[role="combobox"],button,select');
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || btns[i].value || '').trim();
      if (t.length > 2 && t.length < 80 && /veo.*lite/i.test(t) && !/lower.*priority/i.test(t))
        return true;
    }
    return false;
  }

  function _clickLiteOnly() {
    var opts = document.querySelectorAll('[role="option"],[role="menuitem"],li,[tabindex="0"],[tabindex="-1"]');
    for (var i = 0; i < opts.length; i++) {
      var t = (opts[i].textContent || '').trim();
      if (t.length < 3 || t.length > 150) continue;
      var r = opts[i].getBoundingClientRect();
      if (r.width < 2 && r.height < 2) continue;
      if (/veo.*lite/i.test(t) && !/lower.*priority/i.test(t)) {
        try {
          opts[i].dispatchEvent(new MouseEvent('mouseover',  { bubbles: true }));
          opts[i].dispatchEvent(new MouseEvent('mousedown',  { bubbles: true, cancelable: true }));
          opts[i].dispatchEvent(new MouseEvent('mouseup',    { bubbles: true, cancelable: true }));
          opts[i].dispatchEvent(new MouseEvent('click',      { bubbles: true, cancelable: true }));
          opts[i].click();
        } catch(e) {}
        return true;
      }
    }
    return false;
  }

  function _openModelDropdownAny() {
    // Works on home + project pages — finds the current model selector button
    var btns = document.querySelectorAll('[role="button"],[role="combobox"],button');
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || '').trim();
      if (t.length < 3 || t.length > 120) continue;
      if (!/veo|fast|quality|standard/i.test(t)) continue;
      if (/veo.*lite/i.test(t) && !/lower.*priority/i.test(t)) continue; // already Lite
      var r = btns[i].getBoundingClientRect();
      if (r.width < 10 || r.height < 6) continue;
      try { btns[i].click(); } catch(e) {}
      return true;
    }
    return false;
  }

  function _trySelectLiteAny(retries) {
    if (isUltra()) return; // Ultra: let user pick any model
    if (_isLiteSelected()) { _liteSelectDone = true; _stopLiteSelectObs(); return; }
    if (_clickLiteOnly()) { _stopLiteSelectObs(); return; }
    if (retries <= 0) { _stopLiteSelectObs(); return; }
    _openModelDropdownAny();
    setTimeout(function() { _trySelectLiteAny(retries - 1); }, 300);
  }

  function _stopLiteSelectObs() {
    if (_liteSelectObs) { _liteSelectObs.disconnect(); _liteSelectObs = null; }
  }

  function autoSelectLiteForNonUltra() {
    if (isUltra()) return;
    if (_liteSelectDone) return; // ran once — user is free to change model now
    if (_isLiteSelected()) { _liteSelectDone = true; return; } // already Lite, mark done
    // First visit: start observer + retry loop to set Lite once
    if (!_liteSelectObs) {
      _liteSelectObs = new MutationObserver(function() {
        if (isUltra()) { _stopLiteSelectObs(); return; }
        if (_clickLiteOnly()) { _liteSelectDone = true; _stopLiteSelectObs(); }
      });
      _liteSelectObs.observe(document.body || document.documentElement,
        { childList: true, subtree: true });
    }
    _trySelectLiteAny(12); // up to 12 retries × 300ms = ~3.6s
  }


  // ── 4K UNLOCK FOR ULTRA PLAN ─────────────────────────────────────────────
  // content.js (locked) calls lock4kUpscale() every 100 ms and injects
  // #__flow_4k_block__ CSS that hides the 4K/50x Upscale option for everyone.
  // For BunnyFlow Ultra users we counter it at 80 ms (inside run()) by:
  //   1. Removing the #__flow_4k_block__ <style> element
  //   2. Stripping .flow-custom-lock-parent class from 4K option elements
  //   3. Removing .flow-custom-lock overlay children inside those elements
  function unlock4kForUltra() {
    if (!isUltra()) return;

    // Step 1 — kill the injected CSS block
    var styleBlock = document.getElementById('__flow_4k_block__');
    if (styleBlock) styleBlock.remove();

    // Step 2 & 3 — find every element that carries the lock class
    // and check whether it is the 4K/Upscale option; if so, free it.
    var locked = document.querySelectorAll('.flow-custom-lock-parent');
    locked.forEach(function(el) {
      var txt = (el.textContent || '').toLowerCase();
      // Match: contains "4k" AND ("50" or "upscal") — same heuristic as lock4kUpscale()
      if (txt.indexOf('4k') !== -1 && (txt.indexOf('50') !== -1 || txt.indexOf('upscal') !== -1)) {
        el.classList.remove('flow-custom-lock-parent');
        el.removeAttribute('data-bf-4k-lock');
        el.style.opacity = '';
        el.style.pointerEvents = '';
        el.style.cursor = '';
        // Remove the semi-transparent overlay div content.js injected
        el.querySelectorAll('.flow-custom-lock, .bf-ov, .bf-lk').forEach(function(ov) {
          ov.remove();
        });
      }
    });

    // Step 4 — also directly find 4K option elements and make sure they're clickable
    var allOpts = document.querySelectorAll(
      '[role="option"],[role="menuitem"],[role="menuitemradio"],[role="checkbox"],[role="switch"],li[class],button,label'
    );
    allOpts.forEach(function(el) {
      var txt = (el.textContent || '').toLowerCase();
      if (txt.indexOf('4k') !== -1 && (txt.indexOf('50') !== -1 || txt.indexOf('upscal') !== -1)) {
        el.classList.remove('flow-custom-lock-parent');
        el.removeAttribute('data-bf-4k-lock');
        el.style.opacity = '';
        el.style.pointerEvents = '';
        el.style.cursor = '';
        el.querySelectorAll('.flow-custom-lock, .bf-ov, .bf-lk').forEach(function(ov) {
          ov.remove();
        });
      }
    });
  }



  // ── LOCKED ITEM TOAST NOTIFICATION ──────────────────────────────────────
  var _bfToastTimer = null;
  function showBfToast(msg, sub) {
    var t = document.getElementById('__bf_toast__');
    if (!t) {
      t = document.createElement('div');
      t.id = '__bf_toast__';
      t.style.cssText = 'position:fixed!important;top:14px!important;left:50%!important;' +
        'transform:translateX(-50%)!important;z-index:2147483647!important;' +
        'padding:8px 14px 8px 14px!important;border-radius:8px!important;' +
        'font-family:system-ui,sans-serif!important;font-size:12px!important;' +
        'font-weight:600!important;color:#fff!important;display:flex!important;' +
        'align-items:center!important;gap:8px!important;' +
        'box-shadow:0 4px 16px rgba(0,0,0,0.5)!important;' +
        'background:linear-gradient(135deg,#7c3aed,#4f46e5)!important;' +
        'pointer-events:auto!important;transition:opacity 0.25s!important;';
      document.documentElement.appendChild(t);
    }
    // Build DOM nodes — avoids inline onclick quote-escaping bugs
    while (t.firstChild) t.removeChild(t.firstChild);
    var msgSpan = document.createElement('span');
    msgSpan.style.flex = '1';
    msgSpan.textContent = msg;
    if (sub) {
      var subSpan = document.createElement('span');
      subSpan.style.cssText = 'font-weight:400;opacity:0.8';
      subSpan.textContent = ' — ' + sub;
      msgSpan.appendChild(subSpan);
    }
    var xBtn = document.createElement('span');
    xBtn.style.cssText = 'cursor:pointer;opacity:0.65;font-size:13px;flex-shrink:0;padding:0 3px';
    xBtn.textContent = '\u2715';
    xBtn.addEventListener('click', function() { t.style.opacity = '0'; });
    t.appendChild(msgSpan);
    t.appendChild(xBtn);
        t.style.opacity = '1';
    if (_bfToastTimer) clearTimeout(_bfToastTimer);
    _bfToastTimer = setTimeout(function() { t.style.opacity = '0'; }, 3000);
  }

  // ── FAST LOCK (1ms interval — same approach as competitor) ───────────────
  // Lightweight, single-pass: lock Fast/Quality, ensure Lite/LP stay clickable.
  // Heavy ops (badge removal, event listeners) stay in lockModels() @ 80ms.
  function lockFast() {
    if (isUltra()) {
      unlock4kForUltra();
      return;
    }
    document.querySelectorAll(OPT_SEL).forEach(function(el) {
      var txt = (el.textContent || '').trim();
      if (!txt || txt.length > 120) return;

      // Free/LP → ensure always clickable
      if (LP_RE.test(txt) || FREE_RE.test(txt)) {
        if (el.dataset.bfLocked === '1') {
          delete el.dataset.bfLocked;
          el.style.setProperty('pointer-events', 'auto',    'important');
          el.style.setProperty('opacity',        '1',       'important');
          el.style.setProperty('cursor',         'pointer', 'important');
        }
        return;
      }

      // Fast / Quality → instant lock
      if (!LOCK_RE.test(txt)) return;
      if (el.dataset.bfLocked === '1') return; // already locked, skip style-set
      el.dataset.bfLocked = '1';
      el.style.setProperty('opacity',        '0.35',        'important');
      el.style.setProperty('pointer-events', 'none',        'important');
      el.style.setProperty('cursor',         'not-allowed', 'important');
    });
  }

  function run() {
    injectCSS();
    lockModels();
    unlockFreeModels();
    unlock4kForUltra();
    hideVideos();
    autoSelectLP();
    autoSetVeoLiteOnNewProject();
    autoSelectLiteForNonUltra();
    hookSendButton();
    watchGenerations();
    hideErrorMessages();
    enforceLPModel();
  }


  run();

  // ── FAST COOKIE INJECTION TRIGGER ────────────────────────────────────────
  // On page load, tell background.js to inject cookies ASAP instead of
  // waiting for the 60s pollCookieVersion interval.
  (function() {
    function _triggerInject() {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
          chrome.runtime.sendMessage({ type: 'INJECT_NOW' },             function() {});
          chrome.runtime.sendMessage({ type: 'BUNNYFLOW_INJECT_COOKIES' }, function() {});
          chrome.runtime.sendMessage({ type: 'BF_SYNC_NOW' },            function() {});
        }
      } catch(e) {}
    }
    // Fire immediately + at 3s + at 8s (covers slow page loads)
    _triggerInject();
    setTimeout(_triggerInject, 3000);
    setTimeout(_triggerInject, 8000);
  })();

  if (document.readyState !== 'complete') {
    document.addEventListener('DOMContentLoaded', run);
    window.addEventListener('load', run);
  }

  // Aggressive LP selection on initial page load: try multiple times after load
  // to handle slow-rendering UI components
  [500, 1000, 1500, 2500, 4000].forEach(function(t) {
    setTimeout(function() {
      if (!_lpDone && !isHome()) {
        if (!_lpOpening) autoSelectLP();
      }
    }, t);
  });


  // ── LAYER 3: Document-level capture block — only blocks dropdown ITEMS ─────
  // Blocks clicks on locked model DROPDOWN ITEMS only (not the opener button).
  // Opener button (role=button/combobox, aria-haspopup) is always let through.
  (function() {
    var BLOCK_EVS = ['click','mousedown','pointerdown','touchstart'];

    function _isDropdownItem(el) {
      // Returns true if el is a dropdown list item (not the trigger button)
      var role = el.getAttribute ? (el.getAttribute('role') || '') : '';
      if (role === 'option' || role === 'menuitem' || role === 'listitem') return true;
      if (el.tagName === 'LI') return true;
      // Check parent — listbox/menu parent means we're inside a dropdown
      var p = el.parentElement;
      if (!p) return false;
      var pr = p.getAttribute ? (p.getAttribute('role') || '') : '';
      return pr === 'listbox' || pr === 'list' || pr === 'menu' || pr === 'group';
    }

    function _isOpenerButton(el) {
      // Returns true if this element (or ancestor within 4 levels) is a trigger
      var cur = el, d = 0;
      while (cur && d++ < 4) {
        var role = cur.getAttribute ? (cur.getAttribute('role') || '') : '';
        if (role === 'button' || role === 'combobox') return true;
        if (cur.tagName === 'BUTTON') return true;
        if (cur.hasAttribute && (cur.hasAttribute('aria-haspopup') ||
            cur.hasAttribute('aria-expanded'))) return true;
        cur = cur.parentElement;
      }
      return false;
    }

    function _blockIfLocked(e) {
      if (isUltra()) return;
      if (_isOpenerButton(e.target)) return;
      var el = e.target;
      var depth = 0;
      while (el && el !== document.documentElement && depth++ < 7) {
        var txt = (el.textContent || '').trim();
        // Check if this element or its immediate children carry a locked model name
        if (txt.length > 2 && txt.length < 100 &&
            LOCK_RE.test(txt) && !LP_RE.test(txt) && !FREE_RE.test(txt)) {
          // Confirm not the opener button at this level
          if (!_isOpenerButton(el)) {
            e.stopImmediatePropagation();
            e.preventDefault();
            showBfToast('This Option Is Locked', 'Upgrade your BunnyFlow plan');
            return;
          }
        }
        el = el.parentElement;
      }
    }
    BLOCK_EVS.forEach(function(ev) {
      document.addEventListener(ev, _blockIfLocked, true);
    });
  })();

  setInterval(lockFast, 1);    // ← 1ms  instant lock (competitor-parity)
  setInterval(run,      80);   // ← 80ms full cycle (badge removal, auto-select, etc.)

  const mo = new MutationObserver(function() { lockFast(); run(); });
  function startObs() { if (document.body) mo.observe(document.body, { childList: true, subtree: true }); }
  if (document.body) startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  // Fire lockFast immediately on any click — catches the instant user opens dropdown
  document.addEventListener('click', function() { lockFast(); }, true);
  document.addEventListener('mousedown', function() { lockFast(); }, true);

  // SPA navigation
  let last = location.href;
  function onNav() {
    if (location.href === last) return;
    last = location.href;
    // Reset LP auto-select for new page
    lpSwitchPending  = false;
    _lpDone          = false;
    _lpOpening       = false;
    _liteHomeDone    = false;
    _liteHomeOpening = false;
    _stopLiteHomeObs();
    _liteSelectDone  = false;
    _stopLiteSelectObs();
    _genBaseVideo = -1;
    _genLastUrl   = '';
    _progSeen     = 0;
    _progPolls    = 0;
    _currGenId    = null;
    document.querySelectorAll('[data-bf-tried-auto-lp],[data-bf-auto-lp],[data-bf-send-hooked]').forEach(el => {
      delete el.dataset.bfTriedAutoLP;
      delete el.dataset.bfAutoLp;
      delete el.dataset.bfSendHooked;
    });
    document.querySelectorAll('[data-bf-seen]').forEach(el => {
      delete el.dataset.bfSeen;
      el.removeAttribute('data-bf-hide');
      el.removeAttribute('data-bf-ban');
    });
    run();
    [100, 300, 600, 1200].forEach(t => setTimeout(run, t));
  }
  window.addEventListener('popstate', onNav);
  window.addEventListener('hashchange', onNav);
  ['pushState','replaceState'].forEach(fn => {
    const orig = history[fn];
    history[fn] = function (...a) { orig.apply(this, a); onNav(); };
  });
  setInterval(onNav, 400);

  // ── AUTO-SELECT "Veo 3.1 - Fast [Lower Priority]" on load ─────────────────
  function autoSelectLowerPriority() {
    var allButtons = Array.from(document.querySelectorAll('button, div[role="button"], div[role="listbox"]'));
    var modelTrigger = allButtons.find(function(el) {
      var txt = (el.textContent || '').trim();
      return /veo/i.test(txt) && txt.length < 60;
    });
    if (!modelTrigger) return;
    var currentTxt = (modelTrigger.textContent || '').trim();
    if (/lower.{0,5}priority/i.test(currentTxt)) return; // already set
    // Open dropdown
    modelTrigger.click();
    setTimeout(function() {
      var options = Array.from(document.querySelectorAll(
        '[role="option"], [role="menuitem"], [role="listitem"], li, [tabindex="0"]'
      ));
      var lpOption = options.find(function(el) {
        return /lower.{0,5}priority/i.test(el.textContent || '');
      });
      if (lpOption) {
        lpOption.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        lpOption.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
        lpOption.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
        lpOption.click();
      } else {
        document.body.click(); // close dropdown if LP not found
      }
    }, 300);
  }

  var _autoSelInterval = setInterval(function() {
    var allEls = Array.from(document.querySelectorAll('button, div[role="button"]'));
    var activeModel = allEls.find(function(el) {
      var txt = (el.textContent || '').trim();
      return /veo/i.test(txt) && txt.length < 60;
    });
    if (activeModel && /lower.{0,5}priority/i.test(activeModel.textContent || '')) {
      clearInterval(_autoSelInterval);
      return;
    }
    autoSelectLowerPriority();
  }, 500);
  setTimeout(function() { clearInterval(_autoSelInterval); }, 30000);

  // ── DAYS-LEFT BADGE (replaces content.js "Flow Active — credits" toast) ───
  var _daysBadge = null;

  function showDaysBadge(days) {
    if (!document.body) return;
    if (!_daysBadge) {
      _daysBadge = document.createElement('div');
      _daysBadge.id = '__bf_days_badge__';
      _daysBadge.style.cssText = [
        'position:fixed', 'bottom:18px', 'right:18px',
        'background:rgba(12,12,12,0.96)', 'color:#fff',
        'border-radius:8px', 'padding:7px 14px',
        'font-size:13px', 'font-family:sans-serif',
        'z-index:2147483640', 'pointer-events:none',
        'display:flex', 'align-items:center', 'gap:6px',
        'opacity:1', 'transition:opacity 0.3s'
      ].join(';');
      document.body.appendChild(_daysBadge);
    }
    var dot = '<span style="width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;flex-shrink:0"></span>';
    _daysBadge.innerHTML = dot + '<span>' + days + ' day' + (days === 1 ? '' : 's') + ' left</span>';
    _daysBadge.style.display = 'flex';
    // Auto-hide after 4 seconds
    clearTimeout(_daysBadge._hideTimer);
    _daysBadge._hideTimer = setTimeout(function() {
      if (_daysBadge) _daysBadge.style.opacity = '0';
    }, 4000);
  }

  function hideCreditsToast(el) {
    // Hide content.js showStatus indicator (fixed div with credits/Flow Active text)
    if (el && el.style && el.style.position === 'fixed' &&
        el.style.bottom === '18px' && el.style.right === '18px' &&
        el.id !== '__bf_days_badge__') {
      var txt = el.textContent || '';
      if (txt.indexOf('credits') !== -1 || txt.indexOf('Flow Active') !== -1 ||
          txt.indexOf('saved') !== -1) {
        el.style.display = 'none';
        el.style.visibility = 'hidden';
      }
    }
  }

  // Watch for content.js toast appearing
  var _toastObs = new MutationObserver(function(muts) {
    muts.forEach(function(m) {
      m.addedNodes.forEach(function(n) {
        if (n.nodeType === 1) hideCreditsToast(n);
      });
    });
    // Also scan existing
    if (document.body) {
      document.body.querySelectorAll('div[style*="fixed"]').forEach(hideCreditsToast);
    }
  });

  function startToastWatch() {
    if (document.body) {
      _toastObs.observe(document.body, { childList: true });
      // Hide any already-existing toasts
      document.body.querySelectorAll('div').forEach(hideCreditsToast);
    }
  }
  if (document.body) startToastWatch();
  else document.addEventListener('DOMContentLoaded', startToastWatch);

  // Show days badge on load from storage
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(null, function(res) {
      var days = null;
      if (res.daysRemaining != null) days = Math.max(0, parseInt(res.daysRemaining) || 0);
      else if (res.planExpiresAt) {
        var ms = new Date(res.planExpiresAt).getTime() - Date.now();
        days = Math.max(0, Math.ceil(ms / 86400000));
      }
      if (days !== null) showDaysBadge(days);
    });
    chrome.storage.onChanged.addListener(function(changes) {
      var days = null;
      if (changes.daysRemaining) days = Math.max(0, parseInt(changes.daysRemaining.newValue) || 0);
      else if (changes.planExpiresAt) {
        var ms = new Date(changes.planExpiresAt.newValue).getTime() - Date.now();
        days = Math.max(0, Math.ceil(ms / 86400000));
      }
      if (days !== null) showDaysBadge(days);
    });
  }

  // ── MY PROJECTS SAVER ───────────────────────────────────────────────────
  // Saves user's project URLs locally so they can find them later
  // even though project cards are hidden from the home page.
  // Auto-deletes entries older than 24 hours.

  var BF_PROJECTS_KEY = '__bf_my_projects__';
  var BF_PROJECTS_TTL = 86400000;
  var _bfLastUrl = '';

  function bfLoadProjects() {
    try {
      var raw = localStorage.getItem(BF_PROJECTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch(e) { return []; }
  }

  function bfSaveProjects(projects) {
    try { localStorage.setItem(BF_PROJECTS_KEY, JSON.stringify(projects)); } catch(e) {}
  }

  function bfCleanExpired(projects) {
    var now = Date.now();
    return projects.filter(function(p) { return now - p.t < BF_PROJECTS_TTL; });
  }

  function bfCaptureProject() {
    try {
      if (isHome()) return;
      var m = location.pathname.match(/\/project\/([^/]+)/);
      if (!m) return;
      var pid = m[1];
      var title = '';
      try {
        var h1 = document.querySelector('h1');
        if (h1) title = (h1.textContent || '').trim();
        if (!title) {
          var inp = document.querySelector('input[placeholder*="project" i],input[placeholder*="title" i]');
          if (inp) title = inp.value.trim();
        }
      } catch(e) {}
      if (!title || title.length > 200) title = 'Project ' + pid;
      var url = location.href;

      var projects = bfLoadProjects();
      projects = bfCleanExpired(projects);

      if (!projects.some(function(p) { return p.u === url; })) {
        projects.push({ id: pid, t: Date.now(), u: url, n: title });
        bfSaveProjects(projects);
      }
    } catch(e) {}
  }

  function bfShowMyProjects() {
    try {
      if (!isHome()) return;
      if (!document.body) { setTimeout(bfShowMyProjects, 300); return; }

      var projects = bfLoadProjects();
      projects = bfCleanExpired(projects);
      bfSaveProjects(projects);

      var wrap = document.getElementById('__bf_my_projects__');

      // Update existing button count or hide if empty
      if (wrap) {
        if (projects.length === 0) { wrap.style.display = 'none'; return; }
        wrap.style.display = '';
        var existingBtn = wrap.querySelector('button');
        if (existingBtn) existingBtn.textContent = '\uD83D\uDCC1 ' + projects.length;
        return;
      }

      if (projects.length === 0) return;

      wrap = document.createElement('div');
      wrap.id = '__bf_my_projects__';
      wrap.style.cssText = 'position:fixed!important;bottom:68px!important;right:12px!important;z-index:2147483647!important;font-family:system-ui,sans-serif!important;';

      var btn = document.createElement('button');
      btn.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width="1.5" style="width:18px;height:18px"><path d="M2 4.5A1.5 1.5 0 013.5 3h3.88a1.5 1.5 0 011.06.44l.88.88a1.5 1.5 0 001.06.44H16.5A1.5 1.5 0 0118 6.26V7H3.5A1.5 1.5 0 012 5.5v-1zM2 7v8.5A1.5 1.5 0 003.5 17h13a1.5 1.5 0 001.5-1.5V9.5a1.5 1.5 0 00-1.5-1.5H3.5A1.5 1.5 0 012 9.5V7z"/></svg><span style="margin-left:4px;font-size:13px;font-weight:600">' + projects.length + '</span>';
      btn.style.cssText = 'background:linear-gradient(135deg,#7c3aed,#4f46e5)!important;color:#fff!important;border:none!important;border-radius:50%!important;width:44px!important;height:44px!important;font-size:15px!important;font-weight:600!important;cursor:pointer!important;box-shadow:0 4px 16px rgba(0,0,0,0.5)!important;display:flex!important;align-items:center!important;justify-content:center!important;';

      var panel = document.createElement('div');
      panel.style.cssText = 'display:none!important;position:absolute!important;bottom:100%!important;right:0!important;left:auto!important;margin-bottom:8px!important;background:#13132a!important;border:1px solid rgba(255,255,255,0.1)!important;border-radius:12px!important;padding:12px!important;min-width:200px!important;width:300px!important;max-width:calc(100vw - 32px)!important;max-height:calc(100vh - 140px)!important;overflow-y:auto!important;box-shadow:0 8px 32px rgba(0,0,0,0.6)!important;';

      var hdr = document.createElement('div');
      hdr.textContent = 'My Projects';
      hdr.style.cssText = 'font-size:13px!important;font-weight:700!important;color:#fff!important;margin-bottom:6px!important;padding-bottom:8px!important;border-bottom:1px solid rgba(255,255,255,0.08)!important;display:flex!important;align-items:center!important;justify-content:space-between!important;';

      var clearBtn = document.createElement('span');
      clearBtn.textContent = 'clear all';
      clearBtn.style.cssText = 'font-size:10px!important;color:#ef4444!important;cursor:pointer!important;font-weight:500!important;';
      clearBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        try { localStorage.removeItem(BF_PROJECTS_KEY); } catch(e) {}
        wrap.style.display = 'none';
      });
      hdr.appendChild(clearBtn);
      panel.appendChild(hdr);

      var sorted = projects.slice().sort(function(a, b) { return b.t - a.t; });
      sorted.forEach(function(p) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex!important;align-items:center!important;justify-content:space-between!important;padding:7px 10px!important;border-radius:8px!important;cursor:pointer!important;transition:background 0.15s!important;margin-bottom:1px!important;';
        row.addEventListener('mouseenter', function() { row.style.background = 'rgba(255,255,255,0.06)'; });
        row.addEventListener('mouseleave', function() { row.style.background = ''; });
        row.addEventListener('click', function() { window.top.location.href = p.u; });

        var nameSpan = document.createElement('span');
        nameSpan.textContent = p.n || 'Project';
        nameSpan.style.cssText = 'font-size:12px!important;color:#e0e0ff!important;flex:1!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;';

        var timeSpan = document.createElement('span');
        var hours = Math.round((Date.now() - p.t) / 3600000);
        timeSpan.textContent = hours < 1 ? 'now' : hours + 'h';
        timeSpan.style.cssText = 'font-size:10px!important;color:#6b7390!important;margin-left:8px!important;flex-shrink:0!important;';

        row.appendChild(nameSpan);
        row.appendChild(timeSpan);
        panel.appendChild(row);
      });

      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      });

      document.addEventListener('click', function closeProjectPanel() {
        panel.style.display = 'none';
        document.removeEventListener('click', closeProjectPanel, true);
      }, true);

      wrap.appendChild(btn);
      wrap.appendChild(panel);
      document.body.appendChild(wrap);
    } catch(e) {}
  }

  // Hook into SPA navigation — wraps the existing onNav
  var _origOnNav = onNav;
  onNav = function() {
    _origOnNav();
    bfCaptureProject();
    bfShowMyProjects();
  };

  // Periodic check — the setInterval(onNav, 400) captured the old reference,
  // so we need our own interval to catch SPA navigations
  setInterval(function() {
    if (location.href !== _bfLastUrl) {
      _bfLastUrl = location.href;
      bfCaptureProject();
    }
    bfShowMyProjects();
  }, 800);

  // Initial run
  _bfLastUrl = location.href;
  bfCaptureProject();
  bfShowMyProjects();

})();