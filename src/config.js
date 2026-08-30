const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const envFilePath = path.join(__dirname, '..', '.env');

// Supabase Configuration for Session Persistence
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://lkzpqtxraaapesdevqlj.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrenBxdHhyYWFhcGVzZGV2cWxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MTMzMTcsImV4cCI6MjEwMjk4OTMxN30.bBlzEadRzMHnYOTRtlhXXP4HCHrjFL9vVOoxzDCvhtk';

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  targetUrl: process.env.TARGET_URL || 'https://labs.google',
  targetDefaultPath: process.env.TARGET_DEFAULT_PATH || '/fx/tools/flow',
  sessionCookies: process.env.SESSION_COOKIES || process.env.HF_SESSION_COOKIES || '',
  apiToken: process.env.API_TOKEN || process.env.HF_API_TOKEN || '',
  googleProxyUrl: process.env.GOOGLE_PROXY_URL || process.env.CLOUDFLARE_PROXY_URL || '',
  outboundProxy: process.env.OUTBOUND_PROXY || process.env.RESIDENTIAL_PROXY || process.env.HTTP_PROXY || process.env.HTTPS_PROXY || '',
  gateEnabled: process.env.GATE_ENABLED !== 'false',
  gatePassword: process.env.GATE_PASSWORD || 'flow123',
  sessionVersion: Date.now(),

  update(newSettings, skipSupabaseSync = false) {
    let sessionChanged = false;
    if (newSettings.sessionCookies !== undefined) {
      const sanitized = newSettings.sessionCookies.trim();
      if (sanitized !== this.sessionCookies) {
        this.sessionCookies = sanitized;
        sessionChanged = true;
      }
    }
    if (newSettings.apiToken !== undefined) {
      const sanitized = newSettings.apiToken.trim();
      if (sanitized !== this.apiToken) {
        this.apiToken = sanitized;
        sessionChanged = true;
      }
    }
    if (newSettings.googleProxyUrl !== undefined) {
      this.googleProxyUrl = String(newSettings.googleProxyUrl).trim();
    }
    if (newSettings.outboundProxy !== undefined) {
      this.outboundProxy = String(newSettings.outboundProxy).trim();
    }
    if (newSettings.targetUrl !== undefined) this.targetUrl = newSettings.targetUrl.trim();
    if (newSettings.targetDefaultPath !== undefined) this.targetDefaultPath = newSettings.targetDefaultPath.trim();
    if (newSettings.port !== undefined) this.port = parseInt(newSettings.port, 10) || 3000;
    if (newSettings.gateEnabled !== undefined) this.gateEnabled = Boolean(newSettings.gateEnabled);
    if (newSettings.gatePassword !== undefined) this.gatePassword = String(newSettings.gatePassword).trim();

    if (sessionChanged) {
      this.sessionVersion = Date.now();
    }

    // Persist to .env
    try {
      const envContent = [
        `PORT=${this.port}`,
        `TARGET_URL=${this.targetUrl}`,
        `TARGET_DEFAULT_PATH=${this.targetDefaultPath}`,
        `SESSION_COOKIES=${this.sessionCookies}`,
        `API_TOKEN=${this.apiToken}`,
        `GOOGLE_PROXY_URL=${this.googleProxyUrl}`,
        `OUTBOUND_PROXY=${this.outboundProxy}`,
        `GATE_ENABLED=${this.gateEnabled}`,
        `GATE_PASSWORD=${this.gatePassword}`
      ].join('\n');
      fs.writeFileSync(envFilePath, envContent, 'utf-8');
    } catch (err) {
      // Non-blocking for cloud environments
    }

    // Persist to Supabase system_sessions
    if (!skipSupabaseSync) {
      this.persistToSupabase();
    }
  },

  async persistToSupabase() {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    try {
      await axios.post(
        `${SUPABASE_URL}/rest/v1/system_sessions`,
        {
          id: '00000000-0000-0000-0000-000000000001',
          session_cookies: this.sessionCookies,
          api_token: this.apiToken,
          target_url: this.targetUrl,
          target_default_path: this.targetDefaultPath,
          gate_password: this.gatePassword,
          is_active: true,
          updated_at: new Date().toISOString()
        },
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Prefer: 'resolution=merge-duplicates',
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );
    } catch (err) {
      // Non-blocking
    }
  },

  async syncFromSupabase() {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    try {
      const res = await axios.get(
        `${SUPABASE_URL}/rest/v1/system_sessions?id=eq.00000000-0000-0000-0000-000000000001&select=*`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`
          },
          timeout: 5000
        }
      );

      if (res.data && res.data.length > 0) {
        const row = res.data[0];
        if (row.session_cookies && row.session_cookies.trim()) {
          this.update(
            {
              sessionCookies: row.session_cookies,
              apiToken: row.api_token || this.apiToken,
              targetUrl: row.target_url || this.targetUrl,
              targetDefaultPath: row.target_default_path || this.targetDefaultPath,
              gatePassword: row.gate_password || this.gatePassword
            },
            true
          );
        }
      }
    } catch (err) {
      // Non-blocking
    }
  },

  getPublicSettings() {
    return {
      port: this.port,
      targetUrl: this.targetUrl,
      targetDefaultPath: this.targetDefaultPath,
      googleProxyUrl: this.googleProxyUrl || '',
      outboundProxy: this.outboundProxy || '',
      hasSessionCookies: Boolean(this.sessionCookies && this.sessionCookies.length > 0),
      sessionCookiesLength: this.sessionCookies ? this.sessionCookies.length : 0,
      sessionCookiesMasked: this.sessionCookies ? `${this.sessionCookies.substring(0, 20)}...` : '',
      apiTokenMasked: this.apiToken ? `${this.apiToken.substring(0, 10)}...` : '',
      gateEnabled: this.gateEnabled,
      gatePassword: this.gatePassword,
      sessionVersion: this.sessionVersion
    };
  }
};

// Initial Supabase Sync on boot & every 15 seconds
config.syncFromSupabase();
setInterval(() => {
  config.syncFromSupabase();
}, 15000);

module.exports = config;
