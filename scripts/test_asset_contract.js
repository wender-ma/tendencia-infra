#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const expectedStylesheets = [
  'assets/css/tokens.css',
  'assets/css/base.css',
  'assets/css/components.css',
  'assets/css/dashboard.css',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const linkedStylesheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/gi)]
  .map(match => match[1]);

assert(
  JSON.stringify(linkedStylesheets) === JSON.stringify(expectedStylesheets),
  `Ordem de estilos inesperada: ${linkedStylesheets.join(', ')}`,
);
assert(!/<style\b/i.test(html), 'index.html voltou a conter CSS embutido');

for (const stylesheet of expectedStylesheets) {
  const absolutePath = path.join(root, stylesheet);
  assert(fs.existsSync(absolutePath), `Folha de estilos ausente: ${stylesheet}`);
  const css = fs.readFileSync(absolutePath, 'utf8');
  assert(css.trim().length > 0, `Folha de estilos vazia: ${stylesheet}`);

  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const openingBraces = (withoutComments.match(/{/g) || []).length;
  const closingBraces = (withoutComments.match(/}/g) || []).length;
  assert(openingBraces === closingBraces, `Chaves CSS desbalanceadas em ${stylesheet}`);
}

console.log('Contrato de assets: quatro folhas CSS externas, ordenadas e íntegras OK');
