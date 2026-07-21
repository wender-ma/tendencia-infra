// ============================================================================
// FUNÇÕES UTILITÁRIAS UNIFICADAS
// ============================================================================

// Debounce genérico — evita execuções múltiplas em sequência rápida
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function reportNonFatalError(context, error, userMessage) {
  if (window.dashboardLogger) window.dashboardLogger.warn(context, error);
  else console.warn(`[${context}]`, error?.message || error);
  if (userMessage && typeof authToast === 'function') {
    authToast(`⚠️ ${userMessage}`, 'warn', CONFIG.toast_duration_warn);
  }
}

function runAsyncSafely(operation, context, userMessage) {
  beginSupaOperation();
  return Promise.resolve(operation)
    .then(result => {
      finishSupaOperation();
      return result;
    })
    .catch(error => {
      finishSupaOperation(error);
      reportNonFatalError(context, error, userMessage);
      return null;
    });
}

// SafeStorage — wrapper seguro para localStorage com tratamento de erros
const SafeStorage = {
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch(e) {
      console.warn(`[Storage] Falha ao salvar ${key}:`, e.message);
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        if (typeof authToast === 'function') {
          authToast('⚠️ Armazenamento local cheio. Algumas configurações não serão salvas.', 'warn', 5000);
        }
      }
      return false;
    }
  },
  get(key, fallback) {
    try {
      const val = localStorage.getItem(key);
      return val !== null ? val : fallback;
    } catch(e) {
      console.warn(`[Storage] Falha ao ler ${key}:`, e.message);
      return fallback;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch(e) {
      console.warn(`[Storage] Falha ao remover ${key}:`, e.message);
      return false;
    }
  }
};

// uiCriarKpi — fábrica de componentes KPI reutilizável
function uiCriarKpi({ titulo, valor, subtitulo, cor, icon }) {
  const cls = cor ? `kpi ${cor}` : 'kpi';
  const iconPrefix = icon ? `${icon} ` : '';
  let html = `<div class="${cls}"><div class="label">${iconPrefix}${escHtml(titulo)}</div><div class="value">${escHtml(valor)}</div>`;
  if (subtitulo) html += `<div class="sub">${escHtml(subtitulo)}</div>`;
  html += '</div>';
  return html;
}

// Resolve CSS variables para cores reais (ApexCharts não entende var(--x))
function resolveColor(cssVar) {
  if (!cssVar || !cssVar.startsWith('var(')) return cssVar;
  const varName = cssVar.replace('var(', '').replace(')', '').trim();
  const themeRoot = document.body || document.documentElement;
  return getComputedStyle(themeRoot).getPropertyValue(varName).trim() || cssVar;
}

// Instâncias ApexCharts ativas (para destruir antes de re-renderizar)
const _apexCharts = {};
const _apexRenderVersions = {};

// Helper para criar/atualizar gráfico ApexCharts de forma segura
async function renderApexChart(containerId, options) {
  const renderVersion = (_apexRenderVersions[containerId] || 0) + 1;
  _apexRenderVersions[containerId] = renderVersion;
  // Destruir instância anterior se existir
  if (_apexCharts[containerId]) {
    try { _apexCharts[containerId].destroy(); } catch(e) { reportNonFatalError('ApexCharts/destroy', e); }
    delete _apexCharts[containerId];
  }
  const el = document.querySelector('#' + containerId);
  if (!el) return null;
  el.replaceChildren();
  try {
    await ensureApexCharts();
    if (_apexRenderVersions[containerId] !== renderVersion || !el.isConnected) return null;
    const chart = new ApexCharts(el, options);
    chart.render();
    _apexCharts[containerId] = chart;
    return chart;
  } catch(e) {
    console.warn('[ApexCharts] erro ao renderizar', containerId, e);
    return null;
  }
}

// Função unificada de filtragem por obra ativa (substitui getHistoricoObraAtiva, getProjRawObraAtiva, getFlowsObraAtiva)
function filtrarPorObraAtiva(arr, campo = 'codigo_obra') {
  if (!Array.isArray(arr) || !OBRA_ATIVA) return arr;
  return arr.filter(item => item[campo] === OBRA_ATIVA);
}

// Aliases para compatibilidade
function getHistoricoObraAtiva() {
  if (!HISTORICO || !HISTORICO.items) return { items: [], gestoes: [], totals: {} };
  if (!OBRA_ATIVA) return HISTORICO;
  const items = filtrarPorObraAtiva(HISTORICO.items);
  const totals = (HISTORICO.totals && HISTORICO.totals[OBRA_ATIVA]) || {};
  return { items, gestoes: HISTORICO.gestoes || [], totals };
}

function getProjRawObraAtiva() {
  return filtrarPorObraAtiva(PROJ_RAW);
}

function getFlowsObraAtiva() {
  return filtrarPorObraAtiva(DATA_F);
}

// ============================================================================
// SUPA — Camada de persistência híbrida
// (Supabase = fonte da verdade compartilhada + localStorage como cache/fallback)
// ============================================================================

// Status global de conexão (pra UI mostrar "salvo" / "offline")
const SUPA_STATUS = {
  online: !!SUPA,
  lastSync: null,
  lastError: null,
  pending: 0,
  batchError: null,
};

function beginSupaOperation() {
  if (SUPA_STATUS.pending === 0) SUPA_STATUS.batchError = null;
  SUPA_STATUS.pending += 1;
  updateSupaBadge();
}

