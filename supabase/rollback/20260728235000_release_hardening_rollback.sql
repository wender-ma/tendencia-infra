-- Restaura o contrato publico anterior. Obras cadastradas durante a vigencia da
-- migration sao preservadas deliberadamente.

begin;

drop function if exists public.admin_rollback_upload_projects(text[]);
drop function if exists public.admin_register_upload_projects(jsonb);

drop policy if exists obras_read_anon_active on public.obras;
drop policy if exists obras_read_authenticated on public.obras;
drop policy if exists obras_read_public on public.obras;
create policy obras_read_public
on public.obras for select to anon, authenticated
using (true);

drop policy if exists dashboard_config_read_anon_safe on public.dashboard_config;
drop policy if exists dashboard_config_read_authenticated on public.dashboard_config;
drop policy if exists dashboard_config_read_public on public.dashboard_config;
create policy dashboard_config_read_public
on public.dashboard_config for select to anon, authenticated
using (true);

grant select on table public.obras to anon;
grant select on table public.flow_classifications to anon;
grant select on table public.flow_manuals to anon;
grant select on table public.projecao_config to anon;
grant select on table public.projecao_movimentacoes to anon;
grant select on table public.dashboard_config to anon;
grant select on table public.dashboard_datasets to anon;

commit;
