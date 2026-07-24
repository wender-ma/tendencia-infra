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
  };
  const state = {
    tendency: [{ codigo_obra: 'OBRA-A', valor: 1 }],
    flows: [{ n_alteracao: 'ADT-1' }],
    history: { items: [{ insumo: 'I001' }] },
    projectionRaw: [{ mes: '01-2026' }],
    managementLabel: 'GESTÃO 01-2026',
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
  }) {
    return createUploadCoordinator({
      getClient: () => client,
      getActiveProject: () => 'OBRA-A',
      getDashboardData: () => state,
      restoreDashboardData: () => {},
      getInputOptions: () => [],
      setInputOptions: () => {},
      canEditActiveProject: () => true,
      isAdmin: () => true,
      isGlobalKind: (kind) => kind !== 'tendencia',
      dataKeys: keys,
      persistenceMode,
      dashboardDatasetRepository: {
        saveForUpload,
        rollbackSnapshots: async () => {},
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
  ]);
  assert(
    dualClient.calls
      .find((call) => call.operation === 'upsert')
      .rows.some((row) => row.chave === 'OBRA-A:dados_tendencia'),
    'Modo dual deve manter a escrita do blob legado',
  );

  const snapshotClient = createClient([
    { chave: 'OBRA-A:gestao_label', valor: 'GESTÃO ANTERIOR' },
  ]);
  const snapshotCoordinator = createCoordinator({
    persistenceMode: 'snapshots',
    client: snapshotClient,
  });
  const snapshotState = await snapshotCoordinator.captureDashboardRows(['tendencia']);
  await snapshotCoordinator.saveAllData(['tendencia'], snapshotState);
  assert.deepStrictEqual(snapshotState.keys, ['OBRA-A:gestao_label']);
  assert.deepStrictEqual(
    snapshotClient.calls.find((call) => call.operation === 'upsert').rows.map((row) => row.chave),
    ['OBRA-A:gestao_label'],
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

  console.log('Coordenador de uploads: modo dual/snapshots, escopo e fallback seguro OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
