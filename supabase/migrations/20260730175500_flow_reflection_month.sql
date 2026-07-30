-- Registra o mes em que cada Flow foi refletido no planejamento.

begin;

do $$
begin
  if to_regclass('public.flow_classifications') is null then
    raise exception 'Preflight falhou: tabela public.flow_classifications ausente';
  end if;
end;
$$;

alter table public.flow_classifications
  add column if not exists refletido_mes date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.flow_classifications'::regclass
      and conname = 'flow_classifications_refletido_mes_check'
  ) then
    alter table public.flow_classifications
      add constraint flow_classifications_refletido_mes_check
      check (
        refletido_mes is null
        or refletido_mes = date_trunc('month', refletido_mes)::date
      );
  end if;
end;
$$;

comment on column public.flow_classifications.refletido_mes is
  'Primeiro dia do mes usado para representar MM/AAAA do reflexo no planejamento.';

grant select (refletido_mes)
  on table public.flow_classifications to anon;

commit;

notify pgrst, 'reload schema';
