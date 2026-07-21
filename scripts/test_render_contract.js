#!/usr/bin/env node

const { loadProjectSources } = require('./load_project_sources');

const { javascript } = loadProjectSources();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extract(start, end) {
  const from = javascript.indexOf(start);
  const to = javascript.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Bloco ausente: ${start}`);
  return javascript.slice(from, to);
}

const activation = extract('function activateTab(', 'function getVisibleTabs(');
assert(activation.includes('renderTab(tab.dataset.tab)'), 'Troca de aba precisa renderizar a visão ativada');

const renderAll = extract('function renderAll()', "document.getElementById('now')");
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
