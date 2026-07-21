#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'assets/js/config.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'assets/js/bootstrap.js'), 'utf8');
const projectionCatalog = fs.readFileSync(path.join(root, 'assets/js/data/projection-catalog.mjs'), 'utf8');
const staticViews = fs.readFileSync(path.join(root, 'assets/js/ui/static-views.mjs'), 'utf8');
const uploadRepository = fs.readFileSync(
  path.join(root, 'assets/js/services/upload-repository.mjs'),
  'utf8',
);
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
assert(staticViews.includes("from '../../views/tabs/overview.html?raw'"), 'Aba de visão geral não foi externalizada');
assert(staticViews.includes("from '../../views/dialogs.html?raw'"), 'Diálogos estáticos não foram externalizados');
assert(staticViews.includes('export function mountStaticViews'), 'Montagem das abas estáticas ausente');
assert(staticViews.includes('new DOMParser()'), 'Markup local deve ser montado com parser estruturado');
assert(!staticViews.includes('.innerHTML'), 'Montagem das abas não deve depender de innerHTML');
for (const repositoryContract of [
  'export function createUploadRepository',
  'export function installLegacyUploadRepository',
  "from('upload_history')",
  "from(UPLOADS_BUCKET)",
  'enforceRollingBackup',
]) {
  assert(uploadRepository.includes(repositoryContract), `Contrato do repositório de uploads ausente: ${repositoryContract}`);
}

for (const catalogContract of [
  'export const PROJECTION_CATALOG',
  'export function installLegacyProjectionCatalog',
  'hierarchy: Object.freeze(hierarchy)',
  'services: Object.freeze(services)',
  'inputs: Object.freeze(inputs)',
]) {
  assert(projectionCatalog.includes(catalogContract), `Contrato do catalogo ausente: ${catalogContract}`);
}

assert(service.includes("from '@supabase/supabase-js'"), 'Servico nao importa o SDK local do Supabase');
assert(service.includes('export function createSupabaseService'), 'Factory do servico Supabase ausente');
assert(service.includes('export function installLegacySupabaseGlobals'), 'Adaptador temporario do legado ausente');
assert(/BASE_RETRY_DELAY_MS \* \(?2 \*\* attempt\)?/.test(service), 'Retry exponencial do Supabase ausente');

assert(
  bootstrap.indexOf('mountStaticViews();') < bootstrap.indexOf('installActionDelegation();'),
  'Abas estáticas devem existir antes da delegação de eventos',
);
assert(
  bootstrap.indexOf('installLegacyConfig();') < bootstrap.indexOf('Promise.resolve()'),
  'Configuracao deve ser instalada antes das dependencias',
);
assert(
  bootstrap.indexOf('installLegacyProjectionCatalog();') < bootstrap.indexOf('Promise.resolve()'),
  'Catalogo de projecao deve ser instalado antes do legado',
);
assert(
  bootstrap.includes('createSupabaseService(SUPABASE_CONFIG, {')
    && bootstrap.includes('reportError: (context, error) => logger.warn(context, error)'),
  'Bootstrap nao cria o servico Supabase com logger sanitizado',
);
assert(bootstrap.includes('installLegacySupabaseGlobals(supabaseService)'), 'Bootstrap nao instala o adaptador Supabase');

for (const removedLegacyContract of [
  'const SUPA_URL',
  'const SUPA_KEY',
  'const CONFIG =',
  'let SUPA =',
  'function supaRetry(',
  'window.supabase.createClient',
  'const HIERARQUIA =',
  'const SERVICOS_META =',
  'const INSUMOS_META =',
  'async function supaCreateUploadRecord(',
  'async function supaUploadFile(',
  'async function supaLoadUploadsLatest(',
]) {
  assert(!legacy.includes(removedLegacyContract), `Responsabilidade ainda presente no legado: ${removedLegacyContract}`);
}

console.log('Contrato modular: configuracao, catalogos, bootstrap e servico Supabase separados OK');
