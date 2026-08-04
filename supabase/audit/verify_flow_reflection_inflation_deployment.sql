with columns as (
  select count(*) filter (where column_name = 'observacao') = 1 as observation_exists
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'flow_classifications'
), status_constraint as (
  select count(*) = 1 as valid
  from pg_constraint
  where conrelid = 'public.flow_classifications'::regclass
    and conname = 'flow_classifications_refletido_status_check'
    and pg_get_constraintdef(oid) like '%ipca%'
    and pg_get_constraintdef(oid) like '%incc%'
), grants as (
  select
    count(*) filter (where column_name = 'observacao') = 1 as observation_public,
    count(*) filter (where column_name in ('causa_desvio', 'indice_inflacao')) = 0 as legacy_private
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'flow_classifications'
    and grantee = 'anon'
    and privilege_type = 'SELECT'
    and column_name in ('observacao', 'causa_desvio', 'indice_inflacao')
)
select jsonb_build_object(
  'complete',
    (select observation_exists from columns)
    and (select valid from status_constraint)
    and (select observation_public and legacy_private from grants),
  'observation_column_exists', (select observation_exists from columns),
  'reflection_status_constraint_valid', (select valid from status_constraint),
  'observation_public', (select observation_public from grants),
  'legacy_columns_private', (select legacy_private from grants),
  'ipca_rows', (select count(*) from public.flow_classifications where refletido_status = 'ipca'),
  'incc_rows', (select count(*) from public.flow_classifications where refletido_status = 'incc')
) as flow_reflection_inflation_deployment;
