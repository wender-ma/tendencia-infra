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
    services.state.dados.flows = [
      {
        codigo_obra: 'OBRA-VISAO',
        n_alteracao: 'FLOW-PENDENTE',
        descricao: 'Aditivo ainda não refletido',
        insumo_planejamento: 'ADM5189',
        custo_flowmaster: 5,
        refletido_status: 'pendente',
      },
      {
        codigo_obra: 'OBRA-VISAO',
        n_alteracao: 'FLOW-REFLETIDO',
        descricao: 'Aditivo já incorporado',
        insumo_planejamento: 'ADM5189',
        custo_flowmaster: 3,
        refletido_status: 'sim',
        refletido_mes: '2026-06',
      },
    ];
    services.state.dados.projRaw = [
      {
        codigo_obra: 'OBRA-VISAO',
        servico: 'S05765',
        insumo: 'ADM5189',
        mes: '2026-06',
        valor: 10,
      },
      {
        codigo_obra: 'OBRA-VISAO',
        servico: 'S05765',
        insumo: 'ADM5189',
        mes: '2026-07',
        valor: 10,
      },
    ];
    services.state.dados.tendencia = [
      {
        cod: '1',
        item: 'PLANEJAMENTO OBRA',
        nivel: 1,
        is_folha: false,
      },
      {
        cod: '01.01',
        item: 'CUSTOS INDIRETOS',
        nivel: 2,
        is_folha: false,
      },
      {
        grupo: 'Custos Indiretos',
        cod: '01.01.01',
        item: 'MÃO DE OBRA',
        cod_servico: 'S05765',
        nivel: 3,
        is_folha: false,
      },
      {
        grupo: 'Custos Indiretos',
        cod: '01.01.01',
        item: 'Item de validação',
        cod_servico: 'S05765',
        cod_insumo: 'ADM5189',
        nivel: 3,
        is_folha: true,
        licitacao: 100,
        corrigido_ipca: 120,
        corrigido_incc: 110,
        gestao: 130,
        diferenca: 30,
      },
    ];
    document.getElementById('projDataCorte').value = '2026-07';
    document.getElementById('projDataFim').value = '2026-09';
    document.getElementById('projMetodo').value = '6';
    services.views.overview.renderVisao();
  });

  await expect(page.getByText(/Top 10 - Maiores/)).toHaveCount(0);
  await expect(page.locator('#top10Up')).toHaveCount(0);
  await expect(page.locator('#top10Down')).toHaveCount(0);

  const tendencyCard = page.locator('#kpis .kpi', { hasText: 'Tendência Final Projetada' });
  await expect(tendencyCard.locator('.overview-projection-number')).toHaveText('138,33');
  await expect(tendencyCard).toContainText('Gestão vs Licitação corrigida (IPCA)');
  await expect(tendencyCard).toContainText('+10,00');
  await expect(tendencyCard).toContainText('Δ bruto vs Licitação corrigida');
  await expect(tendencyCard).toContainText('+18,33');

  await expect(page.locator('#overviewInputThead')).toContainText(
    'Orçamento Licitação Corrigido (IPCA)',
  );
  const rootRow = page.locator('#overviewInputTbody tr').first();
  await expect(rootRow).toContainText('120,00');
  await expect(rootRow).toContainText('138,33');
  await expect(rootRow).toContainText('+18,33');
  await expect(page.locator('#overviewInputCount')).toContainText('1 insumos');
  await expect(page.locator('#overviewInputTbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Recolher tudo' }).click();
  await expect(page.locator('#overviewInputTbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Expandir tudo' }).click();
  await expect(page.locator('#overviewInputTbody tr')).toHaveCount(4);

  await rootRow.getByRole('button', { name: /Ver composição da diferença/ }).click();
  await expect(page.locator('#modalContent')).toContainText('Licitação Original');
  await expect(page.locator('#modalContent')).toContainText('Tendência atualizada');
  await expect(page.locator('#modalContent')).toContainText('Diferença Licitação × Tendência');
  await expect(page.locator('#modalContent')).toContainText('Composição dessa diferença');
  await expect(page.locator('#modalContent')).toContainText('Inflação');
  await expect(page.locator('#modalContent')).toContainText('Projeção automática');
  await expect(page.locator('#modalContent')).toContainText('Flows pendentes');
  await expect(page.locator('#modalContent')).toContainText('Não identificado');
  await expect(page.locator('#modalContent')).toContainText('FLOW-PENDENTE');
  await expect(page.locator('#modalContent')).toContainText('FLOW-REFLETIDO');
  await expect(page.locator('#modalContent')).toContainText('Informativos · não somados novamente');
  await expect(page.locator('#modalContent .overview-input-reconciliation')).toHaveCount(0);
  await expect(page.locator('.overview-input-projection-item strong').first()).toHaveText(
    'ADM5189',
  );
  await expect(page.locator('.overview-input-projection-item span').first()).toHaveText(
    'Serviço S05765',
  );
  await page.getByRole('button', { name: 'Fechar janela' }).click();

  await page.locator('#kpis').getByRole('button', { name: 'INCC' }).click();
  await expect(tendencyCard).toContainText('Gestão vs Licitação corrigida (INCC)');
  await expect(tendencyCard).toContainText('+20,00');
  await expect(page.locator('#overviewInputThead')).toContainText(
    'Orçamento Licitação Corrigido (INCC)',
  );
  await expect(rootRow).toContainText('110,00');
  await expect(rootRow).toContainText('+28,33');

  const differenceHeader = page.locator(
    '#overviewInputThead [data-sort-overview-input="difference"]',
  );
  await differenceHeader.click();
  await expect(differenceHeader).toHaveAttribute('aria-sort', 'descending');
  await page.getByRole('button', { name: 'Ordem original' }).click();
  await expect(differenceHeader).toHaveAttribute('aria-sort', 'none');

  const firstResizeHandle = page
    .locator('#overviewInputThead [data-overview-input-resize]')
    .first();
  await firstResizeHandle.focus();
  await page.keyboard.press('ArrowRight');
  expect(
    await page.evaluate(() => localStorage.getItem('jzurique_overview_input_column_widths_v1')),
  ).toContain('OBRA-VISAO');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar' }).last().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^visao-geral-insumos_OBRA-VISAO_\d{4}-\d{2}-\d{2}\.xlsx$/,
  );
});
