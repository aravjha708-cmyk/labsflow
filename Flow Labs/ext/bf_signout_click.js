// BunnyFlow — Force NextAuth signout via direct POST to /fx/api/auth/signout
// Replicates the reference auto_signout.js mechanism: read CSRF token cookie,
// POST the logoutForm directly. No button click needed. Works headlessly.
(function () {
  'use strict';

  var SIGNOUT_API = 'https://labs.google/fx/api/auth/signout';
  var AFTER_URL = 'https://accounts.google.com/Logout';

  function getCookie(name) {
    var parts = (document.cookie || '').split(';');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p.indexOf(name + '=') === 0) return decodeURIComponent(p.substring(name.length + 1));
    }
    return '';
  }

  function getCsrfToken() {
    var raw = getCookie('__Host-next-auth.csrf-token') ||
              getCookie('next-auth.csrf-token') ||
              getCookie('__Secure-next-auth.csrf-token');
    if (!raw) return '';
    return raw.split('|')[0];
  }

  function clickFallback() {
    var btns = document.querySelectorAll('button, input[type="submit"], a[role="button"]');
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || btns[i].value || '').trim().toLowerCase();
      if (t === 'sign out' || t === 'signout' || t === 'log out' || t === 'logout') {
        try { btns[i].click(); return true; } catch (e) {}
      }
    }
    var forms = document.querySelectorAll('form');
    for (var j = 0; j < forms.length; j++) {
      try { forms[j].submit(); return true; } catch (e) {}
    }
    return false;
  }

  function forceSignout() {
    var csrf = getCsrfToken();
    if (!csrf) {
      if (!clickFallback()) {
        try { window.location.replace(AFTER_URL); } catch (e) {}
      }
      return;
    }
    var body = 'csrfToken=' + encodeURIComponent(csrf) +
               '&callbackUrl=' + encodeURIComponent(AFTER_URL) +
               '&json=true';
    fetch(SIGNOUT_API, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    }).then(function () {
      try { window.location.replace(AFTER_URL); } catch (e) {}
    }).catch(function () {
      if (!clickFallback()) {
        try { window.location.replace(AFTER_URL); } catch (e) {}
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', forceSignout);
  } else {
    forceSignout();
  }
})();
