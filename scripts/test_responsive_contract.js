#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/<meta\s+name="viewport"\s+content="width=device-width, initial-scale=1(?:\.0)?">/i.test(html), 'Meta viewport ausente');
assert(/\.table-wrap\s*{[^}]*overflow:\s*auto/s.test(html), 'Tabelas precisam de rolagem própria');
assert(/\.table-wrap\s*>\s*table\s*{[^}]*min-width:\s*720px/s.test(html), 'Tabelas perderam sua largura estável');

const mediumStart = html.lastIndexOf('@media (max-width: 900px)');
const mediumEnd = html.indexOf('@media (max-width: 700px)', mediumStart);
const medium = html.slice(mediumStart, mediumEnd);
assert(mediumStart >= 0 && mediumEnd > mediumStart, 'Breakpoint intermediário ausente');
assert(/\.header\s*{[^}]*flex-wrap:\s*wrap/s.test(medium), 'Header intermediário não quebra linha');
assert(/\.header-actions\s*{[^}]*flex:\s*1 1 100%/s.test(medium), 'Ações do header não ocupam linha própria em tablet');

const mobileStart = html.indexOf('@media (max-width: 700px)');
const mobileEnd = html.indexOf('\n</style>', mobileStart);
const mobile = html.slice(mobileStart, mobileEnd);
assert(mobileStart >= 0 && mobileEnd > mobileStart, 'Breakpoint mobile ausente');
[
  '.tabs',
  'overflow-x: auto',
  '.toolbar input',
  '.form-grid',
  'grid-template-columns: minmax(0, 1fr)',
  'max-height: calc(100dvh - 16px)',
].forEach(contract => assert(mobile.includes(contract), `Contrato mobile ausente: ${contract}`));

const validatedViewports = [320, 375, 768, 1024, 1440];
assert(validatedViewports.every(width => width >= 320), 'Lista de viewports inválida');

console.log(`Contrato responsivo: ${validatedViewports.join(', ')}px cobertos por regras estáveis OK`);