function finishSupaOperation(error = null) {
  if (error) SUPA_STATUS.batchError = error;
  SUPA_STATUS.pending = Math.max(0, SUPA_STATUS.pending - 1);
  if (SUPA_STATUS.pending === 0) {
    if (SUPA_STATUS.batchError) {
      SUPA_STATUS.lastError = SUPA_STATUS.batchError.message || String(SUPA_STATUS.batchError);
    } else {
      SUPA_STATUS.lastError = null;
      SUPA_STATUS.lastSync = new Date();
    }
    SUPA_STATUS.batchError = null;
  }
  updateSupaBadge();
}

function handleUploadRepositoryMutation(error = null, context = '') {
  if (error) {
    SUPA_STATUS.lastError = `${context ? context + ': ' : ''}${error.message || error}`;
  } else {
    SUPA_STATUS.lastError = null;
    SUPA_STATUS.lastSync = new Date();
  }
  updateSupaBadge();
}

function getDashboardSyncStatus() {
  return Object.freeze({
    state: !SUPA
      ? 'offline'
      : SUPA_STATUS.pending > 0
        ? 'saving'
        : SUPA_STATUS.lastError
          ? 'error'
          : SUPA_STATUS.lastSync
            ? 'synced'
            : 'connected',
    pending: SUPA_STATUS.pending,
    lastSync: SUPA_STATUS.lastSync?.toISOString() || null,
    hasError: Boolean(SUPA_STATUS.lastError),
  });
}

// ============================================================
// v0.58a — MULTI-OBRA (multi-tenant)
// ============================================================
// OBRAS é o catálogo de obras carregado do Supabase (tabela `obras`).
// OBRA_ATIVA é o código da obra atualmente exibida no dashboard.
// Toda leitura/escrita no Supabase filtra por OBRA_ATIVA (exceto configs globais).
// Fallback padrão: '42-21O' (Jardins Zurique) — a obra original antes da migração.
// ============================================================
const OBRA_DEFAULT = '42-21O';
// OBRAS e OBRA_ATIVA declarados na seção ESTADO GLOBAL acima

// Prefixa chave do dashboard_config com codigo_obra (dados por obra).
// Chaves globais (ex: header_title, indice_correcao) NÃO usam prefixo.
function keyPorObra(chave, obra) {
  const o = obra || OBRA_ATIVA;
  if (!o) return chave;
  return o + ':' + chave;
}

// Retorna metadados da obra ativa (ou default)
function getObraInfo(codigo) {
  codigo = codigo || OBRA_ATIVA;
  return OBRAS.find(o => o.codigo_obra === codigo) || null;
}

// Determina qual obra deve estar ativa no boot:
// 1) parâmetro ?obra=XXX na URL   (bookmark direto)
// 2) localStorage (última escolha do usuário)
// 3) primeira obra ativa do catálogo
// 4) OBRA_DEFAULT (fallback definitivo)
function resolverObraInicial() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('obra');
    if (fromUrl && OBRAS.find(o => o.codigo_obra === fromUrl)) return fromUrl;
  } catch(e) { reportNonFatalError('Obras/URL inicial', e); }
  try {
    const fromLS = localStorage.getItem('jzurique_obra_ativa');
    if (fromLS && OBRAS.find(o => o.codigo_obra === fromLS)) return fromLS;
  } catch(e) { reportNonFatalError('Obras/preferência local', e); }
  const primeiraAtiva = OBRAS.find(o => o.ativa);
  if (primeiraAtiva) return primeiraAtiva.codigo_obra;
  if (OBRAS.length === 0) {
    console.warn('[OBRAS] catálogo vazio — modo offline, usando fallback');
  }
  return OBRA_DEFAULT;
}

// Carrega catálogo de obras do Supabase (chamado no boot)
async function carregarObras() {
  if (!SUPA) return [];
  try {
    const { data, error } = await SUPA.from('obras')
      .select('*').order('nome', { ascending: true });
    if (error) { console.warn('[OBRAS] erro carregar:', error); return []; }
    OBRAS = data || [];
    console.log(`[OBRAS] ${OBRAS.length} obra(s) carregada(s)`);
    return OBRAS;
  } catch(e) {
    console.warn('[OBRAS] excecao:', e);
    return [];
  }
}

// Renderiza o dropdown de obras no header (chamado após carregarObras)
function renderObrasDropdown() {
  const el = document.getElementById('obraSelector');
  if (!el) return;
  el.replaceChildren();
  if (!OBRAS.length) {
    el.append(new Option('Nenhuma obra cadastrada', ''));
    el.disabled = true;
    return;
  }
  OBRAS
    .filter(o => o.ativa)
    .forEach(o => {
      const option = new Option(o.nome, o.codigo_obra);
      option.selected = o.codigo_obra === OBRA_ATIVA;
      el.append(option);
    });
  el.disabled = false;
  // Atualiza título grande do header
  const titulo = document.getElementById('obraNomeGrande');
  if (titulo) {
    const info = getObraInfo();
    titulo.textContent = info ? '📊 ' + info.nome : '📊 —';
  }
}

