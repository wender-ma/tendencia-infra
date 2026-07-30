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
        insumo_planejamento: '',
        insumo_remanejamento: '',
      },
    ];
  });

  await page.locator('#tab-btn-projecao').click();
  await page.locator('#projDataFim').fill('2026-10');
  await page.locator('#projDataFim').dispatchEvent('change');
  await expect(page.locator('#projTbody tr').first()).toBeVisible();

  const rootCells = page.locator('#projTbody tr').first().locator('td');
  const totalCard = page
    .locator('#projKpis .projection-trend-card .projection-summary-row--total strong');
  const impactCard = page
    .locator('#projKpis .projection-trend-card .projection-summary-row')
    .filter({ hasText: 'Tendência Total' })
    .locator('strong');

  await expect(rootCells.nth(2)).toHaveText('560,00');
  await expect(rootCells.nth(5)).toHaveText(await impactCard.innerText());
  await expect(rootCells.nth(6)).toHaveText(await totalCard.innerText());

  await rootCells.nth(1).click();
  await expect(page.locator('#projTbody')).toContainText('Flows pendentes · Outros');
  await page.evaluate(() => window.dashboardServices.views.projection.projExpandAll());
  const inputRow = page.locator('#projTbody tr', { hasText: 'ADM5189' }).first();
  const inputExtrapolation = await inputRow.locator('td').nth(5).innerText();
  await page.evaluate(() =>
    window.dashboardServices.views.projection.openProjDrill('S05765', 'ADM5189'),
  );
  const modalExtrapolation = page
    .locator('.projection-modal-card')
    .nth(1)
    .locator('.projection-modal-metric', { hasText: 'Extrapolação' })
    .locator('.projection-modal-metric-value');
  await expect(modalExtrapolation).toHaveText(inputExtrapolation);

  const labels = await page
    .locator('#projChart .apexcharts-xaxis-label')
    .allTextContents();
  expect(labels.join(' ')).toContain('fev/2026');
  expect(labels.join(' ')).toContain('out/2026');
  expect(labels.join(' ')).not.toContain('jan/2027');
});
