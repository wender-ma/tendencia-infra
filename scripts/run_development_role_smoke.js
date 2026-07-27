#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { once } = require('events');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const environmentDirectory = path.join(root, 'config', 'env');
const port = 4177;
const appUrl = `http://127.0.0.1:${port}/`;
const safeRemoteMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const allowedAuthWrites = new Set(['/auth/v1/token']);

function readEnvFile(fileName) {
  const filePath = path.join(environmentDirectory, fileName);
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        const name = line.slice(0, separator).trim();
        const rawValue = line.slice(separator + 1).trim();
        return [name, rawValue.replace(/^(['"])(.*)\1$/, '$2')];
      }),
  );
}

const values = {
  ...readEnvFile('.env.development.local'),
  ...readEnvFile('.env.roles.local'),
  ...process.env,
};

const requiredVariables = [
  'VITE_SUPABASE_URL',
  'SUPABASE_TEST_ADMIN_EMAIL',
  'SUPABASE_TEST_ADMIN_PASSWORD',
  'SUPABASE_TEST_EDITOR_EMAIL',
  'SUPABASE_TEST_EDITOR_PASSWORD',
  'SUPABASE_TEST_EDITOR_PROJECT',
  'SUPABASE_TEST_REJECTED_EMAIL',
  'SUPABASE_TEST_REJECTED_PASSWORD',
];
const missingVariables = requiredVariables.filter((name) => !String(values[name] || '').trim());

if (missingVariables.length) {
  console.error(
    `Configuracao ausente em config/env/.env.roles.local: ${missingVariables.join(', ')}. ` +
      'Use config/env/.env.roles.example como referencia.',
  );
  process.exit(2);
}

const projectUrl = new URL(values.VITE_SUPABASE_URL);
if (!projectUrl.hostname.endsWith('.supabase.co')) {
  console.error('VITE_SUPABASE_URL nao identifica um projeto hospedado no Supabase.');
  process.exit(2);
}

const profiles = [
  {
    name: 'admin',
    email: values.SUPABASE_TEST_ADMIN_EMAIL,
    password: values.SUPABASE_TEST_ADMIN_PASSWORD,
  },
  {
    name: 'editor',
    email: values.SUPABASE_TEST_EDITOR_EMAIL,
    password: values.SUPABASE_TEST_EDITOR_PASSWORD,
    project: values.SUPABASE_TEST_EDITOR_PROJECT,
  },
  {
    name: 'rejected',
    email: values.SUPABASE_TEST_REJECTED_EMAIL,
    password: values.SUPABASE_TEST_REJECTED_PASSWORD,
  },
];

async function waitForServer(attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(appUrl);
      if (response.ok) return;
    } catch {
      // O servidor de desenvolvimento ainda esta subindo.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Servidor de desenvolvimento nao iniciou dentro do prazo');
}

function assertProfile(profile, snapshot) {
  if (!snapshot.emailMatches || !snapshot.whitelistChecked) {
    throw new Error(`${profile.name}: sessao ou whitelist nao foi confirmada`);
  }
  if (profile.name === 'admin') {
    if (
      snapshot.role !== 'admin' ||
      !snapshot.isAdmin ||
      !snapshot.isEditor ||
      !snapshot.canEditActiveProject
    ) {
      throw new Error('admin: permissoes reais divergentes');
    }
    return;
  }
  if (profile.name === 'editor') {
    if (
      snapshot.role !== 'editor' ||
      snapshot.isAdmin ||
      !snapshot.isEditor ||
      !snapshot.canEditActiveProject ||
      !snapshot.editableProjects.includes(profile.project)
    ) {
      throw new Error('editor: escopo real da obra divergente');
    }
    return;
  }
  if (
    snapshot.role !== null ||
    snapshot.isAdmin ||
    snapshot.isEditor ||
    snapshot.canEditActiveProject
  ) {
    throw new Error('rejected: conta recebeu permissao indevida');
  }
}

async function verifyProfile(browser, profile) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  const remoteRequests = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (!requestUrl.hostname.endsWith('.supabase.co')) return;
    remoteRequests.push({
      method: request.method(),
      pathname: requestUrl.pathname,
    });
  });

  try {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        window.dashboardServices?.auth?.state?.ready === true &&
        window.dashboardServices?.performance?.snapshot().boot.completed === true,
      null,
      { timeout: 30_000 },
    );

    const login = await page.evaluate(
      async ({ email, password }) => {
        const result = await window.dashboardServices.auth.signInWithPassword({
          email,
          password,
        });
        return result.error
          ? { error: result.error.message || result.error.code || 'falha desconhecida' }
          : { error: null };
      },
      { email: profile.email, password: profile.password },
    );
    if (login.error) throw new Error(`${profile.name}: login recusado (${login.error})`);

    await page.waitForFunction(
      (email) => {
        const state = window.dashboardServices?.auth?.state;
        return (
          state?.ready === true &&
          state?.whitelistChecked === true &&
          state?.user?.email?.toLowerCase() === email.toLowerCase()
        );
      },
      profile.email,
      { timeout: 20_000 },
    );

    if (profile.project) {
      const hasProject = await page
        .locator('#obraSelector option')
        .evaluateAll(
          (options, project) => options.some((option) => option.value === project),
          profile.project,
        );
      if (!hasProject) throw new Error('editor: obra esperada nao existe no seletor');
      await page.locator('#obraSelector').selectOption(profile.project);
      await page.waitForFunction(
        (project) => window.dashboardServices?.state?.obra?.ativa === project,
        profile.project,
        { timeout: 20_000 },
      );
    }

    const snapshot = await page.evaluate((expectedEmail) => {
      const services = window.dashboardServices;
      const state = services.auth.state;
      return {
        emailMatches: state.user?.email?.toLowerCase() === expectedEmail.toLowerCase(),
        whitelistChecked: state.whitelistChecked,
        role: state.role,
        isAdmin: services.auth.isAdmin(),
        isEditor: state.isEditor,
        canEditActiveProject: services.auth.canEditActiveProject(),
        editableProjects: [...state.editaObras],
        activeProject: services.state.obra.ativa,
      };
    }, profile.email);

    const unexpectedWrites = remoteRequests.filter(
      ({ method, pathname }) => !safeRemoteMethods.has(method) && !allowedAuthWrites.has(pathname),
    );
    if (unexpectedWrites.length) {
      throw new Error(
        `${profile.name}: smoke tentou escrita remota fora do login: ` +
          unexpectedWrites.map(({ method, pathname }) => `${method} ${pathname}`).join(', '),
      );
    }
    if (pageErrors.length) {
      throw new Error(`${profile.name}: erros de pagina: ${pageErrors.join('; ')}`);
    }

    assertProfile(profile, snapshot);
    return {
      profile: profile.name,
      role: snapshot.role,
      activeProject: snapshot.activeProject,
      editableProjectCount: snapshot.editableProjects.length,
      remoteRequestCount: remoteRequests.length,
      remoteMethods: [...new Set(remoteRequests.map(({ method }) => method))].sort(),
      unexpectedWrites: [],
    };
  } finally {
    await context.close();
  }
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    once(server, 'exit'),
    new Promise((resolve) =>
      setTimeout(() => {
        if (server.exitCode === null) server.kill('SIGKILL');
        resolve();
      }, 2_000),
    ),
  ]);
}

async function main() {
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

  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const results = [];
    for (const profile of profiles) results.push(await verifyProfile(browser, profile));
    console.log(
      JSON.stringify(
        {
          project: projectUrl.hostname.slice(0, -'.supabase.co'.length),
          readOnlyDataSmoke: true,
          profiles: results,
        },
        null,
        2,
      ),
    );
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