// Chamado quando usuário troca de obra no dropdown
async function trocarObra(novoCodigo) {
  if (!novoCodigo || novoCodigo === OBRA_ATIVA) return;
  if (typeof UPLOAD_RUNTIME_STATE !== 'undefined'
      && Object.values(UPLOAD_RUNTIME_STATE).some(state => state.status === 'processing')) {
    authToast('⏳ Aguarde o upload terminar antes de trocar de obra.', 'warn', 4000);
    renderObrasDropdown();
    return;
  }
  console.log('[OBRAS] trocando de', OBRA_ATIVA, '→', novoCodigo);
  showLoading();
  OBRA_ATIVA = novoCodigo;
  // reavalia UI de auth pra esta obra (editor pode não ter permissão aqui)
  if (typeof updateAuthUI === 'function') updateAuthUI();
  SafeStorage.set('jzurique_obra_ativa', novoCodigo);
  // Atualiza URL sem recarregar (bookmark limpo)
  try {
    const url = new URL(window.location);
    url.searchParams.set('obra', novoCodigo);
    window.history.replaceState({}, '', url);
  } catch(e) { reportNonFatalError('Obras/atualizar URL', e); }
  // Reset em RAM dos dados extraídos (serão recarregados)
  DATA_T = [];
  DATA_F = [];
  HISTORICO = { gestoes: [], items: [], totals: {} };
  PROJ_RAW = [];
  EVOL_GLOBAL = { teorica: null, financeira: null };
  Object.keys(LAST_UPLOADS).forEach(k => LAST_UPLOADS[k] = null);
  // Atualiza header grande
  const titulo = document.getElementById('obraNomeGrande');
  if (titulo) {
    const info = getObraInfo();
    titulo.textContent = info ? '📊 ' + info.nome : '📊 —';
  }
  // Recarrega dados dessa obra
  authToast('🔄 Carregando dados de ' + (getObraInfo()?.nome || novoCodigo) + '...', 'info', 2500);
  try {
    await recarregarDadosDaObra();
    renderAll();
    authToast('✅ Obra ativa: ' + (getObraInfo()?.nome || novoCodigo), 'ok', 2500);
  } catch(e) {
    console.error('[OBRAS] erro ao trocar:', e);
    authToast('❌ Erro ao carregar obra: ' + e.message, 'err', 5000);
  } finally {
    hideLoading();
  }
}

// Identifica a última gestão cronológica em uma lista de gestões.
// Ignora 'Atual' (sem data). Retorna string 'GESTÃO MM-AAAA' ou null se não achar.
function acharUltimaGestaoCronologica(listaGestoes) {
  if (!Array.isArray(listaGestoes) || !listaGestoes.length) return null;
  // Extrai [ano, mês] de cada gestão que tem formato GESTÃO MM-AAAA
  const comData = listaGestoes
    .map(g => {
      const m = String(g).match(/GEST[ÃA]O\s+(\d{2})-(\d{4})/i);
      if (!m) return null;
      return { label: g, ano: parseInt(m[2], 10), mes: parseInt(m[1], 10) };
    })
    .filter(x => x !== null);
  if (!comData.length) return null;
  // Ordena desc por ano-mês, retorna a primeira
  comData.sort((a, b) => (b.ano * 100 + b.mes) - (a.ano * 100 + a.mes));
  return comData[0].label;
}

// Atualiza GESTAO_LABEL pra última gestão cronológica se HISTORICO tiver dados
function atualizarGestaoLabelPelaHistoria() {
  if (!HISTORICO || !Array.isArray(HISTORICO.gestoes)) return;
  const ultima = acharUltimaGestaoCronologica(HISTORICO.gestoes);
  if (ultima) {
    console.log('[GESTAO] label atualizado pela última gestão do histórico:', ultima);
    GESTAO_LABEL = ultima;
  }
}

// Fallback: se coluna Gestão da Tendência estiver vazia, usa HISTORICO
// Cenário: na virada de mês, o Excel Tendência é reexportado com cabeçalho 07-2026
// mas os valores ainda não foram preenchidos (todas as folhas com d.gestao == null).
// Nesse caso, puxamos os valores da última gestão preenchida no HISTORICO por insumo.
function aplicarFallbackGestaoDoHistorico() {
  if (!Array.isArray(DATA_T) || !DATA_T.length) return;
  if (!HISTORICO || !HISTORICO.items || !HISTORICO.items.length) return;
  // Detecta se a coluna gestão da Tendência está toda vazia (nenhuma folha com valor)
  const folhas = DATA_T.filter(d => d.is_folha);
  const folhasComGestao = folhas.filter(d => d.gestao != null && d.gestao !== 0).length;
  if (folhasComGestao > 0) {
    // Coluna Gestão tem valores — não aplica fallback
    return;
  }
  // Coluna Gestão vazia — determina qual gestão do HISTORICO usar (última cronológica)
  const ultima = acharUltimaGestaoCronologica(HISTORICO.gestoes);
  if (!ultima) return;
  // v0.60.2 FIX: mapear por servico+insumo+item_cod (chave composta) evita duplicação
  // Ex: insumo CONDH271 aparece em S05765-CONDH271-01.01.01.02 E S05305-CONDH271-01.04.01
  //     — são linhas distintas na Tendência, precisam bater cada uma com sua contraparte no HISTORICO
  const mapa = {};
  HISTORICO.items
    .filter(it => it.codigo_obra === OBRA_ATIVA)
    .forEach(it => {
      if (!it.insumo) return;
      const chaveComp = (it.servico||'') + '|' + (it.insumo||'') + '|' + (it.item_cod||'');
      mapa[chaveComp] = (mapa[chaveComp] || 0) + (it[ultima] || 0);
    });
  // Aplica o valor em cada folha do DATA_T (bate por servico+insumo+cod)
  let aplicados = 0;
  DATA_T.forEach(d => {
    if (!d.is_folha || !d.cod_insumo) return;
    const chaveComp = (d.cod_servico||'') + '|' + (d.cod_insumo||'') + '|' + (d.cod||'');
    if (mapa[chaveComp] != null && mapa[chaveComp] !== 0) {
      d.gestao = mapa[chaveComp];
      d.diferenca = (d.licitacao != null && d.gestao != null) ? (d.licitacao - d.gestao) : null;
      aplicados++;
    }
  });
  if (aplicados > 0) {
    console.log(`[TEND] coluna Gestão vazia — usando HISTORICO (${ultima}). ${aplicados} folha(s) preenchida(s).`);
  }
}

// Interface administrativa fornecida por ui/views/admin.mjs.

