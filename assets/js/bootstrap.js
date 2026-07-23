import { createApplication } from './application.mjs';
import { DASHBOARD_CONFIG, STORAGE_KEYS, SUPABASE_CONFIG } from './config.js';
import { createImportParserService } from './parsers/index.mjs';
import { createPerformanceMonitor } from './performance.mjs';
import { createFeedbackService } from './ui/feedback.mjs';
import { createModalService } from './ui/modals.mjs';
import { createActionRegistry, installActionDelegation } from './ui/actions.mjs';
import { createAuthUi, createAuthUiActions, isGlobalUploadKind } from './ui/auth-ui.mjs';
import { createDashboardShell, createDashboardShellActions } from './ui/shell.mjs';
import { createDashboardRuntime, formatNumber } from './ui/dashboard-runtime.mjs';
import { createProjectController, createProjectActions } from './ui/project-controller.mjs';
import { createUploadMaintenance } from './ui/upload-maintenance.mjs';
import { createPaginationService } from './ui/pagination.mjs';
import { createViewStateService } from './ui/view-states.mjs';
import { mountStaticViews } from './ui/static-views.mjs';
import { createAppState } from './state.js';
import { createSupabaseService } from './services/supabase-service.js';
import { createAuthService } from './services/auth-service.js';
import {
  createDashboardExportActions,
  createDashboardExportService,
} from './services/dashboard-export.mjs';
import {
  createDashboardRepository,
  DASHBOARD_DATA_KEYS,
} from './services/dashboard-repository.mjs';
import { createDashboardDatasetRepository } from './services/dashboard-dataset-repository.mjs';
import { ensureApexCharts, ensureXlsx } from './services/dependency-service.mjs';
import { createExcelService } from './services/excel-service.mjs';
import { createLogger } from './services/logger.mjs';
import { createProjectRepository } from './services/project-repository.mjs';
import { createSafeStorage } from './services/storage-service.mjs';
import { createSyncStatusService } from './services/sync-status.mjs';
import { validateUploadFile } from './services/upload-policy.mjs';
import { createUploadCoordinator } from './services/upload-coordinator.mjs';
import { createUploadRepository } from './services/upload-repository.mjs';
import { executeUploadTransaction } from './services/upload-transaction.mjs';

function showBootstrapError(error) {
  logger.error('Boot/carregar dashboard', error);

  const badge = document.getElementById('supaBadge');
  if (badge) {
    badge.textContent = 'Falha ao iniciar';
    badge.title = 'Recarregue a pagina. Se o erro continuar, contate o suporte.';
  }

  const loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) {
    loadingOverlay.setAttribute('aria-hidden', 'true');
  }
}

