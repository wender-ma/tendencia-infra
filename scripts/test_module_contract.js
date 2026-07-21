#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'assets/js/config.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'assets/js/bootstrap.js'), 'utf8');
const projectionCatalog = fs.readFileSync(
  path.join(root, 'assets/js/data/projection-catalog.mjs'),
  'utf8',
);
const staticViews = fs.readFileSync(path.join(root, 'assets/js/ui/static-views.mjs'), 'utf8');
const domUi = fs.readFileSync(path.join(root, 'assets/js/ui/dom.mjs'), 'utf8');
const flowEditor = fs.readFileSync(path.join(root, 'assets/js/ui/flow-editor.mjs'), 'utf8');
const dashboardShell = fs.readFileSync(path.join(root, 'assets/js/ui/shell.mjs'), 'utf8');
const authUi = fs.readFileSync(path.join(root, 'assets/js/ui/auth-ui.mjs'), 'utf8');
const dashboardExport = fs.readFileSync(
  path.join(root, 'assets/js/services/dashboard-export.mjs'),
  'utf8',
);
const dashboardRepository = fs.readFileSync(
  path.join(root, 'assets/js/services/dashboard-repository.mjs'),
  'utf8',
);
const syncStatus = fs.readFileSync(path.join(root, 'assets/js/services/sync-status.mjs'), 'utf8');
const uploadCoordinator = fs.readFileSync(
  path.join(root, 'assets/js/services/upload-coordinator.mjs'),
  'utf8',
);
const uploadRepository = fs.readFileSync(
  path.join(root, 'assets/js/services/upload-repository.mjs'),
  'utf8',
);
const uploadUi = fs.readFileSync(path.join(root, 'assets/js/ui/uploads.mjs'), 'utf8');
const uploadMaintenance = fs.readFileSync(
  path.join(root, 'assets/js/ui/upload-maintenance.mjs'),
  'utf8',
);
const projectController = fs.readFileSync(
  path.join(root, 'assets/js/ui/project-controller.mjs'),
  'utf8',
);
const projectRepository = fs.readFileSync(
  path.join(root, 'assets/js/services/project-repository.mjs'),
  'utf8',
);
const storageService = fs.readFileSync(
  path.join(root, 'assets/js/services/storage-service.mjs'),
  'utf8',
);
const adminView = fs.readFileSync(path.join(root, 'assets/js/ui/views/admin.mjs'), 'utf8');
const detailsView = fs.readFileSync(path.join(root, 'assets/js/ui/views/details.mjs'), 'utf8');
const flowsView = fs.readFileSync(path.join(root, 'assets/js/ui/views/flows.mjs'), 'utf8');
const historyView = fs.readFileSync(path.join(root, 'assets/js/ui/views/history.mjs'), 'utf8');
const overviewView = fs.readFileSync(path.join(root, 'assets/js/ui/views/overview.mjs'), 'utf8');
const projectionView = fs.readFileSync(
  path.join(root, 'assets/js/ui/views/projection.mjs'),
  'utf8',
);
const projectionControlView = fs.readFileSync(
  path.join(root, 'assets/js/ui/views/projection-control.mjs'),
  'utf8',
);
const service = fs.readFileSync(path.join(root, 'assets/js/services/supabase-service.js'), 'utf8');
const application = fs.readFileSync(path.join(root, 'assets/js/application.mjs'), 'utf8');
const dashboardRuntime = fs.readFileSync(
  path.join(root, 'assets/js/ui/dashboard-runtime.mjs'),
  'utf8',
);
const legacyPath = path.join(root, 'assets/js/dashboard-legacy.js');
const coordinatorSources = `${bootstrap}\n${application}`;
const viewSources = [
  flowEditor,
  uploadUi,
  adminView,
  detailsView,
  flowsView,
  historyView,
  overviewView,
  projectionView,
  projectionControlView,
].join('\n');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(!viewSources.includes('installLegacy'), 'Views voltaram a publicar adaptadores legados');
assert(!viewSources.includes('eslint-disable no-undef'), 'Views voltaram a ocultar dependências');
assert(
  !/window\.(?:render|parse|load|build|apply|PROJ_CTRL|INSUMOS)/.test(bootstrap),
  'Bootstrap voltou a coordenar módulos por aliases globais',
);

