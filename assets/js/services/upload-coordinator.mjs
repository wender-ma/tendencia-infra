function projectKey(key, project) {
  return project ? `${project}:${key}` : key;
}

export function buildUploadDashboardRows(
  { tendency, flows, history, projectionRaw, managementLabel },
  kinds,
  project,
  date = new Date(),
  dataKeys,
) {
  const requested = Array.isArray(kinds) ? [...new Set(kinds)] : ['tendencia', 'flows', 'gestoes'];
  const values = new Map();

  if (requested.includes('tendencia')) {
    if (!Array.isArray(tendency) || !tendency.length) {
      throw new Error('Tendência sem dados válidos para persistir');
    }
    values.set(projectKey(dataKeys.DATA_T, project), JSON.stringify(tendency));
    values.set(projectKey(dataKeys.GESTAO_LABEL, project), String(managementLabel || ''));
  }
  if (requested.includes('flows')) {
    if (!Array.isArray(flows) || !flows.length) {
      throw new Error('Flows sem dados válidos para persistir');
    }
    values.set(dataKeys.DATA_F, JSON.stringify(flows));
  }
  if (requested.includes('gestoes')) {
    if (!history?.items?.length) throw new Error('Histórico sem dados válidos para persistir');
    values.set(dataKeys.HISTORICO, JSON.stringify(history));
    values.set(
      dataKeys.PROJ_RAW,
      JSON.stringify(Array.isArray(projectionRaw) ? projectionRaw : []),
    );
  }

  const updatedAt = date.toISOString();
  return [...values].map(([chave, valor]) => ({ chave, valor, updated_at: updatedAt }));
}

export function createUploadCoordinator({
  getClient,
  getActiveProject,
  getDashboardData,
  restoreDashboardData,
  getInputOptions,
  setInputOptions,
  canEditActiveProject,
  isAdmin,
  isGlobalKind,
  dataKeys,
  uploadRepository,
  executeTransaction,
  setProjectSelectorDisabled = () => {},
  rebuildInputList = () => {},
  markSyncError = () => {},
  markSynced = () => {},
  reportCleanupError = () => {},
  now = () => new Date(),
}) {
  const runtimeState = Object.create(null);
  const client = () => getClient?.() || null;
  const activeProject = () => String(getActiveProject?.() || '').trim();

  function rowsFor(kinds) {
    return buildUploadDashboardRows(getDashboardData(), kinds, activeProject(), now(), dataKeys);
  }

  async function captureDashboardRows(kinds) {
    const supabase = client();
    if (!supabase) throw new Error('Supabase indisponível');
    const keys = rowsFor(kinds).map((row) => row.chave);
    const { data, error } = await supabase
      .from('dashboard_config')
      .select('chave,valor')
      .in('chave', keys);
    if (error) throw error;
    return { keys, rows: data || [] };
  }

  async function restoreDashboardRows(snapshot) {
    if (!snapshot?.keys?.length) return;
    const supabase = client();
    if (!supabase) throw new Error('Supabase indisponível');
    const updatedAt = now().toISOString();
    const previousRows = (snapshot.rows || []).map((row) => ({ ...row, updated_at: updatedAt }));
    if (previousRows.length) {
      const { error } = await supabase
        .from('dashboard_config')
        .upsert(previousRows, { onConflict: 'chave' });
      if (error) throw error;
    }
    const previousKeys = new Set(previousRows.map((row) => row.chave));
    const keysToDelete = snapshot.keys.filter((key) => !previousKeys.has(key));
    if (keysToDelete.length) {
      const { error } = await supabase.from('dashboard_config').delete().in('chave', keysToDelete);
      if (error) throw error;
    }
  }

  async function saveAllData(kinds) {
    const supabase = client();
    if (!supabase) throw new Error('Supabase indisponível');
    if (!canEditActiveProject?.()) {
      throw new Error('Sem permissão para persistir dados da obra ativa');
    }
    if ((!Array.isArray(kinds) || kinds.some(isGlobalKind)) && !isAdmin?.()) {
      throw new Error('Apenas administradores podem persistir dados globais');
    }
    if (!activeProject()) throw new Error('Nenhuma obra ativa para persistência');

    const rows = rowsFor(kinds);
    const { error } = await supabase.from('dashboard_config').upsert(rows, { onConflict: 'chave' });
    if (error) {
      markSyncError(error);
      throw error;
    }
    markSynced();
    return rows;
  }

  function setRuntimeState(kinds, status, message = '') {
    for (const kind of Array.isArray(kinds) ? kinds : [kinds]) {
      runtimeState[kind] = { status, message, updatedAt: now() };
    }
    setProjectSelectorDisabled(
      Object.values(runtimeState).some((state) => state.status === 'processing'),
    );
  }

  function captureMemoryState() {
    return {
      ...getDashboardData(),
      evolution: { ...getDashboardData().evolution },
      inputOptions: getInputOptions(),
    };
  }

  function restoreMemoryState(snapshot) {
    if (!snapshot) return;
    restoreDashboardData(snapshot);
    setInputOptions(snapshot.inputOptions);
    try {
      rebuildInputList();
    } catch (error) {
      reportCleanupError('Upload/restaurar lista de insumos', error);
    }
  }

  async function commitPreparedUpload({
    file,
    storageType,
    items,
    groupId = null,
    memorySnapshot,
  }) {
    return executeTransaction(
      { file, storageType, items, groupId, memorySnapshot },
      {
        captureDashboardRows,
        uploadFile: uploadRepository.uploadFile,
        createRecord: (item) =>
          uploadRepository.createRecord(
            item.kind,
            item.fileName,
            item.fileSize,
            item.rows,
            item.storagePath,
            item.groupId,
          ),
        saveAllData,
        activateRecord: uploadRepository.activateRecord,
        rollbackActivation: uploadRepository.rollbackActivation,
        restoreDashboardRows,
        markRecordsFailed: uploadRepository.markRecordsFailed,
        removeStoredUpload: uploadRepository.removeStoredUpload,
        deleteRecords: uploadRepository.deleteRecords,
        restoreMemoryState,
        setRuntimeState,
        onActive: (activeRecords) => {
          const data = getDashboardData();
          activeRecords.forEach((record) => {
            data.latestUploads[record.tipo] = record;
          });
        },
        reportCleanupError,
      },
    );
  }

  return Object.freeze({
    runtimeState,
    captureDashboardRows,
    restoreDashboardRows,
    saveAllData,
    setRuntimeState,
    captureMemoryState,
    restoreMemoryState,
    commitPreparedUpload,
  });
}
