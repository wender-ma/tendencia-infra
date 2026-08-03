function projectKey(key, project) {
  return project ? `${project}:${key}` : key;
}

export function buildUploadDashboardRows(
  { tendency, flows, history, projectionRaw, physicalSchedule, managementLabel, evolution },
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
    if (dataKeys.EVOLUTION) {
      values.set(
        projectKey(dataKeys.EVOLUTION, project),
        JSON.stringify(evolution || { teorica: null, financeira: null }),
      );
    }
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
  if (requested.includes('cronograma_fisico') && !physicalSchedule?.items?.length) {
    throw new Error('Cronograma Físico sem dados válidos para persistir');
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
  canEditProject = null,
  isAdmin,
  isGlobalKind,
  dataKeys,
  persistenceMode = 'dual',
  dashboardDatasetRepository = {
    saveForUpload: async () => ({ available: false, activations: [] }),
    rollbackSnapshots: async () => {},
  },
  uploadRepository,
  executeTransaction,
  setProjectSelectorDisabled = () => {},
  rebuildInputList = () => {},
  markSyncError = () => {},
  markSynced = () => {},
  reportCleanupError = () => {},
  now = () => new Date(),
}) {
  if (!['dual', 'snapshots'].includes(persistenceMode)) {
    throw new Error(`Modo de persistência de datasets inválido: ${persistenceMode}`);
  }
  const runtimeState = Object.create(null);
  const client = () => getClient?.() || null;
  const activeProject = () => String(getActiveProject?.() || '').trim();

  function resolveScope(options = {}) {
    return {
      projectCode: String(options.projectCode || activeProject()).trim(),
      dashboardData: options.dashboardData || getDashboardData(),
    };
  }

  function rowsFor(kinds, options = {}) {
    const scope = resolveScope(options);
    return buildUploadDashboardRows(scope.dashboardData, kinds, scope.projectCode, now(), dataKeys);
  }

  function persistenceRowsFor(kinds, options = {}) {
    const scope = resolveScope(options);
    const rows = rowsFor(kinds, scope);
    if (persistenceMode === 'dual') return rows;
    const retainedKeys = new Set([
      projectKey(dataKeys.GESTAO_LABEL, scope.projectCode),
      projectKey(dataKeys.EVOLUTION, scope.projectCode),
    ]);
    return rows.filter((row) => retainedKeys.has(row.chave));
  }

  async function captureDashboardRows(kinds, options = {}) {
    const supabase = client();
    if (!supabase) throw new Error('Supabase indisponível');
    const keys = persistenceRowsFor(kinds, options).map((row) => row.chave);
    if (!keys.length) return { keys: [], rows: [] };
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

  async function saveAllData(kinds, previousRows = null, records = [], options = {}) {
    const supabase = client();
    const scope = resolveScope(options);
    if (!supabase) throw new Error('Supabase indisponível');
    const canEditScope = canEditProject
      ? canEditProject(scope.projectCode)
      : scope.projectCode === activeProject() && canEditActiveProject?.();
    if (!canEditScope) {
      throw new Error(`Sem permissão para persistir dados da obra ${scope.projectCode}`);
    }
    if ((!Array.isArray(kinds) || kinds.some(isGlobalKind)) && !isAdmin?.()) {
      throw new Error('Apenas administradores podem persistir dados globais');
    }
    if (!scope.projectCode) throw new Error('Nenhuma obra informada para persistência');

    const rows = persistenceRowsFor(kinds, scope);
    if (rows.length) {
      const { error } = await supabase
        .from('dashboard_config')
        .upsert(rows, { onConflict: 'chave' });
      if (error) {
        markSyncError(error);
        throw error;
      }
    }
    let datasets;
    try {
      datasets = await dashboardDatasetRepository.saveForUpload(
        kinds,
        scope.dashboardData,
        records,
        scope.projectCode,
      );
      if (persistenceMode === 'snapshots' && !datasets?.available) {
        throw new Error('Snapshots versionados indisponíveis; upload não foi persistido');
      }
    } catch (datasetError) {
      try {
        await restoreDashboardRows(previousRows);
      } catch (restoreError) {
        throw new AggregateError(
          [datasetError, restoreError],
          'Falha ao persistir snapshots e restaurar dashboard_config',
        );
      }
      markSyncError(datasetError);
      throw datasetError;
    }
    markSynced();
    return { rows, datasets };
  }

  async function restoreSavedData(snapshot, persistence) {
    const errors = [];
    try {
      await dashboardDatasetRepository.rollbackSnapshots(persistence?.datasets?.activations || []);
    } catch (error) {
      errors.push(error);
    }
    try {
      await restoreDashboardRows(snapshot);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, 'Rollback da persistência do dashboard falhou');
  }

  async function enforceDatasetRetention(kinds, maxVersions = 12, projectCode = null) {
    return projectCode
      ? dashboardDatasetRepository.enforceRollingRetention?.(kinds, maxVersions, projectCode)
      : dashboardDatasetRepository.enforceRollingRetention?.(kinds, maxVersions);
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
    projectCode = null,
    dashboardData = null,
    applyToCurrentState = true,
  }) {
    const scope = resolveScope({ projectCode, dashboardData });
    return executeTransaction(
      { file, storageType, items, groupId, memorySnapshot },
      {
        captureDashboardRows: (kinds) => captureDashboardRows(kinds, scope),
        uploadFile: (kind, selectedFile) =>
          uploadRepository.uploadFile(kind, selectedFile, scope.projectCode),
        createRecord: (item) =>
          uploadRepository.createRecord(
            item.kind,
            item.fileName,
            item.fileSize,
            item.rows,
            item.storagePath,
            item.groupId,
            scope.projectCode,
          ),
        saveAllData: (kinds, previousRows, records) =>
          saveAllData(kinds, previousRows, records, scope),
        restoreSavedData,
        activateRecord: uploadRepository.activateRecord,
        rollbackActivation: uploadRepository.rollbackActivation,
        restoreDashboardRows,
        markRecordsFailed: uploadRepository.markRecordsFailed,
        removeStoredUpload: uploadRepository.removeStoredUpload,
        deleteRecords: uploadRepository.deleteRecords,
        restoreMemoryState: applyToCurrentState ? restoreMemoryState : () => {},
        setRuntimeState,
        onActive: (activeRecords) => {
          if (applyToCurrentState) {
            const data = getDashboardData();
            activeRecords.forEach((record) => {
              data.latestUploads[record.tipo] = record;
            });
          }
        },
        reportCleanupError,
      },
    );
  }

  return Object.freeze({
    persistenceMode,
    runtimeState,
    captureDashboardRows,
    restoreDashboardRows,
    saveAllData,
    restoreSavedData,
    enforceDatasetRetention,
    setRuntimeState,
    captureMemoryState,
    restoreMemoryState,
    commitPreparedUpload,
  });
}
