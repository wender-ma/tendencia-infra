#!/usr/bin/env node

const path = require('path');
const { pathToFileURL } = require('url');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createOperations({ failAt, cleanupFailures = [] } = {}) {
  const calls = [];
  const cleanupErrors = [];
  const record = (name, value) => calls.push(value == null ? name : `${name}:${value}`);
  const fail = name => {
    if (failAt === name || cleanupFailures.includes(name)) throw new Error(`erro em ${name}`);
  };

  return {
    calls,
    cleanupErrors,
    operations: {
      captureDashboardRows: async kinds => {
        record('capture', kinds.join(','));
        fail('capture');
        return { previous: true };
      },
      uploadFile: async type => {
        record('upload', type);
        fail('upload');
        return 'OBRA/excel/file.xlsx';
      },
      createRecord: async item => {
        record('create', item.kind);
        fail(`create-${item.kind}`);
        return { id: `id-${item.kind}`, tipo: item.kind };
      },
      saveAllData: async kinds => {
        record('save', kinds.join(','));
        fail('save');
      },
      activateRecord: async item => {
        record('activate', item.tipo);
        fail(`activate-${item.tipo}`);
        return { active: item, previousIds: [`old-${item.tipo}`] };
      },
      rollbackActivation: async activation => {
        record('rollback', activation.active.tipo);
        fail('rollback');
      },
      restoreDashboardRows: async () => {
        record('restore-dashboard');
        fail('restore-dashboard');
      },
      markRecordsFailed: async records => {
        record('mark-failed', records.map(item => item.tipo).join(','));
        fail('mark-failed');
      },
      removeStoredUpload: async storagePath => {
        record('remove-storage', storagePath);
        fail('remove-storage');
      },
      deleteRecords: async records => {
        record('delete-records', records.map(item => item.tipo).join(','));
        fail('delete-records');
      },
      restoreMemoryState: snapshot => record('restore-memory', snapshot.marker),
      setRuntimeState: (_kinds, status) => record('state', status),
      onActive: records => record('active', records.map(item => item.tipo).join(',')),
      reportCleanupError: (context, error) => cleanupErrors.push(`${context}:${error.message}`),
    },
  };
}

const input = {
  file: { name: 'file.xlsx', size: 123 },
  storageType: 'excel',
  items: [
    { kind: 'tendencia', linhas: 10 },
    { kind: 'flows', linhas: 20 },
  ],
  groupId: 'group-1',
  memorySnapshot: { marker: 'before' },
};

async function expectFailure(execute, harness, expectedStage) {
  try {
    await execute(input, harness.operations);
    throw new Error('Transação deveria falhar');
  } catch (error) {
    assert(error.message.includes(`Falha em ${expectedStage}`), `Etapa incorreta: ${error.message}`);
    assert(error.cause?.message.startsWith('erro em'), 'Erro original não foi preservado como causa');
    return error;
  }
}

async function main() {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/services/upload-transaction.mjs'),
  ).href;
  const { executeUploadTransaction } = await import(moduleUrl);

  const success = createOperations();
  const result = await executeUploadTransaction(input, success.operations);
  assert(result.records.length === 2, 'Commit não retornou os dois registros ativos');
  assert(
    success.calls.join('|')
      === 'capture:tendencia,flows|upload:excel|create:tendencia|create:flows|save:tendencia,flows|activate:tendencia|activate:flows|active:tendencia,flows|state:active',
    `Ordem de sucesso incorreta: ${success.calls.join('|')}`,
  );

  const activationFailure = createOperations({ failAt: 'activate-flows' });
  await expectFailure(executeUploadTransaction, activationFailure, 'ativação do novo dataset');
  assert(
    activationFailure.calls.slice(-7).join('|')
      === 'rollback:tendencia|restore-dashboard|mark-failed:tendencia,flows|remove-storage:OBRA/excel/file.xlsx|delete-records:tendencia,flows|restore-memory:before|state:failed',
    `Rollback fora de ordem: ${activationFailure.calls.join('|')}`,
  );

  const partialRollback = createOperations({
    failAt: 'save',
    cleanupFailures: ['mark-failed', 'remove-storage'],
  });
  const partialError = await expectFailure(
    executeUploadTransaction,
    partialRollback,
    'persistência dos dados',
  );
  assert(partialRollback.cleanupErrors.length === 2, 'Falhas de compensação não foram reportadas');
  assert(partialError.message.includes('Rollback parcial:'), 'Rollback parcial não aparece no erro final');
  assert(partialRollback.calls.includes('delete-records:tendencia,flows'), 'Rollback parou após a primeira falha de limpeza');

  console.log('Integração de upload: commit e compensações em sucesso, falha e rollback parcial OK');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
