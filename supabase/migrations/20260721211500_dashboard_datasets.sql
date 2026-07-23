-- ============================================================================
-- SNAPSHOTS VERSIONADOS DO DASHBOARD
-- ============================================================================
-- Depende de 20260720172000_rls_hardening.sql.
-- Prepara a retirada gradual dos blobs grandes de dashboard_config. Esta
-- migration nao move nem exclui dados existentes.
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public.authz_can_edit_obra(text)') is null
    or to_regprocedure('public.authz_is_admin()') is null then
    raise exception 'Preflight falhou: aplique primeiro a migration de RLS';
  end if;

  if not exists (
    select 1 from storage.buckets where id = 'uploads-history' and public = false
  ) then
    raise exception 'Preflight falhou: Storage privado nao esta configurado';
  end if;
end;
$$;

insert into storage.buckets (id, name, public)
values ('dashboard-datasets', 'dashboard-datasets', false)
on conflict (id) do update set public = false;

create table public.dashboard_datasets (
  id uuid primary key,
  codigo_obra text references public.obras(codigo_obra) on delete cascade,
  tipo text not null,
  versao bigint not null check (versao > 0),
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  linhas integer not null default 0 check (linhas >= 0),
  bytes bigint not null check (bytes > 0),
  status text not null default 'processing'
    check (status in ('processing', 'active', 'superseded', 'failed')),
  upload_history_id bigint references public.upload_history(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by text not null default public.authz_current_email(),
  activated_at timestamptz,
  constraint dashboard_datasets_scope_check check (
    (tipo = 'tendencia' and codigo_obra is not null)
    or (tipo in ('flows', 'historico', 'projecao_raw') and codigo_obra is null)
  ),
  constraint dashboard_datasets_path_check check (
    storage_path !~ '(^|/)\.\.(/|$)'
    and storage_path !~ '[\\[:cntrl:]]'
    and (
      (codigo_obra is not null and storage_path like codigo_obra || '/' || tipo || '/%')
      or (codigo_obra is null and storage_path like '_global/' || tipo || '/%')
    )
  )
);

create unique index dashboard_datasets_version_project_unique
on public.dashboard_datasets (codigo_obra, tipo, versao)
where codigo_obra is not null;

create unique index dashboard_datasets_version_global_unique
on public.dashboard_datasets (tipo, versao)
where codigo_obra is null;

create unique index dashboard_datasets_active_project_unique
on public.dashboard_datasets (codigo_obra, tipo)
where codigo_obra is not null and status = 'active';

create unique index dashboard_datasets_active_global_unique
on public.dashboard_datasets (tipo)
where codigo_obra is null and status = 'active';

create index dashboard_datasets_lookup_idx
on public.dashboard_datasets (codigo_obra, tipo, status, created_at desc);

alter table public.dashboard_datasets enable row level security;

revoke all on table public.dashboard_datasets from public, anon, authenticated;
grant select on table public.dashboard_datasets to anon, authenticated;
grant insert, delete on table public.dashboard_datasets to authenticated;

create or replace function public.authz_can_manage_dashboard_dataset(
  target_codigo_obra text,
  target_tipo text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when target_tipo = 'tendencia' and target_codigo_obra is not null
      then public.authz_can_edit_obra(target_codigo_obra)
    when target_tipo in ('flows', 'historico', 'projecao_raw') and target_codigo_obra is null
      then public.authz_is_admin()
    else false
  end;
$$;

create or replace function public.authz_can_manage_dashboard_dataset_path(target_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_path is not null
    and target_path !~ '(^|/)\.\.(/|$)'
    and target_path !~ '[\\[:cntrl:]]'
    and split_part(target_path, '/', 3) <> ''
    and public.authz_can_manage_dashboard_dataset(
      case when split_part(target_path, '/', 1) = '_global'
        then null
        else split_part(target_path, '/', 1)
      end,
      split_part(target_path, '/', 2)
    );
$$;

revoke all on function public.authz_can_manage_dashboard_dataset(text, text)
  from public, anon;
revoke all on function public.authz_can_manage_dashboard_dataset_path(text)
  from public, anon;
grant execute on function public.authz_can_manage_dashboard_dataset(text, text)
  to authenticated;
grant execute on function public.authz_can_manage_dashboard_dataset_path(text)
  to authenticated;

create policy dashboard_datasets_read_active
on public.dashboard_datasets for select to anon, authenticated
using (status = 'active');

create policy dashboard_datasets_insert_processing
on public.dashboard_datasets for insert to authenticated
with check (
  status = 'processing'
  and activated_at is null
  and created_by = public.authz_current_email()
  and public.authz_can_manage_dashboard_dataset(codigo_obra, tipo)
);

create policy dashboard_datasets_delete_inactive
on public.dashboard_datasets for delete to authenticated
using (
  status <> 'active'
  and public.authz_can_manage_dashboard_dataset(codigo_obra, tipo)
);

create or replace function public.activate_dashboard_dataset(p_dataset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dataset public.dashboard_datasets%rowtype;
  previous_id uuid;
begin
  select * into dataset
  from public.dashboard_datasets
  where id = p_dataset_id
  for update;

  if not found then
    raise exception 'Dataset nao encontrado' using errcode = 'P0002';
  end if;

  if not public.authz_can_manage_dashboard_dataset(dataset.codigo_obra, dataset.tipo) then
    raise exception 'Sem permissao para ativar este dataset' using errcode = '42501';
  end if;

  if dataset.status <> 'processing' then
    raise exception 'Apenas datasets em processamento podem ser ativados'
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from storage.objects
    where bucket_id = 'dashboard-datasets' and name = dataset.storage_path
  ) then
    raise exception 'Objeto do dataset ainda nao foi persistido'
      using errcode = '23503';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(coalesce(dataset.codigo_obra, '_global') || ':' || dataset.tipo)
  );

  select id into previous_id
  from public.dashboard_datasets
  where status = 'active'
    and tipo = dataset.tipo
    and codigo_obra is not distinct from dataset.codigo_obra
  for update;

  update public.dashboard_datasets
  set status = 'superseded'
  where status = 'active'
    and tipo = dataset.tipo
    and codigo_obra is not distinct from dataset.codigo_obra;

  update public.dashboard_datasets
  set status = 'active', activated_at = now()
  where id = dataset.id;

  return jsonb_build_object(
    'id', dataset.id,
    'codigo_obra', dataset.codigo_obra,
    'tipo', dataset.tipo,
    'versao', dataset.versao,
    'storage_path', dataset.storage_path,
    'status', 'active',
    'previous_id', previous_id
  );
end;
$$;

create or replace function public.fail_dashboard_dataset(p_dataset_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  dataset public.dashboard_datasets%rowtype;
begin
  select * into dataset
  from public.dashboard_datasets
  where id = p_dataset_id
  for update;

  if not found then return false; end if;
  if not public.authz_can_manage_dashboard_dataset(dataset.codigo_obra, dataset.tipo) then
    raise exception 'Sem permissao para alterar este dataset' using errcode = '42501';
  end if;
  if dataset.status <> 'processing' then return false; end if;

  update public.dashboard_datasets set status = 'failed' where id = dataset.id;
  return true;
end;
$$;

create or replace function public.rollback_dashboard_dataset(
  p_current_id uuid,
  p_previous_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_dataset public.dashboard_datasets%rowtype;
  previous_dataset public.dashboard_datasets%rowtype;
begin
  select * into current_dataset
  from public.dashboard_datasets
  where id = p_current_id
  for update;

  if not found then return false; end if;
  if not public.authz_can_manage_dashboard_dataset(
    current_dataset.codigo_obra,
    current_dataset.tipo
  ) then
    raise exception 'Sem permissao para reverter este dataset' using errcode = '42501';
  end if;
  if current_dataset.status <> 'active' then return false; end if;

  perform pg_advisory_xact_lock(
    hashtext(coalesce(current_dataset.codigo_obra, '_global') || ':' || current_dataset.tipo)
  );

  if p_previous_id is not null then
    select * into previous_dataset
    from public.dashboard_datasets
    where id = p_previous_id
    for update;

    if not found
      or previous_dataset.status <> 'superseded'
      or previous_dataset.tipo <> current_dataset.tipo
      or previous_dataset.codigo_obra is distinct from current_dataset.codigo_obra then
      raise exception 'Dataset anterior invalido para rollback' using errcode = '23514';
    end if;

    if not exists (
      select 1 from storage.objects
      where bucket_id = 'dashboard-datasets'
        and name = previous_dataset.storage_path
    ) then
      raise exception 'Objeto da versao anterior nao foi encontrado' using errcode = '23503';
    end if;
  end if;

  update public.dashboard_datasets
  set status = 'failed', activated_at = null
  where id = current_dataset.id;

  if p_previous_id is not null then
    update public.dashboard_datasets
    set status = 'active', activated_at = now()
    where id = previous_dataset.id;
  end if;

  return true;
end;
$$;

revoke all on function public.activate_dashboard_dataset(uuid) from public, anon;
revoke all on function public.fail_dashboard_dataset(uuid) from public, anon;
revoke all on function public.rollback_dashboard_dataset(uuid, uuid) from public, anon;
grant execute on function public.activate_dashboard_dataset(uuid) to authenticated;
grant execute on function public.fail_dashboard_dataset(uuid) to authenticated;
grant execute on function public.rollback_dashboard_dataset(uuid, uuid) to authenticated;

-- Remove somente policies anteriores que citam este bucket, permitindo reaplicar
-- a migration em um ambiente descartavel sem tocar no bucket de uploads.
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
        coalesce(qual, '') ilike '%dashboard-datasets%'
        or coalesce(with_check, '') ilike '%dashboard-datasets%'
      )
  loop
    execute format('drop policy if exists %I on storage.objects', policy_row.policyname);
  end loop;
end;
$$;

grant select on table storage.objects to anon, authenticated;
grant insert, delete on table storage.objects to authenticated;

create policy dashboard_datasets_storage_read_active
on storage.objects for select to anon, authenticated
using (
  bucket_id = 'dashboard-datasets'
  and exists (
    select 1 from public.dashboard_datasets dataset
    where dataset.storage_path = name and dataset.status = 'active'
  )
);

create policy dashboard_datasets_storage_insert_scope
on storage.objects for insert to authenticated
with check (
  bucket_id = 'dashboard-datasets'
  and public.authz_can_manage_dashboard_dataset_path(name)
);

create policy dashboard_datasets_storage_delete_inactive
on storage.objects for delete to authenticated
using (
  bucket_id = 'dashboard-datasets'
  and public.authz_can_manage_dashboard_dataset_path(name)
  and not exists (
    select 1 from public.dashboard_datasets dataset
    where dataset.storage_path = name and dataset.status = 'active'
  )
);

commit;
