#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, 'assets/js/ui/view-states.mjs'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'assets/js/bootstrap.js'), 'utf8');
const legacy = fs.readFileSync(path.join(root, 'assets/js/dashboard-legacy.js'), 'utf8');
const historyView = fs.readFileSync(path.join(root, 'assets/js/ui/views/history.mjs'), 'utf8');
const projectionControlView = fs.readFileSync(
  path.join(root, 'assets/js/ui/views/projection-control.mjs'),
  'utf8',
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(moduleSource.includes('export function createViewStateService'), 'Factory de estados ausente');
assert(moduleSource.includes('textContent = title'), 'Título do estado deve usar textContent');
assert(moduleSource.includes('textContent = message'), 'Mensagem do estado deve usar textContent');
assert(moduleSource.includes("kind === 'error' ? 'alert' : 'status'"), 'Semântica de status/erro ausente');
assert(bootstrap.includes('installLegacyViewStateGlobals(viewStateService)'), 'Estado não instalado no bootstrap');
assert(bootstrap.includes('viewStates: viewStateService'), 'Serviço de estado não publicado');
assert(!legacy.includes('renderPlaceholderSemDados'), 'Placeholder HTML legado ainda está presente');

const movementTable = projectionControlView.slice(
  projectionControlView.indexOf('function renderMovTable('),
  projectionControlView.indexOf('function clearMovFilters('),
);
assert(!movementTable.includes('historyPage'), 'Tabela de movimentações contém paginação do histórico');
assert(!movementTable.includes('compare'), 'Tabela de movimentações depende de filtro do histórico');

const historyHeatmap = historyView.slice(
  historyView.indexOf('function renderHistHeatmap('),
  historyView.indexOf('export function installLegacyHistoryView'),
);
assert(historyHeatmap.indexOf('const historyPage') < historyHeatmap.indexOf('historyPage.items'), 'Página do histórico deve ser criada antes do uso');

console.log('Contrato de estados: componente seguro, integração e regressões de paginação OK');
