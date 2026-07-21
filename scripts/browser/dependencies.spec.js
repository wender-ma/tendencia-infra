const { expect, test } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

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
    && typeof window.ensureXlsx === 'function'
    && typeof window.ApexCharts === 'function'
    && typeof window.handleAuthClick === 'function'
    && window.AppState === window.dashboardState
    && window.AUTH?.ready === true
    && window.dashboardPerformance?.snapshot().boot.completed === true
  ));

  const runtime = await page.evaluate(async () => {
    const authService = window.dashboardServices.auth;
    const parserService = window.dashboardServices.parsers;
    const feedbackService = window.dashboardServices.feedback;
    const modalService = window.dashboardServices.modals;
    const performanceService = window.dashboardServices.performance;
    const loggerService = window.dashboardServices.logger;
    loggerService.clear();
    loggerService.warn('Browser/user@example.com', new Error('token eyJabc.def.ghi'));
    const loggerSnapshot = loggerService.snapshot();
    const loggerIsSanitized = (
      loggerSnapshot.length === 1
      && loggerSnapshot[0].context.includes('[email redacted]')
      && loggerSnapshot[0].error.message.includes('[token redacted]')
      && !JSON.stringify(loggerSnapshot).includes('user@example.com')
    );
    const xlsxLoadedAtBoot = performance.getEntriesByType('resource')
      .some(entry => /\/xlsx-[^/]+\.js(?:$|\?)/.test(entry.name));
    const xlsxModule = await window.ensureXlsx();
    const xlsxLoadedOnDemand = typeof xlsxModule.read === 'function' && window.XLSX === xlsxModule;
    const workerWorkbook = xlsxModule.utils.book_new();
    xlsxModule.utils.book_append_sheet(
      workerWorkbook,
      xlsxModule.utils.aoa_to_sheet([['codigo', 'valor'], ['A-1', 123]]),
      'Tendencia',
    );
    const workerResult = await window.dashboardServices.excel.parseBuffer(
      xlsxModule.write(workerWorkbook, { bookType: 'xlsx', type: 'array' }),
    );
    const excelWorkerParsed = (
      workerResult.sheetNames.join(',') === 'Tendencia'
      && workerResult.csvBySheet.Tendencia.includes('A-1;123')
    );
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
      xlsxLoadedAtBoot,
      xlsxLoadedOnDemand,
      excelWorkerParsed,
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
      hasPerformanceService: (
        performanceService === window.dashboardPerformance
        && performanceService.snapshot().boot.domNodes > 0
        && performanceService.snapshot().operations['render:visao']?.count >= 1
      ),
      hasLoggerService: loggerIsSanitized && window.dashboardLogger === loggerService,
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
    xlsxLoadedAtBoot: false,
    xlsxLoadedOnDemand: true,
    excelWorkerParsed: true,
    hasSupabase: true,
    hasSupabaseService: true,
    hasAuthService: true,
    hasParserService: true,
    hasFeedbackService: true,
    hasModalService: true,
    hasPerformanceService: true,
    hasLoggerService: true,
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

  const initialDarkMode = await page.locator('body').evaluate(body => body.classList.contains('dark'));
  await page.getByRole('button', { name: /modo claro|modo escuro/i }).click();
  await expect(page.locator('body')).toHaveClass(initialDarkMode ? /^(?!.*dark)/ : /dark/);
  await page.getByRole('button', { name: /modo claro|modo escuro/i }).click();

  await page.locator('#authBtn').click();
  await expect(page.locator('#loginModalBackdrop')).toHaveClass(/show/);
  await page.getByRole('button', { name: 'Fechar acesso ao dashboard' }).click();
  await expect(page.locator('#loginModalBackdrop')).not.toHaveClass(/show/);

  await page.getByRole('tab', { name: /Uploads/ }).click();
  await page.locator('#uploadsAdvancedToggle').click();
  await expect(page.locator('#uploadsAdvancedBody')).toHaveClass(/open/);

  await page.getByRole('tab', { name: /Flows \/ Aditivos/ }).click();
  await expect(page.locator('#tab-flows')).toHaveClass(/active/);
  await expect(page.locator('#tab-btn-flows')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#flowTbody')).toBeAttached();

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blockingViolations = accessibility.violations.filter(violation =>
    ['serious', 'critical'].includes(violation.impact),
  );
  expect(
    blockingViolations,
    blockingViolations.map(violation => `${violation.id}: ${violation.help}`).join('\n'),
  ).toEqual([]);
});
