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
  has_column_privilege('anon', 'public.flow_classifications', 'causa_desvio', 'SELECT')
  and has_column_privilege('anon', 'public.flow_classifications', 'indice_inflacao', 'SELECT'),
  'anon deve ler causa do desvio e indice da inflacao'
);

insert into public.flow_classifications (codigo_obra, n_alteracao)
values ('OBRA-A', 'FLOW-SEM-CAUSA');

select pg_temp.assert_true(
  (
    select causa_desvio = 'nao_classificado' and indice_inflacao is null
    from public.flow_classifications
    where codigo_obra = 'OBRA-A' and n_alteracao = 'FLOW-SEM-CAUSA'
  ),
  'registros existentes e novos devem iniciar sem classificacao'
);

select pg_temp.expect_failure(
  $$insert into public.flow_classifications (
      codigo_obra, n_alteracao, causa_desvio, indice_inflacao
    ) values ('OBRA-A', 'FLOW-INFLACAO-INCOMPLETA', 'inflacao', null)$$,
  'inflacao sem indice deve ser recusada'
);

insert into public.flow_classifications (
  codigo_obra,
  n_alteracao,
  causa_desvio,
  indice_inflacao
)
values ('OBRA-A', 'FLOW-INFLACAO-IPCA', 'inflacao', 'ipca');

select pg_temp.expect_failure(
  $$update public.flow_classifications
    set causa_desvio = 'demais_causas'
    where codigo_obra = 'OBRA-A' and n_alteracao = 'FLOW-INFLACAO-IPCA'$$,
  'causa nao inflacionaria nao pode manter indice'
);

set role anon;

select pg_temp.assert_true(
  (
    select causa_desvio = 'inflacao' and indice_inflacao = 'ipca'
    from public.flow_classifications
    where codigo_obra = 'OBRA-A' and n_alteracao = 'FLOW-INFLACAO-IPCA'
  ),
  'dashboard publico deve ler a classificacao completa'
);

reset role;

select 'flow deviation cause assertions: ok' as result;
