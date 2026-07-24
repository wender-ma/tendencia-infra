-- Auditoria somente leitura das operacoes administrativas atomicas.
-- Execute no SQL Editor do projeto de desenvolvimento.
-- Antes, execute `npm run env:target` e compare o project ref com a URL aberta.

select pg_notify('pgrst', 'reload schema') as schema_reload_requested;

with deployment as (
  select
    to_regprocedure(
      'public.admin_replace_user_permissions(text,text,text,text,text[])'
    ) is not null as replace_permissions_rpc_exists,
    to_regprocedure(
      'public.admin_delete_user_permissions(text)'
    ) is not null as delete_permissions_rpc_exists,
    to_regprocedure(
      'public.admin_delete_obra(text)'
    ) is not null as delete_project_rpc_exists
)
select jsonb_build_object(
  'replace_permissions_rpc_exists', replace_permissions_rpc_exists,
  'delete_permissions_rpc_exists', delete_permissions_rpc_exists,
  'delete_project_rpc_exists', delete_project_rpc_exists,
  'complete',
    replace_permissions_rpc_exists
    and delete_permissions_rpc_exists
    and delete_project_rpc_exists
) as admin_transactions_deployment
from deployment;
