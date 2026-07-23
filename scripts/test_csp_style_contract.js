#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function collectJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(target);
    return /\.m?js$/.test(entry.name) ? [target] : [];
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sources = collectJavaScriptFiles(path.join(root, 'assets/js')).map((file) => ({
  file,
  content: fs.readFileSync(file, 'utf8'),
}));
const directStyleMutations = sources.filter(({ content }) => /\.style\./.test(content));
const inlineAttributes = sources.reduce(
  (total, { content }) => total + (content.match(/\bstyle=/g) || []).length,
  0,
);

assert(
  directStyleMutations.length === 0,
  `Mutações diretas de style impedem CSP estrita: ${directStyleMutations.map(({ file }) => path.relative(root, file)).join(', ')}`,
);
assert(
  inlineAttributes === 0,
  `Estilos inline impedem CSP estrita: ${inlineAttributes} atributo(s) style= encontrado(s)`,
);

console.log('Contrato CSP: zero mutações diretas e zero estilos inline nos módulos JavaScript');
