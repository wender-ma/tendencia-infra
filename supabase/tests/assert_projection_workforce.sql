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

select pg_temp.assert_true(
  has_table_privilege('anon', 'public.projection_workforce_settings', 'SELECT')
  and has_table_privilege('anon', 'public.projection_workforce_rows', 'SELECT')
  and not has_table_privilege('anon', 'public.projection_workforce_rows', 'INSERT,UPDATE,DELETE'),
  'anon deve ter somente leitura do planejamento de mao de obra'
);

select pg_temp.assert_true(
  has_table_privilege(
    'authenticated',
    'public.projection_workforce_settings',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and has_table_privilege(
    'authenticated',
    'public.projection_workforce_rows',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'authenticated deve receber grants sujeitos a RLS'
);

set role authenticated;
select set_config(
  'request.jwt.claims',
  '{"email":"editor@example.test","role":"authenticated"}',
  false
);

insert into public.projection_workforce_settings (codigo_obra, insumo, ativo)
values ('OBRA-B', 'ADM5189', true);

insert into public.projection_workforce_rows (
  codigo_obra,
  insumo,
  cargo,
  custo_mensal,
  distribuicao,
  ordem
)
values (
  'OBRA-B',
  'ADM5189',
  'Engenheiro',
  12500.50,
  '{"2026-07":2,"2026-08":1}'::jsonb,
  0
);

select pg_temp.assert_true(
  (select count(*) = 1 from public.projection_workforce_settings)
  and (select count(*) = 1 from public.projection_workforce_rows),
  'editor deve gravar e ler o planejamento da obra atribuida'
);

select pg_temp.expect_failure(
  $$insert into public.projection_workforce_settings (codigo_obra, insumo, ativo)
    values ('OBRA-A', 'CONDH271', true)$$,
  'editor nao pode alterar outra obra'
);

select pg_temp.expect_failure(
  $$insert into public.projection_workforce_rows (
      codigo_obra, insumo, cargo, custo_mensal, distribuicao, ordem
    ) values ('OBRA-B', 'OUTRO', 'Invalido', 1, '{}'::jsonb, 1)$$,
  'somente os dois insumos controlados devem ser aceitos'
);

select set_config(
  'request.jwt.claims',
  '{"email":"admin@example.test","role":"authenticated"}',
  false
);

insert into public.projection_workforce_settings (codigo_obra, insumo, ativo)
values ('OBRA-A', 'CONDH271', true);

select pg_temp.assert_true(
  (select count(*) = 2 from public.projection_workforce_settings),
  'admin deve gerenciar qualquer obra'
);

reset role;

set role anon;
select pg_temp.assert_true(
  (select count(*) = 2 from public.projection_workforce_settings)
  and (select count(*) = 1 from public.projection_workforce_rows),
  'dashboard publico deve ler configuracoes e linhas'
);
reset role;

select 'projection workforce assertions: ok' as result;
