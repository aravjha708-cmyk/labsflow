/* ── BunnyFlow Model Hider + Auto-LP + Multiplier v3.0 ──────────────────────
   MAIN world, document_start, labs.google/fx/tools/flow*

   Features:
     1. Model hiding  — dropdown: only LP visible, rest hidden (all plans)
     2. Auto-LP       — on page load, auto-switch to "Veo 3.1 - Lite [Lower Priority]"
     3. Multipliers   — .flow_tab_slider_trigger elements:
                        Free/Basic : x1 only (hide x2, x3, x4)
                        Pro        : x1, x2  (hide x3, x4)
                        Ultra      : x1, x2, x3 (hide x4)
                        x4         : always hidden for everyone

   Plan is read from data-bf-plan on <html> (set by bunny_extra.js as full plan string).
   ─────────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // ── CSS injection ─────────────────────────────────────────────────────────
  var CSS_ID = '__bf_mh3__';
  function _injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = '[data-bf-mh-hide]{display:none!important;}';
    (document.head || document.documentElement).appendChild(s);
  }
  _injectCSS();
  new MutationObserver(_injectCSS).observe(document.documentElement, { childList: true });

  // ── Plan helpers ──────────────────────────────────────────────────────────
  function _getPlan() {
    return (document.documentElement.getAttribute('data-bf-plan') || 'basic').toLowerCase();
  }
  function _isPro()   { var p = _getPlan(); return p === 'pro' || p === 'ultra'; }
  function _isUltra() { return _getPlan() === 'ultra'; }

  // ── Patterns ──────────────────────────────────────────────────────────────
  var LP_RE    = /lower[\s._-]*priority/i;
  var MODEL_RE = /\bveo\b|\bomni\b|\bflash\b/i;
  var DROP_SEL =
    '[role="listbox"],[role="menu"],[role="presentation"],' +
    '[data-radix-popper-content-wrapper],[data-state="open"],' +
    '[class*="dropdown"],[class*="Dropdown"],' +
    '[class*="popover"],[class*="Popover"],' +
    '[class*="menu"],[class*="Menu"],' +
    '[class*="listbox"],[class*="Listbox"]';
  var SKIP_TAGS = { IMG:1, VIDEO:1, PICTURE:1, SOURCE:1, CANVAS:1, SVG:1, SCRIPT:1, STYLE:1, PATH:1 };

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _skipTag(el) { return !!(el && SKIP_TAGS[(el.tagName||'').toUpperCase()]); }

  function _ownText(el) {
    var t = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) t += el.childNodes[i].textContent;
    }
    return t.replace(/\s+/g,' ').trim();
  }

  function _insideDrop(el) {
    try { return !!(el.closest && el.closest(DROP_SEL)); } catch(_) { return false; }
  }

  // ── ① MODEL OPTION HIDING ─────────────────────────────────────────────────
  // Only hides elements inside dropdown containers → video cards never touched
  function _evalModelEl(el) {
    if (!el || el.nodeType !== 1) return;
    if (_skipTag(el)) return;
    if (el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-expanded')) return;

    var txt = _ownText(el);
    if (!txt || !MODEL_RE.test(txt)) {
      var al = (el.getAttribute('aria-label') || '').trim();
      if (al.length > 0 && al.length < 100 && MODEL_RE.test(al)) txt = al;
      else return;
    }
    if (txt.length > 100) return;
    if (!_insideDrop(el)) return; // safety gate

    var wrap = null;
    try { wrap = el.closest('[role="option"],[role="menuitem"],li') || el; } catch(_) { wrap = el; }
    if (!wrap || wrap.hasAttribute('aria-haspopup') || wrap.hasAttribute('aria-expanded')) wrap = el;

    if (LP_RE.test(txt)) {
      wrap.removeAttribute('data-bf-mh-hide');
      el.removeAttribute('data-bf-mh-hide');
    } else {
      wrap.setAttribute('data-bf-mh-hide', '1');
    }
  }

  function _scanSubtree(root) {
    _evalModelEl(root);
    if (root.querySelectorAll) {
      root.querySelectorAll('li,[role="option"],[role="menuitem"],div,span,button,a,p')
        .forEach(_evalModelEl);
    }
  }

  function _rescanDropdowns() {
    try {
      document.querySelectorAll(DROP_SEL).forEach(function(c) { _scanSubtree(c); });
    } catch(_) {}
  }

  // ── ② AUTO-LP SELECTION on page load ─────────────────────────────────────
  // Uses Tool Wallet's proven approach:
  //   button[aria-haspopup="menu"] → find current model text
  //   if not LP → click trigger → wait → click LP li element
  var _lpDone = false;
  var _lpAttempts = 0;
  var _lpMax = 20;

  function _isLPSelected() {
    var btns = document.querySelectorAll('button[aria-haspopup="menu"],button[aria-haspopup="listbox"],[role="combobox"]');
    for (var i = 0; i < btns.length; i++) {
      var txt = (btns[i].textContent || '').trim();
      if (txt.length < 3 || txt.length > 150) continue;
      if (!MODEL_RE.test(txt)) continue;
      var r = btns[i].getBoundingClientRect();
      if (r.width < 10) continue;
      // This is the model trigger — check if LP is active
      return LP_RE.test(txt);
    }
    return false; // no model UI found yet
  }

  function _findModelTrigger() {
    var btns = document.querySelectorAll('button[aria-haspopup="menu"],button[aria-haspopup="listbox"],[role="combobox"]');
    for (var i = 0; i < btns.length; i++) {
      var txt = (btns[i].textContent || '').trim();
      if (txt.length < 3 || txt.length > 150) continue;
      if (!MODEL_RE.test(txt) && !/veo.*lite|lower.*priority/i.test(txt)) continue;
      var r = btns[i].getBoundingClientRect();
      if (r.width < 10) continue;
      return btns[i];
    }
    return null;
  }

  function _findLPOption() {
    var opts = document.querySelectorAll('[role="option"],[role="menuitem"],li,[tabindex="0"],[tabindex="-1"]');
    for (var i = 0; i < opts.length; i++) {
      var txt = (opts[i].textContent || '').trim();
      if (!LP_RE.test(txt)) continue;
      var r = opts[i].getBoundingClientRect();
      if (r.width < 2 && r.height < 2) continue;
      return opts[i];
    }
    return null;
  }

  function _clickLP(opt) {
    try {
      opt.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, cancelable:true }));
      opt.dispatchEvent(new PointerEvent('pointerup',   { bubbles:true, cancelable:true }));
      opt.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true }));
      opt.dispatchEvent(new MouseEvent('mouseup',   { bubbles:true, cancelable:true }));
      opt.dispatchEvent(new MouseEvent('click',     { bubbles:true, cancelable:true }));
      opt.click();
    } catch(_) {}
  }

  function _tryAutoLP() {
    if (_lpDone || _lpAttempts >= _lpMax) return;
    _lpAttempts++;

    if (_isLPSelected()) { _lpDone = true; return; }

    // Try to click LP option if dropdown is already open
    var lpOpt = _findLPOption();
    if (lpOpt) {
      _clickLP(lpOpt);
      setTimeout(function() {
        if (_isLPSelected()) _lpDone = true;
      }, 400);
      return;
    }

    // Dropdown not open — open the trigger
    var trigger = _findModelTrigger();
    if (trigger) {
      try { 
        trigger.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
        trigger.dispatchEvent(new PointerEvent('pointerup', {bubbles:true}));
        trigger.click(); 
      } catch(_) {}
      
      // Wait for React to render dropdown and click LP
      var attempts = 0;
      var iv = setInterval(function() {
        attempts++;
        var opt2 = _findLPOption();
        if (opt2) {
          clearInterval(iv);
          _clickLP(opt2);
          setTimeout(function() {
            if (_isLPSelected()) _lpDone = true;
          }, 300);
        } else if (attempts > 12) {
          clearInterval(iv);
          try { document.body.click(); } catch(_) {}
        }
      }, 50);
    }
  }

  // Start auto-LP loop: try every 800ms until done or max attempts reached
  function _startAutoLP() {
    _tryAutoLP();
    var iv = setInterval(function() {
      if (_lpDone || _lpAttempts >= _lpMax) { clearInterval(iv); return; }
      _tryAutoLP();
    }, 800);
  }

  if (document.body) _startAutoLP();
  else document.addEventListener('DOMContentLoaded', _startAutoLP);

  // ── ③ MULTIPLIER HIDING (.flow_tab_slider_trigger) ───────────────────────
  // Free/Basic : hide x2, x3, x4
  // Pro        : hide x3, x4
  // Ultra      : hide x4
  // x4         : always hidden

  function _applyMultipliers() {
    try {
      var plan = _getPlan(); // 'basic','free','pro','ultra'
      var tabs = document.querySelectorAll('.flow_tab_slider_trigger');
      tabs.forEach(function(tab) {
        var txt = (tab.textContent || '').trim().toLowerCase();
        var hide = false;
        if (txt === 'x2') hide = (plan !== 'pro' && plan !== 'ultra');
        else if (txt === 'x3') hide = (plan !== 'ultra');
        else if (txt === 'x4') hide = true; // always hidden
        tab.style.setProperty('display', hide ? 'none' : '', 'important');
        // Auto-switch if hidden tab is selected
        if (hide && tab.getAttribute('data-state') === 'active') {
          var x1 = _findMultTab('x1');
          if (x1) try { x1.click(); } catch(_) {}
        }
      });
    } catch(_) {}
  }

  function _findMultTab(label) {
    var found = null;
    document.querySelectorAll('.flow_tab_slider_trigger').forEach(function(t) {
      if ((t.textContent || '').trim().toLowerCase() === label) found = t;
    });
    return found;
  }

  // ── MutationObserver — model hiding + multiplier re-apply ─────────────────
  var _mo = new MutationObserver(function(mutations) {
    var doMult = false;
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n.nodeType === 1) {
          _scanSubtree(n);           // model dropdown hiding
          if (String(n.className || '').indexOf('flow_tab_slider_trigger') !== -1) doMult = true;
          if (n.querySelectorAll && n.querySelectorAll('.flow_tab_slider_trigger').length) doMult = true;
        }
      }
    }
    if (doMult) _applyMultipliers();
  });

  function _startObs() {
    _mo.observe(document.documentElement, { childList:true, subtree:true });
    // Initial scan of existing multipliers
    _applyMultipliers();
  }
  if (document.documentElement) _startObs();
  else document.addEventListener('DOMContentLoaded', _startObs);

  // ── Trigger-click handler: re-scan dropdowns + multipliers ────────────────
  document.addEventListener('click', function(e) {
    try {
      var cur = e.target;
      for (var i = 0; i < 8 && cur && cur !== document.body; i++) {
        if (cur.hasAttribute && (cur.hasAttribute('aria-haspopup') || cur.hasAttribute('aria-expanded'))) {
          var txt = (cur.textContent || '').replace(/\s+/g,' ').trim();
          if (txt.length < 200 && (MODEL_RE.test(txt) || LP_RE.test(txt))) {
            setTimeout(_rescanDropdowns, 80);
            setTimeout(_rescanDropdowns, 250);
            setTimeout(_rescanDropdowns, 500);
          }
          break;
        }
        cur = cur.parentElement;
      }
      // Any click: re-check multipliers (plan might have loaded by now)
      _applyMultipliers();
    } catch(_) {}
  }, true);

  // ── Periodic multiplier re-apply (catches React re-renders) ─────────────
  var _multCheck = setInterval(function() {
    _applyMultipliers();
  }, 2000);

  // Stop periodic check after 2 minutes (page fully loaded by then)
  setTimeout(function() { clearInterval(_multCheck); }, 120000);

  // ── SPA navigation ────────────────────────────────────────────────────────
  try {
    var _origPush = history.pushState;
    history.pushState = function() {
      _origPush.apply(this, arguments);
      _lpDone = false; _lpAttempts = 0;
      setTimeout(_startAutoLP, 500);
      setTimeout(_applyMultipliers, 500);
    };
  } catch(_) {}

})();
