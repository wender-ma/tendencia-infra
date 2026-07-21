#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const headers = fs.readFileSync(path.join(root, 'public/_headers'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/<meta name="description" content="[^"]{50,160}">/.test(html), 'Meta description ausente ou inadequada');
assert(/<meta name="robots" content="noindex, nofollow, noarchive">/.test(html), 'Dashboard interno precisa bloquear indexação');
for (const header of [
  'X-Content-Type-Options: nosniff',
  'X-Frame-Options: DENY',
  'Referrer-Policy: strict-origin-when-cross-origin',
  'Permissions-Policy:',
  'Cross-Origin-Opener-Policy: same-origin',
]) {
  assert(headers.includes(header), `Header defensivo ausente: ${header}`);
}
assert(headers.includes('max-age=31536000, immutable'), 'Cache imutável de assets ausente');
assert(headers.includes('/index.html\n  Cache-Control: no-cache'), 'HTML precisa revalidar cache');

console.log('Contrato de metadados: dashboard interno, headers e cache OK');
