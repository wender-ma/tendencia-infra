#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tokens = fs.readFileSync(path.join(root, 'assets/css/tokens.css'), 'utf8');
const visualSources = [
  'assets/css/base.css',
  'assets/css/dashboard.css',
  'assets/js/dashboard-legacy.js',
].map(file => ({ file, source: fs.readFileSync(path.join(root, file), 'utf8') }));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const token of [
  '--accent-purple',
  '--accent-info',
  '--sem-ok-subtle',
  '--sem-erro-soft',
  '--sem-alerta-subtle',
  '--text-on-dark',
  '--row-flow-bg',
]) {
  assert(tokens.includes(`${token}:`), `Token oficial ausente: ${token}`);
}

for (const { file, source } of visualSources) {
  const rawHex = source.match(/#[0-9a-f]{3,8}\b/gi) || [];
  assert(rawHex.length === 0, `${file} contém cores hex fora dos tokens: ${[...new Set(rawHex)].join(', ')}`);
}

assert(tokens.includes('body.dark'), 'Tokens do tema escuro ausentes');
assert(tokens.includes('--accent-purple:        #A78BFA'), 'Acento roxo não possui variante escura');
assert(!visualSources.some(({ source }) => /colors:\s*\[\s*['"]var\(--/.test(source)), 'ApexCharts recebeu variável CSS sem resolução');
assert(visualSources.some(({ source }) => source.includes('const themeRoot = document.body || document.documentElement')), 'Gráficos não resolvem tokens a partir do tema ativo');

console.log('Contrato de cores: paleta centralizada e temas claro/escuro sem hex disperso OK');
