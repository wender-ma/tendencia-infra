import { createApplication } from './application.mjs';
import { DASHBOARD_CONFIG, installLegacyConfig, STORAGE_KEYS, SUPABASE_CONFIG } from './config.js';
import { installLegacyProjectionCatalog } from './data/projection-catalog.mjs';
import { installLegacyImportParsers } from './parsers/index.mjs';
import { createPerformanceMonitor, installPerformanceMonitor } from './performance.mjs';
import { createFeedbackService, installLegacyFeedbackGlobals } from './ui/feedback.mjs';
import { createModalService, installLegacyModalGlobals } from './ui/modals.mjs';
import { installActionDelegation } from './ui/actions.mjs';
import { createAuthUi, installLegacyAuthUi } from './ui/auth-ui.mjs';
import { installLegacyDomGlobals } from './ui/dom.mjs';
import { createDashboardShell, installLegacyDashboardShell } from './ui/shell.mjs';
import {
  createDashboardRuntime,
  formatNumber,
  installLegacyDashboardRuntime,
} from './ui/dashboard-runtime.mjs';
import {
  createProjectController,
  installLegacyProjectController,
} from './ui/project-controller.mjs';
import {
  createUploadMaintenance,
  installLegacyUploadMaintenance,
} from './ui/upload-maintenance.mjs';
import { createPaginationService, installLegacyPaginationGlobals } from './ui/pagination.mjs';
import { createViewStateService, installLegacyViewStateGlobals } from './ui/view-states.mjs';
import { mountStaticViews } from './ui/static-views.mjs';
import { createAppState, installLegacyStateGlobals } from './state.js';
import {
  createSupabaseService,
  installLegacySupabaseGlobals,
} from './services/supabase-service.js';
import { createAuthService, installLegacyAuthGlobals } from './services/auth-service.js';
import {
  createDashboardExportService,
  installLegacyDashboardExports,
} from './services/dashboard-export.mjs';
import {
  createDashboardRepository,
  DASHBOARD_DATA_KEYS,
  installLegacyDashboardRepository,
} from './services/dashboard-repository.mjs';
import {
  ensureApexCharts,
  ensureXlsx,
  installLegacyDependencyGlobals,
} from './services/dependency-service.mjs';
import { createExcelService, installLegacyExcelGlobals } from './services/excel-service.mjs';
import { createLogger, installLogger } from './services/logger.mjs';
import { createProjectRepository } from './services/project-repository.mjs';
import { createSafeStorage, installLegacySafeStorage } from './services/storage-service.mjs';
import { createSyncStatusService, installLegacySyncStatus } from './services/sync-status.mjs';
import { installLegacyUploadPolicy, validateUploadFile } from './services/upload-policy.mjs';
import {
  createUploadCoordinator,
  installLegacyUploadCoordinator,
} from './services/upload-coordinator.mjs';
import {
  createUploadRepository,
  installLegacyUploadRepository,
} from './services/upload-repository.mjs';
import {
  executeUploadTransaction,
  installLegacyUploadTransaction,
} from './services/upload-transaction.mjs';

