#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const bootstrap = fs.readFileSync(path.join(root, 'assets/js/bootstrap.js'), 'utf8');
const dashboardPath = path.join(root, 'assets/js/dashboard-legacy.js');

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
assert(fs.statSync(dashboardPath).size > 100_000, 'Script principal externo parece incompleto');

for (const expectedImport of [
  "import('@supabase/supabase-js')",
  "import('xlsx')",
  "import('apexcharts')",
  "from './dashboard-legacy.js?url'",
]) {
  assert(bootstrap.includes(expectedImport), `Import ausente no bootstrap: ${expectedImport}`);
}

for (const expectedGlobal of ['window.supabase', 'window.XLSX', 'window.ApexCharts']) {
  assert(bootstrap.includes(expectedGlobal), `Compatibilidade global ausente: ${expectedGlobal}`);
}

console.log('Contrato de dependencias: pacotes locais, fixos e sem scripts CDN OK');
