const { expect, test } = require('@playwright/test');

test('cronograma físico compara modelos e restringe a ativação ao administrador', async ({
  page,
}) => {
  await page.route('https://*.supabase.co/**', (route) => route.abort());
  await page.goto('/');
  await page.waitForFunction(
    () => window.dashboardServices?.performance.snapshot().boot.completed === true,
  );

  await page.evaluate(() => {
    const { state } = window.dashboardServices;
    state.obra.ativa = 'OBRA-FISICA';
    state.config.evolGlobal = { teorica: 35, financeira: 40 };
    state.config.projectionForecast = { active: false, overrides: {} };
    state.dados.projRaw = Array.from({ length: 8 }, (_, index) => ({
      codigo_obra: 'OBRA-FISICA',
      servico: 'S05765',
      insumo: 'ADM5189',
      valor: 100 + index * 10,
      mes: `2026-${String(index + 1).padStart(2, '0')}`,
    }));
    state.dados.physicalSchedule = {
      items: [{ code: '1', description: 'Administração', total: 100, weight: 1 }],
      months: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
      curve: [
        { month: '2026-06', planned: 30, actual: 28 },
        { month: '2026-07', planned: 36, actual: 35 },
        { month: '2026-08', planned: 48, actual: 35 },
        { month: '2026-09', planned: 64, actual: 35 },
        { month: '2026-10', planned: 82, actual: 35 },
        { month: '2026-11', planned: 100, actual: 35 },
      ],
      cutoffMonth: '2026-07',
      sourceFile: 'cronograma-fisico.xlsx',
    };
  });

  await page.locator('#tab-btn-projecao').click();
  await page.locator('#projDataFim').fill('2026-11');
  await page.locator('#projDataFim').dispatchEvent('change');
  await expect(page.locator('#projectionForecastMethodology')).toContainText(
    'cronograma-fisico.xlsx',
  );
  await expect(page.locator('#projectionForecastMethodology')).toContainText('Cálculo atual');
  await expect(page.locator('#projectionForecastMethodology')).toContainText(
    'Modelo recomendado',
  );
  await expect(
    page.getByRole('button', { name: 'Ativar modelo recomendado' }),
  ).toHaveCount(0);

  await page.evaluate(() => {
    Object.assign(window.dashboardServices.auth.state, {
      ready: true,
      user: { email: 'admin@example.com' },
      isAdminGeral: true,
      isEditor: true,
      isPending: false,
      editaObras: [],
    });
    window.dashboardServices.authUi.updateAuthUI();
    window.dashboardServices.views.projection.renderProjecao();
  });
  await expect(page.getByRole('button', { name: 'Ativar modelo recomendado' })).toBeVisible();
});