function showBootstrapError(error) {
  window.dashboardLogger?.error('Boot/carregar dashboard', error);

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
installLegacyDomGlobals();
installLegacyConfig();
installLegacyProjectionCatalog();
const logger = createLogger();
installLogger(logger);
const syncStatusService = createSyncStatusService({
  isOnline: () => Boolean(window.SUPA),
});
installLegacySyncStatus(syncStatusService);
const appState = createAppState();
installLegacyStateGlobals(appState);
const performanceService = createPerformanceMonitor();
installPerformanceMonitor(performanceService);
const parserService = installLegacyImportParsers({
  state: appState,
  config: DASHBOARD_CONFIG,
  monitor: performanceService,
});
const feedbackService = createFeedbackService();
installLegacyFeedbackGlobals(feedbackService);
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
installLegacySafeStorage(storageService);
const modalService = createModalService();
installLegacyModalGlobals(modalService);
const paginationService = createPaginationService({ pageSize: DASHBOARD_CONFIG.table_page_size });
installLegacyPaginationGlobals(paginationService);
const viewStateService = createViewStateService();
installLegacyViewStateGlobals(viewStateService);
installLegacyDependencyGlobals();
installLegacyUploadPolicy();
installLegacyUploadTransaction();
const uploadRepository = createUploadRepository({
  getClient: () => window.SUPA,
  getActiveProject: () => window.OBRA_ATIVA,
  getCurrentUser: () => window.AUTH?.user,
  isEditor: () => window.isEditorDaObraAtiva?.() === true,
  isAdmin: () => window.isAdminGeral?.() === true,
  canManageKind: (kind) =>
    window.isGlobalUploadKind?.(kind)
      ? window.isAdminGeral?.() === true
      : window.isEditorDaObraAtiva?.() === true,
  requirePermission: (kind, description) =>
    window.requireUploadPermission?.(kind, description) === true,
  retry: (operation) => window.supaRetry(operation),
  maxPerType: DASHBOARD_CONFIG.max_uploads_por_tipo,
  onMutation: (error, context) => window.handleUploadRepositoryMutation?.(error, context),
  warn: (context, error) => logger.warn(context, error),
});
installLegacyUploadRepository(uploadRepository);
const excelService = createExcelService();
installLegacyExcelGlobals(excelService);
const dashboardExportService = createDashboardExportService({
  ensureXlsx,
  getState: () => ({
    tendency: window.DATA_T || [],
    flows: dashboardRuntime.getActiveFlows(),
    projectionControl: window.PROJ_CTRL_STATE || {},
    activeProject: window.OBRA_ATIVA || '',
    project: window.getObraInfo?.(window.OBRA_ATIVA) || null,
    auth: window.AUTH || {},
  }),
  toast: (...args) => window.authToast?.(...args),
  reportError: (context, error) => logger.warn(context, error),
});
installLegacyDashboardExports(dashboardExportService);
const dashboardRepository = createDashboardRepository({
  getClient: () => window.SUPA,
  getActiveProject: () => window.OBRA_ATIVA,
  getCurrentUser: () => window.AUTH?.user,
  canEditActiveProject: () => window.isEditorDaObraAtiva?.() === true,
  isAdmin: () => window.isAdminGeral?.() === true,
  retry: (operation) => window.supaRetry(operation),
  onMutation: (error) => window.handleUploadRepositoryMutation?.(error, 'Dados'),
  warn: (context, error) => logger.warn(context, error),
});
installLegacyDashboardRepository(dashboardRepository);
const dashboardRuntime = createDashboardRuntime({
  state: appState,
  config: DASHBOARD_CONFIG,
  syncStatus: syncStatusService,
  performanceMonitor: performanceService,
  ensureApexCharts,
  logger,
  toast: (...args) => feedbackService.toast(...args),
  populateFilters: () => window.populateFilters?.(),
  renderSourcesHeaders: () => window.renderSourcesHeaders?.(),
  renderers: {
    overview: () => window.renderVisao?.(),
    flows: () => window.renderFlows?.(),
    details: () => window.renderTable?.(),
    history: () => window.renderHistorico?.(),
    projection: () => window.renderProjecao?.(),
    initializeProjection: () => window.initProjecao?.(),
    projectionControl: () => window.initProjCtrl?.(),
    uploads: () => window.renderUploadsCentral?.(),
  },
});
installLegacyDashboardRuntime(dashboardRuntime);
const projectRepository = createProjectRepository({
  getClient: () => window.SUPA,
  warn: (context, error) => logger.warn(context, error),
});
const projectController = createProjectController({
  state: appState,
  projectRepository,
  dashboardRepository,
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
  hasBackend: () => Boolean(window.SUPA),
  getUploadRuntimeState: () => window.UPLOAD_RUNTIME_STATE || {},
  updateAuthUi: () => window.updateAuthUI?.(),
  showLoading: () => feedbackService.showLoading(),
  hideLoading: () => feedbackService.hideLoading(),
  toast: (...args) => feedbackService.toast(...args),
  renderAll: () => dashboardRuntime.renderAll(),
  applyManuals: () => window.applyManuals?.(),
  loadClassifications: () => window.loadClassifications?.(),
  buildInputList: () => window.buildInsumosList?.() || [],
  setInputOptions: (options) => {
    window.INSUMOS_OPTIONS = options;
  },
  buildDatalist: () => window.buildDatalist?.(),
  loadProjectionControl: () => window.loadProjCtrl?.(),
  getProjectionControlState: () => window.PROJ_CTRL_STATE,
  applyProjectionLocks: () => window.applyLocksToUI?.(),
  formatValue: (value) => formatNumber(value),
  reportError: (...args) => dashboardRuntime.reportNonFatalError(...args),
});
installLegacyProjectController(projectController);
const uploadCoordinator = createUploadCoordinator({
  getClient: () => window.SUPA,
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
  getInputOptions: () => window.INSUMOS_OPTIONS,
  setInputOptions: (options) => {
    window.INSUMOS_OPTIONS = options;
  },
  canEditActiveProject: () => window.isEditorDaObraAtiva?.() === true,
  isAdmin: () => window.isAdminGeral?.() === true,
  isGlobalKind: (kind) => window.isGlobalUploadKind?.(kind) === true,
  dataKeys: DASHBOARD_DATA_KEYS,
  uploadRepository,
  executeTransaction: executeUploadTransaction,
  setProjectSelectorDisabled: (disabled) => {
    const selector = document.getElementById('obraSelector');
    if (selector) selector.disabled = disabled;
  },
  rebuildInputList: () => window.buildDatalist?.(),
  markSyncError: (error) => syncStatusService.markError(error),
  markSynced: () => syncStatusService.markSynced(),
  reportCleanupError: (context, error) => logger.warn(context, error),
});
installLegacyUploadCoordinator(uploadCoordinator);
const dashboardShell = createDashboardShell({
  getManagementLabel: () => window.GESTAO_LABEL,
  getHeaderEditable: () => window._headerEditable === true,
  setHeaderEditable: (value) => {
    window._headerEditable = value;
  },
  authorizeAdmin: () => window.requireAdmin?.('acessar esta função administrativa') === true,
  isAdmin: () => window.isAdminGeral?.() === true,
  renderTab: (tabName) => dashboardRuntime.renderTab(tabName),
  renderAdmin: () => {
    window.renderPendentesAdmin?.();
    window.renderObrasAdmin?.();
    window.renderEditoresAdmin?.();
  },
  saveHeaderTitle: (title) => {
    if (!window.supaSaveDashboardKey) return;
    void dashboardRuntime.runAsyncSafely(
      window.supaSaveDashboardKey('header_title', title),
      'Config/salvar título',
      'O título foi salvo apenas neste navegador.',
    );
  },
  reportError: (context, error) => logger.warn(context, error),
});
installLegacyDashboardShell(dashboardShell);

Promise.resolve()
  .then(async () => {
    const [
      { installLegacyFlowEditor },
      { installLegacyUploadUI },
      { installLegacyAdminView },
      { installLegacyDetailsView },
      { installLegacyFlowsView },
      { installLegacyHistoryView },
      { installLegacyOverviewView },
      { installLegacyProjectionView },
      { installLegacyProjectionControlView },
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
    installLegacyFlowEditor();
    installLegacyUploadUI();
    installLegacyAdminView();
    installLegacyDetailsView();
    installLegacyFlowsView();
    installLegacyHistoryView();
    installLegacyOverviewView();
    installLegacyProjectionView();
    installLegacyProjectionControlView();

    const supabaseService = createSupabaseService(SUPABASE_CONFIG, {
      reportError: (context, error) => logger.warn(context, error),
    });
    installLegacySupabaseGlobals(supabaseService);
    const authService = createAuthService({
      supabaseClient: supabaseService.client,
      getActiveProject: () => appState.obra.ativa,
      onStateChange: (details) => window.handleAuthServiceStateChanged?.(details),
      reportError: (context, error) => logger.warn(context, error),
    });
    installLegacyAuthGlobals(authService);
    const authUi = createAuthUi({
      authService,
      modalService,
      toast: (...args) => feedbackService.toast(...args),
      requestConfirmation: (...args) => modalService.confirm(...args),
      getActiveProject: () => appState.obra.ativa,
      renderProtectedViews: () => {
        window.renderFlows?.();
        if (document.getElementById('projCtrlMovsList')) window.renderProjCtrl?.();
        window.renderUploadsCentral?.();
      },
      clearMassSelection: () => window.clearMassSelection?.(),
      applyProjectionLocks: () => window.applyLocksToUI?.(),
      reportError: (context, error) => logger.warn(context, error),
    });
    installLegacyAuthUi(authUi);
    const uploadMaintenance = createUploadMaintenance({
      dashboardRepository,
      uploadRepository,
      getActiveProject: () => appState.obra.ativa,
      getProjectInfo: (project) => window.getObraInfo?.(project),
      requireEditor: (description) => window.requireEditor?.(description) === true,
      requireAdmin: (description) => window.requireAdmin?.(description) === true,
      isAdmin: () => window.isAdminGeral?.() === true,
      requestConfirmation: (...args) => modalService.confirm(...args),
      toast: (...args) => feedbackService.toast(...args),
      clearLocalEvolution: () => {
        try {
          window.localStorage.removeItem('jzurique_evol_global');
        } catch (error) {
          logger.warn('Cache/remover evolução local', error);
        }
      },
      clearLatestUploads: () => {
        for (const kind of Object.keys(appState.uploads)) appState.uploads[kind] = null;
      },
      renderUploads: () => window.renderUploadsCentral?.(),
      renderSourceHeaders: () => window.renderSourcesHeaders?.(),
      reload: () => window.location.reload(),
      reportError: (context, error) => logger.warn(context, error),
    });
    installLegacyUploadMaintenance(uploadMaintenance);
    installActionDelegation();
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
      hasBackend: () => Boolean(window.SUPA),
      buildInputList: () => window.buildInsumosList?.() || [],
      setInputOptions: (options) => {
        window.INSUMOS_OPTIONS = options;
      },
      buildDatalist: () => window.buildDatalist?.(),
      applyManuals: () => window.applyManuals?.(),
      loadClassifications: () => window.loadClassifications?.() || 0,
      updateEditCount: () => window.updateEditCount?.(),
      restoreFilters: () => window.restaurarFiltros?.(),
      toast: (...args) => feedbackService.toast(...args),
      reportError: (...args) => dashboardRuntime.reportNonFatalError(...args),
    });
    window.dashboardServices = Object.freeze({
      application,
      supabase: supabaseService,
      auth: authService,
      authUi,
      parsers: parserService,
      feedback: feedbackService,
      modals: modalService,
      pagination: paginationService,
      viewStates: viewStateService,
      performance: performanceService,
      dependencies: Object.freeze({ ensureXlsx, ensureApexCharts }),
      excel: excelService,
      exports: dashboardExportService,
      dashboardRepository,
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
