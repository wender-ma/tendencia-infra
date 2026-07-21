do $$
begin
  if to_regclass('public.dashboard_datasets') is not null then
    raise exception 'dashboard_datasets permaneceu apos rollback';
  end if;
  if exists (select 1 from storage.buckets where id = 'dashboard-datasets') then
    raise exception 'bucket dashboard-datasets permaneceu apos rollback';
  end if;
  if to_regprocedure('public.activate_dashboard_dataset(uuid)') is not null then
    raise exception 'RPC de ativacao permaneceu apos rollback';
  end if;
end;
$$;
