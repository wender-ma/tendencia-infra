-- Verificacao somente leitura da migration de historico global.

select jsonb_build_object(
  'scope_constraint_exists',
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.upload_history'::regclass
      and conname = 'upload_history_scope_check'
  ),
  'project_active_unique_exists',
  to_regclass('public.upload_history_one_active_project_kind') is not null,
  'global_active_unique_exists',
  to_regclass('public.upload_history_one_active_global_kind') is not null,
  'global_reset_rpc_exists',
  to_regprocedure('public.reset_global_dashboard_datasets()') is not null,
  'global_rows_normalized',
  not exists (
    select 1
    from public.upload_history
    where tipo in ('flows', 'gestoes')
      and codigo_obra is not null
  ),
  'global_active_is_unique',
  not exists (
    select tipo
    from public.upload_history
    where tipo in ('flows', 'gestoes')
      and is_active
    group by tipo
    having count(*) > 1
  )
) as global_upload_history_deployment;
