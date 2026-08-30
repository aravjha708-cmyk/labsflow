/**
 * Flow Labs - Cloudflare Edge Proxy Worker (100% Free - 100,000 requests/day)
 * Bypasses cloud datacenter IP blocks by relaying requests through Cloudflare's global edge network.
 */
export default {
  async fetch(request, env, ctx) {
    // Handle CORS Preflight OPTIONS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    const url = new URL(request.url);
    let targetUrl = url.searchParams.get('_target_url');

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'Missing _target_url query parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    try {
      const targetObj = new URL(targetUrl);

      // Clone incoming headers and set Google browser headers
      const forwardHeaders = new Headers();
      for (const [key, value] of request.headers.entries()) {
        const lower = key.toLowerCase();
        if (
          lower !== 'host' &&
          lower !== 'cf-connecting-ip' &&
          lower !== 'cf-ray' &&
          lower !== 'cf-ipcountry' &&
          lower !== 'x-forwarded-for' &&
          lower !== 'x-real-ip'
        ) {
          forwardHeaders.set(key, value);
        }
      }

      forwardHeaders.set('Host', targetObj.host);
      forwardHeaders.set('Origin', 'https://labs.google');
      forwardHeaders.set('Referer', 'https://labs.google/');
      forwardHeaders.set(
        'User-Agent',
        request.headers.get('user-agent') ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      );

      const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
      const body = hasBody ? await request.arrayBuffer() : undefined;

      const response = await fetch(targetUrl, {
        method: request.method,
        headers: forwardHeaders,
        body: body,
        redirect: 'follow'
      });

      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      responseHeaders.set('Access-Control-Allow-Headers', '*');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, targetUrl }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
};
