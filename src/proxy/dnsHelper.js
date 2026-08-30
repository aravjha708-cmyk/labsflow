const https = require('https');
const http = require('http');
const dns = require('dns');

// Public DNS resolver (Google & Cloudflare DNS)
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const dnsCache = new Map();

/**
 * Custom DNS lookup that resolves public IPs directly from 8.8.8.8,
 * bypassing any local hosts file overrides for labs.google or googleapis.com.
 */
function publicDnsLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  // Check in-memory cache (valid for 10 minutes)
  const cached = dnsCache.get(hostname);
  if (cached && Date.now() - cached.timestamp < 600000) {
    if (options.all) {
      return callback(null, [{ address: cached.ip, family: 4 }]);
    }
    return callback(null, cached.ip, 4);
  }

  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses || addresses.length === 0) {
      // Fallback to system lookup if public DNS fails
      return dns.lookup(hostname, options, callback);
    }

    const ip = addresses[0];
    dnsCache.set(hostname, { ip, timestamp: Date.now() });

    if (options.all) {
      return callback(null, [{ address: ip, family: 4 }]);
    }
    return callback(null, ip, 4);
  });
}

// High-Performance HTTPS Agent with persistent connection pooling
const publicHttpsAgent = new https.Agent({
  lookup: publicDnsLookup,
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 200,
  maxFreeSockets: 100,
  timeout: 60000
});

module.exports = {
  publicDnsLookup,
  publicHttpsAgent
};
