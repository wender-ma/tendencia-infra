import { createApplication } from './application.mjs';
import { DASHBOARD_CONFIG, installLegacyConfig, STORAGE_KEYS, SUPABASE_CONFIG } from './config.js';
import { installLegacyProjectionCatalog } from './data/projection-catalog.mjs';
import { installLegacyImportParsers } from './parsers/index.mjs';
import { createPerformanceMonitor } from './performance.mjs';
import { createFeedbackService } from './ui/feedback.mjs';
import { createModalService } from './ui/modals.mjs';
import { createActionRegistry, installActionDelegation } from './ui/actions.mjs';
import { createAuthUi, installLegacyAuthUi } from './ui/auth-ui.mjs';
import { createDashboardShell, installLegacyDashboardShell } from './ui/shell.mjs';
import { createDashboardRuntime, formatNumber } from './ui/dashboard-runtime.mjs';
import {
  createProjectController,
  installLegacyProjectController,
} from './ui/project-controller.mjs';
import { createUploadMaintenance } from './ui/upload-maintenance.mjs';
import { createPaginationService } from './ui/pagination.mjs';
import { createViewStateService } from './ui/view-states.mjs';
import { mountStaticViews } from './ui/static-views.mjs';
import { createAppState, installLegacyStateGlobals } from './state.js';
import {
  createSupabaseService,
  installLegacySupabaseGlobals,
} from './services/supabase-service.js';
import { createAuthService, installLegacyAuthGlobals } from './services/auth-service.js';
import {
  createDashboardExportActions,
  createDashboardExportService,
} from './services/dashboard-export.mjs';
import {
  createDashboardRepository,
  DASHBOARD_DATA_KEYS,
} from './services/dashboard-repository.mjs';
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
installLegacyConfig();
installLegacyProjectionCatalog();
const logger = createLogger();
const actionRegistry = createActionRegistry();
actionRegistry.register({ print: () => window.print() });
const supabaseService = createSupabaseService(SUPABASE_CONFIG, {
  reportError: (context, error) => logger.warn(context, error),
});
installLegacySupabaseGlobals(supabaseService);
const syncStatusService = createSyncStatusService({
  isOnline: () => Boolean(supabaseService.client),
});
const appState = createAppState();
installLegacyStateGlobals(appState);
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
const uploadRepository = createUploadRepository({
  getClient: () => supabaseService.client,
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
  retry: (operation) => supabaseService.retry(operation),
  maxPerType: DASHBOARD_CONFIG.max_uploads_por_tipo,
  onMutation: (error, context) => syncStatusService.recordMutation(error, context),
  warn: (context, error) => logger.warn(context, error),
});
const excelService = createExcelService();
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
  toast: (...args) => feedbackService.toast(...args),
  reportError: (context, error) => logger.warn(context, error),
});
actionRegistry.register(createDashboardExportActions(dashboardExportService));
const dashboardRepository = createDashboardRepository({
  getClient: () => supabaseService.client,
  getActiveProject: () => window.OBRA_ATIVA,
  getCurrentUser: () => window.AUTH?.user,
  canEditActiveProject: () => window.isEditorDaObraAtiva?.() === true,
  isAdmin: () => window.isAdminGeral?.() === true,
  retry: (operation) => supabaseService.retry(operation),
  onMutation: (error) => syncStatusService.recordMutation(error, 'Dados'),
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
const parserService = installLegacyImportParsers({
  state: appState,
  config: DASHBOARD_CONFIG,
  monitor: performanceService,
  canEdit: () => window.isEditorDaObraAtiva?.() === true,
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
actionRegistry.register(installLegacyProjectController(projectController));
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
    void dashboardRuntime.runAsyncSafely(
      dashboardRepository.saveDashboardKey('header_title', title),
      'Config/salvar título',
      'O título foi salvo apenas neste navegador.',
    );
  },
  reportError: (context, error) => logger.warn(context, error),
});
actionRegistry.register(installLegacyDashboardShell(dashboardShell));

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
    actionRegistry.register(
      installLegacyFlowEditor({
        runtime: dashboardRuntime,
        storage: storageService,
        feedback: feedbackService,
        modals: modalService,
        dashboardRepository,
      }),
    );
    actionRegistry.register(
      installLegacyUploadUI({
        runtime: dashboardRuntime,
        excel: excelService,
        validateUpload: validateUploadFile,
        feedback: feedbackService,
        modals: modalService,
        uploadRepository,
        uploadCoordinator,
      }),
    );
    actionRegistry.register(
      installLegacyAdminView({
        runtime: dashboardRuntime,
        storage: storageService,
        projectController,
        feedback: feedbackService,
        modals: modalService,
        uploadRepository,
      }),
    );
    installLegacyDetailsView({
      runtime: dashboardRuntime,
      pagination: paginationService,
      viewStates: viewStateService,
      modals: modalService,
    });
    actionRegistry.register(
      installLegacyFlowsView({
        runtime: dashboardRuntime,
        pagination: paginationService,
        storage: storageService,
        viewStates: viewStateService,
        dashboardRepository,
      }),
    );
    installLegacyHistoryView({
      runtime: dashboardRuntime,
      pagination: paginationService,
      viewStates: viewStateService,
    });
    actionRegistry.register(
      installLegacyOverviewView({
        runtime: dashboardRuntime,
        storage: storageService,
        viewStates: viewStateService,
        dashboardRepository,
      }),
    );
    actionRegistry.register(
      installLegacyProjectionView({
        runtime: dashboardRuntime,
        loadXlsx: ensureXlsx,
        feedback: feedbackService,
        modals: modalService,
        viewStates: viewStateService,
      }),
    );
    actionRegistry.register(
      installLegacyProjectionControlView({
        runtime: dashboardRuntime,
        storage: storageService,
        feedback: feedbackService,
        modals: modalService,
        viewStates: viewStateService,
        dashboardRepository,
      }),
    );

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
    actionRegistry.register(installLegacyAuthUi(authUi));
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
      actions: actionRegistry,
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
