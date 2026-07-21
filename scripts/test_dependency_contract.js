#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const bootstrap = fs.readFileSync(path.join(root, 'assets/js/bootstrap.js'), 'utf8');
const dependencyService = fs.readFileSync(
  path.join(root, 'assets/js/services/dependency-service.mjs'),
  'utf8',
);
const supabaseService = fs.readFileSync(path.join(root, 'assets/js/services/supabase-service.js'), 'utf8');
const dashboardPath = path.join(root, 'assets/js/dashboard-legacy.js');
const flowEditorPath = path.join(root, 'assets/js/ui/flow-editor.mjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dependencies = packageJson.dependencies || {};
const remoteScripts = [...html.matchAll(/<script\b[^>]*src=["'](https?:\/\/[^"']+)["'][^>]*>/gi)]
  .map(match => match[1]);
const inlineScripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>/gi)];

assert(remoteScripts.length === 0, `Scripts remotos encontrados: ${remoteScripts.join(', ')}`);
assert(inlineScripts.length === 0, 'index.html voltou a conter JavaScript inline');
assert(
  /<script\b[^>]*type=["']module["'][^>]*src=["']assets\/js\/bootstrap\.js["'][^>]*><\/script>/i.test(html),
  'Bootstrap do Vite ausente no index.html',
);
assert(dependencies['@supabase/supabase-js'] === '2.100.0', 'Supabase deve permanecer fixado em 2.100.0');
assert(dependencies.apexcharts === '4.7.0', 'ApexCharts deve permanecer fixado em 4.7.0');
assert(
  dependencies.xlsx === 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz',
  'SheetJS deve permanecer fixado no pacote oficial 0.20.3',
);
assert(fs.existsSync(dashboardPath), 'Script principal externo ausente');
assert(fs.existsSync(flowEditorPath), 'Módulo do editor de Flows ausente');
assert(
  fs.statSync(dashboardPath).size + fs.statSync(flowEditorPath).size > 100_000,
  'Código principal parece incompleto',
);

for (const expectedImport of [
  "from './dashboard-legacy.js?url'",
  "from './config.js'",
  "from './ui/flow-editor.mjs'",
  "from './services/supabase-service.js'",
]) {
  assert(bootstrap.includes(expectedImport), `Import ausente no bootstrap: ${expectedImport}`);
}

for (const expectedImport of ["import('xlsx')", "import('apexcharts')"]) {
  assert(
    dependencyService.includes(expectedImport),
    `Import sob demanda ausente: ${expectedImport}`,
  );
}
assert(
  !bootstrap.includes("import('xlsx')"),
  'SheetJS voltou a ser solicitado diretamente durante o bootstrap',
);

assert(supabaseService.includes("from '@supabase/supabase-js'"), 'SDK do Supabase ausente no servico local');
assert(supabaseService.includes('target.supabase'), 'Compatibilidade global do Supabase ausente');

assert(dependencyService.includes('window.XLSX'), 'Compatibilidade global do SheetJS ausente');
assert(dependencyService.includes('window.ApexCharts'), 'Compatibilidade global do ApexCharts ausente');

console.log('Contrato de dependencias: pacotes locais, fixos e sem scripts CDN OK');