mountStaticViews();
const logger = createLogger();
const actionRegistry = createActionRegistry();
const ui = {};
actionRegistry.register({ print: () => window.print() });
const supabaseService = createSupabaseService(SUPABASE_CONFIG, {
  reportError: (context, error) => logger.warn(context, error),
});
const syncStatusService = createSyncStatusService({
  isOnline: () => Boolean(supabaseService.client),
});
const appState = createAppState();
const performanceService = createPerformanceMonitor();
const feedbackService = createFeedbackService();
const storageService = createSafeStorage({
  storage: (() => {
    try {
      return window.localStorage;
    } catch (error) {
      logger.warn('Storage/inicializar', error);
      return null;
    }
  })(),
  warn: (context, error) => logger.warn(context, error),
  notifyQuotaExceeded: () =>
    feedbackService.toast(
      'Armazenamento local cheio. Algumas configurações não serão salvas.',
      'warn',
      5000,
    ),
});
const modalService = createModalService({ resolveAction: (name) => actionRegistry.resolve(name) });
actionRegistry.register({
  closeModal: modalService.close,
  closeConfirmModal: modalService.closeConfirm,
});
const paginationService = createPaginationService({ pageSize: DASHBOARD_CONFIG.table_page_size });
const viewStateService = createViewStateService();
const authUiRef = { current: null };
const authService = createAuthService({
  supabaseClient: supabaseService.client,
  getActiveProject: () => appState.obra.ativa,
  onStateChange: (details) => authUiRef.current?.handleAuthServiceStateChanged(details),
  reportError: (context, error) => logger.warn(context, error),
});
const authUi = createAuthUi({
  authService,
  modalService,
  toast: (...args) => feedbackService.toast(...args),
  requestConfirmation: (...args) => modalService.confirm(...args),
  getActiveProject: () => appState.obra.ativa,
  renderProtectedViews: () => {
    ui.flows?.renderFlows();
    if (document.getElementById('projCtrlMovsList')) ui.projectionControl?.renderProjCtrl();
    ui.uploads?.renderUploadsCentral();
  },
  clearMassSelection: () => ui.flowEditor?.clearMassSelection(),
  applyProjectionLocks: () => ui.projectionControl?.applyLocksToUI(),
  reportError: (context, error) => logger.warn(context, error),
});
authUiRef.current = authUi;
actionRegistry.register(createAuthUiActions(authUi));
const uploadRepository = createUploadRepository({
  getClient: () => supabaseService.client,
  getActiveProject: () => appState.obra.ativa,
  getCurrentUser: () => authService.state.user,
  isEditor: () => authService.canEditActiveProject(),
  isAdmin: () => authService.isAdmin(),
  canManageKind: (kind) =>
    isGlobalUploadKind(kind) ? authService.isAdmin() : authService.canEditActiveProject(),
  requirePermission: (kind, description) => authUi.requireUploadPermission(kind, description),
  retry: (operation) => supabaseService.retry(operation),
  maxPerType: DASHBOARD_CONFIG.max_uploads_por_tipo,
  onMutation: (error, context) => syncStatusService.recordMutation(error, context),
  warn: (context, error) => logger.warn(context, error),
});
const excelService = createExcelService();
const dashboardExportService = createDashboardExportService({
  ensureXlsx,
  getState: () => ({
    tendency: appState.dados.tendencia,
    flows: dashboardRuntime.getActiveFlows(),
    projectionControl: ui.projectionControl?.getState() || {},
    activeProject: appState.obra.ativa || '',
    project: projectController?.getProjectInfo(appState.obra.ativa) || null,
    auth: authService.state,
  }),
  toast: (...args) => feedbackService.toast(...args),
  reportError: (context, error) => logger.warn(context, error),
});
actionRegistry.register(createDashboardExportActions(dashboardExportService));
const dashboardRepository = createDashboardRepository({
  getClient: () => supabaseService.client,
  getActiveProject: () => appState.obra.ativa,
  getCurrentUser: () => authService.state.user,
  canEditActiveProject: () => authService.canEditActiveProject(),
  isAdmin: () => authService.isAdmin(),
  retry: (operation) => supabaseService.retry(operation),
  onMutation: (error) => syncStatusService.recordMutation(error, 'Dados'),
  warn: (context, error) => logger.warn(context, error),
});
const dashboardDatasetRepository = createDashboardDatasetRepository({
  getClient: () => supabaseService.client,
  getActiveProject: () => appState.obra.ativa,
  warn: (context, error) => logger.warn(context, error),
});
const dashboardRuntime = createDashboardRuntime({
  state: appState,
  config: DASHBOARD_CONFIG,
  syncStatus: syncStatusService,
  performanceMonitor: performanceService,
  ensureApexCharts,
  logger,
  toast: (...args) => feedbackService.toast(...args),
  populateFilters: () => ui.details?.populateFilters(),
  renderSourcesHeaders: () => ui.uploads?.renderSourcesHeaders(),
  renderers: {
    overview: () => ui.overview?.renderVisao(),
    flows: () => ui.flows?.renderFlows(),
    details: () => ui.details?.renderTable(),
    history: () => ui.history?.renderHistorico(),
    projection: () => ui.projection?.renderProjecao(),
    initializeProjection: () => ui.projection?.initProjecao(),
    projectionControl: () => ui.projectionControl?.initProjCtrl(),
    uploads: () => ui.uploads?.renderUploadsCentral(),
  },
});
const parserService = createImportParserService({
  state: appState,
  config: DASHBOARD_CONFIG,
  monitor: performanceService,
  canEdit: () => authService.canEditActiveProject(),
  storage: storageService,
  saveDashboardKey: (...args) => dashboardRepository.saveDashboardKey(...args),
  reportError: (...args) => dashboardRuntime.reportNonFatalError(...args),
});
const projectRepository = createProjectRepository({
  getClient: () => supabaseService.client,
  warn: (context, error) => logger.warn(context, error),
});
const projectController = createProjectController({
  state: appState,
  projectRepository,
  dashboardRepository,
  dashboardDatasetRepository,
  uploadRepository,
  storage: storageService,
  storageKeys: {
    activeProject: STORAGE_KEYS.activeProject,
    classifications: STORAGE_KEYS.classifications,
    manuals: STORAGE_KEYS.manuals,
    projectionControl: STORAGE_KEYS.projectionControl,
    header: STORAGE_KEYS.header,
    correctionIndex: STORAGE_KEYS.correctionIndex,
    cardMode: STORAGE_KEYS.cardMode,
  },
  hasBackend: () => Boolean(supabaseService.client),
  getUploadRuntimeState: () => uploadCoordinator.runtimeState,
  updateAuthUi: () => authUi.updateAuthUI(),
  showLoading: () => feedbackService.showLoading(),
  hideLoading: () => feedbackService.hideLoading(),
  toast: (...args) => feedbackService.toast(...args),
  renderAll: () => dashboardRuntime.renderAll(),
  applyManuals: () => ui.flowEditor?.applyManuals(),
  loadClassifications: () => ui.flowEditor?.loadClassifications(),
  buildInputList: () => ui.flowEditor?.buildInsumosList() || [],
  setInputOptions: (options) => ui.flowEditor?.setInputOptions(options),
  buildDatalist: () => ui.flowEditor?.buildDatalist(),
  loadProjectionControl: () => ui.projectionControl?.loadProjCtrl(),
  getProjectionControlState: () => ui.projectionControl?.getState(),
  applyProjectionLocks: () => ui.projectionControl?.applyLocksToUI(),
  formatValue: (value) => formatNumber(value),
  reportError: (...args) => dashboardRuntime.reportNonFatalError(...args),
});
actionRegistry.register(createProjectActions(projectController));
const uploadCoordinator = createUploadCoordinator({
  getClient: () => supabaseService.client,
  getActiveProject: () => appState.obra.ativa,
  getDashboardData: () => ({
    tendency: appState.dados.tendencia,
    flows: appState.dados.flows,
    history: appState.dados.historico,
    projectionRaw: appState.dados.projRaw,
    managementLabel: appState.config.gestaoLabel,
    evolution: appState.config.evolGlobal,
    latestUploads: appState.uploads,
  }),
  restoreDashboardData: (snapshot) => {
    appState.dados.tendencia = snapshot.tendency;
    appState.dados.flows = snapshot.flows;
    appState.dados.historico = snapshot.history;
    appState.dados.projRaw = snapshot.projectionRaw;
    appState.config.gestaoLabel = snapshot.managementLabel;
    appState.config.evolGlobal = snapshot.evolution;
  },
  getInputOptions: () => ui.flowEditor?.getInputOptions() || [],
  setInputOptions: (options) => ui.flowEditor?.setInputOptions(options),
  canEditActiveProject: () => authService.canEditActiveProject(),
  isAdmin: () => authService.isAdmin(),
  isGlobalKind: (kind) => isGlobalUploadKind(kind),
  dataKeys: DASHBOARD_DATA_KEYS,
  dashboardDatasetRepository,
  uploadRepository,
  executeTransaction: executeUploadTransaction,
  setProjectSelectorDisabled: (disabled) => {
    const selector = document.getElementById('obraSelector');
    if (selector) selector.disabled = disabled;
  },
  rebuildInputList: () => ui.flowEditor?.buildDatalist(),
  markSyncError: (error) => syncStatusService.markError(error),
  markSynced: () => syncStatusService.markSynced(),
  reportCleanupError: (context, error) => logger.warn(context, error),
});
const dashboardShell = createDashboardShell({
  getManagementLabel: () => appState.config.gestaoLabel,
  getHeaderEditable: () => appState.config.headerEditable === true,
  setHeaderEditable: (value) => {
    appState.config.headerEditable = value;
  },
  authorizeAdmin: () => authUi.requireAdmin('acessar esta função administrativa'),
  isAdmin: () => authService.isAdmin(),
  renderTab: (tabName) => dashboardRuntime.renderTab(tabName),
  renderAdmin: () => {
    ui.admin?.renderPendentesAdmin();
    ui.admin?.renderObrasAdmin();
    ui.admin?.renderEditoresAdmin();
  },
  saveHeaderTitle: (title) => {
    void dashboardRuntime.runAsyncSafely(
      dashboardRepository.saveDashboardKey('header_title', title),
      'Config/salvar título',
      'O título foi salvo apenas neste navegador.',
    );
  },
  reportError: (context, error) => logger.warn(context, error),
});
actionRegistry.register(createDashboardShellActions(dashboardShell));