// Recarrega dados da obra ativa (dados extraídos + configs + histórico de uploads)
// Chamado ao trocar de obra e no boot inicial.
async function recarregarDadosDaObra() {
  if (!SUPA || !OBRA_ATIVA) return;
  resetDadosObra();
  const [cls, manuals, projCfg, movs, cfg, ups] = await Promise.all([
    supaLoadClassifications(), supaLoadManuals(), supaLoadProjConfig(),
    supaLoadMovs(), supaLoadDashboardConfig(), supaLoadUploadsLatest(),
  ]);
  aplicarCacheLocal(cls, manuals, projCfg, movs);
  aplicarDadosPersistidos(cfg);
  Object.assign(LAST_UPLOADS, ups);
  posCarregarDados();
  console.log('[OBRAS] dados recarregados para', OBRA_ATIVA, '— insumo controlado:', PROJ_CTRL_STATE?.insumo);
}

function resetDadosObra() {
  DATA_T = [];
  DATA_F = [];
  EVOL_GLOBAL = { teorica: null, financeira: null };
  GESTAO_LABEL = 'Gestão Atual';
}

function aplicarCacheLocal(cls, manuals, projCfg, movs) {
  if (cls) { SafeStorage.set(STORAGE_KEY, JSON.stringify(cls)); }
  else { SafeStorage.remove(STORAGE_KEY); }
  if (manuals) { SafeStorage.set(MANUAL_KEY, JSON.stringify(manuals)); }
  else { SafeStorage.remove(MANUAL_KEY); }
  const projState = {
    insumo: projCfg?.insumo_controlado || 'I011890',
    saldo_inicial: projCfg?.saldo_inicial ?? null,
    data_ref: projCfg?.data_ref || null,
    movimentacoes: movs || [],
    locks: { saldo: !!(projCfg?.locked_saldo), data: !!(projCfg?.locked_data), insumo: !!(projCfg?.locked_insumo) },
  };
  SafeStorage.set(PROJ_CTRL_KEY, JSON.stringify(projState));
}

function aplicarDadosPersistidos(cfg) {
  if (!cfg) return;
  // Chaves globais (sem prefixo)
  if (cfg.header_title) { SafeStorage.set(HEADER_KEY, cfg.header_title); }
  if (cfg.indice_correcao) { CORRECAO_INDICE = cfg.indice_correcao; SafeStorage.set('jzurique_indice_correcao', cfg.indice_correcao); }
  if (cfg.card3_modo) { CARD3_MODO = cfg.card3_modo; SafeStorage.set('jzurique_card3_modo', cfg.card3_modo); }
  // Chaves por obra (com prefixo)
  const pref = OBRA_ATIVA + ':';
  if (cfg[pref + 'evol_global']) { try { const p = JSON.parse(cfg[pref + 'evol_global']); if (p) EVOL_GLOBAL = p; } catch(e) { reportNonFatalError('Dados/evolução global inválida', e, 'A evolução salva está inválida e não pôde ser carregada.'); } }
  if (cfg[pref + 'gestao_label']) GESTAO_LABEL = cfg[pref + 'gestao_label'];
  if (cfg[pref + 'dados_tendencia']) { try { const d = JSON.parse(cfg[pref + 'dados_tendencia']); if (Array.isArray(d)) DATA_T = d; } catch(e) { reportNonFatalError('Dados/tendência inválida', e, 'Os dados salvos de Tendência estão inválidos.'); } } else { DATA_T = []; }
  // DATA_F é GLOBAL (sem prefixo por obra). Compat: chave antiga com prefixo
  if (cfg['dados_flows']) { try { const d = JSON.parse(cfg['dados_flows']); if (Array.isArray(d)) DATA_F = d; } catch(e) { reportNonFatalError('Dados/Flows inválido', e, 'Os dados salvos de Flows estão inválidos.'); } }
  else if (cfg[pref + 'dados_flows']) { try { const d = JSON.parse(cfg[pref + 'dados_flows']); if (Array.isArray(d)) DATA_F = d; } catch(e) { reportNonFatalError('Dados/Flows legado inválido', e, 'Os dados salvos de Flows estão inválidos.'); } }
  else { DATA_F = []; }
  // HISTORICO e PROJ_RAW são globais (compartilhados entre obras)
  if (cfg['dados_historico']) { try { const d = JSON.parse(cfg['dados_historico']); if (d && d.items) HISTORICO = d; } catch(e) { reportNonFatalError('Dados/histórico inválido', e, 'O histórico salvo está inválido.'); } } else { HISTORICO = { gestoes: [], items: [], totals: {} }; }
  atualizarGestaoLabelPelaHistoria();
  aplicarFallbackGestaoDoHistorico();
  if (cfg['dados_projraw']) { try { const d = JSON.parse(cfg['dados_projraw']); if (Array.isArray(d)) PROJ_RAW = d; } catch(e) { reportNonFatalError('Dados/projeção inválida', e, 'A projeção salva está inválida.'); } } else { PROJ_RAW = []; }
}

function posCarregarDados() {
  try { if (typeof applyManuals === 'function') applyManuals(); } catch(e) { console.warn('[OBRAS] applyManuals err:', e); }
  try { if (typeof loadClassifications === 'function') loadClassifications(); } catch(e) { console.warn('[OBRAS] loadClassifications err:', e); }
  try {
    if (typeof buildInsumosList === 'function') INSUMOS_OPTIONS = buildInsumosList();
    if (typeof buildDatalist === 'function') buildDatalist();
  } catch(e) { console.warn('[OBRAS] rebuild datalist err:', e); }
  if (typeof loadProjCtrl === 'function') loadProjCtrl();
  try {
    const elSaldo = document.getElementById('projCtrlSaldoInicial');
    const elDataRef = document.getElementById('projCtrlDataRef');
    const elIns = document.getElementById('projCtrlInsumo');
    if (elSaldo) elSaldo.value = (PROJ_CTRL_STATE.saldo_inicial != null) ? fmt(PROJ_CTRL_STATE.saldo_inicial) : '';
    if (elDataRef) elDataRef.value = PROJ_CTRL_STATE.data_ref || '';
    if (elIns) elIns.value = PROJ_CTRL_STATE.insumo || 'I011890';
    if (typeof applyLocksToUI === 'function') applyLocksToUI();
  } catch(e) { reportNonFatalError('Projeção/restaurar controles', e); }
}

