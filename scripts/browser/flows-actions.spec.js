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
        refletido_status: 'pendente',
        insumo_planejamento: 'I001',
        insumo_remanejamento: '',
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
  await page.getByRole('button', { name: 'Cancelar' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar Excel' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^flows_OBRA-FLOWS_\d{4}-\d{2}-\d{2}\.xlsx$/);
  await expect(page.locator('#authToast')).toContainText('Excel exportado');
});
