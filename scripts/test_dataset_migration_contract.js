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
  "bucket.id = 'dashboard-datasets'",
  'table_policy_count = 3',
  'storage_policy_count = 3',
  "pg_notify('pgrst', 'reload schema')",
]) {
  assert(
    deploymentAudit.includes(contract),
    `Auditoria de deploy dos datasets incompleta: ${contract}`,
  );
}

console.log('Contrato de datasets: bucket privado, versões, ativação e rollback OK');
