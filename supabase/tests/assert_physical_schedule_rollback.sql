\set ON_ERROR_STOP on

do $$
begin
  if pg_get_constraintdef(
    (select oid from pg_constraint
     where conrelid = 'public.upload_history'::regclass
       and conname = 'upload_history_scope_check')
  ) ilike '%cronograma_fisico%' then
    raise exception 'upload_history ainda aceita cronograma_fisico apos rollback';
  end if;

  if pg_get_constraintdef(
    (select oid from pg_constraint
     where conrelid = 'public.dashboard_datasets'::regclass
       and conname = 'dashboard_datasets_scope_check')
  ) ilike '%cronograma_fisico%' then
    raise exception 'dashboard_datasets ainda aceita cronograma_fisico apos rollback';
  end if;

  if pg_get_functiondef('public.authz_can_manage_upload(text,text)'::regprocedure)
       ilike '%cronograma_fisico%'
    or pg_get_functiondef(
      'public.authz_can_manage_dashboard_dataset(text,text)'::regprocedure
    ) ilike '%cronograma_fisico%'
    or pg_get_functiondef(
      'public.reset_dashboard_datasets(text,boolean)'::regprocedure
    ) ilike '%cronograma_fisico%' then
    raise exception 'funcoes de autorizacao ou reset nao foram restauradas';
  end if;

  if exists (
    select 1 from public.upload_history where tipo = 'cronograma_fisico'
  ) or exists (
    select 1 from public.dashboard_datasets where tipo = 'cronograma_fisico'
  ) then
    raise exception 'dados fisicos permaneceram apos rollback';
  end if;
end;
$$;

select 'physical schedule rollback assertions: ok' as result;
