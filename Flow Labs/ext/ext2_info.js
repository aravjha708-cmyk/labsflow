/* BunnyFlow ext2_info.js — populate extension2 fields in popup */
(function() {
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function updateExt2Fields() {
    chrome.storage.local.get(['extension2_days', 'extension2_expiry'], function(d) {
      var daysEl = document.getElementById('ext2-days');
      if (daysEl) {
        var days = parseInt(d.extension2_days, 10);
        daysEl.textContent = isNaN(days) ? '—' : days;
        daysEl.style.color = days > 5 ? '#22c55e' : days > 0 ? '#f59e0b' : '#ef4444';
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateExt2Fields);
  } else {
    updateExt2Fields();
  }
  // Also refresh after popup.js sets data (small delay)
  setTimeout(updateExt2Fields, 600);
  setTimeout(updateExt2Fields, 1500);
})();
