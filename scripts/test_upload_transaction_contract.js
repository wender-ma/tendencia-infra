#!/usr/bin/env node

const { loadProjectSources } = require('./load_project_sources');

const { javascript } = loadProjectSources();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extract(start, end) {
  const from = javascript.indexOf(start);
  const to = javascript.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Bloco ausente: ${start}`);
  return javascript.slice(from, to);
}

const persistence = extract('async function supaSaveAllData(', '// v0.58b: reset dos dados');
assert(persistence.includes(".upsert(rows, { onConflict: 'chave' })"), 'Datasets precisam ser persistidos em um único upsert');
assert(!persistence.includes('Promise.all('), 'Persistência não pode usar writes independentes em paralelo');
assert(persistence.includes('throw error;'), 'Falha de persistência precisa interromper o upload');

const commit = extract('async function commitPreparedUpload(', 'async function supaCreateUploadRecord(');
const createIndex = commit.indexOf('supaCreateUploadRecord(');
const persistIndex = commit.indexOf('supaSaveAllData(');
const activateIndex = commit.indexOf('supaActivateUploadRecord(');
assert(createIndex >= 0 && createIndex < persistIndex && persistIndex < activateIndex, 'Ordem obrigatória: metadata inativa, dados, ativação');
[
  'supaRollbackUploadActivation(',
  'supaRestoreDashboardRows(',
  'supaMarkUploadRecordsFailed(',
  'supaDeleteUploadRecords(',
  'supaRemoveStoredUpload(',
  'restoreInMemoryUploadState(',
].forEach(call => assert(commit.includes(call), `Rollback incompleto: ${call}`));

const metadata = extract('async function supaCreateUploadRecord(', 'async function supaActivateUploadRecord(');
assert(metadata.includes("observacao: 'upload_state:processing'"), 'Metadata nova precisa começar em processing');
assert(metadata.includes('is_active: false'), 'Metadata nova não pode começar ativa');

const activation = extract('async function supaActivateUploadRecord(', 'async function supaRollbackUploadActivation(');
assert(activation.includes("observacao: 'upload_state:active'"), 'Ativação precisa persistir o estado active');
assert(activation.includes('previousIds'), 'Ativação precisa preservar referência ao ativo anterior');

const singleUpload = extract('function handleUpload(', '// ============================================================\n// v0.52 — Central de Uploads');
assert(singleUpload.includes('await commitPreparedUpload({'), 'Upload CSV precisa usar o coordenador transacional');
assert(singleUpload.indexOf('await commitPreparedUpload({') < singleUpload.lastIndexOf("authToast('✅"), 'CSV não pode anunciar sucesso antes do commit');

const excelUpload = extract('async function _processExcelSheets(', '// Renderiza mensagem de progresso');
assert(excelUpload.indexOf('if (parseErrors.length)') < excelUpload.indexOf('await commitPreparedUpload({'), 'Excel precisa rejeitar erros de parser antes do commit');
assert(excelUpload.includes('Nenhum dado foi alterado'), 'Excel precisa informar falha sem alteração parcial');

const historyActivation = extract('async function marcarUploadComoAtivo(', '// Helper interno: parseia CSV');
assert(historyActivation.includes('supaCaptureDashboardRows('), 'Reativação precisa capturar dados anteriores');
assert(historyActivation.indexOf('supaSaveAllData(') < historyActivation.indexOf('supaActivateUploadRecord('), 'Reativação só pode ativar após persistir');
assert(historyActivation.includes('supaRestoreDashboardRows('), 'Reativação precisa restaurar dados em caso de falha');

assert(javascript.includes(".in('observacao', ['upload_state:processing', 'upload_state:failed'])"), 'Limpeza de uploads interrompidos ausente');
assert(javascript.includes('await supaCleanupIncompleteUploads()'), 'Recuperação de uploads incompletos não roda no boot');
assert(javascript.includes("state.status === 'processing'"), 'Troca de obra precisa ser bloqueada durante uploads');
assert(javascript.includes("observacao: 'upload_state:failed'"), 'Tentativas incompletas precisam ser marcadas como failed');
assert(!javascript.includes('supaLogUpload('), 'Fluxo antigo de ativação antecipada ainda existe');

console.log('Contrato de uploads: commit tardio e rollback compensatório OK');
