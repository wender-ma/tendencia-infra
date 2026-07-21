#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

class Query {
  constructor(table, calls, response) {
    this.table = table;
    this.calls = calls;
    this.response = response;
  }

  record(method, ...args) {
    this.calls.push({ table: this.table, method, args });
    return this;
  }

  select(...args) {
    return this.record('select', ...args);
  }

  update(...args) {
    return this.record('update', ...args);
  }

  insert(...args) {
    return this.record('insert', ...args);
  }

  upsert(...args) {
    return this.record('upsert', ...args);
  }

  delete(...args) {
    return this.record('delete', ...args);
  }

  eq(...args) {
    return this.record('eq', ...args);
  }

  in(...args) {
    return this.record('in', ...args);
  }

  maybeSingle() {
    this.record('maybeSingle');
    return Promise.resolve(this.response());
  }

  then(resolve, reject) {
    return Promise.resolve(this.response()).then(resolve, reject);
  }
}

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/services/dashboard-repository.mjs'),
  );
  const { DASHBOARD_DATA_KEYS, createDashboardRepository } = await import(moduleUrl.href);
  assert(Object.isFrozen(DASHBOARD_DATA_KEYS));

  const calls = [];
  const responses = {
    flow_classifications: {
      data: [
        {
          codigo_obra: 'OBRA-A',
          n_alteracao: 'ADT-1',
          refletido_status: 'sim',
          custo_flowmaster: 10,
        },
      ],
      error: null,
    },
    projecao_movimentacoes: {
      data: [
        {
          id: 'MOV-1',
          valor: 20,
          created_at: '2026-07-21T12:00:00Z',
          created_by: 'editor@example.com',
        },
      ],
      error: null,
    },
  };
  const client = {
    from(table) {
      return new Query(table, calls, () => responses[table] || { data: null, error: null });
    },
  };
  const repository = createDashboardRepository({
    getClient: () => client,
    getActiveProject: () => 'OBRA-A',
    getCurrentUser: () => ({ email: 'editor@example.com' }),
    canEditActiveProject: () => true,
    isAdmin: () => false,
    now: () => new Date('2026-07-21T12:00:00Z'),
  });

  const classifications = await repository.loadClassifications();
  assert.strictEqual(classifications['OBRA-A:ADT-1'].refletido, true);
  assert(
    calls.some(
      (call) =>
        call.table === 'flow_classifications' &&
        call.method === 'eq' &&
        call.args[0] === 'codigo_obra' &&
        call.args[1] === 'OBRA-A',
    ),
  );

  responses.flow_classifications = {
    data: { codigo_obra: 'OBRA-A', n_alteracao: 'ADT-1' },
    error: null,
  };
  await repository.patchClassification('ADT-1', {
    custo_flowmaster: 42,
    codigo_obra: 'OBRA-INJETADA',
  });
  const update = calls.find(
    (call) => call.table === 'flow_classifications' && call.method === 'update',
  );
  assert.strictEqual(update.args[0].custo_flowmaster, 42);
  assert.strictEqual(update.args[0].codigo_obra, undefined);
  assert.strictEqual(update.args[0].updated_by, 'editor@example.com');

  const movements = await repository.loadMovements();
  assert.strictEqual(movements[0].created_at, '2026-07-21T12:00:00Z');
  assert.strictEqual(movements[0].created_by, 'editor@example.com');

  const callCount = calls.length;
  await repository.patchClassification('ADT-2', { custo_flowmaster: 1 }, 'OBRA-B');
  assert.strictEqual(calls.length, callCount, 'Patch fora da obra ativa deve ser ignorado');

  const deletedCount = await repository.deleteDashboardKeys([
    'OBRA-A:dados_tendencia',
    'OBRA-A:dados_flows',
  ]);
  assert.strictEqual(deletedCount, 2);
  const deleteCall = calls.find(
    (call) => call.table === 'dashboard_config' && call.method === 'delete',
  );
  assert(deleteCall, 'Limpeza do cache não executou DELETE');
  assert(
    calls.some(
      (call) =>
        call.table === 'dashboard_config' &&
        call.method === 'in' &&
        call.args[0] === 'chave' &&
        call.args[1].length === 2,
    ),
    'Limpeza do cache não agrupou as chaves',
  );

  const scopedCallCount = calls.length;
  await assert.rejects(
    repository.deleteDashboardKeys(['OBRA-B:dados_tendencia']),
    /fora do escopo/,
  );
  await assert.rejects(repository.deleteDashboardKeys(['dados_historico']), /fora do escopo/);
  assert.strictEqual(
    calls.length,
    scopedCallCount,
    'Chaves sem permissão não podem chegar ao banco',
  );

  const adminRepository = createDashboardRepository({
    getClient: () => client,
    getActiveProject: () => 'OBRA-A',
    canEditActiveProject: () => true,
    isAdmin: () => true,
  });
  assert.strictEqual(
    await adminRepository.deleteDashboardKeys(['dados_historico', 'dados_projraw']),
    2,
  );

  console.log('Repositório do dashboard: escopo, campos permitidos e metadados OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
