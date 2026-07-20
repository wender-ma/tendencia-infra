-- ROLLBACK EMERGENCIAL da migration 20260720172000_rls_hardening.sql.
-- ATENCAO: restaura a exposicao e os grants amplos do baseline de 20/07/2026.

begin;

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

create policy "escrita whitelist"
on public.dashboard_config for all to public
using (public.is_editor())
with check (public.is_editor());

create policy "leitura pública"
on public.dashboard_config for select to public
using (true);

create policy "editores delete admin"
on public.editores_permitidos for delete to public
using (public.is_admin());

create policy "editores insert admin"
on public.editores_permitidos for insert to public
with check (public.is_admin());

create policy "editores update admin"
on public.editores_permitidos for update to public
using (public.is_admin());

create policy "whitelist leitura pública"
on public.editores_permitidos for select to public
using (true);

create policy "escrita whitelist"
on public.flow_classifications for all to public
using (public.is_editor(codigo_obra))
with check (public.is_editor(codigo_obra));

create policy "leitura pública"
on public.flow_classifications for select to public
using (true);

create policy "escrita whitelist"
on public.flow_manuals for all to public
using (public.is_editor(codigo_obra))
with check (public.is_editor(codigo_obra));

create policy "leitura pública"
on public.flow_manuals for select to public
using (true);

create policy "obras delete admin"
on public.obras for delete to public
using (public.is_admin() and origem = 'manual');

create policy "obras insert admin"
on public.obras for insert to public
with check (public.is_admin());

create policy "obras leitura pública"
on public.obras for select to public
using (true);

create policy "obras update admin"
on public.obras for update to public
using (public.is_admin());

create policy "escrita whitelist"
on public.projecao_config for all to public
using (public.is_editor(codigo_obra))
with check (public.is_editor(codigo_obra));

create policy "leitura pública"
on public.projecao_config for select to public
using (true);

create policy "escrita whitelist"
on public.projecao_movimentacoes for all to public
using (public.is_editor(codigo_obra))
with check (public.is_editor(codigo_obra));

create policy "leitura pública"
on public.projecao_movimentacoes for select to public
using (true);

create policy "escrita whitelist"
on public.upload_history for all to public
using (public.is_editor(codigo_obra))
with check (public.is_editor(codigo_obra));

create policy "leitura pública"
on public.upload_history for select to public
using (true);

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

create policy "uploads-history delete editor"
on storage.objects for delete to public
using (bucket_id = 'uploads-history' and public.is_editor());

create policy "uploads-history insert editor"
on storage.objects for insert to public
with check (bucket_id = 'uploads-history' and public.is_editor());

create policy "uploads-history read logado"
on storage.objects for select to public
using (
  bucket_id = 'uploads-history'
  and auth.role() = 'authenticated'
);

create policy "uploads-history update editor"
on storage.objects for update to public
using (bucket_id = 'uploads-history' and public.is_editor());

grant all privileges on table public.obras to anon, authenticated;
grant all privileges on table public.editores_permitidos to anon, authenticated;
grant all privileges on table public.flow_classifications to anon, authenticated;
grant all privileges on table public.flow_manuals to anon, authenticated;
grant all privileges on table public.projecao_config to anon, authenticated;
grant all privileges on table public.projecao_movimentacoes to anon, authenticated;
grant all privileges on table public.dashboard_config to anon, authenticated;
grant all privileges on table public.upload_history to anon, authenticated;
grant all privileges on table public.upload_history_latest to anon, authenticated;
grant usage, select on sequence public.upload_history_id_seq to anon, authenticated;

grant all privileges on table storage.buckets to anon, authenticated;
grant all privileges on table storage.objects to anon, authenticated;

alter view if exists public.upload_history_latest
  reset (security_invoker);

grant execute on function public.handle_new_user() to public;
grant execute on function public.is_admin() to public;
grant execute on function public.is_editor() to public;
grant execute on function public.is_editor(text) to public;

drop function if exists public.authz_can_manage_upload(text, text);
drop function if exists public.authz_can_edit_dashboard_key(text);
drop function if exists public.authz_can_edit_obra(text);
drop function if exists public.authz_is_admin();
drop function if exists public.authz_current_email();

commit;
