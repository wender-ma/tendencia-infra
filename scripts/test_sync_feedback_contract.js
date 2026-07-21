#!/usr/bin/env node

const { loadProjectSources } = require('./load_project_sources');

const { javascript } = loadProjectSources();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(javascript.includes('function beginSupaOperation()'), 'Início de sincronização não rastreado');
assert(javascript.includes('function finishSupaOperation(error = null)'), 'Fim de sincronização não rastreado');
assert(javascript.includes("el.dataset.syncState = 'saving'"), 'Badge não expõe estado de salvamento');
assert(javascript.includes("el.dataset.syncState = 'synced'"), 'Badge não expõe estado sincronizado');
assert(javascript.includes("el.dataset.syncState = 'error'"), 'Badge não expõe estado de erro');
assert(javascript.includes("el.setAttribute('aria-busy'"), 'Badge não anuncia operação em andamento');
assert(!javascript.includes("el.title = 'Último erro: ' + SUPA_STATUS.lastError"), 'Badge ainda expõe erro interno');

const safeRunner = javascript.slice(
  javascript.indexOf('function runAsyncSafely('),
  javascript.indexOf('// SafeStorage'),
);
assert(safeRunner.includes('beginSupaOperation()'), 'Operações seguras não iniciam feedback');
assert(safeRunner.includes('finishSupaOperation(error)'), 'Falhas não encerram feedback');

console.log('Contrato de sincronização: salvando, sucesso, erro e privacidade do badge OK');
