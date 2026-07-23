export const DASHBOARD_DATASET_BUCKET = 'dashboard-datasets';

const TABLE = 'dashboard_datasets';
const METADATA_COLUMNS =
  'id,codigo_obra,tipo,versao,storage_path,sha256,linhas,bytes,status,upload_history_id,created_at,created_by,activated_at';

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

export function datasetScope(type, activeProject) {
  if (type === 'tendencia') {
    const project = String(activeProject || '').trim();
    if (!project) throw new Error('Obra ativa obrigatória para o dataset de Tendência');
    return { codigoObra: project, prefix: `${project}/tendencia` };
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

function assertDatasetValue(entry) {
  const valid =
    entry.type === 'historico'
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
    warn('Datasets/schema ainda não aplicado; usando dashboard_config', error);
    return true;
  }

  async function checkAvailability() {
    const supabase = client();
    if (!supabase || availability === 'unavailable') return false;
    if (availability === 'available') return true;
    const { error } = await supabase.from(TABLE).select('id').limit(1);
    if (error) {
      if (markUnavailable(error)) return false;
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
      warn(`Datasets/carregar/${type}; usando fallback legado`, error);
      return null;
    }
  }

  async function loadForDashboard() {
    const project = String(getActiveProject?.() || '').trim();
    if (!project || !(await checkAvailability())) return {};
    const [tendency, flows, history, projectionRaw] = await Promise.all([
      safeLoad('tendencia', project),
      safeLoad('flows', null),
      safeLoad('historico', null),
      safeLoad('projecao_raw', null),
    ]);
    return {
      ...(tendency ? { tendency: tendency.data } : {}),
      ...(flows ? { flows: flows.data } : {}),
      ...(history ? { history: history.data } : {}),
      ...(projectionRaw ? { projectionRaw: projectionRaw.data } : {}),
    };
  }

  async function removeMetadata(id) {
    const { error } = await client().from(TABLE).delete().eq('id', id);
    if (error) throw error;
  }

  async function removeObject(path) {
    const { error } = await client().storage.from(DASHBOARD_DATASET_BUCKET).remove([path]);
    if (error) throw error;
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
      const { data, error: insertError } = await client()
        .from(TABLE)
        .insert(candidate)
        .select(METADATA_COLUMNS)
        .single();
      if (insertError) throw insertError;
      metadata = data;

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

  async function saveForUpload(kinds, dashboardData, records = []) {
    if (!(await checkAvailability())) return { available: false, activations: [] };
    const entries = buildDatasetEntries(
      dashboardData,
      kinds,
      String(getActiveProject?.() || '').trim(),
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

  return Object.freeze({
    bucket: DASHBOARD_DATASET_BUCKET,
    checkAvailability,
    getActiveMetadata,
    loadSnapshot,
    loadForDashboard,
    saveForUpload,
    rollbackSnapshots,
    get availability() {
      return availability;
    },
  });
}
