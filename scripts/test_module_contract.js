#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'assets/js/config.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'assets/js/bootstrap.js'), 'utf8');
const service = fs.readFileSync(path.join(root, 'assets/js/services/supabase-service.js'), 'utf8');
const legacy = fs.readFileSync(path.join(root, 'assets/js/dashboard-legacy.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const exportedContract of [
  'export const SUPABASE_CONFIG',
  'export const STORAGE_KEYS',
  'export const DASHBOARD_CONFIG',
  'export function installLegacyConfig',
]) {
  assert(config.includes(exportedContract), `Contrato de configuracao ausente: ${exportedContract}`);
}

assert(config.includes("readEnvironment('VITE_SUPABASE_URL'"), 'URL do Supabase nao aceita variavel de ambiente');
assert(config.includes("readEnvironment('VITE_SUPABASE_ANON_KEY'"), 'Anon key nao aceita variavel de ambiente');
assert(config.includes('Object.freeze({'), 'Configuracoes precisam ser imutaveis');

assert(service.includes("from '@supabase/supabase-js'"), 'Servico nao importa o SDK local do Supabase');
assert(service.includes('export function createSupabaseService'), 'Factory do servico Supabase ausente');
assert(service.includes('export function installLegacySupabaseGlobals'), 'Adaptador temporario do legado ausente');
assert(/BASE_RETRY_DELAY_MS \* \(?2 \*\* attempt\)?/.test(service), 'Retry exponencial do Supabase ausente');

assert(
  bootstrap.indexOf('installLegacyConfig();') < bootstrap.indexOf('ensureApexCharts()'),
  'Configuracao deve ser instalada antes das dependencias',
);
assert(bootstrap.includes('createSupabaseService(SUPABASE_CONFIG)'), 'Bootstrap nao cria o servico Supabase');
assert(bootstrap.includes('installLegacySupabaseGlobals(supabaseService)'), 'Bootstrap nao instala o adaptador Supabase');

for (const removedLegacyContract of [
  'const SUPA_URL',
  'const SUPA_KEY',
  'const CONFIG =',
  'let SUPA =',
  'function supaRetry(',
  'window.supabase.createClient',
]) {
  assert(!legacy.includes(removedLegacyContract), `Responsabilidade ainda presente no legado: ${removedLegacyContract}`);
}

console.log('Contrato modular: configuracao, bootstrap e servico Supabase separados OK');
