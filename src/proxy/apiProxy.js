const axios = require('axios');
const config = require('../config');
const { computeSapisidHash, extractAuthInfo } = require('./googleAuthHelper');
const { publicHttpsAgent } = require('./dnsHelper');

/**
 * Clean & Sanitized Google API Proxy for Google AI Sandbox & Google APIs
 * Strips all cloud proxy headers (x-forwarded-*, Render headers) to prevent Google 403 flags
 */
async function handleGoogleApiProxy(req, res) {
  // 1. Handle CORS Preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let targetUrl = req.query._target_url;
  if (req.url && req.url.includes('_target_url=')) {
    const raw = req.url.substring(req.url.indexOf('_target_url=') + 12);
    try {
      targetUrl = decodeURIComponent(raw);
    } catch (_) {
      targetUrl = raw;
    }
  } else if (!targetUrl && req.headers['x-target-url']) {
    targetUrl = req.headers['x-target-url'];
  }

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing target URL' });
  }

  // Fast-path: Instantly acknowledge frontend background logs & analytics without blocking UI
  if (
    targetUrl.includes('batchLogFrontendEvents') ||
    targetUrl.includes('feedback-pa') ||
    targetUrl.includes('survey/trigger')
  ) {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({});
    forwardInBackground(req, targetUrl);
    return;
  }

  try {
    const urlObj = new URL(targetUrl);

    // 2. Resolve official Google OAuth ya29 Bearer Token
    let bearerToken = config.apiToken;
    if (!bearerToken || !bearerToken.startsWith('ya29.')) {
      bearerToken = await config.getValidAccessToken();
    }

    if (bearerToken && !bearerToken.startsWith('Bearer ')) {
      bearerToken = `Bearer ${bearerToken}`;
    }

    // 3. Combine session cookies if needed
    let combinedCookies = (config.sessionCookies || '').trim();
    const reqCookie = (req.headers['cookie'] || '').trim();
    if (reqCookie) {
      if (!combinedCookies) {
        combinedCookies = reqCookie;
      } else {
        const cMap = new Map();
        combinedCookies.split(';').forEach(c => {
          const idx = c.indexOf('=');
          if (idx > 0) cMap.set(c.substring(0, idx).trim(), c.substring(idx + 1).trim());
        });
        reqCookie.split(';').forEach(c => {
          const idx = c.indexOf('=');
          if (idx > 0) {
            const k = c.substring(0, idx).trim();
            if (!cMap.has(k)) cMap.set(k, c.substring(idx + 1).trim());
          }
        });
        combinedCookies = Array.from(cMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
      }
    }

    // 4. SANITIZE HEADERS: Never spread req.headers to prevent leaking Render proxy headers
    const cleanHeaders = {
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Host': urlObj.host,
      'Origin': 'https://labs.google',
      'Referer': 'https://labs.google/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'X-Browser-Channel': 'stable',
      'X-Browser-Copyright': 'Copyright 2024 Google LLC. All rights reserved.',
      'X-Browser-Year': '2024',
      'X-Goog-AuthUser': '0'
    };

    if (req.headers['content-type']) {
      cleanHeaders['Content-Type'] = req.headers['content-type'];
    } else {
      cleanHeaders['Content-Type'] = 'application/json';
    }

    if (bearerToken) {
      cleanHeaders['Authorization'] = bearerToken;
    } else {
      const authInfo = extractAuthInfo(combinedCookies);
      if (authInfo.sapisid) {
        cleanHeaders['Authorization'] = computeSapisidHash(authInfo.sapisid, 'https://labs.google');
      }
    }

    if (combinedCookies) {
      cleanHeaders['Cookie'] = combinedCookies;
    }

    // 5. Clean Request Body (strip any invalid recaptcha tokens)
    const method = req.method.toUpperCase();
    const isBodyAllowed = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    let requestData = isBodyAllowed && req.body && req.body.length > 0 ? req.body : undefined;

    if (requestData) {
      try {
        const bodyStr = Buffer.isBuffer(requestData) ? requestData.toString('utf-8') : String(requestData);
        const parsed = JSON.parse(bodyStr);
        let changed = false;
        if (parsed.clientContext && parsed.clientContext.recaptchaToken) {
          delete parsed.clientContext.recaptchaToken;
          changed = true;
        }
        if (Array.isArray(parsed.requests)) {
          parsed.requests.forEach(r => {
            if (r && r.clientContext && r.clientContext.recaptchaToken) {
              delete r.clientContext.recaptchaToken;
              changed = true;
            }
          });
        }
        if (changed) {
          requestData = Buffer.from(JSON.stringify(parsed), 'utf-8');
        }
      } catch (_) {}
    }

    // 6. Proxy Agent
    const { HttpsProxyAgent } = require('https-proxy-agent');
    let httpsAgent = publicHttpsAgent;
    if (config.outboundProxy) {
      try {
        httpsAgent = new HttpsProxyAgent(config.outboundProxy);
      } catch (proxyErr) {
        console.error('Invalid outbound proxy configuration:', proxyErr.message);
      }
    }

    // 7. Forward directly to Google with pristine headers
    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: cleanHeaders,
      data: requestData,
      httpsAgent: httpsAgent,
      timeout: 120000,
      responseType: 'arraybuffer',
      validateStatus: () => true
    });

    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }

    if (response.status >= 400) {
      try {
        const bodyStr = Buffer.from(response.data).toString('utf-8');
        console.error(`[Google API Proxy Error] ${req.method} ${targetUrl} [Status: ${response.status}] =>`, bodyStr);
      } catch (_) {}
    }

    return res.status(response.status).send(response.data);
  } catch (err) {
    console.error(`[Google API Proxy Network Error] ${req.method} ${targetUrl} =>`, err.message);
    return res.status(502).json({
      error: 'Google API Proxy Request Failed',
      message: err.message,
      targetUrl
    });
  }
}

async function forwardInBackground(req, targetUrl) {
  try {
    const urlObj = new URL(targetUrl);
    const authInfo = extractAuthInfo(config.sessionCookies);
    const forwardHeaders = {
      'Host': urlObj.host,
      'Origin': 'https://labs.google',
      'Referer': 'https://labs.google/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site'
    };

    if (config.sessionCookies) {
      forwardHeaders['Cookie'] = config.sessionCookies;
    }

    if (authInfo.sapisid) {
      forwardHeaders['Authorization'] = computeSapisidHash(authInfo.sapisid, 'https://labs.google');
    }

    const { HttpsProxyAgent } = require('https-proxy-agent');
    let httpsAgent = publicHttpsAgent;
    if (config.outboundProxy) {
      try {
        httpsAgent = new HttpsProxyAgent(config.outboundProxy);
      } catch (_) {}
    }

    await axios({
      method: req.method,
      url: targetUrl,
      headers: forwardHeaders,
      data: req.body && req.body.length > 0 ? req.body : undefined,
      httpsAgent: httpsAgent,
      timeout: 15000,
      validateStatus: () => true
    });
  } catch (_) {}
}

module.exports = { handleGoogleApiProxy };
