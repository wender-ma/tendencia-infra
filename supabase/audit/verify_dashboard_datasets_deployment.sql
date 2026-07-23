-- Auditoria somente leitura da migration de snapshots versionados.
-- Execute no SQL Editor do projeto de desenvolvimento.

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
from deployment;

select pg_notify('pgrst', 'reload schema') as schema_reload_requested;
