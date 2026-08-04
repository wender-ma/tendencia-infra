-- Auditoria somente leitura do hardening de lancamento.

with expected_columns(table_name, columns) as (
  values
    ('obras', array['codigo_obra', 'nome', 'ativa']::text[]),
    (
      'flow_classifications',
      array[
        'codigo_obra', 'n_alteracao', 'insumo_planejamento',
        'insumo_remanejamento', 'custo_flowmaster', 'refletido_status',
        'refletido_mes', 'causa_desvio', 'indice_inflacao'
      ]::text[]
    ),
    (
      'flow_manuals',
      array[
        'codigo_obra', 'n_alteracao', 'n_adt', 'dep', 'descricao', 'data_br',
        'data', 'aprovador_dep', 'aprovador', 'solicitante_dep', 'solicitante',
        'custo_flowmaster', 'custo_planejamento', 'motivo', 'justificativa',
        'insumo_planejamento', 'insumo_remanejamento', 'obs'
      ]::text[]
    ),
    (
      'projecao_config',
      array[
        'codigo_obra', 'insumo_controlado', 'saldo_inicial', 'data_ref',
        'locked_saldo', 'locked_data', 'locked_insumo'
      ]::text[]
    ),
    (
      'projecao_movimentacoes',
      array[
        'id', 'codigo_obra', 'tipo', 'data', 'data_br', 'origem', 'destino',
        'descricao', 'justificativa', 'responsavel', 'valor', 'created_at'
      ]::text[]
    ),
    ('dashboard_config', array['chave', 'valor']::text[]),
    (
      'dashboard_datasets',
      array[
        'id', 'codigo_obra', 'tipo', 'versao', 'storage_path', 'sha256',
        'linhas', 'bytes', 'status', 'created_at', 'activated_at'
      ]::text[]
    )
),
actual_columns as (
  select
    cp.table_name,
    array_agg(distinct cp.column_name::text order by cp.column_name::text) as columns
  from information_schema.column_privileges cp
  where cp.table_schema = 'public'
    and cp.grantee = 'anon'
    and cp.privilege_type = 'SELECT'
    and cp.table_name in (select table_name from expected_columns)
  group by cp.table_name
),
column_contract as (
  select
    count(*) = 7
    and bool_and(
      (select array_agg(value order by value) from unnest(expected.columns) value)
      = actual.columns
    ) as valid
  from expected_columns expected
  join actual_columns actual using (table_name)
),
required_policies as (
  select count(*) = 4 as valid
  from pg_policies
  where schemaname = 'public'
    and (
      (tablename = 'obras' and policyname in (
        'obras_read_anon_active',
        'obras_read_authenticated'
      ))
      or (
        tablename = 'dashboard_config'
        and policyname in (
          'dashboard_config_read_anon_safe',
          'dashboard_config_read_authenticated'
        )
      )
    )
)
select jsonb_build_object(
  'complete',
  (select valid from column_contract)
  and (select valid from required_policies)
  and to_regprocedure('public.admin_register_upload_projects(jsonb)') is not null
  and to_regprocedure('public.admin_rollback_upload_projects(text[])') is not null
  and not has_function_privilege(
    'anon',
    'public.admin_register_upload_projects(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.admin_rollback_upload_projects(text[])',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.admin_register_upload_projects(jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.admin_rollback_upload_projects(text[])',
    'EXECUTE'
  ),
  'anon_column_contract_valid',
  (select valid from column_contract),
  'required_policies_present',
  (select valid from required_policies),
  'register_rpc_exists',
  to_regprocedure('public.admin_register_upload_projects(jsonb)') is not null,
  'rollback_rpc_exists',
  to_regprocedure('public.admin_rollback_upload_projects(text[])') is not null,
  'anon_rpc_execute_blocked',
  not has_function_privilege(
    'anon',
    'public.admin_register_upload_projects(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.admin_rollback_upload_projects(text[])',
    'EXECUTE'
  )
) as release_hardening_deployment;
