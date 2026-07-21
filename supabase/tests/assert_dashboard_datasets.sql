do $$
begin
  if to_regclass('public.dashboard_datasets') is null then
    raise exception 'dashboard_datasets ausente';
  end if;
  if not exists (
    select 1 from storage.buckets where id = 'dashboard-datasets' and public = false
  ) then
    raise exception 'bucket dashboard-datasets ausente ou publico';
  end if;
  if to_regprocedure('public.activate_dashboard_dataset(uuid)') is null then
    raise exception 'RPC de ativacao ausente';
  end if;
end;
$$;

insert into public.editores_permitidos (email, codigo_obra, role, status)
values ('dataset-editor@example.test', 'OBRA-A', 'editor', 'active');

set role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","email":"dataset-editor@example.test"}',
  false
);

insert into public.dashboard_datasets (
  id, codigo_obra, tipo, versao, storage_path, sha256, linhas, bytes
) values (
  '10000000-0000-0000-0000-000000000001', 'OBRA-A', 'tendencia', 1,
  'OBRA-A/tendencia/v1.json', repeat('a', 64), 10, 100
);

insert into storage.objects (id, bucket_id, name)
values (
  '10000000-0000-0000-0000-000000000011',
  'dashboard-datasets',
  'OBRA-A/tendencia/v1.json'
);

select public.activate_dashboard_dataset('10000000-0000-0000-0000-000000000001');

do $$
begin
  if not exists (
    select 1 from public.dashboard_datasets
    where id = '10000000-0000-0000-0000-000000000001' and status = 'active'
  ) then
    raise exception 'editor nao ativou dataset da propria obra';
  end if;
end;
$$;

do $$
begin
  begin
    insert into public.dashboard_datasets (
      id, codigo_obra, tipo, versao, storage_path, sha256, linhas, bytes
    ) values (
      '10000000-0000-0000-0000-000000000002', 'OBRA-B', 'tendencia', 1,
      'OBRA-B/tendencia/v1.json', repeat('b', 64), 10, 100
    );
    raise exception 'editor escreveu em obra alheia';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.dashboard_datasets (
      id, codigo_obra, tipo, versao, storage_path, sha256, linhas, bytes
    ) values (
      '10000000-0000-0000-0000-000000000003', null, 'flows', 1,
      '_global/flows/v1.json', repeat('c', 64), 10, 100
    );
    raise exception 'editor escreveu dataset global';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","email":"admin@example.test"}',
  false
);

insert into public.dashboard_datasets (
  id, codigo_obra, tipo, versao, storage_path, sha256, linhas, bytes
) values (
  '10000000-0000-0000-0000-000000000004', null, 'flows', 1,
  '_global/flows/v1.json', repeat('d', 64), 10, 100
);

insert into storage.objects (id, bucket_id, name)
values (
  '10000000-0000-0000-0000-000000000014',
  'dashboard-datasets',
  '_global/flows/v1.json'
);

select public.activate_dashboard_dataset('10000000-0000-0000-0000-000000000004');

reset role;
select set_config('request.jwt.claims', '{}', false);

do $$
begin
  if (
    select count(*) from public.dashboard_datasets where status = 'active'
  ) <> 2 then
    raise exception 'quantidade inesperada de datasets ativos';
  end if;
end;
$$;
