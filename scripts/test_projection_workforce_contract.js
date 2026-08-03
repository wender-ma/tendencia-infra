#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260731203000_projection_workforce.sql'),
  'utf8',
);
const repository = fs.readFileSync(
  path.join(root, 'assets/js/services/dashboard-repository.mjs'),
  'utf8',
);

for (const table of ['projection_workforce_settings', 'projection_workforce_rows']) {
  assert(migration.includes(`create table if not exists public.${table}`));
  assert(migration.includes(`alter table public.${table} enable row level security`));
  assert(migration.includes(`on public.${table} for select to anon, authenticated`));
}
assert(migration.includes('public.authz_can_edit_obra(codigo_obra)'));
assert(migration.includes("insumo in ('ADM5189', 'CONDH271')"));
assert(repository.includes(".from('projection_workforce_settings')"));
assert(repository.includes(".from('projection_workforce_rows')"));
assert(repository.includes('canEditActiveProject?.()'));

console.log('Planejamento de mão de obra: schema, RLS e repositório por obra OK');
