-- Rollback emergencial de 20260720203000_admin_transactions.sql.
-- Execute antes do rollback da migration de RLS.

begin;

drop function if exists public.admin_replace_user_permissions(text, text, text, text, text[]);
drop function if exists public.admin_delete_user_permissions(text);
drop function if exists public.admin_delete_obra(text);

commit;
