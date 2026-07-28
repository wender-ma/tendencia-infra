#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/ui/upload-maintenance.mjs'),
  );
  const { buildGlobalResetCacheKeys, buildResetCacheKeys, createUploadMaintenance } = await import(
    moduleUrl.href
  );

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
  assert.deepStrictEqual(buildGlobalResetCacheKeys(), [
    'dados_flows',
    'dados_historico',
    'dados_projraw',
  ]);

  const events = [];
  const confirmations = [true, true, true, true];
  const service = createUploadMaintenance({
    dashboardRepository: {
      async deleteDashboardKeys(keys) {
        events.push(['delete-cache', keys]);
        return keys.length;
      },
    },
    dashboardDatasetRepository: {
      async resetDashboardData() {
        events.push(['reset-datasets']);
        return { available: true, configDeleted: 7, datasetCount: 2 };
      },
      async resetGlobalDashboardData() {
        events.push(['reset-global-datasets']);
        return { available: true, configDeleted: 3, datasetCount: 3 };
      },
    },
    uploadRepository: {
      async clearProjectHistory() {
        events.push(['delete-project-history']);
        return 4;
      },
      async clearGlobalHistory() {
        events.push(['delete-global-history']);
        return 8;
      },
    },
    getActiveProject: () => 'OBRA-A',
    getProjectInfo: () => ({ nome: 'Obra A' }),
    requireEditor: () => true,
    requireAdmin: () => true,
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

  assert.strictEqual(await service.resetProjectData(), true);
  assert.deepStrictEqual(
    events.find(([name]) => name === 'reset-datasets'),
    ['reset-datasets'],
  );
  assert(!events.some(([name]) => name === 'delete-cache'));
  assert(events.some(([name]) => name === 'clear-local'));
  assert(events.some(([name]) => name === 'reload'));

  assert.strictEqual(await service.resetGlobalData(), true);
  assert(events.some(([name]) => name === 'reset-global-datasets'));

  assert.strictEqual(await service.clearProjectUploadFiles(), true);
  assert(events.some(([name]) => name === 'delete-project-history'));
  assert.strictEqual(await service.clearGlobalUploadFiles(), true);
  assert(events.some(([name]) => name === 'delete-global-history'));
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
    requestConfirmation: async () => true,
    toast: () => {},
    schedule: () => {},
  });
  assert.strictEqual(await fallbackService.resetProjectData(), true);
  assert.strictEqual(fallbackEvents[0].length, 4);

  console.log('Manutenção de uploads: reset transacional, fallback e confirmações OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
