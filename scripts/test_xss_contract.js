#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const legacy = fs.readFileSync(path.join(root, 'assets/js/dashboard-legacy.js'), 'utf8');
const uploadRepository = fs.readFileSync(
  path.join(root, 'assets/js/services/upload-repository.mjs'),
  'utf8',
);
const uploadUi = fs.readFileSync(path.join(root, 'assets/js/ui/uploads.mjs'), 'utf8');
const securitySurface = `${legacy}\n${uploadUi}`;
const modularSources = [
  'assets/js/bootstrap.js',
  'assets/js/config.js',
  'assets/js/state.js',
  'assets/js/performance.mjs',
  ...fs.readdirSync(path.join(root, 'assets/js/parsers')).map(file => `assets/js/parsers/${file}`),
  ...fs.readdirSync(path.join(root, 'assets/js/services')).map(file => `assets/js/services/${file}`),
  ...fs.readdirSync(path.join(root, 'assets/js/ui')).map(file => `assets/js/ui/${file}`),
].map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const [file, source] of modularSources) {
  assert(!source.includes('.innerHTML'), `Módulo novo não pode usar innerHTML: ${file}`);
  assert(!source.includes('insertAdjacentHTML'), `Módulo novo não pode inserir HTML textual: ${file}`);
}

const innerHtmlCount = (legacy.match(/\.innerHTML\s*=/g) || []).length;
const replaceChildrenCount = (legacy.match(/\.replaceChildren\(/g) || []).length;
assert(innerHtmlCount <= 80, `Baseline de innerHTML aumentou: ${innerHtmlCount}`);
assert(replaceChildrenCount >= 24, 'Limpezas de DOM voltaram a usar innerHTML');

for (const escapedExternalValue of [
  'escHtml(o.codigo_obra)',
  'escHtml(o.nome)',
  'escHtml(g.email)',
  'escHtml(e.observacao',
  'escHtml(f.descricao',
  'escHtml(f.justificativa',
  'escHtml(m.descricao',
  'escHtml(r.nome_arquivo)',
  'escAttr(cleanStoragePath)',
]) {
  assert(securitySurface.includes(escapedExternalValue), `Escape ausente em superfície externa: ${escapedExternalValue}`);
}

assert(!/\.innerHTML\s*=\s*(?:error|message|msg|e\.message|err\.message)\b/.test(securitySurface), 'Erro externo atribuído diretamente a innerHTML');
assert(legacy.includes('function escHtml('), 'Codificador de texto HTML ausente');
assert(legacy.includes('function escAttr('), 'Codificador de atributos ausente');
assert(uploadRepository.includes('function sanitizeStoragePath('), 'Sanitização de caminho de Storage ausente');
for (const dangerousPathPattern of [
  '/^[a-z][a-z0-9+.-]*:/i',
  '/[\\u0000-\\u001f\\u007f\\\\]/',
  "segment === '..'",
]) {
  assert(uploadRepository.includes(dangerousPathPattern), `Bloqueio de caminho perigoso ausente: ${dangerousPathPattern}`);
}

console.log(`Contrato XSS: ${innerHtmlCount} templates legados inventariados; módulos novos sem innerHTML OK`);
