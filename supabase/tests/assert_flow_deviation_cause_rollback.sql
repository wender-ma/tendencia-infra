\set ON_ERROR_STOP on

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'flow_classifications'
      and column_name in ('causa_desvio', 'indice_inflacao')
  ) then
    raise exception 'ASSERTION FAILED: rollback deve remover causa e indice';
  end if;
end;
$$;

select 'flow deviation cause rollback assertions: ok' as result;
