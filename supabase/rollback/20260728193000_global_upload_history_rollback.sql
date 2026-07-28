-- Remove o contrato de escopo global. A normalizacao de codigo_obra feita pela
-- migration nao e revertida automaticamente porque novos registros globais nao
-- possuem uma obra de origem confiavel.

begin;

drop function if exists public.reset_global_dashboard_datasets();

drop index if exists public.upload_history_one_active_global_kind;
drop index if exists public.upload_history_one_active_project_kind;

alter table if exists public.upload_history
  drop constraint if exists upload_history_scope_check;

create or replace function public.authz_can_manage_upload(
  target_codigo_obra text,
  target_tipo text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.authz_is_admin()
    or (
      target_tipo = 'tendencia'
      and public.authz_can_edit_obra(target_codigo_obra)
    );
$$;

revoke all on function public.authz_can_manage_upload(text, text)
  from public, anon;
grant execute on function public.authz_can_manage_upload(text, text)
  to authenticated;

drop policy if exists upload_history_read_scope on public.upload_history;
create policy upload_history_read_scope
on public.upload_history for select to authenticated
using (public.authz_can_edit_obra(codigo_obra));

commit;
