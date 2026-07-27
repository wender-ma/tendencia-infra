#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const audit = fs.readFileSync(
  path.join(root, 'supabase/audit/verify_legacy_dataset_cleanup.sql'),
  'utf8',
);
const cleanup = fs.readFileSync(
  path.join(root, 'supabase/maintenance/cleanup_legacy_dashboard_datasets.sql'),
  'utf8',
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const contract of [
  "date '2026-08-03'",
  'legacy_key_count = 4',
  'legacy_bytes = 974425',
  'unsupported_key_count = 0',
  'matched_active_snapshot_count = 4',
  'matched_storage_object_count = 4',
  'processing_snapshot_count = 0',
  'cleanup_ready',
]) {
  assert(audit.includes(contract), `Gate de auditoria ausente: ${contract}`);
}

for (const contract of [
  'begin;',
  'commit;',
  'create temporary table legacy_dataset_cleanup_targets',
  "current_date < date '2026-08-03'",
  'legacy_key_count <> 4',
  'legacy_bytes <> 974425',
  "status = 'processing'",
  'pg_advisory_xact_lock',
  "dataset.status = 'active'",
  "object.bucket_id = 'dashboard-datasets'",
  'delete from public.dashboard_config',
  'get diagnostics deleted_key_count = row_count',
  'deleted_key_count <> 4',
  'remaining_key_count <> 0',
  "'cleanup_complete', true",
  "'remaining_legacy_key_count'",
]) {
  assert(cleanup.includes(contract), `Protecao da limpeza ausente: ${contract}`);
}

assert(
  !/delete\s+from\s+public\.dashboard_datasets/i.test(cleanup) &&
    !/delete\s+from\s+storage\.objects/i.test(cleanup),
  'Limpeza legada nao pode remover snapshots ou objetos',
);
assert(
  /backup\/export do banco/.test(cleanup) && /autorizacao explicita/.test(cleanup),
  'Precondicoes humanas da limpeza nao estao documentadas',
);

console.log('Limpeza legada: data, inventário, locks e preservação de snapshots OK');
