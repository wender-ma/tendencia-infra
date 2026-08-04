begin;

revoke select (causa_desvio, indice_inflacao)
  on table public.flow_classifications from anon;

alter table public.flow_classifications
  drop constraint if exists flow_classifications_inflacao_completa_check,
  drop constraint if exists flow_classifications_indice_inflacao_check,
  drop constraint if exists flow_classifications_causa_desvio_check,
  drop column if exists indice_inflacao,
  drop column if exists causa_desvio;

commit;

notify pgrst, 'reload schema';
