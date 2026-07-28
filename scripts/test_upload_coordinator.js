#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/services/upload-coordinator.mjs'),
  );
  const { buildUploadDashboardRows, createUploadCoordinator } = await import(moduleUrl.href);
  const keys = {
    DATA_T: 'dados_tendencia',
    DATA_F: 'dados_flows',
    HISTORICO: 'dados_historico',
    PROJ_RAW: 'dados_projraw',
    GESTAO_LABEL: 'gestao_label',
    EVOLUTION: 'evol_global',
  };
  const state = {
    tendency: [{ codigo_obra: 'OBRA-A', valor: 1 }],
    flows: [{ n_alteracao: 'ADT-1' }],
    history: { items: [{ insumo: 'I001' }] },
    projectionRaw: [{ mes: '01-2026' }],
    managementLabel: 'GESTÃO 01-2026',
    evolution: { teorica: 0.25, financeira: 0.3 },
  };
  const rows = buildUploadDashboardRows(
    state,
    ['tendencia', 'tendencia', 'flows', 'gestoes'],
    'OBRA-A',
    new Date('2026-07-21T12:00:00Z'),
    keys,
  );

  assert.deepStrictEqual(
    rows.map((row) => row.chave),
    [
      'OBRA-A:dados_tendencia',
      'OBRA-A:gestao_label',
      'OBRA-A:evol_global',
      'dados_flows',
      'dados_historico',
      'dados_projraw',
    ],
  );
  assert(rows.every((row) => row.updated_at === '2026-07-21T12:00:00.000Z'));
  assert.throws(
    () =>
      buildUploadDashboardRows(
        { ...state, tendency: [] },
        ['tendencia'],
        'OBRA-A',
        new Date(),
        keys,
      ),
    /Tendência sem dados válidos/,
  );

  function createClient(existingRows = []) {
    const calls = [];
    return {
      calls,
      from(table) {
        assert.strictEqual(table, 'dashboard_config');
        return {
          select(columns) {
            assert.strictEqual(columns, 'chave,valor');
            return {
              async in(column, selectedKeys) {
                calls.push({ operation: 'select', keys: selectedKeys });
                return {
                  data: existingRows.filter((row) => selectedKeys.includes(row.chave)),
                  error: null,
                };
              },
            };
          },
          async upsert(payload) {
            calls.push({ operation: 'upsert', rows: payload });
            return { data: payload, error: null };
          },
          delete() {
            return {
              async in(column, selectedKeys) {
                calls.push({ operation: 'delete', keys: selectedKeys });
                return { data: null, error: null };
              },
            };
          },
        };
      },
    };
  }

  function createCoordinator({
    persistenceMode,
    client,
    saveForUpload = async () => ({ available: true, activations: [] }),
    enforceRollingRetention = async () => ({ available: true, removed: 0 }),
    canEditProject,
  }) {
    return createUploadCoordinator({
      getClient: () => client,
      getActiveProject: () => 'OBRA-A',
      getDashboardData: () => state,
      restoreDashboardData: () => {},
      getInputOptions: () => [],
      setInputOptions: () => {},
      canEditActiveProject: () => true,
      ...(canEditProject ? { canEditProject } : {}),
      isAdmin: () => true,
      isGlobalKind: (kind) => kind !== 'tendencia',
      dataKeys: keys,
      persistenceMode,
      dashboardDatasetRepository: {
        saveForUpload,
        rollbackSnapshots: async () => {},
        enforceRollingRetention,
      },
      uploadRepository: {},
      executeTransaction: async () => {},
      now: () => new Date('2026-07-21T12:00:00Z'),
    });
  }

  const dualClient = createClient();
  const dualCoordinator = createCoordinator({ persistenceMode: 'dual', client: dualClient });
  const dualSnapshot = await dualCoordinator.captureDashboardRows(['tendencia']);
  await dualCoordinator.saveAllData(['tendencia'], dualSnapshot);
  assert.deepStrictEqual(dualSnapshot.keys, [
    'OBRA-A:dados_tendencia',
    'OBRA-A:gestao_label',
    'OBRA-A:evol_global',
  ]);
  assert(
    dualClient.calls
      .find((call) => call.operation === 'upsert')
      .rows.some((row) => row.chave === 'OBRA-A:dados_tendencia'),
    'Modo dual deve manter a escrita do blob legado',
  );
  let retentionArgs = null;
  const retentionCoordinator = createCoordinator({
    persistenceMode: 'snapshots',
    client: createClient(),
    enforceRollingRetention: async (...args) => {
      retentionArgs = args;
      return { available: true, removed: 2 };
    },
  });
  assert.deepStrictEqual(await retentionCoordinator.enforceDatasetRetention(['flows'], 12), {
    available: true,
    removed: 2,
  });
  assert.deepStrictEqual(retentionArgs, [['flows'], 12]);

  const snapshotClient = createClient([
    { chave: 'OBRA-A:gestao_label', valor: 'GESTÃO ANTERIOR' },
    { chave: 'OBRA-A:evol_global', valor: '{"teorica":0.2,"financeira":0.2}' },
  ]);
  const snapshotCoordinator = createCoordinator({
    persistenceMode: 'snapshots',
    client: snapshotClient,
  });
  const snapshotState = await snapshotCoordinator.captureDashboardRows(['tendencia']);
  await snapshotCoordinator.saveAllData(['tendencia'], snapshotState);
  assert.deepStrictEqual(snapshotState.keys, ['OBRA-A:gestao_label', 'OBRA-A:evol_global']);
  assert.deepStrictEqual(
    snapshotClient.calls.find((call) => call.operation === 'upsert').rows.map((row) => row.chave),
    ['OBRA-A:gestao_label', 'OBRA-A:evol_global'],
    'Modo snapshots deve manter somente a configuração pequena',
  );
  assert(
    snapshotClient.calls.every(
      (call) =>
        !call.rows ||
        call.rows.every(
          (row) =>
            !['dados_tendencia', 'dados_flows', 'dados_historico', 'dados_projraw'].some((key) =>
              row.chave.endsWith(key),
            ),
        ),
    ),
    'Modo snapshots não pode escrever blobs grandes em dashboard_config',
  );

  const unavailableClient = createClient();
  const unavailableCoordinator = createCoordinator({
    persistenceMode: 'snapshots',
    client: unavailableClient,
    saveForUpload: async () => ({ available: false, activations: [] }),
  });
  await assert.rejects(
    unavailableCoordinator.saveAllData(['flows'], { keys: [], rows: [] }),
    /Snapshots versionados indisponíveis/,
  );
  assert(
    unavailableClient.calls.every((call) => call.operation !== 'upsert'),
    'Falha de snapshots não pode cair silenciosamente na escrita legada',
  );
  assert.throws(
    () => createCoordinator({ persistenceMode: 'invalido', client: createClient() }),
    /Modo de persistência de datasets inválido/,
  );

  let scopedSaveArgs = null;
  const scopedClient = createClient();
  const scopedCoordinator = createCoordinator({
    persistenceMode: 'dual',
    client: scopedClient,
    canEditProject: (projectCode) => projectCode === 'OBRA-B',
    saveForUpload: async (...args) => {
      scopedSaveArgs = args;
      return { available: true, activations: [] };
    },
  });
  const scopedData = {
    ...state,
    tendency: [{ codigo_obra: 'OBRA-B', valor: 2 }],
    managementLabel: 'GESTÃO 02-2026',
  };
  const scopedOptions = { projectCode: 'OBRA-B', dashboardData: scopedData };
  const scopedSnapshot = await scopedCoordinator.captureDashboardRows(
    ['tendencia'],
    scopedOptions,
  );
  await scopedCoordinator.saveAllData(['tendencia'], scopedSnapshot, [], scopedOptions);
  assert(scopedSnapshot.keys.every((key) => key.startsWith('OBRA-B:')));
  assert.strictEqual(scopedSaveArgs[3], 'OBRA-B');
  assert.strictEqual(scopedSaveArgs[1], scopedData);

  console.log('Coordenador de uploads: modo dual/snapshots, escopo e fallback seguro OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
