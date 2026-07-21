#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function listSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listSourceFiles(absolutePath) : [absolutePath];
  });
}

const uploadRepository = fs.readFileSync(
  path.join(root, 'assets/js/services/upload-repository.mjs'),
  'utf8',
);
const javascriptFiles = listSourceFiles(path.join(root, 'assets/js'))
  .filter((file) => /\.m?js$/.test(file))
  .map((file) => path.relative(root, file));
const modularSources = javascriptFiles.map((file) => [
  file,
  fs.readFileSync(path.join(root, file), 'utf8'),
]);
const allJavaScript = javascriptFiles
  .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
  .join('\n');
const securitySurface = allJavaScript;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const [file, source] of modularSources) {
  assert(!source.includes('.innerHTML'), `Módulo novo não pode usar innerHTML: ${file}`);
  assert(!source.includes('insertAdjacentHTML'), `Módulo novo não pode inserir HTML textual: ${file}`);
}

const innerHtmlCount = (allJavaScript.match(/\.innerHTML\s*=/g) || []).length;
const replaceChildrenCount = (allJavaScript.match(/\.replaceChildren\(/g) || []).length;
assert(innerHtmlCount === 0, `Atribuição de innerHTML reintroduzida: ${innerHtmlCount}`);
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
assert(allJavaScript.includes('function escHtml('), 'Codificador de texto HTML ausente');
assert(allJavaScript.includes('function escAttr('), 'Codificador de atributos ausente');
assert(uploadRepository.includes('function sanitizeStoragePath('), 'Sanitização de caminho de Storage ausente');
for (const dangerousPathPattern of [
  '/^[a-z][a-z0-9+.-]*:/i',
  '/[\\u0000-\\u001f\\u007f\\\\]/',
  "segment === '..'",
]) {
  assert(uploadRepository.includes(dangerousPathPattern), `Bloqueio de caminho perigoso ausente: ${dangerousPathPattern}`);
}

console.log('Contrato XSS: zero atribuições de innerHTML; dados externos escapados OK');
