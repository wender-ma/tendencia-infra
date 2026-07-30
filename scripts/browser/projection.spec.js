const { expect, test } = require('@playwright/test');

test('projeção mensal reconcilia card, detalhamento e data prevista de término', async ({
  page,
}) => {
  await page.route('https://*.supabase.co/**', (route) => route.abort());
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
  expect(await impactCard.innerText()).toBe('+423,33');

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
  await expect(page.locator('.projection-month-reflected-section')).toContainText(
    'FLOW-REFLETIDO',
  );
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
    state.dados.flows = [];
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
