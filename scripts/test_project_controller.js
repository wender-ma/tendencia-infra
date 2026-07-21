#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const controllerUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/ui/project-controller.mjs'),
  );
  const repositoryUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/services/project-repository.mjs'),
  );
  const {
    applyHistoryManagementFallback,
    createProjectController,
    findLatestManagement,
    installLegacyProjectController,
    resolveInitialProject,
  } = await import(controllerUrl.href);
  const { createProjectRepository } = await import(repositoryUrl.href);

  const projects = [
    { codigo_obra: 'OBRA-A', nome: 'Obra A', ativa: true },
    { codigo_obra: 'OBRA-B', nome: 'Obra B', ativa: true },
  ];
  assert.strictEqual(
    resolveInitialProject(projects, { search: '?obra=OBRA-B', storedProject: 'OBRA-A' }),
    'OBRA-B',
  );
  assert.strictEqual(
    resolveInitialProject(projects, { search: '?obra=INVALIDA', storedProject: 'OBRA-A' }),
    'OBRA-A',
  );
  assert.strictEqual(resolveInitialProject([], { defaultProject: 'PADRAO' }), 'PADRAO');
  assert.strictEqual(
    findLatestManagement(['GESTÃO 06-2026', 'Atual', 'GESTAO 12-2025', 'GESTÃO 07-2026']),
    'GESTÃO 07-2026',
  );

  const tendency = [
    {
      is_folha: true,
      cod_servico: 'S1',
      cod_insumo: 'I1',
      cod: '01',
      licitacao: 150,
      gestao: null,
    },
  ];
  const fallback = applyHistoryManagementFallback(
    tendency,
    {
      gestoes: ['GESTÃO 06-2026', 'GESTÃO 07-2026'],
      items: [
        {
          codigo_obra: 'OBRA-A',
          servico: 'S1',
          insumo: 'I1',
          item_cod: '01',
          'GESTÃO 07-2026': 120,
        },
        {
          codigo_obra: 'OBRA-B',
          servico: 'S1',
          insumo: 'I1',
          item_cod: '01',
          'GESTÃO 07-2026': 999,
        },
      ],
    },
    'OBRA-A',
  );
  assert.deepStrictEqual(fallback, { applied: 1, management: 'GESTÃO 07-2026' });
  assert.strictEqual(tendency[0].gestao, 120);
  assert.strictEqual(tendency[0].diferenca, 30);

  const repositoryCalls = [];
  const projectRepository = createProjectRepository({
    getClient: () => ({
      from(table) {
        repositoryCalls.push(['from', table]);
        return {
          select(columns) {
            repositoryCalls.push(['select', columns]);
            return this;
          },
          order(column, options) {
            repositoryCalls.push(['order', column, options]);
            return Promise.resolve({ data: projects, error: null });
          },
        };
      },
    }),
  });
  assert.deepStrictEqual(await projectRepository.listProjects(), projects);
  assert.deepStrictEqual(repositoryCalls[2], ['order', 'nome', { ascending: true }]);

  const stored = new Map();
  const events = [];
  const state = {
    dados: {
      tendencia: [],
      flows: [],
      historico: { gestoes: [], items: [], totals: {} },
      projRaw: [],
    },
    config: {
      evolGlobal: { teorica: null, financeira: null },
      gestaoLabel: 'Gestão Atual',
      correcaoIndice: 'incc',
      card3Modo: 'bruto',
    },
    obra: { obras: projects, ativa: 'OBRA-A' },
    uploads: { tendencia: null, flows: null, gestoes: null },
  };
  const dashboardRepository = {
    loadClassifications: async () => ({ 'OBRA-A:1': {} }),
    loadManuals: async () => [{ n_alteracao: '1' }],
    loadProjectionConfig: async () => ({ insumo_controlado: 'I9', saldo_inicial: 10 }),
    loadMovements: async () => [{ id: 'M1' }],
    loadDashboardConfig: async () => ({
      'OBRA-A:dados_tendencia': JSON.stringify([{ is_folha: true, cod_insumo: 'I9' }]),
      dados_flows: JSON.stringify([{ codigo_obra: 'OBRA-A' }]),
      dados_historico: JSON.stringify({ gestoes: [], items: [], totals: {} }),
      dados_projraw: JSON.stringify([{ codigo_obra: 'OBRA-A' }]),
    }),
  };
  let uploadProcessing = false;
  const controller = createProjectController({
    state,
    projectRepository: { listProjects: async () => projects },
    dashboardRepository,
    uploadRepository: { loadLatest: async () => ({ tendencia: { id: 1 } }) },
    storage: {
      set(key, value) {
        stored.set(key, value);
        return true;
      },
      get: (key, fallback) => stored.get(key) ?? fallback,
      remove: (key) => stored.delete(key),
    },
    storageKeys: {
      activeProject: 'active',
      classifications: 'classifications',
      manuals: 'manuals',
      projectionControl: 'projection',
      header: 'header',
      correctionIndex: 'index',
      cardMode: 'card',
    },
    documentRef: { getElementById: () => null },
    windowRef: {
      location: { search: '', href: 'https://example.test/?obra=OBRA-A' },
      history: { replaceState: (...args) => events.push(['history', ...args]) },
      Option: class {},
    },
    getUploadRuntimeState: () => (uploadProcessing ? { tendencia: { status: 'processing' } } : {}),
    toast: (...args) => events.push(['toast', ...args]),
    showLoading: () => events.push(['loading', true]),
    hideLoading: () => events.push(['loading', false]),
    renderAll: () => events.push(['render']),
  });

  assert.strictEqual(await controller.recarregarDadosDaObra(), true);
  assert.strictEqual(state.dados.tendencia.length, 1);
  assert.strictEqual(state.dados.flows.length, 1);
  assert.strictEqual(state.dados.projRaw.length, 1);
  assert.strictEqual(state.uploads.tendencia.id, 1);
  assert(stored.has('classifications'));
  assert(stored.has('projection'));

  uploadProcessing = true;
  assert.strictEqual(await controller.trocarObra('OBRA-B'), false);
  assert.strictEqual(state.obra.ativa, 'OBRA-A');
  uploadProcessing = false;
  assert.strictEqual(await controller.trocarObra('OBRA-B'), true);
  assert.strictEqual(state.obra.ativa, 'OBRA-B');
  assert.strictEqual(stored.get('active'), 'OBRA-B');
  assert(events.some(([name]) => name === 'render'));

  const target = {};
  installLegacyProjectController(controller, target);
  assert.strictEqual(target.trocarObra, controller.trocarObra);
  assert.strictEqual(target.recarregarDadosDaObra, controller.recarregarDadosDaObra);

  console.log('Controlador de obras: resolução, fallback, restauração e troca segura OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
