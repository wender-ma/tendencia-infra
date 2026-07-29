-- ============================================================================
-- HARDENING DE LANCAMENTO
-- ============================================================================
-- Preserva a leitura publica do painel, mas limita o catalogo a obras ativas e
-- remove metadados de auditoria das colunas acessiveis ao papel anon.
-- Tambem torna o cadastro de obras encontradas no upload uma operacao
-- administrativa validada e reversivel.
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public.authz_is_admin()') is null
    or to_regclass('public.dashboard_datasets') is null
    or to_regprocedure('public.reset_global_dashboard_datasets()') is null then
    raise exception
      'Preflight falhou: aplique primeiro as migrations de RLS, snapshots e historico global';
  end if;
end;
$$;

-- O papel autenticado mantem o contrato integral sujeito a RLS. O anonimo
-- recebe somente as colunas consumidas pelas telas publicas.
revoke select on table public.obras from anon;
revoke select on table public.flow_classifications from anon;
revoke select on table public.flow_manuals from anon;
revoke select on table public.projecao_config from anon;
revoke select on table public.projecao_movimentacoes from anon;
revoke select on table public.dashboard_config from anon;
revoke select on table public.dashboard_datasets from anon;

grant select (codigo_obra, nome, ativa)
  on table public.obras to anon;
grant select (
  codigo_obra,
  n_alteracao,
  insumo_planejamento,
  insumo_remanejamento,
  custo_flowmaster,
  refletido_status
) on table public.flow_classifications to anon;
grant select (
  codigo_obra,
  n_alteracao,
  n_adt,
  dep,
  descricao,
  data_br,
  data,
  aprovador_dep,
  aprovador,
  solicitante_dep,
  solicitante,
  custo_flowmaster,
  custo_planejamento,
  motivo,
  justificativa,
  insumo_planejamento,
  insumo_remanejamento,
  obs
) on table public.flow_manuals to anon;
grant select (
  codigo_obra,
  insumo_controlado,
  saldo_inicial,
  data_ref,
  locked_saldo,
  locked_data,
  locked_insumo
) on table public.projecao_config to anon;
grant select (
  id,
  codigo_obra,
  tipo,
  data,
  data_br,
  origem,
  destino,
  descricao,
  justificativa,
  responsavel,
  valor,
  created_at
) on table public.projecao_movimentacoes to anon;
grant select (chave, valor)
  on table public.dashboard_config to anon;
grant select (
  id,
  codigo_obra,
  tipo,
  versao,
  storage_path,
  sha256,
  linhas,
  bytes,
  status,
  created_at,
  activated_at
) on table public.dashboard_datasets to anon;

-- Obras inativas deixam de fazer parte do catalogo publico. Usuarios
-- autenticados continuam enxergando o catalogo completo para administracao.
drop policy if exists obras_read_public on public.obras;
drop policy if exists obras_read_anon_active on public.obras;
drop policy if exists obras_read_authenticated on public.obras;

create policy obras_read_anon_active
on public.obras for select to anon
using (coalesce(ativa, true));

create policy obras_read_authenticated
on public.obras for select to authenticated
using (true);

-- Somente preferencias pequenas e nao sensiveis sao publicas. Blobs legados
-- permanecem acessiveis apenas a usuarios autenticados durante a janela de
-- rollback dos snapshots.
drop policy if exists dashboard_config_read_public on public.dashboard_config;
drop policy if exists dashboard_config_read_anon_safe on public.dashboard_config;
drop policy if exists dashboard_config_read_authenticated on public.dashboard_config;

create policy dashboard_config_read_anon_safe
on public.dashboard_config for select to anon
using (
  chave in ('header_title', 'indice_correcao', 'card3_modo')
  or chave ~ '^[^:]+:(evol_global|gestao_label)$'
);

create policy dashboard_config_read_authenticated
on public.dashboard_config for select to authenticated
using (true);

