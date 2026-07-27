#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { createClient } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '..');
const environmentDirectory = path.join(root, 'config', 'env');

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
  'VITE_APP_ENV',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
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
  console.error(`Configuracao de desenvolvimento ausente: ${missingVariables.join(', ')}`);
  process.exit(2);
}
if (values.VITE_APP_ENV !== 'development') {
  console.error('O smoke de snapshots aceita somente VITE_APP_ENV=development.');
  process.exit(2);
}
if (values.ALLOW_DEVELOPMENT_WRITES !== '1') {
  console.error(
    'Escritas de teste desabilitadas. Execute com ALLOW_DEVELOPMENT_WRITES=1 somente em desenvolvimento.',
  );
  process.exit(2);
}

const projectUrl = new URL(values.VITE_SUPABASE_URL);
const projectRef = projectUrl.hostname.endsWith('.supabase.co')
  ? projectUrl.hostname.slice(0, -'.supabase.co'.length)
  : '';
if (!projectRef) {
  console.error('VITE_SUPABASE_URL nao identifica um projeto hospedado no Supabase.');
  process.exit(2);
}

function newClient() {
  return createClient(values.VITE_SUPABASE_URL, values.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function authenticatedClient(profile, email, password) {
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data?.user) {
    throw new Error(`${profile}: autenticacao recusada (${error?.message || 'sem usuario'})`);
  }
  return client;
}

async function expectDenied(operation, label, repository) {
  let unexpectedResult;
  try {
    unexpectedResult = await operation();
  } catch {
    return;
  }
  const activations = unexpectedResult?.activations || [];
  if (activations.length) {
    try {
      await repository.rollbackSnapshots(activations);
    } catch (cleanupError) {
      throw new AggregateError(
        [new Error(`${label}: operacao indevida foi aceita`), cleanupError],
        `${label}: autorizacao e limpeza falharam`,
      );
    }
  }
  throw new Error(`${label}: operacao indevida foi aceita`);
}

async function lifecycle(repository, kind, firstData, secondData, load, expectedData) {
  const pendingActivations = [];
  try {
    const first = await repository.saveForUpload([kind], firstData);
    assert.strictEqual(first.available, true);
    assert.strictEqual(first.activations.length, 1);
    pendingActivations.push(...first.activations);
    assert.deepStrictEqual(await load(), expectedData(firstData));

    const second = await repository.saveForUpload([kind], secondData);
    assert.strictEqual(second.available, true);
    assert.strictEqual(second.activations.length, 1);
    assert.strictEqual(
      second.activations[0].previous?.id,
      first.activations[0].current.id,
      `${kind}: segunda versao nao referenciou a anterior`,
    );
    pendingActivations.push(...second.activations);
    assert.deepStrictEqual(await load(), expectedData(secondData));

    await repository.rollbackSnapshots(second.activations);
    pendingActivations.splice(-second.activations.length);
    assert.deepStrictEqual(await load(), expectedData(firstData));

    await repository.rollbackSnapshots(first.activations);
    pendingActivations.splice(-first.activations.length);
    assert.strictEqual(await load(), null);
  } finally {
    if (pendingActivations.length) {
      await repository.rollbackSnapshots(pendingActivations);
    }
  }
}

async function main() {
  const moduleUrl = pathToFileURL(
    path.join(root, 'assets/js/services/dashboard-dataset-repository.mjs'),
  );
  const { createDashboardDatasetRepository } = await import(moduleUrl.href);
  const project = values.SUPABASE_TEST_EDITOR_PROJECT;
  const [adminClient, editorClient, rejectedClient] = await Promise.all([
    authenticatedClient(
      'admin',
      values.SUPABASE_TEST_ADMIN_EMAIL,
      values.SUPABASE_TEST_ADMIN_PASSWORD,
    ),
    authenticatedClient(
      'editor',
      values.SUPABASE_TEST_EDITOR_EMAIL,
      values.SUPABASE_TEST_EDITOR_PASSWORD,
    ),
    authenticatedClient(
      'rejected',
      values.SUPABASE_TEST_REJECTED_EMAIL,
      values.SUPABASE_TEST_REJECTED_PASSWORD,
    ),
  ]);

  const repositories = {
    admin: createDashboardDatasetRepository({
      getClient: () => adminClient,
      getActiveProject: () => project,
    }),
    editor: createDashboardDatasetRepository({
      getClient: () => editorClient,
      getActiveProject: () => project,
    }),
    rejected: createDashboardDatasetRepository({
      getClient: () => rejectedClient,
      getActiveProject: () => project,
    }),
  };
  const marker = `snapshot-smoke-${Date.now()}`;

  await expectDenied(
    () =>
      repositories.rejected.saveForUpload(['tendencia'], {
        tendency: [{ codigo_obra: project, marker, version: 0 }],
      }),
    'rejected/tendencia',
    repositories.rejected,
  );
  await expectDenied(
    () =>
      repositories.editor.saveForUpload(['flows'], {
        flows: [{ codigo_obra: project, marker, version: 0 }],
      }),
    'editor/flows-global',
    repositories.editor,
  );

  const firstTendency = [{ codigo_obra: project, marker, version: 1 }];
  const secondTendency = [{ codigo_obra: project, marker, version: 2 }];
  await lifecycle(
    repositories.editor,
    'tendencia',
    { tendency: firstTendency },
    { tendency: secondTendency },
    async () => (await repositories.editor.loadSnapshot('tendencia', project))?.data || null,
    (data) => data.tendency,
  );

  const firstFlows = [{ codigo_obra: project, marker, version: 1 }];
  const secondFlows = [{ codigo_obra: project, marker, version: 2 }];
  await lifecycle(
    repositories.admin,
    'flows',
    { flows: firstFlows },
    { flows: secondFlows },
    async () => (await repositories.admin.loadSnapshot('flows', null))?.data || null,
    (data) => data.flows,
  );

  const verificationClient = newClient();
  const { count: activeCount, error: activeError } = await verificationClient
    .from('dashboard_datasets')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');
  if (activeError) throw activeError;
  assert.strictEqual(activeCount, 0, 'Snapshots ativos de teste permaneceram no ambiente');

  const { count: metadataCount, error: metadataError } = await adminClient
    .from('dashboard_datasets')
    .select('id', { count: 'exact', head: true });
  if (metadataError) throw metadataError;
  assert.strictEqual(metadataCount, 0, 'Metadata inativa permaneceu após o ciclo de teste');

  const { data: projectObjects, error: projectObjectsError } = await adminClient.storage
    .from('dashboard-datasets')
    .list(`${project}/tendencia`, { limit: 100 });
  if (projectObjectsError) throw projectObjectsError;
  const { data: globalObjects, error: globalObjectsError } = await adminClient.storage
    .from('dashboard-datasets')
    .list('_global/flows', { limit: 100 });
  if (globalObjectsError) throw globalObjectsError;
  const residualObjectCount = (projectObjects?.length || 0) + (globalObjects?.length || 0);
  assert.strictEqual(residualObjectCount, 0, 'Objetos inativos permaneceram após o ciclo de teste');

  console.log(
    JSON.stringify(
      {
        project: projectRef,
        developmentWritesAuthorized: true,
        deniedByRls: ['rejected/tendencia', 'editor/flows-global'],
        validatedLifecycles: ['editor/tendencia', 'admin/flows-global'],
        versionsPerLifecycle: 2,
        activeSnapshotsAfterCleanup: activeCount,
        residualMetadataAfterCleanup: metadataCount,
        residualObjectsAfterCleanup: residualObjectCount,
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
