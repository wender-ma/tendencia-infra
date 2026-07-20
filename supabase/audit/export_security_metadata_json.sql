-- Execute no Supabase SQL Editor.
-- Retorna um unico JSON com metadata de seguranca, sem linhas de negocio.

with
target_relations(table_schema, table_name) as (
  values
    ('public', 'obras'),
    ('public', 'editores_permitidos'),
    ('public', 'flow_classifications'),
    ('public', 'flow_manuals'),
    ('public', 'projecao_config'),
    ('public', 'projecao_movimentacoes'),
    ('public', 'dashboard_config'),
    ('public', 'upload_history'),
    ('public', 'upload_history_latest'),
    ('storage', 'objects'),
    ('storage', 'buckets')
),
columns_report as (
  select
    c.table_schema,
    c.table_name,
    c.ordinal_position,
    c.column_name,
    c.data_type,
    c.udt_name,
    c.is_nullable,
    c.column_default
  from information_schema.columns c
  join target_relations t using (table_schema, table_name)
),
rls_report as (
  select
    n.nspname as table_schema,
    c.relname as table_name,
    c.relkind,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join target_relations t
    on t.table_schema = n.nspname
   and t.table_name = c.relname
),
policies_report as (
  select
    p.schemaname,
    p.tablename,
    p.policyname,
    p.permissive,
    p.roles,
    p.cmd,
    p.qual,
    p.with_check
  from pg_policies p
  join target_relations t
    on t.table_schema = p.schemaname
   and t.table_name = p.tablename
),
grants_report as (
  select
    g.table_schema,
    g.table_name,
    g.grantee,
    g.privilege_type,
    g.is_grantable
  from information_schema.role_table_grants g
  join target_relations t using (table_schema, table_name)
  where g.grantee in ('anon', 'authenticated', 'service_role')
),
constraints_report as (
  select
    n.nspname as table_schema,
    c.relname as table_name,
    con.conname as constraint_name,
    con.contype as constraint_type,
    pg_get_constraintdef(con.oid, true) as definition
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  join target_relations t
    on t.table_schema = n.nspname
   and t.table_name = c.relname
),
indexes_report as (
  select i.schemaname, i.tablename, i.indexname, i.indexdef
  from pg_indexes i
  join target_relations t
    on t.table_schema = i.schemaname
   and t.table_name = i.tablename
),
triggers_report as (
  select
    event_object_schema,
    event_object_table,
    trigger_name,
    event_manipulation,
    action_timing,
    action_statement
  from information_schema.triggers
  where event_object_schema in ('public', 'auth')
),
functions_report as (
  select
    n.nspname as function_schema,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments,
    p.prosecdef as security_definer,
    p.provolatile as volatility
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'auth')
    and (
      p.proname ilike '%editor%'
      or p.proname ilike '%admin%'
      or p.proname ilike '%user%'
      or p.proname ilike '%permission%'
      or p.proname ilike '%upload%'
    )
),
views_report as (
  select schemaname, viewname, viewowner, definition
  from pg_views
  where schemaname = 'public'
    and viewname = 'upload_history_latest'
),
buckets_report as (
  select id, name, public, file_size_limit, allowed_mime_types
  from storage.buckets
  where id = 'uploads-history'
)
select jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'database', current_database(),
  'columns', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.table_schema, r.table_name, r.ordinal_position)
    from columns_report r
  ), '[]'::jsonb),
  'rls', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.table_schema, r.table_name)
    from rls_report r
  ), '[]'::jsonb),
  'policies', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.schemaname, r.tablename, r.policyname)
    from policies_report r
  ), '[]'::jsonb),
  'grants', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.table_schema, r.table_name, r.grantee, r.privilege_type)
    from grants_report r
  ), '[]'::jsonb),
  'constraints', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.table_schema, r.table_name, r.constraint_name)
    from constraints_report r
  ), '[]'::jsonb),
  'indexes', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.schemaname, r.tablename, r.indexname)
    from indexes_report r
  ), '[]'::jsonb),
  'triggers', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.event_object_schema, r.event_object_table, r.trigger_name)
    from triggers_report r
  ), '[]'::jsonb),
  'functions', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.function_schema, r.function_name, r.arguments)
    from functions_report r
  ), '[]'::jsonb),
  'views', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.schemaname, r.viewname)
    from views_report r
  ), '[]'::jsonb),
  'buckets', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.id)
    from buckets_report r
  ), '[]'::jsonb)
)) as security_metadata;
