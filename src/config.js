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
  sessionCookies: process.env.SESSION_COOKIES || '__Host-next-auth.csrf-token=6e548756e6e0821392fec50ad80d0aa5d61f8a05ae9b0b7ab9b5c2bc2006bd74%7C01fbe2db5e5634c157b2084b05a1cce6a1fe3b662349091c9638aa5d720a052f; __Secure-next-auth.callback-url=https%3A%2F%2Flabs.google; __Secure-next-auth.session-token=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..yRfP8iJ5ZvfOoCDO.MyWSnxkKR1fos0gWVoqt6LkYCR3NzUBwGPQ7FzvM5vKkiMEHf7Z3qR8Sbbrb-yKt4C7-iN3sSL-J8j3tpjnFTE0YaWHNV_jCf7gQPZWqHRsIVvybXQGNSl6cj2uVQDheTmwGyxYIjfjz-e0xZMnlxvbmRReAa2B3wpM0REqSIGnhfew5hNOF97YP0rgB5yOcWThIbJ51mPZuICKcld997yHD0zqhE7qI2sQta8R3J5dQDV5wUY1qqMhxPQ8ohUpwMCz2sQDor_5gCM1ZKBljDwpGawbk3nOX-DlgTzwEPtuCV7UG_85HNH7eW5se3W3KmHx3vq7fNfwmI2_x1br2Te_HIqc06oBUfh7NntOaPskIMnVjBLSrTWN0T0fsA5CiB8mDrVuHQIi1_jkd88TCbAFkw3ZBpiKyCCREEVi05rIdYKcbOReBY1pqc83r1wWrHOpVbVDAZArUD4j7i2BBaCwgBngS_Dj1BL67izdeUwi0CtqFCRUDnq_Ez_2NWJmPMxFQrecHTvedJJ1FQaStghy89RvQiWwEM5plV1cq4IwDP0cFLb3VH-m0k_ODpu1sTwX1-o2vnY1y4Y9ivIKa1hWkWtlYbdWc04-upP_8urLVvgehkg3QJ0lTO9zeOBup8WWdqcxVuG5FhZ47_P_h3xxMUdVBGJ1uTnDwuCFBOSTtaxyd2ysngkOUL-nwvNWnkF7V7_l0QeewCnpGmxqDorQj2hUKqtcKqrTpRckWZjhyhtAQNUe3iDzWGljm8IWUPk8eXDg4720XFS6XmLzA1ookO9zo7LB3zX3liQcnHmxPhYeZJckYzvlp8GKq6U73LQqpRTthm7p_KavjpnG4Z5ADs65OIxEl3lgIH25yFCmvCT0JrXmrclHoFlEFYZmtrgeJS4cYzEo9fsau7NBoWHtiUErJRpjTiq0xLQvtdNp6je8QQRMDxfLK5gW79iFZEaCKURIhPIhW0vnLD-vy7F765kELNXZwt35LiOacoied8b51FtHr.TxI__FLz_mtas4XSHwK73g',
  apiToken: process.env.API_TOKEN || process.env.HF_API_TOKEN || '',
  googleProxyUrl: process.env.GOOGLE_PROXY_URL || process.env.CLOUDFLARE_PROXY_URL || 'https://flow-proxy.aravjha708.workers.dev',
  outboundProxy: process.env.OUTBOUND_PROXY || process.env.RESIDENTIAL_PROXY || process.env.HTTP_PROXY || process.env.HTTPS_PROXY || '',
  gateEnabled: process.env.GATE_ENABLED !== 'false',
  gatePassword: process.env.GATE_PASSWORD || 'flow123',
  sessionVersion: Date.now(),
  cachedAccessToken: '',
  tokenExpiry: 0,

  async getValidAccessToken() {
    if (this.cachedAccessToken && Date.now() < this.tokenExpiry) {
      return this.cachedAccessToken;
    }
    if (!this.sessionCookies) return '';

    try {
      let sessionData = null;
      const endpoints = ['https://labs.google/fx/api/auth/session', 'https://labs.google/api/auth/session'];
      for (const ep of endpoints) {
        try {
          const res = await axios.get(ep, {
            headers: {
              'Cookie': this.sessionCookies,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
              'Origin': 'https://labs.google',
              'Referer': 'https://labs.google/'
            },
            timeout: 8000
          });
          if (res.data && (res.data.access_token || res.data.accessToken || res.data.token || res.data.user?.accessToken)) {
            sessionData = res.data;
            break;
          }
        } catch (_) {}
      }

      if (sessionData) {
        const token = sessionData.access_token || sessionData.accessToken || sessionData.token || sessionData.user?.accessToken;
        if (token) {
          this.cachedAccessToken = token;
          const expiresAt = sessionData.expires ? new Date(sessionData.expires).getTime() : Date.now() + 2700000;
          this.tokenExpiry = Math.max(Date.now() + 60000, expiresAt - 300000);
          console.log('[Auto-Auth] Retrieved fresh Google OAuth Bearer Token for user:', sessionData.user?.email || 'authenticated');
          return this.cachedAccessToken;
        }
      }
    } catch (err) {
      console.warn('[Auto-Auth] Could not exchange session token for Bearer token:', err.message);
    }
    return '';
  },

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
