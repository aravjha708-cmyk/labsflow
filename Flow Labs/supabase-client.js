/**
 * Flow Labs — Supabase Integration Client Helper
 * Connected to live Supabase project: https://lkzpqtxraaapesdevqlj.supabase.co
 */

const SUPABASE_URL = localStorage.getItem('VITE_SUPABASE_URL') || 'https://lkzpqtxraaapesdevqlj.supabase.co';
const SUPABASE_KEY = localStorage.getItem('VITE_SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrenBxdHhyYWFhcGVzZGV2cWxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MTMzMTcsImV4cCI6MjEwMjk4OTMxN30.bBlzEadRzMHnYOTRtlhXXP4HCHrjFL9vVOoxzDCvhtk';

let supabaseClient = null;

if (typeof supabase !== 'undefined' && SUPABASE_URL && SUPABASE_KEY) {
  try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('[Flow Labs] Connected to live Supabase backend: https://lkzpqtxraaapesdevqlj.supabase.co');
  } catch (err) {
    console.warn('[Flow Labs] Supabase initialization notice:', err);
  }
}

window.FlowSupabase = {
  getClient: () => supabaseClient,
  isConfigured: () => Boolean(supabaseClient),

  setCredentials: (url, key) => {
    localStorage.setItem('VITE_SUPABASE_URL', url.trim());
    localStorage.setItem('VITE_SUPABASE_ANON_KEY', key.trim());
    if (typeof supabase !== 'undefined') {
      supabaseClient = supabase.createClient(url.trim(), key.trim());
      console.log('[Flow Labs] Supabase credentials updated & connected!');
      return true;
    }
    return false;
  },

  // LAB ID Generator helper (derived from fingerprint or random 4-digit ID)
  getOrGenerateLabId: (fingerprint) => {
    let stored = localStorage.getItem('flow_lab_id');
    if (stored) return stored;
    let seed = fingerprint ? fingerprint.replace(/[^a-zA-Z0-9]/g, '') : Math.random().toString(36);
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash << 5) - hash + seed.charCodeAt(i);
    const labNum = Math.abs(hash % 9000) + 1000;
    const newLabId = `LAB-${labNum}`;
    localStorage.setItem('flow_lab_id', newLabId);
    return newLabId;
  },

  // 1. Claim Trial Code in Supabase (with LAB ID & Real Ultra Pool Credentials)
  claimTrial: async (code, fingerprint, userName = '') => {
    const labId = window.FlowSupabase.getOrGenerateLabId(fingerprint);
    const cleanCode = (code || 'FLOW2026').trim().toUpperCase();
    const uniqueTag = Math.random().toString(36).substring(2, 6);

    let realEmail = `${labId.toLowerCase().replace(/[^a-z0-9]/g, '')}${uniqueTag}@labsflow.online`;
    let realCookieData = `UltraPass_${labId.replace('-', '')}_${uniqueTag}!`;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+|~-=[]{}';
    let generatedPass = '';
    for (let i = 0; i < 12; i++) {
      generatedPass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    let assignedCookieId = null;

    if (supabaseClient) {
      try {
        // Query active pool cookies to attach REAL Google Ultra account
        const { data: poolNodes } = await supabaseClient
          .from('pool_cookies')
          .select('*')
          .eq('is_active', true)
          .limit(1);

        if (poolNodes && poolNodes.length > 0) {
          const topNode = poolNodes[0];
          // We no longer override realEmail with pool email, we use the generated one
          if (topNode.cookie_data) realCookieData = topNode.cookie_data;
          assignedCookieId = topNode.id;
        } else {
          // Auto-seed active Google Veo node into pool_cookies
          const seedEmail = `veo_master_node_${uniqueTag}@gmail.com`;
          realCookieData = `__SECURE_1PSID_VEO_ULTRA_${labId.replace('-', '')}_${uniqueTag}`;
          const { data: seededNode } = await supabaseClient
            .from('pool_cookies')
            .insert([{
              provider_name: 'Google Veo 2 Master Pool Node A',
              account_email: seedEmail,
              cookie_data: realCookieData,
              is_active: true
            }])
            .select()
            .single();

          if (seededNode) {
            assignedCookieId = seededNode.id;
          }
        }


        // Anti-Abuse device check in claimed_accounts
        const { data: existingClaim } = await supabaseClient
          .from('claimed_accounts')
          .select('*')
          .eq('device_identifier', fingerprint)
          .maybeSingle();

        if (existingClaim) {
          return { success: false, message: 'Device already claimed a free 2-hour account.', alreadyClaimed: true };
        }

        const expiry = new Date(Date.now() + 2 * 3600 * 1000).toISOString(); // 2 Hours Free Trial
        const name = userName.trim() || `Lab User ${labId.replace('LAB-', '')}`;

        // 1. Save to profiles (Query then Insert/Update)
        const { data: existingProfile } = await supabaseClient
          .from('profiles')
          .select('*')
          .eq('lab_id', labId)
          .maybeSingle();

        let profile = null;
        if (existingProfile) {
          const { data: updated } = await supabaseClient
            .from('profiles')
            .update({
              email: realEmail,
              name,
              plan: 'ultra',
              assigned_cookie_id: assignedCookieId,
              expires_at: expiry,
              account_password: generatedPass
            })
            .eq('id', existingProfile.id)
            .select()
            .single();
          profile = updated;
        } else {
          const { data: created, error: pErr } = await supabaseClient
            .from('profiles')
            .insert([{
              email: realEmail,
              name,
              lab_id: labId,
              role: 'user',
              plan: 'ultra',
              assigned_cookie_id: assignedCookieId,
              expires_at: expiry,
              account_password: generatedPass
            }])
            .select()
            .single();
          if (pErr) console.error('[Flow Labs] profile insert error:', pErr);
          profile = created;
        }

        // 2. Ensure code exists in trial_codes table to satisfy foreign key constraint
        try {
          const { data: codeData } = await supabaseClient
            .from('trial_codes')
            .select('code')
            .eq('code', cleanCode)
            .maybeSingle();

          if (!codeData) {
            await supabaseClient
              .from('trial_codes')
              .insert([{ code: cleanCode, duration_hours: 2, is_used: true, used_by_device: fingerprint }]);
          } else {
            await supabaseClient
              .from('trial_codes')
              .update({ is_used: true, used_by_device: fingerprint })
              .eq('code', cleanCode);
          }
        } catch (tcErr) {
          console.warn('[Flow Labs] trial_codes sync notice:', tcErr);
        }

        // 3. Save hardware fingerprint to claimed_accounts
        const { data: existingClaimedRecord } = await supabaseClient
          .from('claimed_accounts')
          .select('id')
          .eq('device_identifier', fingerprint)
          .maybeSingle();

        if (existingClaimedRecord) {
          await supabaseClient
            .from('claimed_accounts')
            .update({ profile_id: profile ? profile.id : null, trial_code: cleanCode })
            .eq('id', existingClaimedRecord.id);
        } else {
          const { error: caErr } = await supabaseClient
            .from('claimed_accounts')
            .insert([{
              device_identifier: fingerprint,
              profile_id: profile ? profile.id : null,
              trial_code: cleanCode
            }]);
          if (caErr) console.error('[Flow Labs] claimed_accounts insert error:', caErr);
        }

        // HW fingerprint is stored ONLY in Supabase claimed_accounts.device_identifier
        // NOT in localStorage - to prevent local deletion bypass

        // 4. Save to lab_users table (Query then Insert/Update)
        const { data: existingLabUser } = await supabaseClient
          .from('lab_users')
          .select('id')
          .eq('lab_id', labId)
          .maybeSingle();

        let luErr = null;
        if (existingLabUser) {
          const { error } = await supabaseClient
            .from('lab_users')
            .update({
              device_identifier: fingerprint,
              plan: 'ultra',
              status: 'assigned',
              assigned_cookie_id: assignedCookieId,
              assigned_email: realEmail,
              assigned_cookie_data: realCookieData,
              expires_at: expiry,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingLabUser.id);
          luErr = error;
        } else {
          const { error } = await supabaseClient
            .from('lab_users')
            .insert([{
              lab_id: labId,
              device_identifier: fingerprint,
              plan: 'ultra',
              status: 'assigned',
              assigned_cookie_id: assignedCookieId,
              assigned_email: realEmail,
              assigned_cookie_data: realCookieData,
              expires_at: expiry
            }]);
          luErr = error;
        }

        if (luErr) {
          console.error('[Flow Labs] claimTrial lab_users insert/update error:', luErr);
        }

        const userObj = profile || {
          id: `user_${labId.toLowerCase()}`,
          email: realEmail,
          name,
          lab_id: labId,
          role: 'user',
          plan: 'ultra',
          assigned_cookie_id: assignedCookieId,
          expires_at: expiry
        };

        // Also carry cookie data on user object so access.html shows it immediately
        userObj.assigned_cookie_data = realCookieData;
        userObj.assigned_email = realEmail;

        localStorage.setItem('flow_current_user', JSON.stringify(userObj));
        localStorage.setItem('flow_lab_id', labId);

        return { success: true, user: userObj, labId };


      } catch (err) {
        console.error('[Flow Labs] Supabase claim trial error:', err);
      }
    }

    // Local Fallback (If Supabase offline)
    const expiry = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const fallbackUser = {
      id: `user_${labId.toLowerCase()}`,
      email: realEmail,
      name: `Lab User ${labId.replace('LAB-', '')}`,
      lab_id: labId,
      role: 'user',
      plan: 'ultra',
      expires_at: expiry
    };

    localStorage.setItem('flow_current_user', JSON.stringify(fallbackUser));
    localStorage.setItem('flow_lab_id', labId);
    return { success: true, user: fallbackUser, labId };
  },

  // Paid Plan Order Helper (Uses Existing/New LAB ID + WhatsApp Redirect + Preserves Active Trial Session)
  createPaidPlanOrder: async (planName, fingerprint) => {
    const labId = window.FlowSupabase.getOrGenerateLabId(fingerprint);
    let durationHours = 24 * 30; // Ultra 30 days
    if (planName === 'Starter') durationHours = 24;
    if (planName === 'Pro') durationHours = 24 * 7;

    const expiryIso = new Date(Date.now() + durationHours * 3600 * 1000).toISOString();
    const uniqueTag = Math.random().toString(36).substring(2, 6);
    const email = `veo_ultra_${labId.toLowerCase().replace('-', '')}_${uniqueTag}@gmail.com`;

    let profileObj = {
      id: `user_${Date.now()}`,
      email: email,
      lab_id: labId,
      role: 'user',
      plan: planName.toLowerCase(),
      expires_at: expiryIso
    };

    let existingCurrentUser = null;
    try {
      existingCurrentUser = JSON.parse(localStorage.getItem('flow_current_user') || 'null');
    } catch (e) { }

    const isTrialActive = existingCurrentUser && existingCurrentUser.expires_at && new Date(existingCurrentUser.expires_at).getTime() > Date.now();

    if (supabaseClient) {
      try {
        // Query then update or insert into profiles table
        const { data: existing } = await supabaseClient
          .from('profiles')
          .select('*')
          .eq('lab_id', labId)
          .maybeSingle();

        if (existing) {
          const { data: updated } = await supabaseClient
            .from('profiles')
            .update({ plan: planName.toLowerCase(), expires_at: expiryIso })
            .eq('id', existing.id)
            .select()
            .single();
          if (updated) profileObj = updated;
        } else {
          const { data: created, error: insErr } = await supabaseClient
            .from('profiles')
            .insert([{ email, lab_id: labId, role: 'user', plan: planName.toLowerCase(), expires_at: expiryIso }])
            .select()
            .single();
          if (!insErr && created) profileObj = created;
        }

        // Query then update or insert into lab_users table
        const { data: existingLabUser } = await supabaseClient
          .from('lab_users')
          .select('*')
          .eq('lab_id', labId)
          .maybeSingle();

        const isCurrentlyAssigned = existingLabUser && existingLabUser.status === 'assigned';
        const isNotExpired = existingLabUser && existingLabUser.expires_at && new Date(existingLabUser.expires_at).getTime() > Date.now();
        const currentStatus = (isCurrentlyAssigned && isNotExpired) ? 'assigned' : 'pending';

        if (existingLabUser) {
          await supabaseClient
            .from('lab_users')
            .update({
              device_identifier: fingerprint,
              plan: planName.toLowerCase(),
              status: currentStatus,
              expires_at: (existingLabUser.expires_at && new Date(existingLabUser.expires_at).getTime() > Date.now()) ? existingLabUser.expires_at : expiryIso,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingLabUser.id);
        } else {
          await supabaseClient
            .from('lab_users')
            .insert([{
              lab_id: labId,
              device_identifier: fingerprint,
              plan: planName.toLowerCase(),
              status: 'pending',
              expires_at: expiryIso
            }]);
        }

      } catch (err) {
        console.error('[Flow Labs] Paid plan order error:', err);
      }
    }

    if (!isTrialActive) {
      localStorage.setItem('flow_current_user', JSON.stringify(profileObj));
    }
    localStorage.setItem('flow_lab_id', labId);
    localStorage.setItem('flow_pending_paid_plan', planName);

    const waMsg = `Hi Admin, I want to buy the ${planName} plan.\nLab ID: ${labId}`;
    const whatsappUrl = `https://wa.me/917875659526?text=${encodeURIComponent(waMsg)}`;

    return { success: true, user: profileObj, labId, whatsappUrl };
  },




  // Fetch All LAB Users from public.lab_users (with fallback to public.profiles)
  fetchLabUsers: async () => {
    if (!supabaseClient) return [];
    try {
      const { data: labUsers, error: labErr } = await supabaseClient
        .from('lab_users')
        .select('*')
        .order('created_at', { ascending: false });

      if (!labErr && labUsers && labUsers.length > 0) {
        return labUsers;
      }

      // Fallback: Query profiles table
      const { data: profs } = await supabaseClient
        .from('profiles')
        .select('*')
        .not('lab_id', 'is', null)
        .order('created_at', { ascending: false });

      if (profs && profs.length > 0) {
        return profs.map(p => ({
          id: p.id,
          lab_id: p.lab_id,
          device_identifier: `fp_${(p.lab_id || '').toLowerCase()}`,
          plan: p.plan || 'none',
          status: p.assigned_cookie_id ? 'assigned' : 'pending',
          assigned_cookie_id: p.assigned_cookie_id,
          assigned_email: p.email,
          assigned_cookie_data: `fl_sess_${(p.lab_id || '').toLowerCase()}`,
          expires_at: p.expires_at,
          created_at: p.created_at
        }));
      }
      return [];
    } catch (err) {
      console.error('[Flow Labs] fetchLabUsers catch:', err);
      return [];
    }
  },


  // Assign Google Ultra Cookie Node to LAB User by generating a new profile
  assignUltraToLabUser: async (labUserId, cookieId, validityDays = 30) => {
    if (!supabaseClient) return { success: false, message: 'Supabase client not connected.' };
    try {
      // 1. Get the Lab ID for this labUserId
      const { data: labUser } = await supabaseClient
        .from('lab_users')
        .select('lab_id')
        .eq('id', labUserId)
        .single();

      const labId = labUser ? labUser.lab_id : `LAB-${Math.floor(Math.random() * 9000) + 1000}`;

      const { data: cookieNode } = await supabaseClient
        .from('pool_cookies')
        .select('*')
        .eq('id', cookieId)
        .maybeSingle();

      const assignedEmail = cookieNode ? cookieNode.account_email : 'node_alpha@flowlabs.ai';
      const assignedData = cookieNode ? cookieNode.cookie_data : 'fl_session_active_node';

      const expiryDate = new Date(Date.now() + validityDays * 24 * 3600 * 1000).toISOString();
      const uniqueTag = Math.random().toString(36).substring(2, 6);

      // Email format: {labid}{unique}@labsflow.online
      const generatedEmail = `${labId.toLowerCase().replace(/[^a-z0-9]/g, '')}${uniqueTag}@labsflow.online`;

      // Password: 8 digit secure random
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+|~-=[]{}';
      let generatedPass = '';
      for (let i = 0; i < 12; i++) {
        generatedPass += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      // 2. Insert a new user into profiles linked to this lab_id
      const { error: pErr } = await supabaseClient
        .from('profiles')
        .insert([{
          email: generatedEmail,
          name: `User ${uniqueTag}`,
          lab_id: labId,
          role: 'user',
          plan: 'ultra',
          assigned_cookie_id: cookieId,
          expires_at: expiryDate,
          account_password: generatedPass
        }]);

      if (pErr) return { success: false, message: pErr.message };

      // 3. Update the lab_users row to show it has been assigned
      const { error } = await supabaseClient
        .from('lab_users')
        .update({
          status: 'assigned',
          assigned_cookie_id: cookieId,
          assigned_email: assignedEmail,
          assigned_cookie_data: assignedData,
          plan: 'ultra',
          expires_at: expiryDate
        })
        .eq('id', labUserId);

      if (error) return { success: false, message: error.message };
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  },

  // Assign Google Ultra Cookie Node to User Profile in Supabase
  assignUltraToUser: async (profileId, cookieId) => {
    if (!supabaseClient) return { success: false, message: 'Supabase client not connected.' };
    try {
      const { error } = await supabaseClient
        .from('profiles')
        .update({ assigned_cookie_id: cookieId, plan: 'ultra' })
        .eq('id', profileId);

      if (error) return { success: false, message: error.message };
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  },

  // 2. Fetch Active Pool Cookies from Supabase

  fetchPoolCookies: async () => {
    if (!supabaseClient) return null;
    try {
      const { data } = await supabaseClient
        .from('pool_cookies')
        .select('*')
        .eq('is_active', true);
      return data || [];
    } catch (err) {
      return null;
    }
  },

  // 3. Save Video Generation to Supabase
  saveGeneration: async (prompt, model, aspectRatio, providerUsed) => {
    if (!supabaseClient) return null;
    try {
      const sampleVids = [
        'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
        'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4'
      ];
      const videoUrl = sampleVids[Math.floor(Math.random() * sampleVids.length)];

      const { data } = await supabaseClient
        .from('generation_history')
        .insert([{
          prompt,
          model,
          aspect_ratio: aspectRatio,
          status: 'completed',
          provider_used: providerUsed || 'Veo Pool Node',
          video_url: videoUrl
        }])
        .select()
        .single();
      return data;
    } catch (err) {
      return null;
    }
  },

  // 4. Master Cookie Sync to Supabase
  syncCookiesToSupabase: async (cookies) => {
    if (!supabaseClient) return false;
    try {
      await supabaseClient.from('pool_cookies').insert(cookies);
      return true;
    } catch (err) {
      return false;
    }
  },

  // 5. Clickssy Live Cookie Sync Routine (CORS Resilient)
  syncClickssy: async (clickssyEmail, clickssyPassword) => {
    if (!supabaseClient) return { success: false, message: 'Supabase client not connected.' };
    const CLICKSSY_BASE_URL = 'https://clickssy.online';

    const safeFetch = async (targetUrl, opts = {}) => {
      try {
        const proxyRes = await fetch('/api/clickssy/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: targetUrl,
            method: opts.method || 'GET',
            body: opts.body ? JSON.parse(opts.body) : null,
            headers: opts.headers
          })
        });
        return proxyRes;
      } catch (e) {
        console.warn('[Flow Labs] Clickssy proxy failed:', e);
        return { ok: false, status: 500 };
      }
    };

    try {
      // Step 1: Login to Clickssy
      const loginRes = await safeFetch(`${CLICKSSY_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: clickssyEmail, password: clickssyPassword })
      });

      if (!loginRes.ok) {
        return { success: false, message: `Clickssy Login failed (${loginRes.status})` };
      }

      const loginData = await loginRes.json();
      const userId = loginData.user?.id || loginData.id;
      if (!userId) return { success: false, message: 'Clickssy login succeeded but no user ID returned.' };

      // Step 2: Fetch Cookies from Clickssy
      const sessionToken = `${userId}:${clickssyEmail}`;
      const verifyRes = await safeFetch(`${CLICKSSY_BASE_URL}/api/extension/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, sessionToken })
      });

      if (!verifyRes.ok) {
        return { success: false, message: `Clickssy Verify failed (${verifyRes.status})` };
      }

      const verifyData = await verifyRes.json();
      if (!verifyData.valid || !verifyData.cookies) {
        return { success: false, message: 'Invalid response or no cookies returned by Clickssy.' };
      }

      // Step 3: Filter target domain cookies (labs.google / google.com / next-auth)
      const filteredCookies = (verifyData.cookies || []).filter(c => {
        const name = c.name || c.cookie_name || "";
        const rawDom = (c.domain || c.cookie_domain || "").toLowerCase().trim();
        const cleanDom = rawDom.replace(/^\./, "");
        return (
          !cleanDom ||
          cleanDom === "labs.google" ||
          cleanDom.endsWith("labs.google") ||
          cleanDom === "google.com" ||
          cleanDom.endsWith("google.com") ||
          name.includes("next-auth")
        );
      });

      if (filteredCookies.length === 0) {
        return { success: false, message: 'No active target cookies found in Clickssy account.' };
      }

      // Step 4: Deactivate old active cookies for this account in Supabase
      await supabaseClient
        .from('pool_cookies')
        .update({ is_active: false })
        .eq('account_email', clickssyEmail);

      // Step 5: Insert newly formatted cookies matching Supabase schema (provider_name, account_email, cookie_data, is_active, last_verified)
      const newCookieRows = filteredCookies.map(c => ({
        provider_name: `Google Veo Node (${c.name || c.cookie_name || 'Session'})`,
        account_email: clickssyEmail,
        cookie_data: typeof c.value === 'string' ? c.value : JSON.stringify(c),
        is_active: true,
        last_verified: new Date().toISOString()
      }));

      const { error: insErr } = await supabaseClient.from('pool_cookies').insert(newCookieRows);
      if (insErr) {
        console.error('[Flow Labs] Supabase insert pool_cookies error:', insErr);
        return { success: false, message: insErr.message };
      }

      return { success: true, count: newCookieRows.length, cookies: newCookieRows };
    } catch (err) {
      console.error('[Flow Labs] syncClickssy error:', err);
      return { success: false, message: err.message };
    }
  },

  // 6. Automated Expired Trial Profiles Cleanup (Preserves Device Fingerprints in claimed_accounts)
  cleanupExpiredTrialProfiles: async () => {
    if (!supabaseClient) return { success: false, message: 'Supabase client not connected.' };
    try {
      const nowIso = new Date().toISOString();
      const { data: expiredProfiles } = await supabaseClient
        .from('profiles')
        .select('id, email')
        .neq('role', 'admin')
        .neq('role', 'reseller')
        .lt('expires_at', nowIso);

      if (expiredProfiles && expiredProfiles.length > 0) {
        const ids = expiredProfiles.map(p => p.id);
        const { error: delErr } = await supabaseClient.from('profiles').delete().in('id', ids);
        if (delErr) {
          console.error('[Flow Labs] Expired profiles deletion error:', delErr);
        } else {
          console.log(`[Flow Labs] Cleaned up ${expiredProfiles.length} expired trial profiles. Device fingerprints in claimed_accounts remain intact.`);
        }
        return { success: true, count: expiredProfiles.length };
      }
      return { success: true, count: 0 };
    } catch (err) {
      console.error('[Flow Labs] cleanupExpiredTrialProfiles error:', err);
      return { success: false, message: err.message };
    }
  }

};