create or replace function public.admin_register_upload_projects(p_projects jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_codigo text;
  v_nome text;
  v_requested text[] := array[]::text[];
  v_created text[] := array[]::text[];
begin
  if not public.authz_is_admin() then
    raise exception 'Apenas administradores podem cadastrar obras por upload'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_projects) <> 'array'
    or jsonb_array_length(p_projects) = 0
    or jsonb_array_length(p_projects) > 100 then
    raise exception 'Informe de 1 a 100 obras em um array JSON'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('admin-register-upload-projects'));

  for v_item in select value from jsonb_array_elements(p_projects)
  loop
    v_codigo := btrim(coalesce(v_item ->> 'codigo_obra', ''));
    v_nome := btrim(coalesce(v_item ->> 'nome', v_codigo));

    if v_codigo !~ '^[[:alnum:]][[:alnum:]_.-]{0,63}$' then
      raise exception 'Codigo de obra invalido: %', v_codigo
        using errcode = '22023';
    end if;
    if v_nome = '' or length(v_nome) > 160 then
      raise exception 'Nome invalido para a obra %', v_codigo
        using errcode = '22023';
    end if;
    if v_codigo = any(v_requested) then
      raise exception 'Codigo de obra duplicado no upload: %', v_codigo
        using errcode = '22023';
    end if;

    v_requested := array_append(v_requested, v_codigo);
    insert into public.obras (
      codigo_obra,
      nome,
      ativa,
      origem,
      observacao
    ) values (
      v_codigo,
      v_nome,
      true,
      'upload',
      'Cadastrada pelo upload global de Gestoes + Flows'
    )
    on conflict (codigo_obra) do nothing;

    if found then
      v_created := array_append(v_created, v_codigo);
    end if;
  end loop;

  return jsonb_build_object(
    'requested_codes', to_jsonb(v_requested),
    'created_codes', to_jsonb(v_created)
  );
end;
$$;

create or replace function public.admin_rollback_upload_projects(p_codes text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codigo text;
  v_deleted text[] := array[]::text[];
  v_skipped text[] := array[]::text[];
begin
  if not public.authz_is_admin() then
    raise exception 'Apenas administradores podem desfazer obras de upload'
      using errcode = '42501';
  end if;

  if coalesce(array_length(p_codes, 1), 0) = 0
    or array_length(p_codes, 1) > 100 then
    raise exception 'Informe de 1 a 100 codigos de obra'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('admin-register-upload-projects'));

  foreach v_codigo in array p_codes
  loop
    v_codigo := btrim(coalesce(v_codigo, ''));
    if v_codigo = '' then
      continue;
    end if;

    delete from public.obras o
    where o.codigo_obra = v_codigo
      and o.origem = 'upload'
      and not exists (
        select 1 from public.editores_permitidos ep
        where ep.codigo_obra = o.codigo_obra
      )
      and not exists (
        select 1 from public.flow_classifications fc
        where fc.codigo_obra = o.codigo_obra
      )
      and not exists (
        select 1 from public.flow_manuals fm
        where fm.codigo_obra = o.codigo_obra
      )
      and not exists (
        select 1 from public.projecao_config pc
        where pc.codigo_obra = o.codigo_obra
      )
      and not exists (
        select 1 from public.projecao_movimentacoes pm
        where pm.codigo_obra = o.codigo_obra
      )
      and not exists (
        select 1 from public.upload_history uh
        where uh.codigo_obra = o.codigo_obra
      )
      and not exists (
        select 1 from public.dashboard_datasets dd
        where dd.codigo_obra = o.codigo_obra
      )
      and not exists (
        select 1 from public.dashboard_config dc
        where dc.chave like o.codigo_obra || ':%'
      );

    if found then
      v_deleted := array_append(v_deleted, v_codigo);
    else
      v_skipped := array_append(v_skipped, v_codigo);
    end if;
  end loop;

  return jsonb_build_object(
    'deleted_codes', to_jsonb(v_deleted),
    'skipped_codes', to_jsonb(v_skipped)
  );
end;
$$;

revoke all on function public.admin_register_upload_projects(jsonb)
  from public, anon;
revoke all on function public.admin_rollback_upload_projects(text[])
  from public, anon;
grant execute on function public.admin_register_upload_projects(jsonb)
  to authenticated;
grant execute on function public.admin_rollback_upload_projects(text[])
  to authenticated;

commit;
