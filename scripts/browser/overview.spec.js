const { expect, test } = require('@playwright/test');

test('Visão Geral usa a Licitação corrigida e não exibe rankings Top 10', async ({ page }) => {
  await page.route('https://*.supabase.co/**', (route) => route.abort());
  await page.goto('/');
  await page.waitForFunction(
    () => window.dashboardServices?.performance.snapshot().boot.completed === true,
  );

  await page.evaluate(() => {
    const services = window.dashboardServices;
    services.state.obra.ativa = 'OBRA-VISAO';
    services.state.config.correcaoIndice = 'ipca';
    services.state.config.card3Modo = 'bruto';
    services.state.config.gestaoLabel = 'GESTÃO 07-2026';
    services.state.dados.flows = [];
    services.state.dados.projRaw = [];
    services.state.dados.tendencia = [
      {
        grupo: 'Obras Civis',
        cod: '01.01',
        item: 'Item de validação',
        cod_servico: 'S001',
        cod_insumo: 'I001',
        is_folha: true,
        licitacao: 100,
        corrigido_ipca: 120,
        corrigido_incc: 110,
        gestao: 130,
        diferenca: 30,
      },
    ];
    services.views.overview.renderVisao();
  });

  await expect(page.getByText(/Top 10 - Maiores/)).toHaveCount(0);
  await expect(page.locator('#top10Up')).toHaveCount(0);
  await expect(page.locator('#top10Down')).toHaveCount(0);

  const tendencyCard = page.locator('#kpis .kpi', { hasText: 'Tendência Final Projetada' });
  await expect(tendencyCard.locator('.overview-projection-number')).toHaveText('130,00');
  await expect(tendencyCard).toContainText('Gestão vs Licitação corrigida (IPCA)');
  await expect(tendencyCard).toContainText('+10,00');
  await expect(tendencyCard).toContainText('Δ bruto vs Licitação corrigida');

  await page.locator('#kpis').getByRole('button', { name: 'INCC' }).click();
  await expect(tendencyCard).toContainText('Gestão vs Licitação corrigida (INCC)');
  await expect(tendencyCard).toContainText('+20,00');
});
