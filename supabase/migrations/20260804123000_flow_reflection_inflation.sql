-- Simplifica a inflacao incorporada como status de reflexo e adiciona anotacoes.

begin;

do $$
begin
  if to_regclass('public.flow_classifications') is null then
    raise exception 'Preflight falhou: tabela public.flow_classifications ausente';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'flow_classifications'
      and column_name in ('causa_desvio', 'indice_inflacao')
    group by table_name
    having count(*) = 2
  ) then
    raise exception 'Preflight falhou: aplique primeiro a migration v1.11.0';
  end if;
end;
$$;

alter table public.flow_classifications
  add column if not exists observacao text;

alter table public.flow_classifications
  drop constraint if exists flow_classifications_refletido_status_check;

alter table public.flow_classifications
  add constraint flow_classifications_refletido_status_check
  check (refletido_status is null or refletido_status in ('pendente', 'sim', 'nao', 'ipca', 'incc'));

-- Preserva classificacoes de inflacao feitas na v1.11.0 no novo campo unico.
update public.flow_classifications
set
  refletido_status = indice_inflacao,
  refletido_mes = coalesce(refletido_mes, date_trunc('month', current_date)::date)
where causa_desvio = 'inflacao'
  and indice_inflacao in ('ipca', 'incc');

comment on column public.flow_classifications.refletido_status is
  'Status do reflexo: pendente, sim, nao, ipca ou incc. IPCA e INCC sao refletidos.';
comment on column public.flow_classifications.observacao is
  'Observacoes e anotacoes manuais preservadas entre uploads.';
comment on column public.flow_classifications.causa_desvio is
  'Campo legado v1.11.0, mantido temporariamente apenas para rollback.';
comment on column public.flow_classifications.indice_inflacao is
  'Campo legado v1.11.0, mantido temporariamente apenas para rollback.';

revoke select (causa_desvio, indice_inflacao)
  on table public.flow_classifications from anon;
grant select (observacao)
  on table public.flow_classifications to anon;

commit;

notify pgrst, 'reload schema';
