create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create schema storage;

create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb;
$$;

create function auth.role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', 'anon');
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
grant execute on function auth.role() to anon, authenticated;

create table public.obras (
  codigo_obra text primary key,
  nome text not null,
  origem text not null default 'manual'
);

create table public.editores_permitidos (
  email text not null,
  codigo_obra text,
  role text not null default 'editor',
  status text not null default 'active'
);

insert into public.editores_permitidos (email, codigo_obra, role, status)
values
  ('admin@example.test', null, 'admin', 'active'),
  ('editor@example.test', 'OBRA-A', 'editor', 'active'),
  ('inactive@example.test', 'OBRA-A', 'editor', 'inactive');

create table public.flow_classifications (
  codigo_obra text not null,
  n_alteracao text not null,
  primary key (codigo_obra, n_alteracao)
);

create table public.flow_manuals (
  codigo_obra text not null,
  n_alteracao text not null,
  primary key (codigo_obra, n_alteracao)
);

create table public.projecao_config (
  codigo_obra text primary key
);

create table public.projecao_movimentacoes (
  id text primary key,
  codigo_obra text
);

create table public.dashboard_config (
  chave text primary key,
  valor text
);

create table public.upload_history (
  id bigserial primary key,
  codigo_obra text,
  tipo text not null,
  nome_arquivo text not null,
  tamanho_bytes bigint,
  linhas integer,
  enviado_por text,
  enviado_em timestamptz default now(),
  storage_path text,
  upload_group_id uuid,
  is_active boolean default false
);

insert into public.obras (codigo_obra, nome, origem)
values
  ('OBRA-A', 'Obra A', 'manual'),
  ('OBRA-B', 'Obra B', 'manual');

insert into public.upload_history (
  codigo_obra,
  tipo,
  nome_arquivo,
  enviado_por,
  is_active
)
values
  ('OBRA-A', 'tendencia', 'a.csv', 'editor@example.test', true),
  ('OBRA-B', 'tendencia', 'b.csv', 'admin@example.test', true);

create view public.upload_history_latest as
select
  id,
  codigo_obra,
  tipo,
  nome_arquivo,
  tamanho_bytes,
  linhas,
  enviado_por,
  enviado_em,
  storage_path,
  upload_group_id,
  is_active
from public.upload_history
where is_active = true;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false
);

create table storage.objects (
  id uuid primary key,
  bucket_id text,
  name text
);

grant usage on schema storage to anon, authenticated;

insert into storage.objects (id, bucket_id, name)
values
  ('00000000-0000-0000-0000-000000000001', 'uploads-history', 'OBRA-A/tendencia/a.csv'),
  ('00000000-0000-0000-0000-000000000002', 'uploads-history', 'OBRA-A/flows/global.csv'),
  ('00000000-0000-0000-0000-000000000003', 'uploads-history', 'OBRA-B/tendencia/b.csv');

insert into storage.buckets (id, name, public)
values ('uploads-history', 'uploads-history', false);

create table auth.users (
  id uuid primary key,
  email text
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create function public.is_admin()
returns boolean language sql stable as $$ select false; $$;
create function public.is_editor()
returns boolean language sql stable as $$ select false; $$;
create function public.is_editor(obra_alvo text)
returns boolean language sql stable as $$ select false; $$;

alter table public.obras enable row level security;
alter table public.editores_permitidos enable row level security;
alter table public.flow_classifications enable row level security;
alter table public.flow_manuals enable row level security;
alter table public.projecao_config enable row level security;
alter table public.projecao_movimentacoes enable row level security;
alter table public.dashboard_config enable row level security;
alter table public.upload_history enable row level security;
alter table storage.objects enable row level security;

create policy baseline_public on public.obras for select using (true);
create policy baseline_public on public.editores_permitidos for select using (true);
create policy baseline_public on public.flow_classifications for select using (true);
create policy baseline_public on public.flow_manuals for select using (true);
create policy baseline_public on public.projecao_config for select using (true);
create policy baseline_public on public.projecao_movimentacoes for select using (true);
create policy baseline_public on public.dashboard_config for select using (true);
create policy baseline_public on public.upload_history for select using (true);

create policy "uploads-history read logado"
on storage.objects for select
using (bucket_id = 'uploads-history' and auth.role() = 'authenticated');
create policy "uploads-history insert editor"
on storage.objects for insert
with check (bucket_id = 'uploads-history' and public.is_editor());
create policy "uploads-history update editor"
on storage.objects for update
using (bucket_id = 'uploads-history' and public.is_editor());
create policy "uploads-history delete editor"
on storage.objects for delete
using (bucket_id = 'uploads-history' and public.is_editor());

grant all privileges on table public.obras to anon, authenticated, service_role;
grant all privileges on table public.editores_permitidos to anon, authenticated, service_role;
grant all privileges on table public.flow_classifications to anon, authenticated, service_role;
grant all privileges on table public.flow_manuals to anon, authenticated, service_role;
grant all privileges on table public.projecao_config to anon, authenticated, service_role;
grant all privileges on table public.projecao_movimentacoes to anon, authenticated, service_role;
grant all privileges on table public.dashboard_config to anon, authenticated, service_role;
grant all privileges on table public.upload_history to anon, authenticated, service_role;
grant all privileges on table public.upload_history_latest to anon, authenticated, service_role;
grant all privileges on sequence public.upload_history_id_seq to anon, authenticated, service_role;
grant all privileges on table storage.buckets to anon, authenticated, service_role;
grant all privileges on table storage.objects to anon, authenticated, service_role;
