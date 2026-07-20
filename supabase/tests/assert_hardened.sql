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
  (select count(*) = 32
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
  'as oito tabelas public devem ter exatamente 32 policies endurecidas'
);

select pg_temp.assert_true(
  (select count(*) = 4
   from pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and policyname like 'uploads_history_%'),
  'o bucket deve ter quatro policies endurecidas'
);

select pg_temp.assert_true(
  has_table_privilege('anon', 'public.obras', 'SELECT'),
  'anon deve manter leitura operacional de obras nesta etapa'
);

select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.editores_permitidos', 'SELECT'),
  'anon nao pode ler a whitelist'
);

select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.upload_history', 'SELECT'),
  'anon nao pode ler metadados de upload'
);

select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.upload_history_latest', 'SELECT'),
  'anon nao pode ler a view de uploads'
);

select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.upload_history', 'SELECT,INSERT,UPDATE,DELETE'),
  'authenticated precisa dos grants sujeitos a RLS em upload_history'
);

select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.obras', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.obras', 'TRUNCATE'),
  'roles do cliente nao podem truncar tabelas'
);

select pg_temp.assert_true(
  not has_table_privilege('anon', 'storage.objects', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'storage.objects', 'TRUNCATE'),
  'grants perigosos do Storage devem ser removidos'
);

select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE'),
  'o trigger helper nao pode ficar exposto como RPC'
);

select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.is_editor(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.is_editor(text)', 'EXECUTE'),
  'helpers legados nao podem ficar expostos como RPC'
);

select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.authz_can_edit_obra(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.authz_can_edit_obra(text)', 'EXECUTE'),
  'helper endurecido deve ser executavel apenas por authenticated'
);

select pg_temp.assert_true(
  coalesce(
    (select reloptions @> array['security_invoker=true']
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'upload_history_latest'),
    false
  ),
  'a view deve executar com as policies do chamador'
);

set role authenticated;
select set_config(
  'request.jwt.claims',
  '{"email":"editor@example.test","role":"authenticated"}',
  false
);

select pg_temp.assert_true(
  (select count(*) = 1 from public.editores_permitidos),
  'editor deve enxergar somente a propria permissao'
);

select pg_temp.assert_true(
  (select count(*) = 1 from public.upload_history),
  'editor deve ler metadados somente da obra atribuida'
);

select pg_temp.assert_true(
  (select count(*) = 1 from storage.objects),
  'editor deve ler somente arquivos tendencia da obra atribuida'
);

select pg_temp.assert_true(
  public.authz_can_edit_obra('OBRA-A')
  and not public.authz_can_edit_obra('OBRA-B'),
  'editor deve editar somente a obra atribuida'
);

select pg_temp.assert_true(
  public.authz_can_manage_upload('OBRA-A', 'tendencia')
  and not public.authz_can_manage_upload('OBRA-A', 'flows')
  and not public.authz_can_manage_upload('OBRA-A', 'excel'),
  'editor deve gerenciar apenas upload tendencia da propria obra'
);

select set_config(
  'request.jwt.claims',
  '{"email":"admin@example.test","role":"authenticated"}',
  false
);

select pg_temp.assert_true(
  (select count(*) = 3 from public.editores_permitidos),
  'admin deve enxergar todas as permissoes'
);

select pg_temp.assert_true(
  (select count(*) = 2 from public.upload_history)
  and (select count(*) = 3 from storage.objects),
  'admin deve enxergar metadados e arquivos de todas as obras'
);

select pg_temp.assert_true(
  public.authz_is_admin()
  and public.authz_can_edit_obra('OBRA-B')
  and public.authz_can_manage_upload('OBRA-A', 'flows')
  and public.authz_can_manage_upload('OBRA-A', 'excel'),
  'admin deve administrar obras e uploads globais'
);

select set_config(
  'request.jwt.claims',
  '{"email":"inactive@example.test","role":"authenticated"}',
  false
);

select pg_temp.assert_true(
  (select count(*) = 0 from public.upload_history)
  and (select count(*) = 0 from storage.objects),
  'usuario inativo nao deve ler historico nem arquivos'
);

reset role;

select 'hardened assertions: ok' as result;
