const fs = require('fs');
const { expect, test } = require('@playwright/test');

test('impressão da aba ativa e exportação XLSX funcionam', async ({ page }, testInfo) => {
  await page.route('https://*.supabase.co/**', route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => window.dashboardPerformance?.snapshot().boot.completed === true);

  await page.emulateMedia({ media: 'print' });
  const printLayout = await page.evaluate(() => ({
    tabsDisplay: getComputedStyle(document.querySelector('.tabs')).display,
    activeDisplay: getComputedStyle(document.querySelector('.tab-content.active')).display,
    hiddenDisplays: [...document.querySelectorAll('.tab-content:not(.active)')]
      .map(panel => getComputedStyle(panel).display),
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    tableMaxHeight: getComputedStyle(document.querySelector('.table-wrap')).maxHeight,
  }));
  expect(printLayout.tabsDisplay).toBe('none');
  expect(printLayout.activeDisplay).not.toBe('none');
  expect(new Set(printLayout.hiddenDisplays)).toEqual(new Set(['none']));
  expect(printLayout.documentWidth).toBeLessThanOrEqual(printLayout.viewportWidth + 1);
  expect(printLayout.tableMaxHeight).toBe('none');

  await testInfo.attach(`print-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });

  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => {
    window.OBRA_ATIVA = 'OBRA-TESTE';
    window.DATA_T = [{
      grupo: 'Obras Civis',
      cod: '01.01',
      item: 'Item de compatibilidade',
      cod_servico: 'S001',
      cod_insumo: 'I001',
      nivel: 1,
      tipo: 'insumo',
      is_folha: true,
      licitacao: 1000,
      corrigido_ipca: 1010,
      corrigido_incc: 1020,
      gestao: 1030,
      diferenca: 30,
      aditivo_total: 20,
      evolucao_teorica: 50,
      evolucao_financeira: 48,
    }];
  });

  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => window.exportarDetalhamentoXLSX());
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^detalhamento_OBRA-TESTE_\d{4}-\d{2}-\d{2}\.xlsx$/);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  expect(fs.statSync(downloadPath).size).toBeGreaterThan(1000);
});
