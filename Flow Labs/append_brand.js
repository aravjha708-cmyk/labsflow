const fs = require('fs');
const b64 = fs.readFileSync('ext/icon128.png').toString('base64');
const cssString = "img[alt='User profile image'] { content: url('data:image/png;base64," + b64 + "') !important; } " +
  "button:has(img[alt='User profile image']) > div { font-size: 0 !important; } " +
  "button:has(img[alt='User profile image']) > div::after { content: 'FLOW LABS'; font-size: 13px !important; font-weight: 700 !important; letter-spacing: 0.5px; }";

const code = "\n// ── Profile Brand Override (CSS Based) ────────────────────────────────────\n" +
  "(function() {\n" +
  "  var style = document.createElement('style');\n" +
  "  style.id = '__flow_brand_override__';\n" +
  "  style.textContent = \"" + cssString + "\";\n" +
  "  function injectBrand() {\n" +
  "    if (!document.getElementById('__flow_brand_override__')) {\n" +
  "      (document.head || document.documentElement).appendChild(style);\n" +
  "    }\n" +
  "  }\n" +
  "  injectBrand();\n" +
  "  if (window.MutationObserver) {\n" +
  "    new MutationObserver(injectBrand).observe(document.documentElement, {childList: true});\n" +
  "  }\n" +
  "})();\n";

fs.appendFileSync('ext/flow_overrides.js', code);
