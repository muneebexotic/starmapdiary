#!/usr/bin/env node
// Copies the three.js files the app actually uses out of node_modules and into
// public/vendor/three, which is what the browser loads.
//
// three.js is self-hosted rather than pulled from a CDN so the galaxy has no third-party
// runtime dependency: one less origin to trust, no cross-origin round trip on first paint,
// and the version is pinned by what is committed rather than by a URL.
//
// Run after changing the three devDependency:  npm run vendor:three

const fs = require("node:fs");
const path = require("node:path");

const SOURCE = path.resolve(__dirname, "..", "node_modules", "three");
const TARGET = path.resolve(__dirname, "..", "public", "vendor", "three");

// Kept deliberately explicit: the whole examples/jsm tree is megabytes, and this list is
// the closed dependency graph of what we import.
const FILES = [
  ["build/three.module.min.js", "build/three.module.min.js"],
  ["build/three.core.min.js", "build/three.core.min.js"],
  ["examples/jsm/controls/OrbitControls.js", "addons/controls/OrbitControls.js"],
  ["examples/jsm/postprocessing/EffectComposer.js", "addons/postprocessing/EffectComposer.js"],
  ["examples/jsm/postprocessing/Pass.js", "addons/postprocessing/Pass.js"],
  ["examples/jsm/postprocessing/RenderPass.js", "addons/postprocessing/RenderPass.js"],
  ["examples/jsm/postprocessing/ShaderPass.js", "addons/postprocessing/ShaderPass.js"],
  ["examples/jsm/postprocessing/MaskPass.js", "addons/postprocessing/MaskPass.js"],
  ["examples/jsm/postprocessing/UnrealBloomPass.js", "addons/postprocessing/UnrealBloomPass.js"],
  ["examples/jsm/postprocessing/OutputPass.js", "addons/postprocessing/OutputPass.js"],
  ["examples/jsm/shaders/CopyShader.js", "addons/shaders/CopyShader.js"],
  ["examples/jsm/shaders/LuminosityHighPassShader.js", "addons/shaders/LuminosityHighPassShader.js"],
  ["examples/jsm/shaders/OutputShader.js", "addons/shaders/OutputShader.js"]
];

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error("node_modules/three not found. Run `npm install` first.");
    process.exit(1);
  }

  const version = JSON.parse(fs.readFileSync(path.join(SOURCE, "package.json"), "utf8")).version;
  let bytes = 0;

  for (const [from, to] of FILES) {
    const src = path.join(SOURCE, from);
    const dest = path.join(TARGET, to);

    if (!fs.existsSync(src)) {
      console.error(`missing in three@${version}: ${from}`);
      process.exit(1);
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    bytes += fs.statSync(dest).size;
  }

  fs.writeFileSync(
    path.join(TARGET, "VERSION"),
    `three@${version}\nvendored by scripts/vendor-three.js — do not edit these files by hand\n`
  );

  console.log(`vendored three@${version}: ${FILES.length} files, ${(bytes / 1024).toFixed(0)} KB`);
}

main();
