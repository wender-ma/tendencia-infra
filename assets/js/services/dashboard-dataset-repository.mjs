export const DASHBOARD_DATASET_BUCKET = 'dashboard-datasets';

const TABLE = 'dashboard_datasets';
const METADATA_COLUMNS =
  'id,codigo_obra,tipo,versao,storage_path,sha256,linhas,bytes,status,created_at,activated_at';

export function isDatasetSchemaUnavailable(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (message.includes('dashboard_datasets') &&
      (message.includes('does not exist') || message.includes('schema cache')))
  );
}

export function isDatasetResetRpcUnavailable(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    (message.includes('reset_dashboard_datasets') &&
      (message.includes('not found') || message.includes('does not exist')))
  );
}

export function datasetScope(type, activeProject) {
  if (['tendencia', 'cronograma_fisico'].includes(type)) {
    const project = String(activeProject || '').trim();
    if (!project) throw new Error('Obra ativa obrigatória para o dataset por obra');
    return { codigoObra: project, prefix: `${project}/${type}` };
  }
  if (['flows', 'historico', 'projecao_raw'].includes(type)) {
    return { codigoObra: null, prefix: `_global/${type}` };
  }
  throw new Error(`Tipo de dataset inválido: ${type}`);
}

export function buildDatasetEntries(dashboardData, kinds, activeProject, records = []) {
  const requested = new Set(Array.isArray(kinds) ? kinds : ['tendencia', 'flows', 'gestoes']);
  const uploadIds = new Map(records.map((record) => [record.tipo, record.id]));
  const entries = [];

  if (requested.has('tendencia')) {
    entries.push({
      type: 'tendencia',
      data: dashboardData.tendency,
      rows: dashboardData.tendency?.length || 0,
      uploadHistoryId: uploadIds.get('tendencia') || null,
      ...datasetScope('tendencia', activeProject),
    });
  }
  if (requested.has('cronograma_fisico')) {
    entries.push({
      type: 'cronograma_fisico',
      data: dashboardData.physicalSchedule,
      rows: dashboardData.physicalSchedule?.items?.length || 0,
      uploadHistoryId: uploadIds.get('cronograma_fisico') || null,
      ...datasetScope('cronograma_fisico', activeProject),
    });
  }
  if (requested.has('flows')) {
    entries.push({
      type: 'flows',
      data: dashboardData.flows,
      rows: dashboardData.flows?.length || 0,
      uploadHistoryId: uploadIds.get('flows') || null,
      ...datasetScope('flows', activeProject),
    });
  }
  if (requested.has('gestoes')) {
    const uploadHistoryId = uploadIds.get('gestoes') || null;
    entries.push(
      {
        type: 'historico',
        data: dashboardData.history,
        rows: dashboardData.history?.items?.length || 0,
        uploadHistoryId,
        ...datasetScope('historico', activeProject),
      },
      {
        type: 'projecao_raw',
        data: dashboardData.projectionRaw,
        rows: dashboardData.projectionRaw?.length || 0,
        uploadHistoryId,
        ...datasetScope('projecao_raw', activeProject),
      },
    );
  }
  return entries;
}

export function datasetRetentionScopes(kinds, activeProject) {
  const requested = new Set(Array.isArray(kinds) ? kinds : ['tendencia', 'flows', 'gestoes']);
  const scopes = [];
  if (requested.has('tendencia')) {
    scopes.push({ type: 'tendencia', ...datasetScope('tendencia', activeProject) });
  }
  if (requested.has('cronograma_fisico')) {
    scopes.push({ type: 'cronograma_fisico', ...datasetScope('cronograma_fisico', activeProject) });
  }
  if (requested.has('flows')) {
    scopes.push({ type: 'flows', ...datasetScope('flows', activeProject) });
  }
  if (requested.has('gestoes')) {
    scopes.push(
      { type: 'historico', ...datasetScope('historico', activeProject) },
      { type: 'projecao_raw', ...datasetScope('projecao_raw', activeProject) },
    );
  }
  return scopes;
}

