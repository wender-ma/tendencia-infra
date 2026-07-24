#!/usr/bin/env node

const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const port = 4176;
const url = `http://127.0.0.1:${port}/`;
const safeRemoteMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

async function waitForServer(attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // O servidor de desenvolvimento ainda esta subindo.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor de desenvolvimento nao iniciou dentro do prazo');
}

async function main() {
  const server = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd: root, stdio: 'ignore' },
  );
  let browser;

  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    const remoteRequests = [];

    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (requestUrl.hostname.endsWith('.supabase.co')) {
        remoteRequests.push({
          method: request.method(),
          pathname: requestUrl.pathname,
        });
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        window.dashboardServices?.auth?.state?.ready === true &&
        window.dashboardServices?.performance?.snapshot().boot.completed === true,
      null,
      { timeout: 30_000 },
    );

    const runtime = await page.evaluate(() => ({
      activeProject: Boolean(window.dashboardServices.state.obra?.ativa),
      authReady: window.dashboardServices.auth.state.ready,
      authenticated: Boolean(window.dashboardServices.auth.state.user),
      bootCompleted: window.dashboardServices.performance.snapshot().boot.completed,
      buildMode: window.dashboardServices.config.supabaseEnvironment.buildMode,
      configStatus: window.dashboardServices.config.supabaseEnvironment.status,
      declaredEnvironment: window.dashboardServices.config.supabaseEnvironment.declared,
      datasetPersistenceMode: window.dashboardServices.config.datasetPersistence.mode,
      hasClient: Boolean(window.dashboardServices.supabase.client),
      syncState: document.getElementById('supaBadge')?.dataset.syncState || null,
    }));
    const unsafeRequests = remoteRequests.filter(
      (request) => !safeRemoteMethods.has(request.method),
    );
    const summary = {
      runtime,
      pageErrors,
      remoteRequestCount: remoteRequests.length,
      remoteMethods: [...new Set(remoteRequests.map((request) => request.method))].sort(),
      unsafeRequests,
    };
    console.log(JSON.stringify(summary, null, 2));

    if (runtime.configStatus !== 'ready') {
      throw new Error('Supabase de desenvolvimento nao configurado; revise .env.development.local');
    }
    if (runtime.declaredEnvironment !== 'development' || runtime.buildMode !== 'development') {
      throw new Error('O smoke remoto deve usar exclusivamente o modo development');
    }
    const requestedDatasetMode = process.env.VITE_DATASET_PERSISTENCE_MODE;
    if (
      requestedDatasetMode &&
      runtime.datasetPersistenceMode !== requestedDatasetMode.toLowerCase()
    ) {
      throw new Error('O modo de persistencia solicitado nao foi aplicado pelo frontend');
    }
    if (
      !runtime.hasClient ||
      !runtime.authReady ||
      runtime.authenticated ||
      !runtime.bootCompleted ||
      !runtime.activeProject ||
      runtime.syncState !== 'synced'
    ) {
      throw new Error(
        'Dashboard nao concluiu o boot anonimo esperado no ambiente de desenvolvimento',
      );
    }
    if (pageErrors.length > 0) {
      throw new Error(`Erros de pagina encontrados: ${pageErrors.join('; ')}`);
    }
    if (unsafeRequests.length > 0) {
      throw new Error('Smoke anonimo tentou executar requisicao remota de escrita');
    }
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
