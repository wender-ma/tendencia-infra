#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadProjectSources } = require('./load_project_sources');

const { javascript } = loadProjectSources();
const transaction = fs.readFileSync(
  path.resolve(__dirname, '../assets/js/services/upload-transaction.mjs'),
  'utf8',
);
const repository = fs.readFileSync(
  path.resolve(__dirname, '../assets/js/services/upload-repository.mjs'),
  'utf8',
);
const coordinator = fs.readFileSync(
  path.resolve(__dirname, '../assets/js/services/upload-coordinator.mjs'),
  'utf8',
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extractFrom(contents, start, end) {
  const from = contents.indexOf(start);
  const to = contents.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Bloco ausente: ${start}`);
  return contents.slice(from, to);
}

const extract = (start, end) => extractFrom(javascript, start, end);

const persistence = extractFrom(
  coordinator,
  'async function saveAllData(',
  'function setRuntimeState(',
);
assert(
  persistence.includes(".upsert(rows, { onConflict: 'chave' })"),
  'Datasets precisam ser persistidos em um único upsert',
);
assert(
  !persistence.includes('Promise.all('),
  'Persistência não pode usar writes independentes em paralelo',
);
assert(persistence.includes('throw error;'), 'Falha de persistência precisa interromper o upload');

const commit = extractFrom(
  coordinator,
  'async function commitPreparedUpload(',
  'return Object.freeze({',
);
assert(commit.includes('return executeTransaction('), 'Coordenador não usa a transação extraída');
const createIndex = transaction.indexOf('operations.createRecord(');
const persistIndex = transaction.indexOf('operations.saveAllData(');
const activateIndex = transaction.indexOf('operations.activateRecord(');
assert(
  createIndex >= 0 && createIndex < persistIndex && persistIndex < activateIndex,
  'Ordem obrigatória: metadata inativa, dados, ativação',
);
[
  'operations.rollbackActivation(',
  'operations.restoreDashboardRows(',
  'operations.markRecordsFailed(',
  'operations.deleteRecords(',
  'operations.removeStoredUpload(',
  'operations.restoreMemoryState?.(',
].forEach((call) => assert(transaction.includes(call), `Rollback incompleto: ${call}`));

const metadata = extractFrom(
  repository,
  'async function createRecord(',
  'async function activateRecord(',
);
assert(
  metadata.includes("observacao: 'upload_state:processing'"),
  'Metadata nova precisa começar em processing',
);
assert(metadata.includes('is_active: false'), 'Metadata nova não pode começar ativa');

const activation = extractFrom(
  repository,
  'async function activateRecord(',
  'async function rollbackActivation(',
);
assert(
  activation.includes("observacao: 'upload_state:active'"),
  'Ativação precisa persistir o estado active',
);
assert(
  activation.includes('previousIds'),
  'Ativação precisa preservar referência ao ativo anterior',
);

const singleUpload = extract(
  'function handleUpload(',
  '// ============================================================\n// v0.52 — Central de Uploads',
);
assert(
  singleUpload.includes('await commitPreparedUpload({'),
  'Upload CSV precisa usar o coordenador transacional',
);
assert(
  singleUpload.indexOf('await commitPreparedUpload({') < singleUpload.lastIndexOf("authToast('✅"),
  'CSV não pode anunciar sucesso antes do commit',
);

const excelUpload = extract(
  'async function _processExcelSheets(',
  '// Renderiza mensagem de progresso',
);
assert(
  excelUpload.indexOf('if (parseErrors.length)') <
    excelUpload.indexOf('await commitPreparedUpload({'),
  'Excel precisa rejeitar erros de parser antes do commit',
);
assert(
  excelUpload.includes('Nenhum dado foi alterado'),
  'Excel precisa informar falha sem alteração parcial',
);

const historyActivation = extract(
  'async function marcarUploadComoAtivo(',
  '// Helper interno: parseia CSV',
);
assert(
  historyActivation.includes('supaCaptureDashboardRows('),
  'Reativação precisa capturar dados anteriores',
);
assert(
  historyActivation.indexOf('supaSaveAllData(') <
    historyActivation.indexOf('supaActivateUploadRecord('),
  'Reativação só pode ativar após persistir',
);
assert(
  historyActivation.includes('supaRestoreDashboardRows('),
  'Reativação precisa restaurar dados em caso de falha',
);

assert(
  repository.includes(".in('observacao', ['upload_state:processing', 'upload_state:failed'])"),
  'Limpeza de uploads interrompidos ausente',
);
assert(
  javascript.includes('await supaCleanupIncompleteUploads()'),
  'Recuperação de uploads incompletos não roda no boot',
);
assert(
  javascript.includes("state.status === 'processing'"),
  'Troca de obra precisa ser bloqueada durante uploads',
);
assert(
  repository.includes("observacao: 'upload_state:failed'"),
  'Tentativas incompletas precisam ser marcadas como failed',
);
assert(!javascript.includes('supaLogUpload('), 'Fluxo antigo de ativação antecipada ainda existe');

console.log('Contrato de uploads: commit tardio e rollback compensatório OK');
