-- ============================================================================
-- RASCUNHO - NAO APLICAR EM PRODUCAO
-- ============================================================================
-- Este arquivo foi preparado a partir do contrato publico validado em
-- 20/07/2026. Ele ainda precisa ser comparado com o dump real de policies,
-- grants, triggers, views, constraints e tipos.
--
-- Perfil de leitura adotado neste rascunho: dashboard interno.
-- Somente usuarios autenticados com papel admin/editor ativo podem ler dados.
-- Isso altera o comportamento atual de visualizacao anonima e exige decisao
-- explicita do negocio antes de virar uma migration executavel.
-- ============================================================================

begin;

-- Helpers de autorizacao. SECURITY DEFINER evita recursao de RLS ao consultar
-- editores_permitidos. O executor da migration deve ser o owner do schema.
create or replace function public.authz_current_email()
returns text
language sql
stable
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.authz_has_active_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.editores_permitidos ep
    where lower(ep.email) = public.authz_current_email()
      and coalesce(ep.status, 'active') = 'active'
      and ep.role in ('admin', 'editor')
  );
$$;

create or replace function public.authz_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.editores_permitidos ep
    where lower(ep.email) = public.authz_current_email()
      and coalesce(ep.status, 'active') = 'active'
      and ep.role = 'admin'
  );
$$;

create or replace function public.authz_can_edit_obra(target_codigo_obra text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.authz_is_admin()
    or exists (
      select 1
      from public.editores_permitidos ep
      where lower(ep.email) = public.authz_current_email()
        and coalesce(ep.status, 'active') = 'active'
        and ep.role = 'editor'
        and ep.codigo_obra = target_codigo_obra
    );
$$;

create or replace function public.authz_can_edit_dashboard_key(target_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.authz_is_admin()
    or (
      position(':' in target_key) > 1
      and public.authz_can_edit_obra(split_part(target_key, ':', 1))
    );
$$;

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

revoke all on function public.authz_current_email() from public;
revoke all on function public.authz_has_active_access() from public;
revoke all on function public.authz_is_admin() from public;
revoke all on function public.authz_can_edit_obra(text) from public;
revoke all on function public.authz_can_edit_dashboard_key(text) from public;
revoke all on function public.authz_can_manage_upload(text, text) from public;

grant execute on function public.authz_current_email() to authenticated;
grant execute on function public.authz_has_active_access() to authenticated;
grant execute on function public.authz_is_admin() to authenticated;
grant execute on function public.authz_can_edit_obra(text) to authenticated;
grant execute on function public.authz_can_edit_dashboard_key(text) to authenticated;
grant execute on function public.authz_can_manage_upload(text, text) to authenticated;

-- Remove todas as policies atuais apenas das tabelas controladas pelo app.
-- Isso elimina policies permissivas com nomes desconhecidos sem afetar outras
-- tabelas do projeto.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'obras',
        'editores_permitidos',
        'flow_classifications',
        'flow_manuals',
        'projecao_config',
        'projecao_movimentacoes',
        'dashboard_config',
        'upload_history'
      ])
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      policy_row.policyname,
      policy_row.tablename
    );
  end loop;
end;
$$;

alter table public.obras enable row level security;
alter table public.editores_permitidos enable row level security;
alter table public.flow_classifications enable row level security;
alter table public.flow_manuals enable row level security;
alter table public.projecao_config enable row level security;
alter table public.projecao_movimentacoes enable row level security;
alter table public.dashboard_config enable row level security;
alter table public.upload_history enable row level security;

-- A role anon nao deve acessar tabelas diretamente neste perfil interno.
revoke all on table public.obras from anon;
revoke all on table public.editores_permitidos from anon;
revoke all on table public.flow_classifications from anon;
revoke all on table public.flow_manuals from anon;
revoke all on table public.projecao_config from anon;
revoke all on table public.projecao_movimentacoes from anon;
revoke all on table public.dashboard_config from anon;
revoke all on table public.upload_history from anon;

