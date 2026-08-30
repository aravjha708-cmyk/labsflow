// BunnyFlow Watchdog — detects extension removal on Google Flow
// Only triggers logout when chrome.runtime.id is permanently gone (extension uninstalled).
// Does NOT trigger on transient sendMessage errors (service worker idle is normal in MV3).

const CHECK_INTERVAL = 1000;   // Check chrome.runtime.id every 1 second
const CONFIRM_CHECKS = 3;      // Require 3 consecutive failures before redirect (~3 sec)
let goneCount = 0;

function clearLocalCookiesAndRedirect() {
  try { sessionStorage.removeItem('__bf_alive__'); } catch(e) {}
  // Clear all JS-accessible cookies on this domain before redirecting
  try {
    var paths = ['/', '/fx', '/fx/tools', '/fx/tools/flow', '/fx/api', '/fx/api/auth'];
    var domains = ['', '.labs.google', 'labs.google', '.google.com'];
    var names = (document.cookie || '').split(';').map(function(c){ return (c.split('=')[0]||'').trim(); }).filter(Boolean);
    for (var n = 0; n < names.length; n++) {
      for (var p = 0; p < paths.length; p++) {
        for (var d = 0; d < domains.length; d++) {
          var s = names[n] + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=' + paths[p];
          if (domains[d]) s += ';domain=' + domains[d];
          document.cookie = s;
          document.cookie = s + ';secure';
        }
      }
    }
  } catch(e) {}
  try { localStorage.clear(); } catch(e) {}
  try { sessionStorage.clear(); } catch(e) {}
  // Redirect to about:blank — works on labs.google, Flow, and any Google page
  try { window.location.replace('about:blank'); } catch(e) { window.location.href = 'about:blank'; }
}

function isExtensionGone() {
  // chrome.runtime.id becomes undefined ONLY when the extension is uninstalled or disabled.
  // A service worker being idle does NOT make this undefined — it stays valid.
  return (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id);
}

function check() {
  if (isExtensionGone()) {
    goneCount++;
    if (goneCount >= CONFIRM_CHECKS) {
      clearLocalCookiesAndRedirect();
    }
  } else {
    goneCount = 0;
    // Update heartbeat so re-opened tabs know extension was alive recently
    try { sessionStorage.setItem('__bf_alive__', String(Date.now())); } catch(e) {}
  }
}

setInterval(check, CHECK_INTERVAL);
check();

// ── Heartbeat for MAIN-world timer ─────────────────────────────────────
// The ISOLATED script removes on disable, stopping postMessage. The MAIN
// world timer (in flow_overrides.js) detects the gap and redirects to
// Google Logout — which is why this survives: Chrome kills the ISOLATED
// world but MAIN-world timers persist in the page's JS heap.
setInterval(function() {
  try { window.postMessage({ type: '__BF_ALIVE', ts: Date.now() }, '*'); } catch(e) {}
}, 2000);
