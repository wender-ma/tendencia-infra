-- Remove o mes de reflexo. Este rollback descarta os meses ja registrados.

begin;

revoke select (refletido_mes)
  on table public.flow_classifications from anon;

alter table public.flow_classifications
  drop constraint if exists flow_classifications_refletido_mes_check;

alter table public.flow_classifications
  drop column if exists refletido_mes;

commit;

notify pgrst, 'reload schema';
