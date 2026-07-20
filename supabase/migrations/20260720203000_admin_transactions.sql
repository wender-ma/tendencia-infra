-- ============================================================================
-- OPERACOES ADMINISTRATIVAS ATOMICAS
-- ============================================================================
-- Depende de 20260720172000_rls_hardening.sql.
-- Centraliza alteracoes compostas em funcoes transacionais e explicita quais
-- dados pertencentes a uma obra devem ser removidos em cascata.
-- ============================================================================

begin;

do $$
declare
  expected_constraint text;
begin
  if to_regprocedure('public.authz_is_admin()') is null then
    raise exception 'Preflight falhou: aplique primeiro a migration de RLS';
  end if;

  foreach expected_constraint in array array[
    'editores_permitidos_codigo_obra_fkey',
    'flow_classifications_codigo_obra_fkey',
    'flow_manuals_codigo_obra_fkey',
    'projecao_config_codigo_obra_fkey',
    'projecao_movimentacoes_codigo_obra_fkey',
    'upload_history_codigo_obra_fkey'
  ]
  loop
    if not exists (
      select 1
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'public'
        and c.conname = expected_constraint
        and c.contype = 'f'
    ) then
      raise exception 'Preflight falhou: constraint % ausente', expected_constraint;
    end if;
  end loop;
end;
$$;

alter table public.editores_permitidos
  drop constraint editores_permitidos_codigo_obra_fkey,
  add constraint editores_permitidos_codigo_obra_fkey
    foreign key (codigo_obra) references public.obras(codigo_obra) on delete cascade;

alter table public.flow_classifications
  drop constraint flow_classifications_codigo_obra_fkey,
  add constraint flow_classifications_codigo_obra_fkey
    foreign key (codigo_obra) references public.obras(codigo_obra) on delete cascade;

alter table public.flow_manuals
  drop constraint flow_manuals_codigo_obra_fkey,
  add constraint flow_manuals_codigo_obra_fkey
    foreign key (codigo_obra) references public.obras(codigo_obra) on delete cascade;

alter table public.projecao_config
  drop constraint projecao_config_codigo_obra_fkey,
  add constraint projecao_config_codigo_obra_fkey
    foreign key (codigo_obra) references public.obras(codigo_obra) on delete cascade;

alter table public.projecao_movimentacoes
  drop constraint projecao_movimentacoes_codigo_obra_fkey,
  add constraint projecao_movimentacoes_codigo_obra_fkey
    foreign key (codigo_obra) references public.obras(codigo_obra) on delete cascade;

alter table public.upload_history
  drop constraint upload_history_codigo_obra_fkey,
  add constraint upload_history_codigo_obra_fkey
    foreign key (codigo_obra) references public.obras(codigo_obra) on delete cascade;

