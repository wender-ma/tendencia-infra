const PROJECT_CACHE_KEYS = Object.freeze([
  'dados_tendencia',
  'dados_flows',
  'gestao_label',
  'evol_global',
]);

const GLOBAL_CACHE_KEYS = Object.freeze(['dados_historico', 'dados_projraw']);

export function buildResetCacheKeys(projectCode, includeGlobal = false) {
  const project = String(projectCode || '').trim();
  if (!project) return [];
  const keys = PROJECT_CACHE_KEYS.map((key) => `${project}:${key}`);
  return includeGlobal ? [...keys, ...GLOBAL_CACHE_KEYS] : keys;
}

export function createUploadMaintenance({
  dashboardRepository,
  uploadRepository,
  getActiveProject,
  getProjectInfo,
  requireEditor,
  requireAdmin,
  isAdmin,
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
  async function resetCacheDados() {
    if (!requireEditor?.('resetar cache')) return false;
    const project = String(getActiveProject?.() || '').trim();
    if (!project) {
      toast('Nenhuma obra selecionada', 'err', 3000);
      return false;
    }

    const projectName = getProjectInfo?.(project)?.nome || project;
    const confirmed = await requestConfirmation(
      'Resetar cache da obra',
      `Isto vai apagar do Supabase os dados desta obra (${projectName}):\n\n- Tendência individual\n- Flows individual\n- Aderência Físico-Financeira\n\nAs outras obras e os arquivos originais no Storage não serão afetados.`,
      { confirmText: 'Resetar cache' },
    );
    if (!confirmed) return false;

    const includeGlobal =
      isAdmin?.() === true &&
      (await requestConfirmation(
        'Apagar também os dados globais?',
        'Histórico e Curva S são compartilhados entre TODAS as obras. Confirmar afeta o dashboard de todas; cancelar mantém os dados globais.',
        { confirmText: 'Apagar globais' },
      ));

    toast('Limpando cache...', 'info', 2000);
    try {
      const count = await dashboardRepository.deleteDashboardKeys(
        buildResetCacheKeys(project, includeGlobal),
      );
      clearLocalEvolution();
      toast(`Cache limpo (${count} chaves). Recarregando...`, 'ok', 2000);
      schedule(reload, 1500);
      return true;
    } catch (error) {
      reportError('Cache/limpar', error);
      toast('Não foi possível limpar o cache. Tente novamente.', 'err', 5000);
      return false;
    }
  }

  async function apagarHistoricoUploads() {
    if (!requireAdmin?.('apagar o histórico de uploads desta obra')) return false;
    const confirmed = await requestConfirmation(
      'Apagar histórico de uploads',
      'Isto vai apagar o histórico de uploads e todos os arquivos armazenados desta obra. Os dados já processados do dashboard não serão afetados.',
      { confirmText: 'Apagar tudo', requireText: 'APAGAR' },
    );
    if (!confirmed) return false;

    toast('Apagando histórico...', 'info', 2000);
    try {
      const count = await uploadRepository.clearProjectHistory();
      clearLatestUploads();
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

  return Object.freeze({ resetCacheDados, apagarHistoricoUploads });
}