test('projeção mensal reconcilia card, detalhamento e data prevista de término', async ({
  page,
}) => {
  await page.route('https://*.supabase.co/**', (route) => route.abort());
  await page.addInitScript(() => {
    const fixedNow = new Date('2026-07-31T12:00:00Z').valueOf();
    const NativeDate = Date;
    window.Date = class extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : [fixedNow]));
      }

      static now() {
        return fixedNow;
      }
    };
  });
  await page.goto('/');
  await page.waitForFunction(
    () => window.dashboardServices?.performance.snapshot().boot.completed === true,
  );

  await page.evaluate(() => {
    const { state } = window.dashboardServices;
    state.obra.ativa = 'OBRA-TESTE';
    state.dados.historico = {
      projectionManagementByProject: {
        'OBRA-TESTE': 'GESTÃO 07-2026',
      },
      projectionComparisonByProject: {
        'OBRA-TESTE': {
          currentManagement: 'GESTÃO 07-2026',
          previousManagement: 'GESTÃO 06-2026',
          comparisonMonth: '2026-06',
        },
      },
      monthlyRowsByProjectManagement: {
        'OBRA-TESTE': {
          'GESTÃO 06-2026': [
            { servico: 'S05765', insumo: 'ADM5189', mes: '2026-06', valor: 55 },
            { servico: 'S05765', insumo: 'CONDH271', mes: '2026-06', valor: 45 },
          ],
          'GESTÃO 07-2026': [{ servico: 'S05765', insumo: 'ADM5189', mes: '2026-06', valor: 60 }],
        },
      },
    };
    state.dados.projRaw = [
      ['ADM5189', 60, '2026-01'],
      ['ADM5189', 60, '2026-02'],
      ['ADM5189', 60, '2026-03'],
      ['ADM5189', 60, '2026-04'],
      ['ADM5189', 60, '2026-05'],
      ['ADM5189', 60, '2026-06'],
      ['CONDH271', 40, '2026-01'],
      ['CONDH271', 40, '2026-02'],
      ['CONDH271', 40, '2026-03'],
      ['CONDH271', 40, '2026-04'],
      ['CONDH271', 40, '2026-05'],
      ['ADM5189', 900, '2027-01'],
    ].map(([insumo, valor, mes]) => ({
      codigo_obra: 'OBRA-TESTE',
      servico: 'S05765',
      insumo,
      valor,
      mes,
    }));
    state.dados.flows = [
      {
        codigo_obra: 'OBRA-TESTE',
        n_alteracao: 'FLOW-1',
        dep: 'Em andamento',
        refletido_status: 'pendente',
        custo_flowmaster: 50,
        descricao: 'Reforço da equipe de campo',
        insumo_planejamento: '',
        insumo_remanejamento: '',
      },
      {
        codigo_obra: 'OBRA-TESTE',
        n_alteracao: 'FLOW-REFLETIDO',
        dep: 'Finalizado',
        refletido_status: 'sim',
        refletido_mes: '2026-07-01',
        custo_flowmaster: 30,
        descricao: 'Flow já incorporado na Gestão',
        insumo_planejamento: 'ADM5189',
        insumo_remanejamento: '',
      },
    ];
  });

  await page.locator('#tab-btn-projecao').click();
  await page.locator('#projDataFim').fill('2026-10');
  await page.locator('#projDataFim').dispatchEvent('change');
  await expect(page.locator('#projTbody tr').first()).toBeVisible();
  await expect(page.locator('#projBaseManagement')).toHaveText('GESTÃO 07-2026');
  await expect(page.locator('#projChart')).toContainText('Planejado acumulado · GESTÃO 07-2026');
  await expect(
    page.locator('#projChart .apexcharts-xaxis-annotations text', { hasText: 'Corte:' }),
  ).toBeVisible();

  const rootCells = page.locator('#projTbody tr').first().locator('td');
  const totalCard = page.locator(
    '#projKpis .projection-trend-card .projection-summary-row--total strong',
  );
  const impactCard = page
    .locator('#projKpis .projection-trend-card .projection-summary-row')
    .filter({ hasText: 'Tendência Total' })
    .locator('strong');

  await expect(rootCells.nth(1)).toHaveText('560,00');
  await expect(rootCells.nth(5)).toHaveText(await totalCard.innerText());
  await expect(page.locator('#projThead')).toContainText('Realizado até jun/2026');
  await expect(page.locator('#projThead')).toContainText('jul/26');
  await expect(page.locator('#projThead')).toContainText('out/26');
  expect(await impactCard.innerText()).toBe('+456,67');
  await expect(page.locator('#projThead')).toContainText('Planejado GESTÃO 06-2026');
  await expect(page.locator('#projThead')).toContainText('Consolidado GESTÃO 07-2026');
  await expect(rootCells.nth(6)).toHaveText('100,00');
  await expect(rootCells.nth(7)).toHaveText('60,00');
  await expect(rootCells.nth(8)).toHaveText('-40,00');

  await page.getByRole('button', { name: '− Resumo' }).click();
  await expect(page.locator('#projThead')).not.toContainText('Valor planejado');
  await page.getByRole('button', { name: '+ Resumo' }).click();
  await page.getByRole('button', { name: '− Aderência' }).click();
  await expect(page.locator('#projThead')).not.toContainText('Planejado GESTÃO 06-2026');
  await page.getByRole('button', { name: '+ Aderência' }).click();

  await rootCells.nth(0).click();
  await expect(page.locator('#projTbody')).toContainText('Sem insumo classificado');
  await page.evaluate(() => window.dashboardServices.views.projection.projExpandAll());
  const inputRow = page.locator('#projTbody tr', { hasText: 'ADM5189' }).first();
  const inputExtrapolation = await inputRow.locator('td').nth(4).innerText();
  await page.evaluate(() =>
    window.dashboardServices.views.projection.openProjDrill('S05765', 'ADM5189'),
  );
  const modalExtrapolation = page
    .locator('.projection-modal-card')
    .nth(1)
    .locator('.projection-modal-metric', { hasText: 'Extrapolação' })
    .locator('.projection-modal-metric-value');
  await expect(modalExtrapolation).toHaveText(inputExtrapolation);
  await expect(page.locator('#modalProjChart .projection-curve-tooltip-action')).toHaveCount(0);
  await page.locator('#modal .modal-close').click();

  const firstExtrapolatedMonth = inputRow.locator('.projection-month-cell--extrapolated').first();
  await expect(firstExtrapolatedMonth).toBeVisible();
  await firstExtrapolatedMonth.locator('button').click();
  await expect(page.locator('#modalContent h2')).toContainText('Composição mensal');
  await expect(page.locator('.projection-month-summary')).toContainText('Gestão-base');
  await expect(page.locator('.projection-month-summary')).toContainText('Extrapolação');
  await expect(page.locator('.projection-month-composition-table tfoot')).toContainText(
    await firstExtrapolatedMonth.locator('.projection-month-value > span').last().innerText(),
  );
  await expect(page.locator('.projection-month-reflected-section')).toContainText(
    'não somados novamente',
  );
  await expect(page.locator('.projection-month-reflected-section')).toContainText('FLOW-REFLETIDO');
  await page.locator('#modal .modal-close').click();

  const labelResize = page.locator('[data-projection-resize="label"]');
  await labelResize.focus();
  const initialWidth = Number(await labelResize.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowRight');
  await expect(labelResize).toHaveAttribute('aria-valuenow', String(initialWidth + 10));
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('jzurique_proj_column_widths_v1') || '{}'),
    ),
  ).toMatchObject({ 'OBRA-TESTE': { label: initialWidth + 10 } });
  await page.evaluate(() =>
    window.dashboardServices.views.projection.resetProjectionColumnWidths(),
  );
  await expect(page.locator('[data-projection-resize="label"]')).toHaveAttribute(
    'aria-valuenow',
    String(initialWidth),
  );

  const labels = await page.locator('#projChart .apexcharts-xaxis-label').allTextContents();
  expect(labels.join(' ')).toContain('fev/2026');
  expect(labels.join(' ')).toContain('out/2026');
  expect(labels.join(' ')).not.toContain('jan/2027');

  const wheelResult = await page.evaluate(() => {
    const chart = document.getElementById('projChart');
    const pageScroller = document.scrollingElement;
    let reachedChartHandler = false;
    chart.addEventListener('wheel', () => {
      reachedChartHandler = true;
    });
    pageScroller.scrollTop = 100;
    const before = pageScroller.scrollTop;
    chart.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 }));
    return { reachedChartHandler, before, after: pageScroller.scrollTop };
  });
  expect(wheelResult.reachedChartHandler).toBe(false);
  expect(wheelResult.after).toBeGreaterThan(wheelResult.before);

  await page.locator('#projChart').scrollIntoViewIfNeeded();
  await page.locator('#projChart').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#modalContent h2')).toContainText('Composição da diferença');
  await page.locator('#modal .modal-close').click();

  const chartSvg = page.locator('#projChart .apexcharts-svg');
  const chartBox = await chartSvg.boundingBox();
  await chartSvg.hover({
    position: { x: chartBox.width - 50, y: chartBox.height / 2 },
    force: true,
  });
  const compositionAction = page.locator('#projChart .projection-curve-tooltip-action');
  await expect(compositionAction).toBeVisible();
  const tooltipDifference = await page
    .locator('#projChart .projection-curve-tooltip-row--difference strong')
    .innerText();
  await compositionAction.click();

  await expect(page.locator('#modalContent h2')).toContainText('Composição da diferença');
  await expect(page.locator('.projection-difference-table tbody')).toContainText(
    'Sem insumo classificado',
  );
  await expect(page.locator('.projection-difference-table tfoot th').last()).toHaveText(
    tooltipDifference,
  );
  await expect(page.locator('.projection-difference-section-heading')).toContainText('1 Flow');
  const flowTable = page.locator('.projection-difference-flows-table');
  await expect(flowTable.locator('tbody')).toContainText('FLOW-1');
  await expect(flowTable.locator('tbody')).toContainText('Reforço da equipe de campo');
  await expect(flowTable.locator('tbody')).toContainText('Sem insumo classificado');
  await expect(flowTable.locator('tfoot th').last()).toHaveText('+50,00');
  await page.locator('#modal .modal-close').click();

  for (const seriesIndex of [0, 1]) {
    await chartSvg.hover({
      position: { x: chartBox.width - 50, y: chartBox.height / 2 },
      force: true,
    });
    const tooltipMonth = await page
      .locator('#projChart .projection-curve-tooltip-title')
      .innerText();
    const marker = page
      .locator(
        `#projChart .apexcharts-series-markers-wrap[data\\:realIndex="${seriesIndex}"] .apexcharts-marker`,
      )
      .first();
    await expect(marker).toBeVisible();
    await marker.click({ force: true });
    await expect(page.locator('#modalContent h2')).toContainText(tooltipMonth);
    await expect(page.locator('.projection-difference-table tfoot th').last()).toHaveText(
      tooltipDifference,
    );
    await page.locator('#modal .modal-close').click();
  }

  await chartSvg.hover({
    position: { x: 100, y: chartBox.height / 2 },
    force: true,
  });
  await expect(page.locator('#projChart .projection-curve-tooltip-action')).toHaveCount(0);
  const plannedMarkerBeforeCutoff = page
    .locator('#projChart .apexcharts-series-markers-wrap[data\\:realIndex="0"] .apexcharts-marker')
    .first();
  await plannedMarkerBeforeCutoff.click({ force: true });
  await expect(page.locator('#modalBg')).not.toHaveClass(/show/);

  await page.evaluate(() => {
    const { state, views } = window.dashboardServices;
    state.dados.workforce = {
      settings: [{ insumo: 'ADM5189', ativo: true }],
      rows: [
        {
          id: 'WORKFORCE-1',
          codigo_obra: 'OBRA-TESTE',
          insumo: 'ADM5189',
          cargo: 'Engenheiro',
          custo_mensal: 100,
          ordem: 0,
          distribuicao: {
            '2026-07': 1,
            '2026-08': 2,
            '2026-09': 3,
            '2026-10': 4,
          },
        },
      ],
    };
    views.projection.renderProjecao();
    views.projection.projExpandAll();
  });
  await expect(page.locator('#workforceToggleADM5189')).toBeChecked();
  await expect(
    page.locator('#projectionWorkforceTbody [data-workforce-field="cargo"]'),
  ).toHaveValue('Engenheiro');
  await expect(page.locator('#projectionWorkforceChart .apexcharts-svg')).toBeVisible();
  await expect(
    page.locator('#projKpis .projection-trend-card .projection-summary-row--total strong'),
  ).toHaveText('1.776,67');
  const workforceMonth = page
    .locator('#projTbody tr', { hasText: 'ADM5189' })
    .first()
    .locator('.projection-month-cell--workforce')
    .first();
  await workforceMonth.locator('button').click();
  await expect(page.locator('.projection-month-summary')).toContainText('Mão de obra manual');
  await expect(page.locator('.projection-month-summary')).toContainText('Gestão substituída');
  await page.locator('#modal .modal-close').click();

  await page.evaluate(() => {
    const { state, views } = window.dashboardServices;
    state.dados.flows = [];
    state.dados.workforce = { settings: [], rows: [] };
    state.dados.projRaw = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].map(
      (mes) => ({
        codigo_obra: 'OBRA-TESTE',
        servico: 'SERVICO-SEM-EXTRAPOLACAO',
        insumo: 'I001',
        valor: 100,
        mes,
      }),
    );
    views.projection.renderProjecao();
    views.projection.openProjectionDifference('2026-10');
  });
  await expect(page.locator('#modalBg')).not.toHaveClass(/show/);
});
