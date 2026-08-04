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
  has_column_privilege('anon', 'public.flow_classifications', 'observacao', 'SELECT')
  and not has_column_privilege('anon', 'public.flow_classifications', 'causa_desvio', 'SELECT')
  and not has_column_privilege('anon', 'public.flow_classifications', 'indice_inflacao', 'SELECT'),
  'anon deve ler anotacoes, mas nao os campos legados'
);

select pg_temp.assert_true(
  (
    select refletido_status = 'ipca' and refletido_mes is not null
    from public.flow_classifications
    where codigo_obra = 'OBRA-A' and n_alteracao = 'FLOW-INFLACAO-IPCA'
  ),
  'inflacao da v1.11 deve ser convertida para o status IPCA'
);

insert into public.flow_classifications (
  codigo_obra,
  n_alteracao,
  refletido_status,
  refletido_mes,
  observacao
)
values ('OBRA-A', 'FLOW-INCC', 'incc', date '2026-08-01', 'Parcela de agosto');

select pg_temp.expect_failure(
  $$insert into public.flow_classifications (
      codigo_obra, n_alteracao, refletido_status
    ) values ('OBRA-A', 'FLOW-INVALIDO', 'igpm')$$,
  'status fora do contrato deve ser recusado'
);

set role anon;

select pg_temp.assert_true(
  (
    select observacao = 'Parcela de agosto'
    from public.flow_classifications
    where codigo_obra = 'OBRA-A' and n_alteracao = 'FLOW-INCC'
  ),
  'dashboard publico deve ler as anotacoes'
);

reset role;

select 'flow reflection inflation assertions: ok' as result;