// Persistência de classificações, manuais, projeção e configurações fornecida por services/dashboard-repository.mjs.

function buildUploadDashboardRows(kinds) {
  const requested = Array.isArray(kinds) ? [...new Set(kinds)] : ['tendencia', 'flows', 'gestoes'];
  const values = new Map();

  if (requested.includes('tendencia')) {
    if (!Array.isArray(DATA_T) || !DATA_T.length) throw new Error('Tendência sem dados válidos para persistir');
    values.set(keyPorObra(DATA_KEYS.DATA_T), JSON.stringify(DATA_T));
    values.set(keyPorObra(DATA_KEYS.GESTAO_LABEL), String(GESTAO_LABEL || ''));
  }
  if (requested.includes('flows')) {
    if (!Array.isArray(DATA_F) || !DATA_F.length) throw new Error('Flows sem dados válidos para persistir');
    values.set(DATA_KEYS.DATA_F, JSON.stringify(DATA_F));
  }
  if (requested.includes('gestoes')) {
    if (!HISTORICO?.items?.length) throw new Error('Histórico sem dados válidos para persistir');
    values.set(DATA_KEYS.HISTORICO, JSON.stringify(HISTORICO));
    values.set(DATA_KEYS.PROJ_RAW, JSON.stringify(Array.isArray(PROJ_RAW) ? PROJ_RAW : []));
  }

  const updatedAt = new Date().toISOString();
  return [...values].map(([chave, valor]) => ({ chave, valor, updated_at: updatedAt }));
}

async function supaCaptureDashboardRows(kinds) {
  if (!SUPA) throw new Error('Supabase indisponível');
  const keys = buildUploadDashboardRows(kinds).map(row => row.chave);
  const { data, error } = await SUPA.from('dashboard_config')
    .select('chave,valor')
    .in('chave', keys);
  if (error) throw error;
  return { keys, rows: data || [] };
}

async function supaRestoreDashboardRows(snapshot) {
  if (!snapshot?.keys?.length) return;
  const updatedAt = new Date().toISOString();
  const previousRows = (snapshot.rows || []).map(row => ({ ...row, updated_at: updatedAt }));
  if (previousRows.length) {
    const { error } = await SUPA.from('dashboard_config').upsert(previousRows, { onConflict: 'chave' });
    if (error) throw error;
  }
  const previousKeys = new Set(previousRows.map(row => row.chave));
  const keysToDelete = snapshot.keys.filter(key => !previousKeys.has(key));
  if (keysToDelete.length) {
    const { error } = await SUPA.from('dashboard_config').delete().in('chave', keysToDelete);
    if (error) throw error;
  }
}

// Persiste todas as chaves do conjunto em uma única instrução do PostgREST.
async function supaSaveAllData(kinds) {
  if (!SUPA) throw new Error('Supabase indisponível');
  if (!isEditorDaObraAtiva()) throw new Error('Sem permissão para persistir dados da obra ativa');
  if ((!Array.isArray(kinds) || kinds.some(isGlobalUploadKind)) && !isAdminGeral()) {
    throw new Error('Apenas administradores podem persistir dados globais');
  }
  if (!OBRA_ATIVA) throw new Error('Nenhuma obra ativa para persistência');

  const rows = buildUploadDashboardRows(kinds);
  const { error } = await SUPA.from('dashboard_config').upsert(rows, { onConflict: 'chave' });
  if (error) {
    SUPA_STATUS.lastError = error.message;
    updateSupaBadge();
    throw error;
  }
  SUPA_STATUS.lastError = null;
  SUPA_STATUS.lastSync = new Date();
  updateSupaBadge();
  console.log(`[SUPA] ${rows.length} dataset(s) persistido(s) para obra ${OBRA_ATIVA}`);
  return rows;
}

// v0.58b: reset dos dados da obra ativa
//   - Chaves POR OBRA: dados_tendencia, dados_flows, gestao_label, evol_global (prefixadas)
//   - Chaves GLOBAIS (Gestões): dados_historico, dados_projraw — pergunta se quer apagar também
async function resetCacheDados() {
  if (!requireEditor('resetar cache')) return;
  if (!OBRA_ATIVA) { authToast('❌ Nenhuma obra selecionada', 'err', 3000); return; }
  const info = getObraInfo();
  const nomeObra = info ? info.nome : OBRA_ATIVA;
  const confirmObra = await confirmModal(
    'Resetar cache da obra',
    `Isto vai apagar do Supabase os dados desta obra (${nomeObra}):\n\n- Tendência individual\n- Flows individual\n- Aderência Físico-Financeira\n\nAs outras obras e os arquivos originais no Storage não serão afetados.`,
    { confirmText: 'Resetar cache' }
  );
  if (!confirmObra) return;
  // Chaves POR OBRA
  const chavesObra = ['dados_tendencia', 'dados_flows', 'gestao_label', 'evol_global'].map(c => keyPorObra(c));
  // Perguntar sobre as chaves GLOBAIS (Histórico Mensal + Curva S — compartilhadas entre todas as obras)
  const apagarGlobal = isAdminGeral() && await confirmModal(
    'Apagar também os dados globais?',
    'Histórico e Curva S são compartilhados entre TODAS as obras. Confirmar afeta o dashboard de todas; cancelar mantém os dados globais.',
    { confirmText: 'Apagar globais' }
  );
  const chavesGlobais = apagarGlobal ? ['dados_historico', 'dados_projraw'] : [];
  const chaves = [...chavesObra, ...chavesGlobais];
  authToast('🧹 Limpando cache...', 'info', 2000);
  try {
    for (const chave of chaves) {
      const { error } = await SUPA.from('dashboard_config').delete().eq('chave', chave);
      if (error) console.warn(`[SUPA] delete ${chave}:`, error);
    }
    try { localStorage.removeItem('jzurique_evol_global'); } catch(e) { reportNonFatalError('Cache/remover evolução local', e); }
    authToast(`✅ Cache limpo (${chaves.length} chaves). Recarregando...`, 'ok', 2000);
    setTimeout(() => location.reload(), 1500);
  } catch(e) {
    console.error(e);
    authToast('❌ Erro ao limpar cache: ' + e.message, 'err', 5000);
  }
}

