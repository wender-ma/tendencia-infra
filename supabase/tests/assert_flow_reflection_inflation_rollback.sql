\set ON_ERROR_STOP on

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'flow_classifications'
      and column_name = 'observacao'
  ) then
    raise exception 'ASSERTION FAILED: rollback deve remover observacao';
  end if;

  if not has_column_privilege(
    'anon',
    'public.flow_classifications',
    'causa_desvio',
    'SELECT'
  ) then
    raise exception 'ASSERTION FAILED: rollback deve restaurar leitura da causa';
  end if;

  if not exists (
    select 1
    from public.flow_classifications
    where codigo_obra = 'OBRA-A'
      and n_alteracao = 'FLOW-INFLACAO-IPCA'
      and refletido_status = 'sim'
      and causa_desvio = 'inflacao'
      and indice_inflacao = 'ipca'
  ) then
    raise exception 'ASSERTION FAILED: rollback deve restaurar a classificacao v1.11';
  end if;
end;
$$;

select 'flow reflection inflation rollback assertions: ok' as result;
