#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tokens = fs.readFileSync(path.join(root, 'assets/css/tokens.css'), 'utf8');
const visualSources = [
  'assets/css/base.css',
  'assets/css/dashboard.css',
  'assets/js/ui/dashboard-runtime.mjs',
].map((file) => ({ file, source: fs.readFileSync(path.join(root, file), 'utf8') }));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const token of [
  '--accent-purple',
  '--accent-info',
  '--sem-ok-subtle',
  '--sem-erro-soft',
  '--sem-alerta-subtle',
  '--text-on-dark',
  '--row-flow-bg',
  '--chart-primary',
  '--chart-text',
  '--chart-grid',
  '--chart-track',
  '--chart-neutral',
]) {
  assert(tokens.includes(`${token}:`), `Token oficial ausente: ${token}`);
}

for (const { file, source } of visualSources) {
  const rawHex = source.match(/#[0-9a-f]{3,8}\b/gi) || [];
  assert(
    rawHex.length === 0,
    `${file} contém cores hex fora dos tokens: ${[...new Set(rawHex)].join(', ')}`,
  );
}

assert(tokens.includes('body.dark'), 'Tokens do tema escuro ausentes');
assert(
  tokens.includes('--accent-purple:        #A78BFA'),
  'Acento roxo não possui variante escura',
);
assert(
  tokens.includes('--text-strong:    #FFFFFF') &&
    tokens.includes('--text-medium:    #F8FAFC') &&
    tokens.includes('--chart-text:     #FFFFFF'),
  'Tema escuro precisa manter textos e gráficos em alto contraste',
);
assert(
  !visualSources.some(({ source }) => /colors:\s*\[\s*['"]var\(--/.test(source)),
  'ApexCharts recebeu variável CSS sem resolução',
);
assert(
  visualSources.some(({ source }) =>
    source.includes('documentRef.body || documentRef.documentElement'),
  ),
  'Gráficos não resolvem tokens a partir do tema ativo',
);
assert(
  visualSources.some(({ source }) =>
    source.includes("foreColor: resolveColor('var(--chart-text)')"),
  ),
  'ApexCharts precisa aplicar a cor textual do tema aos eixos',
);

const chartSources = [
  'assets/js/ui/views/overview.mjs',
  'assets/js/ui/views/projection.mjs',
  'assets/js/ui/views/projection-control.mjs',
  'assets/js/ui/views/history.mjs',
].map((file) => fs.readFileSync(path.join(root, file), 'utf8'));
assert(
  chartSources.every((source) => source.includes("resolveColor('var(--chart-grid)')")),
  'Todos os gráficos precisam usar a grade de alto contraste',
);
assert(
  !chartSources.some((source) => source.includes("colors: [resolveColor('var(--fgr-red-deep)')")),
  'Séries não devem reutilizar o vinho profundo no modo escuro',
);

const shell = fs.readFileSync(path.join(root, 'assets/js/ui/shell.mjs'), 'utf8');
assert(
  shell.includes('const refreshResult = refreshCharts();') &&
    !shell.includes('if (activeTab) renderTab(activeTab);'),
  'Troca de tema precisa atualizar os gráficos sem redesenhar a aba ativa',
);

const dashboardRuntime = fs.readFileSync(
  path.join(root, 'assets/js/ui/dashboard-runtime.mjs'),
  'utf8',
);
assert(
  dashboardRuntime.includes('chart.updateOptions(nextOptions, false, false, false)') &&
    dashboardRuntime.includes('chartThemeMetadata'),
  'Runtime precisa atualizar tema e paletas nas instâncias existentes do ApexCharts',
);

console.log('Contrato de cores: paleta centralizada e temas claro/escuro sem hex disperso OK');
