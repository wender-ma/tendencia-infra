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
  has_column_privilege('anon', 'public.obras', 'codigo_obra', 'SELECT')
  and has_column_privilege('anon', 'public.obras', 'nome', 'SELECT')
  and not has_column_privilege('anon', 'public.obras', 'observacao', 'SELECT')
  and not has_column_privilege(
    'anon',
    'public.flow_classifications',
    'updated_by',
    'SELECT'
  )
  and not has_column_privilege('anon', 'public.flow_manuals', 'created_by', 'SELECT')
  and not has_column_privilege(
    'anon',
    'public.dashboard_datasets',
    'created_by',
    'SELECT'
  )
  and not has_column_privilege(
    'anon',
    'public.dashboard_datasets',
    'upload_history_id',
    'SELECT'
  ),
  'anon deve acessar somente o contrato de colunas do painel'
);

select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.obras', 'SELECT')
  and has_column_privilege(
    'authenticated',
    'public.dashboard_datasets',
    'created_by',
    'SELECT'
  ),
  'authenticated deve preservar leitura administrativa integral'
);

insert into public.obras (codigo_obra, nome, ativa, origem)
values ('OBRA-INATIVA', 'Obra inativa', false, 'manual');
insert into public.dashboard_config (chave, valor) values
  ('OBRA-A:evol_global', '31'),
  ('dados_flows', 'conteudo legado');

set role anon;

select pg_temp.assert_true(
  exists (select 1 from public.obras where codigo_obra = 'OBRA-A')
  and exists (select 1 from public.obras where codigo_obra = 'OBRA-B')
  and not exists (select 1 from public.obras where codigo_obra = 'OBRA-INATIVA'),
  'anon deve enxergar somente obras ativas'
);

select pg_temp.assert_true(
  exists (select 1 from public.dashboard_config where chave = 'OBRA-A:evol_global')
  and not exists (select 1 from public.dashboard_config where chave = 'dados_flows'),
  'anon nao deve receber blobs legados de dashboard_config'
);

select pg_temp.expect_failure(
  $$select public.admin_register_upload_projects(
      '[{"codigo_obra":"SEM-PERMISSAO","nome":"Sem permissao"}]'::jsonb
    )$$,
  'anon nao pode cadastrar obras'
);

reset role;
set role authenticated;
select set_config(
  'request.jwt.claims',
  '{"email":"admin@example.test","role":"authenticated"}',
  false
);

create temporary table registered_projects_result (payload jsonb);
insert into registered_projects_result
select public.admin_register_upload_projects(
  '[
    {"codigo_obra":"UPLOAD-ONE","nome":"Upload One"},
    {"codigo_obra":"UPLOAD-TWO","nome":"Upload Two"}
  ]'::jsonb
);

select pg_temp.assert_true(
  (select payload -> 'created_codes' @> '["UPLOAD-ONE","UPLOAD-TWO"]'::jsonb
   from registered_projects_result)
  and (select count(*) = 2
       from public.obras
       where codigo_obra in ('UPLOAD-ONE', 'UPLOAD-TWO')
         and origem = 'upload'
         and ativa),
  'RPC deve cadastrar as obras do upload e informar os codigos criados'
);

select pg_temp.assert_true(
  public.admin_register_upload_projects(
    '[{"codigo_obra":"UPLOAD-ONE","nome":"Nome ignorado"}]'::jsonb
  ) -> 'created_codes' = '[]'::jsonb,
  'cadastro repetido deve ser idempotente'
);

insert into public.flow_manuals (codigo_obra, n_alteracao)
values ('UPLOAD-TWO', 'FLOW-1');

create temporary table rollback_projects_result (payload jsonb);
insert into rollback_projects_result
select public.admin_rollback_upload_projects(array['UPLOAD-ONE', 'UPLOAD-TWO']);

select pg_temp.assert_true(
  not exists (select 1 from public.obras where codigo_obra = 'UPLOAD-ONE')
  and exists (select 1 from public.obras where codigo_obra = 'UPLOAD-TWO')
  and (select payload -> 'deleted_codes' @> '["UPLOAD-ONE"]'::jsonb
       from rollback_projects_result)
  and (select payload -> 'skipped_codes' @> '["UPLOAD-TWO"]'::jsonb
       from rollback_projects_result),
  'rollback deve remover apenas obras de upload ainda sem dependencias'
);

reset role;

select 'release hardening assertions: ok' as result;