// apagar todo o histórico de uploads (metadados + arquivos no Storage)
async function apagarHistoricoUploads() {
  if (!requireAdmin('apagar o histórico global de uploads')) return;
  const confirmed = await confirmModal(
    'Apagar histórico de uploads',
    'Isto vai apagar todo o histórico de uploads e todos os arquivos armazenados no Storage. Os dados já processados do dashboard não serão afetados.',
    { confirmText: 'Apagar tudo', requireText: 'APAGAR' }
  );
  if (!confirmed) return;
  authToast('🗑️ Apagando histórico...', 'info', 2000);
  try {
    if (!OBRA_ATIVA) throw new Error('Nenhuma obra selecionada');
    // Buscar registros DA OBRA ATIVA pra pegar storage_paths
    const { data: recs, error: readErr } = await SUPA.from('upload_history')
      .select('id, storage_path').eq('codigo_obra', OBRA_ATIVA);
    if (readErr) throw readErr;
    // Apagar arquivos do Storage PRIMEIRO — se falhar, mantém registros no banco
    const paths = [...new Set((recs || []).map(r => sanitizeStoragePath(r.storage_path)).filter(Boolean))];
    if (paths.length) {
      const { error: sErr } = await SUPA.storage.from(UPLOADS_BUCKET).remove(paths);
      if (sErr) {
        throw new Error('Falha ao remover arquivos do Storage. Registros no banco mantidos por segurança. Erro: ' + sErr.message);
      }
    }
    // Só apaga registros do banco se Storage foi bem-sucedido
    const { error: dErr } = await SUPA.from('upload_history').delete()
      .eq('codigo_obra', OBRA_ATIVA);
    if (dErr) throw dErr;
    // Reset local
    LAST_UPLOADS.tendencia = null;
    LAST_UPLOADS.flows = null;
    LAST_UPLOADS.gestoes = null;
    renderUploadsCentral();
    renderSourcesHeaders();
    authToast(`✅ ${(recs||[]).length} registro(s) apagado(s)`, 'ok', 3000);
  } catch(e) {
    console.error(e);
    authToast('❌ Erro ao apagar histórico: ' + e.message, 'err', 5000);
  }
}

// ---------- UPLOAD HISTORY + STORAGE (v0.52 / v0.53) ----------
// Bucket, limite e sanitização são fornecidos por services/upload-repository.mjs.
const UPLOAD_RUNTIME_STATE = Object.create(null);

function setUploadRuntimeState(kinds, status, message = '') {
  (Array.isArray(kinds) ? kinds : [kinds]).forEach(kind => {
    UPLOAD_RUNTIME_STATE[kind] = { status, message, updatedAt: new Date() };
  });
  const obraSelector = document.getElementById('obraSelector');
  if (obraSelector) {
    obraSelector.disabled = Object.values(UPLOAD_RUNTIME_STATE)
      .some(state => state.status === 'processing');
  }
}

function captureInMemoryUploadState() {
  return {
    DATA_T,
    DATA_F,
    HISTORICO,
    PROJ_RAW,
    GESTAO_LABEL,
    EVOL_GLOBAL: { ...EVOL_GLOBAL },
    INSUMOS_OPTIONS,
  };
}

function restoreInMemoryUploadState(snapshot) {
  if (!snapshot) return;
  DATA_T = snapshot.DATA_T;
  DATA_F = snapshot.DATA_F;
  HISTORICO = snapshot.HISTORICO;
  PROJ_RAW = snapshot.PROJ_RAW;
  GESTAO_LABEL = snapshot.GESTAO_LABEL;
  EVOL_GLOBAL = snapshot.EVOL_GLOBAL;
  INSUMOS_OPTIONS = snapshot.INSUMOS_OPTIONS;
  try { buildDatalist(); } catch (error) { reportNonFatalError('Upload/restaurar lista de insumos', error); }
}

async function commitPreparedUpload({ file, storageType, items, groupId = null, memorySnapshot }) {
  return executeUploadTransaction(
    { file, storageType, items, groupId, memorySnapshot },
    {
      captureDashboardRows: supaCaptureDashboardRows,
      uploadFile: supaUploadFile,
      createRecord: item => supaCreateUploadRecord(
        item.kind,
        item.fileName,
        item.fileSize,
        item.rows,
        item.storagePath,
        item.groupId,
      ),
      saveAllData: supaSaveAllData,
      activateRecord: supaActivateUploadRecord,
      rollbackActivation: supaRollbackUploadActivation,
      restoreDashboardRows: supaRestoreDashboardRows,
      markRecordsFailed: supaMarkUploadRecordsFailed,
      removeStoredUpload: supaRemoveStoredUpload,
      deleteRecords: supaDeleteUploadRecords,
      restoreMemoryState: restoreInMemoryUploadState,
      setRuntimeState: setUploadRuntimeState,
      onActive: activeRecords => activeRecords.forEach(record => {
        LAST_UPLOADS[record.tipo] = record;
      }),
      reportCleanupError: reportNonFatalError,
    },
  );
}

