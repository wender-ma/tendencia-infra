do $$
begin
  if to_regclass('public.projection_workforce_settings') is not null then
    raise exception 'projection_workforce_settings permaneceu apos rollback';
  end if;
  if to_regclass('public.projection_workforce_rows') is not null then
    raise exception 'projection_workforce_rows permaneceu apos rollback';
  end if;
end;
$$;
