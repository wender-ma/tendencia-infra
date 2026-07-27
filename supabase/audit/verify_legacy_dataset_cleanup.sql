-- Auditoria somente leitura para o fim da janela do modo snapshots.
-- Execute somente em ou depois de 03/08/2026, no projeto de producao confirmado.
-- Este arquivo nao remove nem altera dados.

with legacy_targets as (
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
    or chave ~ '^[^:]+:(dados_tendencia|dados_flows)$'
),
matched_targets as (
  select
    target.chave,
    target.legacy_bytes,
    target.tipo,
    dataset.id as dataset_id,
    object.id as object_id
  from legacy_targets target
  left join public.dashboard_datasets dataset
    on dataset.codigo_obra is not distinct from target.codigo_obra
    and dataset.tipo = target.tipo
    and dataset.status = 'active'
  left join storage.objects object
    on object.bucket_id = 'dashboard-datasets'
    and object.name = dataset.storage_path
),
inventory as (
  select
    count(*) as legacy_key_count,
    coalesce(sum(legacy_bytes), 0) as legacy_bytes,
    count(*) filter (where tipo is null) as unsupported_key_count,
    count(dataset_id) as matched_active_snapshot_count,
    count(object_id) as matched_storage_object_count,
    (
      select count(*)
      from public.dashboard_datasets
      where status = 'processing'
    ) as processing_snapshot_count
  from matched_targets
)
select jsonb_build_object(
  'checked_at', now(),
  'earliest_cleanup_date', date '2026-08-03',
  'stability_window_elapsed', current_date >= date '2026-08-03',
  'legacy_key_count', legacy_key_count,
  'legacy_bytes', legacy_bytes,
  'unsupported_key_count', unsupported_key_count,
  'matched_active_snapshot_count', matched_active_snapshot_count,
  'matched_storage_object_count', matched_storage_object_count,
  'processing_snapshot_count', processing_snapshot_count,
  'cleanup_ready',
    current_date >= date '2026-08-03'
    and legacy_key_count = 4
    and legacy_bytes = 974425
    and unsupported_key_count = 0
    and matched_active_snapshot_count = 4
    and matched_storage_object_count = 4
    and processing_snapshot_count = 0
) as legacy_dataset_cleanup
from inventory;
