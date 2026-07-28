#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260728193000_global_upload_history.sql'),
  'utf8',
);
const rollback = fs.readFileSync(
  path.resolve(__dirname, '../supabase/rollback/20260728193000_global_upload_history_rollback.sql'),
  'utf8',
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const contract of [
  "where tipo in ('flows', 'gestoes')",
  'set codigo_obra = null',
  'upload_history_scope_check',
  'upload_history_one_active_project_kind',
  'upload_history_one_active_global_kind',
  'public.authz_can_manage_upload',
  'public.authz_can_manage_upload(codigo_obra, tipo)',
  'public.reset_global_dashboard_datasets',
  "tipo in ('flows', 'historico', 'projecao_raw')",
  "'dados_flows', 'dados_historico', 'dados_projraw'",
]) {
  assert(migration.includes(contract), `Contrato multiobra ausente: ${contract}`);
}

assert(
  /create unique index[\s\S]+where is_active and codigo_obra is null/i.test(migration),
  'Migration precisa impedir mais de um upload global ativo',
);
assert(
  /target_tipo = 'tendencia'[\s\S]+public\.authz_can_edit_obra/i.test(migration),
  'Editores devem continuar limitados à Tendência da própria obra',
);
for (const contract of [
  'drop function if exists public.reset_global_dashboard_datasets',
  'drop index if exists public.upload_history_one_active_global_kind',
  'drop constraint if exists upload_history_scope_check',
]) {
  assert(rollback.includes(contract), `Contrato de rollback multiobra ausente: ${contract}`);
}

console.log('Histórico global de uploads: escopo, unicidade, RLS e reset isolado OK');
