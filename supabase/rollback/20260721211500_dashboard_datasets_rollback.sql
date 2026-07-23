-- Rollback da persistencia versionada. Execute antes de haver uso em producao
-- ou remova os objetos do bucket pela API de Storage antes deste script.

begin;

do $$
begin
  if exists (
    select 1 from storage.objects where bucket_id = 'dashboard-datasets'
  ) then
    raise exception 'Rollback interrompido: remova primeiro os objetos de dashboard-datasets';
  end if;
end;
$$;

drop policy if exists dashboard_datasets_storage_read_active on storage.objects;
drop policy if exists dashboard_datasets_storage_insert_scope on storage.objects;
drop policy if exists dashboard_datasets_storage_delete_inactive on storage.objects;

drop function if exists public.activate_dashboard_dataset(uuid);
drop function if exists public.fail_dashboard_dataset(uuid);
drop function if exists public.rollback_dashboard_dataset(uuid, uuid);
drop table if exists public.dashboard_datasets;
drop function if exists public.authz_can_manage_dashboard_dataset_path(text);
drop function if exists public.authz_can_manage_dashboard_dataset(text, text);

delete from storage.buckets where id = 'dashboard-datasets';

commit;
