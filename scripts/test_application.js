#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../assets/js/application.mjs'));
  const { createApplication } = await import(moduleUrl.href);
  const events = [];
  const state = { obra: { ativa: null } };
  const elements = {
    now: { textContent: '' },
    headerTitle: { textContent: 'Padrão' },
  };
  const application = createApplication({
    state,
    projectController: {
      carregarObras: async () => events.push('projects'),
      resolverObraInicial: () => 'OBRA-A',
      renderObrasDropdown: () => events.push('selector'),
      recarregarDadosDaObra: async () => events.push('data'),
    },
    authService: { init: async () => events.push('auth') },
    uploadRepository: { cleanupIncompleteUploads: async () => 2 },
    dashboardRuntime: { renderAll: () => events.push('render') },
    dashboardShell: { restaurarAbaAtiva: () => events.push('tab') },
    storage: { get: () => 'Título salvo' },
    storageKeys: { header: 'header' },
    syncStatus: {
      render: () => events.push('sync-render'),
      markSynced: () => events.push('synced'),
      markError: () => events.push('sync-error'),
    },
    performanceMonitor: { completeBoot: () => events.push('complete') },
    documentRef: { getElementById: (id) => elements[id] || null },
    buildInputList: () => ['I1'],
    setInputOptions: (options) => events.push(['inputs', options]),
    buildDatalist: () => events.push('datalist'),
    applyManuals: () => events.push('manuals'),
    loadClassifications: () => events.push('classifications'),
    updateEditCount: () => events.push('count'),
    restoreFilters: () => events.push('filters'),
    toast: (...args) => events.push(['toast', ...args]),
  });

  const firstStart = application.start();
  const secondStart = application.start();
  assert.strictEqual(firstStart, secondStart, 'Boot deve compartilhar a mesma Promise');
  await firstStart;

  assert.strictEqual(state.obra.ativa, 'OBRA-A');
  assert.strictEqual(elements.headerTitle.textContent, 'Título salvo');
  assert(elements.now.textContent.length > 0);
  assert(events.indexOf('projects') < events.indexOf('data'));
  assert(events.indexOf('data') < events.indexOf('auth'));
  assert(events.indexOf('auth') < events.indexOf('render'));
  assert.strictEqual(events.filter((event) => event === 'complete').length, 1);
  assert(events.some((event) => Array.isArray(event) && event[0] === 'toast'));

  console.log('Aplicação: boot modular, ordem dos serviços e idempotência OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
