const { expect, test } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

test('carrega dependencias locais e inicia o dashboard', async ({ page }) => {
  const pageErrors = [];
  const failedLocalAssets = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.hostname === '127.0.0.1' && response.status() >= 400) {
      failedLocalAssets.push(`${response.status()} ${url.pathname}`);
    }
  });

  await page.route('https://*.supabase.co/**', (route) => route.abort());
  await page.goto('/');
  await page.waitForFunction(
    () =>
      typeof window.handleAuthClick === 'function' &&
      window.AppState === window.dashboardState &&
      window.AUTH?.ready === true &&
      window.dashboardPerformance?.snapshot().boot.completed === true,
  );

  const runtime = await page.evaluate(async () => {
    const authService = window.dashboardServices.auth;
    const parserService = window.dashboardServices.parsers;
    const feedbackService = window.dashboardServices.feedback;
    const modalService = window.dashboardServices.modals;
    const performanceService = window.dashboardServices.performance;
    const loggerService = window.dashboardServices.logger;
    const uploadPolicy = window.dashboardServices.uploadPolicy;
    const pagination = window.dashboardServices.pagination;
    const viewStates = window.dashboardServices.viewStates;
    const paginationHost = document.createElement('div');
    paginationHost.id = 'paginationBrowserTest';
    document.body.appendChild(paginationHost);
    const paginationRows = Array.from({ length: 205 }, (_, index) => index + 1);
    let paginationResult = pagination.paginate('browser-test', paginationRows, 'all');
    pagination.renderControls('paginationBrowserTest', 'browser-test', paginationResult, () => {});
    paginationHost.querySelector('[aria-label="Próxima página"]').click();
    paginationResult = pagination.paginate('browser-test', paginationRows, 'all');
    const paginationWorks =
      paginationResult.page === 2 &&
      paginationResult.items[0] === 101 &&
      paginationHost.textContent.includes('Página 1 de 3');
    paginationHost.remove();
    const stateHost = document.createElement('div');
    stateHost.id = 'viewStateBrowserTest';
    document.body.appendChild(stateHost);
    viewStates.render(stateHost, {
      kind: 'error',
      title: '<img src=x onerror=window.__stateXss=1>',
      message: '<script>window.__stateXss=2</script>',
    });
    const viewStateIsSafe = Boolean(
      stateHost.textContent.includes('<img src=x') &&
      !stateHost.querySelector('img, script') &&
      stateHost.querySelector('[role="alert"]'),
    );
    stateHost.remove();
    const uploadPolicyWorks =
      uploadPolicy.validate({ name: 'dados.csv', size: 100 }, 'csv').valid &&
      uploadPolicy.validate({ name: 'dados.exe', size: 100 }, 'excel').code === 'extension';
    loggerService.clear();
    loggerService.warn('Browser/user@example.com', new Error('token eyJabc.def.ghi'));
    const loggerSnapshot = loggerService.snapshot();
    const loggerIsSanitized =
      loggerSnapshot.length === 1 &&
      loggerSnapshot[0].context.includes('[email redacted]') &&
      loggerSnapshot[0].error.message.includes('[token redacted]') &&
      !JSON.stringify(loggerSnapshot).includes('user@example.com');
    const xlsxLoadedAtBoot = performance
      .getEntriesByType('resource')
      .some((entry) => /\/xlsx-[^/]+\.js(?:$|\?)/.test(entry.name));
    const apexLoadedAtBoot = performance
      .getEntriesByType('resource')
      .some((entry) => /\/apexcharts[^/]*\.js(?:$|\?)/.test(entry.name));
    const xlsxModule = await window.dashboardServices.dependencies.ensureXlsx();
    const xlsxLoadedOnDemand = typeof xlsxModule.read === 'function' && window.XLSX === xlsxModule;
    const apexCharts = await window.dashboardServices.dependencies.ensureApexCharts();
    const apexLoadedOnDemand = typeof apexCharts === 'function' && window.ApexCharts === apexCharts;
    const workerWorkbook = xlsxModule.utils.book_new();
    xlsxModule.utils.book_append_sheet(
      workerWorkbook,
      xlsxModule.utils.aoa_to_sheet([
        ['codigo', 'valor'],
        ['A-1', 123],
      ]),
      'Tendencia',
    );
    const workerResult = await window.dashboardServices.excel.parseBuffer(
      xlsxModule.write(workerWorkbook, { bookType: 'xlsx', type: 'array' }),
    );
    const excelWorkerParsed =
      workerResult.sheetNames.join(',') === 'Tendencia' &&
      workerResult.csvBySheet.Tendencia.includes('A-1;123');
    const authStartsReadOnly = !window.isAdminGeral() && !window.isEditorDaObraAtiva();
    let releaseSyncOperation;
    const pendingSyncOperation = window.dashboardServices.runtime.runAsyncSafely(
      new Promise((resolve) => {
        releaseSyncOperation = resolve;
      }),
      'Teste/sincronização',
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const syncSaving =
      document.getElementById('supaBadge')?.dataset.syncState === 'saving' &&
      window.getDashboardSyncStatus().pending === 1;
    releaseSyncOperation('ok');
    await pendingSyncOperation;
    const syncCompleted =
      document.getElementById('supaBadge')?.dataset.syncState === 'synced' &&
      window.getDashboardSyncStatus().pending === 0 &&
      window.getDashboardSyncStatus().lastSync;
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
    const maliciousPayloads = [
      '<script>window.__xss=1</script>',
      '<img src=x onerror=window.__xss=2>',
      '\"><svg onload=window.__xss=3>',
      'javascript:window.__xss=4',
    ];
    feedbackService.toast(maliciousPayloads.join('|'), 'info', 1000);
    const toastUsesText =
      document.getElementById('authToast')?.textContent === maliciousPayloads.join('|') &&
      !document.querySelector('#authToast :is(script, img, svg)');
    feedbackService.showLoading();
    const loadingShown = document.getElementById('loadingOverlay')?.classList.contains('show');
    feedbackService.hideLoading();
    const loadingHidden = !document.getElementById('loadingOverlay')?.classList.contains('show');
    const confirmation = modalService.confirm(maliciousPayloads[0], maliciousPayloads.join('|'), {
      destructive: false,
    });
    const confirmUsesText =
      document.querySelector('#confirmModalContent h2')?.textContent === maliciousPayloads[0] &&
      !document.querySelector('#confirmModalContent :is(script, img, svg)');
    const escapedPayloadsStayText = maliciousPayloads.every((payload) => {
      const probe = document.createElement('div');
      probe.innerHTML = `<span>${window.escHtml(payload)}</span>`;
      return probe.textContent === payload && !probe.querySelector('script, img, svg');
    });
    const dangerousStoragePathsRejected = [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '../fora.csv',
      'obra\\arquivo.csv',
      'obra\u0000arquivo.csv',
    ].every((path) => window.sanitizeStoragePath(path) === '');
    const validStoragePathAccepted =
      window.sanitizeStoragePath('/OBRA-1/tendencia/arquivo.csv') ===
      'OBRA-1/tendencia/arquivo.csv';
    modalService.closeConfirm(false);
    const confirmResult = await confirmation;

    return {
      sheetJsVersion: window.XLSX.version,
      xlsxLoadedAtBoot,
      xlsxLoadedOnDemand,
      apexLoadedAtBoot,
      apexLoadedOnDemand,
      excelWorkerParsed,
      hasSupabase: Boolean(window.dashboardServices?.supabase?.client),
      hasSupabaseService: window.dashboardServices?.supabase?.client === window.SUPA,
      hasAuthService: authService.state === window.AUTH,
      hasParserService:
        typeof parserService?.parseTendencia === 'function' &&
        parserService.parseNumber('1.234,56') === 1234.56 &&
        window.parseNumero === parserService.parseNumber,
      hasFeedbackService: toastUsesText && loadingShown && loadingHidden && escapedPayloadsStayText,
      hasModalService: confirmUsesText && confirmResult === false,
      storagePathSecurity: dangerousStoragePathsRejected && validStoragePathAccepted,
      hasPerformanceService:
        performanceService === window.dashboardPerformance &&
        performanceService.snapshot().boot.domNodes > 0 &&
        performanceService.snapshot().operations['render:visao']?.count >= 1,
      hasLoggerService: loggerIsSanitized && window.dashboardLogger === loggerService,
      hasUploadPolicy: uploadPolicyWorks,
      hasPagination: paginationWorks,
      hasViewStates: viewStateIsSafe,
      hasSyncFeedback: Boolean(syncSaving && syncCompleted),
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
      runtimeGlobalsRemoved: [
        'reportNonFatalError',
        'runAsyncSafely',
        'uiCriarKpi',
        'resolveColor',
        'renderApexChart',
        'filtrarPorObraAtiva',
        'getHistoricoObraAtiva',
        'getProjRawObraAtiva',
        'getFlowsObraAtiva',
        'buildLinks',
        'renderTab',
        'debouncedRender',
        'renderAll',
      ].every((name) => !Object.prototype.hasOwnProperty.call(window, name)),
      utilityGlobalsRemoved: [
        'SafeStorage',
        'paginateRows',
        'renderPaginationControls',
        'readExcelBuffer',
        'readExcelFile',
        'validateUploadFile',
        'executeUploadTransaction',
        'ensureXlsx',
        'ensureApexCharts',
        'supabase',
        'supaRetry',
        'AUTH_SERVICE',
        'checkEditorPermission',
        'applySession',
        'initAuth',
      ].every((name) => !Object.prototype.hasOwnProperty.call(window, name)),
      status: document.getElementById('supaBadge')?.textContent,
    };
  });

  expect(runtime).toMatchObject({
    sheetJsVersion: '0.20.3',
    xlsxLoadedAtBoot: false,
    xlsxLoadedOnDemand: true,
    apexLoadedAtBoot: false,
    apexLoadedOnDemand: true,
    excelWorkerParsed: true,
    hasSupabase: true,
    hasSupabaseService: true,
    hasAuthService: true,
    hasParserService: true,
    hasFeedbackService: true,
    hasModalService: true,
    storagePathSecurity: true,
    hasPerformanceService: true,
    hasLoggerService: true,
    hasUploadPolicy: true,
    hasPagination: true,
    hasViewStates: true,
    hasSyncFeedback: true,
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
    runtimeGlobalsRemoved: true,
    utilityGlobalsRemoved: true,
  });
  expect(runtime.status).not.toBe('Falha ao iniciar');
  expect(pageErrors).toEqual([]);
  expect(failedLocalAssets).toEqual([]);

  const initialTheme = await page.locator('body').evaluate((body) => ({
    dark: body.classList.contains('dark'),
    background: getComputedStyle(body).backgroundColor,
    accent: getComputedStyle(body).getPropertyValue('--accent-purple').trim(),
  }));
  await page.getByRole('button', { name: /modo claro|modo escuro/i }).click();
  await expect(page.locator('body')).toHaveClass(initialTheme.dark ? /^(?!.*dark)/ : /dark/);
  const toggledTheme = await page.locator('body').evaluate((body) => ({
    background: getComputedStyle(body).backgroundColor,
    accent: getComputedStyle(body).getPropertyValue('--accent-purple').trim(),
  }));
  expect(toggledTheme.background).not.toBe(initialTheme.background);
  expect(toggledTheme.accent).not.toBe(initialTheme.accent);
  await page.getByRole('button', { name: /modo claro|modo escuro/i }).click();

  await page.locator('#authBtn').click();
  await expect(page.locator('#loginModalBackdrop')).toHaveClass(/show/);
  await page.getByRole('button', { name: 'Fechar acesso ao dashboard' }).click();
  await expect(page.locator('#loginModalBackdrop')).not.toHaveClass(/show/);

  const delegatedSubmits = await page.evaluate(() => {
    const calls = [];
    const handlers = {
      obraForm: 'salvarObraForm',
      editorForm: 'salvarEditorForm',
      loginEmailForm: 'doSignInEmail',
      signupEmailForm: 'doSignUpEmail',
    };
    for (const [formId, handlerName] of Object.entries(handlers)) {
      const original = window[handlerName];
      window[handlerName] = () => calls.push(handlerName);
      const event = new Event('submit', { bubbles: true, cancelable: true });
      const accepted = document.getElementById(formId).dispatchEvent(event);
      calls.push(`${formId}:${accepted ? 'navegou' : 'prevenido'}`);
      window[handlerName] = original;
    }
    return calls;
  });
  expect(delegatedSubmits).toEqual([
    'salvarObraForm',
    'obraForm:prevenido',
    'salvarEditorForm',
    'editorForm:prevenido',
    'doSignInEmail',
    'loginEmailForm:prevenido',
    'doSignUpEmail',
    'signupEmailForm:prevenido',
  ]);

  await page.getByRole('tab', { name: /Uploads/ }).click();
  await page.locator('#uploadsAdvancedToggle').click();
  await expect(page.locator('#uploadsAdvancedBody')).toHaveClass(/open/);

  await page.getByRole('tab', { name: /Flows \/ Aditivos/ }).click();
  await expect(page.locator('#tab-flows')).toHaveClass(/active/);
  await expect(page.locator('#tab-btn-flows')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#flowTbody')).toBeAttached();

  const emptyTabs = [
    ['visao', 'Visão Geral sem dados'],
    ['flows', 'Sem aditivos carregados'],
    ['projecao', 'Projeção sem dados mensais'],
    ['projecao_ctrl', 'Nenhuma movimentação registrada'],
    ['detalhe', 'Detalhamento sem dados'],
    ['historico', 'Sem histórico para esta obra'],
  ];
  for (const [tab, expectedText] of emptyTabs) {
    await page.locator(`#tab-btn-${tab}`).click();
    await expect(page.locator(`#tab-${tab}`)).toContainText(expectedText);
    await expect(page.locator(`#tab-${tab} .view-state`).first()).toBeVisible();
  }
  await page.getByRole('tab', { name: /Uploads/ }).click();
  await expect(page.locator('#tab-uploads')).toContainText('Nenhuma planilha Excel enviada ainda');
  await page.getByRole('tab', { name: /Manual/ }).click();
  await expect(page.locator('#tab-manual')).toContainText('Sobre a versão online');

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blockingViolations = accessibility.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact),
  );
  expect(
    blockingViolations,
    blockingViolations.map((violation) => `${violation.id}: ${violation.help}`).join('\n'),
  ).toEqual([]);
});
