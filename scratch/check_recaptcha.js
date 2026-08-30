const axios = require('axios');

async function check() {
  try {
    const res = await axios.get('https://labs.google/fx/tools/flow', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html = res.data;
    const chunkMatches = html.match(/https:\/\/[^"']+\.js/g) || [];
    console.log('Total script URLs:', chunkMatches.length);

    for (const url of chunkMatches) {
      if (url.includes('recaptcha') || url.includes('google.com/recaptcha')) continue;
      try {
        const jsRes = await axios.get(url);
        const js = jsRes.data;
        if (js.includes('6LdsFiUs') || js.includes('recaptcha') || js.includes('execute(')) {
          console.log('\nFound in:', url);
          const snippets = js.match(/.{0,80}(?:6LdsFiUs|execute\(|recaptchaToken).{0,80}/g) || [];
          snippets.forEach(s => console.log('Snippet:', s));
        }
      } catch (_) {}
    }
  } catch (e) {
    console.error(e.message);
  }
}
check();