function assertDatasetValue(entry) {
  const valid =
    entry.type === 'historico'
      ? entry.data && Array.isArray(entry.data.items) && entry.data.items.length > 0
      : entry.type === 'cronograma_fisico'
        ? entry.data && Array.isArray(entry.data.items) && entry.data.items.length > 0
        : Array.isArray(entry.data) && entry.data.length > 0;
  if (!valid) throw new Error(`Dataset ${entry.type} sem dados válidos para persistir`);
}

async function digestText(text, cryptoRef) {
  const bytes = new TextEncoder().encode(text);
  if (!cryptoRef?.subtle) throw new Error('SHA-256 indisponível neste navegador');
  const digest = await cryptoRef.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return { text, bytes: bytes.byteLength, sha256 };
}

function serializeDataset(data, cryptoRef) {
  return digestText(JSON.stringify(data), cryptoRef);
}

export function createDashboardDatasetRepository({
  getClient,
  getActiveProject,
  cryptoRef = globalThis.crypto,
  now = () => new Date(),
  createId = () => cryptoRef.randomUUID(),
  warn = () => {},
  allowLegacyFallback = true,
} = {}) {
  let availability = 'unknown';
  let lastVersion = 0;

  const client = () => getClient?.() || null;

  function nextVersion() {
    const candidate = now().getTime() * 1000;
    lastVersion = Math.max(candidate, lastVersion + 1);
    return String(lastVersion);
  }

  function markUnavailable(error) {
    if (!isDatasetSchemaUnavailable(error)) return false;
    availability = 'unavailable';
    warn(
      allowLegacyFallback
        ? 'Datasets/schema ainda não aplicado; usando dashboard_config'
        : 'Datasets/schema obrigatório no modo snapshots',
      error,
    );
    return true;
  }

  function unavailableSchemaError(cause) {
    return new Error('Snapshots versionados indisponíveis neste ambiente', { cause });
  }

  async function checkAvailability() {
    const supabase = client();
    if (!supabase) return false;
    if (availability === 'unavailable') {
      if (!allowLegacyFallback) throw unavailableSchemaError();
      return false;
    }
    if (availability === 'available') return true;
    const { error } = await supabase.from(TABLE).select('id').limit(1);
    if (error) {
      if (markUnavailable(error)) {
        if (!allowLegacyFallback) throw unavailableSchemaError(error);
        return false;
      }
      throw error;
    }
    availability = 'available';
    return true;
  }

  async function getActiveMetadata(type, codigoObra) {
    if (!(await checkAvailability())) return null;
    let query = client()
      .from(TABLE)
      .select(METADATA_COLUMNS)
      .eq('tipo', type)
      .eq('status', 'active');
    query = codigoObra ? query.eq('codigo_obra', codigoObra) : query.is('codigo_obra', null);
    const { data, error } = await query.order('versao', { ascending: false }).limit(1);
    if (error) {
      if (markUnavailable(error)) return null;
      throw error;
    }
    return data?.[0] || null;
  }

  async function loadSnapshot(type, codigoObra) {
    const metadata = await getActiveMetadata(type, codigoObra);
    if (!metadata) return null;
    const { data, error } = await client()
      .storage.from(DASHBOARD_DATASET_BUCKET)
      .download(metadata.storage_path);
    if (error) throw error;
    const text = await data.text();
    const integrity = await digestText(text, cryptoRef);
    if (integrity.bytes !== Number(metadata.bytes) || integrity.sha256 !== metadata.sha256) {
      throw new Error(`Integridade inválida para o dataset ${type}`);
    }
    const parsed = JSON.parse(text);
    assertDatasetValue({ type, data: parsed });
    return { metadata, data: parsed };
  }

  async function safeLoad(type, codigoObra) {
    try {
      return await loadSnapshot(type, codigoObra);
    } catch (error) {
      if (!allowLegacyFallback) throw error;
      warn(`Datasets/carregar/${type}; usando fallback legado`, error);
      return null;
    }
  }

  async function loadForDashboard() {
    const project = String(getActiveProject?.() || '').trim();
    if (!project || !(await checkAvailability())) return {};
    const [tendency, physicalSchedule, flows, history, projectionRaw] = await Promise.all([
      safeLoad('tendencia', project),
      safeLoad('cronograma_fisico', project),
      safeLoad('flows', null),
      safeLoad('historico', null),
      safeLoad('projecao_raw', null),
    ]);
    return {
      ...(tendency ? { tendency: tendency.data } : {}),
      ...(physicalSchedule ? { physicalSchedule: physicalSchedule.data } : {}),
      ...(flows ? { flows: flows.data } : {}),
      ...(history ? { history: history.data } : {}),
      ...(projectionRaw ? { projectionRaw: projectionRaw.data } : {}),
    };
  }

  async function removeMetadata(id) {
    const { data, error } = await client().from(TABLE).delete().eq('id', id).select('id');
    if (error) throw error;
    if (!Array.isArray(data) || !data.some((item) => item.id === id)) {
      throw new Error(`Metadata do dataset ${id} não foi removida`);
    }
  }

  async function removeObject(path) {
    const { data, error } = await client().storage.from(DASHBOARD_DATASET_BUCKET).remove([path]);
    if (error) throw error;
    if (!Array.isArray(data) || data.length !== 1) {
      throw new Error(`Objeto do dataset não foi removido: ${path}`);
    }
  }

  async function cleanupFailedVersion(metadata, uploaded) {
    if (!metadata) return;
    const { error: failError } = await client().rpc('fail_dashboard_dataset', {
      p_dataset_id: metadata.id,
    });
    if (failError) warn('Datasets/marcar versão com falha', failError);
    if (uploaded) {
      try {
        await removeObject(metadata.storage_path);
      } catch (error) {
        warn('Datasets/remover objeto incompleto', error);
      }
    }
    try {
      await removeMetadata(metadata.id);
    } catch (error) {
      warn('Datasets/remover metadata incompleta', error);
    }
  }

  async function saveSnapshot(entry) {
    assertDatasetValue(entry);
    const serialized = await serializeDataset(entry.data, cryptoRef);
    const id = createId();
    const version = nextVersion();
    const storagePath = `${entry.prefix}/${id}.json`;
    const candidate = {
      id,
      codigo_obra: entry.codigoObra,
      tipo: entry.type,
      versao: version,
      storage_path: storagePath,
      sha256: serialized.sha256,
      linhas: entry.rows,
      bytes: serialized.bytes,
      status: 'processing',
      upload_history_id: entry.uploadHistoryId,
    };
    let metadata = null;
    let uploaded = false;
    try {
      const { error: insertError } = await client().from(TABLE).insert(candidate);
      if (insertError) throw insertError;
      metadata = candidate;

      const { error: uploadError } = await client()
        .storage.from(DASHBOARD_DATASET_BUCKET)
        .upload(storagePath, new Blob([serialized.text], { type: 'application/json' }), {
          contentType: 'application/json',
          cacheControl: '3600',
          upsert: false,
        });
      if (uploadError) throw uploadError;
      uploaded = true;

      const { data: activation, error: activationError } = await client().rpc(
        'activate_dashboard_dataset',
        { p_dataset_id: metadata.id },
      );
      if (activationError) throw activationError;
      const previous = activation?.previous_id ? { id: activation.previous_id } : null;
      return { current: { ...metadata, status: 'active' }, previous };
    } catch (error) {
      await cleanupFailedVersion(metadata, uploaded);
      throw error;
    }
  }

  async function rollbackSnapshot(activation) {
    const { current, previous } = activation;
    const { error } = await client().rpc('rollback_dashboard_dataset', {
      p_current_id: current.id,
      p_previous_id: previous?.id || null,
    });
    if (error) throw error;
    await removeObject(current.storage_path);
    await removeMetadata(current.id);
  }

  async function rollbackSnapshots(activations = []) {
    const errors = [];
    for (const activation of [...activations].reverse()) {
      try {
        await rollbackSnapshot(activation);
      } catch (error) {
        errors.push(error);
        warn('Datasets/reverter versão ativa', error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Falha ao reverter snapshots versionados');
  }

  async function saveForUpload(kinds, dashboardData, records = [], projectCode = null) {
    if (!(await checkAvailability())) return { available: false, activations: [] };
    const entries = buildDatasetEntries(
      dashboardData,
      kinds,
      String(projectCode || getActiveProject?.() || '').trim(),
      records,
    );
    const activations = [];
    try {
      for (const entry of entries) activations.push(await saveSnapshot(entry));
      return { available: true, activations };
    } catch (error) {
      await rollbackSnapshots(activations);
      throw error;
    }
  }

  async function enforceRollingRetention(kinds, maxVersions = 12, projectCode = null) {
    if (!(await checkAvailability())) return { available: false, removed: 0 };
    const project = String(projectCode || getActiveProject?.() || '').trim();
    const limit = Math.max(1, Number(maxVersions) || 12);
    let removed = 0;

    for (const scope of datasetRetentionScopes(kinds, project)) {
      let query = client()
        .from(TABLE)
        .select(METADATA_COLUMNS)
        .eq('tipo', scope.type)
        .in('status', ['active', 'superseded'])
        .order('versao', { ascending: false })
        .limit(250);
      query = scope.codigoObra
        ? query.eq('codigo_obra', scope.codigoObra)
        : query.is('codigo_obra', null);
      const { data, error } = await query;
      if (error) throw error;

      const stale = (data || [])
        .slice(limit)
        .filter((metadata) => metadata.status === 'superseded');
      for (const metadata of stale) {
        await removeMetadata(metadata.id);
        try {
          await removeObject(metadata.storage_path);
        } catch (error) {
          warn(`Datasets/retencao/objeto orfao/${scope.type}`, error);
        }
        removed += 1;
      }
    }

    return { available: true, removed };
  }

  async function removeResetObjects(data) {
    const datasets = Array.isArray(data?.datasets) ? data.datasets : [];
    const paths = [...new Set(datasets.map((item) => item?.storage_path).filter(Boolean))];
    if (paths.length) {
      const { data: removedObjects, error: storageError } = await client()
        .storage.from(DASHBOARD_DATASET_BUCKET)
        .remove(paths);
      if (
        storageError ||
        !Array.isArray(removedObjects) ||
        removedObjects.length !== paths.length
      ) {
        const cleanupError = new Error(
          'Dados resetados, mas a limpeza dos objetos versionados ficou pendente',
          { cause: storageError || new Error('Storage não confirmou todos os objetos') },
        );
        cleanupError.code = 'DATASET_STORAGE_CLEANUP_PENDING';
        throw cleanupError;
      }
    }
    return {
      available: true,
      configDeleted: Number(data?.config_deleted || 0),
      datasetCount: datasets.length,
      storageObjectsRemoved: paths.length,
    };
  }

  async function resetDashboardData() {
    const supabase = client();
    const project = String(getActiveProject?.() || '').trim();
    if (!supabase) throw new Error('Supabase indisponível para resetar os datasets');
    if (!project) throw new Error('Nenhuma obra ativa para resetar os datasets');

    const { data, error } = await supabase.rpc('reset_dashboard_datasets', {
      p_codigo_obra: project,
      p_include_global: false,
    });
    if (error) {
      if (allowLegacyFallback && isDatasetResetRpcUnavailable(error)) {
        warn('Datasets/reset ainda não implantado; usando limpeza legada', error);
        return { available: false, configDeleted: 0, datasetCount: 0 };
      }
      throw error;
    }

    return removeResetObjects(data);
  }

  async function resetGlobalDashboardData() {
    const supabase = client();
    if (!supabase) throw new Error('Supabase indisponível para resetar os datasets globais');
    const { data, error } = await supabase.rpc('reset_global_dashboard_datasets');
    if (error) {
      if (allowLegacyFallback && isDatasetResetRpcUnavailable(error)) {
        warn('Datasets/reset global ainda não implantado; usando limpeza legada', error);
        return { available: false, configDeleted: 0, datasetCount: 0 };
      }
      throw error;
    }
    return removeResetObjects(data);
  }

  return Object.freeze({
    bucket: DASHBOARD_DATASET_BUCKET,
    checkAvailability,
    getActiveMetadata,
    loadSnapshot,
    loadForDashboard,
    saveForUpload,
    enforceRollingRetention,
    rollbackSnapshots,
    resetDashboardData,
    resetGlobalDashboardData,
    get availability() {
      return availability;
    },
  });
}
