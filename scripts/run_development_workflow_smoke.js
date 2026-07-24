#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { once } = require('events');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '..');
const port = 4178;
const appUrl = `http://127.0.0.1:${port}/`;

function readEnvFile(fileName) {
  const filePath = path.join(root, fileName);
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        return [
          line.slice(0, separator).trim(),
          line
            .slice(separator + 1)
            .trim()
            .replace(/^(['"])(.*)\1$/, '$2'),
        ];
      }),
  );
}

const values = {
  ...readEnvFile('.env.development.local'),
  ...readEnvFile('.env.roles.local'),
  ...process.env,
};
const required = [
  'VITE_APP_ENV',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_TEST_ADMIN_EMAIL',
  'SUPABASE_TEST_ADMIN_PASSWORD',
  'SUPABASE_TEST_EDITOR_EMAIL',
  'SUPABASE_TEST_EDITOR_PASSWORD',
  'SUPABASE_TEST_EDITOR_PROJECT',
];
const missing = required.filter((name) => !String(values[name] || '').trim());
if (missing.length) {
  console.error(`Configuracao de desenvolvimento ausente: ${missing.join(', ')}`);
  process.exit(2);
}
if (values.VITE_APP_ENV !== 'development' || values.ALLOW_DEVELOPMENT_WRITES !== '1') {
  console.error('O smoke de workflows exige development e ALLOW_DEVELOPMENT_WRITES=1.');
  process.exit(2);
}

function newClient() {
  return createClient(values.VITE_SUPABASE_URL, values.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function authenticatedClient(label, email, password) {
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data?.user) throw new Error(`${label}: autenticacao recusada`);
  return client;
}

async function waitForServer(attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if ((await fetch(appUrl)).ok) return;
    } catch {
      // O Vite ainda esta subindo.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor de desenvolvimento nao iniciou dentro do prazo');
}

async function waitForRow(client, table, filters, predicate, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let query = client.from(table).select('*');
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (predicate(data)) return data;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${table}: alteracao remota nao apareceu dentro do prazo`);
}

async function openAuthenticatedPage(browser, email, password) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  const remoteWrites = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.hostname.endsWith('.supabase.co') &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
    ) {
      remoteWrites.push({ method: request.method(), pathname: url.pathname });
    }
  });
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      window.dashboardServices?.auth?.state?.ready === true &&
      window.dashboardServices?.performance?.snapshot().boot.completed === true,
  );
  const error = await page.evaluate(
    async ({ loginEmail, loginPassword }) => {
      const result = await window.dashboardServices.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });
      return result.error?.message || null;
    },
    { loginEmail: email, loginPassword: password },
  );
  if (error) throw new Error(`Login real recusado: ${error}`);
  await page.waitForFunction(
    (expectedEmail) =>
      window.dashboardServices?.auth?.state?.user?.email?.toLowerCase() ===
      expectedEmail.toLowerCase(),
    email,
  );
  return { context, page, pageErrors, remoteWrites };
}

function assertWrites(remoteWrites, allowedPaths) {
  const unexpected = remoteWrites.filter(
    ({ pathname }) => pathname !== '/auth/v1/token' && !allowedPaths.includes(pathname),
  );
  assert.deepStrictEqual(unexpected, [], 'Workflow tentou escrita remota inesperada');
}

async function verifyEditorWorkflow(browser, editorClient, marker, changeNumber) {
  const project = values.SUPABASE_TEST_EDITOR_PROJECT;
  const session = await openAuthenticatedPage(
    browser,
    values.SUPABASE_TEST_EDITOR_EMAIL,
    values.SUPABASE_TEST_EDITOR_PASSWORD,
  );
  try {
    await session.page.locator('#obraSelector').selectOption(project);
    await session.page.waitForFunction(
      (expected) => window.dashboardServices.state.obra.ativa === expected,
      project,
    );
    await session.page.waitForFunction(
      () => document.getElementById('loadingOverlay')?.getAttribute('aria-hidden') === 'true',
    );
    await session.page.evaluate(
      ({ codigoObra, nAlteracao }) => {
        window.dashboardServices.state.dados.flows = [
          {
            codigo_obra: codigoObra,
            n_alteracao: nAlteracao,
            n_adt: 'E2E',
            dep: 'Em andamento',
            tipo: 'aumento_real',
            motivo: 'Teste automatizado',
            descricao: 'Registro temporario',
            justificativa: '',
            data_br: '24/07/2026',
            custo_flowmaster: 1,
            refletido_status: 'pendente',
            insumo_planejamento: 'I-E2E',
            insumo_remanejamento: '',
          },
        ];
      },
      { codigoObra: project, nAlteracao: changeNumber },
    );
    await session.page.locator('#tab-btn-flows').click();
    await session.page.getByRole('button', { name: 'Limpar filtros' }).click();
    await session.page
      .locator(`select.refletido-select[data-n="${changeNumber}"]`)
      .selectOption('sim');
    await waitForRow(
      editorClient,
      'flow_classifications',
      { codigo_obra: project, n_alteracao: changeNumber },
      (row) => row?.refletido_status === 'sim',
    );
    assertWrites(session.remoteWrites, ['/rest/v1/flow_classifications']);
    assert.deepStrictEqual(session.pageErrors, []);
  } finally {
    await session.context.close();
  }
}

async function verifyAdminWorkflow(browser, adminClient, marker, projectCode) {
  const session = await openAuthenticatedPage(
    browser,
    values.SUPABASE_TEST_ADMIN_EMAIL,
    values.SUPABASE_TEST_ADMIN_PASSWORD,
  );
  try {
    await session.page.locator('#tab-btn-admin').click();
    await session.page.locator('[data-click-action="openObraForm"]').click();
    await session.page.locator('#obraFormCodigo').fill(projectCode);
    await session.page.locator('#obraFormNome').fill(`Obra temporaria ${marker}`);
    await session.page.locator('#obraFormObs').fill('Criada pelo smoke real e removida ao final');
    await session.page.locator('#obraForm').dispatchEvent('submit');
    await waitForRow(
      adminClient,
      'obras',
      { codigo_obra: projectCode },
      (row) => row?.origem === 'manual' && row?.ativa === true,
    );
    await session.page
      .locator(`#obrasAdminTbody tr[data-codigo="${projectCode}"]`)
      .waitFor({ state: 'visible' });
    assertWrites(session.remoteWrites, ['/rest/v1/obras']);
    assert.deepStrictEqual(session.pageErrors, []);
  } finally {
    await session.context.close();
  }
}