for (const exportedContract of [
  'export const SUPABASE_CONFIG',
  'export const STORAGE_KEYS',
  'export const DASHBOARD_CONFIG',
]) {
  assert(
    config.includes(exportedContract),
    `Contrato de configuracao ausente: ${exportedContract}`,
  );
}

assert(
  config.includes("readEnvironment('VITE_SUPABASE_URL'"),
  'URL do Supabase nao aceita variavel de ambiente',
);
assert(
  config.includes("readEnvironment('VITE_SUPABASE_ANON_KEY'"),
  'Anon key nao aceita variavel de ambiente',
);
assert(config.includes('Object.freeze({'), 'Configuracoes precisam ser imutaveis');
assert(
  staticViews.includes("from '../../views/tabs/overview.html?raw'"),
  'Aba de visão geral não foi externalizada',
);
assert(
  staticViews.includes("from '../../views/dialogs.html?raw'"),
  'Diálogos estáticos não foram externalizados',
);
assert(
  staticViews.includes('export function mountStaticViews'),
  'Montagem das abas estáticas ausente',
);
assert(domUi.includes('new DOMParser()'), 'Markup local deve ser montado com parser estruturado');
assert(!domUi.includes('installLegacyDomGlobals'), 'Helper DOM voltou a ser publicado globalmente');
assert(
  flowEditor.includes('export function createFlowEditor'),
  'Editor de Flows não foi modularizado',
);
assert(
  flowEditor.includes('function massAplicarDestino('),
  'Ações em massa ausentes do editor de Flows',
);
assert(!flowEditor.includes('.innerHTML'), 'Editor de Flows não pode montar HTML sem parser');
assert(
  dashboardShell.includes('export function createDashboardShell'),
  'Controlador do shell do dashboard ausente',
);
assert(
  dashboardShell.includes('export function createDashboardShellActions'),
  'Registro explícito de ações do shell ausente',
);
assert(!dashboardShell.includes('.innerHTML'), 'Shell não pode montar HTML sem parser');
assert(
  authUi.includes('export function createAuthUi'),
  'Interface de autenticação não foi modularizada',
);
assert(!authUi.includes('.innerHTML'), 'Interface de autenticação não pode montar HTML inseguro');
assert(
  dashboardExport.includes('export function createDashboardExportService'),
  'Serviço de exportação XLSX ausente',
);
assert(
  dashboardExport.includes('export function createDashboardExportActions'),
  'Ações explícitas das exportações XLSX ausentes',
);
assert(
  !dashboardExport.includes('installLegacyDashboardExports'),
  'Exportações XLSX voltaram a publicar adaptador global',
);
assert(
  dashboardRepository.includes('export function createDashboardRepository'),
  'Repositório de dados do dashboard ausente',
);
assert(
  !dashboardRepository.includes('installLegacyDashboardRepository'),
  'Repositório de dados voltou a publicar adaptador global',
);
assert(
  syncStatus.includes('export function createSyncStatusService'),
  'Serviço de status de sincronização ausente',
);
assert(
  !syncStatus.includes('.style.'),
  'Status de sincronização deve usar classes ou atributos CSS',
);
assert(
  uploadCoordinator.includes('export function createUploadCoordinator'),
  'Coordenador de uploads ausente',
);
assert(
  !uploadCoordinator.includes('installLegacyUploadCoordinator'),
  'Coordenador de uploads voltou a publicar adaptador global',
);
assert(!staticViews.includes('.innerHTML'), 'Montagem das abas não deve depender de innerHTML');
for (const repositoryContract of [
  'export function createUploadRepository',
  "from('upload_history')",
  'from(UPLOADS_BUCKET)',
  'enforceRollingBackup',
]) {
  assert(
    uploadRepository.includes(repositoryContract),
    `Contrato do repositório de uploads ausente: ${repositoryContract}`,
  );
}
assert(
  !uploadRepository.includes('installLegacyUploadRepository'),
  'Repositório de uploads voltou a publicar adaptador global',
);
for (const uploadUiContract of [
  'export function createUploadView',
  'function handleUpload(',
  'async function handleExcelUpload(',
  'function renderUploadsCentral(',
  'function renderSourcesHeaders(',
]) {
  assert(
    uploadUi.includes(uploadUiContract),
    `Contrato da interface de uploads ausente: ${uploadUiContract}`,
  );
}
assert(!uploadUi.includes('.innerHTML'), 'Interface de uploads não pode montar HTML sem parser');
assert(
  uploadMaintenance.includes('export function createUploadMaintenance'),
  'Manutenção de uploads não foi modularizada',
);
assert(
  !uploadMaintenance.includes('installLegacyUploadMaintenance'),
  'Manutenção de uploads voltou a publicar adaptador global',
);
assert(
  !coordinatorSources.includes('async function resetCacheDados(') &&
    !coordinatorSources.includes('async function apagarHistoricoUploads('),
  'Ações destrutivas de upload não podem permanecer no coordenador',
);
assert(
  projectController.includes('export function createProjectController'),
  'Controlador de obras não foi modularizado',
);
assert(
  projectController.includes('export function createProjectActions'),
  'Registro explícito de ações do controlador de obras ausente',
);
assert(
  projectRepository.includes('export function createProjectRepository'),
  'Repositório do catálogo de obras ausente',
);
assert(
  storageService.includes('export function createSafeStorage'),
  'Serviço de armazenamento resiliente ausente',
);
for (const removedProjectFunction of [
  'function carregarObras(',
  'function trocarObra(',
  'function recarregarDadosDaObra(',
  'function aplicarDadosPersistidos(',
]) {
  assert(
    !coordinatorSources.includes(removedProjectFunction),
    `Ciclo de obras ainda duplicado no coordenador: ${removedProjectFunction}`,
  );
}
assert(
  adminView.includes('export function createAdminView'),
  'View administrativa não foi modularizada',
);
assert(
  adminView.includes('async function renderObrasAdmin('),
  'Tabela de obras ausente da view administrativa',
);
assert(
  adminView.includes('async function renderEditoresAdmin('),
  'Tabela de editores ausente da view administrativa',
);
assert(!adminView.includes('.innerHTML'), 'View administrativa não pode montar HTML sem parser');
assert(
  detailsView.includes('export function createDetailsView'),
  'View de detalhamento não foi modularizada',
);
assert(detailsView.includes('function renderTable('), 'Tabela de detalhamento ausente da view');
assert(!detailsView.includes('.innerHTML'), 'View de detalhamento não pode montar HTML sem parser');
assert(
  flowsView.includes('export function createFlowsView'),
  'View de Flows não foi modularizada',
);
assert(flowsView.includes('function renderFlowTable('), 'Tabela de Flows ausente da view');
assert(!flowsView.includes('.innerHTML'), 'View de Flows não pode montar HTML sem parser');
assert(
  historyView.includes('export function createHistoryView'),
  'View de histórico não foi modularizada',
);
assert(historyView.includes('function renderHistHeatmap('), 'Tabela histórica ausente da view');
assert(!historyView.includes('.innerHTML'), 'View de histórico não pode montar HTML sem parser');
assert(
  overviewView.includes('export function createOverviewView'),
  'View da Visão Geral não foi modularizada',
);
assert(
  overviewView.includes('function renderVisao('),
  'Renderização da Visão Geral ausente da view',
);
assert(!overviewView.includes('.innerHTML'), 'View da Visão Geral não pode montar HTML sem parser');
assert(
  projectionView.includes('export function createProjectionView'),
  'View de Tendência de Obra não foi modularizada',
);
assert(
  projectionView.includes('function renderProjTable('),
  'Tabela de Tendência de Obra ausente da view',
);
assert(
  !projectionView.includes('.innerHTML'),
  'View de Tendência de Obra não pode montar HTML sem parser',
);
assert(
  projectionControlView.includes('export function createProjectionControlView'),
  'View de controle de projeção não foi modularizada',
);
assert(
  projectionControlView.includes('function renderMovTable('),
  'Tabela de movimentações ausente da view',
);
assert(
  !projectionControlView.includes('.innerHTML'),
  'View de controle de projeção não pode montar HTML sem parser',
);

