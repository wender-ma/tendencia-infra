#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/ui/dashboard-runtime.mjs'),
  );
  const {
    createDashboardRuntime,
    formatCompactNumber,
    formatNumber,
    formatPercentage,
    installLegacyDashboardRuntime,
    tendencyStatus,
  } = await import(moduleUrl.href);

  assert.strictEqual(formatNumber(0), '-');
  assert.strictEqual(formatNumber(1234.5), '1.234,50');
  assert.strictEqual(formatCompactNumber(1_500_000), '1,50M');
  assert.strictEqual(formatPercentage(2.5), '+2.5%');
  assert.strictEqual(tendencyStatus(100, 90), 'green');
  assert.strictEqual(tendencyStatus(100, 105), 'amber');
  assert.strictEqual(tendencyStatus(100, 120), 'red');

  const state = {
    dados: {
      tendencia: [
        { is_folha: true, cod_insumo: 'I1' },
        { is_folha: false, cod_insumo: 'P1' },
      ],
      flows: [
        {
          codigo_obra: 'OBRA-A',
          dep: 'Finalizado',
          insumo_planejamento: 'I1',
          custo_flowmaster: 150,
        },
        {
          codigo_obra: 'OBRA-A',
          dep: 'Finalizado',
          insumo_remanejamento: 'I1',
          custo_flowmaster: 40,
        },
        {
          codigo_obra: 'OBRA-B',
          dep: 'Finalizado',
          insumo_planejamento: 'I1',
          custo_flowmaster: 999,
        },
      ],
      historico: { gestoes: [], items: [], totals: {} },
      projRaw: [],
    },
    obra: { ativa: 'OBRA-A' },
    links: { destino: {}, origem: {} },
  };
  const events = [];
  const runtime = createDashboardRuntime({
    state,
    config: { debounce_render: 1, toast_duration_warn: 5000 },
    syncStatus: {
      begin: () => events.push('begin'),
      finish: (error) => events.push(error ? 'finish-error' : 'finish'),
    },
    performanceMonitor: { record: (...args) => events.push(['performance', ...args]) },
    ensureApexCharts: async () => class {},
    documentRef: {
      body: {},
      documentElement: {},
      getElementById: () => null,
      querySelector: () => ({ dataset: { tab: 'visao' } }),
    },
    windowRef: {
      performance: { now: (() => { let value = 0; return () => (value += 5); })() },
      getComputedStyle: () => ({ getPropertyValue: () => '#fff' }),
      setTimeout,
      clearTimeout,
    },
    logger: { warn: (...args) => events.push(['warn', ...args]) },
    toast: (...args) => events.push(['toast', ...args]),
    populateFilters: () => events.push('filters'),
    renderSourcesHeaders: () => events.push('sources'),
    renderers: { overview: () => events.push('overview') },
  });

  runtime.buildLinks();
  assert.strictEqual(state.dados.tendencia[0].aditivo_total, 110);
  assert.strictEqual(state.dados.tendencia[0].flows_destino.length, 1);
  assert.strictEqual(state.dados.tendencia[1].aditivo_total, 0);
  assert.strictEqual(runtime.getActiveFlows().length, 2);

  runtime.renderAll();
  assert(events.includes('filters'));
  assert(events.includes('sources'));
  assert(events.includes('overview'));

  assert.strictEqual(await runtime.runAsyncSafely(Promise.resolve('ok'), 'Teste'), 'ok');
  assert.deepStrictEqual(events.slice(-2), ['begin', 'finish']);
  assert.strictEqual(
    await runtime.runAsyncSafely(Promise.reject(new Error('falha')), 'Teste', 'Falhou'),
    null,
  );
  assert(events.includes('finish-error'));
  assert(events.some((event) => Array.isArray(event) && event[0] === 'toast'));

  const target = {};
  installLegacyDashboardRuntime(runtime, target);
  assert.strictEqual(target.renderAll, runtime.renderAll);
  assert.strictEqual(target.getFlowsObraAtiva, runtime.getActiveFlows);
  assert.strictEqual(target['fmtR$'](10), '10,00');

  console.log('Runtime do dashboard: formatos, vínculos, render e falhas assíncronas OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
