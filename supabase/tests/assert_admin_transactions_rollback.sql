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

select pg_temp.assert_true(
  to_regprocedure(
    'public.admin_replace_user_permissions(text,text,text,text,text[])'
  ) is null
  and to_regprocedure('public.admin_delete_user_permissions(text)') is null
  and to_regprocedure('public.admin_delete_obra(text)') is null,
  'o rollback deve remover as RPCs administrativas'
);

select pg_temp.assert_true(
  (select count(*) = 6
   from pg_constraint c
   join pg_namespace n on n.oid = c.connamespace
   where n.nspname = 'public'
     and c.conname in (
       'editores_permitidos_codigo_obra_fkey',
       'flow_classifications_codigo_obra_fkey',
       'flow_manuals_codigo_obra_fkey',
       'projecao_config_codigo_obra_fkey',
       'projecao_movimentacoes_codigo_obra_fkey',
       'upload_history_codigo_obra_fkey'
     )
     and c.confdeltype = 'a'),
  'o rollback deve restaurar as FKs sem cascata'
);

select 'admin transaction rollback assertions: ok' as result;
