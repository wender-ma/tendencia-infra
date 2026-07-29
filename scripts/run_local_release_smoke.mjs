#!/usr/bin/env node

import { chromium } from 'playwright';

const target = process.env.LOCAL_APP_URL || 'http://127.0.0.1:4194/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
const failedRequests = [];

page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('requestfailed', (request) => {
  const failure = request.failure()?.errorText || 'falha desconhecida';
  if (!failure.includes('ERR_ABORTED')) {
    failedRequests.push(`${request.method()} ${request.url()} (${failure})`);
  }
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  assert(response?.ok(), `localhost respondeu HTTP ${response?.status()}`);
  await page.waitForFunction(
    () => window.dashboardServices?.performance.snapshot().boot.completed === true,
    null,
    { timeout: 30_000 },
  );

  const publicTabs = [
    'visao',
    'flows',
    'projecao',
    'projecao_ctrl',
    'detalhe',
    'historico',
    'manual',
  ];
  for (const tab of publicTabs) {
    const button = page.locator(`#tab-btn-${tab}`);
    await button.click();
    await page.locator(`#tab-${tab}`).waitFor({ state: 'visible' });
  }

  const projectOptions = await page.locator('#obraSelector option').count();
  assert(projectOptions > 0, 'nenhuma obra real foi carregada');
  if (projectOptions > 1) {
    const secondProject = await page.locator('#obraSelector option').nth(1).getAttribute('value');
    await page.locator('#obraSelector').selectOption(secondProject);
    await page.waitForFunction(
      (project) => window.dashboardServices?.state.obra.ativa === project,
      secondProject,
    );
  }

  await page.locator('#themeToggle').click();
  await page.locator('#authBtn').click();
  await page.locator('#loginModalBackdrop').waitFor({ state: 'visible' });
  assert(await page.locator('#loginTabSignup').isHidden(), 'autocadastro ainda esta visivel');
  assert(
    await page.locator('#loginPanelSignup').isHidden(),
    'painel de autocadastro ainda esta ativo',
  );

  const summary = await page.evaluate(() => ({
    projects: window.dashboardServices.state.obra.obras.length,
    activeProject: window.dashboardServices.state.obra.ativa,
    tendencyRows: window.dashboardServices.state.dados.tendencia.length,
    flowRows: window.dashboardServices.state.dados.flows.length,
    historyRows: window.dashboardServices.state.dados.historico.items.length,
    environment: window.dashboardServices.config.supabaseEnvironment.declared,
    datasetMode: window.dashboardServices.config.datasetPersistence.mode,
  }));

  assert(summary.environment === 'production', 'localhost nao usa configuracao de producao');
  assert(summary.datasetMode === 'snapshots', 'localhost nao usa snapshots');
  assert(summary.projects > 0, 'catalogo real esta vazio');
  assert(summary.flowRows > 0, 'base real de Flows esta vazia');
  assert(summary.historyRows > 0, 'base real de Gestoes esta vazia');
  assert(pageErrors.length === 0, `erros JavaScript: ${pageErrors.join(' | ')}`);
  assert(failedRequests.length === 0, `requisicoes falharam: ${failedRequests.join(' | ')}`);

  console.log(JSON.stringify({ healthy: true, target, ...summary }));
} finally {
  await browser.close();
}
