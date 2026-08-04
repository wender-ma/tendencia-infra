begin;

update public.flow_classifications
set
  causa_desvio = 'inflacao',
  indice_inflacao = refletido_status,
  refletido_status = 'sim'
where refletido_status in ('ipca', 'incc');

alter table public.flow_classifications
  drop constraint if exists flow_classifications_refletido_status_check;

alter table public.flow_classifications
  add constraint flow_classifications_refletido_status_check
  check (refletido_status is null or refletido_status in ('pendente', 'sim', 'nao'));

revoke select (observacao)
  on table public.flow_classifications from anon;
grant select (causa_desvio, indice_inflacao)
  on table public.flow_classifications to anon;

alter table public.flow_classifications
  drop column if exists observacao;

commit;

notify pgrst, 'reload schema';
