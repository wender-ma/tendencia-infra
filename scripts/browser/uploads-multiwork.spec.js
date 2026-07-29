const { expect, test } = require('@playwright/test');
const XLSX = require('xlsx');

async function openOfflineDashboard(page) {
  await page.route('https://*.supabase.co/**', (route) => route.abort());
  await page.goto('/');
  await page.waitForFunction(
    () => window.dashboardServices?.performance.snapshot().boot.completed === true,
  );
  await page.waitForFunction(() => window.dashboardServices?.auth.state.ready === true);
  await page.evaluate(async () => {
    window.dashboardServices.auth.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test('uploads ficam privados e separam bases globais das Tendências por obra', async ({ page }) => {
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

test('Tendência multiaba identifica cabeçalhos e pede confirmação', async ({ page }) => {
  await openOfflineDashboard(page);
  await page.evaluate(() => {
    window.dashboardServices.state.obra.obras = [
      { codigo_obra: 'OBRA-A', nome: 'Obra Alfa', ativa: true },
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
  await page.locator('#tab-btn-uploads').click();

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['Indicador', 'Valor'],
      ['Atualização', 'Julho'],
    ]),
    'Resumo',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [
        'Item',
        'Código',
        'Serviço',
        'Insumo',
        'Orçamento Licitação',
        'IPCA',
        'INCC',
        'Gestão 07-2026',
        'Diferença',
        'Evolução Teórica',
        'Evolução Financeira',
      ],
      ['1', '01', 'Serviço', 'I001', '100', '0', '0', '100', '0', '50%', '50%'],
    ]),
    'Base de orçamento',
  );

  await page.locator('#fileInput_tendencia_0').setInputFiles({
    name: 'tendencia-obra.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
  });

  await expect(page.getByRole('heading', { name: 'Mapeamento de abas' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('#mapSheet_tendencia')).toHaveValue('Base de orçamento');
  await expect(page.locator('#modalContent')).toContainText(
    'identificadas pelo nome ou pelos cabeçalhos',
  );
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mapeamento de abas' })).toBeHidden();
});

test('upload global apresenta novas obras e permite cancelar sem cadastrar', async ({ page }) => {
  await openOfflineDashboard(page);
  await page.route('https://*.supabase.co/rest/v1/obras*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { codigo_obra: '42-21O', nome: 'Obra Atual', ativa: true },
        { codigo_obra: '66-JDFMO', nome: 'Obra Inativa', ativa: false },
      ]),
    }),
  );
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
        'Descr_etiqueta',
        'Cod_aditivo',
        'Descr_setorcriacao',
        'Data_criacao',
        'Vlr_estimado',
        'Descr_motivo',
        'Descr_observacao_motivo',
        'Descr_areaatual',
        'Descr_descricaoaditivo',
        'Cod_obra',
        'Descr_usuariocriacao',
        'Descr_status',
        'Valor Aprovado ou Solicitado',
        'Vlr_planejamento',
      ],
      [
        'Em aprovação',
        '1',
        'Obras',
        '8/19/24 8:37',
        '100',
        'Escopo',
        '',
        'Engenharia',
        'Novo aditivo',
        'NEW',
        'Usuário',
        'Ativo',
        '100',
        '100',
      ],
    ]),
    'Aditivos_flowmaster',
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
      ['Atual', 'Obra', '66-JDFMO-1-31005-S001-I001-01.01.01', '100', '01/07/2026'],
      ['Atual', 'Obra', '99-OTHER-1-31005-S001-I001-01.01.01', '100', '01/07/2026'],
    ]),
    'Gestões',
  );

  let projectWrites = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      (request.url().includes('/rest/v1/obras') ||
        request.url().includes('/rest/v1/rpc/admin_register_upload_projects'))
    ) {
      projectWrites += 1;
    }
  });
  await page.locator('#fileInput_excel').setInputFiles({
    name: 'bases-globais.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
  });

  await expect(page.getByRole('heading', { name: 'Novas obras encontradas' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.upload-project-preview')).toContainText('88-NEW');
  await expect(page.locator('.upload-project-preview')).toContainText('99-OTHER');
  await expect(page.locator('.upload-project-preview')).not.toContainText('66-JDFMO');
  await expect(page.locator('[data-project-enabled]')).toHaveCount(2);
  await expect(page.locator('[data-project-enabled]').nth(0)).toBeChecked();
  await expect(page.locator('[data-project-enabled]').nth(1)).toBeChecked();
  await expect(page.locator('[data-project-name="0"]')).toHaveValue('88-NEW');
  await page.locator('[data-project-enabled="1"]').uncheck();
  await expect(page.locator('[data-project-name="1"]')).toBeDisabled();
  await expect(page.locator('#newProjectsSelectionSummary')).toHaveText(
    '1 de 2 obra(s) selecionada(s) para cadastro.',
  );
  await page.getByRole('button', { name: 'Cancelar upload' }).click();
  await expect(page.getByRole('heading', { name: 'Novas obras encontradas' })).toBeHidden();
  expect(projectWrites).toBe(0);
  expect(
    await page.evaluate(() =>
      window.dashboardServices.state.obra.obras.map((obra) => obra.codigo_obra),
    ),
  ).toEqual(['42-21O', '66-JDFMO']);
});