async function cleanup(editorClient, adminClient, changeNumber, projectCode) {
  const errors = [];
  if (changeNumber) {
    const { error } = await editorClient
      .from('flow_classifications')
      .delete()
      .eq('codigo_obra', values.SUPABASE_TEST_EDITOR_PROJECT)
      .eq('n_alteracao', changeNumber);
    if (error) errors.push(error);
  }
  if (projectCode) {
    const { data } = await adminClient
      .from('obras')
      .select('codigo_obra')
      .eq('codigo_obra', projectCode)
      .maybeSingle();
    if (data) {
      const { error } = await adminClient.rpc('admin_delete_obra', {
        p_codigo_obra: projectCode,
      });
      if (error) {
        const { error: fallbackError } = await adminClient
          .from('obras')
          .delete()
          .eq('codigo_obra', projectCode);
        errors.push(error);
        if (fallbackError) errors.push(fallbackError);
      }
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Limpeza dos workflows reais falhou');
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

async function main() {
  const [editorClient, adminClient] = await Promise.all([
    authenticatedClient(
      'editor',
      values.SUPABASE_TEST_EDITOR_EMAIL,
      values.SUPABASE_TEST_EDITOR_PASSWORD,
    ),
    authenticatedClient(
      'admin',
      values.SUPABASE_TEST_ADMIN_EMAIL,
      values.SUPABASE_TEST_ADMIN_PASSWORD,
    ),
  ]);
  const server = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/vite/bin/vite.js'),
      '--mode',
      'development',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd: root, stdio: 'ignore' },
  );
  let browser;
  const marker = Date.now().toString(36).slice(-8).toUpperCase();
  const changeNumber = `E2E-${marker}`;
  const projectCode = `E2E-${marker}`;
  let workflowError = null;
  const finalizationErrors = [];

  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    await verifyEditorWorkflow(browser, editorClient, marker, changeNumber);
    await verifyAdminWorkflow(browser, adminClient, marker, projectCode);
  } catch (error) {
    workflowError = error;
  }
  try {
    if (browser) await browser.close();
  } catch (error) {
    finalizationErrors.push(error);
  }
  try {
    await cleanup(editorClient, adminClient, changeNumber, projectCode);
  } catch (error) {
    finalizationErrors.push(error);
  }
  try {
    await stopServer(server);
  } catch (error) {
    finalizationErrors.push(error);
  }
  if (workflowError || finalizationErrors.length) {
    throw new AggregateError(
      [workflowError, ...finalizationErrors].filter(Boolean),
      'Workflow real ou sua limpeza falhou',
    );
  }

  console.log(
    JSON.stringify(
      {
        environment: 'development',
        editorUiClassification: 'validated-and-removed',
        adminUiProject: 'validated-and-removed',
        cleanupComplete: true,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
