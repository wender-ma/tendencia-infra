import dashboardUrl from './dashboard-legacy.js?url';
import { DASHBOARD_CONFIG, installLegacyConfig, SUPABASE_CONFIG } from './config.js';
import { installLegacyImportParsers } from './parsers/index.mjs';
import { createPerformanceMonitor, installPerformanceMonitor } from './performance.mjs';
import { createFeedbackService, installLegacyFeedbackGlobals } from './ui/feedback.mjs';
import { createModalService, installLegacyModalGlobals } from './ui/modals.mjs';
import { installActionDelegation } from './ui/actions.mjs';
import { createAppState, installLegacyStateGlobals } from './state.js';
import {
  createSupabaseService,
  installLegacySupabaseGlobals,
} from './services/supabase-service.js';
import { createAuthService, installLegacyAuthGlobals } from './services/auth-service.js';
import {
  ensureApexCharts,
  ensureXlsx,
  installLegacyDependencyGlobals,
} from './services/dependency-service.mjs';
import { createExcelService, installLegacyExcelGlobals } from './services/excel-service.mjs';

function showBootstrapError(error) {
  console.error('[BOOT] Falha ao carregar o dashboard:', error);

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

installLegacyConfig();
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
installLegacyDependencyGlobals();
installActionDelegation();
const excelService = createExcelService();
installLegacyExcelGlobals(excelService);

ensureApexCharts()
  .then(() => {
    const supabaseService = createSupabaseService(SUPABASE_CONFIG);
    installLegacySupabaseGlobals(supabaseService);
    const authService = createAuthService({
      supabaseClient: supabaseService.client,
      getActiveProject: () => appState.obra.ativa,
      onStateChange: (details) => window.handleAuthServiceStateChanged?.(details),
      reportError: (context, error) => window.reportNonFatalError?.(context, error),
    });
    installLegacyAuthGlobals(authService);
    window.dashboardServices = Object.freeze({
      supabase: supabaseService,
      auth: authService,
      parsers: parserService,
      feedback: feedbackService,
      modals: modalService,
      performance: performanceService,
      dependencies: Object.freeze({ ensureXlsx, ensureApexCharts }),
      excel: excelService,
    });

    const dashboardScript = document.createElement('script');
    dashboardScript.src = dashboardUrl;
    dashboardScript.async = false;
    dashboardScript.addEventListener('error', showBootstrapError);
    document.body.appendChild(dashboardScript);
  })
  .catch(showBootstrapError);
