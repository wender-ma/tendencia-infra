const PROJECT_CACHE_KEYS = Object.freeze([
  'dados_tendencia',
  'dados_flows',
  'gestao_label',
  'evol_global',
]);

const GLOBAL_CACHE_KEYS = Object.freeze(['dados_flows', 'dados_historico', 'dados_projraw']);

export function buildResetCacheKeys(projectCode, includeGlobal = false) {
  const project = String(projectCode || '').trim();
  if (!project) return [];
  const keys = PROJECT_CACHE_KEYS.map((key) => `${project}:${key}`);
  return includeGlobal ? [...keys, ...GLOBAL_CACHE_KEYS] : keys;
}

export function buildGlobalResetCacheKeys() {
  return [...GLOBAL_CACHE_KEYS];
}

export function createUploadMaintenance({
  dashboardRepository,
  dashboardDatasetRepository,
  uploadRepository,
  getActiveProject,
  getProjectInfo,
  requireEditor,
  requireAdmin,
  requestConfirmation,
  toast,
  clearLocalEvolution = () => {},
  clearLatestUploads = () => {},
  renderUploads = () => {},
  renderSourceHeaders = () => {},
  reload = () => {},
  schedule = (callback, delay) => setTimeout(callback, delay),
  reportError = () => {},
}) {
  async function resetProjectData() {
    if (!requireEditor?.('resetar os dados processados desta obra')) return false;
    const project = String(getActiveProject?.() || '').trim();
    if (!project) {
      toast('Nenhuma obra selecionada', 'err', 3000);
      return false;
    }

    const projectName = getProjectInfo?.(project)?.nome || project;
    const confirmed = await requestConfirmation(
      'Resetar cache da obra',
      `Isto vai apagar do Supabase os dados desta obra (${projectName}):\n\n- Tendência individual\n- Rótulo e evolução da gestão\n\nAs outras obras e os arquivos originais de upload não serão afetados.`,
      { confirmText: 'Resetar cache' },
    );
    if (!confirmed) return false;

    toast('Limpando dados da obra...', 'info', 2000);
    try {
      const datasetReset = await dashboardDatasetRepository?.resetDashboardData();
      const count =
        datasetReset?.available === true
          ? datasetReset.configDeleted + datasetReset.datasetCount
          : await dashboardRepository.deleteDashboardKeys(buildResetCacheKeys(project));
      clearLocalEvolution();
      toast(`Cache limpo (${count} item(ns)). Recarregando...`, 'ok', 2000);
      schedule(reload, 1500);
      return true;
    } catch (error) {
      reportError('Cache/limpar', error);
      if (error?.code === 'DATASET_STORAGE_CLEANUP_PENDING') {
        toast(
          'Os dados foram resetados, mas alguns objetos antigos exigem limpeza administrativa.',
          'warn',
          6000,
        );
        schedule(reload, 2000);
        return true;
      }
      toast('Não foi possível limpar o cache. Tente novamente.', 'err', 5000);
      return false;
    }
  }

  async function resetGlobalData() {
    if (!requireAdmin?.('resetar os dados globais')) return false;
    const confirmed = await requestConfirmation(
      'Resetar dados globais',
      'Isto apaga os dados processados de Flows, Histórico Mensal e Curva S de TODAS as obras. Os arquivos originais permanecem disponíveis no histórico.',
      { confirmText: 'Resetar globais', requireText: 'GLOBAL' },
    );
    if (!confirmed) return false;
    toast('Limpando dados globais...', 'info', 2000);
    try {
      const datasetReset = await dashboardDatasetRepository?.resetGlobalDashboardData();
      const count =
        datasetReset?.available === true
          ? datasetReset.configDeleted + datasetReset.datasetCount
          : await dashboardRepository.deleteDashboardKeys(buildGlobalResetCacheKeys());
      toast(`Dados globais limpos (${count} item(ns)). Recarregando...`, 'ok', 2200);
      schedule(reload, 1500);
      return true;
    } catch (error) {
      reportError('Dados globais/limpar', error);
      if (error?.code === 'DATASET_STORAGE_CLEANUP_PENDING') {
        toast('Dados globais resetados; há objetos antigos pendentes no Storage.', 'warn', 6000);
        schedule(reload, 2000);
        return true;
      }
      toast('Não foi possível limpar os dados globais.', 'err', 5000);
      return false;
    }
  }

  async function clearProjectUploadFiles() {
    if (!requireAdmin?.('apagar os arquivos de Tendência desta obra')) return false;
    const confirmed = await requestConfirmation(
      'Apagar arquivos da obra',
      'Isto apaga o histórico e os arquivos de Tendência da obra selecionada. Os dados já processados do dashboard não serão afetados.',
      { confirmText: 'Apagar tudo', requireText: 'APAGAR' },
    );
    if (!confirmed) return false;

    toast('Apagando histórico...', 'info', 2000);
    try {
      const count = await uploadRepository.clearProjectHistory();
      clearLatestUploads(['tendencia']);
      renderUploads();
      renderSourceHeaders();
      toast(`${count} registro(s) apagado(s)`, 'ok', 3000);
      return true;
    } catch (error) {
      reportError('Uploads/apagar histórico', error);
      toast(
        'Não foi possível apagar o histórico. Os registros foram preservados quando necessário.',
        'err',
        5000,
      );
      return false;
    }
  }

  async function clearGlobalUploadFiles() {
    if (!requireAdmin?.('apagar os arquivos globais')) return false;
    const confirmed = await requestConfirmation(
      'Apagar arquivos globais',
      'Isto apaga o histórico e os arquivos de Flows e Gestões compartilhados entre TODAS as obras. Os dados já processados continuarão no dashboard.',
      { confirmText: 'Apagar globais', requireText: 'GLOBAL' },
    );
    if (!confirmed) return false;
    toast('Apagando arquivos globais...', 'info', 2000);
    try {
      const count = await uploadRepository.clearGlobalHistory();
      clearLatestUploads(['flows', 'gestoes']);
      renderUploads();
      renderSourceHeaders();
      toast(`${count} registro(s) globais apagado(s)`, 'ok', 3000);
      return true;
    } catch (error) {
      reportError('Uploads/apagar histórico global', error);
      toast('Não foi possível apagar o histórico global.', 'err', 5000);
      return false;
    }
  }

  return Object.freeze({
    resetProjectData,
    resetGlobalData,
    clearProjectUploadFiles,
    clearGlobalUploadFiles,
    resetCacheDados: resetProjectData,
    apagarHistoricoUploads: clearProjectUploadFiles,
  });
}
