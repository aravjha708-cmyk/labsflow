const fs = require('fs');
const express = require('express');
const https = require('https');
const http = require('http');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const config = require('./config');
const { parseCookies } = require('./proxy/cookieHelper');
const { extractAuthInfo } = require('./proxy/googleAuthHelper');
const { handleGoogleApiProxy } = require('./proxy/apiProxy');
const { createFlowProxy } = require('./proxy/reverseProxy');
const { publicHttpsAgent } = require('./proxy/dnsHelper');
const { getOrCreateCert } = require('./proxy/sslHelper');
const authController = require('./auth/authController');

const app = express();

// Enable trust proxy for Cloud hosts (Render, Cloudflare, Railway) to accurately detect HTTPS protocol & client IPs
app.set('trust proxy', 1);

app.use(cors());

// ==============================================================
// 1. GOOGLE API PROXY & TELEMETRY HANDLERS
// ==============================================================
app.all('/__google_api_proxy', express.raw({ type: '*/*', limit: '50mb' }), handleGoogleApiProxy);

// Bearer token endpoint: exchanges NextAuth session cookie → real ya29 OAuth token for client-side direct calls
app.get('/api/auth/bearer-token', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    const token = await config.getValidAccessToken();
    if (token) {
      return res.json({ token, proxyUrl: config.googleProxyUrl || 'https://flow-proxy.aravjha708.workers.dev' });
    }
    return res.status(401).json({ error: 'No valid session' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Fast-path tRPC Telemetry & Client Logging endpoints to eliminate 404 console errors
app.all(
  ['/fx/api/trpc/general.submitBatchLog', '/api/trpc/general.submitBatchLog', '/fx/api/trpc/general.reportClientSideError', '/api/trpc/general.reportClientSideError'],
  (req, res) => {
    const isBatch = Boolean(req.query.batch || req.path.includes('batch'));
    if (isBatch) {
      return res.json([{ result: { data: { json: null } } }]);
    }
    return res.json({ result: { data: { json: null } } });
  }
);

// ==============================================================
// 2. PARSE JSON FOR LOCAL API ROUTES & SERVE STATIC PUBLIC FILES
// ==============================================================
app.use('/api', express.json());
app.use('/api', express.urlencoded({ extended: true }));

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// ==============================================================
// 3. AUTHENTICATION & PLAN VALIDITY API ENDPOINTS
// ==============================================================
app.post('/api/public/auth/login', authController.handleLogin);
app.get('/api/public/auth/me', authController.handleMe);
app.post('/api/auth/gate-login', authController.handleLogin);
app.get('/api/auth/gate-status', authController.handleGateStatus);
app.post('/api/auth/gate-signout', authController.handleGateSignout);

// Admin User Management CRUD
app.get('/api/admin/users', authController.handleGetUsers);
app.post('/api/admin/users', authController.handleCreateUser);
app.put('/api/admin/users/:id', authController.handleUpdateUser);
app.delete('/api/admin/users/:id', authController.handleDeleteUser);

// Maintenance Mode (Disk-Backed Persistence)
const settingsPath = path.join(__dirname, '../data/settings.json');
let isMaintenanceMode = false;
try {
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    if (typeof settings.isMaintenanceMode === 'boolean') {
      isMaintenanceMode = settings.isMaintenanceMode;
    }
  }
} catch(_) {}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify({ isMaintenanceMode }, null, 2), 'utf-8');
  } catch(_) {}
}

app.get('/api/public/status', (req, res) => {
  res.json({
    isUpdating: isMaintenanceMode,
    sessionVersion: config.sessionVersion
  });
});

app.post('/api/admin/maintenance', (req, res) => {
  if (typeof req.body.isUpdating === 'boolean') {
    isMaintenanceMode = req.body.isUpdating;
    saveSettings();
  }
  res.json({ success: true, isUpdating: isMaintenanceMode });
});

// Clickssy API Proxy
app.post('/api/clickssy/proxy', async (req, res) => {
  const { url, method, body, headers } = req.body;
  try {
    const fetchOptions = {
      method: method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {})
      }
    };
    if (body) fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);

    const proxyRes = await fetch(url, fetchOptions);
    const data = await proxyRes.text();
    let json;
    try { json = JSON.parse(data); } catch(e) { json = data; }

    res.status(proxyRes.status).json(json);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==============================================================
// 4. ADMIN & PROXY CONFIGURATION ENDPOINTS
// ==============================================================
app.get('/api/proxy-config', (req, res) => {
  const parsed = parseCookies(config.sessionCookies);
  const authInfo = extractAuthInfo(config.sessionCookies);
  res.json({
    ...config.getPublicSettings(),
    parsedCookieKeys: parsed.map(c => c.name),
    hasSapisid: Boolean(authInfo.sapisid),
    hasSid: Boolean(authInfo.sid)
  });
});

