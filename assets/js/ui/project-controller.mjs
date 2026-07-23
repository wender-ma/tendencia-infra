const EMPTY_HISTORY = () => ({ gestoes: [], items: [], totals: {} });
const EMPTY_EVOLUTION = () => ({ teorica: null, financeira: null });

export function resolveInitialProject(
  projects,
  { search = '', storedProject = '', defaultProject = '42-21O' } = {},
) {
  const catalog = Array.isArray(projects) ? projects : [];
  let urlProject = '';
  try {
    urlProject = new URLSearchParams(search).get('obra') || '';
  } catch {
    urlProject = '';
  }
  if (urlProject && catalog.some((project) => project.codigo_obra === urlProject)) {
    return urlProject;
  }
  if (storedProject && catalog.some((project) => project.codigo_obra === storedProject)) {
    return storedProject;
  }
  return catalog.find((project) => project.ativa)?.codigo_obra || defaultProject;
}

export function findLatestManagement(managements) {
  if (!Array.isArray(managements)) return null;
  const dated = managements
    .map((label) => {
      const match = String(label).match(/GEST[ÃA]O\s+(\d{2})-(\d{4})/i);
      if (!match) return null;
      return { label, value: Number(match[2]) * 100 + Number(match[1]) };
    })
    .filter(Boolean)
    .sort((left, right) => right.value - left.value);
  return dated[0]?.label || null;
}

export function applyHistoryManagementFallback(tendency, history, projectCode) {
  if (!Array.isArray(tendency) || !tendency.length || !history?.items?.length) {
    return { applied: 0, management: null };
  }
  const leaves = tendency.filter((item) => item.is_folha);
  if (leaves.some((item) => item.gestao != null && item.gestao !== 0)) {
    return { applied: 0, management: null };
  }
  const management = findLatestManagement(history.gestoes);
  if (!management) return { applied: 0, management: null };

  const values = new Map();
  history.items
    .filter((item) => item.codigo_obra === projectCode && item.insumo)
    .forEach((item) => {
      const key = `${item.servico || ''}|${item.insumo || ''}|${item.item_cod || ''}`;
      values.set(key, (values.get(key) || 0) + (item[management] || 0));
    });

  let applied = 0;
  for (const item of tendency) {
    if (!item.is_folha || !item.cod_insumo) continue;
    const key = `${item.cod_servico || ''}|${item.cod_insumo || ''}|${item.cod || ''}`;
    const value = values.get(key);
    if (value == null || value === 0) continue;
    item.gestao = value;
    item.diferenca = item.licitacao != null ? item.licitacao - value : null;
    applied += 1;
  }
  return { applied, management };
}

