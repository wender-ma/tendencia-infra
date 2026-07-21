import dashboardUrl from './dashboard-legacy.js?url';
import { installLegacyConfig, SUPABASE_CONFIG } from './config.js';
import { createAppState, installLegacyStateGlobals } from './state.js';
import {
  createSupabaseService,
  installLegacySupabaseGlobals,
} from './services/supabase-service.js';
import {
  createAuthService,
  installLegacyAuthGlobals,
} from './services/auth-service.js';

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

Promise.all([import('xlsx'), import('apexcharts')])
  .then(([xlsxModule, apexchartsModule]) => {
    const supabaseService = createSupabaseService(SUPABASE_CONFIG);
    installLegacySupabaseGlobals(supabaseService);
    const authService = createAuthService({
      supabaseClient: supabaseService.client,
      getActiveProject: () => appState.obra.ativa,
      onStateChange: details => window.handleAuthServiceStateChanged?.(details),
      reportError: (context, error) => window.reportNonFatalError?.(context, error),
    });
    installLegacyAuthGlobals(authService);
    window.dashboardServices = Object.freeze({
      supabase: supabaseService,
      auth: authService,
    });
    window.XLSX = xlsxModule;
    window.ApexCharts = apexchartsModule.default;

    const dashboardScript = document.createElement('script');
    dashboardScript.src = dashboardUrl;
    dashboardScript.async = false;
    dashboardScript.addEventListener('error', showBootstrapError);
    document.body.appendChild(dashboardScript);
  })
  .catch(showBootstrapError);
