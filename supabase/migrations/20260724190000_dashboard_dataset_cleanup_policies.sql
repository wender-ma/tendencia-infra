-- ============================================================================
-- POLICIES DE LIMPEZA DOS DATASETS INATIVOS
-- ============================================================================
-- A API de Storage exige SELECT e DELETE para remover um objeto. As policies
-- iniciais permitiam DELETE de versoes inativas, mas o SELECT apenas das ativas,
-- fazendo a limpeza retornar sem erro e sem remover o objeto.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.dashboard_datasets') is null
    or to_regprocedure(
      'public.authz_can_manage_dashboard_dataset(text,text)'
    ) is null
    or to_regprocedure(
      'public.authz_can_manage_dashboard_dataset_path(text)'
    ) is null then
    raise exception 'Preflight falhou: aplique primeiro a migration de datasets';
  end if;
end;
$$;

drop policy if exists dashboard_datasets_read_inactive_managed
  on public.dashboard_datasets;
create policy dashboard_datasets_read_inactive_managed
on public.dashboard_datasets for select to authenticated
using (
  status <> 'active'
  and public.authz_can_manage_dashboard_dataset(codigo_obra, tipo)
);

drop policy if exists dashboard_datasets_storage_read_inactive_managed
  on storage.objects;
create policy dashboard_datasets_storage_read_inactive_managed
on storage.objects for select to authenticated
using (
  bucket_id = 'dashboard-datasets'
  and public.authz_can_manage_dashboard_dataset_path(name)
  and not exists (
    select 1
    from public.dashboard_datasets dataset
    where dataset.storage_path = name and dataset.status = 'active'
  )
);

commit;
