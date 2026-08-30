const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');
const config = require('../config');
const { parseCookies, generateSetCookieHeaders, generateClearCookieHeaders } = require('./cookieHelper');
const { extractAuthInfo } = require('./googleAuthHelper');
const { publicHttpsAgent } = require('./dnsHelper');
const userManager = require('../auth/userManager');

/**
 * High-Performance Reverse Proxy for Google Labs Flow
 * - Ultra-fast streaming for assets, TRPC, media, and Next.js chunks (selfHandleResponse: false)
 * - Lightweight script injection ONLY for initial HTML documents
 */
function createFlowProxy() {
  // Common proxy configuration
  const commonOptions = {
    target: config.targetUrl,
    changeOrigin: true,
    secure: true,
    agent: publicHttpsAgent,
    ws: true,
    on: {
      proxyReq: (proxyReq, req, res) => {
        try {
          const targetUrl = new URL(config.targetUrl);
          proxyReq.setHeader('Host', targetUrl.host);

          if (req.headers['origin']) {
            proxyReq.setHeader('Origin', config.targetUrl);
          } else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
            proxyReq.setHeader('Origin', config.targetUrl);
          }

          proxyReq.setHeader('Referer', `${config.targetUrl}${config.targetDefaultPath}`);

          // Strictly use ONLY the Master Session Cookies configured in Admin API Management!
          // Client browser cookies must NEVER leak into the Google upstream request.
          const activeMasterCookies = (config.sessionCookies || '').trim();
          
          if (activeMasterCookies) {
            proxyReq.setHeader('Cookie', activeMasterCookies);

            // If master session has SAPISID, attach calculated Google 1-SAPISIDAUTH hash
            const authInfo = extractAuthInfo(activeMasterCookies);
            if (authInfo && authInfo.sapisidHash) {
              proxyReq.setHeader('Authorization', authInfo.sapisidHash);
              proxyReq.setHeader('X-Goog-AuthUser', '0');
            } else if (config.apiToken) {
              proxyReq.setHeader('Authorization', config.apiToken.startsWith('Bearer ') ? config.apiToken : `Bearer ${config.apiToken}`);
            }
          } else {
            // If blank in admin config, send NO cookies and NO authorization to Google
            proxyReq.removeHeader('Cookie');
            if (config.apiToken) {
              proxyReq.setHeader('Authorization', config.apiToken.startsWith('Bearer ') ? config.apiToken : `Bearer ${config.apiToken}`);
            } else {
              proxyReq.removeHeader('Authorization');
            }
          }

          proxyReq.setHeader(
            'User-Agent',
            req.headers['user-agent'] ||
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          );

          if (req.body && Object.keys(req.body).length > 0) {
            const bodyData = typeof req.body === 'string' ? req.body : (Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body));
            proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
            proxyReq.write(bodyData);
          }
        } catch (err) {
          // ignore
        }
      },
      proxyRes: (proxyRes, req, res) => {
        // Strip restrictive security headers for smooth embedding
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['content-security-policy'];
        delete proxyRes.headers['content-security-policy-report-only'];
        delete proxyRes.headers['cross-origin-opener-policy'];
        delete proxyRes.headers['cross-origin-embedder-policy'];
        delete proxyRes.headers['cross-origin-resource-policy'];

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        res.setHeader('Access-Control-Allow-Headers', '*');

        // Rewrite redirect Location headers
        if (proxyRes.headers['location']) {
          const clientHost = req.headers['x-forwarded-host'] || req.headers['host'] || 'labs.google:3000';
          const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
          proxyRes.headers['location'] = proxyRes.headers['location'].replace(
            /https?:\/\/labs\.google(?::\d+)?/gi,
            `${proto}://${clientHost}`
          );
        }

        // Clean Set-Cookie headers
        const rawSetCookie = proxyRes.headers['set-cookie'];
        if (rawSetCookie) {
          const list = Array.isArray(rawSetCookie) ? rawSetCookie : [rawSetCookie];
          proxyRes.headers['set-cookie'] = list.map(c =>
            c.replace(/Domain=[^;]+;?/i, '')
              .replace(/SameSite=None;?/i, 'SameSite=Lax;')
          );
        }
      },
      error: (err, req, res) => {
        if (!res.headersSent) {
          res.status(502).send('Proxy gateway error: ' + err.message);
        }
      }
    }
  };

  // 1. Ultra-fast direct streaming proxy for assets, API calls, and Next.js chunks
  const streamProxy = createProxyMiddleware({
    ...commonOptions,
    selfHandleResponse: false // DIRECT ZERO-BUFFERING TCP STREAMING
  });

  // 2. HTML-only interceptor proxy for initial page load script injection
  const htmlProxy = createProxyMiddleware({
    ...commonOptions,
    selfHandleResponse: true,
    on: {
      ...commonOptions.on,
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        const contentType = proxyRes.headers['content-type'] || '';
        if (!contentType.includes('text/html')) {
          return responseBuffer;
        }

        // Strip headers
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['content-security-policy'];
        delete proxyRes.headers['content-security-policy-report-only'];

        res.setHeader('Access-Control-Allow-Origin', '*');

        // Rewrite redirect Location headers
        if (proxyRes.headers['location']) {
          const clientHost = req.headers['x-forwarded-host'] || req.headers['host'] || 'labs.google:3000';
          const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
          res.setHeader(
            'location',
            proxyRes.headers['location'].replace(/https?:\/\/labs\.google(?::\d+)?/gi, `${proto}://${clientHost}`)
          );
        }

        // Dynamic Set-Cookie injection from Admin API Management configuration
        const activeCookies = (config.sessionCookies || '').trim();
        const parsedMaster = parseCookies(activeCookies);
        if (parsedMaster.length > 0) {
          const masterSetCookies = generateSetCookieHeaders(parsedMaster);
          res.setHeader('set-cookie', masterSetCookies);
        } else {
          // If blank in admin config, send clear headers to wipe all Google cookies from browser
          const clearCookies = generateClearCookieHeaders();
          res.setHeader('set-cookie', clearCookies);
        }

        // Resolve logged-in user email & name from session cookie
        let activeUserEmail = 'user@flowlabs.ai';
        let activeUserName = 'User';
        const cookieHeader = req.headers['cookie'] || '';
        const sessionMatch = cookieHeader.match(/flow_gate_session=([^;]+)/);
        if (sessionMatch) {
          const userObj = userManager.getUserById(sessionMatch[1]);
          if (userObj && userObj.email) {
            activeUserEmail = userObj.email;
            activeUserName = userObj.name || userObj.email.split('@')[0];
            activeUserName = activeUserName.charAt(0).toUpperCase() + activeUserName.slice(1);
          }
        }

        try {
          let html = responseBuffer.toString('utf8');

          // Replace master Google email with real logged-in user email in initial HTML
          html = html.replace(/anishbhai7376@gmail\.com/gi, activeUserEmail)
            .replace(/anishbhai7376/gi, activeUserEmail.split('@')[0]);

          const injectionScript = `
            <script id="__flow_proxy_network_hook">
              (function() {
                try {
                  const SERVER_USER_EMAIL = ${JSON.stringify(activeUserEmail)};
                  const SERVER_USER_NAME = ${JSON.stringify(activeUserName)};

                  try {
                    if (SERVER_USER_EMAIL && SERVER_USER_EMAIL !== 'user@flowlabs.ai') {
                      localStorage.setItem('flow_user_email', SERVER_USER_EMAIL);
                      localStorage.setItem('flow_user_name', SERVER_USER_NAME);
                    }
                  } catch(_) {}

                  const cookies = ${JSON.stringify(parsedMaster)};
                  cookies.forEach(function(c) {
                    document.cookie = c.name + "=" + c.value + "; path=/; max-age=2592000; Secure; SameSite=Lax";
                    if (c.name.startsWith('__Secure-')) {
                      document.cookie = c.name.replace('__Secure-', '') + "=" + c.value + "; path=/; max-age=2592000; Secure; SameSite=Lax";
                    }
                    if (c.name.startsWith('__Host-')) {
                      document.cookie = c.name.replace('__Host-', '') + "=" + c.value + "; path=/; max-age=2592000; Secure; SameSite=Lax";
                    }
                  });

                  // Network-level Project Filter for JSON responses
                  function filterProjectData(data, myIds) {
                    if (!data || typeof data !== 'object') return data;
                    if (Array.isArray(data)) {
                      const isProjArr = data.some(function(it) {
                        return it && (it.projectId || it.id || (typeof it.name === 'string' && it.name.length > 20));
                      });
                      if (isProjArr) {
                        return data.filter(function(it) {
                          const id = it.projectId || it.id;
                          return id ? myIds.includes(id) : true;
                        });
                      }
                      return data.map(function(it) { return filterProjectData(it, myIds); });
                    }
                    const copy = Array.isArray(data) ? [...data] : Object.assign({}, data);
                    for (const key of Object.keys(copy)) {
                      if (Array.isArray(copy[key])) {
                        const isList = copy[key].some(function(it) {
                          return it && (it.projectId || it.id);
                        });
                        if (isList) {
                          copy[key] = copy[key].filter(function(it) {
                            const id = it.projectId || it.id;
                            return id ? myIds.includes(id) : true;
                          });
                        } else {
                          copy[key] = filterProjectData(copy[key], myIds);
                        }
                      } else if (typeof copy[key] === 'object' && copy[key] !== null) {
                        copy[key] = filterProjectData(copy[key], myIds);
                      }
                    }
                    return copy;
                  }

                  // Complete Redux DevTools Extension mock with .connect() to prevent Zustand / Next.js hydration exceptions
                  if (!window.__REDUX_DEVTOOLS_EXTENSION__) {
                    window.__REDUX_DEVTOOLS_EXTENSION__ = {
                      connect: function() {
                        return {
                          init: function() {},
                          send: function() {},
                          subscribe: function() { return function() {}; },
                          unsubscribe: function() {},
                          error: function() {}
                        };
                      }
                    };
                  }

                  const originalFetch = window.fetch;
                  window.fetch = async function(resource, init) {
                    let url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');

                    // Fast-path: cleanly resolve tRPC background telemetry without parser errors
                    if (url && (
                      url.includes('general.submitBatchLog') ||
                      url.includes('general.reportClientSideError')
                    )) {
                      const isBatch = url.includes('batch=1');
                      const data = isBatch
                        ? [{ result: { data: { json: null } } }]
                        : { result: { data: { json: null } } };
                      return new Response(JSON.stringify(data), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                      });
                    }

                    if (url && (
                      url.includes('batchLogFrontendEvents') ||
                      url.includes('feedback-pa.clients6.google.com') ||
                      url.includes('survey/trigger')
                    )) {
                      return new Response(JSON.stringify({}), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                      });
                    }
                    
                    if (url && (
                      url.includes('aisandbox-pa.googleapis.com') || 
                      url.includes('clients6.google.com')
                    )) {
                      // Direct-to-Cloudflare-Worker: browser calls CF Worker directly,
                      // forwarding ALL original headers (including x-goog-recaptcha-token)
                      try {
                        if (!window.__flowBearerToken || !window.__flowBearerExpiry || Date.now() > window.__flowBearerExpiry) {
                          const tokenRes = await originalFetch.call(this, '/api/auth/bearer-token');
                          if (tokenRes.ok) {
                            const tokenData = await tokenRes.json();
                            window.__flowBearerToken = tokenData.token;
                            window.__flowProxyUrl = tokenData.proxyUrl || 'https://flow-proxy.aravjha708.workers.dev';
                            window.__flowBearerExpiry = Date.now() + 40 * 60 * 1000;
                          }
                        }

                        if (window.__flowBearerToken && window.__flowProxyUrl) {
                          const cfUrl = window.__flowProxyUrl.replace(/\\/+$/, '') + '?_target_url=' + encodeURIComponent(url);

                          // Collect ALL original headers from the request (preserves reCAPTCHA, x-goog-*, etc.)
                          const mergedHeaders = {};
                          if (init && init.headers) {
                            const h = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
                            h.forEach(function(v, k) { mergedHeaders[k] = v; });
                          } else if (resource && typeof resource !== 'string' && resource.headers) {
                            const h = resource.headers instanceof Headers ? resource.headers : new Headers(resource.headers);
                            h.forEach(function(v, k) { mergedHeaders[k] = v; });
                          }
                          // Override auth but keep everything else (reCAPTCHA tokens, content-type, x-goog-*)
                          mergedHeaders['Authorization'] = 'Bearer ' + window.__flowBearerToken;
                          mergedHeaders['Origin'] = 'https://labs.google';
                          mergedHeaders['Referer'] = 'https://labs.google/';

                          const directInit = {
                            method: (init && init.method) || (resource && resource.method) || 'GET',
                            headers: mergedHeaders,
                          };
                          if (init && init.body) {
                            directInit.body = init.body;
                          } else if (resource && typeof resource !== 'string' && resource.body) {
                            directInit.body = resource.body;
                          }
                          const directRes = await originalFetch.call(this, cfUrl, directInit);
                          if (directRes.ok || directRes.status < 500) {
                            return directRes;
                          }
                        }
                      } catch (cfErr) {
                        console.warn('[Flow] Direct CF Worker call failed, falling back to server proxy:', cfErr.message);
                      }

                      // Fallback: route through server proxy
                      const proxyUrl = '/__google_api_proxy?_target_url=' + encodeURIComponent(url);
                      if (typeof resource === 'string') {
                        resource = proxyUrl;
                      } else if (resource && resource.url) {
                        try {
                          resource = new Request(proxyUrl, resource);
                        } catch (_) {
                          resource = proxyUrl;
                        }
                      }
                    }
                    
                    const response = await originalFetch.call(this, resource, init);
                    
                    // Native Network-Level Patching for Projects & User Profile
                    try {
                      const userEmail = SERVER_USER_EMAIL || localStorage.getItem('flow_user_email') || 'user@flowlabs.ai';
                      const userName = SERVER_USER_NAME || localStorage.getItem('flow_user_name') || userEmail.split('@')[0];
                      const isDashboard = window.location.pathname.endsWith('/flow') || window.location.pathname.endsWith('/flow/');
                      const isProjEndpoint = url.includes('sessions') || url.includes('applets') || url.includes('flowWorkflows') || url.includes('projects') || url.includes('trpc') || url.includes('user') || url.includes('auth');

                      if (response && response.ok && isProjEndpoint) {
                        const clone = response.clone();
                        const ct = clone.headers.get('content-type') || '';
                        if (ct.includes('application/json') || ct.includes('text/plain')) {
                          let rawText = await clone.text();

                          // 1. Deep replace Google profile email & name at network layer
                          rawText = rawText.replace(/anishbhai7376@gmail\.com/gi, userEmail)
                                           .replace(/"Anish"/g, JSON.stringify(userName));

                          // 2. Filter projects on dashboard
                          if (isDashboard) {
                            try {
                              const json = JSON.parse(rawText);
                              const myIds = getMyProjectIds();
                              if (json && (json.projectId || (json.project && json.project.id))) {
                                const pId = json.projectId || (json.project && json.project.id);
                                if (pId) trackUserProject(pId);
                              }
                              const filteredJson = filterProjectData(json, myIds);
                              rawText = JSON.stringify(filteredJson);
                            } catch(_) {}
                          }

                          return new Response(rawText, {
                            status: response.status,
                            statusText: response.statusText,
                            headers: response.headers
                          });
                        }
                      }
                    } catch(_) {}

                    return response;
                  };

                  // Suppress survey triggers in sendBeacon
                  if (navigator.sendBeacon) {
                    const origBeacon = navigator.sendBeacon;
                    navigator.sendBeacon = function(url, data) {
                      if (typeof url === 'string' && (url.includes('feedback-pa') || url.includes('survey/trigger'))) {
                        return true;
                      }
                      return origBeacon.call(navigator, url, data);
                    };
                  }

                  const originalOpen = XMLHttpRequest.prototype.open;
                  const originalSend = XMLHttpRequest.prototype.send;
                  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                    this._url = typeof url === 'string' ? url : '';
                    if (this._url) {
                      if (this._url.includes('feedback-pa.clients6.google.com') || this._url.includes('survey/trigger')) {
                        return;
                      }
                      if (
                        this._url.includes('aisandbox-pa.googleapis.com') || 
                        this._url.includes('clients6.google.com')
                      ) {
                        url = '/__google_api_proxy?_target_url=' + encodeURIComponent(this._url);
                      }
                    }
                    return originalOpen.call(this, method, url, ...rest);
                  };

                  XMLHttpRequest.prototype.send = function(...args) {
                    if (this._url && (this._url.includes('feedback-pa') || this._url.includes('survey/trigger'))) {
                      return;
                    }
                    return originalSend.apply(this, args);
                  };

                  // ==========================================
                  // USER PROJECT ISOLATION & DASHBOARD PRIVACY
                  // ==========================================
                  const STORAGE_KEY = 'flow_my_created_projects';

                  function getMyProjectIds() {
                    try {
                      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
                    } catch(_) {
                      return [];
                    }
                  }

                  function trackUserProject(projectId) {
                    if (!projectId || typeof projectId !== 'string') return;
                    const id = projectId.trim();
                    const list = getMyProjectIds();
                    if (!list.includes(id)) {
                      list.push(id);
                      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
                    }
                  }

                  // Auto-detect project ID from current URL (e.g. /fx/tools/flow/project/UUID)
                  function checkCurrentProjectUrl() {
                    try {
                      const projRegex = new RegExp('/project/([a-zA-Z0-9_-]+)');
                      const match = window.location.pathname.match(projRegex) ||
                                    window.location.search.match(/[?&]projectId=([a-zA-Z0-9_-]+)/);
                      if (match && match[1]) {
                        trackUserProject(match[1]);
                      }
                    } catch(_) {}
                  }

                  checkCurrentProjectUrl();
                  window.addEventListener('popstate', checkCurrentProjectUrl);

                  // Filter dashboard project list: ONLY display user's own created projects
                  function filterDashboardProjects() {
                    try {
                      const isDashboard = window.location.pathname.endsWith('/flow') || window.location.pathname.endsWith('/flow/');
                      if (!isDashboard) return;

                      const myIds = getMyProjectIds();
                      const projRegex = new RegExp('/project/([a-zA-Z0-9_-]+)');

                      // Find all project links / cards in the DOM
                      const projectElements = document.querySelectorAll('a[href*="/project/"], [data-project-id], [data-id]');
                      projectElements.forEach(function(el) {
                        const href = el.getAttribute('href') || el.getAttribute('data-project-id') || el.getAttribute('data-id') || '';
                        const match = href.match(projRegex) || [null, href];
                        const pId = match[1];

                        if (pId && pId.length > 5) {
                          let card = el.closest('li, [role="listitem"]') || el.parentElement || el;

                          if (!myIds.includes(pId)) {
                            card.style.setProperty('display', 'none', 'important');
                            el.style.setProperty('display', 'none', 'important');
                          } else {
                            card.style.removeProperty('display');
                            el.style.removeProperty('display');
                          }
                        }
                      });
                    } catch(_) {}
                  }

                  // ==========================================
                  // INSTANT USER PROFILE MASKING (Zero-Flicker & Zero-Loop)
                  // ==========================================
                  let isMasking = false;
                  function maskUserProfile() {
                    if (isMasking) return;
                    isMasking = true;

                    try {
                      const storedEmail = localStorage.getItem('flow_user_email');
                      const userEmail = (storedEmail && storedEmail !== 'user@flowlabs.ai') 
                        ? storedEmail 
                        : (SERVER_USER_EMAIL && SERVER_USER_EMAIL !== 'user@flowlabs.ai' ? SERVER_USER_EMAIL : (storedEmail || 'user@flowlabs.ai'));
                      
                      const storedName = localStorage.getItem('flow_user_name');
                      const userName = (storedName && storedName !== 'User') 
                        ? storedName 
                        : (SERVER_USER_NAME && SERVER_USER_NAME !== 'User' ? SERVER_USER_NAME : (userEmail.split('@')[0] || 'User'));
                      
                      const initial = userName.charAt(0).toUpperCase();

                      // 1. Target specific profile menus, headers, and dialogs
                      const containers = document.querySelectorAll('header, nav, [role="menu"], [role="dialog"], [data-radix-popper-content-wrapper], div[class*="profile" i], div[class*="user" i], div[class*="account" i]');
                      containers.forEach(function(c) {
                        const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, null, false);
                        let node;
                        while (node = walker.nextNode()) {
                          if (node.nodeValue) {
                            if (node.nodeValue.includes('anishbhai7376@gmail.com') || node.nodeValue.includes('anishbhai') || (node.nodeValue.includes('@gmail.com') && !node.nodeValue.includes('feedback') && !node.nodeValue.includes('google')) || (userEmail !== 'user@flowlabs.ai' && node.nodeValue.includes('user@flowlabs.ai'))) {
                              node.nodeValue = node.nodeValue.replace(/[\w.-]+@gmail\.com/gi, userEmail).replace(/user@flowlabs\.ai/gi, userEmail).replace(/anishbhai7376/gi, userEmail.split('@')[0]);
                            }
                            if (node.nodeValue.trim() === 'Anish' || node.nodeValue.trim() === 'anish' || (userName !== 'User' && node.nodeValue.trim() === 'User')) {
                              node.nodeValue = userName;
                            }
                          }
                        }
                      });

                      // 2. Profile Avatar Image Override
                      const profileImgs = document.querySelectorAll('img[alt*="profile" i], img[alt*="User" i], img[src*="googleusercontent.com"]');
                      profileImgs.forEach(function(img) {
                        if (img.getAttribute('data-masked') !== '1') {
                          img.setAttribute('data-masked', '1');
                          img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(
                            '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#3b82f6"/><text x="50%" y="54%" font-family="Arial,sans-serif" font-weight="bold" font-size="28" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">' + initial + '</text></svg>'
                          );
                        }
                      });

                      // 3. Tooltips, Titles, and Aria Labels
                      const labeledEls = document.querySelectorAll('[aria-label*="@gmail.com"], [title*="@gmail.com"], [aria-label*="Anish"], [title*="Anish"]');
                      labeledEls.forEach(function(el) {
                        ['aria-label', 'title'].forEach(function(attr) {
                          const val = el.getAttribute(attr);
                          if (val && (val.includes('@gmail.com') || val.includes('Anish'))) {
                            el.setAttribute(attr, val.replace(/[\w.-]+@gmail\.com/gi, userEmail).replace(/Anish/gi, userName));
                          }
                        });
                      });

                      // 4. Remove [Manage membership] button (Keep Sign out visible!)
                      const actionEls = document.querySelectorAll('button, a, div[role="menuitem"], div[role="button"], span');
                      actionEls.forEach(function(el) {
                        const t = (el.textContent || '').trim().toLowerCase();
                        if (t === 'manage membership' || t.includes('manage membership') || t === 'switch account') {
                          const item = el.closest('button, a, li, [role="menuitem"], div[class*="item" i]') || el;
                          item.style.setProperty('display', 'none', 'important');
                        }
                      });

                      // 5. Make more_vert 3-dots button unclickable / hidden
                      const moreVertIcons = document.querySelectorAll('i, [type="button"], [aria-haspopup="menu"]');
                      moreVertIcons.forEach(function(el) {
                        const txt = (el.textContent || '').trim();
                        if (txt === 'more_vert' || (el.getAttribute && el.getAttribute('aria-haspopup') === 'menu' && txt.includes('more_vert'))) {
                          const target = el.closest('button, [role="button"], i') || el;
                          target.style.setProperty('pointer-events', 'none', 'important');
                          target.style.setProperty('cursor', 'default', 'important');
                          target.style.setProperty('display', 'none', 'important');
                          target.setAttribute('tabindex', '-1');
                          target.setAttribute('disabled', 'true');
                        }
                      });
                    } catch(_) {} finally {
                      isMasking = false;
                    }
                  }

                  // Intercept clicks: custom Sign Out & block more_vert
                  document.addEventListener('click', function(e) {
                    try {
                      // Custom Sign Out Handler
                      const signoutEl = e.target.closest('button, a, div[role="menuitem"], div[role="button"], span, li');
                      if (signoutEl) {
                        const txt = (signoutEl.textContent || '').trim().toLowerCase();
                        if (txt === 'sign out' || txt === 'sign out of all accounts' || txt.includes('sign out')) {
                          e.preventDefault();
                          e.stopPropagation();
                          e.stopImmediatePropagation();

                          // Clear Flow Labs session
                          document.cookie = 'flow_gate_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0';
                          try {
                            localStorage.removeItem('flow_user_email');
                            localStorage.removeItem('flow_user_name');
                            sessionStorage.clear();
                          } catch(_) {}

                          window.location.href = '/login';
                          return false;
                        }
                      }

                      // Block more_vert button
                      const el = e.target.closest('i, button, [role="button"], div');
                      if (el && (el.textContent || '').trim() === 'more_vert') {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        return false;
                      }
                    } catch(_) {}
                  }, true);

                  // ==========================================
                  // VIDEO MODEL SELECTION FILTER & CUSTOM BRANDING
                  // Strictly hide all non-LP models. Only show "Veo 3.1 by Labs Flow"
                  // ==========================================
                  let hasAutoSelectedLp = false;
                  const BRAND_MODEL_NAME = 'Veo 3.1 by Labs Flow';

                  function filterModelDropdown() {
                    try {
                      const isLowerPriority = /lower.{0,5}priority/i;

                      // 1. Target all dropdown options/menuitems
                      const options = document.querySelectorAll('[role="option"], [role="menuitem"], [role="listitem"], li');
                      let lpOption = null;

                      options.forEach(function(opt) {
                        // Store the original model name once
                        if (!opt.hasAttribute('data-orig-model')) {
                          opt.setAttribute('data-orig-model', (opt.textContent || '').trim());
                        }
                        const origText = opt.getAttribute('data-orig-model') || '';
                        if (!origText) return;

                        if (/veo|omni/i.test(origText)) {
                          const isLp = isLowerPriority.test(origText);
                          if (!isLp) {
                            // HIDE all other models completely
                            opt.style.setProperty('display', 'none', 'important');
                            opt.style.setProperty('visibility', 'hidden', 'important');
                            opt.style.setProperty('height', '0px', 'important');
                            opt.style.setProperty('overflow', 'hidden', 'important');
                          } else {
                            // KEEP and rename ONLY the Lower Priority option
                            opt.style.removeProperty('display');
                            opt.style.removeProperty('visibility');
                            opt.style.removeProperty('height');
                            opt.style.removeProperty('overflow');
                            lpOption = opt;

                            const walker = document.createTreeWalker(opt, NodeFilter.SHOW_TEXT, null, false);
                            let node;
                            while (node = walker.nextNode()) {
                              if (/veo/i.test(node.nodeValue) || /lower/i.test(node.nodeValue) || /lite/i.test(node.nodeValue)) {
                                node.nodeValue = BRAND_MODEL_NAME;
                              }
                            }
                          }
                        }
                      });

                      // 2. If dropdown is open and LP option exists, click it to auto-select
                      if (lpOption && !hasAutoSelectedLp) {
                        try {
                          lpOption.click();
                          hasAutoSelectedLp = true;
                        } catch(_) {}
                      }

                      // 3. Ensure the model trigger button in prompt bar displays "Veo 3.1 by Labs Flow" & remove menu trigger
                      const buttons = document.querySelectorAll('button, [role="button"], [role="combobox"]');
                      buttons.forEach(function(btn) {
                        const txt = (btn.textContent || '').trim();
                        if (/omni|veo|flash|quality|fast|lite|lower.{0,5}priority|labs\s*flow/i.test(txt)) {
                          if (!txt.includes('Create') && !txt.includes('Generate') && !txt.includes('Images') && !txt.includes('Videos')) {
                            // Strip Radix menu popup attributes
                            btn.removeAttribute('aria-haspopup');
                            btn.removeAttribute('aria-expanded');
                            btn.removeAttribute('data-state');
                            btn.style.setProperty('pointer-events', 'none', 'important');

                            // Hide the arrow_drop_down icon
                            const arrowIcon = btn.querySelector('i');
                            if (arrowIcon && (arrowIcon.textContent || '').includes('arrow_drop_down')) {
                              arrowIcon.style.setProperty('display', 'none', 'important');
                            }

                            // Disable button-overlay
                            const overlay = btn.querySelector('[data-type="button-overlay"]');
                            if (overlay) {
                              overlay.style.setProperty('pointer-events', 'none', 'important');
                            }

                            const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT, null, false);
                            let node;
                            while (node = walker.nextNode()) {
                              if (/omni|veo|flash|quality|fast|lite|lower.{0,5}priority/i.test(node.nodeValue)) {
                                node.nodeValue = BRAND_MODEL_NAME;
                              }
                            }
                          }
                        }
                      });
                    } catch(_) {}
                  }

                  // Global capture-phase blocker for model button
                  ['click', 'mousedown', 'pointerdown', 'mouseup', 'pointerup'].forEach(function(evName) {
                    window.addEventListener(evName, function(e) {
                      try {
                        const btn = e.target.closest('button, [role="button"], [role="combobox"]');
                        if (btn) {
                          const txt = (btn.textContent || '').trim();
                          if ((/labs\s*flow|veo\s*3\.1|omni/i.test(txt) || /lower.{0,5}priority/i.test(txt)) && !txt.includes('Create') && !txt.includes('Generate') && !txt.includes('Images') && !txt.includes('Videos')) {
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();
                            return false;
                          }
                        }
                      } catch(_) {}
                    }, true);
                  });

                  // ==========================================
                  // REAL-TIME SYSTEM MAINTENANCE OVERLAY
                  // ==========================================
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

                    (document.body || document.documentElement).appendChild(host);
                    const shadow = host.attachShadow({ mode: "open" });

                    shadow.innerHTML = [
                      '<style>',
                      '* { box-sizing: border-box; margin: 0; padding: 0; }',
                      ':root { --page: #202124; --surface: #0f1011; --text: #e8eaed; --muted: #bdc1c6; --border: #5f6368; --link: #a8c7fa; --btn: #a8c7fa; --btn-text: #062e6f; }',
                      '.overlay { position: fixed; inset: 0; width: 100%; height: 100%; background: #202124; display: flex; align-items: center; justify-content: center; font-family: "Google Sans", Arial, sans-serif; color: #e8eaed; }',
                      '.card { width: min(1040px, calc(100% - 36px)); min-height: 400px; background: #0f1011; border-radius: 28px; position: relative; overflow: hidden; display: grid; grid-template-columns: 1fr 1fr; }',
                      '.progress { position: absolute; top: 0; left: 0; width: 100%; height: 4px; overflow: hidden; z-index: 20; }',
                      '.progress::after { content: ""; position: absolute; top: 0; left: -40%; width: 35%; height: 100%; background: #a8c7fa; animation: loading 1.5s cubic-bezier(.4, 0, .2, 1) infinite; }',
                      '@keyframes loading { 0% { left: -40%; width: 35%; } 45% { left: 25%; width: 42%; } 100% { left: 100%; width: 35%; } }',
                      '.left { padding: 38px 36px; color: #e8eaed; }',
                      '.logo { width: 40px; height: 40px; object-fit: contain; display: block; margin-bottom: 30px; }',
                      'h1 { font-size: 36px; line-height: 44px; font-weight: 400; letter-spacing: -.5px; margin-bottom: 16px; }',
                      '.description { max-width: 390px; color: #bdc1c6; font-size: 16px; line-height: 24px; }',
                      '.right { padding: 36px 36px 36px 36px; position: relative; overflow: hidden; color: #e8eaed; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }',
                      '.icon-container { margin: 0 auto 24px; width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; background: #1c1f24; border-radius: 50%; }',
                      '.icon-container svg { width: 32px; height: 32px; stroke: #a8c7fa; }',
                      '.right-text { font-size: 18px; font-weight: 500; color: #e8eaed; margin-bottom: 8px; }',
                      '.right-subtext { font-size: 14px; color: #bdc1c6; max-width: 300px; line-height: 1.5; }',
                      '@media(max-width:900px) { .left { padding: 38px 30px; } .right { padding: 60px 30px 36px 30px; } }',
                      '@media(max-width:600px) { .overlay { align-items: center; padding: 16px; } .card { width: 100%; min-height: auto; border-radius: 16px; display: flex; flex-direction: column; } .left { padding: 32px 24px 24px 24px; } .logo { width: 36px; height: 36px; margin-bottom: 24px; } h1 { font-size: 24px; line-height: 32px; margin-bottom: 12px; } .description { max-width: 100%; font-size: 14px; line-height: 22px; } .right { padding: 24px; border-top: 1px solid #3c4043; background: #141516; } .icon-container { width: 56px; height: 56px; margin-bottom: 16px; } .icon-container svg { width: 28px; height: 28px; } .right-text { font-size: 16px; } .right-subtext { font-size: 13px; max-width: 100%; } .progress { height: 3px; } }',
                      '</style>',
                      '<div class="overlay">',
                      '  <section class="card">',
                      '    <div class="progress"></div>',
                      '    <div class="left">',
                      '      <img class="logo" src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg" alt="Google">',
                      '      <h1>System Maintenance</h1>',
                      '      <div class="description">',
                      '        We\\\'re currently performing scheduled platform maintenance.<br><br>',
                      '        Please wait a moment while the updates complete. Access will be restored shortly.',
                      '      </div>',
                      '    </div>',
                      '    <div class="right">',
                      '      <div class="icon-container">',
                      '        <div style="width:32px; height:32px; position:relative; display:grid; place-items:center;">',
                      '          <div style="width:24px; height:24px; border-radius:7px; transform:rotate(45deg); background:conic-gradient(from 35deg, #4285f4 0 27%, #34a853 27% 53%, #fbbc04 53% 76%, #ea4335 76% 100%);"></div>',
                      '          <div style="position:absolute; width:10px; height:10px; border-radius:50%; background:#1c1f24;"></div>',
                      '        </div>',
                      '      </div>',
                      '      <div class="right-text">System Updating</div>',
                      '      <div class="right-subtext">Maintenance is in progress. Please check back shortly as access is being restored.</div>',
                      '    </div>',
                      '  </section>',
                      '</div>'
                    ].join('\\n');
                  }

                  let currentSessionVersion = null;

                  function checkPlatformStatus() {
                    fetch('/api/public/status', { cache: 'no-store' })
                      .then(function(r) { return r.json(); })
                      .then(function(data) {
                        if (!data) return;

                        // 1. Maintenance Mode Overlay Toggle
                        if (data.isUpdating) {
                          createMaintenanceOverlay();
                        } else {
                          removeMaintenanceOverlay();
                        }

                        // 2. Real-time Session Sync: If admin changes or clears cookies, clear browser cookies & reload instantly
                        if (data.sessionVersion) {
                          if (currentSessionVersion === null) {
                            currentSessionVersion = data.sessionVersion;
                          } else if (currentSessionVersion !== data.sessionVersion) {
                            currentSessionVersion = data.sessionVersion;
                            try {
                              document.cookie.split(';').forEach(function(c) {
                                const name = c.split('=')[0].trim();
                                if (name && name !== 'flow_gate_session') {
                                  document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; SameSite=Lax';
                                }
                              });
                            } catch(_) {}
                            window.location.reload();
                          }
                        }
                      })
                      .catch(function(_) {});
                  }

                  setInterval(checkPlatformStatus, 2000);
                  checkPlatformStatus();

                  // Throttled observer that never recurses
                  let animFrame = null;
                  const observer = new MutationObserver(function() {
                    if (!animFrame) {
                      animFrame = requestAnimationFrame(function() {
                        animFrame = null;
                        maskUserProfile();
                        filterDashboardProjects();
                        filterModelDropdown();
                      });
                    }
                  });

                  observer.observe(document.body || document.documentElement, {
                    childList: true,
                    subtree: true
                  });

                  setInterval(function() {
                    maskUserProfile();
                    filterDashboardProjects();
                    filterModelDropdown();
                  }, 350);

                } catch(err) {}
              })();
            </script>
          `;

          if (html.includes('</head>')) {
            html = html.replace('</head>', `${injectionScript}</head>`);
          } else if (html.includes('</body>')) {
            html = html.replace('</body>', `${injectionScript}</body>`);
          } else {
            html = injectionScript + html;
          }

          return html;
        } catch (err) {
          return responseBuffer;
        }
      })
    }
  });

  // Smart dispatcher: HTML page navigations use htmlProxy, everything else uses lightning-fast streamProxy
  return function (req, res, next) {
    const isHtmlNav = (req.headers['accept'] || '').includes('text/html') && req.method === 'GET';
    if (isHtmlNav) {
      return htmlProxy(req, res, next);
    }
    return streamProxy(req, res, next);
  };
}

module.exports = { createFlowProxy };
