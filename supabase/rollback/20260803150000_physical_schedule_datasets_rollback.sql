begin;

delete from public.dashboard_datasets where tipo = 'cronograma_fisico';
delete from public.upload_history where tipo = 'cronograma_fisico';

alter table public.upload_history
  drop constraint if exists upload_history_scope_check;
alter table public.upload_history
  add constraint upload_history_scope_check
  check (
    (tipo = 'tendencia' and codigo_obra is not null)
    or (tipo in ('flows', 'gestoes') and codigo_obra is null)
    or tipo not in ('tendencia', 'flows', 'gestoes')
  );

alter table public.dashboard_datasets
  drop constraint if exists dashboard_datasets_scope_check;
alter table public.dashboard_datasets
  add constraint dashboard_datasets_scope_check
  check (
    (tipo = 'tendencia' and codigo_obra is not null)
    or (tipo in ('flows', 'historico', 'projecao_raw') and codigo_obra is null)
  );

create or replace function public.authz_can_manage_upload(target_codigo_obra text, target_tipo text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.authz_is_admin()
    or (target_tipo = 'tendencia' and target_codigo_obra is not null
      and public.authz_can_edit_obra(target_codigo_obra));
$$;

create or replace function public.authz_can_manage_dashboard_dataset(
  target_codigo_obra text,
  target_tipo text
)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when target_tipo = 'tendencia' and target_codigo_obra is not null
      then public.authz_can_edit_obra(target_codigo_obra)
    when target_tipo in ('flows', 'historico', 'projecao_raw') and target_codigo_obra is null
      then public.authz_is_admin()
    else false
  end;
$$;

revoke all on function public.authz_can_manage_upload(text, text) from public, anon;
revoke all on function public.authz_can_manage_dashboard_dataset(text, text) from public, anon;
grant execute on function public.authz_can_manage_upload(text, text) to authenticated;
grant execute on function public.authz_can_manage_dashboard_dataset(text, text) to authenticated;

drop policy if exists dashboard_config_read_anon_safe on public.dashboard_config;
create policy dashboard_config_read_anon_safe
on public.dashboard_config for select to anon
using (
  chave in ('header_title', 'indice_correcao', 'card3_modo')
  or chave ~ '^[^:]+:(evol_global|gestao_label)$'
);

create or replace function public.reset_dashboard_datasets(
  p_codigo_obra text,
  p_include_global boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_codigo_obra text := btrim(coalesce(p_codigo_obra, ''));
  include_global boolean := coalesce(p_include_global, false);
  removed_datasets jsonb := '[]'::jsonb;
  config_deleted integer := 0;
begin
  if normalized_codigo_obra = '' then
    raise exception 'Codigo da obra obrigatorio' using errcode = '22023';
  end if;
  if not public.authz_can_edit_obra(normalized_codigo_obra) then
    raise exception 'Sem permissao para resetar esta obra' using errcode = '42501';
  end if;
  if include_global and not public.authz_is_admin() then
    raise exception 'Apenas administradores podem resetar datasets globais'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(normalized_codigo_obra || ':tendencia'));
  if include_global then
    perform pg_advisory_xact_lock(hashtext('_global:flows'));
    perform pg_advisory_xact_lock(hashtext('_global:historico'));
    perform pg_advisory_xact_lock(hashtext('_global:projecao_raw'));
  end if;

  with removed as (
    delete from public.dashboard_datasets
    where (
      codigo_obra = normalized_codigo_obra
      and tipo = 'tendencia'
    ) or (
      include_global
      and codigo_obra is null
      and tipo in ('flows', 'historico', 'projecao_raw')
    )
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
  where chave in (
    normalized_codigo_obra || ':dados_tendencia',
    normalized_codigo_obra || ':dados_flows',
    normalized_codigo_obra || ':gestao_label',
    normalized_codigo_obra || ':evol_global'
  )
  or (
    include_global
    and chave in ('dados_flows', 'dados_historico', 'dados_projraw')
  );
  get diagnostics config_deleted = row_count;

  return jsonb_build_object(
    'codigo_obra', normalized_codigo_obra,
    'include_global', include_global,
    'config_deleted', config_deleted,
    'datasets', removed_datasets
  );
end;
$$;

revoke all on function public.reset_dashboard_datasets(text, boolean)
  from public, anon;
grant execute on function public.reset_dashboard_datasets(text, boolean)
  to authenticated;

commit;
