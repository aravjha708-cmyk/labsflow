// State
let activePollInterval = null;
let currentActiveJobId = null;

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initPresets();
  initForm();
  initGallery();
  initSettings();
  initProxyControls();
  fetchInitialState();

  // Poll system queue and gallery periodically
  setInterval(refreshQueueStats, 4000);
});

// ==========================================
// TAB NAVIGATION
// ==========================================
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPanel = document.getElementById(`tab-${target}`);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });

  const linkToSettings = document.getElementById('linkToSettings');
  if (linkToSettings) {
    linkToSettings.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('tabBtnSettings')?.click();
    });
  }
}

// ==========================================
// PRESETS
// ==========================================
function initPresets() {
  const promptInput = document.getElementById('promptInput');
  document.querySelectorAll('.chip-preset').forEach(chip => {
    chip.addEventListener('click', () => {
      promptInput.value = chip.dataset.prompt;
      promptInput.focus();
    });
  });
}

// ==========================================
// FORM GENERATION (APPROACH 1: STUDIO)
// ==========================================
function initForm() {
  const form = document.getElementById('generateForm');
  const btnSubmit = document.getElementById('btnSubmitGenerate');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const prompt = document.getElementById('promptInput').value.trim();
    const model = document.getElementById('modelSelect').value;
    const aspectRatio = document.getElementById('aspectRatioSelect').value;
    const duration = document.getElementById('durationSelect').value;
    const cameraMotion = document.getElementById('cameraMotionSelect').value;

    if (!prompt) return;

    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<span class="btn-icon">⏳</span><span class="btn-text">Queuing...</span>`;

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model, aspectRatio, duration, cameraMotion })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to submit generation task');

      const job = data.job;
      startJobPolling(job);
    } catch (err) {
      alert(`Error submitting job: ${err.message}`);
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `<span class="btn-icon">⚡</span><span class="btn-text">Generate via Shared Account</span>`;
    }
  });
}

function startJobPolling(job) {
  currentActiveJobId = job.id;
  const progressCard = document.getElementById('activeProgressCard');
  const activePrompt = document.getElementById('activeJobPrompt');
  const activeStage = document.getElementById('activeJobStage');
  const activeBar = document.getElementById('activeProgressBar');
  const activeId = document.getElementById('activeJobId');
  const activePct = document.getElementById('activeJobPct');
  const stateBadge = document.getElementById('generationStateBadge');

  progressCard.classList.remove('hidden');
  activePrompt.textContent = job.prompt;
  activeStage.textContent = 'Enqueued in shared queue...';
  activeBar.style.width = '10%';
  activeId.textContent = `ID: ${job.id.substring(0, 8)}...`;
  activePct.textContent = '10%';
  stateBadge.textContent = 'Processing';
  stateBadge.style.color = 'var(--accent-secondary)';

  if (activePollInterval) clearInterval(activePollInterval);

  activePollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${job.id}`);
      if (!res.ok) return;
      const current = await res.json();

      activeBar.style.width = `${current.progress}%`;
      activePct.textContent = `${current.progress}%`;
      if (current.stage) activeStage.textContent = current.stage;

      if (current.status === 'completed') {
        clearInterval(activePollInterval);
        activePollInterval = null;
        progressCard.classList.add('hidden');
        stateBadge.textContent = 'Completed';
        stateBadge.style.color = 'var(--success)';

        const btnSubmit = document.getElementById('btnSubmitGenerate');
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = `<span class="btn-icon">⚡</span><span class="btn-text">Generate via Shared Account</span>`;

        showFeaturedVideo(current);
        refreshGallery();
        refreshQueueStats();
      } else if (current.status === 'failed') {
        clearInterval(activePollInterval);
        activePollInterval = null;
        progressCard.classList.add('hidden');
        stateBadge.textContent = 'Failed';
        stateBadge.style.color = 'var(--danger)';

        const btnSubmit = document.getElementById('btnSubmitGenerate');
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = `<span class="btn-icon">⚡</span><span class="btn-text">Generate via Shared Account</span>`;

        alert(`Generation task failed: ${current.error}`);
        refreshQueueStats();
      }
    } catch (e) {
      console.warn('Polling error:', e);
    }
  }, 1000);
}

function showFeaturedVideo(job) {
  const placeholder = document.getElementById('mediaPlaceholder');
  const wrapper = document.getElementById('videoWrapper');
  const video = document.getElementById('featuredVideo');
  const title = document.getElementById('featuredPromptTitle');
  const btnDownload = document.getElementById('btnDownloadFeatured');

  if (job.result && job.result.url) {
    placeholder.classList.add('hidden');
    wrapper.classList.remove('hidden');
    video.src = job.result.url;
    title.textContent = job.prompt;
    btnDownload.href = job.result.url;
  }
}

// ==========================================
// GALLERY & HISTORY
// ==========================================
function initGallery() {
  document.getElementById('btnRefreshGallery')?.addEventListener('click', refreshGallery);
  refreshGallery();
}

