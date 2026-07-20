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
  has_function_privilege(
    'authenticated',
    'public.admin_replace_user_permissions(text,text,text,text,text[])',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.admin_replace_user_permissions(text,text,text,text,text[])',
    'EXECUTE'
  ),
  'a RPC de permissoes deve ser exposta somente a authenticated'
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
     and c.confdeltype = 'c'),
  'as seis chaves estrangeiras devem usar ON DELETE CASCADE'
);

set role authenticated;
select set_config(
  'request.jwt.claims',
  '{"email":"editor@example.test","role":"authenticated"}',
  false
);

select pg_temp.expect_failure(
  $$select public.admin_replace_user_permissions(
      'other@example.test', null, null, 'editor', array['OBRA-A']
    )$$,
  'editor nao pode executar operacoes administrativas'
);

select set_config(
  'request.jwt.claims',
  '{"email":"admin@example.test","role":"authenticated"}',
  false
);

select public.admin_replace_user_permissions(
  'editor@example.test',
  'Editor Teste',
  'Escopo atualizado',
  'editor',
  array['OBRA-B', 'OBRA-B']
);

select pg_temp.assert_true(
  (select count(*) = 1
   from public.editores_permitidos
   where email = 'editor@example.test'
     and codigo_obra = 'OBRA-B'
     and role = 'editor'
     and status = 'active'),
  'a substituicao deve normalizar e gravar o novo escopo'
);

select pg_temp.expect_failure(
  $$select public.admin_replace_user_permissions(
      'editor@example.test', 'Editor Teste', null, 'editor', array['OBRA-INEXISTENTE']
    )$$,
  'obra inexistente deve impedir a troca de permissoes'
);

select pg_temp.assert_true(
  (select count(*) = 1
   from public.editores_permitidos
   where email = 'editor@example.test'
     and codigo_obra = 'OBRA-B'),
  'falha de validacao deve preservar as permissoes anteriores'
);

select pg_temp.expect_failure(
  $$select public.admin_replace_user_permissions(
      'admin@example.test', 'Admin', null, 'editor', array['OBRA-A']
    )$$,
  'o ultimo administrador nao pode ser rebaixado'
);

select pg_temp.expect_failure(
  $$select public.admin_delete_user_permissions('admin@example.test')$$,
  'o ultimo administrador nao pode ser excluido'
);

insert into public.editores_permitidos (email, codigo_obra, role, status)
values ('delete@example.test', 'OBRA-A', 'editor', 'active');

select public.admin_delete_user_permissions('delete@example.test');

select pg_temp.assert_true(
  not exists (
    select 1 from public.editores_permitidos where email = 'delete@example.test'
  ),
  'a RPC de exclusao deve remover todos os registros do usuario'
);

insert into public.obras (codigo_obra, nome, origem)
values ('OBRA-DELETE', 'Obra descartavel', 'manual');
insert into public.flow_classifications values ('OBRA-DELETE', 'CLASS-1');
insert into public.flow_manuals values ('OBRA-DELETE', 'MANUAL-1');
insert into public.projecao_config values ('OBRA-DELETE');
insert into public.projecao_movimentacoes values ('MOV-DELETE', 'OBRA-DELETE');
insert into public.dashboard_config (chave, valor) values
  ('OBRA-DELETE:dados_tendencia', '{}'),
  ('header_title', 'Global preservado');
insert into public.upload_history (
  codigo_obra, tipo, nome_arquivo, storage_path, is_active
) values (
  'OBRA-DELETE', 'tendencia', 'delete.csv',
  'OBRA-DELETE/tendencia/delete.csv', true
);
insert into public.editores_permitidos (email, codigo_obra, role, status)
values ('scoped@example.test', 'OBRA-DELETE', 'editor', 'active');

create temporary table delete_obra_result (payload jsonb);
insert into delete_obra_result
select public.admin_delete_obra('OBRA-DELETE');

select pg_temp.assert_true(
  not exists (select 1 from public.obras where codigo_obra = 'OBRA-DELETE')
  and not exists (select 1 from public.flow_classifications where codigo_obra = 'OBRA-DELETE')
  and not exists (select 1 from public.flow_manuals where codigo_obra = 'OBRA-DELETE')
  and not exists (select 1 from public.projecao_config where codigo_obra = 'OBRA-DELETE')
  and not exists (select 1 from public.projecao_movimentacoes where codigo_obra = 'OBRA-DELETE')
  and not exists (select 1 from public.upload_history where codigo_obra = 'OBRA-DELETE')
  and not exists (select 1 from public.editores_permitidos where codigo_obra = 'OBRA-DELETE')
  and not exists (select 1 from public.dashboard_config where chave = 'OBRA-DELETE:dados_tendencia'),
  'a exclusao de obra deve remover todos os dados vinculados'
);

select pg_temp.assert_true(
  exists (select 1 from public.dashboard_config where chave = 'header_title')
  and (select payload -> 'storage_paths' @> '["OBRA-DELETE/tendencia/delete.csv"]'::jsonb
       from delete_obra_result),
  'a exclusao deve preservar configuracao global e retornar arquivos para limpeza'
);

insert into public.obras (codigo_obra, nome, origem)
values ('OBRA-UPLOAD', 'Obra importada', 'upload');

select pg_temp.expect_failure(
  $$select public.admin_delete_obra('OBRA-UPLOAD')$$,
  'obra importada nao pode ser excluida pela RPC administrativa'
);

select pg_temp.assert_true(
  exists (select 1 from public.obras where codigo_obra = 'OBRA-UPLOAD'),
  'falha na exclusao deve preservar a obra'
);

reset role;

select 'admin transaction assertions: ok' as result;
