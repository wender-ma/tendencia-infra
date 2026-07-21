#!/usr/bin/env node

const assertNode = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { readProjectFile } = require('./load_project_sources');

const syncService = readProjectFile('assets/js/services/sync-status.mjs');
const dashboardRuntime = readProjectFile('assets/js/ui/dashboard-runtime.mjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(syncService.includes('function begin()'), 'Início de sincronização não rastreado');
assert(syncService.includes('function finish(error = null)'), 'Fim de sincronização não rastreado');
assert(syncService.includes('state: !isOnline()'), 'Estado offline não é derivado da conexão');
assert(
  syncService.includes('badge.dataset.syncState = current.state'),
  'Badge não expõe seu estado',
);
assert(
  syncService.includes("badge.setAttribute('aria-busy'"),
  'Badge não anuncia operação em andamento',
);
assert(!syncService.includes('status.lastError}`'), 'Badge ainda expõe erro interno');

const safeRunner = dashboardRuntime.slice(
  dashboardRuntime.indexOf('async function runAsyncSafely('),
  dashboardRuntime.indexOf('function createKpi('),
);
assert(safeRunner.includes('syncStatus.begin()'), 'Operações seguras não iniciam feedback');
assert(safeRunner.includes('syncStatus.finish(error)'), 'Falhas não encerram feedback');

(async () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../assets/js/services/sync-status.mjs'));
  const { createSyncStatusService } = await import(moduleUrl.href);
  const badge = {
    dataset: {},
    setAttribute(name, value) {
      this[name] = value;
    },
  };
  const service = createSyncStatusService({
    isOnline: () => true,
    getBadge: () => badge,
    now: () => new Date('2026-07-21T12:00:00Z'),
  });
  service.begin();
  service.begin();
  assertNode.strictEqual(service.snapshot().pending, 2);
  service.finish(new Error('falha privada'));
  assertNode.strictEqual(service.snapshot().state, 'saving');
  service.finish();
  assertNode.strictEqual(service.snapshot().state, 'error');
  assertNode(!badge.title.includes('falha privada'));
  service.markSynced();
  assertNode.strictEqual(service.snapshot().state, 'synced');

  console.log('Contrato de sincronização: salvando, sucesso, erro e privacidade do badge OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
