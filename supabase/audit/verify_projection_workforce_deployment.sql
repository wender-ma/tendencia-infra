with deployment as (
  select
    to_regclass('public.projection_workforce_settings') is not null as settings_table_exists,
    to_regclass('public.projection_workforce_rows') is not null as rows_table_exists,
    coalesce((
      select relrowsecurity
      from pg_class
      where oid = to_regclass('public.projection_workforce_settings')
    ), false) as settings_rls_enabled,
    coalesce((
      select relrowsecurity
      from pg_class
      where oid = to_regclass('public.projection_workforce_rows')
    ), false) as rows_rls_enabled,
    (
      select count(*)
      from pg_policies
      where schemaname = 'public'
        and tablename = 'projection_workforce_settings'
    ) as settings_policy_count,
    (
      select count(*)
      from pg_policies
      where schemaname = 'public'
        and tablename = 'projection_workforce_rows'
    ) as rows_policy_count,
    coalesce(
      has_table_privilege('anon', 'public.projection_workforce_settings', 'SELECT')
      and has_table_privilege('anon', 'public.projection_workforce_rows', 'SELECT')
      and not has_table_privilege(
        'anon',
        'public.projection_workforce_settings',
        'INSERT,UPDATE,DELETE'
      )
      and not has_table_privilege(
        'anon',
        'public.projection_workforce_rows',
        'INSERT,UPDATE,DELETE'
      ),
      false
    ) as anon_read_only,
    coalesce(
      has_table_privilege(
        'authenticated',
        'public.projection_workforce_settings',
        'SELECT,INSERT,UPDATE,DELETE'
      )
      and has_table_privilege(
        'authenticated',
        'public.projection_workforce_rows',
        'SELECT,INSERT,UPDATE,DELETE'
      ),
      false
    ) as authenticated_grants_present
)
select jsonb_build_object(
  'complete',
    settings_table_exists
    and rows_table_exists
    and settings_rls_enabled
    and rows_rls_enabled
    and settings_policy_count = 4
    and rows_policy_count = 4
    and anon_read_only
    and authenticated_grants_present,
  'settings_table_exists', settings_table_exists,
  'rows_table_exists', rows_table_exists,
  'settings_rls_enabled', settings_rls_enabled,
  'rows_rls_enabled', rows_rls_enabled,
  'settings_policy_count', settings_policy_count,
  'rows_policy_count', rows_policy_count,
  'anon_read_only', anon_read_only,
  'authenticated_grants_present', authenticated_grants_present
)
from deployment;
