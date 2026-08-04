#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260804120000_flow_deviation_cause.sql');
const rollback = read('supabase/rollback/20260804120000_flow_deviation_cause_rollback.sql');
const audit = read('supabase/audit/verify_flow_deviation_cause_deployment.sql');
const repository = read('assets/js/services/dashboard-repository.mjs');
const migrationRunner = read('scripts/test_rls_migration.sh');

for (const column of ['causa_desvio', 'indice_inflacao']) {
  assert.match(migration, new RegExp(`add column if not exists ${column}`));
  assert.match(rollback, new RegExp(`drop column if exists ${column}`));
  assert(repository.includes(column));
}
assert.match(migration, /flow_classifications_inflacao_completa_check/);
assert.match(migration, /grant select \(causa_desvio, indice_inflacao\)/);
assert.match(audit, /flow_deviation_cause_deployment/);
assert(migrationRunner.includes('20260804120000_flow_deviation_cause.sql'));
assert(migrationRunner.includes('assert_flow_deviation_cause.sql'));

console.log('Causa do desvio: migration, rollback, auditoria e repositório OK');
