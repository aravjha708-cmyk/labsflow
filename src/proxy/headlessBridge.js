const config = require('../config');

let browser = null;
let page = null;
let isInitializing = false;
let initPromise = null;

/**
 * Finds local Chrome/Chromium executable path for development (Windows/Mac/Linux)
 */
function getLocalChromePath() {
  const os = process.platform;
  if (os === 'win32') {
    const paths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    const fs = require('fs');
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
  } else if (os === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  } else {
    return '/usr/bin/google-chrome' || '/usr/bin/chromium-browser' || '/usr/bin/chromium';
  }
  return null;
}

/**
 * Initializes a persistent Headless Browser instance sitting on genuine labs.google origin
 */
async function initHeadlessBridge() {
  if (page && browser && browser.isConnected()) return page;
  if (isInitializing && initPromise) return initPromise;

  isInitializing = true;
  initPromise = (async () => {
    try {
      console.log('[Headless Bridge] Initializing Headless Google Labs context...');
      const puppeteer = require('puppeteer-core');
      let chromium = null;
      try {
        chromium = require('@sparticuz/chromium');
      } catch (_) {}

      let executablePath = null;
      let launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1280,800'
      ];

      if (chromium && process.platform === 'linux') {
        executablePath = await chromium.executablePath();
        launchArgs = chromium.args;
      } else {
        executablePath = getLocalChromePath();
      }

      if (!executablePath) {
        console.warn('[Headless Bridge] No Chrome/Chromium executable found on host system.');
        isInitializing = false;
        return null;
      }

      browser = await puppeteer.launch({
        args: launchArgs,
        defaultViewport: { width: 1280, height: 800 },
        executablePath: executablePath,
        headless: true
      });

      page = await browser.newPage();

      // Set user agent
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      );

      // Set Google master session cookies on labs.google domain
      if (config.sessionCookies) {
        const rawCookies = config.sessionCookies.split(';');
        const cookieList = [];
        for (const c of rawCookies) {
          const idx = c.indexOf('=');
          if (idx > 0) {
            const name = c.substring(0, idx).trim();
            const value = c.substring(idx + 1).trim();
            if (name && value) {
              cookieList.push({
                name,
                value,
                domain: 'labs.google',
                path: '/',
                secure: true,
                httpOnly: name.startsWith('__Secure-') || name.startsWith('__Host-')
              });
            }
          }
        }

        if (cookieList.length > 0) {
          await page.setCookie(...cookieList);
          console.log(`[Headless Bridge] Set ${cookieList.length} cookies on labs.google domain`);
        }
      }

      // Navigate to Google Labs Flow to establish authentic origin & reCAPTCHA runtime
      console.log('[Headless Bridge] Navigating to https://labs.google/fx/tools/flow...');
      await page.goto('https://labs.google/fx/tools/flow', {
        waitUntil: 'networkidle2',
        timeout: 30000
      }).catch(err => {
        console.warn('[Headless Bridge] Navigation notice:', err.message);
      });

      console.log('[Headless Bridge] Genuine labs.google origin successfully established!');
      isInitializing = false;
      return page;
    } catch (err) {
      console.error('[Headless Bridge] Initialization error:', err.message);
      isInitializing = false;
      return null;
    }
  })();

  return initPromise;
}

/**
 * Executes Google AI Sandbox request inside the authentic labs.google browser context
 */
async function executeGoogleApiInBrowser(targetUrl, method, headers, requestBody) {
  try {
    const activePage = await initHeadlessBridge();
    if (!activePage) {
      return null; // Fallback to HTTP proxy
    }

    const result = await activePage.evaluate(
      async (url, httpMethod, customHeaders, bodyData) => {
        try {
          const fetchOptions = {
            method: httpMethod,
            headers: customHeaders || {}
          };

          if (bodyData && !['GET', 'HEAD', 'OPTIONS'].includes(httpMethod)) {
            fetchOptions.body = typeof bodyData === 'object' ? JSON.stringify(bodyData) : bodyData;
          }

          const res = await window.fetch(url, fetchOptions);
          const status = res.status;
          const statusText = res.statusText;
          const resHeaders = {};
          res.headers.forEach((v, k) => {
            resHeaders[k] = v;
          });

          let data;
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            data = await res.json();
          } else {
            data = await res.text();
          }

          return { success: true, status, statusText, headers: resHeaders, data };
        } catch (fetchErr) {
          return { success: false, error: fetchErr.message };
        }
      },
      targetUrl,
      method,
      headers,
      requestBody
    );

    return result;
  } catch (err) {
    console.error('[Headless Bridge] Execution failed:', err.message);
    return null;
  }
}

module.exports = {
  initHeadlessBridge,
  executeGoogleApiInBrowser
};
