#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'assets/js/ui/shell.mjs'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'assets/js/ui/dashboard-runtime.mjs'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extract(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Bloco ausente: ${start}`);
  return source.slice(from, to);
}

const activation = extract(shell, 'function activateTab(', 'function getVisibleTabs(');
assert(activation.includes('renderTab(tab.dataset.tab)'), 'Troca de aba precisa renderizar a visão ativada');

const renderAll = extract(runtime, 'function renderAll()', 'function debouncedRender(');
assert(renderAll.includes('renderTab(getActiveTabName())'), 'Renderização geral precisa limitar-se à aba ativa');
for (const hiddenRender of [
  'renderVisao()',
  'renderTable()',
  'renderFlows()',
  'renderHistorico()',
  'renderProjecao()',
  'initProjCtrl()',
  'renderUploadsCentral()',
]) {
  assert(!renderAll.includes(hiddenRender), `renderAll ainda redesenha visão oculta: ${hiddenRender}`);
}

console.log('Contrato de renderização: somente estruturas compartilhadas e aba ativa OK');
