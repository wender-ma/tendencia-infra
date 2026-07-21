#!/usr/bin/env node

const { readProjectFile } = require('./load_project_sources');

const javascript = readProjectFile('assets/js/services/dashboard-repository.mjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extract(start, end) {
  const from = javascript.indexOf(start);
  const to = javascript.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Bloco ausente: ${start}`);
  return javascript.slice(from, to);
}

const classifications = extract(
  'async function loadClassifications(',
  'async function patchClassification(',
);
assert(
  classifications.includes(".eq('codigo_obra', project)"),
  'Classificações precisam ser filtradas pela obra ativa',
);
assert(
  !classifications.includes(".select('*')"),
  'Classificações não devem buscar todas as colunas',
);

const config = extract('async function loadDashboardConfig(', 'async function saveDashboardKey(');
assert(config.includes(".select('chave,valor')"), 'Configuração deve buscar somente chave e valor');
assert(
  config.includes(".in('chave', requiredKeys)"),
  'Configuração deve limitar as chaves consultadas',
);
assert(!config.includes(".select('*')"), 'Configuração não deve carregar todas as colunas');
for (const requiredKey of [
  "'header_title'",
  "'indice_correcao'",
  "'card3_modo'",
  'DASHBOARD_DATA_KEYS.DATA_F',
  'DASHBOARD_DATA_KEYS.HISTORICO',
  'DASHBOARD_DATA_KEYS.PROJ_RAW',
  '`${prefix}evol_global`',
  'prefix + DASHBOARD_DATA_KEYS.DATA_T',
]) {
  assert(config.includes(requiredKey), `Chave necessária ausente da consulta: ${requiredKey}`);
}

console.log('Contrato de consultas: obra ativa e chaves necessárias no boot OK');
