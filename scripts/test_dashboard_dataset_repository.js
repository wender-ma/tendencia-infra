#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

function createSupabaseMock({ schemaMissing = false } = {}) {
  const rows = [];
  const objects = new Map();

  function resultFor({ mode, payload, filters, limit }) {
    if (schemaMissing) {
      return { data: null, error: { code: 'PGRST205', message: 'dashboard_datasets schema cache' } };
    }
    if (mode === 'insert') {
      const row = { ...payload, created_at: new Date().toISOString(), activated_at: null };
      rows.push(row);
      return { data: row, error: null };
    }
    if (mode === 'delete') {
      const removed = rows.filter((row) => filters.every(([key, value]) => row[key] === value));
      removed.forEach((row) => rows.splice(rows.indexOf(row), 1));
      return { data: removed, error: null };
    }
    const selected = rows.filter((row) =>
      filters.every(([key, value]) => (value === null ? row[key] == null : row[key] === value)),
    );
    selected.sort((a, b) => Number(b.versao) - Number(a.versao));
    return { data: limit ? selected.slice(0, limit) : selected, error: null };
  }

  function from() {
    const state = { mode: 'select', payload: null, filters: [], limit: null };
    const query = {
      select() {
        return query;
      },
      insert(payload) {
        state.mode = 'insert';
        state.payload = payload;
        return query;
      },
      delete() {
        state.mode = 'delete';
        return query;
      },
      eq(key, value) {
        state.filters.push([key, value]);
        return query;
      },
      is(key, value) {
        state.filters.push([key, value]);
        return query;
      },
      order() {
        return query;
      },
      limit(value) {
        state.limit = value;
        return query;
      },
      single() {
        const result = resultFor(state);
        return Promise.resolve({ data: result.data, error: result.error });
      },
      then(resolve, reject) {
        return Promise.resolve(resultFor(state)).then(resolve, reject);
      },
    };
    return query;
  }

  const storageBucket = {
    async upload(storagePath, blob) {
      if (objects.has(storagePath)) return { error: new Error('objeto duplicado') };
      objects.set(storagePath, blob);
      return { data: { path: storagePath }, error: null };
    },
    async download(storagePath) {
      const data = objects.get(storagePath);
      return data ? { data, error: null } : { data: null, error: new Error('objeto ausente') };
    },
    async remove(paths) {
      paths.forEach((storagePath) => objects.delete(storagePath));
      return { data: paths, error: null };
    },
  };

  async function rpc(name, params) {
    if (name === 'activate_dashboard_dataset') {
      const current = rows.find((row) => row.id === params.p_dataset_id);
      const previous = rows.find(
        (row) =>
          row.status === 'active' &&
          row.tipo === current.tipo &&
          row.codigo_obra === current.codigo_obra,
      );
      if (previous) previous.status = 'superseded';
      current.status = 'active';
      return { data: { previous_id: previous?.id || null }, error: null };
    }
    if (name === 'rollback_dashboard_dataset') {
      const current = rows.find((row) => row.id === params.p_current_id);
      current.status = 'failed';
      const previous = rows.find((row) => row.id === params.p_previous_id);
      if (previous) previous.status = 'active';
      return { data: true, error: null };
    }
    if (name === 'fail_dashboard_dataset') {
      const current = rows.find((row) => row.id === params.p_dataset_id);
      if (current?.status === 'processing') current.status = 'failed';
      return { data: true, error: null };
    }
    return { data: null, error: new Error(`RPC inesperada: ${name}`) };
  }

  return {
    client: {
      from,
      storage: { from: () => storageBucket },
      rpc,
    },
    rows,
    objects,
  };
}

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/services/dashboard-dataset-repository.mjs'),
  );
  const {
    buildDatasetEntries,
    createDashboardDatasetRepository,
    datasetScope,
    isDatasetSchemaUnavailable,
  } = await import(moduleUrl.href);

  assert.deepStrictEqual(datasetScope('tendencia', 'OBRA-A'), {
    codigoObra: 'OBRA-A',
    prefix: 'OBRA-A/tendencia',
  });
  assert.deepStrictEqual(datasetScope('flows', 'OBRA-A'), {
    codigoObra: null,
    prefix: '_global/flows',
  });
  assert(isDatasetSchemaUnavailable({ code: 'PGRST205' }));

  const dashboardData = {
    tendency: [{ codigo_obra: 'OBRA-A', item: 1 }],
    flows: [{ codigo_obra: 'OBRA-A', n_alteracao: 'A1' }],
    history: { items: [{ codigo_obra: 'OBRA-A', insumo: 'I1' }], gestoes: [] },
    projectionRaw: [{ codigo_obra: 'OBRA-A', mes: '2026-01' }],
  };
  const entries = buildDatasetEntries(
    dashboardData,
    ['tendencia', 'gestoes'],
    'OBRA-A',
    [{ id: 9, tipo: 'gestoes' }],
  );
  assert.deepStrictEqual(
    entries.map(({ type, codigoObra, uploadHistoryId }) => ({
      type,
      codigoObra,
      uploadHistoryId,
    })),
    [
      { type: 'tendencia', codigoObra: 'OBRA-A', uploadHistoryId: null },
      { type: 'historico', codigoObra: null, uploadHistoryId: 9 },
      { type: 'projecao_raw', codigoObra: null, uploadHistoryId: 9 },
    ],
  );

  const missing = createSupabaseMock({ schemaMissing: true });
  const missingRepository = createDashboardDatasetRepository({
    getClient: () => missing.client,
    getActiveProject: () => 'OBRA-A',
  });
  assert.deepStrictEqual(await missingRepository.loadForDashboard(), {});
  assert.deepStrictEqual(await missingRepository.saveForUpload(['tendencia'], dashboardData), {
    available: false,
    activations: [],
  });

  const supabase = createSupabaseMock();
  const ids = [
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000003',
  ];
  let tick = 0;
  const repository = createDashboardDatasetRepository({
    getClient: () => supabase.client,
    getActiveProject: () => 'OBRA-A',
    cryptoRef: globalThis.crypto,
    createId: () => ids.shift(),
    now: () => new Date(1784640000000 + tick++),
  });

  const first = await repository.saveForUpload(['tendencia'], dashboardData, [
    { id: 1, tipo: 'tendencia' },
  ]);
  assert.strictEqual(first.available, true);
  assert.strictEqual(first.activations.length, 1);
  assert.strictEqual(supabase.rows[0].status, 'active');
  assert.strictEqual(supabase.objects.size, 1);
  assert.deepStrictEqual((await repository.loadForDashboard()).tendency, dashboardData.tendency);

  const changedData = { ...dashboardData, tendency: [{ codigo_obra: 'OBRA-A', item: 2 }] };
  const second = await repository.saveForUpload(['tendencia'], changedData);
  assert.strictEqual(supabase.rows.find((row) => row.id === first.activations[0].current.id).status, 'superseded');
  await repository.rollbackSnapshots(second.activations);
  assert.strictEqual(supabase.rows.length, 1);
  assert.strictEqual(supabase.rows[0].status, 'active');
  assert.deepStrictEqual((await repository.loadForDashboard()).tendency, dashboardData.tendency);

  const global = await repository.saveForUpload(['flows'], dashboardData);
  assert.strictEqual(global.activations[0].current.codigo_obra, null);
  assert.deepStrictEqual((await repository.loadForDashboard()).flows, dashboardData.flows);

  const globalPath = global.activations[0].current.storage_path;
  supabase.objects.set(globalPath, new Blob(['[{"alterado":true}]']));
  assert.strictEqual(
    (await repository.loadForDashboard()).flows,
    undefined,
    'Snapshot corrompido precisa cair no fallback legado',
  );

  console.log('Repositório de datasets: fallback, versões, leitura e rollback OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
