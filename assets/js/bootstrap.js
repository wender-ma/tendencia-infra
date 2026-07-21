import dashboardUrl from './dashboard-legacy.js?url';

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

Promise.all([
  import('@supabase/supabase-js'),
  import('xlsx'),
  import('apexcharts'),
])
  .then(([supabaseModule, xlsxModule, apexchartsModule]) => {
    window.supabase = Object.freeze({ createClient: supabaseModule.createClient });
    window.XLSX = xlsxModule;
    window.ApexCharts = apexchartsModule.default;

    const dashboardScript = document.createElement('script');
    dashboardScript.src = dashboardUrl;
    dashboardScript.async = false;
    dashboardScript.addEventListener('error', showBootstrapError);
    document.body.appendChild(dashboardScript);
  })
  .catch(showBootstrapError);
