#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'assets/js/config.js'), 'utf8');
const service = fs.readFileSync(path.join(root, 'assets/js/services/supabase-service.js'), 'utf8');
const auditScript = fs.readFileSync(path.join(root, 'scripts/audit_supabase_contract.sh'), 'utf8');
const backupScript = fs.readFileSync(path.join(root, 'scripts/backup.sh'), 'utf8');
const productionVerifier = fs.readFileSync(
  path.join(root, 'scripts/verify_production_environment.mjs'),
  'utf8',
);
const developmentExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const productionExample = fs.readFileSync(path.join(root, '.env.production.example'), 'utf8');
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
const playwrightConfig = fs.readFileSync(path.join(root, 'playwright.config.js'), 'utf8');
const developmentSmoke = fs.readFileSync(
  path.join(root, 'scripts/run_development_smoke.js'),
  'utf8',
);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  !/DEFAULT_SUPABASE_(?:URL|ANON_KEY)/.test(config),
  'Configuracao nao pode manter credenciais Supabase padrao no codigo',
);
assert(
  !/https:\/\/[^'"`\s]+\.supabase\.co/.test(config),
  'Configuracao nao pode embutir um endpoint Supabase remoto',
);
for (const contract of [
  "readEnvironment('MODE', 'development')",
  "readEnvironment('VITE_APP_ENV')",
  "readEnvironment('VITE_SUPABASE_URL')",
  "readEnvironment('VITE_SUPABASE_ANON_KEY')",
  "configurationStatus === 'ready'",
  "'environment-mismatch'",
]) {
  assert(config.includes(contract), `Contrato de isolamento de ambiente ausente: ${contract}`);
}
assert(
  service.includes("configurationStatus === 'environment-mismatch'"),
  'Servico deve recusar credenciais de um ambiente divergente',
);
assert(
  !auditScript.includes('SUPA_URL =') && !auditScript.includes('INDEX_FILE='),
  'Auditoria remota nao pode procurar credenciais no codigo',
);
assert(
  auditScript.includes('SUPABASE_URL') && auditScript.includes('VITE_SUPABASE_URL'),
  'Auditoria deve aceitar configuracao explicita por ambiente',
);
assert(
  auditScript.includes('baseline|hardened|datasets') &&
    auditScript.includes('dashboard_datasets|id,codigo_obra,tipo,versao'),
  'Auditoria deve oferecer um gate remoto para a migration de snapshots',
);
assert(developmentExample.includes('VITE_APP_ENV=development'), 'Template dev sem ambiente');
assert(productionExample.includes('VITE_APP_ENV=production'), 'Template prod sem ambiente');
assert(gitignore.includes('!.env.production.example'), 'Template de producao nao versionado');
assert(
  backupScript.includes('--exclude=".env*"'),
  'Backups compactados nao podem copiar configuracoes locais de ambiente',
);
assert(
  packageJson.scripts['build:production'] ===
    'node scripts/verify_production_environment.mjs && npm run build',
  'Build de producao nao executa o preflight de ambiente',
);
assert(
  packageJson.scripts['build:test'] === 'vite build --mode test && node scripts/verify_build.js',
  'Build de teste isolado ausente',
);
assert(
  vercel.buildCommand === 'npm run build:production',
  'Vercel deve bloquear deploy sem configuracao explicita de producao',
);
assert(
  playwrightConfig.includes('npm run build:test') &&
    playwrightConfig.includes("VITE_APP_ENV: 'test'") &&
    playwrightConfig.includes('https://test.supabase.co'),
  'Navegador deve usar ambiente Supabase ficticio e isolado',
);
assert(
  packageJson.scripts['test:development'] === 'node scripts/run_development_smoke.js' &&
    developmentSmoke.includes("safeRemoteMethods = new Set(['GET', 'HEAD', 'OPTIONS'])") &&
    developmentSmoke.includes("runtime.declaredEnvironment !== 'development'") &&
    developmentSmoke.includes('unsafeRequests.length > 0'),
  'Smoke do ambiente real deve ser anonimo, development e somente leitura',
);
for (const contract of [
  "loadEnv(mode, process.cwd(), 'VITE_')",
  "VITE_APP_ENV', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'",
  'VITE_APP_ENV deve ser exatamente "production"',
  'sem /rest/v1 ou outros caminhos',
]) {
  assert(productionVerifier.includes(contract), `Preflight de producao incompleto: ${contract}`);
}

console.log('Contrato de ambientes: dev, teste e producao isolados sem fallback remoto OK');
