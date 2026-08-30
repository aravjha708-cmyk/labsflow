const userManager = require('./userManager');
const config = require('../config');
const { parseCookies } = require('../proxy/cookieHelper');
const { extractAuthInfo } = require('../proxy/googleAuthHelper');

async function handleLogin(req, res) {
  const { email, password } = req.body || {};
  const result = await userManager.validateUserCredentials(email, password);

  if (!result.valid) {
    return res.status(401).json({
      success: false,
      error: result.error,
      isExpired: result.isExpired || false
    });
  }

  // Set persistent authenticated gate session cookie
  const expiresDate = new Date(result.user.expiresAt).toUTCString();
  res.setHeader(
    'Set-Cookie',
    `flow_gate_session=${result.user.id}; Path=/; Secure; SameSite=Lax; Max-Age=2592000; Expires=${expiresDate}`
  );

  return res.json({
    success: true,
    token: result.user.id,
    user: result.user
  });
}

function handleMe(req, res) {
  const cookieHeader = req.headers['cookie'] || '';
  const match = cookieHeader.match(/flow_gate_session=([^;]+)/);
  const authHeader = req.headers.authorization;
  const token = (authHeader && authHeader.startsWith('Bearer ')) 
    ? authHeader.split(' ')[1] 
    : (match ? match[1] : null);

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = userManager.getUserById(token);
  if (user && user.daysRemaining <= 0) {
    return res.status(401).json({ error: 'Session expired' });
  }

  return res.json({
    success: true,
    user: user || { id: token, name: 'User', plan: 'ultra', daysRemaining: 30 }
  });
}

function handleGateStatus(req, res) {
  if (!config.gateEnabled) {
    return res.json({ authenticated: true, gateEnabled: false });
  }

  const cookieHeader = req.headers['cookie'] || '';
  const match = cookieHeader.match(/flow_gate_session=([^;]+)/);

  if (!match) {
    return res.json({ authenticated: false, gateEnabled: true });
  }

  const userId = match[1];
  const user = userManager.getUserById(userId);

  // If local user exists and expired, prompt login
  if (user && (user.daysRemaining <= 0 || !user.isActive)) {
    return res.json({ authenticated: false, gateEnabled: true, expired: true });
  }

  return res.json({
    authenticated: true,
    gateEnabled: true,
    user: user || {
      id: userId,
      name: 'Active User',
      plan: 'ultra',
      daysRemaining: 30
    }
  });
}

function handleGateSignout(req, res) {
  res.setHeader('Set-Cookie', 'flow_gate_session=; Path=/; Secure; SameSite=Lax; Max-Age=0');
  res.json({ success: true });
}

// ==========================================
// Admin User Management Endpoints
// ==========================================

function handleGetUsers(req, res) {
  const users = userManager.getAllUsers();
  res.json({ success: true, users });
}

function handleCreateUser(req, res) {
  try {
    const newUser = userManager.createUser(req.body);
    res.json({ success: true, user: newUser });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

function handleUpdateUser(req, res) {
  try {
    const updated = userManager.updateUser(req.params.id, req.body);
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

function handleDeleteUser(req, res) {
  try {
    userManager.deleteUser(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

module.exports = {
  handleLogin,
  handleMe,
  handleGateStatus,
  handleGateSignout,
  handleGetUsers,
  handleCreateUser,
  handleUpdateUser,
  handleDeleteUser
};
