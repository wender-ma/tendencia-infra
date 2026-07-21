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
      typeof window.dashboardServices?.actions?.resolve('handleAuthClick') === 'function' &&
      Boolean(window.dashboardServices?.state) &&
      window.dashboardServices?.auth.state.ready === true &&
      window.dashboardServices?.performance.snapshot().boot.completed === true,
  );

  const runtime = await page.evaluate(async () => {
    const authService = window.dashboardServices.auth;
    const parserService = window.dashboardServices.parsers;
    const feedbackService = window.dashboardServices.feedback;
    const modalService = window.dashboardServices.modals;
    const performanceService = window.dashboardServices.performance;
    const loggerService = window.dashboardServices.logger;
    const uploadPolicy = window.dashboardServices.uploadPolicy;
    const uploadRepository = window.dashboardServices.uploadRepository;
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
    const authStartsReadOnly = !authService.isAdmin() && !authService.canEditActiveProject();
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
      window.dashboardServices.syncStatus.snapshot().pending === 1;
    releaseSyncOperation('ok');
    await pendingSyncOperation;
    const syncCompleted =
      document.getElementById('supaBadge')?.dataset.syncState === 'synced' &&
      window.dashboardServices.syncStatus.snapshot().pending === 0 &&
      window.dashboardServices.syncStatus.snapshot().lastSync;
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
    const state = window.dashboardServices.state;
    const originalTendency = state.dados.tendencia;
    const tendencyMarker = [{ stateContract: true }];
    state.dados.tendencia = tendencyMarker;
    const centralStateWrites = state.dados.tendencia === tendencyMarker;
    state.dados.tendencia = originalTendency;

    authService.state.isEditor = true;
    authService.state.isAdminGeral = false;
    authService.state.editaObras = ['STATE-OBRA'];
    state.obra.ativa = 'STATE-OBRA';
    const authReadsActiveProject = authService.canEditActiveProject();
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
    ].every((path) => uploadRepository.sanitizeStoragePath(path) === '');
    const validStoragePathAccepted =
      uploadRepository.sanitizeStoragePath('/OBRA-1/tendencia/arquivo.csv') ===
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
      hasSupabaseService: Boolean(window.dashboardServices?.supabase?.client),
      hasAuthService: authService.state === window.dashboardServices.auth.state,
      hasParserService:
        typeof parserService?.parseTendencia === 'function' &&
        parserService.parseNumber('1.234,56') === 1234.56 &&
        window.parseNumero === parserService.parseNumber,
      hasFeedbackService: toastUsesText && loadingShown && loadingHidden && escapedPayloadsStayText,
      hasModalService: confirmUsesText && confirmResult === false,
      storagePathSecurity: dangerousStoragePathsRejected && validStoragePathAccepted,
      hasPerformanceService:
        performanceService.snapshot().boot.domNodes > 0 &&
        performanceService.snapshot().operations['render:visao']?.count >= 1,
      hasLoggerService: loggerIsSanitized,
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
        registered: Boolean(state),
        centralStateWrites,
        authReadsActiveProject,
      },
      hasExternalConfig: window.dashboardServices.config.dashboard.table_page_size === 100,
      hasApexCharts: typeof window.ApexCharts === 'function',
      hasDashboardHandler:
        typeof window.dashboardServices.actions.resolve('handleAuthClick') === 'function',
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
        'exportarDetalhamentoXLSX',
        'exportarFlowsXLSX',
        'exportarControleProjXLSX',
        'handleAuthClick',
        'doSignInEmail',
        'doSignInGoogle',
        'doSignUpEmail',
        'closeLoginModal',
        'switchLoginTab',
        'toggleTheme',
        'toggleHeaderEdit',
        'resetCacheDados',
        'apagarHistoricoUploads',
        'trocarObra',
        'showManualText',
        'clearClassifications',
        'reloadClassifications',
        'exportClassifications',
        'onClassifChange',
        'msToggle',
        'msFilterOpts',
        'msSelectAll',
        'msInvert',
        'msClose',
        'toggleMassSelect',
        'toggleSelectAllVisible',
        'massAplicarDestino',
        'massAplicarOrigem',
        'massAplicarRefletido',
        'onValorChange',
        'openManualForm',
        'handleUpload',
        'handleExcelUpload',
        'toggleAdvancedUploads',
        'openUploadsHistory',
        'clearFlowFilters',
        'onRefletidoChange',
        'setCard3Modo',
        'setCorrecaoIndice',
        'projExpandAll',
        'projCollapseAll',
        'exportarProjecaoDetalhada',
        'toggleLockCampo',
        'clearMovFilters',
        'openMovForm',
        'openObraForm',
        'closeObraForm',
        'salvarObraForm',
        'openEditorForm',
        'closeEditorForm',
        'editorObrasMarcarTodas',
        'editorFormOnRoleChange',
        'salvarEditorForm',
        'excluirUsuarioDoModal',
        'replaceWithParsedMarkup',
        'renderDashboardState',
        'authToast',
        'showLoading',
        'hideLoading',
        'openModalLayer',
        'closeModalLayer',
        'openModal',
        'closeModal',
        'closeConfirmModal',
        'confirmModal',
        'saveManualForm',
        'saveMovForm',
        'massConfirmCallback',
        'dashboardPerformance',
        'dashboardLogger',
        'beginSupaOperation',
        'finishSupaOperation',
        'getDashboardSyncStatus',
        'handleUploadRepositoryMutation',
        'markDashboardSyncError',
        'markDashboardSynced',
        'updateSupaBadge',
        'DATA_KEYS',
        'supaLoadClassifications',
        'supaPatchClassification',
        'supaLoadManuals',
        'supaUpsertManual',
        'supaDeleteManual',
        'supaLoadProjConfig',
        'supaSaveProjConfig',
        'supaLoadMovs',
        'supaUpsertMov',
        'supaDeleteMov',
        'supaLoadDashboardConfig',
        'supaSaveDashboardKey',
        'UPLOADS_BUCKET',
        'UPLOADS_MAX_PER_TYPE',
        'sanitizeStoragePath',
        'supaCreateUploadRecord',
        'supaActivateUploadRecord',
        'supaRollbackUploadActivation',
        'supaDeleteUploadRecords',
        'supaMarkUploadRecordsFailed',
        'supaRemoveStoredUpload',
        'supaCleanupIncompleteUploads',
        'supaUploadFile',
        'supaListUploadsByType',
        'supaGetDownloadURL',
        'supaEnforceRollingBackup',
        'supaLoadUploadsLatest',
        'UPLOAD_RUNTIME_STATE',
        'supaCaptureDashboardRows',
        'supaRestoreDashboardRows',
        'supaSaveAllData',
        'setUploadRuntimeState',
        'captureInMemoryUploadState',
        'restoreInMemoryUploadState',
        'commitPreparedUpload',
        'SUPA',
        'AUTH',
        'isEditorDaObraAtiva',
        'isAdminGeral',
        'handleAuthServiceStateChanged',
        'isGlobalUploadKind',
        'openLoginModal',
        'requireAdmin',
        'requireEditor',
        'requireEditorForActiveProject',
        'requireUploadPermission',
        'syncEditingControls',
        'updateAuthUI',
        'AppState',
        'dashboardState',
        'DATA_T',
        'DATA_F',
        'HISTORICO',
        'PROJ_RAW',
        'GESTAO_LABEL',
        'EVOL_GLOBAL',
        'CARD3_MODO',
        'CORRECAO_INDICE',
        'OBRAS',
        'OBRA_ATIVA',
        'MAP_DESTINO',
        'MAP_ORIGEM',
        'LAST_UPLOADS',
        'donutHidden',
        '_lastTipoSum',
        'sortKey',
        'sortDir',
        'sortKeyF',
        'sortDirF',
        'CONFIG',
        'HEADER_KEY',
        'STORAGE_KEY',
        'MANUAL_KEY',
        'PROJ_CTRL_KEY',
        'dashboardConfig',
        'HIERARQUIA',
        'SERVICOS_META',
        'INSUMOS_META',
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
      registered: true,
      centralStateWrites: true,
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
    const actions = window.dashboardServices.actions;
    const handlers = {
      obraForm: 'salvarObraForm',
      editorForm: 'salvarEditorForm',
      loginEmailForm: 'doSignInEmail',
      signupEmailForm: 'doSignUpEmail',
    };
    for (const [formId, handlerName] of Object.entries(handlers)) {
      const original = actions.resolve(handlerName);
      actions.register({ [handlerName]: () => calls.push(handlerName) });
      const event = new Event('submit', { bubbles: true, cancelable: true });
      const accepted = document.getElementById(formId).dispatchEvent(event);
      calls.push(`${formId}:${accepted ? 'navegou' : 'prevenido'}`);
      actions.register({ [handlerName]: original });
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