async function refreshGallery() {
  try {
    const res = await fetch('/api/queue');
    if (!res.ok) return;
    const { data } = await res.json();
    const galleryGrid = document.getElementById('galleryGrid');

    if (!data.history || data.history.length === 0) {
      galleryGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align:center; padding: 2rem; color: var(--text-muted); font-size: 0.85rem;">
          No previous generations in history. Completed videos will automatically appear here.
        </div>`;
      return;
    }

    galleryGrid.innerHTML = data.history.map(item => {
      const isVideo = item.result && item.result.url;
      const mediaUrl = isVideo ? item.result.url : '';
      return `
        <div class="gallery-card">
          <div class="gallery-card-thumb">
            ${isVideo ? `<video src="${mediaUrl}" muted loop playsinline onmouseover="this.play()" onmouseout="this.pause()"></video>` : '<div style="padding:2rem; text-align:center; color:var(--text-muted);">Media Unavailable</div>'}
          </div>
          <div class="gallery-card-info">
            <p class="gallery-prompt" title="${escapeHtml(item.prompt)}">${escapeHtml(item.prompt)}</p>
            <div class="gallery-meta">
              <span>${item.model || 'hf-cinema-v2'}</span>
              ${isVideo ? `<a href="${mediaUrl}" target="_blank" download="generation.mp4" style="color:var(--accent-secondary); text-decoration:none; font-weight:600;">📥 Save</a>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.warn('Failed to refresh gallery:', err);
  }
}

// ==========================================
// QUEUE STATS & STATUS
// ==========================================
async function refreshQueueStats() {
  try {
    const res = await fetch('/api/queue');
    if (!res.ok) return;
    const { stats } = await res.json();

    const queueCountVal = document.getElementById('queueCountVal');
    if (queueCountVal) {
      const totalInFlight = (stats.activeCount || 0) + (stats.queuedCount || 0);
      queueCountVal.textContent = `${totalInFlight} in queue / max ${stats.maxConcurrent}`;
    }
  } catch (err) {
    // ignore
  }
}

// ==========================================
// SETTINGS & CREDENTIALS
// ==========================================
function initSettings() {
  const form = document.getElementById('settingsForm');
  const btnTestConn = document.getElementById('btnTestConn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btnSaveSettings');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const hfTargetUrl = document.getElementById('settingTargetUrl').value.trim();
    const sessionCookies = document.getElementById('settingCookies').value.trim();
    const apiToken = document.getElementById('settingApiToken').value.trim();
    const maxConcurrentJobs = document.getElementById('settingMaxConcurrent').value;
    const mockMode = document.getElementById('settingMockMode').value === 'true';

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hfTargetUrl,
          sessionCookies,
          apiToken,
          maxConcurrentJobs,
          mockMode
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save settings');

      alert('✅ Configuration and credentials updated successfully!');
      fetchInitialState();
    } catch (err) {
      alert(`Error saving settings: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Save Configuration';
    }
  });

  btnTestConn.addEventListener('click', runProxyDiagnosticTest);
}

async function runProxyDiagnosticTest() {
  const testBox = document.getElementById('testConnResult');
  testBox.className = 'test-result-box';
  testBox.classList.remove('hidden');
  testBox.textContent = 'Testing connection and verifying auth headers with target...';

  try {
    const res = await fetch('/api/test-proxy');
    const data = await res.json();

    if (data.status === 'success') {
      testBox.className = 'test-result-box success';
      testBox.textContent = `✅ CONNECTION SUCCESSFUL\n` +
        `Target Host:     ${data.target}\n` +
        `HTTP Status:     ${data.httpStatus}\n` +
        `Latency:         ${data.latencyMs}ms\n` +
        `Cookies Active:  ${data.hasSessionCookies ? 'Yes' : 'No'}\n` +
        `API Token:       ${data.hasApiToken ? 'Yes' : 'No'}\n` +
        `Server Banner:   ${data.serverHeaders.server}`;
    } else {
      testBox.className = 'test-result-box error';
      testBox.textContent = `❌ CONNECTION ERROR\n` +
        `Target Host: ${data.target}\n` +
        `Details:     ${data.error}\n` +
        `Latency:     ${data.latencyMs}ms`;
    }
  } catch (err) {
    testBox.className = 'test-result-box error';
    testBox.textContent = `❌ Test request failed: ${err.message}`;
  }
}

// ==========================================
// PROXY TAB CONTROLS (APPROACH 2)
// ==========================================
function initProxyControls() {
  const btnReload = document.getElementById('btnReloadProxyFrame');
  const frame = document.getElementById('higgsfieldFrame');
  const btnLatency = document.getElementById('btnTestProxyLatency');

  if (btnReload && frame) {
    btnReload.addEventListener('click', () => {
      frame.src = '/proxy/hf/?t=' + Date.now();
    });
  }

  if (btnLatency) {
    btnLatency.addEventListener('click', async () => {
      btnLatency.textContent = '⚡ Ping...';
      const start = Date.now();
      try {
        await fetch('/api/test-proxy');
        const elapsed = Date.now() - start;
        btnLatency.textContent = `⚡ ${elapsed}ms`;
      } catch (e) {
        btnLatency.textContent = '⚡ Error';
      }
      setTimeout(() => { btnLatency.textContent = '⚡ Test Ping'; }, 3000);
    });
  }
}

// ==========================================
// INITIAL STATE LOADER
// ==========================================
async function fetchInitialState() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    const cfg = await res.json();

    document.getElementById('settingTargetUrl').value = cfg.hfTargetUrl || 'https://higgsfield.ai';
    document.getElementById('settingMaxConcurrent').value = cfg.maxConcurrentJobs || 2;
    document.getElementById('settingMockMode').value = String(cfg.mockMode);

    const proxyCookieStatus = document.getElementById('proxyCookieStatus');
    if (proxyCookieStatus) {
      if (cfg.hasSessionCookies) {
        proxyCookieStatus.textContent = 'Injected (Configured)';
        proxyCookieStatus.className = 'tag-success';
      } else {
        proxyCookieStatus.textContent = 'None Set (Mock/Anon)';
        proxyCookieStatus.className = 'tag-neutral';
      }
    }

    const statusText = document.getElementById('statusText');
    if (statusText) {
      statusText.textContent = cfg.mockMode ? 'Studio Ready (Simulation Active)' : 'Studio Ready (Live Proxy)';
    }
  } catch (e) {
    console.warn('Failed to load initial config:', e);
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}
