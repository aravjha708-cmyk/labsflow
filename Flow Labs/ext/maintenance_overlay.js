// Flow Labs — Maintenance Mode Overlay

(function () {
  'use strict';

  if (window.__flow_maintenance_overlay_injected) return;
  window.__flow_maintenance_overlay_injected = true;

  const API_URL = 'http://localhost:3000/api/public/status';
  let maintenanceInterval = null;

  function removeMaintenanceOverlay() {
    const el = document.getElementById("flow-maintenance-overlay");
    if (el) el.remove();
  }

  function createMaintenanceOverlay() {
    if (document.getElementById("flow-maintenance-overlay")) return;

    const host = document.createElement("div");
    host.id = "flow-maintenance-overlay";

    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      zIndex: "2147483647"
    });

    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });

    shadow.innerHTML = `
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        :root {
          --page: #202124;
          --surface: #0f1011;
          --text: #e8eaed;
          --muted: #bdc1c6;
          --border: #5f6368;
          --link: #a8c7fa;
          --btn: #a8c7fa;
          --btn-text: #062e6f;
        }

        .overlay {
          position: fixed;
          inset: 0;
          width: 100%;
          height: 100%;
          background: #202124;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: "Google Sans", Arial, sans-serif;
          color: #e8eaed;
        }

        .card {
          width: min(1040px, calc(100% - 36px));
          min-height: 400px;
          background: #0f1011;
          border-radius: 28px;
          position: relative;
          overflow: hidden;
          display: grid;
          grid-template-columns: 1fr 1fr;
        }

        .progress {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 4px;
          overflow: hidden;
          z-index: 20;
        }

        .progress::after {
          content: "";
          position: absolute;
          top: 0;
          left: -40%;
          width: 35%;
          height: 100%;
          background: #a8c7fa;
          animation: loading 1.5s cubic-bezier(.4, 0, .2, 1) infinite;
        }

        @keyframes loading {
          0% { left: -40%; width: 35%; }
          45% { left: 25%; width: 42%; }
          100% { left: 100%; width: 35%; }
        }

        .left {
          padding: 38px 36px;
          color: #e8eaed;
        }

        .logo {
          width: 40px;
          height: 40px;
          object-fit: contain;
          display: block;
          margin-bottom: 30px;
        }

        h1 {
          font-size: 36px;
          line-height: 44px;
          font-weight: 400;
          letter-spacing: -.5px;
          margin-bottom: 16px;
        }

        .description {
          max-width: 390px;
          color: #bdc1c6;
          font-size: 16px;
          line-height: 24px;
        }

        .right {
          padding: 36px 36px 36px 36px;
          position: relative;
          overflow: hidden;
          color: #e8eaed;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
        }

        .icon-container {
          margin: 0 auto 24px;
          width: 64px;
          height: 64px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #1c1f24;
          border-radius: 50%;
        }

        .icon-container svg {
          width: 32px;
          height: 32px;
          stroke: #a8c7fa;
        }

        .right-text {
          font-size: 18px;
          font-weight: 500;
          color: #e8eaed;
          margin-bottom: 8px;
        }

        .right-subtext {
          font-size: 14px;
          color: #bdc1c6;
          max-width: 300px;
          line-height: 1.5;
        }

        @media(max-width:900px) {
          .left { padding: 38px 30px; }
          .right { padding: 60px 30px 36px 30px; }
        }

        @media(max-width:600px) {
          .overlay { 
            align-items: center; 
            padding: 16px; 
          }
          .card { 
            width: 100%; 
            min-height: auto; 
            border-radius: 16px; 
            display: flex; 
            flex-direction: column; 
          }
          .left { 
            padding: 32px 24px 24px 24px; 
          }
          .logo { 
            width: 36px; 
            height: 36px; 
            margin-bottom: 24px; 
          }
          h1 { 
            font-size: 24px; 
            line-height: 32px; 
            margin-bottom: 12px; 
          }
          .description { 
            max-width: 100%; 
            font-size: 14px; 
            line-height: 22px; 
          }
          .right { 
            padding: 24px; 
            border-top: 1px solid #3c4043;
            background: #141516;
          }
          .icon-container { 
            width: 56px; 
            height: 56px; 
            margin-bottom: 16px;
          }
          .icon-container svg { 
            width: 28px; 
            height: 28px; 
          }
          .right-text { 
            font-size: 16px; 
          }
          .right-subtext { 
            font-size: 13px; 
            max-width: 100%;
          }
          .progress { 
            height: 3px; 
          }
        }
      </style>
      
      <div class="overlay">
        <section class="card">
          <div class="progress"></div>

          <!-- LEFT -->
          <div class="left">
            <img class="logo" src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg" alt="Google">
            <h1>System updating</h1>
            <div class="description">
              We're currently updating our system with new Ultra accounts.<br><br>
              Please wait a moment while we configure your session.
            </div>
          </div>

          <!-- RIGHT -->
          <div class="right">
            <div class="icon-container">
              <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
              </svg>
            </div>
            <div class="right-text">Configuring Ultra accounts</div>
            <div class="right-subtext">This process happens securely in the background. Access will be restored shortly.</div>
          </div>
        </section>
      </div>
    `;
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.flow_maintenance_mode) {
      if (changes.flow_maintenance_mode.newValue) {
        createMaintenanceOverlay();
      } else {
        removeMaintenanceOverlay();
      }
    }
  });

  chrome.storage.local.get(['flow_maintenance_mode'], (data) => {
    if (data.flow_maintenance_mode) {
      createMaintenanceOverlay();
    }
  });
})();
