-- Rollback emergencial de 20260720203000_admin_transactions.sql.
-- Execute antes do rollback da migration de RLS.

begin;

drop function if exists public.admin_replace_user_permissions(text, text, text, text, text[]);
drop function if exists public.admin_delete_user_permissions(text);
drop function if exists public.admin_delete_obra(text);

alter table public.editores_permitidos
  drop constraint editores_permitidos_codigo_obra_fkey,
  add constraint editores_permitidos_codigo_obra_fkey
    foreign key (codigo_obra) references public.obras(codigo_obra);

alter table public.flow_classifications
  drop constraint flow_classifications_codigo_obra_fkey,
  add constraint flow_classifications_codigo_obra_fkey
    foreign key (codigo_obra) references public.obras(codigo_obra);

alter table public.flow_manuals
  drop constraint flow_manuals_codigo_obra_fkey,
  add constraint flow_manuals_codigo_obra_fkey
    foreign key (codigo_obra) references public.obras(codigo_obra);

alter table public.projecao_config
  drop constraint projecao_config_codigo_obra_fkey,
  add constraint projecao_config_codigo_obra_fkey
    foreign key (codigo_obra) references public.obras(codigo_obra);

alter table public.projecao_movimentacoes
  drop constraint projecao_movimentacoes_codigo_obra_fkey,
  add constraint projecao_movimentacoes_codigo_obra_fkey
    foreign key (codigo_obra) references public.obras(codigo_obra);

alter table public.upload_history
  drop constraint upload_history_codigo_obra_fkey,
  add constraint upload_history_codigo_obra_fkey
    foreign key (codigo_obra) references public.obras(codigo_obra);

commit;
