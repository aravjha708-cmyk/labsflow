const crypto = require('crypto');
const { parseCookies } = require('./cookieHelper');

/**
 * Calculates Google SAPISIDHASH for API authentication
 * Formula: sha1(timestamp + " " + sapisid + " " + origin)
 */
function computeSapisidHash(sapisid, origin = 'https://labs.google') {
  if (!sapisid) return null;
  const timestamp = Math.floor(Date.now() / 1000);
  const hashInput = `${timestamp} ${sapisid} ${origin}`;
  const digest = crypto.createHash('sha1').update(hashInput).digest('hex');
  return `SAPISIDHASH ${timestamp}_${digest}`;
}

/**
 * Extracts SAPISID or fallback auth token from cookie string
 */
function extractAuthInfo(cookieString) {
  const cookies = parseCookies(cookieString);
  const map = {};
  for (const c of cookies) {
    map[c.name] = c.value;
  }

  const sapisid = map['SAPISID'] || map['__Secure-3PAPISID'] || map['__Secure-1PAPISID'] || map['APISID'] || null;
  const sid = map['SID'] || map['__Secure-3PSID'] || map['__Secure-1PSID'] || null;

  return {
    sapisid,
    sid,
    cookieMap: map,
    sapisidHash: sapisid ? computeSapisidHash(sapisid, 'https://labs.google') : null
  };
}

module.exports = {
  computeSapisidHash,
  extractAuthInfo
};
