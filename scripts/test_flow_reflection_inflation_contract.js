#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260804123000_flow_reflection_inflation.sql');
const rollback = read(
  'supabase/rollback/20260804123000_flow_reflection_inflation_rollback.sql',
);
const audit = read('supabase/audit/verify_flow_reflection_inflation_deployment.sql');
const repository = read('assets/js/services/dashboard-repository.mjs');
const flowsView = read('assets/js/ui/views/flows.mjs');
const migrationRunner = read('scripts/test_rls_migration.sh');

assert.match(migration, /add column if not exists observacao text/);
assert.match(migration, /'pendente', 'sim', 'nao', 'ipca', 'incc'/);
assert.match(migration, /set\s+refletido_status = indice_inflacao/);
assert.match(migration, /revoke select \(causa_desvio, indice_inflacao\)/);
assert.match(rollback, /drop column if exists observacao/);
assert.match(audit, /flow_reflection_inflation_deployment/);
assert(repository.includes("'observacao'"));
assert(!repository.includes("'causa_desvio'"));
assert(!repository.includes("'indice_inflacao'"));
assert(flowsView.includes('persistFlowFilters'));
assert(flowsView.includes('onFlowNotesChange'));
assert(!flowsView.includes('flowFilterDataIni'));
assert(!flowsView.includes('flowFilterValMin'));
assert(migrationRunner.includes('20260804123000_flow_reflection_inflation.sql'));

console.log('Reflexo IPCA/INCC, anotações e filtros persistentes: contrato OK');
