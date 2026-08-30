require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static files from the root directory
app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

// Supabase Initialization
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://lkzpqtxraaapesdevqlj.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrenBxdHhyYWFhcGVzZGV2cWxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MTMzMTcsImV4cCI6MjEwMjk4OTMxN30.bBlzEadRzMHnYOTRtlhXXP4HCHrjFL9vVOoxzDCvhtk';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Helper to calculate days remaining
function getDaysRemaining(expiresAt) {
  if (!expiresAt) return 0;
  const expDate = new Date(expiresAt);
  const diff = expDate.getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// Fetch and format cookies for a given profile
async function getCookiesForUser(profile) {
  if (!profile.assigned_cookie_id) return [];
  
  // Find the base node to get the account email
  const { data: baseNode } = await supabase
    .from('pool_cookies')
    .select('account_email')
    .eq('id', profile.assigned_cookie_id)
    .single();

  if (!baseNode || !baseNode.account_email) return [];

  // Fetch all cookies linked to that email account
  const { data: allNodes } = await supabase
    .from('pool_cookies')
    .select('*')
    .eq('account_email', baseNode.account_email)
    .eq('is_active', true);

  if (!allNodes) return [];

  return allNodes.map(node => {
    // Extract cookie name from provider_name (e.g. "Google Veo Node (__Host-next-auth.csrf-token)")
    const match = node.provider_name.match(/\(([^)]+)\)/);
    const name = match ? match[1] : node.provider_name;
    
    let domain = '.google.com';
    if (name.includes('next-auth')) domain = 'labs.google';
    if (name.startsWith('__Host-')) domain = ''; // __Host- cookies cannot have domain

    return {
      name: name,
      value: node.cookie_data,
      domain: domain,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax'
    };
  });
}


// 1. User Login
app.post('/api/public/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(401).json({ error: 'Email and password required' });

  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .ilike('email', email)
      .single();

    if (error || !profile) {
      return res.status(401).json({ error: 'Invalid credentials or inactive account.' });
    }
    
    // Check password (including legacy fallback used in access.html)
    let expectedPassword = profile.account_password;
    if (!expectedPassword) {
      expectedPassword = `fl_sess_${(profile.lab_id || '').toLowerCase()}`;
    }
    if (password !== expectedPassword) {
      return res.status(401).json({ error: 'Invalid password.' });
    }

    const daysRemaining = getDaysRemaining(profile.expires_at);
    if (daysRemaining <= 0) {
      return res.status(403).json({ error: 'Account or plan is inactive/expired.' });
    }

    const token = profile.id;
    const cookies = await getCookiesForUser(profile);

    res.json({
      success: true,
      token: token,
      cookies: cookies,
      user: {
        id: profile.id,
        name: profile.name || email.split('@')[0],
        plan: profile.plan || 'ultra',
        planExpires: profile.expires_at,
        planExpiresAt: profile.expires_at,
        expiresAt: profile.expires_at,
        daysRemaining: daysRemaining,
        role: profile.role
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. User Verification (/me)
app.get('/api/public/auth/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const token = authHeader.split(' ')[1];

  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', token)
      .single();

    if (error || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    const daysRemaining = getDaysRemaining(profile.expires_at);

    res.json({
      success: true,
      user: {
        id: profile.id,
        name: profile.name || profile.email.split('@')[0],
        plan: profile.plan || 'ultra',
        planExpiresAt: profile.expires_at,
        daysRemaining: daysRemaining
      }
    });

  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 3. Cookie Injection Endpoint
app.post('/api/extension/inject-cookies', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return res.json({ ok: false, cookies: [], error: 'User not found' });
    }

    const cookies = await getCookiesForUser(profile);

    res.json({
      ok: true,
      cookies: cookies,
      disabled: cookies.length === 0
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 4. Extension Validity Check
app.post('/api/extension/verify', async (req, res) => {
  const { userId, token, sessionToken } = req.body;
  const uid = userId || (token ? token.split(':')[0] : null);
  
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .single();

    if (error || !profile) {
      return res.json({ forceSignout: true });
    }

    const daysRemaining = getDaysRemaining(profile.expires_at);
    if (daysRemaining <= 0) {
      return res.json({ error: 'device_session_revoked' });
    }

    res.json({
      user: {
        id: profile.id,
        plan: profile.plan || 'ultra',
        daysRemaining: daysRemaining,
        planExpiresAt: profile.expires_at
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 5. System Status Endpoint (In-Memory to bypass Supabase RLS blocking anon keys)
let isMaintenanceModeActive = false;

app.post('/api/admin/maintenance', (req, res) => {
  if (typeof req.body.isUpdating === 'boolean') {
    isMaintenanceModeActive = req.body.isUpdating;
  }
  res.json({ success: true, isUpdating: isMaintenanceModeActive });
});

app.get('/api/public/status', async (req, res) => {
  res.json({ isUpdating: isMaintenanceModeActive });
});

// Clickssy API Proxy to bypass CORS/403 blocks from frontend
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

app.listen(PORT, () => {
  console.log(`[Flow Labs] Backend Server running on http://localhost:${PORT}`);
});
