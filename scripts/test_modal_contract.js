#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadProjectSources } = require('./load_project_sources');

const { html, javascript, source } = loadProjectSources();
const modalModule = fs.readFileSync(path.resolve(__dirname, '../assets/js/ui/modals.mjs'), 'utf8');
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

backdropIds.forEach((id) => {
  const start = html.indexOf(`<div id="${id}"`);
  const alternateStart = html.indexOf(`<div class="modal-bg" id="${id}"`);
  const index = Math.max(start, alternateStart);
  assert(index >= 0, `Backdrop ausente: ${id}`);
  const openingTag = html.slice(index, html.indexOf('>', index) + 1);
  assert(openingTag.includes('aria-hidden="true"'), `aria-hidden ausente em ${id}`);
});

const dialogCount = (html.match(/<[^>]+\srole="dialog"/g) || []).length;
assert(
  dialogCount === backdropIds.length,
  `Esperados ${backdropIds.length} diálogos; encontrados ${dialogCount}`,
);
assert(
  !/(?:\b(?:window|globalThis)\.confirm\s*\(|(^|[^\w.])confirm\s*\()/m.test(source),
  'Ainda existe confirm() nativo',
);
assert(modalModule.includes('function openLayer('), 'Runtime compartilhado de abertura ausente');
assert(modalModule.includes('function closeLayer('), 'Runtime compartilhado de fechamento ausente');
assert(modalModule.includes("event.key !== 'Tab'"), 'Focus trap ausente');
assert(modalModule.includes("event.key === 'Escape'"), 'Fechamento por Escape ausente');
assert(
  modalModule.includes('content.replaceChildren()'),
  'Confirmação precisa reconstruir DOM com segurança',
);
assert(!modalModule.includes('.innerHTML'), 'Módulo de modais não deve usar innerHTML');
assert(
  modalModule.includes("resolveAction('saveManualForm')"),
  'Formulário manual não usa o registro de ações',
);
assert(
  !modalModule.includes('windowRef.save'),
  'Formulários modais voltaram a depender de handlers globais',
);
assert(
  !javascript.includes('function openModalLayer('),
  'Runtime de modais ainda duplicado no legado',
);

console.log(`Contrato de modais: ${backdropIds.length} diálogos OK`);
