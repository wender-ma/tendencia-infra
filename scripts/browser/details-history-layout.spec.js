const { expect, test } = require('@playwright/test');

test('detalhamento e histórico mensal usam o layout operacional padronizado', async ({ page }) => {
  await page.route('https://*.supabase.co/**', (route) => route.abort());
  await page.goto('/');
  await page.waitForFunction(
    () => window.dashboardServices?.performance.snapshot().boot.completed === true,
  );

  await page.evaluate(() => {
    const { state, views } = window.dashboardServices;
    state.obra.ativa = 'OBRA-TESTE';
    state.dados.tendencia = [
      {
        codigo_obra: 'OBRA-TESTE',
        is_folha: true,
        grupo: 'Custos Diretos',
        item: 'Serviço de teste',
        cod: '01.01',
        cod_insumo: 'I000001',
        licitacao: 100,
        gestao: 120,
        aditivo_total: 20,
        evolucao_teorica: 50,
        evolucao_financeira: 55,
        flows_destino: [],
        flows_origem: [],
      },
    ];
    state.dados.historico = {
      gestoes: ['GESTÃO 06-2026', 'GESTÃO 07-2026'],
      items: [
        {
          codigo_obra: 'OBRA-TESTE',
          insumo: 'I000001',
          item_cod: '01.01',
          'GESTÃO 06-2026': 110,
          'GESTÃO 07-2026': 120,
        },
      ],
      totals: {
        'OBRA-TESTE': {
          'GESTÃO 06-2026': 110,
          'GESTÃO 07-2026': 120,
        },
      },
    };
    views.details.populateFilters();
    views.details.renderTable();
  });

  await page.locator('.tab[data-tab="detalhe"]').click();
  await expect(page.locator('#tab-detalhe .sources-header')).toHaveCount(0);
  await expect(page.locator('#tbody tr')).toHaveCount(1);
  await expect(page.locator('#tbody')).toContainText('Serviço de teste');
  const detailsOverflow = await page
    .locator('.details-table-wrap')
    .evaluate((element) => getComputedStyle(element).overflowY);
  expect(detailsOverflow).toBe('hidden');

  await page.locator('.tab[data-tab="historico"]').click();
  await page.evaluate(() => window.dashboardServices.views.history.renderHistorico());
  await expect(page.locator('#tab-historico .sources-header')).toHaveCount(0);
  await expect(page.locator('#histKpis .kpi')).toHaveCount(5);
  await expect(page.locator('.history-data-section:visible')).toHaveCount(3);
  await expect(page.locator('#histTbody tr')).toHaveCount(1);
  const historyLayout = await page.evaluate(() => {
    const chart = document.querySelector('.history-chart-card').getBoundingClientRect();
    const ranking = document.querySelector('.history-ranking-grid').getBoundingClientRect();
    const tableWrap = document.querySelector('.history-table-wrap');
    return {
      chartRankingGap: ranking.top - chart.bottom,
      historyOverflowY: getComputedStyle(tableWrap).overflowY,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(historyLayout.chartRankingGap).toBeGreaterThanOrEqual(14);
  expect(historyLayout.historyOverflowY).toBe('hidden');
  expect(historyLayout.documentWidth).toBeLessThanOrEqual(historyLayout.viewportWidth + 1);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('.tab[data-tab="detalhe"]').click();
  const detailsMobileLayout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    detailsFilterWidth: document.querySelector('.details-filters').getBoundingClientRect().width,
  }));
  expect(detailsMobileLayout.documentWidth).toBeLessThanOrEqual(
    detailsMobileLayout.viewportWidth + 1,
  );
  expect(detailsMobileLayout.detailsFilterWidth).toBeLessThanOrEqual(
    detailsMobileLayout.viewportWidth,
  );

  await page.locator('.tab[data-tab="historico"]').click();
  const historyMobileLayout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    historyFilterWidth: document.querySelector('.history-heatmap-filters').getBoundingClientRect()
      .width,
  }));
  expect(historyMobileLayout.documentWidth).toBeLessThanOrEqual(
    historyMobileLayout.viewportWidth + 1,
  );
  expect(historyMobileLayout.historyFilterWidth).toBeLessThanOrEqual(
    historyMobileLayout.viewportWidth,
  );
});

test('histórico vazio oculta painéis sem conteúdo', async ({ page }) => {
  await page.route('https://*.supabase.co/**', (route) => route.abort());
  await page.goto('/');
  await page.waitForFunction(
    () => window.dashboardServices?.performance.snapshot().boot.completed === true,
  );
  await page.locator('.tab[data-tab="historico"]').click();

  await expect(page.locator('#histKpis .view-state')).toBeVisible();
  await expect(page.locator('.history-data-section:visible')).toHaveCount(0);
});
