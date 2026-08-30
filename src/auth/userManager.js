const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const config = require('../config');

const dataDir = path.join(__dirname, '..', '..', 'data');
const usersFilePath = path.join(dataDir, 'users.json');

// Supabase Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://lkzpqtxraaapesdevqlj.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrenBxdHhyYWFhcGVzZGV2cWxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MTMzMTcsImV4cCI6MjEwMjk4OTMxN30.bBlzEadRzMHnYOTRtlhXXP4HCHrjFL9vVOoxzDCvhtk';

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initial seed data if users.json does not exist
function initUserStore() {
  if (!fs.existsSync(usersFilePath)) {
    const defaultUsers = [
      {
        id: 'usr_admin_01',
        name: 'System Admin',
        email: 'admin@flowlabs.ai',
        password: 'admin',
        role: 'admin',
        plan: 'ultra',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        isActive: true
      },
      {
        id: 'usr_pro_01',
        name: 'Pro Member',
        email: 'pro@flowlabs.ai',
        password: 'flow',
        role: 'user',
        plan: 'pro',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        isActive: true
      }
    ];
    fs.writeFileSync(usersFilePath, JSON.stringify(defaultUsers, null, 2), 'utf-8');
  }
}

initUserStore();

function loadUsers() {
  try {
    const raw = fs.readFileSync(usersFilePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveUsers(users) {
  try {
    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Failed to save users:', e);
    return false;
  }
}

function getDaysRemaining(expiresAt) {
  if (!expiresAt) return 0;
  const expDate = new Date(expiresAt);
  const diff = expDate.getTime() - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getAllUsers() {
  const users = loadUsers();
  return users.map(u => ({
    ...u,
    daysRemaining: getDaysRemaining(u.expiresAt),
    isExpired: new Date(u.expiresAt).getTime() <= Date.now()
  }));
}

const sessionsFilePath = path.join(dataDir, 'sessions.json');

function loadSessions() {
  try {
    if (fs.existsSync(sessionsFilePath)) {
      const data = JSON.parse(fs.readFileSync(sessionsFilePath, 'utf-8'));
      return new Map(Object.entries(data));
    }
  } catch(_) {}
  return new Map();
}

function saveSessions(cache) {
  try {
    const obj = {};
    for (const [k, v] of cache.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(sessionsFilePath, JSON.stringify(obj, null, 2), 'utf-8');
  } catch(_) {}
}

const sessionCache = loadSessions();

function setSessionUser(id, userObj) {
  if (!id || !userObj) return;
  sessionCache.set(id, userObj);
  if (userObj.email) {
    sessionCache.set(userObj.email.toLowerCase(), userObj);
  }
  saveSessions(sessionCache);
}

function getUserById(id) {
  if (sessionCache.has(id)) {
    return sessionCache.get(id);
  }
  const users = loadUsers();
  const u = users.find(user => user.id === id);
  if (!u) return null;
  return {
    ...u,
    daysRemaining: getDaysRemaining(u.expiresAt),
    isExpired: new Date(u.expiresAt).getTime() <= Date.now()
  };
}

function getUserByEmail(email) {
  if (!email) return null;
  const clean = email.trim().toLowerCase();
  if (sessionCache.has(clean)) {
    return sessionCache.get(clean);
  }
  const users = loadUsers();
  const u = users.find(user => user.email.toLowerCase() === clean);
  if (!u) return null;
  return {
    ...u,
    daysRemaining: getDaysRemaining(u.expiresAt),
    isExpired: new Date(u.expiresAt).getTime() <= Date.now()
  };
}

// Fetch user profile from Supabase
async function fetchSupabaseProfile(email) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !email) return null;
  try {
    const cleanEmail = encodeURIComponent(email.trim().toLowerCase());
    const res = await axios.get(`${SUPABASE_URL}/rest/v1/profiles?email=ilike.${cleanEmail}&select=*`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      },
      timeout: 5000
    });

    if (res.data && res.data.length > 0) {
      return res.data[0];
    }
  } catch (err) {
    console.warn('[UserManager] Supabase query notice:', err.message);
  }
  return null;
}

function createUser({ name, email, password, plan = 'ultra', totalCredits = 25000, validityDays = 30, role = 'user' }) {
  if (!email || !password) throw new Error('Email and password required');
  const normalizedEmail = email.trim().toLowerCase();
  
  const existing = getUserByEmail(normalizedEmail);
  if (existing) throw new Error('A user with this email already exists');

  const users = loadUsers();
  const days = parseInt(validityDays, 10) || 30;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const credits = parseInt(totalCredits, 10) || (plan === 'ultra_45k' ? 45000 : 25000);

  const newUser = {
    id: `usr_${crypto.randomBytes(6).toString('hex')}`,
    name: name ? name.trim() : normalizedEmail.split('@')[0],
    email: normalizedEmail,
    password: password.trim(),
    role: role,
    plan: plan,
    totalCredits: credits,
    usedCredits: 0,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt,
    isActive: true
  };

  users.push(newUser);
  saveUsers(users);

  return {
    ...newUser,
    daysRemaining: days,
    isExpired: false
  };
}

function updateUser(id, updates) {
  const users = loadUsers();
  const index = users.findIndex(u => u.id === id);
  if (index === -1) throw new Error('User not found');

  const user = users[index];

  if (updates.name !== undefined) user.name = updates.name.trim();
  if (updates.email !== undefined) user.email = updates.email.trim().toLowerCase();
  if (updates.password !== undefined && updates.password.trim().length > 0) user.password = updates.password.trim();
  if (updates.plan !== undefined) user.plan = updates.plan;
  if (updates.role !== undefined) user.role = updates.role;
  if (updates.isActive !== undefined) user.isActive = Boolean(updates.isActive);
  if (updates.totalCredits !== undefined) user.totalCredits = parseInt(updates.totalCredits, 10) || 25000;
  if (updates.usedCredits !== undefined) user.usedCredits = parseInt(updates.usedCredits, 10) || 0;

  if (updates.validityDays !== undefined) {
    const days = parseInt(updates.validityDays, 10);
    user.expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  } else if (updates.expiresAt !== undefined) {
    user.expiresAt = new Date(updates.expiresAt).toISOString();
  }

  users[index] = user;
  saveUsers(users);

  return {
    ...user,
    daysRemaining: getDaysRemaining(user.expiresAt),
    isExpired: new Date(user.expiresAt).getTime() <= Date.now()
  };
}

function deleteUser(id) {
  const users = loadUsers();
  const filtered = users.filter(u => u.id !== id);
  if (filtered.length === users.length) throw new Error('User not found');
  saveUsers(filtered);
  return { success: true };
}

/**
 * Validate credentials against both local user store and Supabase profiles table
 */
async function validateUserCredentials(email, password) {
  if (!email || !password) {
    return { valid: false, error: 'Email and password required' };
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanPass = password.trim();

  // 1. Check local users.json store
  const localUser = getUserByEmail(cleanEmail);
  if (localUser) {
    if (localUser.isActive === false) {
      return { valid: false, error: 'This account has been deactivated by admin.' };
    }

    if (localUser.password === cleanPass || cleanPass === config.gatePassword) {
      const daysRemaining = getDaysRemaining(localUser.expiresAt);
      if (daysRemaining <= 0) {
        return {
          valid: false,
          isExpired: true,
          error: `Your ${(localUser.plan || 'ultra').toUpperCase()} plan has expired. Please contact administrator to renew.`
        };
      }

      return {
        valid: true,
        user: {
          id: localUser.id,
          name: localUser.name,
          email: localUser.email,
          role: localUser.role || 'user',
          plan: localUser.plan || 'ultra',
          expiresAt: localUser.expiresAt,
          daysRemaining: daysRemaining,
          isActive: true
        }
      };
    }
  }

  // 2. Check Supabase profiles table (for users created in /admin)
  const supaProfile = await fetchSupabaseProfile(cleanEmail);
  if (supaProfile) {
    // Check password matches account_password, password, legacy fl_sess_<lab_id>, or master gate password
    const expectedPass = supaProfile.account_password || supaProfile.password || `fl_sess_${(supaProfile.lab_id || '').toLowerCase()}`;
    const isPassValid = (cleanPass === expectedPass) || (cleanPass === config.gatePassword);

    if (!isPassValid) {
      return { valid: false, error: 'Wrong password. Try again or click Forgot password.' };
    }

    const expiryTime = supaProfile.expires_at || supaProfile.expiresAt;
    const daysRemaining = getDaysRemaining(expiryTime);

    if (expiryTime && daysRemaining <= 0) {
      return {
        valid: false,
        isExpired: true,
        error: `Your ${(supaProfile.plan || 'ultra').toUpperCase()} plan has expired. Please contact administrator to renew.`
      };
    }

    const userObj = {
      id: supaProfile.id,
      name: supaProfile.name || cleanEmail.split('@')[0],
      email: supaProfile.email,
      role: supaProfile.role || 'user',
      plan: supaProfile.plan || 'ultra',
      expiresAt: expiryTime || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      daysRemaining: daysRemaining || 30,
      isActive: supaProfile.is_active !== false
    };

    setSessionUser(userObj.id, userObj);

    return {
      valid: true,
      user: userObj
    };
  }

  // 3. Fallback check for master gate password
  if (cleanPass === config.gatePassword) {
    return {
      valid: true,
      user: {
        id: 'usr_master_session',
        name: cleanEmail.split('@')[0],
        email: cleanEmail,
        role: 'user',
        plan: 'ultra',
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        daysRemaining: 30
      }
    };
  }

  return { valid: false, error: 'Invalid credentials or account not found in database.' };
}

module.exports = {
  getAllUsers,
  getUserById,
  getUserByEmail,
  createUser,
  updateUser,
  deleteUser,
  validateUserCredentials,
  getDaysRemaining
};
