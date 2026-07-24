reset role;

insert into public.dashboard_config (chave, valor) values
  ('OBRA-A:dados_tendencia', '[]'),
  ('OBRA-A:dados_flows', '[]'),
  ('OBRA-A:gestao_label', 'GESTAO TESTE'),
  ('OBRA-A:evol_global', '{}'),
  ('dados_flows', '[]'),
  ('dados_historico', '{}'),
  ('dados_projraw', '[]'),
  ('header_title', 'Preservar')
on conflict (chave) do update set valor = excluded.valor;

set role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","email":"dataset-editor@example.test"}',
  false
);

do $$
begin
  if (
    select count(*)
    from public.dashboard_datasets
    where codigo_obra = 'OBRA-A' and status <> 'active'
  ) <> 1 then
    raise exception 'editor nao seleciona metadata inativa da propria obra';
  end if;
  if (
    select count(*)
    from storage.objects
    where bucket_id = 'dashboard-datasets'
      and name = 'OBRA-A/tendencia/v2.json'
  ) <> 1 then
    raise exception 'editor nao seleciona objeto inativo da propria obra';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.reset_dashboard_datasets('OBRA-A', true);
    raise exception 'editor resetou datasets globais';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select public.reset_dashboard_datasets('OBRA-A', false);

reset role;

do $$
begin
  if exists (
    select 1
    from public.dashboard_datasets
    where codigo_obra = 'OBRA-A' and tipo = 'tendencia'
  ) then
    raise exception 'reset da obra preservou metadata de tendencia';
  end if;
  if not exists (
    select 1
    from public.dashboard_datasets
    where codigo_obra is null and tipo = 'flows' and status = 'active'
  ) then
    raise exception 'reset da obra alterou dataset global';
  end if;
  if exists (
    select 1
    from public.dashboard_config
    where chave like 'OBRA-A:%'
      and chave in (
        'OBRA-A:dados_tendencia',
        'OBRA-A:dados_flows',
        'OBRA-A:gestao_label',
        'OBRA-A:evol_global'
      )
  ) then
    raise exception 'reset da obra preservou configuracao selecionada';
  end if;
  if (
    select count(*)
    from public.dashboard_config
    where chave in ('dados_flows', 'dados_historico', 'dados_projraw')
  ) <> 3 then
    raise exception 'reset da obra alterou configuracao global';
  end if;
end;
$$;

set role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","email":"admin@example.test"}',
  false
);
select public.reset_dashboard_datasets('OBRA-A', true);
reset role;

do $$
begin
  if exists (select 1 from public.dashboard_datasets) then
    raise exception 'reset global preservou metadata de dataset';
  end if;
  if exists (
    select 1
    from public.dashboard_config
    where chave in ('dados_flows', 'dados_historico', 'dados_projraw')
  ) then
    raise exception 'reset global preservou blobs legados';
  end if;
  if not exists (
    select 1 from public.dashboard_config where chave = 'header_title'
  ) then
    raise exception 'reset global removeu configuracao fora do escopo';
  end if;
end;
$$;
