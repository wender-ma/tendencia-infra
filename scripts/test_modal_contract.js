#!/usr/bin/env node

const { loadProjectSources } = require('./load_project_sources');

const { html, javascript, source } = loadProjectSources();
const backdropIds = [
  'modalBg',
  'confirmModalBg',
  'obraFormBackdrop',
  'editorFormBackdrop',
  'loginModalBackdrop',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

backdropIds.forEach(id => {
  const start = html.indexOf(`<div id="${id}"`);
  const alternateStart = html.indexOf(`<div class="modal-bg" id="${id}"`);
  const index = Math.max(start, alternateStart);
  assert(index >= 0, `Backdrop ausente: ${id}`);
  const openingTag = html.slice(index, html.indexOf('>', index) + 1);
  assert(openingTag.includes('aria-hidden="true"'), `aria-hidden ausente em ${id}`);
});

const dialogCount = (html.match(/<[^>]+\srole="dialog"/g) || []).length;
assert(dialogCount === backdropIds.length, `Esperados ${backdropIds.length} diálogos; encontrados ${dialogCount}`);
assert(!/(^|[^A-Za-z])confirm\s*\(/m.test(source), 'Ainda existe confirm() nativo');
assert(javascript.includes('function openModalLayer('), 'Runtime compartilhado de abertura ausente');
assert(javascript.includes('function closeModalLayer('), 'Runtime compartilhado de fechamento ausente');
assert(javascript.includes("event.key !== 'Tab'"), 'Focus trap ausente');
assert(javascript.includes("event.key === 'Escape'"), 'Fechamento por Escape ausente');

console.log(`Contrato de modais: ${backdropIds.length} diálogos OK`);
