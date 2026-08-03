\set ON_ERROR_STOP on

create function pg_temp.assert_true(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if condition is not true then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
end;
$$;

create function pg_temp.expect_failure(statement text, message text)
returns void
language plpgsql
as $$
begin
  begin
    execute statement;
  exception when others then
    return;
  end;
  raise exception 'ASSERTION FAILED: %', message;
end;
$$;

insert into public.dashboard_config (chave, valor)
values ('OBRA-B:projection_forecast', '{"active":true,"overrides":{}}')
on conflict (chave) do update set valor = excluded.valor;

set role authenticated;
select set_config(
  'request.jwt.claims',
  '{"email":"editor@example.test","role":"authenticated"}',
  false
);

select pg_temp.assert_true(
  public.authz_can_manage_upload('OBRA-B', 'cronograma_fisico')
  and public.authz_can_manage_dashboard_dataset('OBRA-B', 'cronograma_fisico'),
  'editor deve gerenciar o Cronograma Fisico da obra atribuida'
);

select pg_temp.assert_true(
  not public.authz_can_manage_upload('OBRA-A', 'cronograma_fisico')
  and not public.authz_can_manage_dashboard_dataset('OBRA-A', 'cronograma_fisico'),
  'editor nao deve gerenciar o Cronograma Fisico de outra obra'
);

insert into public.upload_history (
  codigo_obra,
  tipo,
  nome_arquivo,
  enviado_por,
  storage_path,
  is_active
)
values (
  'OBRA-B',
  'cronograma_fisico',
  'cronograma.xlsx',
  'editor@example.test',
  'OBRA-B/cronograma_fisico/cronograma.xlsx',
  true
);

insert into public.dashboard_datasets (
  id,
  codigo_obra,
  tipo,
  versao,
  storage_path,
  sha256,
  linhas,
  bytes,
  status
)
values (
  '30000000-0000-0000-0000-000000000001',
  'OBRA-B',
  'cronograma_fisico',
  1,
  'OBRA-B/cronograma_fisico/v1.json',
  repeat('a', 64),
  105,
  1000,
  'processing'
);

select pg_temp.expect_failure(
  $$insert into public.dashboard_datasets (
      id, codigo_obra, tipo, versao, storage_path, sha256, linhas, bytes, status
    ) values (
      '30000000-0000-0000-0000-000000000002', 'OBRA-A', 'cronograma_fisico', 1,
      'OBRA-A/cronograma_fisico/v1.json', repeat('b', 64), 1, 10, 'processing'
    )$$,
  'editor nao pode persistir Cronograma Fisico de outra obra'
);

select pg_temp.assert_true(
  (select count(*) = 1 from public.upload_history where tipo = 'cronograma_fisico')
  and (select count(*) = 1 from public.dashboard_datasets where tipo = 'cronograma_fisico'),
  'upload e snapshot fisico devem ser persistidos de forma independente'
);

select pg_temp.assert_true(
  ((public.reset_dashboard_datasets('OBRA-B', false) ->> 'config_deleted')::integer >= 1),
  'reset da obra deve remover configuracao da previsao'
);

select pg_temp.assert_true(
  not exists (
    select 1 from public.dashboard_datasets
    where codigo_obra = 'OBRA-B' and tipo = 'cronograma_fisico'
  )
  and not exists (
    select 1 from public.dashboard_config
    where chave = 'OBRA-B:projection_forecast'
  ),
  'reset deve remover snapshot fisico e configuracao hibrida'
);

select set_config(
  'request.jwt.claims',
  '{"email":"admin@example.test","role":"authenticated"}',
  false
);

select pg_temp.assert_true(
  public.authz_can_manage_upload('OBRA-A', 'cronograma_fisico')
  and public.authz_can_manage_dashboard_dataset('OBRA-A', 'cronograma_fisico'),
  'admin deve gerenciar Cronograma Fisico de qualquer obra'
);

reset role;

select 'physical schedule assertions: ok' as result;