create or replace function public.admin_replace_user_permissions(
  p_email text,
  p_nome text default null,
  p_observacao text default null,
  p_role text default 'editor',
  p_codigos_obra text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_codigos text[] := array[]::text[];
  v_codigo text;
  v_missing text[];
  v_was_admin boolean;
begin
  if not public.authz_is_admin() then
    raise exception 'Apenas administradores podem alterar permissoes'
      using errcode = '42501';
  end if;

  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Email invalido' using errcode = '22023';
  end if;

  if v_role not in ('admin', 'editor') then
    raise exception 'Papel invalido: use admin ou editor' using errcode = '22023';
  end if;

  -- Serializa mudancas que podem alterar a quantidade de administradores.
  perform pg_advisory_xact_lock(hashtext('admin-user-permissions'));

  select exists (
    select 1
    from public.editores_permitidos
    where lower(email) = v_email
      and role = 'admin'
      and status = 'active'
  ) into v_was_admin;

  if v_was_admin and v_role <> 'admin' and not exists (
    select 1
    from public.editores_permitidos
    where lower(email) <> v_email
      and role = 'admin'
      and status = 'active'
  ) then
    raise exception 'Nao e permitido remover o ultimo administrador ativo'
      using errcode = '23514';
  end if;

  if v_role = 'editor' then
    select coalesce(array_agg(code order by code), array[]::text[])
    into v_codigos
    from (
      select distinct btrim(raw_code) as code
      from unnest(coalesce(p_codigos_obra, array[]::text[])) as raw(raw_code)
      where nullif(btrim(raw_code), '') is not null
    ) normalized;

    select array_agg(code order by code)
    into v_missing
    from unnest(v_codigos) as requested(code)
    where not exists (
      select 1
      from public.obras o
      where o.codigo_obra = requested.code
        and coalesce(o.ativa, true) = true
    );

    if coalesce(array_length(v_missing, 1), 0) > 0 then
      raise exception 'Obras inexistentes ou inativas: %', array_to_string(v_missing, ', ')
        using errcode = '23503';
    end if;
  end if;

  -- DELETE e INSERT fazem parte da mesma transacao da chamada RPC. Qualquer
  -- falha restaura automaticamente as permissoes anteriores.
  delete from public.editores_permitidos
  where lower(email) = v_email;

  if v_role = 'admin' then
    insert into public.editores_permitidos (
      email, nome, observacao, codigo_obra, role, status, aprovado_em, aprovado_por
    ) values (
      v_email, nullif(btrim(p_nome), ''), nullif(btrim(p_observacao), ''),
      null, 'admin', 'active', now(), public.authz_current_email()
    );
  elsif coalesce(array_length(v_codigos, 1), 0) = 0 then
    insert into public.editores_permitidos (
      email, nome, observacao, codigo_obra, role, status, aprovado_em, aprovado_por
    ) values (
      v_email, nullif(btrim(p_nome), ''),
      coalesce(nullif(btrim(p_observacao), ''), 'Sem obras atribuidas'),
      null, 'editor', 'active', now(), public.authz_current_email()
    );
  else
    foreach v_codigo in array v_codigos
    loop
      insert into public.editores_permitidos (
        email, nome, observacao, codigo_obra, role, status, aprovado_em, aprovado_por
      ) values (
        v_email, nullif(btrim(p_nome), ''), nullif(btrim(p_observacao), ''),
        v_codigo, 'editor', 'active', now(), public.authz_current_email()
      );
    end loop;
  end if;

  return jsonb_build_object(
    'email', v_email,
    'role', v_role,
    'codigos_obra', to_jsonb(v_codigos),
    'total_registros', greatest(coalesce(array_length(v_codigos, 1), 0), 1)
  );
end;
$$;

create or replace function public.admin_delete_user_permissions(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_was_admin boolean;
  v_deleted integer;
begin
  if not public.authz_is_admin() then
    raise exception 'Apenas administradores podem excluir permissoes'
      using errcode = '42501';
  end if;

  if v_email = '' then
    raise exception 'Email obrigatorio' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('admin-user-permissions'));

  select exists (
    select 1
    from public.editores_permitidos
    where lower(email) = v_email
      and role = 'admin'
      and status = 'active'
  ) into v_was_admin;

  if v_was_admin and not exists (
    select 1
    from public.editores_permitidos
    where lower(email) <> v_email
      and role = 'admin'
      and status = 'active'
  ) then
    raise exception 'Nao e permitido remover o ultimo administrador ativo'
      using errcode = '23514';
  end if;

  delete from public.editores_permitidos
  where lower(email) = v_email;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    raise exception 'Usuario nao encontrado na whitelist' using errcode = 'P0002';
  end if;

  return jsonb_build_object('email', v_email, 'registros_excluidos', v_deleted);
end;
$$;

create or replace function public.admin_delete_obra(p_codigo_obra text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codigo text := btrim(coalesce(p_codigo_obra, ''));
  v_origem text;
  v_storage_paths jsonb;
  v_classificacoes integer;
  v_manuais integer;
  v_config_projecao integer;
  v_movimentacoes integer;
  v_uploads integer;
  v_permissoes integer;
  v_configs_dashboard integer;
begin
  if not public.authz_is_admin() then
    raise exception 'Apenas administradores podem excluir obras'
      using errcode = '42501';
  end if;

  if v_codigo = '' then
    raise exception 'Codigo da obra obrigatorio' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('admin-delete-obra:' || v_codigo));

  select origem
  into v_origem
  from public.obras
  where codigo_obra = v_codigo
  for update;

  if not found then
    raise exception 'Obra nao encontrada: %', v_codigo using errcode = 'P0002';
  end if;

  if v_origem <> 'manual' then
    raise exception 'Somente obras de origem manual podem ser excluidas'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(path order by path), '[]'::jsonb)
  into v_storage_paths
  from (
    select distinct storage_path as path
    from public.upload_history
    where codigo_obra = v_codigo
      and nullif(btrim(storage_path), '') is not null
  ) stored;

  select count(*) into v_classificacoes from public.flow_classifications where codigo_obra = v_codigo;
  select count(*) into v_manuais from public.flow_manuals where codigo_obra = v_codigo;
  select count(*) into v_config_projecao from public.projecao_config where codigo_obra = v_codigo;
  select count(*) into v_movimentacoes from public.projecao_movimentacoes where codigo_obra = v_codigo;
  select count(*) into v_uploads from public.upload_history where codigo_obra = v_codigo;
  select count(*) into v_permissoes from public.editores_permitidos where codigo_obra = v_codigo;
  select count(*) into v_configs_dashboard
  from public.dashboard_config
  where left(chave, length(v_codigo) + 1) = v_codigo || ':';

  delete from public.dashboard_config
  where left(chave, length(v_codigo) + 1) = v_codigo || ':';

  -- As seis FKs acima removem os registros vinculados na mesma transacao.
  delete from public.obras where codigo_obra = v_codigo;

  return jsonb_build_object(
    'codigo_obra', v_codigo,
    'storage_paths', v_storage_paths,
    'excluidos', jsonb_build_object(
      'classificacoes', v_classificacoes,
      'manuais', v_manuais,
      'config_projecao', v_config_projecao,
      'movimentacoes', v_movimentacoes,
      'uploads', v_uploads,
      'permissoes', v_permissoes,
      'configs_dashboard', v_configs_dashboard
    )
  );
end;
$$;

revoke all on function public.admin_replace_user_permissions(text, text, text, text, text[]) from public, anon;
revoke all on function public.admin_delete_user_permissions(text) from public, anon;
revoke all on function public.admin_delete_obra(text) from public, anon;

grant execute on function public.admin_replace_user_permissions(text, text, text, text, text[]) to authenticated;
grant execute on function public.admin_delete_user_permissions(text) to authenticated;
grant execute on function public.admin_delete_obra(text) to authenticated;

commit;
