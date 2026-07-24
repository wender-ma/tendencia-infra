begin;

drop policy if exists dashboard_datasets_storage_read_inactive_managed
  on storage.objects;
drop policy if exists dashboard_datasets_read_inactive_managed
  on public.dashboard_datasets;

commit;
