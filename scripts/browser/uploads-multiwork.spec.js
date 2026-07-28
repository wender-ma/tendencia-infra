const { expect, test } = require('@playwright/test');
const XLSX = require('xlsx');

async function openOfflineDashboard(page) {
  await page.route('https://*.supabase.co/**', (route) => route.abort());
  await page.goto('/');
  await page.waitForFunction(
    () => window.dashboardServices?.performance.snapshot().boot.completed === true,
  );
  await page.waitForFunction(() => window.dashboardServices?.auth.state.ready === true);
}

test('uploads ficam privados e separam bases globais das Tendências por obra', async ({
  page,
}) => {
  await openOfflineDashboard(page);
  await expect(page.locator('#tab-btn-uploads')).toBeHidden();

  await page.evaluate(() => {
    window.dashboardServices.state.obra.obras = [
      { codigo_obra: 'OBRA-A', nome: 'Obra Alfa', ativa: true },
      { codigo_obra: 'OBRA-B', nome: 'Obra Beta', ativa: true },
    ];
    window.dashboardServices.state.obra.ativa = 'OBRA-A';
    Object.assign(window.dashboardServices.auth.state, {
      ready: true,
      user: { email: 'admin@example.com' },
      isAdminGeral: true,
      isEditor: true,
      isPending: false,
      editaObras: [],
    });
    window.dashboardServices.authUi.updateAuthUI();
  });

  await expect(page.locator('#tab-btn-uploads')).toBeVisible();
  await page.locator('#tab-btn-uploads').click();
  await expect(page.locator('.upload-impact-grid')).toContainText('Todas as obras');
  await expect(page.locator('.upload-global-section')).toContainText('Gestões + Flows');
  await expect(page.locator('.project-tendency-card')).toHaveCount(2);
  await expect(page.locator('.project-tendency-card').nth(0)).toContainText('Obra Alfa');
  await expect(page.locator('.project-tendency-card').nth(1)).toContainText('Obra Beta');
  await expect(
    page.locator('.project-tendency-card').nth(0).getByRole('button', {
      name: 'Enviar Tendência',
    }),
  ).toBeEnabled();
  await expect(
    page.locator('.project-tendency-card').nth(0).getByRole('button', {
      name: 'Histórico da obra',
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dados desta obra' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dados globais' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arquivos desta obra' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arquivos globais' })).toBeVisible();

  await page.evaluate(() => {
    Object.assign(window.dashboardServices.auth.state, {
      isAdminGeral: false,
      isEditor: true,
      editaObras: ['OBRA-B'],
    });
    window.dashboardServices.authUi.updateAuthUI();
    window.dashboardServices.views.uploads.renderUploadsCentral();
  });
  await expect(
    page.locator('.project-tendency-card[data-project="OBRA-A"]').getByRole('button', {
      name: 'Enviar Tendência',
    }),
  ).toBeDisabled();
  await expect(
    page.locator('.project-tendency-card[data-project="OBRA-B"]').getByRole('button', {
      name: 'Enviar Tendência',
    }),
  ).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileColumns = await page
    .locator('.project-tendency-grid')
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(mobileColumns).toBe(1);
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasOverflow).toBe(false);
});

test('upload global apresenta novas obras e permite cancelar sem cadastrar', async ({ page }) => {
  await openOfflineDashboard(page);
  await page.evaluate(() => {
    window.dashboardServices.state.obra.obras = [
      { codigo_obra: '42-21O', nome: 'Obra Atual', ativa: true },
    ];
    window.dashboardServices.state.obra.ativa = '42-21O';
    Object.assign(window.dashboardServices.auth.state, {
      ready: true,
      user: { email: 'admin@example.com' },
      isAdminGeral: true,
      isEditor: true,
      isPending: false,
      editaObras: [],
    });
    window.dashboardServices.authUi.updateAuthUI();
  });
  await page.locator('#tab-btn-uploads').click();

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [
        'Cod_aditivo',
        'Descr_status',
        'Descr_areaatual',
        'Descr_setorcriacao',
        'Data_criacao',
        'Descr_motivo',
        'Descr_observacao_motivo',
        'Descr_descricaoaditivo',
        'Cod_obra',
        'Valor Aprovado ou Solicitado',
        'Vlr_planejamento',
        'Departamento',
        'Ins. Planej.',
        'Ins. Remanej.',
        'Refletido',
      ],
      [
        '1',
        'Aprovado',
        'Engenharia',
        'Obras',
        '20/07/2026',
        'Escopo',
        '',
        'Novo aditivo',
        'NEW',
        '100',
        '100',
        'Engenharia',
        'I001',
        '-',
        'Não',
      ],
    ]),
    'FlowsValor',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [
        'Descr_gestao',
        'Descr_classificacaofinanceira',
        'Key_planejamento',
        'Val_totalliquido',
        'Mes_pagamento',
      ],
      ['Atual', 'Obra', '88-NEW-1-31005-S001-I001-01.01.01', '100', '01/07/2026'],
    ]),
    'Gestões',
  );

  let projectWrites = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/rest/v1/obras')) {
      projectWrites += 1;
    }
  });
  await page.locator('#fileInput_excel').setInputFiles({
    name: 'bases-globais.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
  });

  await expect(page.getByRole('heading', { name: 'Novas obras encontradas' })).toBeVisible();
  await expect(page.locator('.upload-project-preview')).toContainText('88-NEW');
  await expect(page.locator('[data-project-name="0"]')).toHaveValue('88-NEW');
  await page.getByRole('button', { name: 'Cancelar upload' }).click();
  await expect(page.getByRole('heading', { name: 'Novas obras encontradas' })).toBeHidden();
  expect(projectWrites).toBe(0);
  expect(
    await page.evaluate(() => window.dashboardServices.state.obra.obras.map((obra) => obra.codigo_obra)),
  ).toEqual(['42-21O']);
});