// Persistência do histórico e Storage é fornecida por services/upload-repository.mjs.

// LAST_UPLOADS declarado na seção ESTADO GLOBAL acima
// ---------- Badge visual de sincronização ----------
function updateSupaBadge() {
  // badges translúcidos brancos no header escuro (só ícone muda o "tom" de mensagem)
  const el = document.getElementById('supaBadge');
  if (!el) return;
  const baseBg = 'rgba(255,255,255,0.15)';
  const baseBorder = 'rgba(255,255,255,0.3)';
  el.style.color = 'var(--text-on-dark)';
  el.style.border = '1px solid ' + baseBorder;
  el.style.background = baseBg;
  el.setAttribute('aria-busy', SUPA_STATUS.pending > 0 ? 'true' : 'false');
  if (!SUPA) {
    el.dataset.syncState = 'offline';
    el.textContent = '🔴 Offline';
    el.style.background = 'rgba(220,38,38,0.35)';
    el.style.borderColor = 'rgba(255,150,150,0.4)';
    el.title = 'Não conectado ao Supabase - dados só ficam salvos aqui';
    return;
  }
  if (SUPA_STATUS.pending > 0) {
    el.dataset.syncState = 'saving';
    el.textContent = SUPA_STATUS.pending > 1
      ? `↻ Salvando ${SUPA_STATUS.pending} alterações...`
      : '↻ Salvando...';
    el.style.background = 'rgba(3,105,161,0.4)';
    el.style.borderColor = 'rgba(125,211,252,0.55)';
    el.title = 'Sincronização em andamento. Aguarde antes de fechar a página.';
    return;
  }
  if (SUPA_STATUS.lastError) {
    el.dataset.syncState = 'error';
    el.textContent = '⚠️ Falha ao salvar';
    el.style.background = 'rgba(180,83,9,0.35)';
    el.style.borderColor = 'rgba(255,200,100,0.4)';
    el.title = 'A última sincronização falhou. Tente novamente ou confira a conexão.';
    return;
  }
  if (SUPA_STATUS.lastSync) {
    el.dataset.syncState = 'synced';
    el.textContent = '☁️ Sincronizado';
    el.title = 'Última sincronização: ' + SUPA_STATUS.lastSync.toLocaleTimeString('pt-BR');
    return;
  }
  el.dataset.syncState = 'connected';
  el.textContent = '🔗 Conectado';
  el.title = 'Conectado ao Supabase (ainda sem sincronização recente)';
}

// Interface e autorização de autenticação fornecidas por ui/auth-ui.mjs.

const LIC_LABEL = 'Orç. Licitação';

// formato Excel #.##0,00;-#.##0,00;"-" — zero e null viram "-"; sem prefixo R$
const fmt = (v, dec=2) => {
  if (v == null) return '-';
  const abs = Math.abs(v);
  // Considera zero se abaixo da precisão exibida (evita "0,00" virar "-" indevidamente com valores pequenos legítimos)
  const eps = dec > 0 ? Math.pow(10, -dec) / 2 : 0.5;
  if (abs < eps) return '-';
  return v.toLocaleString('pt-BR', {minimumFractionDigits: dec, maximumFractionDigits: dec});
};
// Aliases mantidos por retrocompat (chamados em ~97 lugares). Agora SEM R$ e com zero=hífen.
const fmtR$ = (v) => fmt(v);
const fmtR$k = (v) => {
  if (v == null) return '-';
  if (Math.abs(v) < 0.5) return '-';
  if (Math.abs(v) >= 1e6) return (v/1e6).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) + 'M';
  if (Math.abs(v) >= 1e3) return (v/1e3).toLocaleString('pt-BR', {minimumFractionDigits:0, maximumFractionDigits:0}) + 'k';
  return fmt(v, 0);
};
const fmtPct = (v) => v == null ? '-' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

function statusOf(licit, gestao) {
  if (!licit || gestao == null) return null;
  const d = (gestao - licit) / licit;
  if (d <= 0) return 'green';
  if (d <= 0.10) return 'amber';
  return 'red';
}

// ============ LIGAÇÃO FLOW ↔ TENDÊNCIA ============
// MAP_DESTINO e MAP_ORIGEM declarados na seção ESTADO GLOBAL acima

function buildLinks() {
  MAP_DESTINO = {};
  MAP_ORIGEM = {};
  getFlowsObraAtiva().forEach(f => {
    if (f.dep === 'Cancelado') return; // ignora cancelados
    const ip = f.insumo_planejamento;
    const ir = f.insumo_remanejamento;
    if (ip && !['', '-', 'Não encontrado!'].includes(ip) && !ip.includes('VERIFICAR')) {
      if (!MAP_DESTINO[ip]) MAP_DESTINO[ip] = [];
      MAP_DESTINO[ip].push(f);
    }
    if (ir && !['', '-', 'Não encontrado!'].includes(ir) && !ir.includes('VERIFICAR')) {
      if (!MAP_ORIGEM[ir]) MAP_ORIGEM[ir] = [];
      MAP_ORIGEM[ir].push(f);
    }
  });
  // Atribuir aditivo_total a cada item da tendência
  DATA_T.forEach(t => {
    if (!t.is_folha) { t.aditivo_total = 0; t.flows_destino = []; t.flows_origem = []; return; }
    const destino = MAP_DESTINO[t.cod_insumo] || [];
    const origem = MAP_ORIGEM[t.cod_insumo] || [];
    t.flows_destino = destino;
    t.flows_origem = origem;
    // soma: entrada (custo) - saída (devolução)
    const entrada = destino.reduce((s,f) => s + (f.custo_flowmaster || 0), 0);
    const saida = origem.reduce((s,f) => s + (f.custo_flowmaster || 0), 0);
    t.aditivo_total = entrada - saida;
  });
}

