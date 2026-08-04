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
  releaseHardening: `
    with public_contract(table_name, columns) as (
      values
        ('obras', array['codigo_obra', 'nome', 'ativa']::text[]),
        (
          'flow_classifications',
          array[
            'codigo_obra', 'n_alteracao', 'insumo_planejamento',
            'insumo_remanejamento', 'custo_flowmaster', 'refletido_status',
            'refletido_mes', 'causa_desvio', 'indice_inflacao'
          ]::text[]
        ),
        (
          'flow_manuals',
          array[
            'codigo_obra', 'n_alteracao', 'n_adt', 'dep', 'descricao', 'data_br',
            'data', 'aprovador_dep', 'aprovador', 'solicitante_dep', 'solicitante',
            'custo_flowmaster', 'custo_planejamento', 'motivo', 'justificativa',
            'insumo_planejamento', 'insumo_remanejamento', 'obs'
          ]::text[]
        ),
        (
          'projecao_config',
          array[
            'codigo_obra', 'insumo_controlado', 'saldo_inicial', 'data_ref',
            'locked_saldo', 'locked_data', 'locked_insumo'
          ]::text[]
        ),
        (
          'projecao_movimentacoes',
          array[
            'id', 'codigo_obra', 'tipo', 'data', 'data_br', 'origem', 'destino',
            'descricao', 'justificativa', 'responsavel', 'valor', 'created_at'
          ]::text[]
        ),
        ('dashboard_config', array['chave', 'valor']::text[]),
        (
          'dashboard_datasets',
          array[
            'id', 'codigo_obra', 'tipo', 'versao', 'storage_path', 'sha256',
            'linhas', 'bytes', 'status', 'created_at', 'activated_at'
          ]::text[]
        )
    ),
    expected_columns as (
      select table_name, unnest(columns) as column_name
      from public_contract
    )
    select
      to_regprocedure('public.admin_register_upload_projects(jsonb)') is not null
        as register_rpc_exists,
      to_regprocedure('public.admin_rollback_upload_projects(text[])') is not null
        as rollback_rpc_exists,
      (
        select count(*)::integer
        from pg_policies
        where schemaname = 'public'
          and (
            (tablename = 'obras' and policyname in (
              'obras_read_anon_active',
              'obras_read_authenticated'
            ))
            or (
              tablename = 'dashboard_config'
              and policyname in (
                'dashboard_config_read_anon_safe',
                'dashboard_config_read_authenticated'
              )
            )
          )
      ) as required_policy_count,
      (
        select count(*)::integer
        from expected_columns expected
        where has_column_privilege(
          'anon',
          format('public.%I', expected.table_name),
          expected.column_name,
          'SELECT'
        )
      ) as anon_select_column_count,
      (select count(*)::integer from expected_columns) as expected_column_count,
      not exists (
        select 1
        from information_schema.columns available
        where available.table_schema = 'public'
          and available.table_name in (
            select table_name from public_contract
          )
          and not exists (
            select 1
            from expected_columns expected
            where expected.table_name = available.table_name
              and expected.column_name = available.column_name
          )
          and has_column_privilege(
            'anon',
            format('public.%I', available.table_name),
            available.column_name,
            'SELECT'
          )
      ) as anon_sensitive_columns_blocked
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
  operational: `
    select
      relation_name,
      row_count,
      first_activity_at,
      last_activity_at,
      unscoped_row_count
    from (
      select
        'dashboard_config'::text as relation_name,
        count(*)::bigint as row_count,
        min(updated_at)::text as first_activity_at,
        max(updated_at)::text as last_activity_at,
        0::bigint as unscoped_row_count
      from public.dashboard_config
      union all
      select
        'editores_permitidos',
        count(*)::bigint,
        min(adicionado_em)::text,
        max(adicionado_em)::text,
        count(*) filter (
          where role <> 'admin' and nullif(trim(codigo_obra), '') is null
        )::bigint
      from public.editores_permitidos
      union all
      select
        'flow_classifications',
        count(*)::bigint,
        min(updated_at)::text,
        max(updated_at)::text,
        count(*) filter (where nullif(trim(codigo_obra), '') is null)::bigint
      from public.flow_classifications
      union all
      select
        'flow_manuals',
        count(*)::bigint,
        min(created_at)::text,
        max(created_at)::text,
        count(*) filter (where nullif(trim(codigo_obra), '') is null)::bigint
      from public.flow_manuals
      union all
      select
        'obras',
        count(*)::bigint,
        min(criada_em)::text,
        max(criada_em)::text,
        count(*) filter (where nullif(trim(codigo_obra), '') is null)::bigint
      from public.obras
      union all
      select
        'projecao_config',
        count(*)::bigint,
        min(updated_at)::text,
        max(updated_at)::text,
        count(*) filter (where nullif(trim(codigo_obra), '') is null)::bigint
      from public.projecao_config
      union all
      select
        'projecao_movimentacoes',
        count(*)::bigint,
        min(created_at)::text,
        max(created_at)::text,
        count(*) filter (where nullif(trim(codigo_obra), '') is null)::bigint
      from public.projecao_movimentacoes
      union all
      select
        'upload_history',
        count(*)::bigint,
        min(enviado_em)::text,
        max(enviado_em)::text,
        count(*) filter (where nullif(trim(codigo_obra), '') is null)::bigint
      from public.upload_history
    ) inventory
    order by relation_name
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