for (const catalogContract of [
  'export const PROJECTION_CATALOG',
  'hierarchy: Object.freeze(hierarchy)',
  'services: Object.freeze(services)',
  'inputs: Object.freeze(inputs)',
]) {
  assert(
    projectionCatalog.includes(catalogContract),
    `Contrato do catalogo ausente: ${catalogContract}`,
  );
}

assert(
  service.includes("from '@supabase/supabase-js'"),
  'Servico nao importa o SDK local do Supabase',
);
assert(
  service.includes('export function createSupabaseService'),
  'Factory do servico Supabase ausente',
);
assert(!service.includes('installLegacySupabaseGlobals'), 'Supabase voltou ao escopo global');
assert(
  /BASE_RETRY_DELAY_MS \* \(?2 \*\* attempt\)?/.test(service),
  'Retry exponencial do Supabase ausente',
);

assert(
  bootstrap.indexOf('mountStaticViews();') < bootstrap.indexOf('installActionDelegation({'),
  'Abas estáticas devem existir antes da delegação de eventos',
);
assert(!bootstrap.includes('installLegacyConfig'), 'Configuração voltou ao escopo global');
assert(!bootstrap.includes('installLegacyProjectionCatalog'), 'Catálogo voltou ao escopo global');
assert(
  bootstrap.includes('createSupabaseService(SUPABASE_CONFIG, {') &&
    bootstrap.includes('reportError: (context, error) => logger.warn(context, error)'),
  'Bootstrap nao cria o servico Supabase com logger sanitizado',
);
assert(
  !bootstrap.includes('installLegacySupabaseGlobals'),
  'Bootstrap voltou a instalar adaptador Supabase',
);

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
  'function handleUpload(',
  'async function handleExcelUpload(',
  'function renderUploadsCentral(',
  'function loadClassifications(',
  'function syncAllViewsFromFlows(',
  'function msRenderPanel(',
  'function massAplicarDestino(',
  'function openManualForm(',
  'function _criarWorkbookXLSX(',
  'async function exportarDetalhamentoXLSX(',
  'async function exportarFlowsXLSX(',
  'async function exportarControleProjXLSX(',
  'async function supaLoadClassifications(',
  'async function supaPatchClassification(',
  'async function supaLoadManuals(',
  'async function supaUpsertManual(',
  'async function supaDeleteManual(',
  'async function supaLoadProjConfig(',
  'async function supaSaveProjConfig(',
  'async function supaLoadMovs(',
  'async function supaUpsertMov(',
  'async function supaDeleteMov(',
  'async function supaLoadDashboardConfig(',
  'async function supaSaveDashboardKey(',
  'function toggleTheme(',
  'function toggleHeaderEdit(',
  'function verificarDadosDesatualizados(',
  'function activateTab(',
  'function syncEditingControls(',
  'function updateAuthUI(',
  'function requireEditorForActiveProject(',
  'function requireAdmin(',
  'function isGlobalUploadKind(',
  'function requireUploadPermission(',
  'function openLoginModal(',
  'async function doSignInGoogle(',
  'async function doSignInEmail(',
  'async function doSignUpEmail(',
  'async function handleAuthClick(',
  'const SUPA_STATUS =',
  'function beginSupaOperation(',
  'function finishSupaOperation(',
  'function getDashboardSyncStatus(',
  'function updateSupaBadge(',
  'function buildUploadDashboardRows(',
  'async function supaCaptureDashboardRows(',
  'async function supaRestoreDashboardRows(',
  'async function supaSaveAllData(',
  'const UPLOAD_RUNTIME_STATE =',
  'function setUploadRuntimeState(',
  'function captureInMemoryUploadState(',
  'function restoreInMemoryUploadState(',
  'async function commitPreparedUpload(',
  'async function renderObrasAdmin(',
  'async function renderEditoresAdmin(',
  'async function renderPendentesAdmin(',
  'function renderTable(',
  'function openItem(',
  'function renderFlows(',
  'function renderFlowTable(',
  'function onRefletidoChange(',
  'function renderHistorico(',
  'function renderVisao(',
  'function renderDonut(',
  'function renderProjecao(',
  'function renderProjTable(',
  'function openProjDrill(',
  'function renderProjCtrl(',
  'function renderMovTable(',
]) {
  assert(
    !coordinatorSources.includes(removedLegacyContract),
    `Responsabilidade ainda presente no coordenador: ${removedLegacyContract}`,
  );
}

assert(!fs.existsSync(legacyPath), 'Script clássico legado voltou ao projeto');
assert(
  application.includes('export function createApplication'),
  'Inicializador modular da aplicação ausente',
);
assert(
  dashboardRuntime.includes('export function createDashboardRuntime'),
  'Runtime modular do dashboard ausente',
);
assert(
  !dashboardRuntime.includes('export function installLegacyDashboardRuntime'),
  'Runtime não deve voltar a publicar adaptador global',
);

console.log('Contrato modular: configuracao, catalogos, bootstrap e servico Supabase separados OK');