// Tema, cabeçalho e navegação fornecidos por ui/shell.mjs.

// Visualização da Visão Geral fornecida por ui/views/overview.mjs.

// Visualização de detalhamento fornecida por ui/views/details.mjs.

// Infraestrutura de modais instalada por assets/js/ui/modals.mjs.

// Edição e classificação de Flows fornecidas por ui/flow-editor.mjs.

// ============ UPLOAD POR ABA ============
// Interface de uploads fornecida por ui/uploads.mjs.

// Parsers de Tendência, Flows e Gestões são instalados por assets/js/parsers/index.mjs.

// Visualização de Tendência de Obra fornecida por ui/views/projection.mjs.

// Controle de projeção fornecido por ui/views/projection-control.mjs.

// Exportações XLSX fornecidas por services/dashboard-export.mjs.

// ============ HISTÓRICO ============
// Tolerância de centavos: variações abaixo disso são consideradas zero (arredondamento)
// Visualização do histórico fornecida por ui/views/history.mjs.

// ============ OTIMIZAÇÕES DE RENDERIZAÇÃO ============
// Função para renderizar apenas a aba ativa (evita re-renderizar todas as abas)
function renderTab(tabName) {
  const startedAt = performance.now();
  try {
    switch(tabName) {
    case 'visao':
      renderVisao();
      break;
    case 'flows':
      renderFlows();
      break;
    case 'detalhe':
      renderTable();
      break;
    case 'historico':
      renderHistorico();
      break;
    case 'projecao':
      if (PROJ_RAW && PROJ_RAW.length) {
        try { renderProjecao(); } catch(e) { console.warn('renderProjecao err:', e); }
      } else {
        initProjecao();
      }
      break;
    case 'projecao_ctrl':
      initProjCtrl();
      break;
    case 'uploads':
      renderUploadsCentral();
      renderSourcesHeaders();
      break;
      // Admin e Manual não precisam de re-renderização
    }
  } finally {
    dashboardPerformance?.record(`render:${tabName}`, performance.now() - startedAt);
  }
}

// Debounce para evitar múltiplas renderizações em sequência
let _renderTimeout = null;
function debouncedRender(tabName) {
  clearTimeout(_renderTimeout);
  _renderTimeout = setTimeout(() => {
    if (tabName) {
      renderTab(tabName);
    } else {
      renderAll();
    }
  }, CONFIG.debounce_render);
}

function getActiveTabName() {
  return document.querySelector('.tab.active')?.dataset.tab || 'visao';
}

// Atualiza estruturas compartilhadas e renderiza somente a aba visível.
function renderAll() {
  buildLinks();
  populateFilters();
  try { renderSourcesHeaders(); } catch(e) { reportNonFatalError('Boot/renderizar fontes', e); }
  renderTab(getActiveTabName());
}

document.getElementById('now').textContent = new Date().toLocaleString('pt-BR');
INSUMOS_OPTIONS = buildInsumosList();
buildDatalist();
updateSupaBadge();

// Boot assíncrono v0.58a: multi-obra
// Ordem: carregar catálogo de obras → resolver obra ativa → carregar dados dessa obra
(async () => {
  try {
    if (SUPA) {
      console.log('[SUPA] carregando dados iniciais...');
      // 1) Carrega catálogo de obras primeiro
      await carregarObras();
      // 2) Resolve qual obra deve estar ativa (URL > localStorage > primeira ativa > default)
      OBRA_ATIVA = resolverObraInicial();
      console.log('[OBRAS] obra ativa selecionada:', OBRA_ATIVA);
      // 3) Popula o dropdown do header
      renderObrasDropdown();
      // 4) Carrega TODOS os dados da obra ativa em paralelo
      await recarregarDadosDaObra();
      // 5) Aplica config global de UI que carregou (título/INCC/card3)
      const el = document.getElementById('headerTitle');
      const savedTitle = localStorage.getItem(HEADER_KEY);
      if (el && savedTitle) el.textContent = savedTitle;
      SUPA_STATUS.lastSync = new Date();
      updateSupaBadge();
    }
  } catch (e) {
    console.warn('[SUPA] boot err:', e);
    SUPA_STATUS.lastError = e.message;
    updateSupaBadge();
  }
  // Aplica manuais + classificações carregadas
  applyManuals();
  const _loaded = loadClassifications();
  if (_loaded > 0) console.log(`Carregadas ${_loaded} classificações no boot.`);

  // Auth PRIMEIRO, render DEPOIS — garante que botões de edição reflitam permissão real
  await initAuth().catch(e => console.warn('[AUTH] initAuth err:', e));
  try {
    const recoveredUploads = await supaCleanupIncompleteUploads();
    if (recoveredUploads > 0) {
      authToast(`🧹 ${recoveredUploads} upload(s) incompleto(s) foram limpos.`, 'info', 4500);
    }
  } catch (error) {
    reportNonFatalError('Upload/recuperar tentativas incompletas', error, 'Não foi possível limpar uploads incompletos antigos.');
  }

  renderAll();
  updateEditCount();

  // Restaurar aba ativa e filtros salvos
  restaurarAbaAtiva();
  restaurarFiltros();
  dashboardPerformance?.completeBoot();
})();

// Formulários de autenticação fornecidos por ui/auth-ui.mjs.
