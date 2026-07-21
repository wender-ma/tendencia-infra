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

const classifications = extract('async function supaLoadClassifications(', 'async function supaPatchClassification(');
assert(classifications.includes(".eq('codigo_obra', OBRA_ATIVA)"), 'Classificações precisam ser filtradas pela obra ativa');
assert(!classifications.includes(".select('*')"), 'Classificações não devem buscar todas as colunas');

const config = extract('async function supaLoadDashboardConfig(', 'async function supaSaveDashboardKey(');
assert(config.includes(".select('chave,valor')"), 'Configuração deve buscar somente chave e valor');
assert(config.includes(".in('chave', requiredKeys)"), 'Configuração deve limitar as chaves consultadas');
assert(!config.includes(".select('*')"), 'Configuração não deve carregar todas as colunas');
for (const requiredKey of [
  "'header_title'",
  "'indice_correcao'",
  "'card3_modo'",
  'DATA_KEYS.DATA_F',
  'DATA_KEYS.HISTORICO',
  'DATA_KEYS.PROJ_RAW',
  "prefix + 'evol_global'",
  'prefix + DATA_KEYS.DATA_T',
]) {
  assert(config.includes(requiredKey), `Chave necessária ausente da consulta: ${requiredKey}`);
}

console.log('Contrato de consultas: obra ativa e chaves necessárias no boot OK');