grant select on table public.obras to authenticated;
grant select on table public.editores_permitidos to authenticated;
grant select on table public.flow_classifications to authenticated;
grant select on table public.flow_manuals to authenticated;
grant select on table public.projecao_config to authenticated;
grant select on table public.projecao_movimentacoes to authenticated;
grant select on table public.dashboard_config to authenticated;
grant select on table public.upload_history to authenticated;

grant insert, update, delete on table public.obras to authenticated;
grant insert, update, delete on table public.editores_permitidos to authenticated;
grant insert, update, delete on table public.flow_classifications to authenticated;
grant insert, update, delete on table public.flow_manuals to authenticated;
grant insert, update, delete on table public.projecao_config to authenticated;
grant insert, update, delete on table public.projecao_movimentacoes to authenticated;
grant insert, update, delete on table public.dashboard_config to authenticated;
grant insert, update, delete on table public.upload_history to authenticated;

-- Leitura operacional: apenas usuarios aprovados.
create policy obras_read_active
on public.obras for select to authenticated
using (public.authz_has_active_access());

create policy flow_classifications_read_active
on public.flow_classifications for select to authenticated
using (public.authz_has_active_access());

create policy flow_manuals_read_active
on public.flow_manuals for select to authenticated
using (public.authz_has_active_access());

create policy projecao_config_read_active
on public.projecao_config for select to authenticated
using (public.authz_has_active_access());

create policy projecao_movimentacoes_read_active
on public.projecao_movimentacoes for select to authenticated
using (public.authz_has_active_access());

create policy dashboard_config_read_active
on public.dashboard_config for select to authenticated
using (public.authz_has_active_access());

create policy upload_history_read_active
on public.upload_history for select to authenticated
using (public.authz_has_active_access());

-- Cada usuario enxerga as proprias permissoes; admins enxergam todas.
create policy editores_permitidos_read_own_or_admin
on public.editores_permitidos for select to authenticated
using (
  lower(email) = public.authz_current_email()
  or public.authz_is_admin()
);

-- Catalogo de obras e permissoes: somente admin escreve.
create policy obras_insert_admin
on public.obras for insert to authenticated
with check (public.authz_is_admin());

create policy obras_update_admin
on public.obras for update to authenticated
using (public.authz_is_admin())
with check (public.authz_is_admin());

create policy obras_delete_admin
on public.obras for delete to authenticated
using (public.authz_is_admin());

create policy editores_permitidos_insert_admin
on public.editores_permitidos for insert to authenticated
with check (public.authz_is_admin());

create policy editores_permitidos_update_admin
on public.editores_permitidos for update to authenticated
using (public.authz_is_admin())
with check (public.authz_is_admin());

create policy editores_permitidos_delete_admin
on public.editores_permitidos for delete to authenticated
using (public.authz_is_admin());

-- Dados por obra: admin ou editor atribuido.
create policy flow_classifications_insert_scope
on public.flow_classifications for insert to authenticated
with check (public.authz_can_edit_obra(codigo_obra));

create policy flow_classifications_update_scope
on public.flow_classifications for update to authenticated
using (public.authz_can_edit_obra(codigo_obra))
with check (public.authz_can_edit_obra(codigo_obra));

create policy flow_classifications_delete_scope
on public.flow_classifications for delete to authenticated
using (public.authz_can_edit_obra(codigo_obra));

create policy flow_manuals_insert_scope
on public.flow_manuals for insert to authenticated
with check (public.authz_can_edit_obra(codigo_obra));

create policy flow_manuals_update_scope
on public.flow_manuals for update to authenticated
using (public.authz_can_edit_obra(codigo_obra))
with check (public.authz_can_edit_obra(codigo_obra));

create policy flow_manuals_delete_scope
on public.flow_manuals for delete to authenticated
using (public.authz_can_edit_obra(codigo_obra));

create policy projecao_config_insert_scope
on public.projecao_config for insert to authenticated
with check (public.authz_can_edit_obra(codigo_obra));

create policy projecao_config_update_scope
on public.projecao_config for update to authenticated
using (public.authz_can_edit_obra(codigo_obra))
with check (public.authz_can_edit_obra(codigo_obra));

