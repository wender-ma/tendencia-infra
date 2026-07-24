#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

const MANAGEMENT_API = 'https://api.supabase.com/v1';
const PROJECT_REF_PATTERN = /^[a-z]{20}$/;

export const READ_ONLY_QUERIES = Object.freeze({
  deployment: `
    select
      to_regclass('public.dashboard_config') is not null as dashboard_config_exists,
      to_regclass('public.dashboard_datasets') is not null as table_exists,
      to_regprocedure('public.activate_dashboard_dataset(uuid)') is not null
        as activate_rpc_exists,
      to_regprocedure('public.fail_dashboard_dataset(uuid)') is not null
        as fail_rpc_exists,
      to_regprocedure('public.rollback_dashboard_dataset(uuid,uuid)') is not null
        as rollback_rpc_exists,
      to_regprocedure('public.reset_dashboard_datasets(text,boolean)') is not null
        as reset_rpc_exists,
      coalesce(
        (
          select cls.relrowsecurity
          from pg_class cls
          where cls.oid = to_regclass('public.dashboard_datasets')
        ),
        false
      ) as rls_enabled,
      exists (
        select 1
        from storage.buckets bucket
        where bucket.id = 'dashboard-datasets'
          and bucket.public = false
      ) as private_bucket_exists,
      (
        select count(*)::integer
        from pg_policies policy
        where policy.schemaname = 'public'
          and policy.tablename = 'dashboard_datasets'
      ) as table_policy_count,
      (
        select count(*)::integer
        from pg_policies policy
        where policy.schemaname = 'storage'
          and policy.tablename = 'objects'
          and policy.policyname like 'dashboard_datasets_storage_%'
      ) as storage_policy_count
  `,
  legacy: `
    select
      case
        when chave in ('dados_flows', 'dados_historico', 'dados_projraw') then 'global'
        else 'project'
      end as scope,
      case
        when chave = 'dados_flows' or chave like '%:dados_flows' then 'flows'
        when chave = 'dados_historico' then 'historico'
        when chave = 'dados_projraw' then 'projecao_raw'
        else 'tendencia'
      end as tipo,
      count(*)::integer as key_count,
      coalesce(sum(octet_length(valor)), 0)::bigint as bytes
    from public.dashboard_config
    where chave in ('dados_flows', 'dados_historico', 'dados_projraw')
      or chave ~ '^[^:]+:(dados_tendencia|dados_flows)$'
    group by 1, 2
    order by 1, 2
  `,
  snapshots: `
    select
      case when codigo_obra is null then 'global' else 'project' end as scope,
      tipo,
      status,
      count(*)::integer as snapshot_count,
      coalesce(sum(bytes), 0)::bigint as bytes
    from public.dashboard_datasets
    group by 1, 2, 3
    order by 1, 2, 3
  `,
  storage: `
    select count(*)::integer as object_count
    from storage.objects
    where bucket_id = 'dashboard-datasets'
  `,
});

