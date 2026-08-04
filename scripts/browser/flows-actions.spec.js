const { expect, test } = require('@playwright/test');

test('acoes principais de Flows abrem o formulario e exportam Excel', async ({ page }) => {
  await page.route('https://*.supabase.co/**', (route) => route.abort());
  await page.goto('/');
  await page.waitForFunction(
    () => window.dashboardServices?.performance.snapshot().boot.completed === true,
  );
  await page.waitForFunction(() => window.dashboardServices?.auth.state.ready === true);

  await page.evaluate(() => {
    const services = window.dashboardServices;
    services.state.obra.ativa = 'OBRA-FLOWS';
    services.state.dados.flows = [
      {
        codigo_obra: 'OBRA-FLOWS',
        n_alteracao: 'FLOW-E2E-1',
        dep: 'Finalizado',
        tipo: 'aumento_real',
        motivo: 'Teste de exportacao',
        descricao: 'Aditivo usado no teste dos comandos',
        data_br: '31/07/2026',
        custo_flowmaster: 1250.5,
        refletido_status: 'sim',
        refletido_mes: '2026-06',
        insumo_planejamento: 'I001',
        insumo_remanejamento: '',
        causa_desvio: 'nao_classificado',
        indice_inflacao: null,
      },
    ];
    Object.assign(services.auth.state, {
      ready: true,
      user: { email: 'editor@example.com' },
      isAdminGeral: false,
      isEditor: true,
      isPending: false,
      editaObras: ['OBRA-FLOWS'],
    });
    services.authUi.updateAuthUI();
  });

  await page.locator('#tab-btn-flows').click();

  await page.getByRole('button', { name: 'Novo aditivo' }).click();
  await expect(page.locator('#modalBg')).toHaveClass(/show/);
  await expect(page.locator('#modalContent h2')).toHaveText('➕ Novo aditivo manual');
  await page.locator('#m_dep').selectOption('Planejamento');
  await page.locator('#m_desc').fill('Novo Flow manual visível');
  await page.locator('#m_valor').fill('2.500,00');
  await page.getByRole('button', { name: 'Salvar aditivo manual' }).click();
  await expect(page.locator('#flowTbody')).toContainText('Novo Flow manual visível');
  expect(
    await page.evaluate(() =>
      window.dashboardServices.state.dados.flows.some(
        (flow) => flow.is_manual && flow.codigo_obra === 'OBRA-FLOWS',
      ),
    ),
  ).toBe(true);

  const firstRow = page.locator('#flowTbody tr[data-n="FLOW-E2E-1"]');
  await firstRow.locator('[data-field="insumo_remanejamento"]').fill('Não encontrado!');
  await firstRow.locator('[data-field="insumo_remanejamento"]').press('Tab');
  await expect(firstRow.locator('td').nth(6)).toContainText('Misto');
  await expect(firstRow.locator('td').nth(6)).not.toContainText('<span');
  await firstRow.locator('.flow-cause-select').selectOption('inflacao');
  await expect(firstRow.locator('.flow-index-select')).toBeVisible();
  await firstRow.locator('.flow-index-select').selectOption('ipca');
  await expect
    .poll(() =>
      page.evaluate(() => ({
        cause: window.dashboardServices.state.dados.flows[0].causa_desvio,
        index: window.dashboardServices.state.dados.flows[0].indice_inflacao,
      })),
    )
    .toEqual({ cause: 'inflacao', index: 'ipca' });

  await page.locator('#flowFilterRefletidoMes').fill('2026-06');
  await expect(page.locator('#flowTbody tr')).toHaveCount(1);
  await expect(page.locator('#flowTbody')).toContainText('FLOW-E2E-1');
  await page.locator('#flowFilterRefletidoMes').fill('2026-07');
  await expect(page.locator('#flowTbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.locator('#flowTbody tr')).toHaveCount(2);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar Excel' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^flows_OBRA-FLOWS_\d{4}-\d{2}-\d{2}\.xlsx$/);
  await expect(page.locator('#authToast')).toContainText('Excel exportado');
});
