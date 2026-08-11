#!/usr/bin/env node
// Copies the two variable font files the interface uses out of node_modules and into
// public/vendor/fonts, the same way three.js is vendored.
//
// Self-hosted rather than loaded from Google Fonts: no third-party origin on the critical
// path, no flash of fallback type, and it works offline. Latin subset only, and the variable
// `wght` axis means one file covers every weight in the type scale.
//
// Run after changing either fontsource devDependency:  npm run vendor:fonts

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TARGET = path.join(ROOT, "public", "vendor", "fonts");

const FILES = [
  // Newsreader — everything the user writes. The "standard" build carries both the weight and
  // the optical-size axis; opsz matters here because the scale runs from 17px body to a 32px
  // wordmark, and that is exactly what optical sizing is for. Italic covers the 300 italic.
  ["@fontsource-variable/newsreader/files/newsreader-latin-standard-normal.woff2", "newsreader-normal.woff2"],
  ["@fontsource-variable/newsreader/files/newsreader-latin-standard-italic.woff2", "newsreader-italic.woff2"],
  // Karla — everything the app says. No optical-size axis exists for it.
  ["@fontsource-variable/karla/files/karla-latin-wght-normal.woff2", "karla-normal.woff2"]
];

function main() {
  let bytes = 0;
  fs.mkdirSync(TARGET, { recursive: true });

  for (const [from, to] of FILES) {
    const src = path.join(ROOT, "node_modules", from);
    if (!fs.existsSync(src)) {
      console.error(`missing: ${from} — run \`npm install\` first`);
      process.exit(1);
    }
    const dest = path.join(TARGET, to);
    fs.copyFileSync(src, dest);
    bytes += fs.statSync(dest).size;
  }

  console.log(`vendored ${FILES.length} font files, ${(bytes / 1024).toFixed(0)} KB`);
}

main();