create policy projecao_config_delete_scope
on public.projecao_config for delete to authenticated
using (public.authz_can_edit_obra(codigo_obra));

create policy projecao_movimentacoes_insert_scope
on public.projecao_movimentacoes for insert to authenticated
with check (public.authz_can_edit_obra(codigo_obra));

create policy projecao_movimentacoes_update_scope
on public.projecao_movimentacoes for update to authenticated
using (public.authz_can_edit_obra(codigo_obra))
with check (public.authz_can_edit_obra(codigo_obra));

create policy projecao_movimentacoes_delete_scope
on public.projecao_movimentacoes for delete to authenticated
using (public.authz_can_edit_obra(codigo_obra));

-- Chaves globais de dashboard_config exigem admin. Chaves no formato
-- codigo_obra:chave aceitam o editor atribuido aquela obra.
create policy dashboard_config_insert_scope
on public.dashboard_config for insert to authenticated
with check (public.authz_can_edit_dashboard_key(chave));

create policy dashboard_config_update_scope
on public.dashboard_config for update to authenticated
using (public.authz_can_edit_dashboard_key(chave))
with check (public.authz_can_edit_dashboard_key(chave));

create policy dashboard_config_delete_scope
on public.dashboard_config for delete to authenticated
using (public.authz_can_edit_dashboard_key(chave));

-- Tendencia e por obra. Flows/Gestoes sao multiobra e exigem admin.
create policy upload_history_insert_scope
on public.upload_history for insert to authenticated
with check (public.authz_can_manage_upload(codigo_obra, tipo));

create policy upload_history_update_scope
on public.upload_history for update to authenticated
using (public.authz_can_manage_upload(codigo_obra, tipo))
with check (public.authz_can_manage_upload(codigo_obra, tipo));

create policy upload_history_delete_scope
on public.upload_history for delete to authenticated
using (public.authz_can_manage_upload(codigo_obra, tipo));

-- A view deve respeitar as policies do chamador, nao as do owner.
alter view if exists public.upload_history_latest
  set (security_invoker = true);
revoke all on table public.upload_history_latest from anon;
grant select on table public.upload_history_latest to authenticated;

-- Storage: remover apenas policies que citam explicitamente o bucket alvo.
-- Policies genericas de storage ainda precisam ser revisadas no dump real.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') ilike '%uploads-history%'
        or coalesce(with_check, '') ilike '%uploads-history%'
      )
  loop
    execute format(
      'drop policy if exists %I on storage.objects',
      policy_row.policyname
    );
  end loop;
end;
$$;

create policy uploads_history_read_active
on storage.objects for select to authenticated
using (
  bucket_id = 'uploads-history'
  and public.authz_has_active_access()
);

create policy uploads_history_insert_scope
on storage.objects for insert to authenticated
with check (
  bucket_id = 'uploads-history'
  and public.authz_can_manage_upload(
    split_part(name, '/', 1),
    split_part(name, '/', 2)
  )
);

create policy uploads_history_update_scope
on storage.objects for update to authenticated
using (
  bucket_id = 'uploads-history'
  and public.authz_can_manage_upload(
    split_part(name, '/', 1),
    split_part(name, '/', 2)
  )
)
with check (
  bucket_id = 'uploads-history'
  and public.authz_can_manage_upload(
    split_part(name, '/', 1),
    split_part(name, '/', 2)
  )
);

create policy uploads_history_delete_scope
on storage.objects for delete to authenticated
using (
  bucket_id = 'uploads-history'
  and public.authz_can_manage_upload(
    split_part(name, '/', 1),
    split_part(name, '/', 2)
  )
);

commit;

-- Antes de promover este rascunho:
-- 1. confirmar o trigger que cria usuarios pending;
-- 2. decidir se leitura anonima deve continuar;
-- 3. revisar policies genericas de storage.objects;
-- 4. testar o rollback no ambiente de desenvolvimento;
-- 5. executar testes por papel e por obra via API REST.
