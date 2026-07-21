#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'assets/js/dashboard-legacy.js');
const distAssets = path.join(root, 'dist/assets');
const legacyFiles = fs.readdirSync(distAssets).filter(file => /^dashboard-legacy-[\w-]+\.js$/.test(file));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(legacyFiles.length === 1, `Build deveria emitir um script legado com hash; encontrados: ${legacyFiles.length}`);
const sourceBytes = fs.statSync(sourcePath).size;
const builtBytes = fs.statSync(path.join(distAssets, legacyFiles[0])).size;
assert(builtBytes < sourceBytes * 0.75, `Script legado não foi minificado: ${builtBytes}/${sourceBytes} bytes`);

console.log(`Build verificado: legado ${sourceBytes} -> ${builtBytes} bytes (${Math.round((1 - builtBytes / sourceBytes) * 100)}% menor)`);
