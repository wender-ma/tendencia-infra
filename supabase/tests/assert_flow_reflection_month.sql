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
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'flow_classifications'
      and column_name = 'refletido_mes'
      and data_type = 'date'
  )
  and has_column_privilege(
    'anon',
    'public.flow_classifications',
    'refletido_mes',
    'SELECT'
  ),
  'refletido_mes deve existir como date e integrar o contrato publico'
);

insert into public.flow_classifications (
  codigo_obra,
  n_alteracao,
  refletido_status,
  refletido_mes
)
values ('OBRA-A', 'FLOW-MES', 'sim', date '2026-07-01');

select pg_temp.expect_failure(
  $$update public.flow_classifications
    set refletido_mes = date '2026-07-02'
    where codigo_obra = 'OBRA-A' and n_alteracao = 'FLOW-MES'$$,
  'refletido_mes deve aceitar somente o primeiro dia do mes'
);

set role anon;

select pg_temp.assert_true(
  (
    select refletido_mes = date '2026-07-01'
    from public.flow_classifications
    where codigo_obra = 'OBRA-A' and n_alteracao = 'FLOW-MES'
  ),
  'anon deve conseguir ler o mes de reflexo'
);

reset role;

select 'flow reflection month assertions: ok' as result;
