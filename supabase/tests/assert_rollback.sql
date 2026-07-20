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
  (select count(*) = 20
   from pg_policies
   where schemaname = 'public'
     and tablename in (
       'obras',
       'editores_permitidos',
       'flow_classifications',
       'flow_manuals',
       'projecao_config',
       'projecao_movimentacoes',
       'dashboard_config',
       'upload_history'
     )),
  'rollback deve restaurar as 20 policies do baseline auditado'
);

select pg_temp.assert_true(
  (select count(*) = 4
   from pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'),
  'rollback deve restaurar as quatro policies de Storage'
);

select pg_temp.assert_true(
  has_table_privilege('anon', 'public.editores_permitidos', 'SELECT')
  and has_table_privilege('anon', 'public.upload_history', 'SELECT')
  and has_table_privilege('anon', 'public.upload_history_latest', 'SELECT'),
  'rollback deve restaurar os grants publicos do baseline'
);

select pg_temp.assert_true(
  has_table_privilege('anon', 'public.obras', 'TRUNCATE')
  and has_table_privilege('authenticated', 'storage.objects', 'TRUNCATE'),
  'rollback deve restaurar os grants amplos do baseline'
);

select pg_temp.assert_true(
  has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.is_editor(text)', 'EXECUTE'),
  'rollback deve reabrir os helpers legados conforme o baseline'
);

select pg_temp.assert_true(
  to_regprocedure('public.authz_can_edit_obra(text)') is null
  and to_regprocedure('public.authz_is_admin()') is null,
  'rollback deve remover os helpers criados pela migration'
);

select pg_temp.assert_true(
  coalesce(
    (select not coalesce(reloptions, '{}'::text[]) @> array['security_invoker=true']
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'upload_history_latest'),
    false
  ),
  'rollback deve restaurar a configuracao original da view'
);

select 'rollback assertions: ok' as result;
