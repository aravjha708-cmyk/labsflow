// BunnyFlow — Flow About / Landing Page Status Card
// ONLY runs on labs.google/flow/about and labs.google root (NOT on fx/tools/flow).
// Shows NOTHING if extension is alive and cookies are present.
(function () {
  'use strict';

  var path = location.pathname;
  var isAboutPage = /^\/flow(\/about)?\/?$/i.test(path) || path === '/' || path === '';
  if (!isAboutPage) return; // never run on flow tool pages

  var POLL_MS    = 4000;
  var MAX_TRIES  = 15;
  var _attempts  = 0;
  var _pollId    = null;
  var _card      = null;
  var _autoHide  = null;

  function hasCookies() {
    var c = document.cookie;
    return c.indexOf('SID=') !== -1 || c.indexOf('SSID=') !== -1 ||
           c.indexOf('HSID=') !== -1 || c.indexOf('__Secure-1PSID') !== -1 ||
           c.indexOf('SAPISID') !== -1;
  }

  function isExtensionAlive(cb) {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
        cb(false); return;
      }
      chrome.runtime.sendMessage({ type: 'PING' }, function() {
        cb(!chrome.runtime.lastError);
      });
    } catch(e) { cb(false); }
  }

  function requestInjection() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        ['INJECT_NOW','BUNNYFLOW_INJECT_COOKIES','BF_SYNC_NOW'].forEach(function(t) {
          chrome.runtime.sendMessage({ type: t }, function() {});
        });
      }
    } catch(e) {}
  }

  function showCard(text, emoji, color, sub) {
    if (_autoHide) clearTimeout(_autoHide);
    if (!_card) {
      _card = document.createElement('div');
      _card.id = '__bf_about_card__';
      _card.style.cssText =
        'position:fixed!important;bottom:20px!important;right:20px!important;' +
        'z-index:2147483647!important;border-radius:10px!important;' +
        'font-family:system-ui,sans-serif!important;color:#fff!important;' +
        'min-width:190px!important;max-width:280px!important;' +
        'box-shadow:0 4px 18px rgba(0,0,0,0.45)!important;' +
        'transition:opacity 0.3s!important;opacity:1!important;' +
        'display:flex!important;align-items:flex-start!important;' +
        'padding:10px 12px!important;gap:8px!important;';
      document.body.appendChild(_card);
    }
    while (_card.firstChild) _card.removeChild(_card.firstChild);
    _card.style.background = color + '!important';
    _card.style.opacity = '1';

    var iconEl = document.createElement('span');
    iconEl.style.cssText = 'font-size:16px;flex-shrink:0;padding-top:1px';
    iconEl.textContent = emoji;

    var textEl = document.createElement('span');
    textEl.style.cssText = 'font-size:12px;font-weight:600;flex:1;line-height:1.35';
    textEl.textContent = text;
    if (sub) {
      var subEl = document.createElement('div');
      subEl.style.cssText = 'font-size:10px;font-weight:400;opacity:0.8;margin-top:2px';
      subEl.textContent = sub;
      textEl.appendChild(subEl);
    }

    var xEl = document.createElement('span');
    xEl.style.cssText = 'cursor:pointer;opacity:0.65;font-size:13px;flex-shrink:0;padding:0 2px';
    xEl.textContent = '\u2715';
    xEl.addEventListener('click', function() { _card.style.opacity = '0'; });

    _card.appendChild(iconEl);
    _card.appendChild(textEl);
    _card.appendChild(xEl);
  }

  function hideCard() {
    if (_card) _card.style.opacity = '0';
  }

  function poll() {
    _attempts++;
    requestInjection();
    if (hasCookies()) {
      clearInterval(_pollId);
      showCard('Flow is Active — Opening\u2026', '\u2705',
        'linear-gradient(135deg,#16a34a,#166534)');
      setTimeout(function() {
        location.replace('https://labs.google/fx/tools/flow');
      }, 1800);
      return;
    }
    if (_attempts >= MAX_TRIES) {
      clearInterval(_pollId);
      showCard('Flow not available \u2014 try again', '\u274c',
        'linear-gradient(135deg,#dc2626,#991b1b)');
      return;
    }
    showCard('Flow is opening\u2026 Please wait', '\u23f3',
      'linear-gradient(135deg,#6d28d9,#4c1d95)',
      'Refresh this page & Visit Flow Studio');
  }

  function init() {
    // If cookies already present, check if extension alive
    if (hasCookies()) {
      isExtensionAlive(function(alive) {
        if (alive) {
          // Extension active + cookies = just redirect, show nothing
          location.replace('https://labs.google/fx/tools/flow');
        } else {
          // Cookies present but extension gone — show active briefly then stop
          showCard('Flow is Active!', '\u2705',
            'linear-gradient(135deg,#16a34a,#166534)');
          _autoHide = setTimeout(hideCard, 3000);
        }
      });
      return;
    }
    // No cookies — check if extension is alive to decide message
    isExtensionAlive(function(alive) {
      if (!alive) {
        // Extension removed — show "not available"
        showCard('Flow not available \u2014 try again', '\u274c',
          'linear-gradient(135deg,#dc2626,#991b1b)');
        return;
      }
      // Extension alive but no cookies yet — start polling
      requestInjection();
      showCard('Flow is opening\u2026 Please wait', '\u23f3',
        'linear-gradient(135deg,#6d28d9,#4c1d95)',
        'Refresh this page & Visit BunnyFlow');
      _pollId = setInterval(poll, POLL_MS);
    });
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
