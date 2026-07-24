#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');

async function main() {
  const helper = await import(
    pathToFileURL(path.join(root, 'scripts/lib/production_dataset_backfill.mjs')).href
  );
  const backfillRunner = await import(
    pathToFileURL(path.join(root, 'scripts/run_production_dataset_backfill.mjs')).href
  );
  const runner = fs.readFileSync(
    path.join(root, 'scripts/run_production_dataset_backfill.mjs'),
    'utf8',
  );
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

  const projectCode = 'OBRA-SENSIVEL';
  const marker = 'CONTEUDO-NAO-DEVE-SAIR';
  const rows = [
    { chave: `${projectCode}:dados_tendencia`, valor: JSON.stringify([{ marker }]) },
    { chave: 'dados_flows', valor: JSON.stringify([{ marker }]) },
    { chave: 'dados_historico', valor: JSON.stringify({ items: [{ marker }] }) },
    { chave: 'dados_projraw', valor: JSON.stringify([{ marker }]) },
  ];
  const plan = helper.buildBackfillPlan(rows);
  assert.strictEqual(plan.length, 4);
  assert.strictEqual(plan.filter((entry) => entry.scope === 'project').length, 1);

  const summary = helper.summarizeBackfillPlan(plan, { mode: 'plan' });
  assert.strictEqual(summary.dataset_count, 4);
  assert.strictEqual(summary.project_count, 1);
  assert.strictEqual(summary.legacy_keys_preserved, true);
  const serializedSummary = JSON.stringify(summary);
  assert(!serializedSummary.includes(projectCode), 'Resumo revelou codigo de obra');
  assert(!serializedSummary.includes(marker), 'Resumo revelou conteudo do dataset');

  assert.throws(
    () =>
      helper.buildBackfillPlan([
        ...rows,
        { chave: `${projectCode}:dados_flows`, valor: JSON.stringify([{ marker }]) },
      ]),
    /modelo global exige revisao manual/,
  );
  assert.throws(
    () =>
      helper.assertProductionTarget({
        environment: 'development',
        projectUrl: 'https://abcdefghijklmnopqrst.supabase.co',
        projectRef: 'abcdefghijklmnopqrst',
      }),
    /somente VITE_APP_ENV=production/,
  );
  assert.throws(
    () =>
      helper.assertBackfillMode({
        mode: 'apply',
        writeOptIn: '0',
        confirmation: 'BACKFILL_LEGACY_DATASETS',
      }),
    /ALLOW_PRODUCTION_BACKFILL=1/,
  );
  assert.throws(
    () =>
      helper.assertBackfillMode({
        mode: 'apply',
        writeOptIn: '1',
        confirmation: 'incorreta',
      }),
    /--confirmation BACKFILL_LEGACY_DATASETS/,
  );

  for (const contract of [
    'dashboard_datasets_deployment.complete',
    'active_snapshot_count !== 0',
    'rollbackSnapshots(activations)',
    'legacy_dataset_key_count',
    'SUPABASE_BACKFILL_ADMIN_EMAIL',
    'ALLOW_PRODUCTION_BACKFILL',
    "mode === 'plan'",
  ]) {
    assert(runner.includes(contract), `Protecao de backfill ausente: ${contract}`);
  }
  assert(!/service[_-]?role/i.test(runner), 'Runner nao pode exigir service role');
  assert(
    packageJson.scripts['backfill:production:datasets']?.includes('.env.production-backfill.local'),
    'Comando de backfill nao usa arquivo local dedicado',
  );
  assert(
    gitignore.includes('!.env.production-backfill.example'),
    'Template seguro de backfill nao esta versionado',
  );

  const projectRef = 'abcdefghijklmnopqrst';
  const baseArguments = {
    'project-ref': projectRef,
    'confirm-project-ref': projectRef,
    'expected-project-name': 'Producao Teste',
    mode: 'plan',
  };
  const baseEnvironment = {
    VITE_APP_ENV: 'production',
    VITE_SUPABASE_URL: `https://${projectRef}.supabase.co`,
    VITE_SUPABASE_ANON_KEY: 'anon-test',
    SUPABASE_ACCESS_TOKEN: 'pat-test',
    SUPABASE_BACKFILL_ADMIN_EMAIL: 'admin@example.com',
    SUPABASE_BACKFILL_ADMIN_PASSWORD: 'password-test',
  };
  const inventory = {
    project: { id: projectRef, name: 'Producao Teste' },
    dashboard_datasets_deployment: { complete: true },
    data_inventory: {
      legacy_dataset_key_count: 4,
      legacy_dataset_bytes: summary.legacy_bytes,
      active_snapshot_count: 0,
      backfill_review_required: true,
    },
  };
  let authenticationCount = 0;
  let executionCount = 0;
  const fakeClient = { auth: { signOut: async () => ({ error: null }) } };
  const dependencies = {
    auditInventory: async () => inventory,
    authenticate: async () => {
      authenticationCount += 1;
      return fakeClient;
    },
    loadRows: async () => rows,
    countActive: async () => 0,
    execute: async (_client, entries) => {
      executionCount += 1;
      return {
        activations: entries.map((_, index) => ({ id: index })),
        activeSnapshotCount: 4,
      };
    },
  };

  await assert.rejects(
    () =>
      backfillRunner.runBackfill({
        argumentsMap: baseArguments,
        environment: baseEnvironment,
        dependencies: {
          ...dependencies,
          auditInventory: async () => ({
            ...inventory,
            dashboard_datasets_deployment: { complete: false },
          }),
        },
      }),
    /Deployment de snapshots incompleto/,
  );
  assert.strictEqual(authenticationCount, 0, 'Deployment incompleto tentou autenticar');

  const planned = await backfillRunner.runBackfill({
    argumentsMap: baseArguments,
    environment: baseEnvironment,
    dependencies,
  });
  assert.strictEqual(planned.backfill.mode, 'plan');
  assert.strictEqual(planned.backfill.applied, false);
  assert.strictEqual(authenticationCount, 1);
  assert.strictEqual(executionCount, 0, 'Modo plan chamou o executor de escrita');

  await assert.rejects(
    () =>
      backfillRunner.runBackfill({
        argumentsMap: baseArguments,
        environment: baseEnvironment,
        dependencies: { ...dependencies, countActive: async () => 1 },
      }),
    /Snapshots ativos surgiram depois do inventario/,
  );
  assert.strictEqual(executionCount, 0, 'Snapshot concorrente permitiu escrita');

  const applied = await backfillRunner.runBackfill({
    argumentsMap: {
      ...baseArguments,
      mode: 'apply',
      confirmation: 'BACKFILL_LEGACY_DATASETS',
    },
    environment: { ...baseEnvironment, ALLOW_PRODUCTION_BACKFILL: '1' },
    dependencies,
  });
  assert.strictEqual(applied.backfill.applied, true);
  assert.strictEqual(applied.backfill.verified_snapshot_count, 4);
  assert.strictEqual(executionCount, 1);

  console.log('Backfill de producao: plano privado, gates de alvo e opt-in de escrita OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
