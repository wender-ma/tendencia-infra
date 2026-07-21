#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distAssets = path.join(root, 'dist/assets');
const legacyFiles = fs.readdirSync(distAssets).filter(file => /^dashboard-legacy-[\w-]+\.js$/.test(file));
const mainFiles = fs.readdirSync(distAssets).filter(file => /^index-[\w-]+\.js$/.test(file));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(legacyFiles.length === 0, `Build voltou a emitir script legado: ${legacyFiles.join(', ')}`);
assert(mainFiles.length === 1, `Build deveria emitir um módulo principal; encontrados: ${mainFiles.length}`);
const builtBytes = fs.statSync(path.join(distAssets, mainFiles[0])).size;
assert(builtBytes > 0, 'Módulo principal do build está vazio');

console.log(`Build verificado: módulo principal com ${builtBytes} bytes e nenhum script clássico legado`);
