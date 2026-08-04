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
      name: 'Enviar Tendência + Cronograma',
    }),
  ).toBeEnabled();
  await expect(
    page.locator('.project-tendency-card').nth(0).getByRole('button', {
      name: 'Histórico da Tendência',
    }),
  ).toBeVisible();
  await expect(
    page.locator('.project-tendency-card').nth(0).getByRole('button', {
      name: 'Histórico do Cronograma',
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
      name: 'Enviar Tendência + Cronograma',
    }),
  ).toBeDisabled();
  await expect(
    page.locator('.project-tendency-card[data-project="OBRA-B"]').getByRole('button', {
      name: 'Enviar Tendência + Cronograma',
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

test('fontes publicadas permanecem visíveis e empilhadas sem metadados privados', async ({
  page,
}) => {
  await openOfflineDashboard(page);
  await page.evaluate(() => {
    window.dashboardServices.state.dados.tendencia = [{ cod: '01.01' }];
    window.dashboardServices.state.dados.flows = [{ codigo_obra: 'OBRA-A' }];
    window.dashboardServices.state.dados.historico = {
      items: [{ codigo_obra: 'OBRA-A' }],
      gestoes: ['Atual'],
    };
    window.dashboardServices.state.dados.physicalSchedule = {
      items: [{ code: '1', description: 'Serviço', total: 100 }],
      months: ['2026-07'],
      curve: [{ month: '2026-07', planned: 35, actual: 31 }],
      cutoffMonth: '2026-07',
    };
    for (const kind of Object.keys(window.dashboardServices.state.uploads)) {
      window.dashboardServices.state.uploads[kind] = null;
    }
    window.dashboardServices.views.uploads.renderSourcesHeaders();
  });

  const sources = page.locator('#srcHeader_global .src-item');
  await expect(sources).toHaveCount(4);
  await expect(page.locator('#srcHeader_global')).toContainText('dados publicados');
  await expect(page.locator('#srcHeader_global')).not.toContainText('(sem dados)');
  await expect(page.locator('#srcHeader_global .src-list')).toHaveCSS('display', 'grid');
  const positions = await sources.evaluateAll((items) => items.map((item) => item.offsetTop));
  expect(new Set(positions).size).toBe(4);
});

test('histórico global gerencia planilhas ativas e arquivadas', async ({ page }) => {
  await openOfflineDashboard(page);
  const records = [
    {
      id: 10,
      tipo: 'flows',
      nome_arquivo: 'base-atual.xlsx',
      tamanho_bytes: 1000,
      linhas: 20,
      enviado_por: 'admin@example.com',
      enviado_em: '2026-07-29T12:00:00Z',
      storage_path: '_global/excel/base-atual.xlsx',
      upload_group_id: 'group-active',
      codigo_obra: null,
      is_active: true,
    },
    {
      id: 11,
      tipo: 'gestoes',
      nome_arquivo: 'base-atual.xlsx',
      tamanho_bytes: 1000,
      linhas: 30,
      enviado_por: 'admin@example.com',
      enviado_em: '2026-07-29T12:00:00Z',
      storage_path: '_global/excel/base-atual.xlsx',
      upload_group_id: 'group-active',
      codigo_obra: null,
      is_active: true,
    },
    {
      id: 12,
      tipo: 'flows',
      nome_arquivo: 'base-anterior.xlsx',
      tamanho_bytes: 900,
      linhas: 18,
      enviado_por: 'admin@example.com',
      enviado_em: '2026-07-28T12:00:00Z',
      storage_path: '_global/excel/base-anterior.xlsx',
      upload_group_id: 'group-archived',
      codigo_obra: null,
      is_active: false,
    },
    {
      id: 13,
      tipo: 'gestoes',
      nome_arquivo: 'base-anterior.xlsx',
      tamanho_bytes: 900,
      linhas: 28,
      enviado_por: 'admin@example.com',
      enviado_em: '2026-07-28T12:00:00Z',
      storage_path: '_global/excel/base-anterior.xlsx',
      upload_group_id: 'group-archived',
      codigo_obra: null,
      is_active: false,
    },
  ];
  await page.route('https://*.supabase.co/rest/v1/upload_history*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(records),
    }),
  );
  await page.evaluate(() => {
    window.dashboardServices.state.obra.ativa = 'OBRA-A';
    Object.assign(window.dashboardServices.auth.state, {
      ready: true,
      user: { id: 'admin-1', email: 'admin@example.com' },
      isAdminGeral: true,
      isEditor: true,
      isPending: false,
      editaObras: [],
    });
    window.dashboardServices.authUi.updateAuthUI();
  });

  await page.evaluate(() => window.dashboardServices.views.uploads.openExcelUploadsHistory());
  await expect(
    page.getByRole('heading', { name: 'Histórico de planilhas completas' }),
  ).toBeVisible();
  const activeRow = page.locator('#excelUploadsHistoryList tbody tr').filter({
    hasText: 'base-atual.xlsx',
  });
  const archivedRow = page.locator('#excelUploadsHistoryList tbody tr').filter({
    hasText: 'base-anterior.xlsx',
  });
  await expect(activeRow).toContainText('ATIVA');
  await expect(activeRow.getByRole('button', { name: 'Ativar' })).toHaveCount(0);
  await expect(activeRow.getByLabel('Excluir base-atual.xlsx')).toHaveCount(0);
  await expect(archivedRow.getByRole('button', { name: 'Ativar' })).toBeVisible();
  await expect(archivedRow.getByLabel('Excluir base-anterior.xlsx')).toBeVisible();
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
        '',
        '',
        '',
        '',
        'ITENS',
        '',
        'ORÇ. LICITAÇÃO',
        'IPCA 3,56%',
        'INCC 1,19%',
        'GESTÃO 07-2026',
        'DIFERENÇA',
        '',
        'EVOLUÇÃO TEÓRICA',
        'EVOLUÇÃO FINANCEIRA',
      ],
      [
        'Chave',
        'Código',
        'Serviço',
        'Insumo',
        'ÁREA VENDÁVEL = 100 m²',
        '',
        '100',
        '103,56',
        '101,19',
        '100',
        '0',
        '',
        '50%',
        '50%',
      ],
      [
        'OBRA-1-S001-I001-01.01.01',
        '01.01.01',
        'S001',
        'I001',
        'Serviço',
        '',
        '100',
        '103,56',
        '101,19',
        '100',
        '0',
        '',
        '50',
        '50',
      ],
    ]),
    'Base de orçamento',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['Cronograma físico financeiro exportado em 04/08/2026'],
      ['', '', '', '', '', '', '', '', '', '31/07/2026', ''],
      [
        'Nível',
        'Código EAP',
        'Descrição',
        'Início',
        'Fim',
        'Material (R$)',
        'Mão de obra (R$)',
        'Total (R$)',
        'Base',
        'Previsto',
        'Realizado',
      ],
      [1, '01', 'Serviço físico', '01/07/2026', '31/07/2026', 100, 0, 100, 100, 100, 100],
    ]),
    'Cronograma da obra',
  );

  await page.locator('#fileInput_project_bundle_0').setInputFiles({
    name: 'tendencia-cronograma-obra.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
  });

  await expect(page.getByRole('heading', { name: 'Mapeamento de abas' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('#mapSheet_tendencia')).toHaveValue('Base de orçamento');
  await expect(page.locator('#mapSheet_cronograma_fisico')).toHaveValue('Cronograma da obra');
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

test('upload global bloqueia obra ausente até confirmação individual e cancela sem escrever', async ({
  page,
}) => {
  await openOfflineDashboard(page);
  const projects = [
    { codigo_obra: '42-21O', nome: 'Zurique', ativa: false, origem: 'upload' },
    { codigo_obra: '18-JROMO', nome: 'Roma', ativa: true, origem: 'upload' },
  ];
  await page.route('https://*.supabase.co/rest/v1/obras*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(projects),
    }),
  );
  await page.evaluate((catalog) => {
    window.dashboardServices.state.obra.obras = catalog;
    window.dashboardServices.state.obra.ativa = '18-JROMO';
    window.dashboardServices.state.dados.flows = [
      ...Array.from({ length: 160 }, (_, index) => ({
        codigo_obra: '42-21O',
        n_alteracao: `Z-${index}`,
      })),
      { codigo_obra: '18-JROMO', n_alteracao: 'R-1' },
    ];
    window.dashboardServices.state.dados.historico = {
      items: [
        { codigo_obra: '42-21O', gestao: 'Atual' },
        { codigo_obra: '18-JROMO', gestao: 'Atual' },
      ],
      gestoes: ['Atual'],
    };
    Object.assign(window.dashboardServices.auth.state, {
      ready: true,
      user: { email: 'admin@example.com' },
      isAdminGeral: true,
      isEditor: true,
      isPending: false,
      editaObras: [],
    });
    window.dashboardServices.authUi.updateAuthUI();
  }, projects);
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
        '2',
        'Obras',
        '8/19/24 8:37',
        '100',
        'Escopo',
        '',
        'Engenharia',
        'Aditivo Roma',
        'JROMO',
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
      ['Atual', 'Obra', '42-21O-1-31005-S001-I001-01.01.01', '100', '01/07/2026'],
      ['Atual', 'Obra', '18-JROMO-1-31005-S001-I001-01.01.01', '100', '01/07/2026'],
    ]),
    'Gestões',
  );

  let remoteWrites = 0;
  page.on('request', (request) => {
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) &&
      request.url().includes('.supabase.co/')
    ) {
      remoteWrites += 1;
    }
  });
  await page.locator('#fileInput_excel').setInputFiles({
    name: 'bases-sem-zurique.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
  });

  await expect(page.getByRole('heading', { name: 'Obras ausentes no novo arquivo' })).toBeVisible({
    timeout: 15_000,
  });
  const coverageRow = page.locator('.upload-coverage-table tbody tr').filter({
    hasText: '42-21O',
  });
  await expect(coverageRow).toContainText('Zurique');
  await expect(coverageRow.locator('td').nth(2)).toHaveText('160');
  await expect(coverageRow.locator('td').nth(3)).toHaveText('0');
  await expect(coverageRow.locator('td').nth(4)).toHaveText('-160');
  const destructiveButton = page.getByRole('button', { name: 'Substituir mesmo assim' });
  await expect(destructiveButton).toBeDisabled();
  await coverageRow.getByRole('checkbox').check();
  await expect(destructiveButton).toBeEnabled();
  await coverageRow.getByRole('checkbox').uncheck();
  await expect(destructiveButton).toBeDisabled();
  await page.getByRole('button', { name: 'Cancelar upload' }).click();

  await expect(page.getByRole('heading', { name: 'Obras ausentes no novo arquivo' })).toBeHidden();
  expect(remoteWrites).toBe(0);
  expect(
    await page.evaluate(
      () =>
        window.dashboardServices.state.dados.flows.filter((flow) => flow.codigo_obra === '42-21O')
          .length,
    ),
  ).toBe(160);
});
