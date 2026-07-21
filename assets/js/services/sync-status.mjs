export function createSyncStatusService({
  isOnline = () => false,
  getBadge = () => document.getElementById('supaBadge'),
  now = () => new Date(),
} = {}) {
  const status = {
    pending: 0,
    batchError: null,
    lastError: null,
    lastSync: null,
  };

  function snapshot() {
    return Object.freeze({
      state: !isOnline()
        ? 'offline'
        : status.pending > 0
          ? 'saving'
          : status.lastError
            ? 'error'
            : status.lastSync
              ? 'synced'
              : 'connected',
      pending: status.pending,
      lastSync: status.lastSync?.toISOString() || null,
      hasError: Boolean(status.lastError),
    });
  }

  function render() {
    const badge = getBadge();
    if (!badge) return;
    const current = snapshot();
    badge.dataset.syncState = current.state;
    badge.setAttribute('aria-busy', String(current.state === 'saving'));

    if (current.state === 'offline') {
      badge.textContent = '🔴 Offline';
      badge.title = 'Não conectado ao Supabase - dados só ficam salvos aqui';
    } else if (current.state === 'saving') {
      badge.textContent =
        current.pending > 1 ? `↻ Salvando ${current.pending} alterações...` : '↻ Salvando...';
      badge.title = 'Sincronização em andamento. Aguarde antes de fechar a página.';
    } else if (current.state === 'error') {
      badge.textContent = '⚠️ Falha ao salvar';
      badge.title = 'A última sincronização falhou. Tente novamente ou confira a conexão.';
    } else if (current.state === 'synced') {
      badge.textContent = '☁️ Sincronizado';
      badge.title = `Última sincronização: ${status.lastSync.toLocaleTimeString('pt-BR')}`;
    } else {
      badge.textContent = '🔗 Conectado';
      badge.title = 'Conectado ao Supabase (ainda sem sincronização recente)';
    }
  }

  function begin() {
    if (status.pending === 0) status.batchError = null;
    status.pending += 1;
    render();
  }

  function finish(error = null) {
    if (error) status.batchError = error;
    status.pending = Math.max(0, status.pending - 1);
    if (status.pending === 0) {
      if (status.batchError) {
        status.lastError = status.batchError.message || String(status.batchError);
      } else {
        status.lastError = null;
        status.lastSync = now();
      }
      status.batchError = null;
    }
    render();
  }

  function markError(error) {
    status.lastError = error?.message || String(error || 'Falha de sincronização');
    render();
  }

  function markSynced() {
    status.lastError = null;
    status.lastSync = now();
    render();
  }

  function recordMutation(error = null, context = '') {
    if (error) {
      markError(`${context ? `${context}: ` : ''}${error.message || error}`);
    } else {
      markSynced();
    }
  }

  return Object.freeze({ begin, finish, markError, markSynced, recordMutation, render, snapshot });
}

export function installLegacySyncStatus(service, target = window) {
  Object.assign(target, {
    beginSupaOperation: service.begin,
    finishSupaOperation: service.finish,
    getDashboardSyncStatus: service.snapshot,
    handleUploadRepositoryMutation: service.recordMutation,
    markDashboardSyncError: service.markError,
    markDashboardSynced: service.markSynced,
    updateSupaBadge: service.render,
  });
}
