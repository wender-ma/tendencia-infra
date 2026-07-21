#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const headers = fs.readFileSync(path.join(root, 'public/_headers'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const robots = fs.readFileSync(path.join(root, 'public/robots.txt'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/<meta name="description" content="[^"]{50,160}">/.test(html), 'Meta description ausente ou inadequada');
assert(/<meta name="robots" content="noindex, nofollow, noarchive">/.test(html), 'Dashboard interno precisa bloquear indexação');
assert(/^User-agent: \*\nDisallow: \/\s*$/m.test(robots), 'robots.txt interno deve ser válido e bloquear rastreamento');
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
const cspLine = headers.split('\n').find(line => line.includes('Content-Security-Policy:')) || '';
assert(cspLine.includes("script-src 'self'"), 'CSP deve aceitar scripts somente da própria origem');
assert(cspLine.includes("script-src-attr 'none'"), 'CSP deve bloquear atributos JavaScript');
assert(cspLine.includes('https://*.supabase.co'), 'CSP deve permitir a API do Supabase');
assert(!/script-src[^;]*unsafe-inline/.test(cspLine), 'CSP não pode liberar JavaScript inline');
assert(vercel.buildCommand === 'npm run build' && vercel.outputDirectory === 'dist', 'Build da Vercel incorreto');
const vercelHeaderNames = vercel.headers.flatMap(rule => rule.headers.map(header => header.key));
for (const headerName of [
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'Cross-Origin-Opener-Policy',
  'Content-Security-Policy',
]) {
  assert(vercelHeaderNames.includes(headerName), `Header ausente na Vercel: ${headerName}`);
}

console.log('Contrato de metadados: dashboard interno, Vercel, headers e cache OK');
