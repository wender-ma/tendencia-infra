#!/usr/bin/env node

const assert = require('assert');

(async () => {
  const { READ_ONLY_QUERIES, assertReadOnlyQuery, assertTarget, buildSummary, parseArguments } =
    await import('./audit_supabase_inventory.mjs');

  assert.deepStrictEqual(
    parseArguments([
      '--project-ref',
      'abcdefghijklmnopqrst',
      '--confirm-project-ref=abcdefghijklmnopqrst',
    ]),
    {
      'project-ref': 'abcdefghijklmnopqrst',
      'confirm-project-ref': 'abcdefghijklmnopqrst',
    },
  );

  assert.throws(
    () =>
      assertTarget({
        projectRef: 'abcdefghijklmnopqrst',
        confirmedProjectRef: 'different-project-ref',
      }),
    /Alvo nao confirmado/,
  );
  assert.doesNotThrow(() =>
    assertTarget({
      projectRef: 'abcdefghijklmnopqrst',
      confirmedProjectRef: 'abcdefghijklmnopqrst',
    }),
  );

  for (const query of Object.values(READ_ONLY_QUERIES)) {
    assert.doesNotThrow(() => assertReadOnlyQuery(query));
  }
  assert.throws(() => assertReadOnlyQuery('delete from public.dashboard_config'), /recusou/);
  assert.throws(
    () => assertReadOnlyQuery('with changed as (update public.dashboard_config set valor = null)'),
    /alterar o banco/,
  );

  const summary = buildSummary({
    project: {
      id: 'abcdefghijklmnopqrst',
      name: 'Desenvolvimento',
      status: 'ACTIVE_HEALTHY',
      region: 'us-east-1',
    },
    deployment: {
      dashboard_config_exists: true,
      table_exists: true,
      activate_rpc_exists: true,
      fail_rpc_exists: true,
      rollback_rpc_exists: true,
      reset_rpc_exists: true,
      rls_enabled: true,
      private_bucket_exists: true,
      table_policy_count: 4,
      storage_policy_count: 4,
    },
    legacyRows: [{ scope: 'project', tipo: 'tendencia', key_count: 2, bytes: 900 }],
    snapshotRows: [
      {
        scope: 'project',
        tipo: 'tendencia',
        status: 'active',
        snapshot_count: 2,
        bytes: 700,
      },
    ],
    storageRows: [{ object_count: 2 }],
    operationalRows: [
      {
        relation_name: 'flow_manuals',
        row_count: '3',
        first_activity_at: '2026-07-20 10:00:00+00',
        last_activity_at: '2026-07-21 10:00:00+00',
        unscoped_row_count: '0',
      },
      {
        relation_name: 'upload_history',
        row_count: 2,
        first_activity_at: null,
        last_activity_at: null,
        unscoped_row_count: 1,
      },
    ],
    releaseHardening: {
      register_rpc_exists: true,
      rollback_rpc_exists: true,
      required_policy_count: 4,
      anon_select_column_count: 59,
      anon_sensitive_columns_blocked: true,
    },
  });

  assert.strictEqual(summary.dashboard_datasets_deployment.complete, true);
  assert.strictEqual(summary.release_hardening_deployment.complete, true);
  assert.strictEqual(summary.data_inventory.legacy_dataset_key_count, 2);
  assert.strictEqual(summary.data_inventory.active_snapshot_count, 2);
  assert.strictEqual(summary.data_inventory.storage_object_count, 2);
  assert.strictEqual(summary.data_inventory.backfill_review_required, true);
  assert.strictEqual(summary.operational_inventory.relation_count, 2);
  assert.strictEqual(summary.operational_inventory.row_count, 5);
  assert.strictEqual(summary.operational_inventory.unscoped_row_count, 1);
  assert(!JSON.stringify(summary).includes('valor'));

  const incompleteSummary = buildSummary({
    project: {
      id: 'abcdefghijklmnopqrst',
      name: 'Desenvolvimento',
      status: 'ACTIVE_HEALTHY',
      region: 'us-east-1',
    },
    deployment: {
      dashboard_config_exists: 'true',
      table_exists: 'false',
      activate_rpc_exists: '1',
      fail_rpc_exists: '0',
      rollback_rpc_exists: true,
      reset_rpc_exists: false,
      rls_enabled: 'true',
      private_bucket_exists: 'false',
      table_policy_count: '4',
      storage_policy_count: '4',
    },
    legacyRows: [],
    snapshotRows: [],
    storageRows: [],
    releaseHardening: {
      register_rpc_exists: false,
      rollback_rpc_exists: false,
      required_policy_count: 0,
      anon_select_column_count: 74,
      anon_sensitive_columns_blocked: false,
    },
  });
  assert.strictEqual(incompleteSummary.dashboard_datasets_deployment.dashboard_config_exists, true);
  assert.strictEqual(incompleteSummary.dashboard_datasets_deployment.table_exists, false);
  assert.strictEqual(incompleteSummary.dashboard_datasets_deployment.fail_rpc_exists, false);
  assert.strictEqual(incompleteSummary.dashboard_datasets_deployment.private_bucket_exists, false);
  assert.strictEqual(incompleteSummary.dashboard_datasets_deployment.complete, false);
  assert.strictEqual(incompleteSummary.release_hardening_deployment.complete, false);

  const source = require('fs').readFileSync(
    require('path').join(__dirname, 'audit_supabase_inventory.mjs'),
    'utf8',
  );
  assert(source.includes('/database/query/read-only'));
  assert(!source.includes('/database/query`'));
  assert(!source.includes('SUPABASE_DB_PASSWORD'));

  console.log('Inventario Supabase: alvo confirmado, consultas read-only e saida agregada OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