app.post('/api/proxy-config', (req, res) => {
  const { sessionCookies, apiToken, targetUrl, targetDefaultPath, gateEnabled, gatePassword } = req.body;
  config.update({ sessionCookies, apiToken, targetUrl, targetDefaultPath, gateEnabled, gatePassword });
  const parsed = parseCookies(config.sessionCookies);
  const authInfo = extractAuthInfo(config.sessionCookies);
  res.json({
    message: 'Configuration updated and persisted to .env successfully.',
    config: {
      ...config.getPublicSettings(),
      parsedCookieKeys: parsed.map(c => c.name),
      hasSapisid: Boolean(authInfo.sapisid),
      hasSid: Boolean(authInfo.sid)
    }
  });
});

app.get('/api/proxy-test', async (req, res) => {
  const start = Date.now();
  const testUrl = `${config.targetUrl}${config.targetDefaultPath}`;
  try {
    const authInfo = extractAuthInfo(config.sessionCookies);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': `${config.targetUrl}/`
    };

    if (config.sessionCookies) headers['Cookie'] = config.sessionCookies;
    if (authInfo.sapisidHash) headers['Authorization'] = authInfo.sapisidHash;

    const response = await axios.get(testUrl, {
      headers,
      httpsAgent: publicHttpsAgent,
      timeout: 10000,
      validateStatus: () => true
    });

    res.json({
      status: 'success',
      target: testUrl,
      httpStatus: response.status,
      latencyMs: Date.now() - start,
      server: response.headers['server'] || 'google',
      cookieCount: parseCookies(config.sessionCookies).length,
      hasSapisidAuth: Boolean(authInfo.sapisid)
    });
  } catch (err) {
    res.status(502).json({
      status: 'error',
      target: testUrl,
      error: err.message,
      latencyMs: Date.now() - start
    });
  }
});

// ==============================================================
// 5. FRONTEND ROUTES (Landing Page, Login, Admin Console, Access Page)
// ==============================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(publicDir, 'login.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

app.get('/access', (req, res) => {
  res.sendFile(path.join(publicDir, 'access.html'));
});

app.get('/__admin', (req, res) => {
  res.redirect('/admin');
});

// ==============================================================
// 6. ACCESS GATE ROUTING (Redirect to /login if unauthenticated)
// ==============================================================
app.use((req, res, next) => {
  if (!config.gateEnabled) return next();

  // If user is accessing /fx page directly without active session, redirect to /login
  const isFxPage = req.path.startsWith('/fx') && !req.path.startsWith('/fx/api');
  const isHtmlOrNav = !req.headers.accept || req.headers.accept.includes('text/html') || req.headers['sec-fetch-dest'] === 'document';

  if (isFxPage && isHtmlOrNav) {
    const cookieHeader = req.headers['cookie'] || '';
    const match = cookieHeader.match(/flow_gate_session=([^;]+)/);
    if (!match) {
      const redirectUrl = encodeURIComponent(req.originalUrl || '/fx/tools/flow');
      return res.redirect(`/login?redirect=${redirectUrl}`);
    }
  }

  next();
});

// ==============================================================
// 7. GOOGLE LABS FLOW REVERSE PROXY (Handles /fx/*, /_/*, /static/* etc.)
// ==============================================================
app.use('/', createFlowProxy());

// Start Server (Auto-detects Cloud Hosts like Render vs Local HTTPS)
async function startServer() {
  const PORT = process.env.PORT || config.port || 3000;
  const isCloud = Boolean(process.env.RENDER || process.env.RAILWAY_STATIC_URL || process.env.DYNO || (process.env.NODE_ENV === 'production' && process.env.PORT));

  if (isCloud) {
    // Cloud hosting (Render / Railway / VPS): SSL is terminated at edge load balancer
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n======================================================`);
      console.log(`☁️  Flow Labs Platform Running on Cloud (Port ${PORT})`);
      console.log(`🌐 Landing Page:        http://0.0.0.0:${PORT}/`);
      console.log(`🔑 Login Page:          http://0.0.0.0:${PORT}/login`);
      console.log(`⚙️  Admin Console:       http://0.0.0.0:${PORT}/admin`);
      console.log(`🌊 Google Flow Studio:  http://0.0.0.0:${PORT}/fx/tools/flow`);
      console.log(`🎯 Forwarding to:       ${config.targetUrl}`);
      console.log(`======================================================\n`);
    });
  } else {
    // Local development: run with local SSL certificate for labs.google HSTS
    const sslCert = await getOrCreateCert();
    const httpsServer = https.createServer(sslCert, app);
    httpsServer.listen(PORT, '0.0.0.0', () => {
      console.log(`\n======================================================`);
      console.log(`🌊 Flow Labs Platform HTTPS Server Running!`);
      console.log(`🌐 Landing Page:        https://labs.google:${PORT}/`);
      console.log(`🔑 Login Page:          https://labs.google:${PORT}/login`);
      console.log(`⚙️  Admin Console:       https://labs.google:${PORT}/admin`);
      console.log(`🎯 Google Flow Studio:  https://labs.google:${PORT}/fx/tools/flow`);
      console.log(`🎯 Forwarding to:       ${config.targetUrl}`);
      console.log(`======================================================\n`);
    });
  }
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
