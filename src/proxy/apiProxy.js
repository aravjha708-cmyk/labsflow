const axios = require('axios');
const config = require('../config');
const { computeSapisidHash, extractAuthInfo } = require('./googleAuthHelper');
const { publicHttpsAgent } = require('./dnsHelper');

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
      'Host': urlObj.host,
      'Origin': 'https://labs.google',
      'Referer': 'https://labs.google/fx/tools/flow',
      'User-Agent':
        req.headers['user-agent'] ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'sec-ch-ua': req.headers['sec-ch-ua'] || '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'cross-site'
    };

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

    if (authInfo.sapisid) {
      forwardHeaders['Authorization'] = computeSapisidHash(authInfo.sapisid, 'https://labs.google');
      forwardHeaders['X-Goog-AuthUser'] = req.headers['x-goog-authuser'] || '0';
    } else if (req.headers['authorization']) {
      forwardHeaders['Authorization'] = req.headers['authorization'];
      forwardHeaders['X-Goog-AuthUser'] = req.headers['x-goog-authuser'] || '0';
    } else if (config.apiToken) {
      forwardHeaders['Authorization'] =
        config.apiToken.startsWith('Bearer ') || config.apiToken.startsWith('SAPISIDHASH ')
          ? config.apiToken
          : `Bearer ${config.apiToken}`;
      forwardHeaders['X-Goog-AuthUser'] = '0';
    }

    const method = req.method.toUpperCase();
    const isBodyAllowed = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const requestData = isBodyAllowed && req.body && req.body.length > 0 ? req.body : undefined;

    const { HttpsProxyAgent } = require('https-proxy-agent');

    let httpsAgent = publicHttpsAgent;
    if (config.outboundProxy) {
      try {
        httpsAgent = new HttpsProxyAgent(config.outboundProxy);
      } catch (proxyErr) {
        console.error('Invalid outbound proxy configuration:', proxyErr.message);
      }
    }

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

    res.status(response.status).send(response.data);
  } catch (err) {
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
