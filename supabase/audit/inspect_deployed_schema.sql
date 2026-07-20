-- Auditoria somente leitura para executar no Supabase SQL Editor.
-- Exporte os resultados de cada consulta sem incluir segredos ou dados de linhas.

-- 1. Colunas e tipos
select
  table_schema,
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema in ('public', 'storage')
  and table_name in (
    'obras',
    'editores_permitidos',
    'flow_classifications',
    'flow_manuals',
    'projecao_config',
    'projecao_movimentacoes',
    'dashboard_config',
    'upload_history',
    'upload_history_latest',
    'objects',
    'buckets'
  )
order by table_schema, table_name, ordinal_position;

-- 2. RLS habilitado/forcado
select
  n.nspname as table_schema,
  c.relname as table_name,
  c.relkind,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'storage')
  and c.relname in (
    'obras',
    'editores_permitidos',
    'flow_classifications',
    'flow_manuals',
    'projecao_config',
    'projecao_movimentacoes',
    'dashboard_config',
    'upload_history',
    'upload_history_latest',
    'objects'
  )
order by table_schema, table_name;

-- 3. Policies atuais
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname in ('public', 'storage')
  and (
    tablename in (
      'obras',
      'editores_permitidos',
      'flow_classifications',
      'flow_manuals',
      'projecao_config',
      'projecao_movimentacoes',
      'dashboard_config',
      'upload_history'
    )
    or (schemaname = 'storage' and tablename = 'objects')
  )
order by schemaname, tablename, policyname;

-- 4. Grants por role
select
  table_schema,
  table_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where table_schema in ('public', 'storage')
  and grantee in ('anon', 'authenticated', 'service_role')
  and table_name in (
    'obras',
    'editores_permitidos',
    'flow_classifications',
    'flow_manuals',
    'projecao_config',
    'projecao_movimentacoes',
    'dashboard_config',
    'upload_history',
    'upload_history_latest',
    'objects'
  )
order by table_schema, table_name, grantee, privilege_type;

-- 5. Constraints
select
  n.nspname as table_schema,
  c.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_get_constraintdef(con.oid, true) as definition
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'obras',
    'editores_permitidos',
    'flow_classifications',
    'flow_manuals',
    'projecao_config',
    'projecao_movimentacoes',
    'dashboard_config',
    'upload_history'
  )
order by table_name, constraint_name;

-- 6. Indices
select schemaname, tablename, indexname, indexdef
from pg_indexes
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
  )
order by tablename, indexname;

-- 7. Triggers nao internos
select
  event_object_schema,
  event_object_table,
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
from information_schema.triggers
where event_object_schema in ('public', 'auth')
order by event_object_schema, event_object_table, trigger_name;

-- 8. Funcoes de autorizacao/cadastro existentes (assinaturas, sem dados)
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
order by function_schema, function_name, arguments;

-- 9. Definicao da view usada pelo frontend
select schemaname, viewname, viewowner, definition
from pg_views
where schemaname = 'public'
  and viewname = 'upload_history_latest';

-- 10. Bucket e configuracao, sem listar objetos
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'uploads-history';