export function buildSummary({
  project,
  deployment,
  legacyRows,
  snapshotRows,
  storageRows,
  operationalRows = [],
  releaseHardening = {},
}) {
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
  const operationalInventory = operationalRows.map((row) => ({
    relation_name: row.relation_name,
    row_count: toNumber(row.row_count),
    first_activity_at: row.first_activity_at || null,
    last_activity_at: row.last_activity_at || null,
    unscoped_row_count: toNumber(row.unscoped_row_count),
  }));
  const normalizedReleaseHardening = {
    register_rpc_exists: toBoolean(releaseHardening.register_rpc_exists),
    rollback_rpc_exists: toBoolean(releaseHardening.rollback_rpc_exists),
    required_policy_count: toNumber(releaseHardening.required_policy_count),
    anon_select_column_count: toNumber(releaseHardening.anon_select_column_count),
    expected_column_count: toNumber(releaseHardening.expected_column_count),
    anon_sensitive_columns_blocked: toBoolean(releaseHardening.anon_sensitive_columns_blocked),
  };
  normalizedReleaseHardening.complete =
    normalizedReleaseHardening.register_rpc_exists &&
    normalizedReleaseHardening.rollback_rpc_exists &&
    normalizedReleaseHardening.required_policy_count === 4 &&
    normalizedReleaseHardening.anon_select_column_count ===
      normalizedReleaseHardening.expected_column_count &&
    normalizedReleaseHardening.anon_sensitive_columns_blocked;

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
    release_hardening_deployment: normalizedReleaseHardening,
    data_inventory: {
      ...inventory,
      backfill_review_required: inventory.legacy_dataset_key_count > 0,
    },
    operational_inventory: {
      relation_count: operationalInventory.length,
      row_count: operationalInventory.reduce((total, row) => total + row.row_count, 0),
      unscoped_row_count: operationalInventory.reduce(
        (total, row) => total + row.unscoped_row_count,
        0,
      ),
      relations: operationalInventory,
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
    throw new Error(
      'SUPABASE_ACCESS_TOKEN ausente. Configure-o somente em config/env/.env.supabase.local.',
    );
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
  const operationalRows = deployment.dashboard_config_exists
    ? await runReadOnlyQuery(projectRef, READ_ONLY_QUERIES.operational, accessToken)
    : [];
  const releaseHardeningRows = await runReadOnlyQuery(
    projectRef,
    READ_ONLY_QUERIES.releaseHardening,
    accessToken,
  );

  return buildSummary({
    project,
    deployment,
    legacyRows,
    snapshotRows,
    storageRows,
    operationalRows,
    releaseHardening: releaseHardeningRows[0] || {},
  });
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
