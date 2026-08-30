const axios = require('axios');
const config = require('../config');
const { computeSapisidHash, extractAuthInfo } = require('./googleAuthHelper');
const { publicHttpsAgent } = require('./dnsHelper');

/**
 * High-Performance Google API Proxy for Google AI Sandbox & Google APIs
 */
async function handleGoogleApiProxy(req, res) {
  let targetUrl = req.query._target_url;
  if (!targetUrl && req.headers['x-target-url']) {
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
    const authInfo = extractAuthInfo(config.sessionCookies);

    const clientIp =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.headers['x-real-ip'] ||
      req.socket.remoteAddress ||
      '';

    const forwardHeaders = {
      'Host': urlObj.host,
      'Origin': 'https://labs.google',
      'X-Origin': 'https://labs.google',
      'Referer': 'https://labs.google/fx/tools/flow',
      'User-Agent':
        req.headers['user-agent'] ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'X-Goog-AuthUser': req.headers['x-goog-authuser'] || '0'
    };

    // Forward client IP so Google AI Sandbox treats it as the user's browser session
    if (clientIp) {
      forwardHeaders['X-Forwarded-For'] = clientIp;
      forwardHeaders['X-Real-IP'] = clientIp;
    }

    // Forward client sec-ch-* headers
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (
        lower.startsWith('sec-ch-') ||
        lower.startsWith('x-goog') ||
        lower.startsWith('x-client')
      ) {
        forwardHeaders[key] = value;
      }
    }

    if (req.headers['content-type']) {
      forwardHeaders['Content-Type'] = req.headers['content-type'];
    }

    // Ensure Master Google Cookies are attached
    if (config.sessionCookies) {
      forwardHeaders['Cookie'] = config.sessionCookies;
    }

    // Attach SAPISIDHASH authorization
    if (authInfo.sapisid) {
      forwardHeaders['Authorization'] = computeSapisidHash(authInfo.sapisid, 'https://labs.google');
      forwardHeaders['X-Goog-AuthUser'] = '0';
    } else if (req.headers['authorization']) {
      forwardHeaders['Authorization'] = req.headers['authorization'];
    } else if (config.apiToken) {
      forwardHeaders['Authorization'] =
        config.apiToken.startsWith('Bearer ') || config.apiToken.startsWith('SAPISIDHASH ')
          ? config.apiToken
          : `Bearer ${config.apiToken}`;
    }

    const method = req.method.toUpperCase();
    const isBodyAllowed = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const requestData = isBodyAllowed && req.body && req.body.length > 0 ? req.body : undefined;

    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: forwardHeaders,
      data: requestData,
      httpsAgent: publicHttpsAgent,
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
      'X-Origin': 'https://labs.google',
      'Referer': 'https://labs.google/fx/tools/flow',
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': config.sessionCookies || '',
      'X-Goog-AuthUser': '0'
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
