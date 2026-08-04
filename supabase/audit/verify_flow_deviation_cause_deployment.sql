with columns as (
  select
    count(*) filter (where column_name = 'causa_desvio') = 1 as cause_exists,
    count(*) filter (where column_name = 'indice_inflacao') = 1 as index_exists
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'flow_classifications'
), constraints as (
  select count(*) = 3 as valid
  from pg_constraint
  where conrelid = 'public.flow_classifications'::regclass
    and conname in (
      'flow_classifications_causa_desvio_check',
      'flow_classifications_indice_inflacao_check',
      'flow_classifications_inflacao_completa_check'
    )
), grants as (
  select count(distinct column_name) = 2 as anon_can_read
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'flow_classifications'
    and grantee = 'anon'
    and privilege_type = 'SELECT'
    and column_name in ('causa_desvio', 'indice_inflacao')
)
select jsonb_build_object(
  'complete',
    (select cause_exists and index_exists from columns)
    and (select valid from constraints)
    and (select anon_can_read from grants),
  'cause_column_exists', (select cause_exists from columns),
  'index_column_exists', (select index_exists from columns),
  'constraints_valid', (select valid from constraints),
  'anon_read_enabled', (select anon_can_read from grants),
  'classified_inflation_rows', (
    select count(*)
    from public.flow_classifications
    where causa_desvio = 'inflacao'
  )
) as flow_deviation_cause_deployment;
