begin;

drop table if exists public.projection_workforce_rows;
drop table if exists public.projection_workforce_settings;
select pg_notify('pgrst', 'reload schema');

commit;
