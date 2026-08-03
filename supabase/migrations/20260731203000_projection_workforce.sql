-- v1.7.0: planejamento mensal de mao de obra por obra.

begin;

do $$
begin
  if to_regprocedure('public.authz_can_edit_obra(text)') is null then
    raise exception 'Preflight falhou: aplique primeiro a migration de RLS';
  end if;
  if to_regclass('public.obras') is null then
    raise exception 'Preflight falhou: tabela obras ausente';
  end if;
end
$$;

create table if not exists public.projection_workforce_settings (
  codigo_obra text not null references public.obras(codigo_obra) on update cascade on delete cascade,
  insumo text not null check (insumo in ('ADM5189', 'CONDH271')),
  ativo boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (codigo_obra, insumo)
);

create table if not exists public.projection_workforce_rows (
  id uuid primary key default gen_random_uuid(),
  codigo_obra text not null references public.obras(codigo_obra) on update cascade on delete cascade,
  insumo text not null check (insumo in ('ADM5189', 'CONDH271')),
  cargo text not null check (char_length(trim(cargo)) between 1 and 120),
  custo_mensal numeric(16, 2) not null default 0 check (custo_mensal >= 0),
  distribuicao jsonb not null default '{}'::jsonb check (jsonb_typeof(distribuicao) = 'object'),
  ordem integer not null default 0 check (ordem >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create index if not exists projection_workforce_rows_obra_ordem_idx
  on public.projection_workforce_rows (codigo_obra, ordem, id);

alter table public.projection_workforce_settings enable row level security;
alter table public.projection_workforce_rows enable row level security;

revoke all on table public.projection_workforce_settings from public, anon, authenticated;
revoke all on table public.projection_workforce_rows from public, anon, authenticated;
grant select on table public.projection_workforce_settings to anon, authenticated;
grant select on table public.projection_workforce_rows to anon, authenticated;
grant insert, update, delete on table public.projection_workforce_settings to authenticated;
grant insert, update, delete on table public.projection_workforce_rows to authenticated;

drop policy if exists projection_workforce_settings_read on public.projection_workforce_settings;
create policy projection_workforce_settings_read
on public.projection_workforce_settings for select to anon, authenticated
using (true);

drop policy if exists projection_workforce_settings_insert on public.projection_workforce_settings;
create policy projection_workforce_settings_insert
on public.projection_workforce_settings for insert to authenticated
with check (public.authz_can_edit_obra(codigo_obra));

drop policy if exists projection_workforce_settings_update on public.projection_workforce_settings;
create policy projection_workforce_settings_update
on public.projection_workforce_settings for update to authenticated
using (public.authz_can_edit_obra(codigo_obra))
with check (public.authz_can_edit_obra(codigo_obra));

drop policy if exists projection_workforce_settings_delete on public.projection_workforce_settings;
create policy projection_workforce_settings_delete
on public.projection_workforce_settings for delete to authenticated
using (public.authz_can_edit_obra(codigo_obra));

drop policy if exists projection_workforce_rows_read on public.projection_workforce_rows;
create policy projection_workforce_rows_read
on public.projection_workforce_rows for select to anon, authenticated
using (true);

drop policy if exists projection_workforce_rows_insert on public.projection_workforce_rows;
create policy projection_workforce_rows_insert
on public.projection_workforce_rows for insert to authenticated
with check (public.authz_can_edit_obra(codigo_obra));

drop policy if exists projection_workforce_rows_update on public.projection_workforce_rows;
create policy projection_workforce_rows_update
on public.projection_workforce_rows for update to authenticated
using (public.authz_can_edit_obra(codigo_obra))
with check (public.authz_can_edit_obra(codigo_obra));

drop policy if exists projection_workforce_rows_delete on public.projection_workforce_rows;
create policy projection_workforce_rows_delete
on public.projection_workforce_rows for delete to authenticated
using (public.authz_can_edit_obra(codigo_obra));

select pg_notify('pgrst', 'reload schema');

commit;
