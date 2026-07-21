export const UPLOADS_BUCKET = 'uploads-history';

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

export function createUploadRepository({
  getClient,
  getActiveProject,
  getCurrentUser,
  isEditor,
  isAdmin,
  canManageKind,
  requirePermission,
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

  function assertPermission(kind, description) {
    if (!requirePermission?.(kind, description)) {
      throw new Error('Sem permissão para executar esta operação de upload');
    }
  }

  async function createRecord(kind, fileName, fileSize, rows, storagePath, uploadGroupId) {
    const supabase = assertClient('Supabase indisponível para registrar o upload');
    assertPermission(kind, 'registrar este upload');
    const project = assertProject('Nenhuma obra ativa para registrar o upload');
    const { data, error } = await supabase
      .from('upload_history')
      .insert({
        codigo_obra: project,
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
    const { data: previous, error: readError } = await supabase
      .from('upload_history')
      .select('id')
      .eq('codigo_obra', record.codigo_obra)
      .eq('tipo', record.tipo)
      .eq('is_active', true)
      .neq('id', record.id);
    if (readError) throw readError;

    const previousIds = (previous || []).map((item) => item.id);
    if (previousIds.length) {
      const { error } = await supabase
        .from('upload_history')
        .update({ is_active: false })
        .eq('codigo_obra', record.codigo_obra)
        .eq('tipo', record.tipo)
        .in('id', previousIds);
      if (error) throw error;
    }

    const { data: active, error: activateError } = await supabase
      .from('upload_history')
      .update({ is_active: true, observacao: 'upload_state:active' })
      .eq('codigo_obra', record.codigo_obra)
      .eq('tipo', record.tipo)
      .eq('id', record.id)
      .select()
      .maybeSingle();
    if (activateError || !active) {
      let restoreError = null;
      if (previousIds.length) {
        const restored = await supabase
          .from('upload_history')
          .update({ is_active: true })
          .eq('codigo_obra', record.codigo_obra)
          .eq('tipo', record.tipo)
          .in('id', previousIds);
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
    const { error: deactivateError } = await supabase
      .from('upload_history')
      .update({ is_active: false })
      .eq('codigo_obra', record.codigo_obra)
      .eq('tipo', record.tipo)
      .eq('id', record.id);
    if (deactivateError) throw deactivateError;
    if (activation.previousIds?.length) {
      const { error } = await supabase
        .from('upload_history')
        .update({ is_active: true })
        .eq('codigo_obra', record.codigo_obra)
        .eq('tipo', record.tipo)
        .in('id', activation.previousIds);
      if (error) throw error;
    }
  }

  async function deleteRecords(records) {
    const ids = (records || []).map((record) => record?.id).filter(Boolean);
    if (!ids.length) return;
    const supabase = assertClient('Supabase indisponível para remover registros de upload');
    const project = assertProject('Nenhuma obra ativa para remover registros de upload');
    const { error } = await supabase
      .from('upload_history')
      .delete()
      .eq('codigo_obra', project)
      .in('id', ids);
    if (error) throw error;
  }

  async function markRecordsFailed(records) {
    const ids = (records || []).map((record) => record?.id).filter(Boolean);
    if (!ids.length) return;
    const supabase = assertClient('Supabase indisponível para atualizar registros de upload');
    const project = assertProject('Nenhuma obra ativa para atualizar registros de upload');
    const { error } = await supabase
      .from('upload_history')
      .update({ is_active: false, observacao: 'upload_state:failed' })
      .eq('codigo_obra', project)
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
      .select('id,tipo,storage_path,observacao,enviado_em')
      .eq('codigo_obra', project)
      .in('observacao', ['upload_state:processing', 'upload_state:failed']);
    if (error) throw error;

    const cutoff = Date.now() - maxProcessingAgeMs;
    const stale = (data || []).filter((record) => {
      const isStale =
        record.observacao === 'upload_state:failed' ||
        new Date(record.enviado_em || 0).getTime() < cutoff;
      return canManageKind?.(record.tipo) && isStale;
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
        .eq('codigo_obra', project)
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
      .eq('codigo_obra', project)
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
      .eq('codigo_obra', project);
    if (readError) {
      onMutation(readError, 'Histórico');
      throw readError;
    }

    const projectPrefix = `${safeStorageSegment(project)}/`;
    const paths = new Set();
    for (const record of records || []) {
      if (!record.storage_path) continue;
      const path = sanitizeStoragePath(record.storage_path);
      if (!path || !path.startsWith(projectPrefix)) {
        throw new Error('O histórico contém um caminho de arquivo fora do escopo da obra');
      }
      paths.add(path);
    }

    if (paths.size) {
      const { error: storageError } = await supabase.storage
        .from(UPLOADS_BUCKET)
        .remove([...paths]);
      if (storageError) {
        onMutation(storageError, 'Storage');
        throw new Error(
          'Falha ao remover arquivos do Storage. Os registros foram mantidos por segurança.',
          { cause: storageError },
        );
      }
    }

    const { error: deleteError } = await supabase
      .from('upload_history')
      .delete()
      .eq('codigo_obra', project);
    if (deleteError) {
      onMutation(deleteError, 'Histórico');
      throw deleteError;
    }
    onMutation(null, 'Histórico');
    return (records || []).length;
  }

  async function uploadFile(kind, file) {
    const supabase = assertClient('Storage do Supabase indisponível');
    if (!supabase.storage) throw new Error('Storage do Supabase indisponível');
    assertPermission(kind, 'enviar este arquivo');
    const project = assertProject('Nenhuma obra ativa para armazenar o upload');
    const path = buildUploadStoragePath(project, kind, file.name);
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

  async function listByType(kind, limit = 50, strict = false) {
    const supabase = client();
    const project = activeProject();
    if (!supabase || !project) return [];
    const { data, error } = await supabase
      .from('upload_history')
      .select('*')
      .eq('codigo_obra', project)
      .eq('tipo', kind)
      .order('enviado_em', { ascending: false })
      .limit(limit);
    if (error) {
      if (strict) throw error;
      warn('Uploads/listar histórico', error);
      return [];
    }
    return data || [];
  }

  async function getDownloadUrl(storagePath) {
    const supabase = client();
    const project = activeProject();
    if (!supabase || !getCurrentUser?.() || !project) return null;
    const cleanPath = sanitizeStoragePath(storagePath);
    if (!cleanPath || !cleanPath.startsWith(`${safeStorageSegment(project)}/`)) return null;
    const { data, error } = await supabase.storage
      .from(UPLOADS_BUCKET)
      .createSignedUrl(cleanPath, 60);
    if (error) {
      warn('Uploads/gerar URL assinada', error);
      return null;
    }
    return data?.signedUrl || null;
  }

  async function enforceRollingBackup(kind) {
    const supabase = client();
    if (!supabase || !requirePermission?.(kind, 'gerenciar os backups deste upload')) return;
    const project = assertProject('Nenhuma obra ativa para gerenciar backups');
    const all = await listByType(kind, 100, true);
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
        .eq('codigo_obra', project)
        .eq('storage_path', storagePath);
      if (error) throw error;
      if ((references || []).every((reference) => idSet.has(reference.id))) {
        removablePaths.push(storagePath);
      }
    }

    const { error: databaseError } = await supabase
      .from('upload_history')
      .delete()
      .eq('codigo_obra', project)
      .in('id', ids);
    if (databaseError) throw databaseError;
    if (removablePaths.length) {
      const { error: storageError } = await supabase.storage
        .from(UPLOADS_BUCKET)
        .remove(removablePaths);
      if (storageError) throw storageError;
    }
  }

  async function loadLatestFallback() {
    const map = {};
    const supabase = client();
    const project = activeProject();
    if (!supabase || !project) return map;
    for (const kind of ['tendencia', 'flows', 'gestoes']) {
      const { data } = await supabase
        .from('upload_history')
        .select('*')
        .eq('codigo_obra', project)
        .eq('tipo', kind)
        .eq('is_active', true)
        .order('enviado_em', { ascending: false })
        .limit(1);
      if (data?.[0]) map[kind] = data[0];
    }
    return map;
  }

  async function loadLatest() {
    const supabase = client();
    const project = activeProject();
    if (!supabase || !project) return {};
    try {
      const { data, error } = await retry(() =>
        supabase.from('upload_history_latest').select('*').eq('codigo_obra', project),
      );
      if (error) {
        warn('Uploads/view latest indisponível; usando fallback', error);
        return loadLatestFallback();
      }
      return Object.fromEntries((data || []).map((record) => [record.tipo, record]));
    } catch (error) {
      warn('Uploads/carregar últimos arquivos', error);
      return {};
    }
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
    uploadFile,
    listByType,
    getDownloadUrl,
    enforceRollingBackup,
    loadLatest,
  });
}
