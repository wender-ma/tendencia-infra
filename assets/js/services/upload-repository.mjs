export const UPLOADS_BUCKET = 'uploads-history';
export const GLOBAL_UPLOAD_KINDS = Object.freeze(['flows', 'gestoes', 'excel']);

export function isGlobalUploadKind(kind) {
  return GLOBAL_UPLOAD_KINDS.includes(String(kind || '').trim());
}

export function uploadHistoryScope(kind, projectCode) {
  if (isGlobalUploadKind(kind)) return { codigoObra: null, storageRoot: '_global' };
  const project = String(projectCode || '').trim();
  if (!project) throw new Error('Obra ativa obrigatória para este tipo de upload');
  return { codigoObra: project, storageRoot: project };
}

export function sanitizeStoragePath(path) {
  const value = String(path || '')
    .trim()
    .replace(/^\/+/, '');
  if (
    !value ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    /[\u0000-\u001f\u007f\\]/.test(value) ||
    value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return '';
  }
  return value;
}

function safeStorageSegment(value, fallback = '') {
  return String(value || fallback).replace(/[^\w.-]/g, '_');
}

export function buildUploadStoragePath(projectCode, kind, fileName, date = new Date()) {
  const pad = (number) => String(number).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${safeStorageSegment(projectCode)}/${safeStorageSegment(kind)}/${stamp}_${safeStorageSegment(fileName, 'arquivo.csv')}`;
}

export function buildScopedUploadStoragePath(projectCode, kind, fileName, date = new Date()) {
  const scope = uploadHistoryScope(kind, projectCode);
  return buildUploadStoragePath(scope.storageRoot, kind, fileName, date);
}

export function createUploadRepository({
  getClient,
  getActiveProject,
  getCurrentUser,
  isEditor,
  isAdmin,
  canManageKind,
  requirePermission,
  canEditProject = () => false,
  requireProjectPermission = () => false,
  retry = (operation) => operation(),
  maxPerType = 12,
  onMutation = () => {},
  warn = () => {},
}) {
  const client = () => getClient?.() || null;
  const activeProject = () => String(getActiveProject?.() || '').trim();

  function assertClient(message) {
    const supabase = client();
    if (!supabase) throw new Error(message);
    return supabase;
  }

  function assertProject(message) {
    const project = activeProject();
    if (!project) throw new Error(message);
    return project;
  }

  function assertPermission(kind, description, projectCode = null) {
    const allowed = isGlobalUploadKind(kind)
      ? requirePermission?.(kind, description)
      : requireProjectPermission?.(projectCode || activeProject(), description);
    if (!allowed) {
      throw new Error('Sem permissão para executar esta operação de upload');
    }
  }

  async function createRecord(
    kind,
    fileName,
    fileSize,
    rows,
    storagePath,
    uploadGroupId,
    projectCode = null,
  ) {
    const supabase = assertClient('Supabase indisponível para registrar o upload');
    const project = String(projectCode || activeProject()).trim();
    if (!project) throw new Error('Nenhuma obra informada para registrar o upload');
    assertPermission(kind, 'registrar este upload', project);
    const scope = uploadHistoryScope(kind, project);
    const { data, error } = await supabase
      .from('upload_history')
      .insert({
        codigo_obra: scope.codigoObra,
        tipo: kind,
        nome_arquivo: fileName,
        tamanho_bytes: fileSize || null,
        linhas: rows || null,
        enviado_por: getCurrentUser?.()?.email || null,
        storage_path: sanitizeStoragePath(storagePath) || null,
        upload_group_id: uploadGroupId || null,
        observacao: 'upload_state:processing',
        is_active: false,
      })
      .select()
      .maybeSingle();
    if (error) {
      onMutation(error);
      throw error;
    }
    if (!data) throw new Error('Supabase não retornou o registro do upload');
    onMutation(null);
    return data;
  }

  async function activateRecord(record) {
    if (!record?.id) throw new Error('Registro de upload inválido para ativação');
    const supabase = assertClient('Supabase indisponível para ativar o upload');
    let previousQuery = supabase
      .from('upload_history')
      .select('id')
      .eq('tipo', record.tipo)
      .eq('is_active', true)
      .neq('id', record.id);
    previousQuery = isGlobalUploadKind(record.tipo)
      ? previousQuery
      : previousQuery.eq('codigo_obra', record.codigo_obra);
    const { data: previous, error: readError } = await previousQuery;
    if (readError) throw readError;

    const previousIds = (previous || []).map((item) => item.id);
    if (previousIds.length) {
      let deactivateQuery = supabase
        .from('upload_history')
        .update({ is_active: false })
        .eq('tipo', record.tipo)
        .in('id', previousIds);
      if (!isGlobalUploadKind(record.tipo)) {
        deactivateQuery = deactivateQuery.eq('codigo_obra', record.codigo_obra);
      }
      const { error } = await deactivateQuery;
      if (error) throw error;
    }

    let activateQuery = supabase
      .from('upload_history')
      .update({ is_active: true, observacao: 'upload_state:active' })
      .eq('tipo', record.tipo)
      .eq('id', record.id);
    if (!isGlobalUploadKind(record.tipo)) {
      activateQuery = activateQuery.eq('codigo_obra', record.codigo_obra);
    }
    const { data: active, error: activateError } = await activateQuery.select().maybeSingle();
    if (activateError || !active) {
      let restoreError = null;
      if (previousIds.length) {
        let restoreQuery = supabase
          .from('upload_history')
          .update({ is_active: true })
          .eq('tipo', record.tipo)
          .in('id', previousIds);
        if (!isGlobalUploadKind(record.tipo)) {
          restoreQuery = restoreQuery.eq('codigo_obra', record.codigo_obra);
        }
        const restored = await restoreQuery;
        restoreError = restored.error;
      }
      const failure = activateError || new Error('O novo upload não pôde ser ativado');
      if (restoreError) {
        throw new Error(
          `${failure.message}. O arquivo ativo anterior também não pôde ser restaurado: ${restoreError.message}`,
        );
      }
      throw failure;
    }
    return { active, previousIds };
  }

  async function rollbackActivation(activation) {
    if (!activation?.active?.id) return;
    const supabase = assertClient('Supabase indisponível para reverter o upload');
    const record = activation.active;
    let deactivateQuery = supabase
      .from('upload_history')
      .update({ is_active: false })
      .eq('tipo', record.tipo)
      .eq('id', record.id);
    if (!isGlobalUploadKind(record.tipo)) {
      deactivateQuery = deactivateQuery.eq('codigo_obra', record.codigo_obra);
    }
    const { error: deactivateError } = await deactivateQuery;
    if (deactivateError) throw deactivateError;
    if (activation.previousIds?.length) {
      let restoreQuery = supabase
        .from('upload_history')
        .update({ is_active: true })
        .eq('tipo', record.tipo)
        .in('id', activation.previousIds);
      if (!isGlobalUploadKind(record.tipo)) {
        restoreQuery = restoreQuery.eq('codigo_obra', record.codigo_obra);
      }
      const { error } = await restoreQuery;
      if (error) throw error;
    }
  }

  async function deleteRecords(records) {
    const ids = (records || []).map((record) => record?.id).filter(Boolean);
    if (!ids.length) return;
    const supabase = assertClient('Supabase indisponível para remover registros de upload');
    const { error } = await supabase.from('upload_history').delete().in('id', ids);
    if (error) throw error;
  }

  async function markRecordsFailed(records) {
    const ids = (records || []).map((record) => record?.id).filter(Boolean);
    if (!ids.length) return;
    const supabase = assertClient('Supabase indisponível para atualizar registros de upload');
    const { error } = await supabase
      .from('upload_history')
      .update({ is_active: false, observacao: 'upload_state:failed' })
      .in('id', ids);
    if (error) throw error;
  }

  async function removeStoredUpload(storagePath) {
    const cleanPath = sanitizeStoragePath(storagePath);
    if (!cleanPath) return;
    const supabase = assertClient('Storage do Supabase indisponível');
    const { error } = await supabase.storage.from(UPLOADS_BUCKET).remove([cleanPath]);
    if (error) throw error;
  }

  async function cleanupIncompleteUploads(maxProcessingAgeMs = 60 * 60 * 1000) {
    const supabase = client();
    const project = activeProject();
    if (!supabase || !getCurrentUser?.() || !project || !isEditor?.()) return 0;
    const { data, error } = await supabase
      .from('upload_history')
      .select('id,codigo_obra,tipo,storage_path,observacao,enviado_em')
      .in('observacao', ['upload_state:processing', 'upload_state:failed']);
    if (error) throw error;

    const cutoff = Date.now() - maxProcessingAgeMs;
    const stale = (data || []).filter((record) => {
      const isStale =
        record.observacao === 'upload_state:failed' ||
        new Date(record.enviado_em || 0).getTime() < cutoff;
      const belongsToScope =
        isGlobalUploadKind(record.tipo) || String(record.codigo_obra || '') === project;
      return belongsToScope && canManageKind?.(record.tipo) && isStale;
    });
    if (!stale.length) return 0;

    const staleIds = new Set(stale.map((record) => record.id));
    const removablePaths = [];
    const paths = new Set(
      stale.map((record) => sanitizeStoragePath(record.storage_path)).filter(Boolean),
    );
    for (const storagePath of paths) {
      const { data: references, error: referenceError } = await supabase
        .from('upload_history')
        .select('id')
        .eq('storage_path', storagePath);
      if (referenceError) throw referenceError;
      if ((references || []).every((reference) => staleIds.has(reference.id))) {
        removablePaths.push(storagePath);
      }
    }

    if (removablePaths.length) {
      const { error: storageError } = await supabase.storage
        .from(UPLOADS_BUCKET)
        .remove(removablePaths);
      if (storageError) throw storageError;
    }
    const { error: deleteError } = await supabase
      .from('upload_history')
      .delete()
      .in('id', [...staleIds]);
    if (deleteError) throw deleteError;
    return stale.length;
  }

  async function clearProjectHistory() {
    if (!isAdmin?.()) throw new Error('Apenas administradores podem apagar o histórico de uploads');
    const supabase = assertClient('Supabase indisponível para apagar o histórico de uploads');
    const project = assertProject('Nenhuma obra ativa para apagar o histórico de uploads');
    const { data: records, error: readError } = await supabase
      .from('upload_history')
      .select('id,storage_path')
      .eq('codigo_obra', project)
      .eq('tipo', 'tendencia');
    if (readError) {
      onMutation(readError, 'Histórico');
      throw readError;
    }
    const projectPrefix = `${safeStorageSegment(project)}/`;
    for (const record of records || []) {
      const path = sanitizeStoragePath(record.storage_path);
      if (
        path &&
        !path.startsWith(`${projectPrefix}tendencia/`) &&
        !path.startsWith(`${projectPrefix}excel/`) &&
        !path.startsWith('_global/excel/')
      ) {
        throw new Error('O histórico contém um caminho de arquivo fora do escopo da obra');
      }
    }

    const { error: deleteError } = await supabase
      .from('upload_history')
      .delete()
      .eq('codigo_obra', project)
      .eq('tipo', 'tendencia');
    if (deleteError) {
      onMutation(deleteError, 'Histórico');
      throw deleteError;
    }
    const paths = await findUnreferencedPaths(records);
    if (paths.length) {
      const { error: storageError } = await supabase.storage.from(UPLOADS_BUCKET).remove(paths);
      if (storageError) warn('Uploads/limpar arquivos sem referência da obra', storageError);
    }
    onMutation(null, 'Histórico da obra');
    return (records || []).length;
  }

  async function clearGlobalHistory() {
    if (!isAdmin?.()) throw new Error('Apenas administradores podem apagar o histórico global');
    const supabase = assertClient('Supabase indisponível para apagar o histórico global');
    const { data: records, error: readError } = await supabase
      .from('upload_history')
      .select('id,storage_path')
      .in('tipo', ['flows', 'gestoes']);
    if (readError) throw readError;
    const ids = (records || []).map((record) => record.id);
    if (ids.length) {
      const { error } = await supabase.from('upload_history').delete().in('id', ids);
      if (error) throw error;
    }
    const paths = await findUnreferencedPaths(records);
    if (paths.length) {
      const { error: storageError } = await supabase.storage.from(UPLOADS_BUCKET).remove(paths);
      if (storageError) warn('Uploads/limpar arquivos globais sem referência', storageError);
    }
    onMutation(null, 'Histórico global');
    return ids.length;
  }

  async function findUnreferencedPaths(records) {
    const supabase = assertClient('Supabase indisponível para verificar arquivos');
    const paths = new Set(
      (records || []).map((record) => sanitizeStoragePath(record.storage_path)).filter(Boolean),
    );
    const removable = [];
    for (const path of paths) {
      const { data, error } = await supabase
        .from('upload_history')
        .select('id')
        .eq('storage_path', path)
        .limit(1);
      if (error) throw error;
      if (!data?.length) removable.push(path);
    }
    return removable;
  }

  async function uploadFile(kind, file, projectCode = null) {
    const supabase = assertClient('Storage do Supabase indisponível');
    if (!supabase.storage) throw new Error('Storage do Supabase indisponível');
    const project = String(projectCode || activeProject()).trim();
    if (!project) throw new Error('Nenhuma obra informada para armazenar o upload');
    assertPermission(kind, 'enviar este arquivo', project);
    const path = buildScopedUploadStoragePath(project, kind, file.name);
    const { error } = await supabase.storage.from(UPLOADS_BUCKET).upload(path, file, {
      contentType: file.type || 'text/csv',
      upsert: false,
    });
    if (error) {
      onMutation(error, 'Storage');
      throw error;
    }
    return path;
  }

  async function listByType(kind, limit = 50, strict = false, projectCode = null) {
    const supabase = client();
    const project = String(projectCode || activeProject()).trim();
    if (!supabase || !getCurrentUser?.() || !project) return [];
    let query = supabase
      .from('upload_history')
      .select('*')
      .eq('tipo', kind)
      .order('enviado_em', { ascending: false })
      .limit(limit);
    if (!isGlobalUploadKind(kind)) query = query.eq('codigo_obra', project);
    const { data, error } = await query;
    if (error) {
      if (strict) throw error;
      warn('Uploads/listar histórico', error);
      return [];
    }
    return data || [];
  }

  async function getDownloadUrl(storagePath, projectCode = null) {
    const supabase = client();
    const project = String(projectCode || activeProject()).trim();
    if (!supabase || !getCurrentUser?.() || !project) return null;
    const cleanPath = sanitizeStoragePath(storagePath);
    if (!cleanPath) return null;
    const [root, kind] = cleanPath.split('/');
    const isGlobalPath =
      root === '_global' ||
      isGlobalUploadKind(kind) ||
      ['flows', 'gestoes', 'excel'].includes(kind);
    const canRead =
      (isGlobalPath && isAdmin?.()) ||
      (!isGlobalPath &&
        root === safeStorageSegment(project) &&
        (canEditProject?.(project) || isAdmin?.()));
    if (!canRead) return null;
    const { data, error } = await supabase.storage
      .from(UPLOADS_BUCKET)
      .createSignedUrl(cleanPath, 60);
    if (error) {
      warn('Uploads/gerar URL assinada', error);
      return null;
    }
    return data?.signedUrl || null;
  }

  async function enforceRollingBackup(kind, projectCode = null) {
    const supabase = client();
    const project = String(projectCode || activeProject()).trim();
    if (!supabase || !project) return;
    assertPermission(kind, 'gerenciar os backups deste upload', project);
    const all = await listByType(kind, 100, true, project);
    if (all.length <= maxPerType) return;
    const toDelete = all.slice(maxPerType).filter((record) => !record.is_active);
    if (!toDelete.length) return;

    const ids = toDelete.map((record) => record.id);
    const idSet = new Set(ids);
    const removablePaths = [];
    const candidatePaths = new Set(
      toDelete.map((record) => sanitizeStoragePath(record.storage_path)).filter(Boolean),
    );
    for (const storagePath of candidatePaths) {
      const { data: references, error } = await supabase
        .from('upload_history')
        .select('id')
        .eq('storage_path', storagePath);
      if (error) throw error;
      if ((references || []).every((reference) => idSet.has(reference.id))) {
        removablePaths.push(storagePath);
      }
    }

    const { error: databaseError } = await supabase.from('upload_history').delete().in('id', ids);
    if (databaseError) throw databaseError;
    if (removablePaths.length) {
      const { error: storageError } = await supabase.storage
        .from(UPLOADS_BUCKET)
        .remove(removablePaths);
      if (storageError) throw storageError;
    }
  }

  async function loadLatest() {
    const supabase = client();
    const project = activeProject();
    if (!supabase || !getCurrentUser?.() || !project) return {};
    const result = {};
    for (const kind of ['tendencia', 'cronograma_fisico', 'flows', 'gestoes']) {
      let query = supabase
        .from('upload_history')
        .select('*')
        .eq('tipo', kind)
        .eq('is_active', true)
        .order('enviado_em', { ascending: false })
        .limit(1);
      if (!isGlobalUploadKind(kind)) query = query.eq('codigo_obra', project);
      try {
        const { data, error } = await retry(() => query);
        if (error) throw error;
        if (data?.[0]) result[kind] = data[0];
      } catch (error) {
        warn(`Uploads/carregar último/${kind}`, error);
      }
    }
    return result;
  }

  async function loadLatestTendencies(projectCodes = []) {
    return loadLatestProjectUploads(projectCodes, 'tendencia');
  }

  async function loadLatestProjectUploads(projectCodes = [], kind = 'tendencia') {
    const supabase = client();
    const projects = [
      ...new Set(projectCodes.map((code) => String(code || '').trim()).filter(Boolean)),
    ];
    if (!supabase || !getCurrentUser?.() || !projects.length) return {};
    const { data, error } = await supabase
      .from('upload_history')
      .select('*')
      .eq('tipo', kind)
      .eq('is_active', true)
      .in('codigo_obra', projects)
      .order('enviado_em', { ascending: false });
    if (error) {
      warn(`Uploads/carregar ${kind} por obra`, error);
      return {};
    }
    const latest = {};
    for (const record of data || []) {
      if (record.codigo_obra && !latest[record.codigo_obra]) {
        latest[record.codigo_obra] = record;
      }
    }
    return latest;
  }

  async function listExcelGroups(limit = 30) {
    const supabase = client();
    if (!supabase || !getCurrentUser?.() || !isAdmin?.()) return [];
    const { data, error } = await supabase
      .from('upload_history')
      .select('*')
      .not('upload_group_id', 'is', null)
      .order('enviado_em', { ascending: false })
      .limit(Math.max(limit * 3, limit));
    if (error) {
      warn('Uploads/listar planilhas completas', error);
      return [];
    }
    const groups = new Map();
    for (const record of data || []) {
      const group = groups.get(record.upload_group_id) || {
        id: record.upload_group_id,
        nome_arquivo: record.nome_arquivo,
        tamanho_bytes: record.tamanho_bytes,
        enviado_por: record.enviado_por,
        enviado_em: record.enviado_em,
        storage_path: record.storage_path,
        records: [],
      };
      group.records.push(record);
      groups.set(record.upload_group_id, group);
    }
    return [...groups.values()].slice(0, limit);
  }

  return Object.freeze({
    bucket: UPLOADS_BUCKET,
    maxPerType,
    sanitizeStoragePath,
    createRecord,
    activateRecord,
    rollbackActivation,
    deleteRecords,
    markRecordsFailed,
    removeStoredUpload,
    cleanupIncompleteUploads,
    clearProjectHistory,
    clearGlobalHistory,
    uploadFile,
    listByType,
    listExcelGroups,
    getDownloadUrl,
    enforceRollingBackup,
    loadLatest,
    loadLatestTendencies,
    loadLatestProjectUploads,
  });
}