export function parseArguments(argumentsList) {
  const parsed = {};

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument.startsWith('--')) {
      throw new Error(`Argumento inesperado: ${argument}`);
    }

    const equalsIndex = argument.indexOf('=');
    if (equalsIndex > 2) {
      parsed[argument.slice(2, equalsIndex)] = argument.slice(equalsIndex + 1);
      continue;
    }

    const name = argument.slice(2);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Informe um valor para --${name}.`);
    }
    parsed[name] = value;
    index += 1;
  }

  return parsed;
}

export function assertTarget({ projectRef, confirmedProjectRef }) {
  if (!PROJECT_REF_PATTERN.test(projectRef || '')) {
    throw new Error('Project ref invalido; use os 20 caracteres exibidos pelo Supabase.');
  }
  if (confirmedProjectRef !== projectRef) {
    throw new Error(
      'Alvo nao confirmado. Repita o mesmo valor em --project-ref e --confirm-project-ref.',
    );
  }
}

export function assertReadOnlyQuery(query) {
  const normalized = query.trim().replace(/^\(+/, '').toLowerCase();
  if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
    throw new Error('A auditoria recusou uma consulta que nao inicia com SELECT ou WITH.');
  }

  const forbidden =
    /\b(insert|update|delete|merge|truncate|alter|create|drop|grant|revoke|call|do)\b/i;
  if (forbidden.test(query)) {
    throw new Error('A auditoria recusou uma instrucao capaz de alterar o banco.');
  }
}

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.data)) return payload.data;
  throw new Error('A API do Supabase retornou um formato de consulta desconhecido.');
}

async function requestJson(url, options, accessToken) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...options?.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });

  const body = await response.text();
  let payload;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.message || payload?.error || `HTTP ${response.status} ${response.statusText}`;
    throw new Error(`Supabase Management API: ${String(message).slice(0, 300)}`);
  }

  return payload;
}

async function runReadOnlyQuery(projectRef, query, accessToken) {
  assertReadOnlyQuery(query);
  const payload = await requestJson(
    `${MANAGEMENT_API}/projects/${projectRef}/database/query/read-only`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    },
    accessToken,
  );
  return normalizeRows(payload);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toBoolean(value) {
  return value === true || value === 1 || value === 'true' || value === '1';
}

export function buildSummary({ project, deployment, legacyRows, snapshotRows, storageRows }) {
  const legacyDatasets = legacyRows.map((row) => ({
    scope: row.scope,
    tipo: row.tipo,
    key_count: toNumber(row.key_count),
    bytes: toNumber(row.bytes),
  }));
  const snapshotsByStatus = snapshotRows.map((row) => ({
    scope: row.scope,
    tipo: row.tipo,
    status: row.status,
    snapshot_count: toNumber(row.snapshot_count),
    bytes: toNumber(row.bytes),
  }));
  const inventory = {
    legacy_dataset_key_count: legacyDatasets.reduce((total, row) => total + row.key_count, 0),
    legacy_dataset_bytes: legacyDatasets.reduce((total, row) => total + row.bytes, 0),
    legacy_datasets: legacyDatasets,
    snapshot_count: snapshotsByStatus.reduce((total, row) => total + row.snapshot_count, 0),
    active_snapshot_count: snapshotsByStatus
      .filter((row) => row.status === 'active')
      .reduce((total, row) => total + row.snapshot_count, 0),
    snapshots_by_status: snapshotsByStatus,
    storage_object_count: toNumber(storageRows[0]?.object_count),
  };

  const normalizedDeployment = {
    dashboard_config_exists: toBoolean(deployment.dashboard_config_exists),
    table_exists: toBoolean(deployment.table_exists),
    activate_rpc_exists: toBoolean(deployment.activate_rpc_exists),
    fail_rpc_exists: toBoolean(deployment.fail_rpc_exists),
    rollback_rpc_exists: toBoolean(deployment.rollback_rpc_exists),
    reset_rpc_exists: toBoolean(deployment.reset_rpc_exists),
    rls_enabled: toBoolean(deployment.rls_enabled),
    private_bucket_exists: toBoolean(deployment.private_bucket_exists),
    table_policy_count: toNumber(deployment.table_policy_count),
    storage_policy_count: toNumber(deployment.storage_policy_count),
  };
  normalizedDeployment.complete =
    normalizedDeployment.dashboard_config_exists &&
    normalizedDeployment.table_exists &&
    normalizedDeployment.activate_rpc_exists &&
    normalizedDeployment.fail_rpc_exists &&
    normalizedDeployment.rollback_rpc_exists &&
    normalizedDeployment.reset_rpc_exists &&
    normalizedDeployment.rls_enabled &&
    normalizedDeployment.private_bucket_exists &&
    normalizedDeployment.table_policy_count === 4 &&
    normalizedDeployment.storage_policy_count === 4;

  return {
    audited_at: new Date().toISOString(),
    audit_mode: 'supabase-management-api-read-only',
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      region: project.region,
    },
    dashboard_datasets_deployment: normalizedDeployment,
    data_inventory: {
      ...inventory,
      backfill_review_required: inventory.legacy_dataset_key_count > 0,
    },
  };
}

export async function auditSupabaseInventory({
  projectRef,
  confirmedProjectRef,
  expectedProjectName,
  accessToken,
}) {
  assertTarget({ projectRef, confirmedProjectRef });
  if (!accessToken) {
    throw new Error('SUPABASE_ACCESS_TOKEN ausente. Configure-o somente em .env.supabase.local.');
  }

  const projects = await requestJson(`${MANAGEMENT_API}/projects`, {}, accessToken);
  const project = projects.find((candidate) => candidate.id === projectRef);
  if (!project) {
    throw new Error(`O token nao possui acesso ao projeto ${projectRef}.`);
  }
  if (expectedProjectName && project.name !== expectedProjectName) {
    throw new Error(
      `Nome do alvo divergente: esperado "${expectedProjectName}", recebido "${project.name}".`,
    );
  }

  const deploymentRows = await runReadOnlyQuery(
    projectRef,
    READ_ONLY_QUERIES.deployment,
    accessToken,
  );
  const deployment = deploymentRows[0] || {};
  const legacyRows = deployment.dashboard_config_exists
    ? await runReadOnlyQuery(projectRef, READ_ONLY_QUERIES.legacy, accessToken)
    : [];
  const snapshotRows = deployment.table_exists
    ? await runReadOnlyQuery(projectRef, READ_ONLY_QUERIES.snapshots, accessToken)
    : [];
  const storageRows = deployment.private_bucket_exists
    ? await runReadOnlyQuery(projectRef, READ_ONLY_QUERIES.storage, accessToken)
    : [];

  return buildSummary({ project, deployment, legacyRows, snapshotRows, storageRows });
}

async function main() {
  const argumentsMap = parseArguments(process.argv.slice(2));
  const projectRef = argumentsMap['project-ref'] || process.env.SUPABASE_PROJECT_REF?.trim();
  const confirmedProjectRef = argumentsMap['confirm-project-ref'];
  const expectedProjectName = argumentsMap['expected-project-name'];
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();

  const summary = await auditSupabaseInventory({
    projectRef,
    confirmedProjectRef,
    expectedProjectName,
    accessToken,
  });
  console.log(JSON.stringify(summary, null, 2));
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error) => {
    console.error(`Auditoria interrompida: ${error.message || error}`);
    process.exitCode = 1;
  });
}