Promise.resolve()
  .then(async () => {
    const [
      { createFlowEditor },
      { createUploadView },
      { createAdminView },
      { createDetailsView },
      { createFlowsView },
      { createHistoryView },
      { createOverviewView },
      { createProjectionView },
      { createProjectionControlView },
    ] = await Promise.all([
      import('./ui/flow-editor.mjs'),
      import('./ui/uploads.mjs'),
      import('./ui/views/admin.mjs'),
      import('./ui/views/details.mjs'),
      import('./ui/views/flows.mjs'),
      import('./ui/views/history.mjs'),
      import('./ui/views/overview.mjs'),
      import('./ui/views/projection.mjs'),
      import('./ui/views/projection-control.mjs'),
    ]);
    ui.flowEditor = createFlowEditor({
      runtime: dashboardRuntime,
      storage: storageService,
      feedback: feedbackService,
      modals: modalService,
      dashboardRepository,
      authService,
      authUi,
      supabaseClient: supabaseService.client,
      state: appState,
      views: {
        renderFlowTable: (...args) => ui.flows?.renderFlowTable(...args),
        renderFlows: (...args) => ui.flows?.renderFlows(...args),
      },
    });
    actionRegistry.register(ui.flowEditor);
    ui.uploads = createUploadView({
      runtime: dashboardRuntime,
      excel: excelService,
      validateUpload: validateUploadFile,
      feedback: feedbackService,
      modals: modalService,
      uploadRepository,
      uploadCoordinator,
      authService,
      authUi,
      supabaseClient: supabaseService.client,
      state: appState,
      parsers: parserService,
      projectController,
      flowEditor: ui.flowEditor,
    });
    actionRegistry.register(ui.uploads);
    ui.admin = createAdminView({
      runtime: dashboardRuntime,
      storage: storageService,
      projectController,
      feedback: feedbackService,
      modals: modalService,
      uploadRepository,
      authService,
      authUi,
      supabaseClient: supabaseService.client,
      state: appState,
    });
    actionRegistry.register(ui.admin);
    ui.details = createDetailsView({
      runtime: dashboardRuntime,
      pagination: paginationService,
      viewStates: viewStateService,
      modals: modalService,
      state: appState,
      overview: { hasTendency: (...args) => ui.overview?.obraTemTendencia(...args) },
    });
    actionRegistry.register(ui.details);
    ui.flows = createFlowsView({
      runtime: dashboardRuntime,
      pagination: paginationService,
      storage: storageService,
      viewStates: viewStateService,
      dashboardRepository,
      authService,
      authUi,
      state: appState,
      flowEditor: ui.flowEditor,
    });
    actionRegistry.register(ui.flows);
    ui.history = createHistoryView({
      runtime: dashboardRuntime,
      pagination: paginationService,
      viewStates: viewStateService,
      state: appState,
    });
    actionRegistry.register(ui.history);
    ui.projectionControl = createProjectionControlView({
      runtime: dashboardRuntime,
      storage: storageService,
      feedback: feedbackService,
      modals: modalService,
      viewStates: viewStateService,
      dashboardRepository,
      authService,
      authUi,
      supabaseClient: supabaseService.client,
      state: appState,
      flowEditor: ui.flowEditor,
    });
    actionRegistry.register(ui.projectionControl);
    ui.projection = createProjectionView({
      runtime: dashboardRuntime,
      loadXlsx: ensureXlsx,
      feedback: feedbackService,
      modals: modalService,
      viewStates: viewStateService,
      state: appState,
      overview: {
        renderAderenciaProj: (...args) => ui.overview?.renderAderenciaProj(...args),
        renderVisao: (...args) => ui.overview?.renderVisao(...args),
      },
      projectController,
      projectionControl: ui.projectionControl,
    });
    actionRegistry.register(ui.projection);
    ui.overview = createOverviewView({
      runtime: dashboardRuntime,
      storage: storageService,
      viewStates: viewStateService,
      dashboardRepository,
      authService,
      state: appState,
      shell: dashboardShell,
      projection: ui.projection,
      projectionControl: ui.projectionControl,
    });
    actionRegistry.register(ui.overview);

    const uploadMaintenance = createUploadMaintenance({
      dashboardRepository,
      uploadRepository,
      getActiveProject: () => appState.obra.ativa,
      getProjectInfo: (project) => projectController.getProjectInfo(project),
      requireEditor: (description) => authUi.requireEditor(description),
      requireAdmin: (description) => authUi.requireAdmin(description),
      isAdmin: () => authService.isAdmin(),
      requestConfirmation: (...args) => modalService.confirm(...args),
      toast: (...args) => feedbackService.toast(...args),
      clearLocalEvolution: () => {
        storageService.remove(STORAGE_KEYS.evolution);
      },
      clearLatestUploads: () => {
        for (const kind of Object.keys(appState.uploads)) appState.uploads[kind] = null;
      },
      renderUploads: () => ui.uploads.renderUploadsCentral(),
      renderSourceHeaders: () => ui.uploads.renderSourcesHeaders(),
      reload: () => window.location.reload(),
      reportError: (context, error) => logger.warn(context, error),
    });
    actionRegistry.register(uploadMaintenance);
    installActionDelegation({
      actions: actionRegistry,
      reportError: (...args) => dashboardRuntime.reportNonFatalError(...args),
    });
    const application = createApplication({
      state: appState,
      projectController,
      authService,
      uploadRepository,
      dashboardRuntime,
      dashboardShell,
      storage: storageService,
      storageKeys: STORAGE_KEYS,
      syncStatus: syncStatusService,
      performanceMonitor: performanceService,
      hasBackend: () => Boolean(supabaseService.client),
      buildInputList: () => ui.flowEditor.buildInsumosList(),
      setInputOptions: (options) => ui.flowEditor.setInputOptions(options),
      buildDatalist: () => ui.flowEditor.buildDatalist(),
      applyManuals: () => ui.flowEditor.applyManuals(),
      loadClassifications: () => ui.flowEditor.loadClassifications(),
      updateEditCount: () => ui.flowEditor.updateEditCount(),
      restoreFilters: () => ui.details.restaurarFiltros(),
      toast: (...args) => feedbackService.toast(...args),
      reportError: (...args) => dashboardRuntime.reportNonFatalError(...args),
    });
    window.dashboardServices = Object.freeze({
      application,
      state: appState,
      config: Object.freeze({
        dashboard: DASHBOARD_CONFIG,
        storageKeys: STORAGE_KEYS,
        supabaseUrl: SUPABASE_CONFIG.url,
      }),
      actions: actionRegistry,
      supabase: supabaseService,
      auth: authService,
      authUi,
      parsers: parserService,
      feedback: feedbackService,
      modals: modalService,
      pagination: paginationService,
      viewStates: viewStateService,
      views: Object.freeze({ ...ui }),
      performance: performanceService,
      dependencies: Object.freeze({ ensureXlsx, ensureApexCharts }),
      excel: excelService,
      exports: dashboardExportService,
      dashboardRepository,
      dashboardDatasetRepository,
      runtime: dashboardRuntime,
      projectRepository,
      projectController,
      storage: storageService,
      shell: dashboardShell,
      logger,
      syncStatus: syncStatusService,
      uploadPolicy: Object.freeze({ validate: validateUploadFile }),
      uploadRepository,
      uploadCoordinator,
      uploadMaintenance,
      uploadTransactions: Object.freeze({ execute: executeUploadTransaction }),
    });
    await application.start();
  })
  .catch(showBootstrapError);
