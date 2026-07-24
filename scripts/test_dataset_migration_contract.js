#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260721211500_dashboard_datasets.sql'),
  'utf8',
);
const rollback = fs.readFileSync(
  path.join(root, 'supabase/rollback/20260721211500_dashboard_datasets_rollback.sql'),
  'utf8',
);
const resetMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260724183000_dashboard_dataset_reset.sql'),
  'utf8',
);
const resetRollback = fs.readFileSync(
  path.join(root, 'supabase/rollback/20260724183000_dashboard_dataset_reset_rollback.sql'),
  'utf8',
);
const resetAssertions = fs.readFileSync(
  path.join(root, 'supabase/tests/assert_dashboard_dataset_reset.sql'),
  'utf8',
);
const cleanupPolicyMigration = fs.readFileSync(
  path.join(
    root,
    'supabase/migrations/20260724190000_dashboard_dataset_cleanup_policies.sql',
  ),
  'utf8',
);
const cleanupPolicyRollback = fs.readFileSync(
  path.join(
    root,
    'supabase/rollback/20260724190000_dashboard_dataset_cleanup_policies_rollback.sql',
  ),
  'utf8',
);
const deploymentAudit = fs.readFileSync(
  path.join(root, 'supabase/audit/verify_dashboard_datasets_deployment.sql'),
  'utf8',
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const contract of [
  'create table public.dashboard_datasets',
  "values ('dashboard-datasets', 'dashboard-datasets', false)",
  'dashboard_datasets_active_project_unique',
  'dashboard_datasets_active_global_unique',
  'public.authz_can_manage_dashboard_dataset',
  'public.activate_dashboard_dataset',
  'public.rollback_dashboard_dataset',
  "'previous_id', previous_id",
  'pg_advisory_xact_lock',
  "dataset.status <> 'processing'",
  "bucket_id = 'dashboard-datasets'",
  'dashboard_datasets_storage_read_active',
  'dashboard_datasets_storage_delete_inactive',
]) {
  assert(migration.includes(contract), `Contrato da migration de datasets ausente: ${contract}`);
}

for (const contract of [
  'create or replace function public.reset_dashboard_datasets',
  'public.authz_can_edit_obra(normalized_codigo_obra)',
  'include_global and not public.authz_is_admin()',
  'pg_advisory_xact_lock',
  'delete from public.dashboard_datasets',
  'delete from public.dashboard_config',
  "'dados_flows', 'dados_historico', 'dados_projraw'",
  "'datasets', removed_datasets",
]) {
  assert(resetMigration.includes(contract), `Contrato do reset de datasets ausente: ${contract}`);
}
assert(
  resetRollback.includes('drop function if exists public.reset_dashboard_datasets'),
  'Rollback do reset de datasets ausente',
);
for (const contract of [
  'dashboard_datasets_read_inactive_managed',
  'status <>',
  'public.authz_can_manage_dashboard_dataset(codigo_obra, tipo)',
  'dashboard_datasets_storage_read_inactive_managed',
  'public.authz_can_manage_dashboard_dataset_path(name)',
]) {
  assert(
    cleanupPolicyMigration.includes(contract),
    `Policy de limpeza dos datasets ausente: ${contract}`,
  );
}
assert(
  cleanupPolicyRollback.includes('drop policy if exists dashboard_datasets_read_inactive_managed') &&
    cleanupPolicyRollback.includes(
      'drop policy if exists dashboard_datasets_storage_read_inactive_managed',
    ),
  'Rollback das policies de limpeza ausente',
);
assert(
  resetAssertions.includes("public.reset_dashboard_datasets('OBRA-A', false)") &&
    resetAssertions.includes("public.reset_dashboard_datasets('OBRA-A', true)"),
  'Reset de datasets nao testa escopo de obra e global',
);

assert(
  rollback.includes('Rollback interrompido: remova primeiro os objetos'),
  'Rollback deve preservar objetos ainda armazenados',
);
assert(
  !migration.includes('delete from public.dashboard_config'),
  'Migration preparatoria nao pode apagar os blobs legados',
);
for (const contract of [
  "to_regclass('public.dashboard_datasets')",
  "to_regprocedure('public.activate_dashboard_dataset(uuid)')",
  "to_regprocedure('public.fail_dashboard_dataset(uuid)')",
  "to_regprocedure('public.rollback_dashboard_dataset(uuid,uuid)')",
  "to_regprocedure('public.reset_dashboard_datasets(text,boolean)')",
  "bucket.id = 'dashboard-datasets'",
  'table_policy_count = 4',
  'storage_policy_count = 4',
  "pg_notify('pgrst', 'reload schema')",
  'data_inventory',
  'legacy_dataset_key_count',
  'active_snapshot_count',
  'storage_object_count',
  'backfill_review_required',
  'octet_length(valor)',
]) {
  assert(
    deploymentAudit.includes(contract),
    `Auditoria de deploy dos datasets incompleta: ${contract}`,
  );
}

console.log('Contrato de datasets: bucket privado, versões, ativação e rollback OK');
