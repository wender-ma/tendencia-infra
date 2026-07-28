const { expect, test } = require('@playwright/test');

test('movimentações calculam aporte, devolução e remanejamentos sem sobrepor o gráfico', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'jzurique_proj_ctrl_v1',
      JSON.stringify({
        saldo_inicial: 1000,
        data_ref: '2026-07',
        insumo: 'I011890',
        locks: { saldo: false, data: false, insumo: false },
        movimentacoes: [
          {
            id: 'MOV001',
            tipo: 'aporte',
            data: '2026-07-02',
            data_br: '02/07/2026',
            origem: 'EXTERNO',
            destino: 'I011890',
            descricao: 'Aporte de teste',
            valor: 200,
          },
          {
            id: 'MOV002',
            tipo: 'devolucao',
            data: '2026-07-03',
            data_br: '03/07/2026',
            origem: 'I011890',
            destino: 'EXTERNO',
            descricao: 'Devolução de teste',
            valor: 50,
          },
          {
            id: 'MOV003',
            tipo: 'remanejamento',
            data: '2026-07-04',
            data_br: '04/07/2026',
            origem: 'I011890',
            destino: 'I000001',
            descricao: 'Remanejamento de saída',
            valor: 100,
          },
          {
            id: 'MOV004',
            tipo: 'remanejamento',
            data: '2026-07-05',
            data_br: '05/07/2026',
            origem: 'I000002',
            destino: 'I011890',
            descricao: 'Remanejamento de entrada',
            valor: 40,
          },
        ],
      }),
    );
  });
  await page.route('https://*.supabase.co/**', (route) => route.abort());
  await page.goto('/');
  await page.waitForFunction(
    () => window.dashboardServices?.performance.snapshot().boot.completed === true,
  );

  await page.evaluate(() => {
    window.dashboardServices.state.dados.tendencia = [
      {
        is_folha: true,
        cod_insumo: 'I011890',
        item: 'Projeção de gastos',
        gestao: 1090,
      },
    ];
  });
  await page.locator('.tab[data-tab="projecao_ctrl"]').click();
  await expect(page.locator('#tab-projecao_ctrl')).toHaveClass(/active/);
  await expect(page.locator('#projCtrlSummary')).toContainText('1.090,00');
  await expect(page.locator('#projCtrlConfBanner')).toBeEmpty();

  const movementValue = async (description, column) =>
    page.locator('#movTbody tr', { hasText: description }).locator('td').nth(column).innerText();

  expect(await movementValue('Aporte de teste', 7)).toBe('+200,00');
  expect(await movementValue('Devolução de teste', 7)).toBe('-50,00');
  expect(await movementValue('Remanejamento de saída', 7)).toBe('-100,00');
  expect(await movementValue('Remanejamento de entrada', 7)).toBe('+40,00');
  expect(await movementValue('Remanejamento de entrada', 8)).toBe('1.090,00');
  await expect(page.locator('#movTbody tr').first()).toContainText('Saldo inicial');
  await expect(page.locator('#movTbody tr').last()).toContainText('Remanejamento de entrada');

  const layout = await page.evaluate(() => {
    const chartCard = document
      .querySelector('.projection-control-chart-card')
      .getBoundingClientRect();
    const movementsCard = document
      .querySelector('.projection-control-movements-card')
      .getBoundingClientRect();
    return {
      gap: movementsCard.top - chartCard.bottom,
      overlaps: movementsCard.top < chartCard.bottom,
    };
  });
  expect(layout.overlaps).toBe(false);
  expect(layout.gap).toBeGreaterThanOrEqual(14);
});
