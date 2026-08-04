-- Registra a causa do desvio e o indice das parcelas de inflacao incorporadas.

begin;

do $$
begin
  if to_regclass('public.flow_classifications') is null then
    raise exception 'Preflight falhou: tabela public.flow_classifications ausente';
  end if;
end;
$$;

alter table public.flow_classifications
  add column if not exists causa_desvio text not null default 'nao_classificado',
  add column if not exists indice_inflacao text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.flow_classifications'::regclass
      and conname = 'flow_classifications_causa_desvio_check'
  ) then
    alter table public.flow_classifications
      add constraint flow_classifications_causa_desvio_check
      check (causa_desvio in ('nao_classificado', 'inflacao', 'demais_causas'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.flow_classifications'::regclass
      and conname = 'flow_classifications_indice_inflacao_check'
  ) then
    alter table public.flow_classifications
      add constraint flow_classifications_indice_inflacao_check
      check (indice_inflacao is null or indice_inflacao in ('ipca', 'incc', 'outro'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.flow_classifications'::regclass
      and conname = 'flow_classifications_inflacao_completa_check'
  ) then
    alter table public.flow_classifications
      add constraint flow_classifications_inflacao_completa_check
      check (
        (causa_desvio = 'inflacao' and indice_inflacao is not null)
        or (causa_desvio <> 'inflacao' and indice_inflacao is null)
      );
  end if;
end;
$$;

comment on column public.flow_classifications.causa_desvio is
  'Causa manual do impacto: nao_classificado, inflacao ou demais_causas.';
comment on column public.flow_classifications.indice_inflacao is
  'Indice da parcela incorporada: ipca, incc ou outro; obrigatorio para inflacao.';

grant select (causa_desvio, indice_inflacao)
  on table public.flow_classifications to anon;

commit;

notify pgrst, 'reload schema';
