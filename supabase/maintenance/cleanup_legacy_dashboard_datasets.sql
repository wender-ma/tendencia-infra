-- ============================================================================
-- LIMPEZA FINAL DOS QUATRO DATASETS LEGADOS
-- ============================================================================
-- Operacao destrutiva e irreversivel depois do commit.
-- Nao executar antes de:
--   1. 03/08/2026;
--   2. backup/export do banco;
--   3. verify_legacy_dataset_cleanup.sql retornar cleanup_ready = true;
--   4. smokes anonimo e autenticado passarem em producao;
--   5. autorizacao explicita do responsavel tecnico.
--
-- O script preserva todos os snapshots e objetos do bucket dashboard-datasets.
-- ============================================================================

begin;

create temporary table legacy_dataset_cleanup_targets
on commit drop
as
select
  chave,
  octet_length(valor) as legacy_bytes,
  case
    when chave = 'dados_flows' then 'flows'
    when chave = 'dados_historico' then 'historico'
    when chave = 'dados_projraw' then 'projecao_raw'
    when chave ~ '^[^:]+:dados_tendencia$' then 'tendencia'
    else null
  end as tipo,
  case
    when chave ~ '^[^:]+:dados_tendencia$' then split_part(chave, ':', 1)
    else null
  end as codigo_obra
from public.dashboard_config
where chave in ('dados_flows', 'dados_historico', 'dados_projraw')
  or chave ~ '^[^:]+:(dados_tendencia|dados_flows)$';

do $$
declare
  target record;
  legacy_key_count integer;
  legacy_bytes bigint;
  unsupported_key_count integer;
  matched_snapshot_count integer;
  matched_object_count integer;
  processing_snapshot_count integer;
  deleted_key_count integer;
  remaining_key_count integer;
begin
  if current_date < date '2026-08-03' then
    raise exception 'Limpeza bloqueada: a janela termina em 03/08/2026';
  end if;

  if to_regclass('public.dashboard_datasets') is null
    or not exists (
      select 1
      from storage.buckets
      where id = 'dashboard-datasets'
        and public = false
    ) then
    raise exception 'Limpeza bloqueada: deployment de snapshots incompleto';
  end if;

  select count(*), coalesce(sum(targets.legacy_bytes), 0),
    count(*) filter (where targets.tipo is null)
  into legacy_key_count, legacy_bytes, unsupported_key_count
  from legacy_dataset_cleanup_targets targets;

  if legacy_key_count <> 4 or legacy_bytes <> 974425 or unsupported_key_count <> 0 then
    raise exception
      'Limpeza bloqueada: inventario legado divergente (chaves %, bytes %, nao suportadas %)',
      legacy_key_count, legacy_bytes, unsupported_key_count;
  end if;

  select count(*)
  into processing_snapshot_count
  from public.dashboard_datasets
  where status = 'processing';

  if processing_snapshot_count <> 0 then
    raise exception 'Limpeza bloqueada: existe snapshot em processamento';
  end if;

  for target in
    select codigo_obra, tipo
    from legacy_dataset_cleanup_targets
    order by coalesce(codigo_obra, '_global'), tipo
  loop
    perform pg_advisory_xact_lock(
      hashtext(coalesce(target.codigo_obra, '_global') || ':' || target.tipo)
    );
  end loop;

  select count(dataset.id), count(object.id)
  into matched_snapshot_count, matched_object_count
  from legacy_dataset_cleanup_targets targets
  left join public.dashboard_datasets dataset
    on dataset.codigo_obra is not distinct from targets.codigo_obra
    and dataset.tipo = targets.tipo
    and dataset.status = 'active'
  left join storage.objects object
    on object.bucket_id = 'dashboard-datasets'
    and object.name = dataset.storage_path;

  if matched_snapshot_count <> 4 or matched_object_count <> 4 then
    raise exception
      'Limpeza bloqueada: snapshots/objetos ativos divergentes (snapshots %, objetos %)',
      matched_snapshot_count, matched_object_count;
  end if;

  delete from public.dashboard_config config
  using legacy_dataset_cleanup_targets target
  where config.chave = target.chave;
  get diagnostics deleted_key_count = row_count;

  select count(*)
  into remaining_key_count
  from public.dashboard_config
  where chave in ('dados_flows', 'dados_historico', 'dados_projraw')
    or chave ~ '^[^:]+:(dados_tendencia|dados_flows)$';

  if deleted_key_count <> 4 or remaining_key_count <> 0 then
    raise exception
      'Limpeza revertida: resultado divergente (removidas %, restantes %)',
      deleted_key_count, remaining_key_count;
  end if;
end;
$$;

select jsonb_build_object(
  'cleanup_complete', true,
  'deleted_legacy_key_count', 4,
  'remaining_legacy_key_count', 0,
  'snapshots_preserved',
    (
      select count(*)
      from public.dashboard_datasets
      where status = 'active'
    ),
  'storage_objects_preserved',
    (
      select count(*)
      from storage.objects
      where bucket_id = 'dashboard-datasets'
    )
) as legacy_dataset_cleanup_result;

commit;
