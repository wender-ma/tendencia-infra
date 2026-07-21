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

  const runtime = await page.evaluate(() => {
    const authService = window.dashboardServices.auth;
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

    return {
      sheetJsVersion: window.XLSX.version,
      hasSupabase: typeof window.supabase.createClient === 'function',
      hasSupabaseService: window.dashboardServices?.supabase?.client === window.SUPA,
      hasAuthService: authService.state === window.AUTH,
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
