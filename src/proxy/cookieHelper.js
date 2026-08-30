/**
 * Cookie Parser and Set-Cookie Generator for Google Labs Flow
 */
function parseCookies(rawCookieStr) {
  if (!rawCookieStr || typeof rawCookieStr !== 'string') return [];

  const sanitized = rawCookieStr.replace(/[\r\n]+/g, ' ').trim();
  if (!sanitized) return [];

  const cookieMap = new Map();
  const parts = sanitized.split(';');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || !trimmed.includes('=')) continue;

    const idx = trimmed.indexOf('=');
    const name = trimmed.substring(0, idx).trim();
    const value = trimmed.substring(idx + 1).trim();

    if (name && value) {
      // If duplicate, overwrite with latest value
      cookieMap.set(name, value);
    }
  }

  const results = [];
  for (const [name, value] of cookieMap.entries()) {
    results.push({
      name,
      value,
      raw: `${name}=${value}`
    });
  }

  return results;
}

function generateSetCookieHeaders(cookiesList) {
  const headers = [];

  for (const c of cookiesList) {
    // Generate clean HTTPS cookie with Secure attribute
    headers.push(`${c.name}=${c.value}; Path=/; Secure; SameSite=Lax; Max-Age=2592000`);

    // If cookie starts with __Secure- or __Host-, also provide an unprefixed fallback
    if (c.name.startsWith('__Secure-')) {
      const alias = c.name.replace('__Secure-', '');
      headers.push(`${alias}=${c.value}; Path=/; Secure; SameSite=Lax; Max-Age=2592000`);
    } else if (c.name.startsWith('__Host-')) {
      const alias = c.name.replace('__Host-', '');
      headers.push(`${alias}=${c.value}; Path=/; Secure; SameSite=Lax; Max-Age=2592000`);
    }
  }

  return headers;
}

function generateClearCookieHeaders() {
  const commonNames = [
    'SID', 'HSID', 'SSID', 'APISID', 'SAPISID',
    '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PAPISID', '__Secure-3PAPISID',
    '__Secure-1PSIDTS', '__Secure-3PSIDTS', '__Secure-1PSIDCC', '__Secure-3PSIDCC',
    '1PSID', '3PSID', '1PAPISID', '3PAPISID',
    'OTZ', 'SEARCH_SAMESITE', 'NID', 'AEC', 'SOCS'
  ];

  return commonNames.map(name => `${name}=; Path=/; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

module.exports = {
  parseCookies,
  generateSetCookieHeaders,
  generateClearCookieHeaders
};
