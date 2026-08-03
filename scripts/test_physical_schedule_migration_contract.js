#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20260803150000_physical_schedule_datasets.sql');
const rollback = read('supabase/rollback/20260803150000_physical_schedule_datasets_rollback.sql');
const audit = read('supabase/audit/verify_physical_schedule_deployment.sql');

assert.match(migration, /tipo in \('tendencia', 'cronograma_fisico'\)/);
assert.match(migration, /authz_can_manage_upload/);
assert.match(migration, /authz_can_manage_dashboard_dataset/);
assert.match(migration, /reset_dashboard_datasets/);
assert.match(migration, /and tipo in \('tendencia', 'cronograma_fisico'\)/);
assert.match(migration, /projection_forecast/);
assert.match(rollback, /delete from public\.dashboard_datasets where tipo = 'cronograma_fisico'/);
assert.match(audit, /physical_schedule_deployment/);
assert.match(audit, /reset_scope_enabled/);

console.log('Physical schedule migration contract: OK');
