#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

function createClient({ records = [], storageError = null } = {}) {
  const calls = [];

  class Query {
    constructor(table) {
      this.table = table;
      this.mode = 'read';
    }

    record(method, ...args) {
      calls.push({ layer: 'database', table: this.table, method, args });
      return this;
    }

    select(...args) {
      this.mode = 'read';
      return this.record('select', ...args);
    }

    delete(...args) {
      this.mode = 'delete';
      return this.record('delete', ...args);
    }

    eq(...args) {
      return this.record('eq', ...args);
    }

    then(resolve, reject) {
      const response =
        this.mode === 'delete' ? { data: null, error: null } : { data: records, error: null };
      return Promise.resolve(response).then(resolve, reject);
    }
  }

  return {
    calls,
    client: {
      from(table) {
        return new Query(table);
      },
      storage: {
        from(bucket) {
          calls.push({ layer: 'storage', method: 'from', args: [bucket] });
          return {
            remove(paths) {
              calls.push({ layer: 'storage', method: 'remove', args: [paths] });
              return Promise.resolve({ error: storageError });
            },
          };
        },
      },
    },
  };
}

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/services/upload-repository.mjs'),
  );
  const { createUploadRepository } = await import(moduleUrl.href);

  function repositoryFor(client, isAdmin = true) {
    return createUploadRepository({
      getClient: () => client,
      getActiveProject: () => 'OBRA-A',
      getCurrentUser: () => ({ email: 'admin@example.com' }),
      isEditor: () => true,
      isAdmin: () => isAdmin,
      canManageKind: () => true,
      requirePermission: () => true,
    });
  }

  const success = createClient({
    records: [
      { id: 1, storage_path: 'OBRA-A/tendencia/arquivo.csv' },
      { id: 2, storage_path: 'OBRA-A/tendencia/arquivo.csv' },
      { id: 3, storage_path: null },
    ],
  });
  const removed = await repositoryFor(success.client).clearProjectHistory();
  assert.strictEqual(removed, 3);
  const storageRemove = success.calls.find((call) => call.method === 'remove');
  assert.deepStrictEqual(storageRemove.args[0], ['OBRA-A/tendencia/arquivo.csv']);
  const storageIndex = success.calls.findIndex((call) => call.method === 'remove');
  const databaseDeleteIndex = success.calls.findIndex(
    (call) => call.layer === 'database' && call.method === 'delete',
  );
  assert(storageIndex < databaseDeleteIndex, 'Storage deve ser limpo antes dos metadados');
  assert(
    success.calls.some(
      (call) =>
        call.layer === 'database' &&
        call.method === 'eq' &&
        call.args[0] === 'codigo_obra' &&
        call.args[1] === 'OBRA-A',
    ),
    'Histórico não foi limitado à obra ativa',
  );

  const failedStorage = createClient({
    records: [{ id: 1, storage_path: 'OBRA-A/tendencia/arquivo.csv' }],
    storageError: new Error('storage offline'),
  });
  await assert.rejects(
    repositoryFor(failedStorage.client).clearProjectHistory(),
    /registros foram mantidos/,
  );
  assert(
    !failedStorage.calls.some((call) => call.layer === 'database' && call.method === 'delete'),
    'Metadados não podem ser apagados após falha no Storage',
  );

  const foreignPath = createClient({
    records: [{ id: 1, storage_path: 'OBRA-B/tendencia/arquivo.csv' }],
  });
  await assert.rejects(repositoryFor(foreignPath.client).clearProjectHistory(), /fora do escopo/);
  assert(!foreignPath.calls.some((call) => call.method === 'remove'));

  const unauthorized = createClient();
  await assert.rejects(
    repositoryFor(unauthorized.client, false).clearProjectHistory(),
    /Apenas administradores/,
  );
  assert.strictEqual(
    unauthorized.calls.length,
    0,
    'Usuário sem permissão não pode consultar dados',
  );

  console.log('Limpeza do histórico: autorização, escopo e ordem destrutiva OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