export function createProjectController({
  state,
  projectRepository,
  dashboardRepository,
  dashboardDatasetRepository = { loadForDashboard: async () => ({}) },
  uploadRepository,
  storage,
  storageKeys,
  defaultProject = '42-21O',
  documentRef = document,
  windowRef = window,
  hasBackend = () => true,
  getUploadRuntimeState = () => ({}),
  updateAuthUi = () => {},
  showLoading = () => {},
  hideLoading = () => {},
  toast = () => {},
  renderAll = () => {},
  applyManuals = () => {},
  loadClassifications = () => {},
  buildInputList = () => [],
  setInputOptions = () => {},
  buildDatalist = () => {},
  loadProjectionControl = () => {},
  getProjectionControlState = () => null,
  applyProjectionLocks = () => {},
  formatValue = (value) => String(value ?? ''),
  reportError = () => {},
  log = () => {},
}) {
  const keyForProject = (key, project = state.obra.ativa) => (project ? `${project}:${key}` : key);
  const getProjectInfo = (code = state.obra.ativa) =>
    state.obra.obras.find((project) => project.codigo_obra === code) || null;

  function resolverObraInicial() {
    return resolveInitialProject(state.obra.obras, {
      search: windowRef.location?.search || '',
      storedProject: storage.get(storageKeys.activeProject, ''),
      defaultProject,
    });
  }

  async function carregarObras() {
    state.obra.obras = await projectRepository.listProjects();
    log(`[OBRAS] ${state.obra.obras.length} obra(s) carregada(s)`);
    return state.obra.obras;
  }

  function renderObrasDropdown() {
    const selector = documentRef.getElementById('obraSelector');
    if (selector) {
      selector.replaceChildren();
      const activeProjects = state.obra.obras.filter((project) => project.ativa);
      if (!activeProjects.length) {
        selector.append(new windowRef.Option('Nenhuma obra cadastrada', ''));
        selector.disabled = true;
      } else {
        for (const project of activeProjects) {
          const option = new windowRef.Option(project.nome, project.codigo_obra);
          option.selected = project.codigo_obra === state.obra.ativa;
          selector.append(option);
        }
        selector.disabled = false;
      }
    }
    const title = documentRef.getElementById('obraNomeGrande');
    if (title) title.textContent = getProjectInfo()?.nome || 'Nenhuma obra selecionada';
  }

  function resetDadosObra() {
    state.dados.tendencia = [];
    state.dados.flows = [];
    state.config.evolGlobal = EMPTY_EVOLUTION();
    state.config.gestaoLabel = 'Gestão Atual';
  }

  function resetSharedData() {
    state.dados.historico = EMPTY_HISTORY();
    state.dados.projRaw = [];
    for (const kind of Object.keys(state.uploads)) state.uploads[kind] = null;
  }

  function aplicarCacheLocal(classifications, manuals, projectionConfig, movements) {
    if (classifications) storage.set(storageKeys.classifications, JSON.stringify(classifications));
    else storage.remove(storageKeys.classifications);
    if (manuals) storage.set(storageKeys.manuals, JSON.stringify(manuals));
    else storage.remove(storageKeys.manuals);
    storage.set(
      storageKeys.projectionControl,
      JSON.stringify({
        insumo: projectionConfig?.insumo_controlado || 'I011890',
        saldo_inicial: projectionConfig?.saldo_inicial ?? null,
        data_ref: projectionConfig?.data_ref || null,
        movimentacoes: movements || [],
        locks: {
          saldo: Boolean(projectionConfig?.locked_saldo),
          data: Boolean(projectionConfig?.locked_data),
          insumo: Boolean(projectionConfig?.locked_insumo),
        },
      }),
    );
  }

  function parseConfig(config, key, fallback, context, userMessage) {
    if (!config[key]) return fallback;
    try {
      return JSON.parse(config[key]);
    } catch (error) {
      reportError(context, error, userMessage);
      return fallback;
    }
  }

  function atualizarGestaoLabelPelaHistoria() {
    const latest = findLatestManagement(state.dados.historico?.gestoes);
    if (latest) state.config.gestaoLabel = latest;
    return latest;
  }

  function aplicarFallbackGestaoDoHistorico() {
    const result = applyHistoryManagementFallback(
      state.dados.tendencia,
      state.dados.historico,
      state.obra.ativa,
    );
    if (result.applied) {
      log(
        `[TEND] coluna Gestão vazia: ${result.applied} folha(s) preenchida(s) com ${result.management}.`,
      );
    }
    return result.applied;
  }

  function aplicarDadosPersistidos(config) {
    if (!config) return;
    if (config.header_title) storage.set(storageKeys.header, config.header_title);
    if (config.indice_correcao) {
      state.config.correcaoIndice = config.indice_correcao;
      storage.set(storageKeys.correctionIndex, config.indice_correcao);
    }
    if (config.card3_modo) {
      state.config.card3Modo = config.card3_modo;
      storage.set(storageKeys.cardMode, config.card3_modo);
    }

    const prefix = `${state.obra.ativa}:`;
    const evolution = parseConfig(
      config,
      `${prefix}evol_global`,
      EMPTY_EVOLUTION(),
      'Dados/evolução global inválida',
      'A evolução salva está inválida e não pôde ser carregada.',
    );
    if (evolution) state.config.evolGlobal = evolution;
    if (config[`${prefix}gestao_label`]) {
      state.config.gestaoLabel = config[`${prefix}gestao_label`];
    }

    const tendency = parseConfig(
      config,
      `${prefix}dados_tendencia`,
      [],
      'Dados/tendência inválida',
      'Os dados salvos de Tendência estão inválidos.',
    );
    state.dados.tendencia = Array.isArray(tendency) ? tendency : [];

    const flowsKey = config.dados_flows ? 'dados_flows' : `${prefix}dados_flows`;
    const flows = parseConfig(
      config,
      flowsKey,
      [],
      'Dados/Flows inválido',
      'Os dados salvos de Flows estão inválidos.',
    );
    state.dados.flows = Array.isArray(flows) ? flows : [];

    const history = parseConfig(
      config,
      'dados_historico',
      EMPTY_HISTORY(),
      'Dados/histórico inválido',
      'O histórico salvo está inválido.',
    );
    state.dados.historico = history?.items ? history : EMPTY_HISTORY();
    atualizarGestaoLabelPelaHistoria();
    aplicarFallbackGestaoDoHistorico();

    const projection = parseConfig(
      config,
      'dados_projraw',
      [],
      'Dados/projeção inválida',
      'A projeção salva está inválida.',
    );
    state.dados.projRaw = Array.isArray(projection) ? projection : [];
  }

  function aplicarDatasetsVersionados(datasets) {
    if (!datasets) return;
    if (Array.isArray(datasets.tendency)) state.dados.tendencia = datasets.tendency;
    if (Array.isArray(datasets.flows)) state.dados.flows = datasets.flows;
    if (datasets.history?.items) state.dados.historico = datasets.history;
    if (Array.isArray(datasets.projectionRaw)) state.dados.projRaw = datasets.projectionRaw;
    atualizarGestaoLabelPelaHistoria();
    aplicarFallbackGestaoDoHistorico();
  }

  function posCarregarDados() {
    try {
      applyManuals();
    } catch (error) {
      reportError('Obras/aplicar manuais', error);
    }
    try {
      loadClassifications();
    } catch (error) {
      reportError('Obras/carregar classificações', error);
    }
    try {
      setInputOptions(buildInputList());
      buildDatalist();
    } catch (error) {
      reportError('Obras/reconstruir insumos', error);
    }
    try {
      loadProjectionControl();
      const projectionState = getProjectionControlState();
      const balance = documentRef.getElementById('projCtrlSaldoInicial');
      const referenceDate = documentRef.getElementById('projCtrlDataRef');
      const input = documentRef.getElementById('projCtrlInsumo');
      if (balance) {
        balance.value =
          projectionState?.saldo_inicial != null ? formatValue(projectionState.saldo_inicial) : '';
      }
      if (referenceDate) referenceDate.value = projectionState?.data_ref || '';
      if (input) input.value = projectionState?.insumo || 'I011890';
      applyProjectionLocks();
    } catch (error) {
      reportError('Projeção/restaurar controles', error);
    }
  }

  async function recarregarDadosDaObra() {
    if (!hasBackend() || !state.obra.ativa) return false;
    resetDadosObra();
    const [
      classifications,
      manuals,
      projectionConfig,
      movements,
      config,
      datasets,
      latestUploads,
    ] = await Promise.all([
        dashboardRepository.loadClassifications(),
        dashboardRepository.loadManuals(),
        dashboardRepository.loadProjectionConfig(),
        dashboardRepository.loadMovements(),
        dashboardRepository.loadDashboardConfig(),
        dashboardDatasetRepository.loadForDashboard(),
        uploadRepository.loadLatest(),
      ]);
    aplicarCacheLocal(classifications, manuals, projectionConfig, movements);
    aplicarDadosPersistidos(config);
    aplicarDatasetsVersionados(datasets);
    for (const kind of Object.keys(state.uploads)) state.uploads[kind] = null;
    Object.assign(state.uploads, latestUploads || {});
    posCarregarDados();
    return true;
  }

  async function trocarObra(newCode) {
    const code = String(newCode || '').trim();
    if (!code || code === state.obra.ativa) return false;
    if (!state.obra.obras.some((project) => project.codigo_obra === code && project.ativa)) {
      toast('A obra selecionada não está disponível.', 'err', 3500);
      renderObrasDropdown();
      return false;
    }
    if (Object.values(getUploadRuntimeState()).some((upload) => upload.status === 'processing')) {
      toast('Aguarde o upload terminar antes de trocar de obra.', 'warn', 4000);
      renderObrasDropdown();
      return false;
    }

    showLoading();
    state.obra.ativa = code;
    updateAuthUi();
    storage.set(storageKeys.activeProject, code);
    try {
      const url = new URL(windowRef.location.href);
      url.searchParams.set('obra', code);
      windowRef.history.replaceState({}, '', url);
    } catch (error) {
      reportError('Obras/atualizar URL', error);
    }
    resetDadosObra();
    resetSharedData();
    renderObrasDropdown();
    toast(`Carregando dados de ${getProjectInfo()?.nome || code}...`, 'info', 2500);
    try {
      await recarregarDadosDaObra();
      renderAll();
      toast(`Obra ativa: ${getProjectInfo()?.nome || code}`, 'ok', 2500);
      return true;
    } catch (error) {
      reportError('Obras/trocar', error);
      toast('Não foi possível carregar a obra selecionada.', 'err', 5000);
      return false;
    } finally {
      hideLoading();
    }
  }

  return Object.freeze({
    keyForProject,
    getProjectInfo,
    resolverObraInicial,
    carregarObras,
    renderObrasDropdown,
    trocarObra,
    findLatestManagement,
    atualizarGestaoLabelPelaHistoria,
    aplicarFallbackGestaoDoHistorico,
    recarregarDadosDaObra,
    resetDadosObra,
    aplicarCacheLocal,
    aplicarDadosPersistidos,
    aplicarDatasetsVersionados,
    posCarregarDados,
  });
}

export function createProjectActions(controller) {
  return Object.freeze({ trocarObra: controller.trocarObra });
}
