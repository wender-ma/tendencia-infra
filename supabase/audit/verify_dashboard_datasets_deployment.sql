-- Auditoria somente leitura da migration de snapshots versionados.
-- Execute no SQL Editor do projeto de desenvolvimento.
-- Antes, execute `npm run env:target` e compare o project ref com a URL aberta.

select pg_notify('pgrst', 'reload schema') as schema_reload_requested;

with deployment as (
  select
    to_regclass('public.dashboard_datasets') is not null as table_exists,
    to_regprocedure('public.activate_dashboard_dataset(uuid)') is not null
      as activate_rpc_exists,
    to_regprocedure('public.fail_dashboard_dataset(uuid)') is not null
      as fail_rpc_exists,
    to_regprocedure('public.rollback_dashboard_dataset(uuid,uuid)') is not null
      as rollback_rpc_exists,
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
      select count(*)
      from pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = 'dashboard_datasets'
    ) as table_policy_count,
    (
      select count(*)
      from pg_policies policy
      where policy.schemaname = 'storage'
        and policy.tablename = 'objects'
        and policy.policyname like 'dashboard_datasets_storage_%'
    ) as storage_policy_count
),
legacy_dataset_keys as (
  select
    chave,
    octet_length(valor) as bytes
  from public.dashboard_config
  where chave in ('dados_flows', 'dados_historico', 'dados_projraw')
    or chave ~ '^[^:]+:(dados_tendencia|dados_flows)$'
),
snapshot_statuses as (
  select status, count(*) as total
  from public.dashboard_datasets
  group by status
),
inventory as (
  select
    (select count(*) from legacy_dataset_keys) as legacy_dataset_key_count,
    coalesce((select sum(bytes) from legacy_dataset_keys), 0) as legacy_dataset_bytes,
    (select count(*) from public.dashboard_datasets) as snapshot_count,
    (
      select count(*)
      from public.dashboard_datasets
      where status = 'active'
    ) as active_snapshot_count,
    (
      select count(*)
      from storage.objects
      where bucket_id = 'dashboard-datasets'
    ) as storage_object_count,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('chave', chave, 'bytes', bytes)
          order by chave
        )
        from legacy_dataset_keys
      ),
      '[]'::jsonb
    ) as legacy_keys,
    coalesce(
      (
        select jsonb_object_agg(status, total)
        from snapshot_statuses
      ),
      '{}'::jsonb
    ) as snapshots_by_status
)
select jsonb_build_object(
  'table_exists', table_exists,
  'activate_rpc_exists', activate_rpc_exists,
  'fail_rpc_exists', fail_rpc_exists,
  'rollback_rpc_exists', rollback_rpc_exists,
  'rls_enabled', rls_enabled,
  'private_bucket_exists', private_bucket_exists,
  'table_policy_count', table_policy_count,
  'storage_policy_count', storage_policy_count,
  'data_inventory',
    jsonb_build_object(
      'legacy_dataset_key_count', legacy_dataset_key_count,
      'legacy_dataset_bytes', legacy_dataset_bytes,
      'legacy_keys', legacy_keys,
      'snapshot_count', snapshot_count,
      'active_snapshot_count', active_snapshot_count,
      'snapshots_by_status', snapshots_by_status,
      'storage_object_count', storage_object_count,
      'backfill_review_required', legacy_dataset_key_count > 0
    ),
  'complete',
    table_exists
    and activate_rpc_exists
    and fail_rpc_exists
    and rollback_rpc_exists
    and rls_enabled
    and private_bucket_exists
    and table_policy_count = 3
    and storage_policy_count = 3
) as dashboard_datasets_deployment
from deployment
cross join inventory;
