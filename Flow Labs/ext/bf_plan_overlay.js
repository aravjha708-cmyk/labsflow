(function () {
  'use strict';
  var OVERLAY_ID = '__bf_plan_blocker__';
  var LOGO_URL = chrome.runtime.getURL('icon128.png');
  var shown = false;

  function showOverlay(plan) {
    removeOverlay();
    var ov = document.createElement('div');
    ov.id = OVERLAY_ID;
    ov.style.cssText = 'all:initial;position:fixed;inset:0;z-index:999999;background:rgba(7,8,17,0.93);display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,-apple-system,sans-serif';
    ov.innerHTML = '<div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:20px;padding:40px 36px;max-width:400px;width:100%;margin:20px;text-align:center;backdrop-filter:blur(16px);box-shadow:0 24px 64px rgba(0,0,0,0.5)">'
      + '<img src="' + LOGO_URL + '" style="width:64px;height:64px;border-radius:14px;display:block;margin:0 auto 18px;border:1px solid rgba(139,92,246,0.12);box-shadow:0 4px 20px rgba(139,92,246,0.08)">'
      + '<h1 style="font-size:20px;font-weight:800;color:#e8edf5;margin:0 0 6px;letter-spacing:-0.25px">Flow Studio</h1>'
      + '<p style="font-size:13px;color:#f87171;font-weight:600;margin:0 0 16px">' + (plan === 'none' ? 'Plan Not Assigned' : 'Plan Disabled') + '</p>'
      + '<p style="font-size:13px;color:#9ca3b8;line-height:1.6;margin:0 0 24px">' + (plan === 'none' ? 'Plan not assigned. Contact your seller/reseller to get access.' : 'Your session has been disabled by the admin.') + '</p>'
      + '<a href="https://flowsstudio.lovable.app" target="_blank" style="display:inline-flex;align-items:center;gap:8px;padding:12px 28px;border-radius:10px;background:linear-gradient(135deg,#7c3aed,#0891b2);color:#fff;font-weight:700;font-size:14px;text-decoration:none;font-family:inherit;border:none;cursor:pointer;transition:opacity 0.15s" onmouseover="this.style.opacity=0.9" onmouseout="this.style.opacity=1">'
      + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Contact Seller</a>'
      + '</div>';
    document.documentElement.appendChild(ov);
  }

  function removeOverlay() {
    var el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
  }

  function updateOverlay() {
    chrome.storage.local.get(['userPlan', 'cookieSystemDisabled'], function (d) {
      var plan = (d.userPlan || '').toLowerCase();
      var blocked = d.cookieSystemDisabled === true || plan === 'none';
      if (blocked === shown) return;
      shown = blocked;
      if (blocked) showOverlay(plan); else removeOverlay();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateOverlay);
  } else {
    updateOverlay();
  }
  chrome.storage.onChanged.addListener(function (changes) {
    if (changes.userPlan || changes.cookieSystemDisabled) updateOverlay();
  });
})();
