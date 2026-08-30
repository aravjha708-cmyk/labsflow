/* BunnyFlow Performance Guard v3.10.32
   *
   * The new locking system (lock4kUpscale runs every 100ms in content.js, plus
   * bunny_extra.js has 9 MutationObservers + intervals at 200/400/500ms) is too
   * heavy on /flow/project/ pages where the video player constantly mutates the
   * DOM. This causes the page to hang a few seconds after a video opens.
   *
   * Approach: WRAP setInterval and MutationObserver in this isolated content-
   * script world. When on /flow/project/* pages, each callback is THROTTLED so
   * it runs at most once every N ms. This keeps locking active (just slower) and
   * keeps the page responsive. Locking files are NOT modified.
   *
   * Also runs an aggressive hider for "Not enough credits to save this video"
   * Google Flow toasts that the user wants suppressed.
   */
  (function(){
    'use strict';

    function _bfHeavyPage() {
      var p = location.pathname || '';
      if (p.indexOf('/flow/project/') !== -1) return true;
      if (document.fullscreenElement) return true;
      return false;
    }

    var _intLast = new WeakMap();
    var _moLast  = new WeakMap();
    var INT_MIN_GAP = 1500;
    var MO_MIN_GAP  = 500;

    // Wrap setInterval — throttle each wrapped callback on heavy pages
    var _origSetInterval = window.setInterval;
    window.setInterval = function(cb, delay) {
      if (typeof cb !== 'function') return _origSetInterval.apply(this, arguments);
      var wrapped = function() {
        if (_bfHeavyPage()) {
          var last = _intLast.get(wrapped) || 0;
          var now  = Date.now();
          if (now - last < INT_MIN_GAP) return;
          _intLast.set(wrapped, now);
        }
        try { return cb.apply(this, arguments); } catch(_) {}
      };
      return _origSetInterval.call(this, wrapped, delay);
    };

    // Wrap MutationObserver — throttle each callback on heavy pages
    var _OrigMO = window.MutationObserver;
    if (_OrigMO) {
      function _BfMO(cb) {
        if (typeof cb !== 'function') return new _OrigMO(cb);
        var pending = false;
        var wrapped = function(records, observer) {
          if (_bfHeavyPage()) {
            var last = _moLast.get(wrapped) || 0;
            var now  = Date.now();
            if (now - last < MO_MIN_GAP) {
              if (pending) return;
              pending = true;
              setTimeout(function() {
                pending = false;
                _moLast.set(wrapped, Date.now());
                try { cb.call(observer, [], observer); } catch(_) {}
              }, MO_MIN_GAP);
              return;
            }
            _moLast.set(wrapped, now);
          }
          try { return cb.call(this, records, observer); } catch(_) {}
        };
        return new _OrigMO(wrapped);
      }
      _BfMO.prototype = _OrigMO.prototype;
      window.MutationObserver = _BfMO;
    }

    // Aggressive "Not enough credits" hider — uses ORIGINAL setInterval so
    // it is never throttled by our own wrapper above
    var _CRED_RE = /not enough credits|enough credits to save|credits to save this|out of credits|insufficient credits/i;

    function _hideCreditMsgs() {
      try {
        var root = document.body || document.documentElement;
        if (!root) return;
        var walker = document.createTreeWalker(
          root,
          NodeFilter.SHOW_TEXT,
          { acceptNode: function(n) {
              var t = n.nodeValue;
              return (t && _CRED_RE.test(t))
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT;
            }
          }
        );
        var n;
        while ((n = walker.nextNode())) {
          var el = n.parentElement;
          for (var i = 0; i < 8 && el && el !== document.body; i++) {
            var role = el.getAttribute && el.getAttribute('role');
            var cls  = (typeof el.className === 'string') ? el.className : '';
            if (role === 'alert' || role === 'status' ||
                /snack|toast|notif|alert|error|message|popup/i.test(cls)) {
              el.style.setProperty('display', 'none', 'important');
              el.setAttribute('data-bf-credit-ban', '1');
              break;
            }
            el = el.parentElement;
          }
          if (n.parentElement && !n.parentElement.hasAttribute('data-bf-credit-ban')) {
            n.parentElement.style.setProperty('display', 'none', 'important');
          }
        }
      } catch(_) {}
    }

    _origSetInterval.call(window, _hideCreditMsgs, 400);

    if (_OrigMO) {
      try {
        var _hideObs = new _OrigMO(function() { _hideCreditMsgs(); });
        var _startHideObs = function() {
          if (document.body) _hideObs.observe(document.body, { childList: true, subtree: true });
          else setTimeout(_startHideObs, 100);
        };
        _startHideObs();
      } catch(_) {}
    }

  })();
  