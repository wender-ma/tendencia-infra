import dashboardUrl from './dashboard-legacy.js?url';
import { DASHBOARD_CONFIG, installLegacyConfig, SUPABASE_CONFIG } from './config.js';
import { installLegacyProjectionCatalog } from './data/projection-catalog.mjs';
import { installLegacyImportParsers } from './parsers/index.mjs';
import { createPerformanceMonitor, installPerformanceMonitor } from './performance.mjs';
import { createFeedbackService, installLegacyFeedbackGlobals } from './ui/feedback.mjs';
import { createModalService, installLegacyModalGlobals } from './ui/modals.mjs';
import { installActionDelegation } from './ui/actions.mjs';
import { installLegacyDomGlobals } from './ui/dom.mjs';
import { installLegacyFlowEditor } from './ui/flow-editor.mjs';
import { createDashboardShell, installLegacyDashboardShell } from './ui/shell.mjs';
import { createPaginationService, installLegacyPaginationGlobals } from './ui/pagination.mjs';
import { createViewStateService, installLegacyViewStateGlobals } from './ui/view-states.mjs';
import { mountStaticViews } from './ui/static-views.mjs';
import { installLegacyUploadUI } from './ui/uploads.mjs';
import { installLegacyAdminView } from './ui/views/admin.mjs';
import { installLegacyDetailsView } from './ui/views/details.mjs';
import { installLegacyFlowsView } from './ui/views/flows.mjs';
import { installLegacyHistoryView } from './ui/views/history.mjs';
import { installLegacyOverviewView } from './ui/views/overview.mjs';
import { installLegacyProjectionView } from './ui/views/projection.mjs';
import { installLegacyProjectionControlView } from './ui/views/projection-control.mjs';
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
  installLegacyDashboardRepository,
} from './services/dashboard-repository.mjs';
import {
  ensureApexCharts,
  ensureXlsx,
  installLegacyDependencyGlobals,
} from './services/dependency-service.mjs';
import { createExcelService, installLegacyExcelGlobals } from './services/excel-service.mjs';
import { createLogger, installLogger } from './services/logger.mjs';
import { installLegacyUploadPolicy, validateUploadFile } from './services/upload-policy.mjs';
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
installLegacyFlowEditor();
installLegacyUploadUI();
installLegacyAdminView();
installLegacyDetailsView();
installLegacyFlowsView();
installLegacyHistoryView();
installLegacyOverviewView();
installLegacyProjectionView();
installLegacyProjectionControlView();
installActionDelegation();
const excelService = createExcelService();
installLegacyExcelGlobals(excelService);
const dashboardExportService = createDashboardExportService({
  ensureXlsx,
  getState: () => ({
    tendency: window.DATA_T || [],
    flows: window.getFlowsObraAtiva?.() || [],
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
const dashboardShell = createDashboardShell({
  getManagementLabel: () => window.GESTAO_LABEL,
  getHeaderEditable: () => window._headerEditable === true,
  setHeaderEditable: (value) => {
    window._headerEditable = value;
  },
  authorizeAdmin: () => window.requireAdmin?.('acessar esta função administrativa') === true,
  isAdmin: () => window.isAdminGeral?.() === true,
  renderTab: (tabName) => window.renderTab?.(tabName),
  renderAdmin: () => {
    window.renderPendentesAdmin?.();
    window.renderObrasAdmin?.();
    window.renderEditoresAdmin?.();
  },
  saveHeaderTitle: (title) => {
    if (!window.supaSaveDashboardKey || !window.runAsyncSafely) return;
    void window.runAsyncSafely(
      window.supaSaveDashboardKey('header_title', title),
      'Config/salvar título',
      'O título foi salvo apenas neste navegador.',
    );
  },
  reportError: (context, error) => logger.warn(context, error),
});
installLegacyDashboardShell(dashboardShell);

Promise.resolve()
  .then(() => {
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
    window.dashboardServices = Object.freeze({
      supabase: supabaseService,
      auth: authService,
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
      shell: dashboardShell,
      logger,
      uploadPolicy: Object.freeze({ validate: validateUploadFile }),
      uploadRepository,
      uploadTransactions: Object.freeze({ execute: executeUploadTransaction }),
    });

    const dashboardScript = document.createElement('script');
    dashboardScript.src = dashboardUrl;
    dashboardScript.async = false;
    dashboardScript.addEventListener('error', showBootstrapError);
    document.body.appendChild(dashboardScript);
  })
  .catch(showBootstrapError);
