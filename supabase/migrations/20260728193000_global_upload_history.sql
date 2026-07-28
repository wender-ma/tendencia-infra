-- ============================================================================
-- HISTORICO DE UPLOADS MULTIOBRA
-- ============================================================================
-- Tendencia permanece por obra. Flows e Gestoes passam a ter um unico
-- historico global, coerente com os datasets compartilhados.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.upload_history') is null
    or to_regclass('public.dashboard_datasets') is null
    or to_regprocedure('public.authz_is_admin()') is null
    or to_regprocedure('public.authz_can_edit_obra(text)') is null then
    raise exception 'Preflight falhou: aplique primeiro as migrations de RLS e datasets';
  end if;
end;
$$;

-- Mantem apenas o registro ativo mais recente de cada base global antes de
-- remover o codigo da obra dos metadados legados.
with ranked as (
  select
    id,
    row_number() over (
      partition by tipo
      order by is_active desc, enviado_em desc nulls last, id desc
    ) as position,
    bool_or(is_active) over (partition by tipo) as had_active
  from public.upload_history
  where tipo in ('flows', 'gestoes')
)
update public.upload_history as history
set is_active = ranked.had_active and ranked.position = 1
from ranked
where history.id = ranked.id;

update public.upload_history
set codigo_obra = null
where tipo in ('flows', 'gestoes')
  and codigo_obra is not null;

-- Remove eventuais duplicidades antigas de Tendencia ativa por obra.
with ranked as (
  select
    id,
    row_number() over (
      partition by codigo_obra, tipo
      order by enviado_em desc nulls last, id desc
    ) as position
  from public.upload_history
  where tipo = 'tendencia'
    and codigo_obra is not null
    and is_active
)
update public.upload_history as history
set is_active = false
from ranked
where history.id = ranked.id
  and ranked.position > 1;

alter table public.upload_history
  drop constraint if exists upload_history_scope_check;

alter table public.upload_history
  add constraint upload_history_scope_check
  check (
    (tipo = 'tendencia' and codigo_obra is not null)
    or (tipo in ('flows', 'gestoes') and codigo_obra is null)
    or tipo not in ('tendencia', 'flows', 'gestoes')
  );

create unique index if not exists upload_history_one_active_project_kind
  on public.upload_history (codigo_obra, tipo)
  where is_active and codigo_obra is not null;

create unique index if not exists upload_history_one_active_global_kind
  on public.upload_history (tipo)
  where is_active and codigo_obra is null;

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
      and target_codigo_obra is not null
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
using (public.authz_can_manage_upload(codigo_obra, tipo));

create or replace function public.reset_global_dashboard_datasets()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_datasets jsonb := '[]'::jsonb;
  config_deleted integer := 0;
begin
  if not public.authz_is_admin() then
    raise exception 'Apenas administradores podem resetar datasets globais'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('_global:flows'));
  perform pg_advisory_xact_lock(hashtext('_global:historico'));
  perform pg_advisory_xact_lock(hashtext('_global:projecao_raw'));

  with removed as (
    delete from public.dashboard_datasets
    where codigo_obra is null
      and tipo in ('flows', 'historico', 'projecao_raw')
    returning id, codigo_obra, tipo, storage_path
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'codigo_obra', codigo_obra,
        'tipo', tipo,
        'storage_path', storage_path
      )
      order by tipo, storage_path
    ),
    '[]'::jsonb
  )
  into removed_datasets
  from removed;

  delete from public.dashboard_config
  where chave in ('dados_flows', 'dados_historico', 'dados_projraw');
  get diagnostics config_deleted = row_count;

  return jsonb_build_object(
    'scope', 'global',
    'config_deleted', config_deleted,
    'datasets', removed_datasets
  );
end;
$$;

revoke all on function public.reset_global_dashboard_datasets()
  from public, anon;
grant execute on function public.reset_global_dashboard_datasets()
  to authenticated;

comment on function public.reset_global_dashboard_datasets()
  is 'Remove somente datasets e chaves legadas globais; objetos do Storage sao retornados para limpeza pela aplicacao.';

commit;
