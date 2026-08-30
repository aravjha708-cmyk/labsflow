(function(){
  'use strict';

  // ── 1. CSS ────────────────────────────────────────────────────────────────
  const CSS = `
    [data-bf-hide]{display:none!important;visibility:hidden!important;}
    [data-bf-ban] {display:none!important;}
    [data-bf-locked]{opacity:0.35!important;}
    [data-bf-unlocked]{opacity:1!important;pointer-events:auto!important;cursor:pointer!important;}
    .bf-ov{position:absolute!important;inset:0!important;z-index:2147483647!important;cursor:not-allowed!important;background:transparent!important;}
    .bf-lk{position:absolute!important;right:8px!important;top:50%!important;transform:translateY(-50%)!important;font-size:11px!important;z-index:2147483647!important;pointer-events:none!important;}
  `;
  function inject(){
    if(document.getElementById('__bf__')) return;
    const s=document.createElement('style');
    s.id='__bf__';s.textContent=CSS;
    (document.head||document.documentElement).appendChild(s);
  }
  inject();
  new MutationObserver(inject).observe(document.documentElement,{childList:true});

  // ── 2. CLICK INTERCEPT — block clicks on locked model OPTIONS only ──────────
  // Strategy: use capture-phase document click listener instead of blocking
  // addEventListener registration (which would also block the dropdown toggle button).
  //
  // Locked model OPTIONS are inside a dropdown list and have role=option/menuitem/listitem.
  // The dropdown TOGGLE button (showing current model name) must NOT be blocked so we
  // can programmatically open the dropdown.
  const _LP_RE   = /lower.{0,5}priority/i;
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
  _blockEvents.forEach(function(evName) {
    document.addEventListener(evName, function(e) {
      // Model selection lock REMOVED per user request
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

  var _bfSendBtn  = null;  // cached send button reference
  var _bfLocked   = false; // current lock state

  // Detect whether the active video model is non-LP (returns true = should lock)
  // IMPORTANT: must skip dropdown list items — only read the combobox/selector element
  function _shouldLockSend() {
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
        if (r.right  < ww * 0.35) continue;
        if (!b.querySelector('svg')) continue;
        var txt = (b.textContent || '').replace(/\s+/g,'');
        if (txt.length > 5) continue; // reject text buttons
        var score = (r.right / ww) * 3 + (r.bottom / wh);
        if (score > bestScore) { bestScore = score; best = b; }
      }
      return best;
    } catch(_) { return null; }
  }

  function _applyBfLock(btn) {
    if (!btn) return;
    btn.style.setProperty('background',        '#ef4444', 'important');
    btn.style.setProperty('background-color',  '#ef4444', 'important');
    btn.style.setProperty('background-image',  'none',    'important');
    btn.style.setProperty('border-color',      '#b91c1c', 'important');
    btn.style.setProperty('cursor',            'not-allowed', 'important');
    btn.style.setProperty('opacity',           '1',       'important');
    btn.setAttribute('data-bf-locked', '1');
    btn.title = _isUltra() ? '❤️ Model restricted' : '❤️ Select Lower Priority model';
  }

  function _removeBfLock(btn) {
    if (!btn) return;
    ['background','background-color','background-image','border-color','cursor','opacity']
      .forEach(function(p) { btn.style.removeProperty(p); });
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
          setTimeout(function() { b2.style.outline = ''; b2.style.borderRadius = ''; }, 1200);
          break;
        }
      }
    } catch(_) {}
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
    } catch(_) {}
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
      try { btns[i].click(); } catch(_) {}
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
        opts[i].dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
        opts[i].dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
        opts[i].click();
      } catch(_) {}
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
      setTimeout(function() {
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
  document.addEventListener('click', function(e) {
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
    } catch(_) {}
  }, true);

  // Block Enter key in prompt area when locked
  document.addEventListener('keydown', function(e) {
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
    } catch(_) {}
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
  var _BF_API  = /labs\.google\/(?:fx\/)?api|labs\.google\/[^?]*\/generate|labs\.google\/[^?]*\/operation|labs\.google\/[^?]*\/project/i;
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
        var totalV = Math.min((text.match(/videoUri|video_uri|generatedVideo/ig)||[]).length, 8);
        if (totalV > _bf_nv) {
          document.dispatchEvent(new CustomEvent('__bf_gen__', { detail: { type: 'video', count: totalV - _bf_nv } }));
          _bf_nv = totalV;
        }
      }
      if (hasI && !hasV) {
        var totalI = Math.min((text.match(/imageUri|image_uri|generatedImage/ig)||[]).length, 8);
        if (totalI > _bf_ni) {
          document.dispatchEvent(new CustomEvent('__bf_gen__', { detail: { type: 'image', count: totalI - _bf_ni } }));
          _bf_ni = totalI;
        }
      }
    } catch(e) {}
  }

  // fetch — only inspect actual Flow API calls, skip ALL media/storage URLs
  // CONCURRENCY THROTTLE: max 2 simultaneous response body reads to prevent
  // freeze on Frames/pic-to-video pages where many concurrent API calls happen
  var _bf_concurrent = 0;
  var _BF_MAX_CONCURRENT = 2;
  // Skip frame/image-upload endpoints that fire many times during pic-to-video
  var _BF_SKIP_FRAMES = /\/frame|\/frames\/|\/image\/upload|\/upload\/image|\/asset\/|uploadType=multipart|uploadType=media|\/media\/upload|\/batch|\/pic.to.vid|\/pic_to_vid/i;

  var _origFetch = window.fetch;
  window.fetch = function(input, init) {
    // BF FETCH FIX: transparent passthrough. Return the ORIGINAL fetch promise so a
    // network failure ("Failed to fetch") keeps Google Flow's native stack and is
    // handled by Flow's own code -- our wrapper never appears as the error source and
    // never creates a new "Uncaught (in promise)" rejection. Inspection is passive.
    var _p = _origFetch.call(this, input, init);
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      // Only inspect calls to Flow generation API endpoints
      if (_BF_API.test(url) && !_BF_SKIP.test(url) && !_BF_SKIP_FRAMES.test(url)) {
        _p.then(function(resp) {
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
            resp.clone().text().then(function(t) {
              _bf_inspect(t);
              _bf_concurrent = Math.max(0, _bf_concurrent - 1);
            }).catch(function() {
              _bf_concurrent = Math.max(0, _bf_concurrent - 1);
            });
          } catch(e) {}
        }, function() { /* swallow on OUR observer only; original _p still rejects for Flow */ });
      }
    } catch(e) {}
    return _p;
  };

  // XHR — only inspect Flow API calls (skip frames/upload endpoints)
  var _xhrMap = new WeakMap();
  var _xhrOpen = XMLHttpRequest.prototype.open;
  var _xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m, url) {
    _xhrMap.set(this, String(url || ''));
    return _xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    var xhr = this, url = _xhrMap.get(xhr) || '';
    if (_BF_API.test(url) && !_BF_SKIP.test(url) && !_BF_SKIP_FRAMES.test(url)) {
      xhr.addEventListener('load', function() {
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
    window.EventSource = function(url, opts) {
      var es = new _OrigES(url, opts);
      var u = String(url || '');
      if (_BF_API.test(u) && !_BF_SKIP.test(u)) {
        ['message','generation','update','result'].forEach(function(ev) {
          es.addEventListener(ev, function(e) { _bf_inspect(e.data || ''); });
        });
      }
      return es;
    };
    Object.setPrototypeOf(window.EventSource, _OrigES);
  }

})();

// ── Disable detection: MAIN-world timer disabled to prevent background tab logout ────
(function() {
  // Timer disabled — background tabs will no longer be forced to log out
})();


// ── Profile Brand Override (CSS Based) ────────────────────────────────────
(function() {
  var style = document.createElement('style');
  style.id = '__flow_brand_override__';
  style.textContent = "img[alt='User profile image'] { content: url('data:image/png;base64,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di5pcHRjLm9yZy9uZXdzY29kZXMvZGlnaXRhbHNvdXJjZXR5cGUvY29tcG9zaXRlV2l0aFRyYWluZWRBbGdvcml0aG1pY01lZGlhAAAAq2p1bWIAAAAoanVtZGNib3IAEQAQgAAAqgA4m3EDYzJwYS5oYXNoLmRhdGEAAAAAe2Nib3KlamV4Y2x1c2lvbnOBomVzdGFydBghZmxlbmd0aBlVFGRuYW1lbmp1bWJmIG1hbmlmZXN0Y2FsZ2ZzaGEyNTZkaGFzaFggFD8MqzWU6jH/5zJVgzFuSaAoyGRcvgqQiZvPdjgw9iFjcGFkSAAAAAAAAAAAAAACRGp1bWIAAAAkanVtZGMyY2wAEQAQgAAAqgA4m3EDYzJwYS5jbGFpbQAAAAIYY2JvcqhvY2xhaW1fZ2VuZXJhdG9ybyBjMnBhLXJzLzAuNDYuMHRjbGFpbV9nZW5lcmF0b3JfaW5mb4Bpc2lnbmF0dXJleE1zZWxmI2p1bWJmPS9jMnBhL3Vybjp1dWlkOmU4ZDhlYzQ4LTM0MDEtNDE1MC1iOGY1LTAwMjk0MGQ0ZjlkYi9jMnBhLnNpZ25hdHVyZWphc3NlcnRpb25zg6JjdXJseDNzZWxmI2p1bWJmPWMycGEuYXNzZXJ0aW9ucy9jMnBhLnRodW1ibmFpbC5jbGFpbS5wbmdkaGFzaFggv/mXA6TaHCiWBmxv2ByuX2pV2fQlRdL9aGOan4jnXVuiY3VybHgnc2VsZiNqdW1iZj1jMnBhLmFzc2VydGlvbnMvYzJwYS5hY3Rpb25zZGhhc2hYIOqcrYOdhOs1rbU2S97U9/uaWHB+eQlMM6Kfbz0afJwJomN1cmx4KXNlbGYjanVtYmY9YzJwYS5hc3NlcnRpb25zL2MycGEuaGFzaC5kYXRhZGhhc2hYINw0nXBxu3R+6Vzy3Btdys8vYycNun4ka35KPE/4o4U7aWRjOmZvcm1hdGlpbWFnZS9wbmdqaW5zdGFuY2VJRHgseG1wOmlpZDpiM2FkNmFiNy0xMmVlLTQwMmMtOGRmZS1kY2ZhNTYzZjgxMjVoZGM6dGl0bGVlMS5wbmdjYWxnZnNoYTI1NgAAK0tqdW1iAAAAKGp1bWRjMmNzABEAEIAAAKoAOJtxA2MycGEuc2lnbmF0dXJlAAAAKxtjYm9y0oRZEoCiATgmGCGDWQU+MIIFOjCCAyKgAwIBAgIQZkjUH7Qt3+JCrh6PdoKKnzANBgkqhkiG9w0BAQ0FADAiMSAwHgYDVQQDExdTaWduaW5nIEludGVybWVkaWF0ZSBDQTAeFw0yNjAzMDEyMzUwNTVaFw0yNjAzMDkyMzUwNTVaMDgxDjAMBgNVBAoTBUNhbnZhMQ4wDAYDVQQLEwVDYW52YTEWMBQGA1UEAxMNQ2FudmEgU2lnbmluZzCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAMOj6Iz/yunhj0/gWzO1EGq1AvkiK58Nx2XiFuEOVDDHy3qy3Xk5KkIAMs3hDBBaHwJ/LeHqYCXMGN+9KSf0gm+zZsH82WHJB4acmClyw9QYhZ29zi/rNPGqaRyC06Ayr2TS4funY+hItSsLtwZYayGO0+eIbnqHB7DGn5h+JqVrxNDnjpvaQaTqUw0lChQtaSzejlx+64kaWAN0j2CXX/Im7/FAjgxKPkm+TY4b1NR7eBUU8qc9ZP3gAaFcG7+eEfJHxq0xzkrh5x5HZTYhvXeN31ozjJWKTdopI0v9zdXuQ2BPcP8cEUGP8LU03eImfgzjaBh0OrUGfQ7VYYBs/KFeQiOo4I6nu9uLskMogCwqu4cIRtlZsEf4XPowFFRl6a67BJUJhUyZAYO4hXt4SPr0IB3kKgPyCX5MEv3k9Y1WwE6fH6GNdjSvQy9DujOY3wiILxWprV+1jjLNvn5TyfCuZNpvkKeOa+0rp+KTUS5l2OWgY88vEwaZBUWAjEmQLuFXVwrtQRJmeJqEq2PbTWYqn8LNkfxzgCR0d7pgVdUmmBu2Q3dED8QjpVX0n63AU1ncl3zek47J5kqqI+kBgEstJ9nMKTQWEHJm3ZQ/7etKOPMcxbmUVqkvMmwzi8raBBKi0f4JnSgY0AaI/DdW05uy0mWZlRm3KuiHe89QV3O9AgMBAAGjVjBUMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDBDAMBgNVHRMBAf8EAjAAMB8GA1UdIwQYMBaAFDiXjER8QYyVFWf2Zhqgkf9NMpZWMA0GCSqGSIb3DQEBDQUAA4ICAQBg8N9300nDZGWoAkfbRAQVhoeNXMcmZibJS9ExS7/1eXwLx+i39W+vKwHdX/SNwvuXofTqB/ma54a0WvFiw2S0pkt+XawyQeLjyeWvfTUIuq1fiLEfMyjJ4qcGdFxFVb/MD9XrR9ybv4VWpLy4GHoEQjaulhzm02YC1aW6XGs2qwdwZViwbWq1WSZqI5f7Lo9AQr40LAgQo8pqR2LSg4biLbnZui/ix0TaPHI+vYZhN2/eTA1SM0Y98oi6KBj5EAgftIoD76OTm/CongVYBJjj8RsoXvvVVOeD+GWVfDdCeUsZYMKNyui/DV8ZMvmV9otMqR/zUtT2QuIzzqerGc7DRzohFUdHbThIuMT/xDl6wjB4r5slihUp4iW7NFf+eyi7hJKrZISQW3I8VWQC4N5n656p0kBsDOTH9dBKF/X67Ii6VdBcrcWQ2NZ2i5OsmNIPacLUh6dAZQzv/HRFJ4SyGvaeA0s+/6t/BnYMoBXyKf7X7etXY6GD7ndlFPM7E7idnnJLow/bxsRrftB0cELA8h9T+aoRqcZR6lO9m1Twkac2Yin3VKE/D1Mkya0ltxUsxAKXMWjdz05LOoD8y1wDdUqgt+0YbkaUdssYXcyNMM/q8NR6IigcN2IfDXfUmah54VptB2hHqA1mmfRROA9aw3nXZ21FkmMCBo49m+tVVFkG6DCCBuQwggTMoAMCAQICFA3A9qkRtRQZGRhlU793CVyP3l/fMA0GCSqGSIb3DQEBCwUAMG0xCzAJBgNVBAYTAkFVMQwwCgYDVQQIEwNOU1cxDzANBgNVBAcTBlN5ZG5leTETMBEGA1UEChMKQ2FudmEgUHJvZDEQMA4GA1UECxMHU2lnbmluZzEYMBYGA1UEAxMPU2lnbmluZyBDQSBQcm9kMB4XDTI2MDIxNjA1Mzk1MVoXDTI2MDMxODA1NDAyMVowIjEgMB4GA1UEAxMXU2lnbmluZyBJbnRlcm1lZGlhdGUgQ0EwggIiMA0GCSqGSIb3DQEBAQUAA4ICDwAwggIKAoICAQCtxSAXXESFB1LnyKCco5BHD10NFKJvZcoN5tM6OTMoTxDWzeUgngjU0sbqevvgnYJ7vnwbTAfJGs0XolX5+X7sTo9rbDTTMoIe1eg1EA8O8L1Q9ynXoJs3+7SjjgiJJU4Czq2+jUWi1j1uvwGPvqf1T+WH53dSuCiODkSPHl36FOAaEBBXaZ98uMcNEDOh0Rvflc+KPgrgAodQ4wIlyYdoqZzDRrERWz9KibNHhfh4W8anEgtiTy2JEkdsmYvyvE/AOoEN7BMKDMMKWpVF963KqrQw/VRLT7Lqt7gzWPwLYohVWBbZ+xvQRzi5MDetmdVY0Wkt1ICjdkhemW9lkK6gD5SlNTuyzw+gMbA+a4K9gbgOdUxLe1aIHk58EuizQIHKKbU7LkSubfWoEoCVEhBQ8TZAo41GlQDpnMrUKGGGtoQHiSfGg9nx6L3kEBEx9dhxenFstf0sUYiym5OdiJoqIL5C4XmuM7pyyICY8noN2TDNh+hzPoKRF9G3xvVd65chEdskdbG5SCW8TAcsYK2jrKJLgXyrpHr5bG37eV2rO6VaTRiBEubUQUIH40ZYDDQpe1KeEhmWElu5+KDNVHBAIkWzupOdx+kXCAUpUc58f+FuendWrcnzeq7P1fibUHG0QBbZ66kHypQoyzsyFPjppnTnb2kHIzCpVQWDoE1/qwIDAQABo4IBxTCCAcEwDgYDVR0PAQH/BAQDAgEGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0OBBYEFDiXjER8QYyVFWf2Zhqgkf9NMpZWMB8GA1UdIwQYMBaAFBFVbsendWjLjUf6Jzt7rgfSWgFCMIHXBggrBgEFBQcBAQSByjCBxzBMBggrBgEFBQcwAYZAaHR0cHM6Ly9wa2kuY2FudmEtaW50ZXJuYWwuY29tL3YxL3BraS9jYW52YS1wcm9kL2wxL3NpZ25pbmcvb2NzcDB3BggrBgEFBQcwAoZraHR0cHM6Ly9wa2kuY2FudmEtaW50ZXJuYWwuY29tL3YxL3BraS9jYW52YS1wcm9kL2wxL3NpZ25pbmcvaXNzdWVyL2ZmYTgyZTQwLTJlMmItYjY4ZS0zYWEyLWE2MzViYzQ1M2VjYy9kZXIwgYAGA1UdHwR5MHcwdaBzoHGGb2h0dHBzOi8vcGtpLmNhbnZhLWludGVybmFsLmNvbS92MS9wa2kvY2FudmEtcHJvZC9sMS9zaWduaW5nL2lzc3Vlci9mZmE4MmU0MC0yZTJiLWI2OGUtM2FhMi1hNjM1YmM0NTNlY2MvY3JsL2RlcjANBgkqhkiG9w0BAQsFAAOCAgEAMfs/60MkoIRdGVn/et/th80cRM4hlKlhhyTNHHSZgkBeI61xf6zx07jpnzk0jumbHnIDVN/ukZFACBq4XXSWFx2GSI7f23gu5Y7GY0P5HJZDHpYaL0ISDDHoQjJc05dtc6i2EQwtbZjEDtR/CKAZKRsYBafw8K5rr+SnqKCaZSrE7Yx7kSjI0ceYvhGHF8PRpxaEXgb2FVXCUeCQPdapPTawKW9f7eQ4d81O+06AOI7Te3iu1BaDhos2q327SKoyWPmkiQsYsrYM+rBBAfV8TF6sicvwIL9xwRMT27u2zdEoda1ls8joCMNZQp2gDv6mWdun95OOxrjpuB17YFuzcpzYVqtXnJ+lGyEiXw48VdQipiRbMV+NKMmyXxcO8nLriA9fvtBg87KROyfruOosB1u9LlLOKS1AESoat2pAinl3NXEoB2xidzd+3kjKUy9UZekqKCKHDIPAjSrxiV2A5Co3X4Iws+a128hxsxZZrDboYMd46gVIocbv8Pc3Wqi/EwrJn+6kkxbeCxU31XzBaHRyqd9oB8RmOSivKRoha02AhsxjWBSjf3VssLbFouz65aarVWmm52XL7Geeu2mLfhB9Tz9e1Xr6kpIlSoMobOc3FYy3G62qdETYaN6Bmk4X8lIPP2B8pkqKfLjpB4wAGWrL4NcZ9eaQ/xFMBhLTG0VZBkowggZGMIIELqADAgECAhEA8FB3KScrJ748Zx0yVtMjHTANBgkqhkiG9w0BAQ0FADCBgTELMAkGA1UEBhMCQVUxEzARBgNVBAoMCkNhbnZhIFByb2QxFzAVBgNVBAsMDkNsb3VkIFBsYXRmb3JtMQwwCgYDVQQIDANOU1cxJTAjBgNVBAMMHENhbnZhIFByb2QgUm9vdCBDQSBHbG9iYWwgRzIxDzANBgNVBAcMBlN5ZG5leTAeFw0yNjAyMTQwMzIyMDdaFw0yNjA4MTMwMzIyMDdaMG0xCzAJBgNVBAYTAkFVMQwwCgYDVQQIEwNOU1cxDzANBgNVBAcTBlN5ZG5leTETMBEGA1UEChMKQ2FudmEgUHJvZDEQMA4GA1UECxMHU2lnbmluZzEYMBYGA1UEAxMPU2lnbmluZyBDQSBQcm9kMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAqYPMto01tSdCAL/PTqRQ6OogINAUNwvrZplhH0Wcr4kksV0ZG8/o08tmeasdWaSnDssF2O/eYQ/JCOrdRxy7OJA8xwNTWefIz46iITYZE9Nby43w0Pdgy5yBAAfWnNwgYxY7ptqtJCsA4jJVsB3XwB1CDhh0u6NxCY7jIF+rDnZm22XJMyQ9xVjMQUQhKFfyHOEf8nkpIM+izeGG/ykuTcprJs3I3Bzt23Ben1f533Gse3vD6CF9ScBFfFC7H2JCqMB7WHBtbLiN8x9gKPzsQyGHixS8pAeaVQPcylpdtt6IqLxMoG0SemozPtQDJRvgssRSJ3kIPMoxO7nYFCzW3PG6opRfJthjwgSLOTpAP/cc5DqVti1DDe/WvKCTfcFmTw2VWRTbh+xivaYyRG5O7KvigFv76SMILAPlKb3Mdh1ntNR+w3hSdCxAS/tnTrG/gSvTFjKh3OWvslmmFSS01RYz7Rb9UAys5JuCM4gZtCCHiEVW8ID4eVVV3Oc/97Y+yXPxY2Pl6i6u2YpanpesPXYTofOmq9ob6iwX2DDn6Ca48MdCnwfhBR26xKA5+yqqKsBU6pvGN7MRvozam7p8J0Bt9JhbbS4cPJZa5rgh6jnKt/awQP50CKzoxZkjUDpYn9KONt+HRMLPml2JB0cM/i7jM+VJq2h5Wbl8faAInZsCAwEAAaOByzCByDASBgNVHRMBAf8ECDAGAQH/AgEBMB8GA1UdIwQYMBaAFOlJ6pjdnGlUfY1/j6FsyMcp5K1zMB0GA1UdDgQWBBQRVW7Hp3Voy41H+ic7e64H0loBQjAOBgNVHQ8BAf8EBAMCAYYwYgYDVR0fBFswWTBXoFWgU4ZRaHR0cDovL2QxdWFkbjBwanNpaDhtLmNsb3VkZnJvbnQubmV0L2NybC8wYTBhYTQ1Mi05ZjI3LTQ4NjMtYWVkYS1lZDk3NmYyMGQ4YmIuY3JsMA0GCSqGSIb3DQEBDQUAA4ICAQAXZv0OR0a7LhC/gfr8DXPhmnEB3JPA5m5lRSBvOtNk3u33o81Yk97LTZwLqzaE2j9h4XIoHtra51dROBQRtwh3AUJpl1NtAADTN5xnqsSw1159BeWlyaOgSrDZzersqxSnVjPW7HitPbWUTPcSCAgIicn16O7qCIH8YaleAQ5sixD9HasWM/q/exXJNBbQWcWIozhBx3aJekl0U8NNLCZIp9YgUQeB2kMEz1zN2b5sgPewx+376UedS57gXj2sv3bw1tRQm1ftNrFhVDsmx899GmG6AqMNKURkbncCUno9Mzz5kvB9g7iL9m0KmbPmBVULWIeCcgaPdy+o8C4iSVbpi3jBozFxP1ruFZhV1mZNR+Xiw5mMCKFu7/KQcycg/OmfcStgMOICDtXF9//4WIOQ4DSB8M59w51RdZpWDMzenYL+S62QQjQKy/JZI5WyT4NH0EIptMcbzHMEFVG0ZGruzoPoqZlWrZrmvr3DxtH/ItRD7P6/B8i8bDefSgCNn6anOdbLVmXMdBmieUNmFN2hG9yN3WXuxayz2HCaiX2zTEOAqCCgym3ggVfUdUBl13eCOJf3dZXOJQRr67YONqfsgpXek5V/oLrFGFBaiqqyTEXw3V/9iqJluOxDNoQTa1yjXU9C+33wUNYk9A2WBENox3q/xs8v2khlaQybukEeO6FjcGFkWRaCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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RjhqRDNvJnF1b3Q7LCZxdW90O2JyYW5kJnF1b3Q7OiZxdW90O1RyaW5pdHkgUHJlcCBBY2FkZW15JnF1b3Q7fTwvQXR0cmliOkRhdGE+CiAgICAgPEF0dHJpYjpFeHRJZD5mYzZiMzk2Yi1mYjdjLTQyYjctOWI1MC04Y2M0YjkyZGRiMTI8L0F0dHJpYjpFeHRJZD4KICAgICA8QXR0cmliOkZiSWQ+NTI1MjY1OTE0MTc5NTgwPC9BdHRyaWI6RmJJZD4KICAgICA8QXR0cmliOlRvdWNoVHlwZT4yPC9BdHRyaWI6VG91Y2hUeXBlPgogICAgPC9yZGY6bGk+CiAgIDwvcmRmOlNlcT4KICA8L0F0dHJpYjpBZHM+CiA8L3JkZjpEZXNjcmlwdGlvbj4KCiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0nJwogIHhtbG5zOkNvbnRhaW5zQWlHZW5lcmF0ZWRDb250ZW50PSdodHRwczovL2NhbnZhLmNvbS9leHBvcnQnPgogIDxDb250YWluc0FpR2VuZXJhdGVkQ29udGVudDpDb250YWluc0FpR2VuZXJhdGVkQ29udGVudD5ZZXM8L0NvbnRhaW5zQWlHZW5lcmF0ZWRDb250ZW50OkNvbnRhaW5zQWlHZW5lcmF0ZWRDb250ZW50PgogPC9yZGY6RGVzY3JpcHRpb24+CgogPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9JycKICB4bWxuczpkYz0naHR0cDovL3B1cmwub3JnL2RjL2VsZW1lbnRzLzEuMS8nPgogIDxkYzp0aXRsZT4KICAgPHJkZjpBbHQ+CiAgICA8cmRmOmxpIHhtbDpsYW5nPSd4LWRlZmF1bHQnPkFJIC0gMTwvcmRmOmxpPgogICA8L3JkZjpBbHQ+CiAgPC9kYzp0aXRsZT4KIDwvcmRmOkRlc2NyaXB0aW9uPgoKIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PScnCiAgeG1sbnM6cGRmPSdodHRwOi8vbnMuYWRvYmUuY29tL3BkZi8xLjMvJz4KICA8cGRmOkF1dGhvcj5BYmR1bGxhaCBTYWxlaDwvcGRmOkF1dGhvcj4KIDwvcmRmOkRlc2NyaXB0aW9uPgoKIDxyZGY6RGVzY3JpcHRpb24gcmRm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') !important; } button:has(img[alt='User profile image']) > div { font-size: 0 !important; } button:has(img[alt='User profile image']) > div::after { content: 'FLOW LABS'; font-size: 13px !important; font-weight: 700 !important; letter-spacing: 0.5px; }";
  function injectBrand() {
    if (!document.getElementById('__flow_brand_override__')) {
      (document.head || document.documentElement).appendChild(style);
    }
  }
  injectBrand();
  if (window.MutationObserver) {
    new MutationObserver(injectBrand).observe(document.documentElement, {childList: true});
  }
})();
