#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/ui/upload-maintenance.mjs'),
  );
  const { buildResetCacheKeys, createUploadMaintenance } = await import(moduleUrl.href);

  assert.deepStrictEqual(buildResetCacheKeys(' OBRA-A '), [
    'OBRA-A:dados_tendencia',
    'OBRA-A:dados_flows',
    'OBRA-A:gestao_label',
    'OBRA-A:evol_global',
  ]);
  assert.deepStrictEqual(buildResetCacheKeys('OBRA-A', true).slice(-3), [
    'dados_flows',
    'dados_historico',
    'dados_projraw',
  ]);
  assert.deepStrictEqual(buildResetCacheKeys(''), []);

  const events = [];
  const confirmations = [true, true, true];
  const service = createUploadMaintenance({
    dashboardRepository: {
      async deleteDashboardKeys(keys) {
        events.push(['delete-cache', keys]);
        return keys.length;
      },
    },
    dashboardDatasetRepository: {
      async resetDashboardData(includeGlobal) {
        events.push(['reset-datasets', includeGlobal]);
        return { available: true, configDeleted: 7, datasetCount: 2 };
      },
    },
    uploadRepository: {
      async clearProjectHistory() {
        events.push(['delete-history']);
        return 4;
      },
    },
    getActiveProject: () => 'OBRA-A',
    getProjectInfo: () => ({ nome: 'Obra A' }),
    requireEditor: () => true,
    requireAdmin: () => true,
    isAdmin: () => true,
    requestConfirmation: async () => confirmations.shift(),
    toast: (...args) => events.push(['toast', ...args]),
    clearLocalEvolution: () => events.push(['clear-local']),
    clearLatestUploads: () => events.push(['clear-latest']),
    renderUploads: () => events.push(['render-uploads']),
    renderSourceHeaders: () => events.push(['render-headers']),
    reload: () => events.push(['reload']),
    schedule: (callback, delay) => {
      events.push(['schedule', delay]);
      callback();
    },
  });

  assert.strictEqual(await service.resetCacheDados(), true);
  assert.deepStrictEqual(events.find(([name]) => name === 'reset-datasets'), [
    'reset-datasets',
    true,
  ]);
  assert(!events.some(([name]) => name === 'delete-cache'));
  assert(events.some(([name]) => name === 'clear-local'));
  assert(events.some(([name]) => name === 'reload'));

  assert.strictEqual(await service.apagarHistoricoUploads(), true);
  assert(events.some(([name]) => name === 'clear-latest'));
  assert(events.some(([name]) => name === 'render-uploads'));
  assert(events.some(([name]) => name === 'render-headers'));

  const fallbackEvents = [];
  const fallbackService = createUploadMaintenance({
    dashboardRepository: {
      async deleteDashboardKeys(keys) {
        fallbackEvents.push(keys);
        return keys.length;
      },
    },
    dashboardDatasetRepository: {
      async resetDashboardData() {
        return { available: false };
      },
    },
    uploadRepository: {},
    getActiveProject: () => 'OBRA-A',
    getProjectInfo: () => ({ nome: 'Obra A' }),
    requireEditor: () => true,
    isAdmin: () => false,
    requestConfirmation: async () => true,
    toast: () => {},
    schedule: () => {},
  });
  assert.strictEqual(await fallbackService.resetCacheDados(), true);
  assert.strictEqual(fallbackEvents[0].length, 4);

  console.log('Manutenção de uploads: reset transacional, fallback e confirmações OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
