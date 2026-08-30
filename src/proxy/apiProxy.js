const axios = require('axios');
const config = require('../config');
const { computeSapisidHash, extractAuthInfo } = require('./googleAuthHelper');
const { publicHttpsAgent } = require('./dnsHelper');
const { executeGoogleApiInBrowser } = require('./headlessBridge');

/**
 * High-Performance Google API Proxy for Google AI Sandbox & Google APIs
 */
async function handleGoogleApiProxy(req, res) {
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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({});

    // Process asynchronously in background
    forwardInBackground(req, targetUrl);
    return;
  }

  try {
    const urlObj = new URL(targetUrl);

    const forwardHeaders = {
      ...req.headers,
      'Host': urlObj.host,
      'Origin': 'https://labs.google',
      'Referer': 'https://labs.google/',
      'User-Agent':
        req.headers['user-agent'] ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': req.headers['accept'] || 'application/json, text/plain, */*',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
      'Priority': 'u=1, i'
    };

    if (req.headers['content-type']) {
      forwardHeaders['Content-Type'] = req.headers['content-type'];
    }

    delete forwardHeaders['x-origin'];
    delete forwardHeaders['X-Origin'];
    delete forwardHeaders['x-target-url'];
    delete forwardHeaders['content-length'];
    delete forwardHeaders['Content-Length'];

    // Combine master session cookies with client cookies if present
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

    const authInfo = extractAuthInfo(combinedCookies);

    if (combinedCookies) {
      forwardHeaders['Cookie'] = combinedCookies;
    }

    // Attach official Google OAuth ya29 Bearer Token
    let bearerToken = config.apiToken;
    if (!bearerToken || !bearerToken.startsWith('ya29.')) {
      bearerToken = await config.getValidAccessToken();
    }

    if (bearerToken) {
      forwardHeaders['Authorization'] = bearerToken.startsWith('Bearer ') ? bearerToken : `Bearer ${bearerToken}`;
      forwardHeaders['X-Goog-AuthUser'] = '0';
    } else if (authInfo.sapisid) {
      forwardHeaders['Authorization'] = computeSapisidHash(authInfo.sapisid, 'https://labs.google');
      forwardHeaders['X-Goog-AuthUser'] = req.headers['x-goog-authuser'] || '0';
    } else if (req.headers['authorization']) {
      forwardHeaders['Authorization'] = req.headers['authorization'];
      forwardHeaders['X-Goog-AuthUser'] = req.headers['x-goog-authuser'] || '0';
    }

    const method = req.method.toUpperCase();
    const isBodyAllowed = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const requestData = isBodyAllowed && req.body && req.body.length > 0 ? req.body : undefined;

    const { HttpsProxyAgent } = require('https-proxy-agent');

    let httpsAgent = publicHttpsAgent;
    if (config.outboundProxy) {
      try {
        httpsAgent = new HttpsProxyAgent(config.outboundProxy);
        console.log('[Proxy] Routing through residential proxy:', config.outboundProxy.replace(/:[^:]*@/, ':***@'));
      } catch (proxyErr) {
        console.error('Invalid outbound proxy configuration:', proxyErr.message);
      }
    }

    delete forwardHeaders['content-length'];
    delete forwardHeaders['Content-Length'];

    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: forwardHeaders,
      data: requestData,
      httpsAgent: httpsAgent,
      timeout: 120000,
      responseType: 'arraybuffer',
      validateStatus: () => true
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }

    if (response.status >= 400) {
      try {
        const bodyStr = Buffer.from(response.data).toString('utf-8');
        console.error(`[Google API Proxy Error] ${req.method} ${targetUrl} [Status: ${response.status}] =>`, bodyStr);
      } catch (_) {}
    }

    res.status(response.status).send(response.data);
  } catch (err) {
    console.error(`[Google API Proxy Network Error] ${req.method} ${targetUrl} =>`, err.message);
    res.status(502).json({
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
      'Referer': 'https://labs.google/fx/tools/flow',
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': config.sessionCookies || ''
    };
    if (authInfo.sapisid) {
      forwardHeaders['Authorization'] = computeSapisidHash(authInfo.sapisid, 'https://labs.google');
    }
    if (req.headers['content-type']) {
      forwardHeaders['Content-Type'] = req.headers['content-type'];
    }

    await axios({
      method: req.method,
      url: targetUrl,
      headers: forwardHeaders,
      data: req.body,
      httpsAgent: publicHttpsAgent,
      timeout: 10000,
      validateStatus: () => true
    });
  } catch (_) {}
}

module.exports = { handleGoogleApiProxy };
