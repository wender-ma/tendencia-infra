const { expect, test } = require('@playwright/test');

async function openOfflineDashboard(page) {
  await page.route('https://*.supabase.co/**', (route) => route.abort());
  await page.goto('/');
  await page.waitForFunction(
    () => window.dashboardServices?.performance.snapshot().boot.completed === true,
  );
  await page.waitForFunction(() => window.AUTH?.ready === true);
}

test('troca de obra atualiza estado, seletor e URL', async ({ page }) => {
  await openOfflineDashboard(page);
  await page.evaluate(() => {
    window.AppState.obra.obras = [
      { codigo_obra: 'OBRA-A', nome: 'Obra A', ativa: true },
      { codigo_obra: 'OBRA-B', nome: 'Obra B', ativa: true },
    ];
    window.AppState.obra.ativa = 'OBRA-A';
    window.dashboardServices.projectController.renderObrasDropdown();
  });

  await page.locator('#obraSelector').selectOption('OBRA-B');
  await page.waitForFunction(() => window.AppState.obra.ativa === 'OBRA-B');
  await expect(page.locator('#obraSelector')).toHaveValue('OBRA-B');
  await expect(page.locator('#obraNomeGrande')).toHaveText('Obra B');
  await expect(page).toHaveURL(/(?:\?|&)obra=OBRA-B(?:&|$)/);
  await expect(page.locator('#loadingOverlay')).not.toHaveClass(/show/);
});

test('editor altera status de Flow preservando a obra ativa', async ({ page }) => {
  await openOfflineDashboard(page);
  await page.evaluate(() => {
    Object.assign(window.AUTH, {
      ready: true,
      user: { email: 'editor@example.com' },
      isAdminGeral: false,
      isEditor: true,
      isPending: false,
      editaObras: ['OBRA-A'],
    });
    window.AppState.obra.ativa = 'OBRA-A';
    window.AppState.dados.flows = [
      {
        codigo_obra: 'OBRA-A',
        n_alteracao: 'ADT-E2E-1',
        n_adt: '1',
        dep: 'Finalizado',
        tipo: 'aumento_real',
        motivo: 'Teste E2E',
        descricao: 'Aditivo controlado pelo teste',
        justificativa: '',
        data_br: '21/07/2026',
        custo_flowmaster: 100,
        refletido_status: 'pendente',
        insumo_planejamento: 'I-E2E',
        insumo_remanejamento: '',
      },
    ];
    window.updateAuthUI();
  });

  await page.locator('#tab-btn-flows').click();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  const status = page.locator('select.refletido-select[data-n="ADT-E2E-1"]');
  await expect(status).toBeEnabled();
  await status.selectOption('sim');
  await expect
    .poll(() => page.evaluate(() => window.AppState.dados.flows[0].refletido_status))
    .toBe('sim');
});

test('administrador abre catálogo com resposta Supabase controlada', async ({ page }) => {
  await openOfflineDashboard(page);
  await page.evaluate(() => {
    const fixtures = {
      obras: [
        {
          codigo_obra: 'OBRA-E2E',
          nome: 'Obra E2E',
          ativa: true,
          origem: 'manual',
          criada_em: '2026-07-21T12:00:00Z',
        },
      ],
      editores_permitidos: [],
    };
    window.SUPA.from = (table) => {
      const response = { data: fixtures[table] || [], error: null };
      const query = new Proxy(
        {},
        {
          get(_target, property) {
            if (property === 'then') {
              return (resolve, reject) => Promise.resolve(response).then(resolve, reject);
            }
            return () => query;
          },
        },
      );
      return query;
    };
    Object.assign(window.AUTH, {
      ready: true,
      user: { email: 'admin@example.com' },
      isAdminGeral: true,
      isEditor: true,
      isPending: false,
      editaObras: [],
    });
    window.updateAuthUI();
  });

  await page.locator('#tab-btn-admin').click();
  await expect(page.locator('#obrasAdminTbody')).toContainText('Obra E2E');
  await expect(page.locator('#obrasAdminTbody')).toContainText('OBRA-E2E');
  await expect(page.locator('#tab-admin')).toHaveClass(/active/);
});
