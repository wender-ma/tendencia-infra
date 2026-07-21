const { expect, test } = require('@playwright/test');

test('carrega dependencias locais e inicia o dashboard', async ({ page }) => {
  const pageErrors = [];
  const failedLocalAssets = [];

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.hostname === '127.0.0.1' && response.status() >= 400) {
      failedLocalAssets.push(`${response.status()} ${url.pathname}`);
    }
  });

  await page.route('https://*.supabase.co/**', route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => (
    typeof window.supabase?.createClient === 'function'
    && typeof window.XLSX?.read === 'function'
    && typeof window.ApexCharts === 'function'
    && typeof window.handleAuthClick === 'function'
    && window.AppState === window.dashboardState
    && window.AUTH?.ready === true
  ));

  const runtime = await page.evaluate(async () => {
    const authService = window.dashboardServices.auth;
    const parserService = window.dashboardServices.parsers;
    const feedbackService = window.dashboardServices.feedback;
    const modalService = window.dashboardServices.modals;
    const authStartsReadOnly = !window.isAdminGeral() && !window.isEditorDaObraAtiva();
    const admin = authService.resolvePermissions([
      { role: 'admin', status: 'active', codigo_obra: null },
    ]);
    const editor = authService.resolvePermissions([
      { role: 'editor', status: 'active', codigo_obra: 'OBRA-A' },
      { role: 'editor', status: 'rejected', codigo_obra: 'OBRA-B' },
    ]);
    const rejected = authService.resolvePermissions([
      { role: 'editor', status: 'rejected', codigo_obra: 'OBRA-A' },
    ]);
    const originalTendency = window.DATA_T;
    const tendencyMarker = [{ stateContract: true }];
    window.DATA_T = tendencyMarker;
    const aliasWritesState = window.AppState.dados.tendencia === tendencyMarker;
    window.AppState.dados.tendencia = originalTendency;
    const stateWritesAlias = window.DATA_T === originalTendency;

    window.AUTH.isEditor = true;
    window.AUTH.isAdminGeral = false;
    window.AUTH.editaObras = ['STATE-OBRA'];
    window.OBRA_ATIVA = 'STATE-OBRA';
    const authReadsActiveProject = window.isEditorDaObraAtiva();
    feedbackService.toast('<img src=x onerror=alert(1)>', 'info', 1000);
    const toastUsesText = (
      document.getElementById('authToast')?.textContent === '<img src=x onerror=alert(1)>'
      && !document.querySelector('#authToast img')
    );
    feedbackService.showLoading();
    const loadingShown = document.getElementById('loadingOverlay')?.classList.contains('show');
    feedbackService.hideLoading();
    const loadingHidden = !document.getElementById('loadingOverlay')?.classList.contains('show');
    const confirmation = modalService.confirm('<img src=x>', '<img src=x onerror=alert(1)>', {
      destructive: false,
    });
    const confirmUsesText = (
      document.querySelector('#confirmModalContent h2')?.textContent === '<img src=x>'
      && !document.querySelector('#confirmModalContent img')
    );
    modalService.closeConfirm(false);
    const confirmResult = await confirmation;

    return {
      sheetJsVersion: window.XLSX.version,
      hasSupabase: typeof window.supabase.createClient === 'function',
      hasSupabaseService: window.dashboardServices?.supabase?.client === window.SUPA,
      hasAuthService: authService.state === window.AUTH,
      hasParserService: (
        typeof parserService?.parseTendencia === 'function'
        && parserService.parseNumber('1.234,56') === 1234.56
        && window.parseNumero === parserService.parseNumber
      ),
      hasFeedbackService: toastUsesText && loadingShown && loadingHidden,
      hasModalService: confirmUsesText && confirmResult === false,
      authStartsReadOnly,
      authorizationMatrix: {
        admin: admin.isAdminGeral && admin.isEditor && admin.role === 'admin',
        editor: editor.isEditor && editor.editaObras.join(',') === 'OBRA-A',
        rejected: !rejected.isEditor && !rejected.isAdminGeral,
      },
      stateContract: {
        singleton: window.AppState === window.dashboardState,
        aliasWritesState,
        stateWritesAlias,
        uploadsReference: window.LAST_UPLOADS === window.AppState.uploads,
        authReadsActiveProject,
      },
      hasExternalConfig: window.dashboardConfig?.dashboard === window.CONFIG,
      hasApexCharts: typeof window.ApexCharts === 'function',
      hasDashboardHandler: typeof window.handleAuthClick === 'function',
      status: document.getElementById('supaBadge')?.textContent,
    };
  });

  expect(runtime).toMatchObject({
    sheetJsVersion: '0.20.3',
    hasSupabase: true,
    hasSupabaseService: true,
    hasAuthService: true,
    hasParserService: true,
    hasFeedbackService: true,
    hasModalService: true,
    authStartsReadOnly: true,
    authorizationMatrix: { admin: true, editor: true, rejected: true },
    stateContract: {
      singleton: true,
      aliasWritesState: true,
      stateWritesAlias: true,
      uploadsReference: true,
      authReadsActiveProject: true,
    },
    hasExternalConfig: true,
    hasApexCharts: true,
    hasDashboardHandler: true,
  });
  expect(runtime.status).not.toBe('Falha ao iniciar');
  expect(pageErrors).toEqual([]);
  expect(failedLocalAssets).toEqual([]);
});
