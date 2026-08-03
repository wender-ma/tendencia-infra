select jsonb_build_object(
  'complete',
    to_regclass('public.upload_history') is not null
    and to_regclass('public.dashboard_datasets') is not null
    and pg_get_functiondef('public.authz_can_manage_upload(text,text)'::regprocedure)
      ilike '%cronograma_fisico%'
    and pg_get_functiondef('public.authz_can_manage_dashboard_dataset(text,text)'::regprocedure)
      ilike '%cronograma_fisico%'
    and pg_get_functiondef('public.reset_dashboard_datasets(text,boolean)'::regprocedure)
      ilike '%cronograma_fisico%',
  'upload_scope_enabled',
    pg_get_constraintdef(
      (select oid from pg_constraint
       where conrelid = 'public.upload_history'::regclass
         and conname = 'upload_history_scope_check')
    ) ilike '%cronograma_fisico%',
  'dataset_scope_enabled',
    pg_get_constraintdef(
      (select oid from pg_constraint
       where conrelid = 'public.dashboard_datasets'::regclass
         and conname = 'dashboard_datasets_scope_check')
    ) ilike '%cronograma_fisico%',
  'reset_scope_enabled',
    pg_get_functiondef('public.reset_dashboard_datasets(text,boolean)'::regprocedure)
      ilike '%cronograma_fisico%',
  'active_uploads',
    (select count(*) from public.upload_history
     where tipo = 'cronograma_fisico' and is_active),
  'active_datasets',
    (select count(*) from public.dashboard_datasets
     where tipo = 'cronograma_fisico' and status = 'active')
) as physical_schedule_deployment;
