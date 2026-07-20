#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
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
assert(!/(^|[^A-Za-z])confirm\s*\(/m.test(html), 'Ainda existe confirm() nativo');
assert(html.includes('function openModalLayer('), 'Runtime compartilhado de abertura ausente');
assert(html.includes('function closeModalLayer('), 'Runtime compartilhado de fechamento ausente');
assert(html.includes("event.key !== 'Tab'"), 'Focus trap ausente');
assert(html.includes("event.key === 'Escape'"), 'Fechamento por Escape ausente');

console.log(`Contrato de modais: ${backdropIds.length} diálogos OK`);
