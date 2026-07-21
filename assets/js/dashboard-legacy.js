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

// ============================================================================
// v0.62 — UI ADMIN v2 (roles + pendentes + hard delete)
// SUBSTITUI as funções v0.61: renderObrasAdmin, renderEditoresAdmin,
// openEditorForm, salvarEditorForm, removerEditor, toggleObraAtiva
// ADICIONA: renderPendentesAdmin, aprovarPendente, rejeitarPendente,
//           mudarRoleEditor, deletarObra (hard delete)
// ============================================================================

// -------------- OBRAS (v0.62) --------------

async function renderObrasAdmin() {
  const tbody = document.getElementById('obrasAdminTbody');
  if (!tbody) return;
  if (!isAdminGeral()) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-soft);">Acesso restrito a administradores.</td></tr>';
    return;
  }
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-lighter);">carregando…</td></tr>';
  if (!SUPA) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--sem-erro);">Sem conexão com o Supabase.</td></tr>';
    return;
  }
  try {
    const { data, error } = await SUPA.from('obras').select('*').order('nome', { ascending: true });
    if (error) throw error;
    if (!data || !data.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-lighter);">Nenhuma obra cadastrada.</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(o => {
      const ativa = !!o.ativa;
      const badge = ativa
        ? '<span class="badge green">✅ Ativa</span>'
        : '<span class="badge gray">⏸️ Inativa</span>';
      const origem = o.origem || 'manual';
      const origemBadge = origem === 'manual'
        ? '<span class="badge purple" title="Criada pela UI Admin — pode ser deletada">✍️ Manual</span>'
        : '<span class="badge gray" title="Detectada de upload de Gestões — só pode desativar">📥 Upload</span>';
      const dt = o.criada_em ? new Date(o.criada_em).toLocaleString('pt-BR') : '—';
      const toggleLbl = ativa ? '⏸️ Desativar' : '▶️ Ativar';
      const toggleStyle = ativa
        ? 'background:var(--sem-alerta-bg); border:1px solid var(--sem-alerta); color:var(--sem-alerta);'
        : 'background:var(--sem-ok-bg); border:1px solid var(--sem-ok-border); color:var(--sem-ok-text);';
      const podeDeletar = origem === 'manual';
      const btnDeletar = podeDeletar
        ? `<button class="btn-sm" data-action="deletar-obra" data-codigo="${escAttr(o.codigo_obra)}" data-nome="${escAttr(o.nome)}" style="padding:3px 8px; font-size:11px; background:var(--fgr-red-light); border:1px solid var(--sem-erro); color:var(--sem-erro);" title="Deletar permanentemente (obra manual)" aria-label="Deletar obra ${escAttr(o.nome)} permanentemente">🗑️</button>`
        : `<button class="btn-sm" disabled style="padding:3px 8px; font-size:11px; opacity:0.4; cursor:not-allowed;" title="Obras de upload não podem ser deletadas — só desative" aria-label="Esta obra não pode ser deletada">🗑️</button>`;
      return `<tr data-codigo="${escAttr(o.codigo_obra)}" data-ativa="${ativa}">
        <td style="font-family:monospace; font-size:12px;">${escHtml(o.codigo_obra)}</td>
        <td><strong>${escHtml(o.nome)}</strong></td>
        <td style="font-family:monospace; font-size:11px; color:var(--text-soft);">${escHtml(o.key_empobratd||'—')}</td>
        <td>${origemBadge}</td>
        <td>${badge}</td>
        <td style="font-size:11px; color:var(--text-soft);">${dt}</td>
        <td>
          <button class="btn-sm" data-action="editar-obra" data-codigo="${escAttr(o.codigo_obra)}" title="Editar nome/key" aria-label="Editar obra ${escAttr(o.nome)}" style="padding:3px 8px; font-size:11px;">✏️</button>
          <button class="btn-sm" data-action="toggle-obra" data-codigo="${escAttr(o.codigo_obra)}" style="padding:3px 8px; font-size:11px; ${toggleStyle}">${toggleLbl}</button>
          ${btnDeletar}
        </td>
      </tr>`;
    }).join('');
  } catch(e) {
    console.warn('[ADMIN] renderObrasAdmin erro:', e);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--sem-erro);">Erro ao carregar: ${escHtml(e.message||String(e))}</td></tr>`;
  }
}

// Event delegation para botões da tabela de obras (evita onclick inline)
(function() {
  const tbody = document.getElementById('obrasAdminTbody');
  if (!tbody) return;
  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const codigo = btn.dataset.codigo;
    if (action === 'editar-obra') editarObraAdmin(codigo);
    else if (action === 'toggle-obra') {
      const tr = btn.closest('tr');
      const ativaAtual = tr?.dataset?.ativa === 'true';
      toggleObraAtiva(codigo, !ativaAtual);
    }
    else if (action === 'deletar-obra') deletarObra(codigo, btn.dataset.nome);
  });
})();

// Obra form state encapsulado em closure (não exposto ao escopo global)
const ObraForm = (function() {
  let editingCodigo = null;

  function open() {
    if (!requireAdmin('criar obras')) return;
    editingCodigo = null;
    document.getElementById('obraFormTitle').textContent = 'Nova obra';
    document.getElementById('obraFormCodigo').value = '';
    document.getElementById('obraFormCodigo').readOnly = false;
    document.getElementById('obraFormCodigo').style.background = '';
    document.getElementById('obraFormNome').value = '';
    document.getElementById('obraFormKey').value = '';
    document.getElementById('obraFormObs').value = '';
    openModalLayer(document.getElementById('obraFormBackdrop'), { initialFocus: '#obraFormCodigo' });
  }

  function close() {
    closeModalLayer(document.getElementById('obraFormBackdrop'), false);
    editingCodigo = null;
  }

  async function editar(codigo) {
    if (!requireAdmin('editar obras')) return;
    if (!SUPA) return;
    try {
      const { data, error } = await SUPA.from('obras').select('*').eq('codigo_obra', codigo).maybeSingle();
      if (error) throw error;
      if (!data) { authToast('❌ Obra não encontrada.', 'err', 3000); return; }
      editingCodigo = codigo;
      document.getElementById('obraFormTitle').textContent = 'Editar obra: ' + codigo;
      document.getElementById('obraFormCodigo').value = data.codigo_obra;
      document.getElementById('obraFormCodigo').readOnly = true;
      document.getElementById('obraFormCodigo').style.background = 'var(--bg-soft)';
      document.getElementById('obraFormNome').value = data.nome || '';
      document.getElementById('obraFormKey').value = data.key_empobratd || '';
      document.getElementById('obraFormObs').value = data.observacao || '';
      openModalLayer(document.getElementById('obraFormBackdrop'), { initialFocus: '#obraFormNome' });
    } catch(e) {
      console.warn('[ADMIN] editarObraAdmin erro:', e);
      authToast('❌ Erro ao carregar obra: ' + (e.message||e), 'err', 5000);
    }
  }

  async function salvar() {
    if (!requireAdmin('salvar obras')) return;
    const codigo = document.getElementById('obraFormCodigo').value.trim();
    const nome   = document.getElementById('obraFormNome').value.trim();
    const key    = document.getElementById('obraFormKey').value.trim();
    const obs    = document.getElementById('obraFormObs').value.trim();
    if (!codigo || !nome) { authToast('⚠️ Código e Nome são obrigatórios.', 'warn', 3000); return; }
    if (!SUPA) { authToast('❌ Sem conexão com Supabase.', 'err', 3000); return; }
    try {
      if (editingCodigo) {
        const { error } = await SUPA.from('obras').update({ nome, key_empobratd: key || null, observacao: obs || null }).eq('codigo_obra', editingCodigo);
        if (error) throw error;
        authToast('✅ Obra atualizada', 'ok', 2500);
      } else {
        const { error } = await SUPA.from('obras').insert({ codigo_obra: codigo, nome, key_empobratd: key || null, observacao: obs || null, ativa: true, origem: 'manual' });
        if (error) throw error;
        authToast('✅ Obra criada', 'ok', 2500);
      }
      close();
      await renderObrasAdmin();
      await carregarObras();
      renderObrasDropdown();
    } catch(e) {
      console.warn('[ADMIN] salvarObraForm erro:', e);
      authToast('❌ Erro ao salvar: ' + (e.message||e), 'err', 5000);
    }
  }

  return { open, close, editar, salvar };
})();

// Aliases para compatibilidade com onclick/data-action
function openObraForm() { ObraForm.open(); }
function closeObraForm() { ObraForm.close(); }
function editarObraAdmin(codigo) { ObraForm.editar(codigo); }
function salvarObraForm() { ObraForm.salvar(); }

async function toggleObraAtiva(codigo, novoValor) {
  if (!requireAdmin('alterar obras')) return;
  if (!SUPA) return;
  const acao = novoValor ? 'ativar' : 'desativar';
  const confirmed = await confirmModal(
    `${novoValor ? 'Ativar' : 'Desativar'} obra`,
    `Deseja ${acao} a obra ${codigo}?\n\n${novoValor ? 'Ela voltará a aparecer no dropdown.' : 'Ela desaparece do dropdown mas os dados históricos ficam preservados no banco.'}`,
    { confirmText: novoValor ? 'Ativar' : 'Desativar', destructive: !novoValor }
  );
  if (!confirmed) return;
  try {
    const { error } = await SUPA.from('obras').update({ ativa: novoValor }).eq('codigo_obra', codigo);
    if (error) throw error;
    authToast(novoValor ? '✅ Obra ativada' : '⏸️ Obra desativada', 'ok', 2500);
    await renderObrasAdmin();
    await carregarObras();
    renderObrasDropdown();
    if (!novoValor && codigo === OBRA_ATIVA) {
      authToast('⚠️ Você está vendo uma obra desativada. Troque no dropdown.', 'warn', 5000);
    }
  } catch(e) {
    console.warn('[ADMIN] toggleObraAtiva erro:', e);
    authToast('❌ Erro ao alterar: ' + (e.message||e), 'err', 5000);
  }
}

function getAdminRpcErrorMessage(error) {
  const message = error?.message || String(error || 'Erro desconhecido');
  if (/PGRST202|schema cache|function .* does not exist/i.test(`${error?.code || ''} ${message}`)) {
    return 'A migration de operações administrativas ainda não foi aplicada no Supabase.';
  }
  return message;
}

async function cleanupDeletedObraStorage(codigo, rawPaths) {
  const safePrefix = codigo.replace(/[^\w.\-]/g, '_') + '/';
  const paths = [...new Set((Array.isArray(rawPaths) ? rawPaths : [])
    .map(sanitizeStoragePath)
    .filter(path => path && path.startsWith(safePrefix)))];
  const failedBatches = [];

  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    try {
      const { error } = await SUPA.storage.from(UPLOADS_BUCKET).remove(batch);
      if (error) failedBatches.push({ paths: batch, error });
    } catch(error) {
      failedBatches.push({ paths: batch, error });
    }
  }

  return { total: paths.length, failedBatches };
}

function clearDeletedActiveObra() {
  OBRA_ATIVA = null;
  SafeStorage.remove('jzurique_obra_ativa');
  resetDadosObra();
  HISTORICO = { gestoes: [], items: [], totals: {} };
  PROJ_RAW = [];
  Object.keys(LAST_UPLOADS).forEach(key => { LAST_UPLOADS[key] = null; });
  try {
    const url = new URL(window.location);
    url.searchParams.delete('obra');
    window.history.replaceState({}, '', url);
  } catch(e) { reportNonFatalError('Obras/limpar URL', e); }
}

// hard delete de obra manual — pede pra digitar o código
async function deletarObra(codigo, nome) {
  if (!requireAdmin('excluir obras')) return;
  if (!SUPA) return;
  const confirmado = await confirmModal(
    'Deletar obra permanentemente?',
    `Obra: ${codigo} (${nome})\n\nIsso vai apagar:\n- A obra do catálogo\n- Todos os aditivos, classificações, movimentações vinculadas\n- Todo o histórico de uploads dessa obra`,
    { confirmText: 'Deletar', destructive: true, requireText: codigo }
  );
  if (!confirmado) return;
  try {
    const { data, error } = await SUPA.rpc('admin_delete_obra', { p_codigo_obra: codigo });
    if (error) throw new Error(getAdminRpcErrorMessage(error));

    // Storage não participa da transação PostgreSQL. A limpeza ocorre depois do
    // commit para nunca deixar metadados apontando para arquivos já removidos.
    const storageCleanup = await cleanupDeletedObraStorage(codigo, data?.storage_paths);
    await renderObrasAdmin();
    await renderEditoresAdmin();
    await carregarObras();

    if (codigo === OBRA_ATIVA) {
      const proximaObra = OBRAS.find(obra => obra.ativa);
      if (proximaObra) await trocarObra(proximaObra.codigo_obra);
      else {
        clearDeletedActiveObra();
        renderObrasDropdown();
        renderAll();
      }
    } else {
      renderObrasDropdown();
    }

    if (storageCleanup.failedBatches.length) {
      console.warn('[ADMIN] arquivos órfãos após excluir obra:', storageCleanup.failedBatches);
      authToast(
        `⚠️ Obra excluída, mas ${storageCleanup.failedBatches.flatMap(item => item.paths).length} arquivo(s) não puderam ser limpos do Storage.`,
        'warn',
        7000
      );
    } else {
      authToast('🗑️ Obra deletada permanentemente', 'ok', 3000);
    }
  } catch(e) {
    console.warn('[ADMIN] deletarObra erro:', e);
    authToast('❌ Erro ao deletar: ' + (e.message||e), 'err', 5000);
  }
}

// -------------- EDITORES (v0.62 — com role + pending) --------------

// v0.62.2 — Editores com modal unificado (papel + obras + excluir tudo num só lugar)

// Estado do modal
let _editorFormEditandoEmail = null;  // null = criando novo; string = editando
let _editorFormOriginalRole = null;    // pra saber se mudou

// ---------- render (agrupado por email, coluna ações com 1 botão só) ----------

async function renderEditoresAdmin() {
  const tbody = document.getElementById('editoresAdminTbody');
  if (!tbody) return;
  if (!isAdminGeral()) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-soft);">Acesso restrito a administradores.</td></tr>';
    return;
  }
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-lighter);">carregando…</td></tr>';
  if (!SUPA) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--sem-erro);">Sem conexão com o Supabase.</td></tr>';
    return;
  }
  try {
    const { data, error } = await SUPA.from('editores_permitidos')
      .select('*')
      .neq('role', 'pending')
      .order('role', { ascending: true })
      .order('email', { ascending: true });
    if (error) throw error;
    if (!data || !data.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-lighter);">Nenhum editor cadastrado.</td></tr>';
      return;
    }
    // agrupa por email
    const obrasByCodigo = {}; OBRAS.forEach(o => { obrasByCodigo[o.codigo_obra] = o; });
    const grupos = {};
    data.forEach(e => {
      const k = e.email;
      if (!grupos[k]) {
        grupos[k] = { email: e.email, nome: e.nome, observacao: e.observacao,
                      adicionado_em: e.adicionado_em, role: e.role, obras: [] };
      }
      const g = grupos[k];
      if (e.role === 'admin') g.role = 'admin';
      if (e.role === 'editor' && e.codigo_obra) g.obras.push(e.codigo_obra);
      if (e.adicionado_em && (!g.adicionado_em || e.adicionado_em < g.adicionado_em)) g.adicionado_em = e.adicionado_em;
      if (!g.nome && e.nome) g.nome = e.nome;
      if (!g.observacao && e.observacao) g.observacao = e.observacao;
    });
    const linhas = Object.values(grupos).sort((a, b) => {
      if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
      return a.email.localeCompare(b.email);
    });

    tbody.innerHTML = linhas.map(g => {
      const isAdmin = g.role === 'admin';
      const roleBadge = isAdmin
        ? '<span class="badge purple">👑 Admin</span>'
        : '<span class="badge green">✏️ Editor</span>';
      let obrasHtml;
      if (isAdmin) {
        obrasHtml = '<span style="color:var(--text-soft); font-size:11px;">— todas —</span>';
      } else if (g.obras.length === 0) {
        obrasHtml = '<span style="color:var(--sem-erro); font-size:11px;" title="Editor sem obra atribuída — não edita nada">⚠️ nenhuma obra</span>';
      } else {
        obrasHtml = g.obras.map(cod => {
          const info = obrasByCodigo[cod];
          return `<span class="badge" style="background:var(--fgr-red-light); color:var(--fgr-red-deep); margin:2px; display:inline-block;" title="${escAttr(info?.nome || cod)}"><code style="font-size:10px;">${escHtml(cod)}</code></span>`;
        }).join('');
      }
      const dt = g.adicionado_em ? new Date(g.adicionado_em).toLocaleString('pt-BR') : '—';
      return `<tr>
        <td style="font-family:monospace; font-size:12px;">${escHtml(g.email)}</td>
        <td>${escHtml(g.nome||'—')}</td>
        <td>${roleBadge}</td>
        <td>${obrasHtml}</td>
        <td style="font-size:11px; color:var(--text-soft);">${escHtml(g.observacao||'')}</td>
        <td style="font-size:11px; color:var(--text-soft);">${dt}</td>
        <td>
          <button class="btn-sm" data-action="editar-editor" data-email="${escAttr(g.email)}" style="padding:4px 10px; font-size:11px; background:var(--fgr-red-light); border:1px solid var(--fgr-red-deep); color:var(--fgr-red-deep);" title="Editar papel, obras, ou excluir">✏️ Editar</button>
        </td>
      </tr>`;
    }).join('');
  } catch(err) {
    console.warn('[ADMIN] renderEditoresAdmin erro:', err);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--sem-erro);">Erro ao carregar: ${escHtml(err.message||String(err))}</td></tr>`;
  }
}

// Event delegation para botões da tabela de editores
(function() {
  const tbody = document.getElementById('editoresAdminTbody');
  if (!tbody) return;
  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="editar-editor"]');
    if (btn) openEditorForm(btn.dataset.email);
  });
})();

// ---------- MODAL UNIFICADO ----------

// Abre o modal. Se email não informado → criando novo. Se informado → editando.
async function openEditorForm(email) {
  if (!requireAdmin('gerenciar usuários')) return;
  _editorFormEditandoEmail = email || null;
  const isEditando = !!email;

  document.getElementById('editorFormTitle').textContent = isEditando
    ? '✏️ Editar: ' + email
    : '➕ Adicionar usuário';
  document.getElementById('editorFormEmail').value = email || '';
  document.getElementById('editorFormEmail').readOnly = isEditando;
  document.getElementById('editorFormEmail').style.background = isEditando ? 'var(--bg-soft)' : '';
  document.getElementById('editorFormNome').value = '';
  document.getElementById('editorFormObs').value = '';

  // Botão excluir: só aparece se editando
  const delBtn = document.getElementById('editorFormDeleteBtn');
  if (delBtn) delBtn.style.display = isEditando ? '' : 'none';

  // Default: editor
  document.querySelector('input[name="editorFormRole"][value="editor"]').checked = true;
  document.querySelector('input[name="editorFormRole"][value="admin"]').checked = false;
  _editorFormOriginalRole = null;

  // Popular checkboxes de obras (vazias por padrão)
  await populaObrasCheckboxes(new Set());

  if (isEditando && SUPA) {
    // Buscar dados atuais do usuário
    try {
      const { data, error } = await SUPA.from('editores_permitidos')
        .select('*')
        .eq('email', email);
      if (!error && data && data.length) {
        // Nome/obs: pegar do primeiro registro que tenha
        const comNome = data.find(r => r.nome);
        const comObs = data.find(r => r.observacao);
        if (comNome) document.getElementById('editorFormNome').value = comNome.nome;
        if (comObs) document.getElementById('editorFormObs').value = comObs.observacao;
        // Papel: se qualquer linha for admin → admin
        const isAdminNow = data.some(r => r.role === 'admin');
        _editorFormOriginalRole = isAdminNow ? 'admin' : 'editor';
        document.querySelector(`input[name="editorFormRole"][value="${isAdminNow ? 'admin' : 'editor'}"]`).checked = true;
        // Obras: linhas com role=editor e codigo_obra
        const obrasAtuais = new Set(data.filter(r => r.role === 'editor' && r.codigo_obra).map(r => r.codigo_obra));
        await populaObrasCheckboxes(obrasAtuais);
      }
    } catch(e) {
      console.warn('[ADMIN] openEditorForm carga erro:', e);
    }
  }

  editorFormOnRoleChange(); // esconde/mostra bloco de obras conforme papel
  openModalLayer(document.getElementById('editorFormBackdrop'), { initialFocus: '#editorFormEmail' });
}

function closeEditorForm() {
  closeModalLayer(document.getElementById('editorFormBackdrop'), false);
  _editorFormEditandoEmail = null;
  _editorFormOriginalRole = null;
}

// Popula os checkboxes de obras (marcando as que estão no Set)
async function populaObrasCheckboxes(marcadasSet) {
  const container = document.getElementById('editorObrasCheckboxes');
  if (!container) return;
  const obrasAtivas = OBRAS.filter(o => o.ativa);
  if (obrasAtivas.length === 0) {
    container.innerHTML = '<div style="padding:8px; color:var(--text-lighter); font-size:12px;">Nenhuma obra ativa cadastrada.</div>';
    return;
  }
  container.innerHTML = obrasAtivas.map(o => {
    const checked = marcadasSet.has(o.codigo_obra) ? 'checked' : '';
    return `<label class="editor-project-option">
      <input type="checkbox" class="editor-obra-cb" value="${escAttr(o.codigo_obra)}" ${checked} style="width:16px; height:16px; cursor:pointer;">
      <code style="font-size:11px; color:var(--text-soft);">${escHtml(o.codigo_obra)}</code>
      <span style="font-size:13px;">${escHtml(o.nome)}</span>
    </label>`;
  }).join('');
}

function editorObrasMarcarTodas(marcar) {
  document.querySelectorAll('.editor-obra-cb').forEach(cb => { cb.checked = marcar; });
}

// Chamado quando radio de papel muda: esconde bloco de obras se admin
function editorFormOnRoleChange() {
  const role = document.querySelector('input[name="editorFormRole"]:checked')?.value;
  const block = document.getElementById('editorFormObrasBlock');
  if (block) block.style.display = (role === 'admin') ? 'none' : '';
}

// Salvar todas as permissões em uma única transação no banco.
async function salvarEditorForm() {
  if (!requireAdmin('salvar usuários')) return;
  const email = document.getElementById('editorFormEmail').value.trim().toLowerCase();
  const nome  = document.getElementById('editorFormNome').value.trim();
  const obs   = document.getElementById('editorFormObs').value.trim();
  const role  = document.querySelector('input[name="editorFormRole"]:checked')?.value || 'editor';
  const marcadas = [...document.querySelectorAll('.editor-obra-cb:checked')].map(cb => cb.value);

  if (!email) { authToast('⚠️ Email é obrigatório.', 'warn', 3000); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { authToast('⚠️ Email inválido.', 'warn', 3000); return; }
  if (!SUPA) { authToast('❌ Sem conexão com Supabase.', 'err', 3000); return; }

  try {
    const { error } = await SUPA.rpc('admin_replace_user_permissions', {
      p_email: email,
      p_nome: nome || null,
      p_observacao: obs || null,
      p_role: role,
      p_codigos_obra: role === 'editor' ? marcadas : [],
    });
    if (error) throw new Error(getAdminRpcErrorMessage(error));

    const resumo = role === 'admin'
      ? 'Salvo como 👑 Admin'
      : (marcadas.length === 0 ? 'Salvo como ✏️ Editor sem obras' : `Salvo como ✏️ Editor de ${marcadas.length} obra(s)`);
    authToast('✅ ' + resumo, 'ok', 3000);
    closeEditorForm();
    await renderEditoresAdmin();
  } catch(e) {
    console.warn('[ADMIN] salvarEditorForm erro:', e);
    authToast('❌ Erro ao salvar: ' + (e.message||e), 'err', 5000);
  }
}

// Excluir usuário direto do modal (com confirmação)
async function excluirUsuarioDoModal() {
  if (!requireAdmin('excluir usuários')) return;
  const email = _editorFormEditandoEmail;
  if (!email || !SUPA) return;
  const confirmed = await confirmModal(
    'Excluir permissões do usuário',
    `Excluir TODAS as permissões de ${email}?\n\nO usuário some da whitelist. A conta em auth.users continua existindo e poderá voltar como pendente.\n\nEsta ação é irreversível.`,
    { confirmText: 'Excluir usuário', requireText: email }
  );
  if (!confirmed) return;
  try {
    const { error } = await SUPA.rpc('admin_delete_user_permissions', { p_email: email });
    if (error) throw new Error(getAdminRpcErrorMessage(error));
    authToast('🗑️ Usuário removido da whitelist', 'ok', 3000);
    closeEditorForm();
    await renderEditoresAdmin();
  } catch(e) {
    console.warn('[ADMIN] excluirUsuarioDoModal erro:', e);
    authToast('❌ Erro ao excluir: ' + (e.message||e), 'err', 5000);
  }
}

// -------------- PENDENTES (v0.62) --------------

async function renderPendentesAdmin() {
  const tbody = document.getElementById('pendentesAdminTbody');
  const badge = document.getElementById('pendentesCount');
  if (!tbody) return;
  if (!isAdminGeral()) {
    if (badge) badge.textContent = '';
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-soft);">Acesso restrito a administradores.</td></tr>';
    return;
  }
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-lighter);">carregando…</td></tr>';
  if (!SUPA) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--sem-erro);">Sem conexão com o Supabase.</td></tr>';
    return;
  }
  try {
    const { data, error } = await SUPA.from('editores_permitidos')
      .select('*')
      .eq('role', 'pending')
      .eq('status', 'active')
      .order('adicionado_em', { ascending: true });
    if (error) throw error;
    if (badge) badge.textContent = data?.length ? `(${data.length})` : '';
    if (!data || !data.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-lighter);">Nenhum cadastro aguardando aprovação. 🎉</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(e => {
      const dt = e.adicionado_em ? new Date(e.adicionado_em).toLocaleString('pt-BR') : '—';
      return `<tr>
        <td style="font-family:monospace; font-size:12px;">${escHtml(e.email)}</td>
        <td>${escHtml(e.nome||'—')}</td>
        <td style="font-size:11px; color:var(--text-soft);">${escHtml(e.observacao||'')}</td>
        <td style="font-size:11px; color:var(--text-soft);">${dt}</td>
        <td>
          <button class="btn-sm" data-action="aprovar-pendente" data-email="${escAttr(e.email)}" style="padding:3px 8px; font-size:11px; background:var(--sem-ok-bg); border:1px solid var(--sem-ok-border); color:var(--sem-ok-text);" title="Definir papel e aprovar">✅ Aprovar</button>
          <button class="btn-sm" data-action="rejeitar-pendente" data-email="${escAttr(e.email)}" style="padding:3px 8px; font-size:11px; background:var(--fgr-red-light); border:1px solid var(--sem-erro); color:var(--sem-erro);" title="Negar acesso">❌ Rejeitar</button>
        </td>
      </tr>`;
    }).join('');
  } catch(err) {
    console.warn('[ADMIN] renderPendentesAdmin erro:', err);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--sem-erro);">Erro: ${escHtml(err.message||String(err))}</td></tr>`;
  }
}

// Event delegation para botões da tabela de pendentes
(function() {
  const tbody = document.getElementById('pendentesAdminTbody');
  if (!tbody) return;
  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const email = btn.dataset.email;
    if (action === 'aprovar-pendente') aprovarPendente(email);
    else if (action === 'rejeitar-pendente') rejeitarPendente(email);
  });
})();

async function aprovarPendente(email) {
  if (!requireAdmin('aprovar cadastros')) return;
  // aprova como editor SEM obra (admin define depois via botão 🏗️)
  if (!SUPA) return;
  const confirmed = await confirmModal(
    'Aprovar cadastro',
    `Aprovar ${email} como editor?\n\nEle entra sem acesso a nenhuma obra. Depois, escolha quais obras ele pode editar.`,
    { confirmText: 'Aprovar', destructive: false }
  );
  if (!confirmed) return;
  try {
    const { error } = await SUPA.from('editores_permitidos').update({
      role: 'editor',
      codigo_obra: null,
      aprovado_em: new Date().toISOString(),
      aprovado_por: AUTH?.user?.email || null,
    }).eq('email', email).eq('role', 'pending');
    if (error) throw error;
    authToast('✅ Aprovado como editor sem escopo. Defina as obras dele em Editores.', 'ok', 4000);
    await renderPendentesAdmin();
    await renderEditoresAdmin();
  } catch(e) {
    console.warn('[ADMIN] aprovarPendente erro:', e);
    authToast('❌ Erro ao aprovar: ' + (e.message||e), 'err', 5000);
  }
}

async function rejeitarPendente(email) {
  if (!requireAdmin('rejeitar cadastros')) return;
  if (!SUPA) return;
  const confirmed = await confirmModal(
    'Rejeitar cadastro',
    `Rejeitar o cadastro de ${email}?\n\nO usuário continua com conta no sistema, mas não receberá permissão de edição.`,
    { confirmText: 'Rejeitar' }
  );
  if (!confirmed) return;
  try {
    const { error } = await SUPA.from('editores_permitidos').update({
      status: 'rejected',
      aprovado_em: new Date().toISOString(),
      aprovado_por: AUTH?.user?.email || null,
    }).eq('email', email).eq('role', 'pending');
    if (error) throw error;
    authToast('❌ Cadastro rejeitado', 'warn', 2500);
    await renderPendentesAdmin();
  } catch(e) {
    console.warn('[ADMIN] rejeitarPendente erro:', e);
    authToast('❌ Erro ao rejeitar: ' + (e.message||e), 'err', 5000);
  }
}

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

// ---------- FLOW CLASSIFICATIONS ----------
// (formato antigo em localStorage: {n_alteracao: {campo: valor, ...}})
// no Supabase: 1 linha por n_alteracao com colunas
async function supaLoadClassifications() {
  if (!SUPA) return null;
  if (!OBRA_ATIVA) return null;
  try {
    const { data, error } = await supaRetry(function() {
      return SUPA.from('flow_classifications')
        .select('codigo_obra,n_alteracao,insumo_planejamento,insumo_remanejamento,custo_flowmaster,refletido_status')
        .eq('codigo_obra', OBRA_ATIVA);
    });
    if (error) { console.warn('[SUPA] loadClass err:', error); SUPA_STATUS.lastError = error.message; return null; }
    const map = {};
    data.forEach(r => {
      const k = (r.codigo_obra || '') + ':' + r.n_alteracao;
      map[k] = {
        codigo_obra: r.codigo_obra,
        insumo_planejamento: r.insumo_planejamento,
        insumo_remanejamento: r.insumo_remanejamento,
        custo_flowmaster: r.custo_flowmaster,
        refletido_status: r.refletido_status,
        refletido: r.refletido_status === 'sim',
      };
    });
    SUPA_STATUS.lastSync = new Date();
    return map;
  } catch(e) {
    console.warn('[SUPA] loadClass err (após retries):', e);
    SUPA_STATUS.lastError = e.message;
    return null;
  }
}
async function supaPatchClassification(nAlt, patch, codigoObraArg) {
  if (!SUPA || !isEditorDaObraAtiva()) return;
  const codigoObra = codigoObraArg || OBRA_ATIVA;
  if (!codigoObra) { console.warn('[SUPA] patchClass: sem codigo_obra'); return; }
  if (codigoObra !== OBRA_ATIVA) { console.warn('[SUPA] patchClass: obra fora do escopo ativo'); return; }

  const allowedFields = new Set([
    'insumo_planejamento',
    'insumo_remanejamento',
    'custo_flowmaster',
    'refletido_status',
  ]);
  const fields = Object.fromEntries(
    Object.entries(patch || {}).filter(([field]) => allowedFields.has(field))
  );
  if (!Object.keys(fields).length) return;

  const updatePatch = {
    ...fields,
    updated_at: new Date().toISOString(),
  };
  if (AUTH.user?.email) updatePatch.updated_by = AUTH.user.email;

  const updateExisting = () => SUPA.from('flow_classifications')
    .update(updatePatch)
    .eq('codigo_obra', codigoObra)
    .eq('n_alteracao', nAlt)
    .select('codigo_obra,n_alteracao')
    .maybeSingle();

  let { data, error } = await updateExisting();
  if (!error && !data) {
    const inserted = await SUPA.from('flow_classifications').insert({
      codigo_obra: codigoObra,
      n_alteracao: nAlt,
      ...updatePatch,
    });
    error = inserted.error;

    // Outra sessão pode criar a mesma chave entre o UPDATE e o INSERT.
    if (error?.code === '23505') {
      ({ error } = await updateExisting());
    }
  }

  if (error) {
    SUPA_STATUS.lastError = error.message;
    updateSupaBadge();
    throw error;
  }
  SUPA_STATUS.lastError = null;
  SUPA_STATUS.lastSync = new Date();
  updateSupaBadge();
}

// ---------- FLOW MANUALS ----------
async function supaLoadManuals() {
  if (!SUPA) return null;
  if (!OBRA_ATIVA) return null;
  try {
    const { data, error } = await supaRetry(function() {
      return SUPA.from('flow_manuals').select('*').eq('codigo_obra', OBRA_ATIVA);
    });
    if (error) { console.warn('[SUPA] loadManuals err:', error); return null; }
    return data.map(r => ({
      n_alteracao: r.n_alteracao,
      n_adt: r.n_adt || '', dep: r.dep || '',
      descricao: r.descricao || '', data_br: r.data_br || '', data: r.data || '',
      aprovador_dep: r.aprovador_dep || '', aprovador: r.aprovador || '',
      solicitante_dep: r.solicitante_dep || '', solicitante: r.solicitante || '',
      custo_flowmaster: r.custo_flowmaster, custo_planejamento: r.custo_planejamento,
      motivo: r.motivo || '', justificativa: r.justificativa || '',
      insumo_planejamento: r.insumo_planejamento || '', insumo_remanejamento: r.insumo_remanejamento || '',
      obs: r.obs || '',
      // campos vazios para compat
      incl_orcamento: '', incl_planej: '', incl_tendencia: '', revisao_tendencia: '',
    }));
  } catch(e) {
    console.warn('[SUPA] loadManuals err (após retries):', e);
    return null;
  }
}
async function supaUpsertManual(m) {
  if (!SUPA || !isEditorDaObraAtiva()) return;
  if (!OBRA_ATIVA) { console.warn('[SUPA] upsertManual: sem OBRA_ATIVA'); return; }
  const { error } = await SUPA.from('flow_manuals').upsert({
    codigo_obra: OBRA_ATIVA,
    n_alteracao: m.n_alteracao,
    n_adt: m.n_adt, dep: m.dep, descricao: m.descricao,
    data: m.data, data_br: m.data_br,
    aprovador_dep: m.aprovador_dep, aprovador: m.aprovador,
    solicitante_dep: m.solicitante_dep, solicitante: m.solicitante,
    custo_flowmaster: m.custo_flowmaster, custo_planejamento: m.custo_planejamento,
    motivo: m.motivo, justificativa: m.justificativa,
    insumo_planejamento: m.insumo_planejamento, insumo_remanejamento: m.insumo_remanejamento,
    obs: m.obs,
  }, { onConflict: 'codigo_obra,n_alteracao' });
  if (error) { SUPA_STATUS.lastError = error.message; updateSupaBadge(); throw error; }
  else SUPA_STATUS.lastSync = new Date();
  updateSupaBadge();
}
async function supaDeleteManual(nAlt) {
  if (!SUPA || !isEditorDaObraAtiva()) return;
  if (!OBRA_ATIVA) return;
  const { error } = await SUPA.from('flow_manuals').delete()
    .eq('codigo_obra', OBRA_ATIVA).eq('n_alteracao', nAlt);
  if (error) { SUPA_STATUS.lastError = error.message; updateSupaBadge(); throw error; }
  else SUPA_STATUS.lastSync = new Date();
  updateSupaBadge();
}

// ---------- PROJECAO CONFIG (linha única id=1) ----------
async function supaLoadProjConfig() {
  if (!SUPA) return null;
  if (!OBRA_ATIVA) return null;
  try {
    const { data, error } = await supaRetry(function() {
      return SUPA.from('projecao_config').select('*').eq('codigo_obra', OBRA_ATIVA).maybeSingle();
    });
    if (error) { console.warn('[SUPA] loadProjConfig err:', error); return null; }
    return data;
  } catch(e) {
    console.warn('[SUPA] loadProjConfig err (após retries):', e);
    return null;
  }
}
async function supaSaveProjConfig(cfg) {
  if (!SUPA || !isEditorDaObraAtiva()) return;
  if (!OBRA_ATIVA) { console.warn('[SUPA] saveProjConfig: sem OBRA_ATIVA'); return; }
  const _locks = cfg.locks || { saldo: false, data: false, insumo: false };
  const { error } = await SUPA.from('projecao_config').upsert({
    codigo_obra: OBRA_ATIVA,
    insumo_controlado: cfg.insumo || 'I011890',
    saldo_inicial: cfg.saldo_inicial ?? null,
    data_ref: cfg.data_ref || null,
    locked_saldo: !!_locks.saldo,
    locked_data: !!_locks.data,
    locked_insumo: !!_locks.insumo,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'codigo_obra' });
  if (error) { SUPA_STATUS.lastError = error.message; updateSupaBadge(); throw error; }
  else SUPA_STATUS.lastSync = new Date();
  updateSupaBadge();
}

// ---------- PROJECAO MOVIMENTACOES ----------
async function supaLoadMovs() {
  if (!SUPA) return null;
  if (!OBRA_ATIVA) return null;
  const { data, error } = await SUPA.from('projecao_movimentacoes')
    .select('*').eq('codigo_obra', OBRA_ATIVA);
  if (error) { console.warn('[SUPA] loadMovs err:', error); return null; }
  return data.map(r => ({
    id: r.id, tipo: r.tipo, data: r.data, data_br: r.data_br,
    origem: r.origem, destino: r.destino, descricao: r.descricao,
    justificativa: r.justificativa, responsavel: r.responsavel, valor: r.valor,
  }));
}
async function supaUpsertMov(m) {
  if (!SUPA || !isEditorDaObraAtiva()) return;
  if (!OBRA_ATIVA) { console.warn('[SUPA] upsertMov: sem OBRA_ATIVA'); return; }
  const { error } = await SUPA.from('projecao_movimentacoes').upsert({
    codigo_obra: OBRA_ATIVA,
    id: m.id, tipo: m.tipo, data: m.data, data_br: m.data_br,
    origem: m.origem, destino: m.destino, descricao: m.descricao,
    justificativa: m.justificativa, responsavel: m.responsavel, valor: m.valor,
  }, { onConflict: 'id' });
  if (error) { SUPA_STATUS.lastError = error.message; updateSupaBadge(); throw error; }
  else SUPA_STATUS.lastSync = new Date();
  updateSupaBadge();
}
async function supaDeleteMov(id) {
  if (!SUPA || !isEditorDaObraAtiva()) return;
  if (!OBRA_ATIVA) return;
  const { error } = await SUPA.from('projecao_movimentacoes').delete()
    .eq('codigo_obra', OBRA_ATIVA).eq('id', id);
  if (error) { SUPA_STATUS.lastError = error.message; updateSupaBadge(); throw error; }
  else SUPA_STATUS.lastSync = new Date();
  updateSupaBadge();
}

// ---------- DASHBOARD CONFIG (chave/valor genérico) ----------
async function supaLoadDashboardConfig() {
  if (!SUPA) return {};
  if (!OBRA_ATIVA) return {};
  const prefix = `${OBRA_ATIVA}:`;
  const requiredKeys = [
    'header_title',
    'indice_correcao',
    'card3_modo',
    DATA_KEYS.DATA_F,
    DATA_KEYS.HISTORICO,
    DATA_KEYS.PROJ_RAW,
    prefix + 'evol_global',
    prefix + DATA_KEYS.GESTAO_LABEL,
    prefix + DATA_KEYS.DATA_T,
    prefix + DATA_KEYS.DATA_F,
  ];
  try {
    const { data, error } = await supaRetry(function() {
      return SUPA.from('dashboard_config')
        .select('chave,valor')
        .in('chave', requiredKeys);
    });
    if (error) { console.warn('[SUPA] loadCfg err:', error); return {}; }
    const map = {};
    data.forEach(r => { map[r.chave] = r.valor; });
    return map;
  } catch(e) {
    console.warn('[SUPA] loadCfg err (após retries):', e);
    return {};
  }
}
async function supaSaveDashboardKey(chave, valor) {
  if (!SUPA) return;
  const chaveStr = String(chave || '');
  const codigoObra = chaveStr.includes(':') ? chaveStr.split(':', 1)[0] : null;
  const canEditKey = isAdminGeral()
    || (codigoObra === OBRA_ATIVA && isEditorDaObraAtiva());
  if (!canEditKey) return;
  const { error } = await SUPA.from('dashboard_config').upsert({
    chave, valor: String(valor||''), updated_at: new Date().toISOString(),
  }, { onConflict: 'chave' });
  if (error) {
    SUPA_STATUS.lastError = error.message || String(error);
    updateSupaBadge();
    throw error;
  }
  SUPA_STATUS.lastError = null;
  SUPA_STATUS.lastSync = new Date();
  updateSupaBadge();
}

// ============================================================
// v0.56 — Persistir dados parseados (Tendência, Flows, Histórico, PROJ_RAW)
// Salvos como chave/valor em dashboard_config, JSON stringified.
// Sobrevive a refresh e fica disponível em qualquer máquina.
// ============================================================

// Chaves de persistência
const DATA_KEYS = {
  DATA_T: 'dados_tendencia',
  DATA_F: 'dados_flows',
  HISTORICO: 'dados_historico',
  PROJ_RAW: 'dados_projraw',
  GESTAO_LABEL: 'gestao_label',
};

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

function syncEditingControls() {
  const canEdit = isEditorDaObraAtiva();
  document.querySelectorAll('[data-edit-control]').forEach(el => {
    el.disabled = !canEdit;
  });
  document.querySelectorAll('[data-admin-control]').forEach(el => {
    el.disabled = !isAdminGeral();
  });
  if (!canEdit && typeof MASS_SELECTED !== 'undefined') {
    MASS_SELECTED.clear();
    const massBar = document.getElementById('massBar');
    if (massBar) {
      massBar.style.display = 'none';
      massBar.replaceChildren();
    }
  }
  if (typeof applyLocksToUI === 'function') applyLocksToUI();
}

function updateAuthUI() {
  const badge = document.getElementById('authBadge');
  const btn = document.getElementById('authBtn');
  if (!badge || !btn) return;

  // só marca is-editor se o usuário pode editar a OBRA_ATIVA
  // (antes marcava se era editor de QUALQUER obra — mostrava botões que a RLS rejeitava depois)
  document.body.classList.toggle('is-editor', isEditorDaObraAtiva());
  document.body.classList.toggle('is-admin-geral', !!AUTH.isAdminGeral);
  syncEditingControls();

  if (!AUTH.ready) {
    badge.className = 'auth-badge pending';
    badge.textContent = '⏳ Verificando...';
    badge.title = 'Verificando sessão de login';
    btn.style.display = 'none';
    return;
  }

  if (AUTH.user) {
    // Logado — badge com 2 linhas: email + chip de papel
    const email = AUTH.user.email || 'usuário';
    const shortEmail = email.length > 26 ? email.slice(0, 24) + '…' : email;
    if (AUTH.isAdminGeral) {
      badge.className = 'auth-badge editor two-line';
      badge.innerHTML = `<span class="auth-email">👑 ${escHtml(shortEmail)}</span><span class="auth-role">Admin</span>`;
      badge.title = `Logado como ${email}\nModo: Admin (edita tudo + gerencia obras/usuários)`;
    } else if (AUTH.isEditor) {
      const podeEditarAqui = isEditorDaObraAtiva();
      if (podeEditarAqui) {
        badge.className = 'auth-badge editor two-line';
        badge.innerHTML = `<span class="auth-email">✏️ ${escHtml(shortEmail)}</span><span class="auth-role">Editor</span>`;
        badge.title = `Logado como ${email}\nModo: Editor (pode alterar esta obra)\nObras que edita: ${AUTH.editaObras.join(', ')||'—'}`;
      } else {
        // é editor mas não desta obra — mostra como somente leitura aqui
        badge.className = 'auth-badge viewer two-line';
        badge.innerHTML = `<span class="auth-email">👁️ ${escHtml(shortEmail)}</span><span class="auth-role">Só leitura aqui</span>`;
        const listaObras = AUTH.editaObras.length ? AUTH.editaObras.join(', ') : 'nenhuma';
        badge.title = `Logado como ${email}\nVocê é editor de: ${listaObras}\nMas NÃO desta obra (${OBRA_ATIVA||'—'})\nTroque no dropdown pra editar suas obras`;
      }
    } else if (AUTH.isPending) {
      badge.className = 'auth-badge viewer two-line';
      badge.innerHTML = `<span class="auth-email">⏳ ${escHtml(shortEmail)}</span><span class="auth-role">Aguardando</span>`;
      badge.title = `Logado como ${email}\nAguardando aprovação do admin`;
    } else {
      badge.className = 'auth-badge viewer two-line';
      badge.innerHTML = `<span class="auth-email">👁️ ${escHtml(shortEmail)}</span><span class="auth-role">Sem permissão</span>`;
      badge.title = `Logado como ${email}\nModo: Somente leitura`;
    }
    btn.style.display = '';
    btn.textContent = '🚪 Sair';
    btn.title = 'Sair da conta';
  } else {
    // Deslogado
    badge.className = 'auth-badge viewer';
    badge.textContent = '👁️ Visualização';
    badge.title = 'Você está vendo o dashboard sem estar logado.\nFaça login para editar (se tiver permissão).';
    btn.style.display = '';
    btn.textContent = '🔑 Entrar';
    btn.title = 'Entrar com Google para editar';
  }
}

function handleAuthServiceStateChanged({ isFreshLogin = false } = {}) {
  if (isFreshLogin && AUTH.user) {
    if (!AUTH.isEditor) {
      authToast(`👁️ Logado como ${AUTH.user.email}, mas sem permissão para editar. Fale com o admin para adicionar seu email.`, 'warn', 6000);
    } else {
      authToast(`✏️ Bem-vindo, ${AUTH.user.email}! Você pode editar.`, 'ok', 3000);
    }
  }

  updateAuthUI();
  try {
    if (typeof renderFlows === 'function') renderFlows();
    if (typeof renderProjCtrl === 'function' && document.getElementById('projCtrlMovsList')) renderProjCtrl();
    if (typeof renderUploadsCentral === 'function') renderUploadsCentral();
  } catch(e){ reportNonFatalError('Auth/atualizar interface', e); }
}

// ---- GUARD helper: uso nos handlers de edição ----
function requireEditorForActiveProject(actionDesc) {
  if (isEditorDaObraAtiva()) return true;
  if (!AUTH.user) {
    authToast('🔑 Faça login para ' + (actionDesc || 'editar'), 'warn', 3500);
  } else if (AUTH.isEditor) {
    authToast('🚫 Sua conta não pode ' + (actionDesc || 'editar') + ' nesta obra.', 'err', 4500);
  } else {
    authToast('🚫 Sua conta não tem permissão para editar. Fale com o admin.', 'err', 4500);
  }
  return false;
}

function requireEditor(actionDesc) {
  return requireEditorForActiveProject(actionDesc);
}

function requireAdmin(actionDesc) {
  if (isAdminGeral()) return true;
  if (!AUTH || !AUTH.ready) {
    authToast('⏳ Aguarde a verificação da sua sessão.', 'warn', 2500);
  } else if (!AUTH.user) {
    authToast('🔑 Faça login como administrador para ' + (actionDesc || 'continuar'), 'warn', 3500);
  } else {
    authToast('🚫 Apenas administradores podem ' + (actionDesc || 'realizar esta ação') + '.', 'err', 4500);
  }
  return false;
}

function isGlobalUploadKind(kind) {
  return kind === 'excel' || kind === 'flows' || kind === 'gestoes';
}

function requireUploadPermission(kind, actionDesc) {
  return isGlobalUploadKind(kind)
    ? requireAdmin(actionDesc)
    : requireEditorForActiveProject(actionDesc);
}

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

// ============ HEADER EDITÁVEL + SUBTÍTULO DINÂMICO ============
// (declarado em CONFIG no topo)
// Carregar título salvo (se houver)
(function loadSavedHeader() {
  try {
    const saved = localStorage.getItem(HEADER_KEY);
    if (saved) {
      const el = document.getElementById('headerTitle');
      if (el) el.textContent = saved;
    }
  } catch(e) { reportNonFatalError('Header/restaurar título', e); }
})();

// ============ MODO NOTURNO ============
function toggleTheme() {
  const isDark = document.body.classList.toggle('dark');
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.textContent = isDark ? '☀️' : '🌙';
    btn.setAttribute('aria-label', isDark ? 'Ativar modo claro' : 'Ativar modo escuro');
  }
  SafeStorage.set('jzurique_theme', isDark ? 'dark' : 'light');
}

// Restaurar tema no boot
(function() {
  try {
    const saved = localStorage.getItem('jzurique_theme');
    if (saved === 'dark') {
      document.body.classList.add('dark');
      const btn = document.getElementById('themeToggle');
      if (btn) {
        btn.textContent = '☀️';
        btn.setAttribute('aria-label', 'Ativar modo claro');
      }
    }
  } catch(e) { reportNonFatalError('Tema/restaurar preferência', e); }
})();

// _headerEditable declarado na seção ESTADO GLOBAL acima
function toggleHeaderEdit() {
  const el = document.getElementById('headerTitle');
  const btn = document.getElementById('headerLockBtn');
  if (!el || !btn) return;
  if (!_headerEditable && !requireAdmin('editar o título global')) return;
  _headerEditable = !_headerEditable;
  if (_headerEditable) {
    el.contentEditable = 'true';
    el.style.cursor = 'text';
    el.style.background = 'rgba(255,255,255,0.15)';
    el.style.padding = '2px 8px';
    el.style.borderRadius = '4px';
    el.style.outline = '2px solid rgba(255,255,255,0.5)';
    el.focus();
    // Selecionar todo o conteúdo
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    btn.textContent = '💾 Salvar';
    btn.title = 'Salvar e travar edição';
  } else {
    el.contentEditable = 'false';
    el.style.cursor = 'default';
    el.style.background = '';
    el.style.padding = '';
    el.style.borderRadius = '';
    el.style.outline = 'none';
    const _t = el.textContent.trim();
    SafeStorage.set(HEADER_KEY, _t);
    void runAsyncSafely(supaSaveDashboardKey('header_title', _t), 'Config/salvar título', 'O título foi salvo apenas neste navegador.');
    btn.textContent = '🔒 Editar';
    btn.title = 'Editar título';
  }
}
// Salvar também ao apertar Enter
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && _headerEditable && document.activeElement && document.activeElement.id === 'headerTitle') {
    e.preventDefault();
    toggleHeaderEdit();
  }
});

// Atualiza o subtítulo (dataRef) com o GESTAO_LABEL atual
function refreshHeaderSubtitle() {
  const el = document.getElementById('dataRef');
  if (el && typeof GESTAO_LABEL === 'string') {
    el.textContent = GESTAO_LABEL;
  }
}

// Verifica se os dados estão desatualizados e mostra aviso
function verificarDadosDesatualizados() {
  if (!GESTAO_LABEL || typeof GESTAO_LABEL !== 'string') return;
  const m = GESTAO_LABEL.match(/GEST[ÃA]O\s+(\d{2})-(\d{4})/i);
  if (!m) return;
  
  const mesGestao = parseInt(m[1], 10);
  const anoGestao = parseInt(m[2], 10);
  const hoje = new Date();
  const mesAtual = hoje.getMonth() + 1;
  const anoAtual = hoje.getFullYear();
  
  const mesesAtras = (anoAtual - anoGestao) * 12 + (mesAtual - mesGestao);
  
  const bannerEl = document.getElementById('alertBanner');
  if (!bannerEl) return;
  
  if (mesesAtras > 3) {
    // Mais de 3 meses: vermelho
    bannerEl.innerHTML = '<div class="alert-banner" style="background:linear-gradient(90deg, var(--sem-erro-bg) 0%, var(--sem-erro-border) 100%); border-left-color:var(--sem-erro-vivid);">'
      + '🔴 <strong>Dados muito desatualizados:</strong> último mês de gestão é <strong>' + m[1] + '/' + m[2] + '</strong> (' + mesesAtras + ' meses atrás). '
      + 'Atualize os dados na aba <a href="#" data-click-action="irParaAba" data-action-mode="arg" data-action-arg="uploads" style="color:var(--sem-erro-vivid); font-weight:700;">📤 Uploads</a>.</div>';
  } else if (mesesAtras > 2) {
    // Mais de 2 meses: amarelo
    bannerEl.innerHTML = '<div class="alert-banner">'
      + '⚠️ <strong>Dados desatualizados:</strong> último mês de gestão é <strong>' + m[1] + '/' + m[2] + '</strong> (' + mesesAtras + ' meses atrás). '
      + 'Considere atualizar na aba <a href="#" data-click-action="irParaAba" data-action-mode="arg" data-action-arg="uploads" style="color:var(--sem-alerta-text); font-weight:700;">📤 Uploads</a>.</div>';
  } else {
    bannerEl.replaceChildren();
  }
}

// ============ TABS ============
// Salvar aba ativa no localStorage
function salvarAbaAtiva(tabName) {
  SafeStorage.set('jzurique_active_tab', tabName);
}

// Restaurar aba ativa do localStorage
function restaurarAbaAtiva() {
  try {
    const saved = localStorage.getItem('jzurique_active_tab');
    if (saved) {
      if (saved === 'admin' && !isAdminGeral()) {
        SafeStorage.remove('jzurique_active_tab');
        return;
      }
      const tab = document.querySelector('.tab[data-tab="' + saved + '"]');
      if (tab) tab.click();
    }
  } catch(e) { reportNonFatalError('Abas/restaurar aba ativa', e); }
}

function activateTab(tab) {
  if (tab.dataset.tab === 'admin' && !requireAdmin('acessar a administração')) return false;

  document.querySelectorAll('.tab').forEach(item => {
    const isActive = item === tab;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-selected', String(isActive));
    item.tabIndex = isActive ? 0 : -1;
  });
  document.querySelectorAll('.tab-content').forEach(panel => {
    panel.classList.toggle('active', panel.id === 'tab-' + tab.dataset.tab);
  });

  salvarAbaAtiva(tab.dataset.tab);
  if (typeof renderTab === 'function') renderTab(tab.dataset.tab);
  if (tab.dataset.tab === 'admin') {
    if (typeof renderPendentesAdmin === 'function') renderPendentesAdmin();
    if (typeof renderObrasAdmin === 'function') renderObrasAdmin();
    if (typeof renderEditoresAdmin === 'function') renderEditoresAdmin();
  }
  return true;
}

function getVisibleTabs() {
  return Array.from(document.querySelectorAll('.tab')).filter(tab => tab.offsetParent !== null);
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = getVisibleTabs();
    const currentIndex = tabs.indexOf(tab);
    if (currentIndex < 0) return;

    event.preventDefault();
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;

    const nextTab = tabs[nextIndex];
    if (activateTab(nextTab)) {
      nextTab.focus();
      nextTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  });
});

// ============ VISÃO GERAL ============
// LIC_LABEL, GESTAO_LABEL, EVOL_GLOBAL, CARD3_MODO, CORRECAO_INDICE
// declarados na seção ESTADO GLOBAL acima

function setCard3Modo(v) {
  CARD3_MODO = v;
  SafeStorage.set('jzurique_card3_modo', v);
  if (isAdminGeral()) {
    void runAsyncSafely(supaSaveDashboardKey('card3_modo', v), 'Config/salvar modo do card', 'A configuração foi salva apenas neste navegador.');
  }
  if (typeof renderVisao === 'function') renderVisao();
}

function setCorrecaoIndice(v) {
  CORRECAO_INDICE = v;
  SafeStorage.set('jzurique_indice_correcao', v);
  if (isAdminGeral()) {
    void runAsyncSafely(supaSaveDashboardKey('indice_correcao', v), 'Config/salvar índice', 'O índice foi salvo apenas neste navegador.');
  }
  if (Array.isArray(DATA_T)) {
    DATA_T.forEach(d => {
      d.licitacao_corrigido = (v === 'ipca') ? d.corrigido_ipca : d.corrigido_incc;
    });
  }
  if (typeof renderVisao === 'function') renderVisao();
}

// v0.55 — Card 4: Aderência Físico-Financeira (Prevision)
// Compara Evolução Teórica (cronograma) vs Evolução Financeira (gastos).
// Valores vêm do subheader (linha 1) do CSV Tendência — só obra civil, sem indiretos.
function renderCardAderencia() {
  const evol = (typeof EVOL_GLOBAL !== 'undefined') ? EVOL_GLOBAL : { teorica: null, financeira: null };
  const teor = evol.teorica;
  const fin  = evol.financeira;
  if (teor == null && fin == null) {
    // placeholder amigável em vez de esconder o card
    return `
    <div class="kpi kpi-wide" style="opacity:0.85;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <div class="label" style="margin:0;">🏗️ Aderência Físico-Financeira</div>
        <span style="font-size:10px; color:var(--text-soft); background:var(--bg-soft); padding:2px 8px; border-radius:8px; font-weight:600;">Prevision</span>
      </div>
      <div style="padding:22px 8px; text-align:center; color:var(--text-lighter); font-size:13px;">
        📭 <strong>Aguardando dados</strong><br>
        <span style="font-size:11.5px;">Envie a aba TENDÊNCIA no formato v0.55 (com colunas EVOLUÇÃO TEÓRICA e EVOLUÇÃO FINANCEIRA)</span>
      </div>
    </div>`;
  }
  const delta = (teor != null && fin != null) ? (fin - teor) : null;
  const absD  = delta != null ? Math.abs(delta) : null;

  // Semáforo: verde ≤5pp, amber 5-15pp, red >15pp
  let sema, semaLabel, semaCls, ico;
  if (absD == null) { sema = 'var(--text-soft)'; semaLabel = 'sem comparativo'; semaCls = ''; ico = '⚪'; }
  else if (absD <= 5)  { sema = 'var(--sem-ok)'; semaLabel = 'Dentro do esperado'; semaCls = 'green'; ico = '🟢'; }
  else if (absD <= 15) { sema = 'var(--sem-alerta)'; semaLabel = 'Descolamento moderado'; semaCls = 'amber'; ico = '🟡'; }
  else                 { sema = 'var(--sem-erro)'; semaLabel = 'Descolamento crítico';  semaCls = 'red';   ico = '🔴'; }

  // Interpretação
  let interp = '';
  if (delta != null) {
    if (delta > 0.5) {
      interp = `Gastando mais rápido do que executando (financeiro adiantado ${delta.toFixed(2)}pp)`;
    } else if (delta < -0.5) {
      interp = `Executando mais rápido do que gastando (físico adiantado ${Math.abs(delta).toFixed(2)}pp)`;
    } else {
      interp = 'Físico e financeiro caminhando alinhados';
    }
  }

  const fmtPP = v => v == null ? '-' : v.toFixed(2) + 'pp';
  const fmtPct = v => v == null ? '-' : v.toFixed(2) + '%';

  return `
    <div class="kpi kpi-wide ${semaCls}">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <div class="label" style="margin:0;">🏗️ Aderência Físico-Financeira</div>
        <span style="font-size:10px; color:var(--text-soft); background:var(--bg-soft); padding:2px 8px; border-radius:8px; font-weight:600;" title="Fonte: Prevision (aba TENDÊNCIA). Indiretos não entram nesta conta.">Prevision</span>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr auto; gap:12px; align-items:baseline; margin:10px 0 6px;">
        <div>
          <div style="font-size:10px; text-transform:uppercase; color:var(--text-soft); font-weight:600; letter-spacing:0.3px;">🎯 Teórica</div>
          <div style="font-size:22px; font-weight:700; color:var(--fgr-red);">${fmtPct(teor)}</div>
          <div style="font-size:10.5px; color:var(--text-soft);">cronograma físico</div>
        </div>
        <div>
          <div style="font-size:10px; text-transform:uppercase; color:var(--text-soft); font-weight:600; letter-spacing:0.3px;">💰 Financeira</div>
          <div style="font-size:22px; font-weight:700; color:var(--sem-alerta);">${fmtPct(fin)}</div>
          <div style="font-size:10.5px; color:var(--text-soft);">% da licitação gasto</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:10px; text-transform:uppercase; color:var(--text-soft); font-weight:600; letter-spacing:0.3px;">Δ</div>
          <div style="font-size:22px; font-weight:700; color:${sema};">${delta != null ? (delta >= 0 ? '+' : '') + fmtPP(delta) : '-'}</div>
          <div style="font-size:10.5px; color:${sema};">${ico} ${semaLabel}</div>
        </div>
      </div>
      ${interp ? `<div style="padding:8px 10px; background:var(--bg-page); border-radius:5px; font-size:11.5px; color:var(--text-medium); margin-top:6px;">💡 ${interp}</div>` : ''}
      <div style="font-size:10.5px; color:var(--text-lighter); margin-top:6px; font-style:italic;">
        ℹ️ Custos indiretos <strong>não</strong> entram nesta comparação (base: obra civil)
      </div>
    </div>`;
}

// v0.57.2 — Função que estava faltando! (usada em renderProjecao na aba Tendência de Obra)
// Renderiza o card de Aderência Físico × Financeira dentro da aba de Tendência de Obra.
function renderAderenciaProj() {
  const el = document.getElementById('cardAderenciaProj');
  if (!el) return; // aba não tem esse card, ignora
  // Reusa a mesma lógica do card da Visão Geral
  el.innerHTML = renderCardAderencia();
}

// navegar entre abas via JS (usado em botões de CTA)
function irParaAba(nomeAba) {
  const tab = document.querySelector(`.tab[data-tab="${nomeAba}"]`);
  if (tab) tab.click();
}

// Verifica se a obra ativa tem dados de Tendência carregados
function obraTemTendencia() {
  return Array.isArray(DATA_T) && DATA_T.some(d => d.is_folha && (d.licitacao != null || d.gestao != null));
}

function renderVisao() {
  // guard sem dados de Tendência
  if (!obraTemTendencia()) {
    const kpisEl = document.getElementById('kpis');
    const gruposEl = document.getElementById('grupos');
    const alertEl = document.getElementById('alertBanner');
    if (kpisEl) renderDashboardState(kpisEl, {
      title: 'Visão Geral sem dados',
      message: 'Envie a planilha de Tendência desta obra para visualizar os indicadores.',
      action: { label: 'Ir para Uploads', tab: 'uploads' },
    });
    if (gruposEl) gruposEl.replaceChildren();
    if (alertEl) alertEl.replaceChildren();
    // Limpar donut e top 10 também
    const donutEl = document.getElementById('donutChart');
    const topUpEl = document.getElementById('top10Up');
    const topDownEl = document.getElementById('top10Down');
    if (donutEl) renderDashboardState(donutEl, { title: 'Sem composição disponível', compact: true });
    if (topUpEl) renderDashboardState(topUpEl, { title: 'Sem aumentos para comparar', compact: true });
    if (topDownEl) renderDashboardState(topDownEl, { title: 'Sem reduções para comparar', compact: true });
    refreshHeaderSubtitle();
    verificarDadosDesatualizados();
    return;
  }
  const folhas = DATA_T.filter(d => d.is_folha);
  // Atualiza subtítulo do header com a gestão atual
  refreshHeaderSubtitle();
  let totLicit = 0, totGestao = 0;
  folhas.forEach(d => { totLicit += (d.licitacao||0); totGestao += (d.gestao||0); });
  const totDiff = totGestao - totLicit;
  const totPct = totLicit ? (totDiff/totLicit*100) : 0;
  const reds = folhas.filter(d => statusOf(d.licitacao, d.gestao) === 'red').length;

  // KPIs de flows por tipo
  const tipoSum = {};
  ['aumento_real','remanejamento','economia','pendente','sem_classificacao'].forEach(t => {
    tipoSum[t] = getFlowsObraAtiva().filter(f => f.tipo === t && f.dep !== 'Cancelado')
                       .reduce((s,f) => s + (f.custo_flowmaster || 0), 0);
  });
  const totAumentoReal = tipoSum.aumento_real;
  const totPendente = tipoSum.pendente;

  const kpiCls = totPct > 5 ? 'red' : totPct > 0 ? 'amber' : 'green';
  // Totais corrigidos (folhas)
  let totIncc = 0, totIpca = 0;
  folhas.forEach(d => {
    totIncc += (d.corrigido_incc || 0);
    totIpca += (d.corrigido_ipca || 0);
  });
  const totCorrigido = (CORRECAO_INDICE === 'ipca') ? totIpca : totIncc;
  const indiceLabel = CORRECAO_INDICE.toUpperCase();
  const indiceAlt = (CORRECAO_INDICE === 'ipca') ? 'incc' : 'ipca';
  const totAltLabel = (CORRECAO_INDICE === 'ipca') ? 'INCC' : 'IPCA';
  const totAltVal = (CORRECAO_INDICE === 'ipca') ? totIncc : totIpca;
  // Diferenças vs licitação
  const inflacaoAbs = totCorrigido - totLicit;
  const inflacaoPct = totLicit ? (inflacaoAbs/totLicit*100) : 0;
  // Desvio vs corrigida (isola inflação)
  const totDiffCorr = totGestao - totCorrigido;
  const totPctCorr = totCorrigido ? (totDiffCorr/totCorrigido*100) : 0;
  // Estouro bruto (gestão vs licitação)
  const desvioBrutoPct = totLicit ? (totDiff/totLicit*100) : 0;
  // ===== Cálculo das tendências (Card 3) =====
  const flowsPend = (typeof calcularFlowsPendentesPorGrupo === 'function') ? calcularFlowsPendentesPorGrupo() : {'Custos Indiretos':0,'Custos Diretos / Infraestrutura':0,'Obras Civis':0,'Projeção de Gastos':0,'Outros':0};
  // Calcular extrapolação dos Indiretos rodando uma "mini-projeção" rápida
  let totExtrapInd = 0;
  // v0.58b: usa PROJ_RAW filtrado pela obra ativa
  const _PROJ_VG = (typeof getProjRawObraAtiva === 'function') ? getProjRawObraAtiva() : PROJ_RAW;
  if (Array.isArray(_PROJ_VG) && _PROJ_VG.length && typeof projetarServico === 'function') {
    const dataCorteVG = (document.getElementById('projDataCorte')?.value) || defaultDataCorte();
    const dataFimVG = (document.getElementById('projDataFim')?.value) || defaultDataFim();
    const janelaVG = parseInt(document.getElementById('projMetodo')?.value) || 6;
    const porServVG = {};
    _PROJ_VG.forEach(r => {
      if (!porServVG[r.servico]) porServVG[r.servico] = {};
      porServVG[r.servico][r.mes] = (porServVG[r.servico][r.mes] || 0) + r.valor;
    });
    Object.entries(porServVG).forEach(([s, meses]) => {
      const p = projetarServico(s, meses, dataCorteVG, dataFimVG, janelaVG);
      if (p.grupo === 'Custos Indiretos' || p.grupo === 'Projeção de Gastos') {
        totExtrapInd += p.extrapolacao || 0;
      }
    });
  }
  const tendIndiretos = totExtrapInd + flowsPend['Custos Indiretos'] + flowsPend['Projeção de Gastos'];
  const tendDiretos = flowsPend['Custos Diretos / Infraestrutura'] + flowsPend['Obras Civis'] + flowsPend['Outros'];
  const tendFinal = totGestao + tendIndiretos + tendDiretos;
  const tendVsLic = tendFinal - totLicit;
  const tendVsLicPct = totLicit ? (tendVsLic/totLicit*100) : 0;
  const tendBrutoCls = tendVsLicPct > 10 ? 'red' : tendVsLicPct > 5 ? 'amber' : tendVsLicPct > 0 ? 'amber' : 'green';

  // Reserva (Projeção de Gastos) - vem do saldo atual da aba Controle Projeção
  const insumoControlado = (typeof PROJ_CTRL_STATE === 'object' && PROJ_CTRL_STATE && PROJ_CTRL_STATE.insumo) ? PROJ_CTRL_STATE.insumo : 'I011890';
  let reservaProj = 0;
  try {
    if (typeof getAllMovimentacoes === 'function') {
      const movs = getAllMovimentacoes();
      const totEnt = movs.filter(m => m.direcao === 'entrada').reduce((s,m) => s + (m.valor||0), 0);
      const totSai = movs.filter(m => m.direcao === 'saida').reduce((s,m) => s + (m.valor||0), 0);
      reservaProj = totEnt - totSai;
    }
  } catch(e) {
    reservaProj = 0;
    reportNonFatalError('Visão geral/calcular reserva de projeção', e);
  }
  const reservaPct = totLicit ? (reservaProj/totLicit*100) : 0;
  const tendFinalLiq = tendFinal - reservaProj;
  const tendVsLicLiq = tendVsLic - reservaProj;
  const tendVsLicLiqPct = totLicit ? (tendVsLicLiq/totLicit*100) : 0;
  const tendLiqCls = tendVsLicLiqPct > 10 ? 'red' : tendVsLicLiqPct > 5 ? 'amber' : tendVsLicLiqPct > 0 ? 'amber' : 'green';

  // Decomposição do Fluxo Atual
  const desvioBruto = totDiff; // gestao - licit
  // Aditivos refletidos = "rastreado" (do que conseguimos atribuir a um aditivo)
  // Usa totAumentoReal (já calculado acima) somado às outras categorias rastreadas
  const aditivoRastreado = (tipoSum.aumento_real || 0) + (tipoSum.economia || 0) + (tipoSum.remanejamento || 0);
  // Resto = parte do desvio que não tem aditivo refletido → atualização orçamentária/tendência não rastreada
  const restoNaoRastreado = desvioBruto - inflacaoAbs - aditivoRastreado;

  const kpiBrutoCls = desvioBrutoPct > 5 ? 'red' : desvioBrutoPct > 0 ? 'amber' : 'green';
  const kpiCorrCls = totPctCorr > 5 ? 'red' : totPctCorr > 0 ? 'amber' : 'green';

  // Toggle INCC/IPCA
  const toggleHtml = `
    <div class="toggle-group" style="margin-top:8px;">
      <button type="button" data-click-action="setCorrecaoIndice" data-action-mode="arg" data-action-arg="incc" class="toggle-btn ${CORRECAO_INDICE==='incc'?'active':''}">INCC</button>
      <button type="button" data-click-action="setCorrecaoIndice" data-action-mode="arg" data-action-arg="ipca" class="toggle-btn ${CORRECAO_INDICE==='ipca'?'active':''}">IPCA</button>
    </div>
  `;

  // Helper: linha de breakdown dentro do card
  const bdLine = (label, valor, cor, hint) => `
    <div style="display:flex; justify-content:space-between; align-items:baseline; padding:3px 0; font-size:11.5px;">
      <span style="color:var(--text-soft);">${label}${hint?` <span style="font-size:10px; color:var(--text-lighter);">(${hint})</span>`:''}</span>
      <strong style="color:${cor||'var(--text-strong)'};">${valor}</strong>
    </div>
  `;

  document.getElementById('kpis').innerHTML = `
    <!-- Card Licitação + Correção -->
    <div class="kpi kpi-wide">
      <div class="label">📋 Orçamento Licitação</div>
      <div class="value">${fmtR$(totLicit)}</div>
      <div class="sub">${folhas.length} itens · base original do contrato</div>
      <hr style="border:none; border-top:1px solid var(--border); margin:10px 0;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <div>
          <div style="font-size:10px; text-transform:uppercase; color:var(--text-soft); font-weight:600;">Corrigido (${indiceLabel})</div>
          <div style="font-size:18px; font-weight:700; color:var(--accent-purple-dark); margin-top:2px;">${fmtR$(totCorrigido)}</div>
        </div>
        ${toggleHtml}
      </div>
      <div style="font-size:11px; color:var(--text-soft); margin-top:6px;">
        +${fmtR$(inflacaoAbs)} de inflação (${inflacaoPct.toFixed(1)}%)
        · ${totAltLabel}: ${fmtR$k(totAltVal)}
      </div>
    </div>

    <!-- Card Fluxo Atual (Gestão) -->
    <div class="kpi kpi-wide ${kpiBrutoCls}">
      <div class="label">📊 ${escHtml(GESTAO_LABEL)}</div>
      <div class="value">${fmtR$(totGestao)}</div>
      <div class="sub">planejamento vigente</div>
      <hr style="border:none; border-top:1px solid var(--border); margin:10px 0;">
      <div style="font-size:10px; text-transform:uppercase; color:var(--text-soft); font-weight:600; margin-bottom:4px;">Decomposição do desvio</div>
      ${bdLine('💱 Inflação ' + indiceLabel, (inflacaoAbs>=0?'+':'') + fmtR$(inflacaoAbs), 'var(--accent-purple-dark)', 'externa, inevitável')}
      ${bdLine('📎 Aditivos refletidos', (aditivoRastreado>=0?'+':'') + fmtR$(aditivoRastreado), 'var(--sem-alerta)', 'rastreado em Flows')}
      ${bdLine('❓ Não rastreado', (restoNaoRastreado>=0?'+':'') + fmtR$(restoNaoRastreado), restoNaoRastreado>0?'var(--sem-erro)':'var(--sem-ok)', 'atualização de orçamento')}
      <div style="border-top:2px solid var(--border-strong); margin-top:8px; padding-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; padding:2px 0; font-size:13px;">
          <span style="color:var(--text-strong); font-weight:700;">🎯 Total · Desvio bruto <span style="color:var(--text-soft); font-weight:600;">(${fmtPct(desvioBrutoPct)})</span></span>
          <strong style="color:${desvioBruto>0?'var(--sem-erro)':desvioBruto<0?'var(--sem-ok)':'var(--text-soft)'}; font-size:14px;">${desvioBruto>=0?'+':''}${fmtR$(desvioBruto)}</strong>
        </div>
      </div>
    </div>

    <!-- Card 3 — Tendência projetada (versão compacta v0.43) -->
    <div class="kpi kpi-wide ${(CARD3_MODO==='liquido'?tendLiqCls:tendBrutoCls)}">
      <div class="label">🔮 Tendência Final Projetada</div>
      <div style="display:flex; align-items:baseline; justify-content:space-between; gap:10px; flex-wrap:wrap; margin:6px 0 8px;">
        <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
          <div style="font-size:24px; font-weight:700; color:var(--text-strong);">${fmtR$(CARD3_MODO==='liquido' ? tendFinalLiq : tendFinal)}</div>
          <div style="font-size:12px; color:var(--text-soft);">${CARD3_MODO==='liquido' ? 'descontando reserva (' + escHtml(insumoControlado) + ')' : 'gestão atual + tendências de obra'}</div>
        </div>
        <div class="toggle-group">
          <button type="button" data-click-action="setCard3Modo" data-action-mode="arg" data-action-arg="bruto" class="toggle-btn ${CARD3_MODO==='bruto'?'active':''}">Bruto</button>
          <button type="button" data-click-action="setCard3Modo" data-action-mode="arg" data-action-arg="liquido" class="toggle-btn ${CARD3_MODO==='liquido'?'active':''}">Líquido</button>
        </div>
      </div>
      ${bdLine('🎯 Total · Desvio bruto (' + fmtPct(desvioBrutoPct) + ')', (desvioBruto>=0?'+':'') + fmtR$(desvioBruto), desvioBruto>0?'var(--sem-erro)':desvioBruto<0?'var(--sem-ok)':'var(--text-soft)', 'gestão atual vs licitação')}
      ${bdLine('🏗️ Tend. Indiretos', (tendIndiretos>=0?'+':'') + fmtR$(tendIndiretos), 'var(--accent-purple-dark)', 'extrapolação + flows pendentes')}
      ${bdLine('🧱 Tend. Diretos', (tendDiretos>=0?'+':'') + fmtR$(tendDiretos), 'var(--sem-alerta)', 'flows pendentes em Diretos/Civis')}
      <div style="border-top:2px solid var(--border-strong); margin-top:8px; padding-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; padding:2px 0; font-size:13px;">
          <span style="color:var(--text-strong); font-weight:700;">📈 Δ vs Licitação <span style="color:var(--text-soft); font-weight:600;">(${fmtPct(tendVsLicPct)})</span></span>
          <strong style="color:${tendVsLic>0?'var(--sem-erro)':tendVsLic<0?'var(--sem-ok)':'var(--text-soft)'}; font-size:14px;">${tendVsLic>=0?'+':''}${fmtR$(tendVsLic)}</strong>
        </div>
        ${reservaProj > 0 ? `
        <div style="display:flex; justify-content:space-between; align-items:baseline; padding:2px 0; font-size:11.5px; color:var(--text-soft);">
          <span>Reserva ${escHtml(insumoControlado)} (${fmtPct(reservaPct)} sobre licit.)</span>
          <span>−${fmtR$(reservaProj)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:baseline; padding:2px 0; font-size:13px;">
          <span style="color:var(--text-strong); font-weight:700;">💧 Δ vs Licitação (Líquido)</span>
          <strong style="color:${tendVsLicLiq>0?'var(--sem-erro)':tendVsLicLiq<0?'var(--sem-ok)':'var(--text-soft)'}; font-size:14px;">${tendVsLicLiq>=0?'+':''}${fmtR$(tendVsLicLiq)}</strong>
        </div>` : ''}
      </div>
    </div>

    <!-- Card 4 (v0.55) — Aderência Físico-Financeira (Prevision) -->
    ${renderCardAderencia()}
  `;

  // Alerta de pendentes
  if (totPendente > 0) {
    document.getElementById('alertBanner').innerHTML = `
      <div class="alert-banner">
        ⚠️ <strong>Atenção:</strong> existem ${fmtR$(totPendente)} em aditivos ainda <strong>pendentes de classificação</strong> (Insumo Planejamento = "Não encontrado!"). Classificá-los permitirá entender se são aumento real, remanejamento ou economia. Hoje só ${fmtR$(totAumentoReal)} de aumento real estão formalizados, mas o desvio total é de ${fmtR$(totDiff)} — boa parte ainda é tendência não rastreada.
      </div>`;
  } else { document.getElementById('alertBanner').replaceChildren(); }
  
  // Verificar se dados estão desatualizados
  verificarDadosDesatualizados();

  // Grupos
  const byGrupo = {};
  folhas.forEach(d => {
    const g = d.grupo || 'Outros';
    if (!byGrupo[g]) byGrupo[g] = {licit:0, gestao:0, n:0, aditivos:0};
    byGrupo[g].licit += d.licitacao||0;
    byGrupo[g].gestao += d.gestao||0;
    byGrupo[g].aditivos += d.aditivo_total||0;
    byGrupo[g].n += 1;
  });
  // Ordem fixa dos grupos (e exclusões)
  const GRUPO_ORDER = ['Custos Indiretos', 'Custos Diretos / Infraestrutura', 'Obras Civis', 'Projeção de Gastos'];
  const GRUPO_HIDE = new Set(['Serviços Iniciais Adicionais', 'Serviços Iniciais']);
  const gruposOrdenados = Object.entries(byGrupo)
    .filter(([g]) => !GRUPO_HIDE.has(g))
    .sort((a, b) => {
      const ia = GRUPO_ORDER.indexOf(a[0]);
      const ib = GRUPO_ORDER.indexOf(b[0]);
      if (ia === -1 && ib === -1) return a[0].localeCompare(b[0]);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  document.getElementById('grupos').innerHTML = gruposOrdenados.map(([g,v]) => {
    const diff = v.gestao - v.licit;
    const pct = v.licit ? (diff/v.licit*100) : null;
    const st = pct == null ? 'gray' : pct > 10 ? 'red' : pct > 0 ? 'amber' : 'green';
    const barColor = st === 'red' ? 'var(--fgr-red-vivid)' : st === 'amber' ? 'var(--sem-alerta)' : st === 'green' ? 'var(--sem-ok)' : 'var(--text-lighter)';
    const barWidth = Math.min(100, Math.abs(pct || 0) * 5);
    const aditInfo = Math.abs(v.aditivos) > 0.01 ? ` · <span style="color:var(--accent-purple);">📎 ${fmtR$k(v.aditivos)} em aditivos</span>` : '';
    return `
      <div class="grupo-row">
        <div class="grupo-nome"><span class="dot ${st}"></span>${escHtml(g)}<span style="font-weight:400;color:var(--text-soft);font-size:11px;">(${v.n})${aditInfo}</span></div>
        <div style="font-size:11px;color:var(--text-soft);">${fmtR$k(v.licit)} → ${fmtR$k(v.gestao)}</div>
        <div class="${diff<=0?'pos':'neg'}" style="font-weight:700;font-size:13px;">${pct != null ? fmtPct(pct) : 'novo'}</div>
        <div class="grupo-bar"><div class="grupo-bar-fill" style="width:${barWidth}%;background:${barColor};"></div></div>
      </div>`;
  }).join('');

  renderDonut(tipoSum);

  // Top 10 dividido em aumentos e reduções
  const todasFolhas = folhas.filter(d => d.licitacao != null && d.gestao != null)
    .map(d => ({...d, delta: d.gestao - d.licitacao}));
  const ups = todasFolhas.filter(d => d.delta > 0).sort((a,b) => b.delta - a.delta).slice(0,10);
  const downs = todasFolhas.filter(d => d.delta < 0).sort((a,b) => a.delta - b.delta).slice(0,10);

  const renderTopList = (arr, isUp, containerId) => {
    if (!arr.length) {
      document.getElementById(containerId).innerHTML = '<div style="color:var(--text-lighter); text-align:center; padding:20px; font-size:12px;">Nenhum item nessa categoria.</div>';
      return;
    }

    const barColor = isUp ? resolveColor('var(--fgr-red-vivid)') : resolveColor('var(--sem-ok)');
    const categories = arr.map(d => d.item.length > 35 ? d.item.slice(0, 32) + '...' : d.item);
    const seriesData = arr.map(d => Math.abs(d.delta));

    const options = {
      series: [{ name: isUp ? 'Aumento' : 'Redução', data: seriesData }],
      chart: {
        type: 'bar',
        height: Math.max(250, arr.length * 40),
        animations: { enabled: true, easing: 'easeinout', speed: 600 },
        toolbar: { show: true, tools: { download: true, zoom: false, pan: false, reset: false } },
      },
      colors: [barColor],
      plotOptions: {
        bar: {
          horizontal: true,
          borderRadius: 4,
          barHeight: '60%',
          dataLabels: { position: 'right' },
        }
      },
      xaxis: {
        categories: categories,
        labels: { formatter: val => fmtR$k(val), style: { fontSize: '10px' } },
      },
      yaxis: {
        labels: { style: { fontSize: '11px', colors: resolveColor('var(--text-medium)') } },
      },
      tooltip: {
        enabled: true,
        theme: document.body.classList.contains('dark') ? 'dark' : 'light',
        y: { formatter: val => fmtR$(val) },
      },
      dataLabels: {
        enabled: true,
        formatter: val => fmtR$k(val),
        style: { fontSize: '10px', colors: [resolveColor('var(--text-medium)')] },
        offsetX: 30,
      },
      grid: { borderColor: resolveColor('var(--border)'), strokeDashArray: 3 },
      legend: { show: false },
    };

    renderApexChart(containerId, options);
  };
  renderTopList(ups, true, 'top10Up');
  renderTopList(downs, false, 'top10Down');
}

// Filtro interativo do donut (toggle por tipo) — donutHidden e _lastTipoSum em AppState.donut

function toggleDonutSlice(key) {
  if (donutHidden.has(key)) donutHidden.delete(key);
  else donutHidden.add(key);
  if (_lastTipoSum) renderDonut(_lastTipoSum);
}

function renderDonut(tipoSum) {
  _lastTipoSum = tipoSum;
  const aum = Math.max(0, tipoSum.aumento_real);
  const rem = Math.max(0, tipoSum.remanejamento);
  const eco = Math.max(0, tipoSum.economia);
  const pen = Math.max(0, tipoSum.pendente);
  const sem = Math.max(0, tipoSum.sem_classificacao);
  const total = aum + rem + eco + pen + sem;

  if (total <= 0) {
    if (_apexCharts['donutChart']) { _apexCharts['donutChart'].destroy(); delete _apexCharts['donutChart']; }
    document.getElementById('donutChart').innerHTML = '<div style="text-align:center; color:var(--text-lighter); padding:80px 20px; font-size:13px;">Sem aditivos para exibir.</div>';
    return;
  }

  const allSegs = [
    {key:'aum', v:aum, lbl:'Aumento real', icon:'🔴'},
    {key:'rem', v:rem, lbl:'ReManejamento', icon:'🔵'},
    {key:'eco', v:eco, lbl:'Economia', icon:'🟢'},
    {key:'pen', v:pen, lbl:'Pendente', icon:'🟡'},
    {key:'sem', v:sem, lbl:'Sem class.', icon:'⚪'},
  ];

  const visibleSegs = allSegs.filter(s => s.v > 0 && !donutHidden.has(s.key));
  const series = visibleSegs.map(s => s.v);
  const labels = visibleSegs.map(s => s.icon + ' ' + s.lbl);
  const colorMap = {
    aum: resolveColor('var(--fgr-red-vivid)'),
    rem: resolveColor('var(--text-medium)'),
    eco: resolveColor('var(--sem-ok)'),
    pen: resolveColor('var(--sem-alerta)'),
    sem: resolveColor('var(--text-lighter)'),
  };
  const colors = visibleSegs.map(s => colorMap[s.key]);

  const options = {
    series: series,
    chart: {
      type: 'donut',
      height: 320,
      animations: { enabled: true, easing: 'easeinout', speed: 600 },
      toolbar: { show: true, tools: { download: true, selection: false, zoom: false, pan: false } },
      events: {
        dataPointSelection: function(event, chartContext, config) {
          const segIndex = config.dataPointIndex;
          if (segIndex >= 0 && segIndex < visibleSegs.length) {
            toggleDonutSlice(visibleSegs[segIndex].key);
          }
        }
      }
    },
    labels: labels,
    colors: colors,
    plotOptions: {
      pie: {
        donut: {
          size: '65%',
          labels: {
            show: true,
            total: {
              show: true,
              label: donutHidden.size > 0 ? 'Total (filtro ativo)' : 'Total flows',
              formatter: function(w) {
                const sum = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                return fmtR$k(sum);
              }
            },
            value: { formatter: function(val) { return fmtR$(parseFloat(val)); } }
          }
        }
      }
    },
    tooltip: {
      enabled: true,
      theme: document.body.classList.contains('dark') ? 'dark' : 'light',
      y: { formatter: function(val, opts) {
        const seg = visibleSegs[opts.dataPointIndex];
        const pct = ((val / total) * 100).toFixed(1);
        return fmtR$(val) + ' (' + pct + '%)';
      }}
    },
    legend: {
      show: true, position: 'bottom', fontSize: '12px',
      labels: { colors: resolveColor('var(--text-medium)') },
      itemMargin: { horizontal: 8, vertical: 4 },
    },
    stroke: { width: 2, colors: [resolveColor('var(--bg-card)')] },
    dataLabels: {
      enabled: true,
      formatter: function(val) { return val.toFixed(1) + '%'; },
      style: { fontSize: '11px' },
      dropShadow: { enabled: false },
    },
    responsive: [{ breakpoint: 480, options: { chart: { height: 260 }, legend: { position: 'bottom' } } }]
  };

  renderApexChart('donutChart', options);
}

// Visualização de detalhamento fornecida por ui/views/details.mjs.

// Infraestrutura de modais instalada por assets/js/ui/modals.mjs.

function showManualText(key) {
  const text = MANUAL_TEXT[key];
  if (!text) return;
  document.getElementById('modalContent').innerHTML = `
    <h2>ℹ️ Como exportar</h2>
    <div style="white-space: pre-wrap; font-size: 13px; line-height: 1.6; color: var(--text-medium); margin-top: 12px;">${escHtml(text)}</div>
    <div style="margin-top: 16px; text-align: right;">
      <button class="btn-sm" data-click-action="closeModal">Fechar</button>
    </div>
  `;
  openModal();
}

// ============ EDIÇÃO DE CLASSIFICAÇÃO ============
// (declarado em CONFIG no topo)

// Opções especiais (aparecem no topo do dropdown)
const SPECIAL_OPTIONS = [
  { value: '', label: '— (em branco)' },
  { value: '-', label: '— Não se aplica (-)' },
  { value: 'Aumento de obra', label: '🆕 Aumento de obra' },
  { value: 'Cancelado', label: '🚫 Cancelado' },
  { value: 'Não encontrado!', label: '❓ Não encontrado!' },
  { value: 'VERIFICAR QUANDO SERVIÇO FOR CONTRATADO', label: '⏳ Verificar quando contratar' },
];
const SPECIAL_VALUES_SET = new Set(SPECIAL_OPTIONS.map(o => o.value));

// Carrega edições salvas (se houver) e aplica em DATA_F
function loadClassifications() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const map = JSON.parse(raw);
    let n = 0;
    // aplica em TODO DATA_F (não só obra ativa). Chave é "codigo_obra:n_alteracao"
    // Compat: aceita também chave só com n_alteracao (legado)
    const _DATA_F_ALL = Array.isArray(DATA_F) ? DATA_F : [];
    _DATA_F_ALL.forEach(f => {
      const keyComObra = (f.codigo_obra || '') + ':' + f.n_alteracao;
      const keyLegacy = f.n_alteracao;
      const entry = map[keyComObra] || map[keyLegacy];
      if (entry) {
        if (entry.insumo_planejamento !== undefined) {
          f.insumo_planejamento = entry.insumo_planejamento;
          f._edited_p = true;
        }
        if (entry.insumo_remanejamento !== undefined) {
          f.insumo_remanejamento = entry.insumo_remanejamento;
          f._edited_r = true;
        }
        if (entry.custo_flowmaster !== undefined) {
          f.custo_flowmaster = entry.custo_flowmaster;
          f._edited_v = true;
        }
        if (entry.refletido_status !== undefined) {
          f.refletido_status = entry.refletido_status;
          f.refletido = (entry.refletido_status === 'sim');
        } else if (entry.refletido !== undefined) {
          // compat com versões antigas (só checkbox)
          f.refletido = entry.refletido;
          f.refletido_status = entry.refletido ? 'sim' : 'pendente';
        }
        f.tipo = classifyFlow(f.insumo_planejamento, f.insumo_remanejamento);
        n++;
      }
    });
    return n;
  } catch (e) { console.warn('Erro ao carregar classificações:', e); return 0; }
}

function readClassificationMap() {
  try {
    const parsed = JSON.parse(SafeStorage.get(STORAGE_KEY, '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    reportNonFatalError('Classificações/estado local inválido', error, 'As classificações locais não puderam ser lidas.');
    return {};
  }
}

function saveClassification(nAlt, field, value) {
  if (!requireEditor('classificar aditivos')) return false;
  // acha o aditivo no DATA_F pra pegar codigo_obra e montar chave composta
  const f = (Array.isArray(DATA_F) ? DATA_F : []).find(x => x.n_alteracao === nAlt);
  const codigoObra = f?.codigo_obra || OBRA_ATIVA || '';
  const key = codigoObra + ':' + nAlt;
  const map = readClassificationMap();
  if (!map[key]) map[key] = { codigo_obra: codigoObra };
  map[key][field] = value;
  SafeStorage.set(STORAGE_KEY, JSON.stringify(map));
  // Espelhar no Supabase
  void runAsyncSafely(
    supaPatchClassification(nAlt, { [field]: value }, codigoObra),
    'Classificações/salvar no Supabase',
    'A classificação foi salva apenas neste navegador.'
  );
  return true;
}

async function clearClassifications() {
  const confirmed = await confirmModal('Limpar alterações?', 'Deseja apagar todas as alterações de classificação salvas neste navegador?\nOs aditivos manuais NÃO serão afetados.\nAs alterações exportadas em CSV também não serão afetadas.', { confirmText: 'Limpar', destructive: true });
  if (!confirmed) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}

function reloadClassifications() {
  const n = loadClassifications();
  buildLinks();
  // Usar debounce para evitar múltiplas renderizações
  debouncedRender();
  authToast(`✅ ${n} aditivo(s) com classificação salva foram recarregados.`, 'ok', 3000);
}

function exportClassifications() {
  const map = readClassificationMap();
  const keys = Object.keys(map);
  if (keys.length === 0) {
    authToast('⚠️ Nenhuma alteração para exportar.', 'warn', 3000);
    return;
  }
  // CSV: Nº Alteração; Nº ADT; Insumo Planejamento (novo); Insumo Remanejamento (novo); Tipo classificado
  // Inclui edições + manuais
  const manuals = loadManuals();
  const allKeys = new Set([...keys, ...manuals.map(m => m.n_alteracao)]);
  if (allKeys.size === 0) {
    authToast('⚠️ Nenhuma alteração ou aditivo manual para exportar.', 'warn', 3000);
    return;
  }
  const lines = ['Origem;Nº Alteração;Departamento;Data;Descrição;Motivo;INSUMO PLANEJAMENTO;INSUMO DE REMANEJAMENTO;Fluxo Planejamento (R$);Tipo (calculado);Refletido (PENDENTE/SIM/NAO);Justificativa;Data exportação'];
  const now = new Date().toLocaleString('pt-BR');
  allKeys.forEach(k => {
    const f = getFlowsObraAtiva().find(x => x.n_alteracao === k);
    if (!f) return;
    const edit = map[k] || {};
    const ip = (edit.insumo_planejamento !== undefined) ? edit.insumo_planejamento : f.insumo_planejamento;
    const ir = (edit.insumo_remanejamento !== undefined) ? edit.insumo_remanejamento : f.insumo_remanejamento;
    const val = (edit.custo_flowmaster !== undefined) ? edit.custo_flowmaster : f.custo_flowmaster;
    const tipo = classifyFlow(ip, ir);
    const csvEsc = s => `"${String(s==null?'':s).replace(/"/g,'""').replace(/\r?\n/g,' ')}"`;
    const fmtVal = val == null ? '' : String(val).replace('.', ',');
    const refStatus = (edit.refletido_status !== undefined) ? edit.refletido_status : (f.refletido_status || 'pendente');
    const refLabel = refStatus === 'sim' ? 'SIM' : refStatus === 'nao' ? 'NAO' : 'PENDENTE';
    lines.push([
      f.is_manual ? 'Manual' : 'Sistema',
      f.n_alteracao,
      csvEsc(f.dep),
      csvEsc(f.data_br),
      csvEsc(f.descricao),
      csvEsc(f.motivo),
      csvEsc(ip), csvEsc(ir),
      fmtVal, tipo,
      refLabel,
      csvEsc(f.justificativa),
      now
    ].join(';'));
  });
  const csv = '\ufeff' + lines.join('\n'); // BOM p/ Excel abrir certo
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `classificacoes_flows_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Lista ordenada de insumos da tendência (Ixxx — Nome)
function buildInsumosList() {
  const map = new Map();
  DATA_T.forEach(t => {
    if (t.is_folha && t.cod_insumo && !SPECIAL_VALUES_SET.has(t.cod_insumo)) {
      if (!map.has(t.cod_insumo)) map.set(t.cod_insumo, t.item);
    }
  });
  return [...map.entries()].sort((a,b) => a[0].localeCompare(b[0]));
}
let INSUMOS_OPTIONS = [];

// Renderiza um <input> com autocomplete (datalist) — leve e rápido
function renderInsumoSelect(f, field) {
  const value = f[field] || '';
  const edited = field === 'insumo_planejamento' ? f._edited_p : f._edited_r;
  const isSpecial = SPECIAL_VALUES_SET.has(value);
  // valor "amigável" para exibição: se for insumo da tendência, mostra "Ixxx — Nome"
  const displayValue = displayForValue(value);
  const cls = 'classif-select' + (edited ? ' edited' : '') + (isSpecial ? ' special' : '');
  const disabled = isEditorDaObraAtiva() ? '' : ' disabled';
  // removido marker ✏️ — fundo amarelo já sinaliza edição
  return `<input type="text" list="insumosDatalist" class="${cls}" data-edit-control${disabled}
    value="${escAttr(displayValue)}"
    data-n="${escAttr(f.n_alteracao)}" data-field="${field}"
    data-rawvalue="${escAttr(value)}"
    data-change-action="onClassifChange" data-action-mode="self"
    data-select-on-focus
    title="${escAttr(value)}"
    placeholder="digite p/ buscar...">`;
}

// Converte um value "puro" no rótulo bonito (Ixxx — Nome) usado no input
function displayForValue(value) {
  if (!value) return '';
  if (SPECIAL_VALUES_SET.has(value)) {
    const o = SPECIAL_OPTIONS.find(x => x.value === value);
    return o ? o.label : value;
  }
  const ins = INSUMOS_OPTIONS.find(([cod]) => cod === value);
  if (ins) return `${ins[0]} — ${ins[1]}`;
  return value;
}

// Converte o que o usuário DIGITOU no datalist de volta para o "value puro"
function valueFromDisplay(text) {
  text = (text||'').trim();
  if (!text) return '';
  // Match exato de label de especial
  const sp = SPECIAL_OPTIONS.find(o => o.label === text || o.value === text);
  if (sp) return sp.value;
  // Match "Ixxx — Nome" → pega só o código
  const m = text.match(/^([A-Z]+\d+)\s*(?:—|-).*/);
  if (m) {
    const cod = m[1];
    if (INSUMOS_OPTIONS.some(([c]) => c === cod)) return cod;
  }
  // Talvez digitou só o código
  if (INSUMOS_OPTIONS.some(([c]) => c === text)) return text;
  // Talvez digitou só o NOME do item — tenta achar
  const byName = INSUMOS_OPTIONS.find(([c,n]) => n.toLowerCase() === text.toLowerCase());
  if (byName) return byName[0];
  // Caso contrário, devolve o texto livre (vai aparecer com ⚠️ depois)
  return text;
}

// Cria/atualiza o datalist global UMA vez (compartilhado por todos os inputs)
function buildDatalist() {
  let dl = document.getElementById('insumosDatalist');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'insumosDatalist';
    document.body.appendChild(dl);
  }
  const specials = SPECIAL_OPTIONS.map(o => `<option value="${escAttr(o.label)}">`).join('');
  const insumos = INSUMOS_OPTIONS.map(([cod, nome]) =>
    `<option value="${escAttr(cod + ' — ' + nome)}">`
  ).join('');
  dl.innerHTML = specials + insumos;
  // log discreto
  if (INSUMOS_OPTIONS.length > 0) {
    console.log(`[DATALIST] ${INSUMOS_OPTIONS.length} insumos disponíveis no dropdown de classificação (${OBRA_ATIVA||'—'})`);
  }
}

// Converte data — aceita 'dd/mm/yyyy' OU número serial Excel (ex: 46147 = 26/05/2026)
function formatDate(s) {
  if (!s) return '';
  s = String(s).trim();
  // Já está em formato dd/mm/yyyy → retorna
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) return s.split(' ')[0];
  // Número serial Excel (data: 30/12/1899 + N dias)
  if (/^\d{4,6}$/.test(s)) {
    const n = parseInt(s, 10);
    // Sanidade: 25569 = 1970-01-01; 60000 ~ 2064. Aceitar 20000-60000
    if (n > 20000 && n < 80000) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + n * 86400000);
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const yy = d.getUTCFullYear();
      return `${dd}/${mm}/${yy}`;
    }
  }
  // Formato ISO yyyy-mm-dd — valida mês (1-12) e dia (1-31)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const mes = parseInt(iso[2], 10);
    const dia = parseInt(iso[3], 10);
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      return `${iso[3]}/${iso[2]}/${iso[1]}`;
    }
  }
  return s;
}

function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escAttr(s) { return escHtml(s); }

// ============ TOOLTIP SYSTEM (gráficos) ============
function showTooltip(evt, html) {
  const tt = document.getElementById('chartTooltip');
  if (!tt) return;
  tt.innerHTML = html;
  tt.setAttribute('aria-hidden', 'false');
  tt.classList.add('show');
  positionTooltip(evt, tt);
}
function hideTooltip() {
  const tt = document.getElementById('chartTooltip');
  if (tt) {
    tt.classList.remove('show');
    tt.setAttribute('aria-hidden', 'true');
  }
}
function positionTooltip(evt, tt) {
  if (!tt) tt = document.getElementById('chartTooltip');
  const pad = 14;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  // Forçar render para medir
  tt.style.left = '-9999px'; tt.style.top = '-9999px';
  const rect = tt.getBoundingClientRect();
  if (x + rect.width > window.innerWidth - pad) x = evt.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - pad) y = evt.clientY - rect.height - pad;
  if (x < pad) x = pad;
  if (y < pad) y = pad;
  tt.style.left = x + 'px'; tt.style.top = y + 'px';
}
// Helper para linha de tooltip formatada
function ttRow(label, val) { return `<div class="tt-row"><span class="tt-label">${label}</span><span class="tt-val">${val}</span></div>`; }
function ttDiv() { return '<div class="tt-divider"></div>'; }

// Helper: re-renderizar TODAS as visões que dependem de DATA_F (refletido, classificação, valor, manuais)
// Chamado sempre que algo nos Flows muda, para garantir que Visão Geral, Tendência de Obra e Controle Projeção atualizem
// OTIMIZADO: usa debounce para evitar múltiplas renderizações em sequência
function syncAllViewsFromFlows() {
  try { if (typeof buildLinks === 'function') buildLinks(); } catch(e) { reportNonFatalError('Flows/recalcular vínculos', e); }
  // Usa debounce para as renderizações mais pesadas
  debouncedRender('visao');
  try { if (typeof renderFlowsAggregates === 'function') renderFlowsAggregates(); } catch(e) { reportNonFatalError('Flows/renderizar agregados', e); }
  try { if (typeof updateEditCount === 'function') updateEditCount(); } catch(e) { reportNonFatalError('Flows/atualizar contador', e); }
}

function onClassifChange(sel) {
  if (!requireEditorForActiveProject('classificar aditivos')) {
    renderFlowTable();
    return;
  }
  const nAlt = sel.dataset.n;
  const field = sel.dataset.field;
  const value = valueFromDisplay(sel.value);
  const f = getFlowsObraAtiva().find(x => x.n_alteracao === nAlt);
  if (!f) return;
  // Atualiza o input para o display canônico (caso usuário tenha digitado parcial)
  sel.value = displayForValue(value);
  sel.dataset.rawvalue = value;
  f[field] = value;
  if (field === 'insumo_planejamento') f._edited_p = true;
  else f._edited_r = true;
  f.tipo = classifyFlow(f.insumo_planejamento, f.insumo_remanejamento);
  saveClassification(nAlt, field, value);
  // Recalcular ligações + atualizar TODAS as telas dependentes
  syncAllViewsFromFlows();
  // Atualiza apenas a linha desta tr (badge de tipo + estilo do select)
  const tr = sel.closest('tr');
  if (tr) {
    // Atualiza o badge de tipo (6ª <td> = índice 5)
    // Ordem: 0=checkbox 1=refletido 2=Nº 3=Data 4=Departamento 5=Tipo 6=Destino ...
    const tipoLabel = {aumento_real:'<span class="badge red">🔴 Aum.real</span>', remanejamento:'<span class="badge cyan">🔵 Remanej.</span>',
      economia:'<span class="badge green">🟢 Economia</span>', pendente:'<span class="badge amber">🟡 Pendente</span>',
      cancelado:'<span class="badge gray">🚫 Cancelado</span>',
      sem_classificacao:'<span class="badge gray">⚪ Sem class.</span>', misto:'<span class="badge gray">⚪ Misto</span>'};
    const tipoTd = tr.children[5];
    if (tipoTd) tipoTd.textContent = tipoLabel[f.tipo] || '';
    // marca só o input (fundo amarelo do CSS já sinaliza)
    sel.classList.add('edited');
  }
}

function updateEditCount() {
  const map = readClassificationMap();
  const n = Object.keys(map).length;
  const m = loadManuals().length;
  const el = document.getElementById('editCount');
  if (!el) return;
  let parts = [];
  if (n > 0) parts.push(`<span class="badge purple">✏️ ${n} editado(s)</span>`);
  if (m > 0) parts.push(`<span class="badge-manual">✋ ${m} manual(is)</span>`);
  el.innerHTML = parts.length ? parts.join(' ') + ' <span style="color:var(--text-soft);">— não esqueça de exportar</span>' : '';
}

// Helper: re-renderiza só os agregados da aba flows (cards e gráficos), preservando a tabela
function renderFlowsAggregates() {
  const total = getFlowsObraAtiva().length;
  const byDep = {};
  getFlowsObraAtiva().forEach(f => { byDep[f.dep] = (byDep[f.dep]||0) + 1; });
  const sumFm = arr => arr.reduce((s,f) => s + (f.custo_flowmaster || 0), 0);
  // "Vivos" = não cancelados E não marcados como ❌ Não refletir
  // Cancelado agora é uma classificação própria (some pelo dep OU pelo tipo)
  const isCancelado = f => f.dep === 'Cancelado' || f.tipo === 'cancelado';
  const isNaoRefletir = f => !isCancelado(f) && f.refletido_status === 'nao';
  // Vivos = os que impactam a obra (não cancelados, não marcados como não refletir)
  const active = getFlowsObraAtiva().filter(f => !isCancelado(f) && !isNaoRefletir(f));
  const tipoSums = {};
  ['aumento_real','remanejamento','economia','pendente'].forEach(t => {
    const arr = active.filter(f => f.tipo === t);
    tipoSums[t] = {n: arr.length, v: sumFm(arr)};
  });
  const semClassVivos = active.filter(f => f.tipo === 'sem_classificacao');
  if (semClassVivos.length) {
    tipoSums['sem_classificacao'] = {n: semClassVivos.length, v: sumFm(semClassVivos)};
  }
  // Cancelado vira LINHA da lista (com contador e valor), não caixa separada
  const cancelados = getFlowsObraAtiva().filter(isCancelado);
  if (cancelados.length) {
    tipoSums['cancelado'] = {n: cancelados.length, v: sumFm(cancelados)};
  }
  // Ainda mantemos "não refletir" à parte (é decisão separada, não é cancelamento)
  const descartados = getFlowsObraAtiva().filter(isNaoRefletir);
  document.getElementById('flowSummary').innerHTML = `
    <div class="flow-card"><div class="lbl">Total Aditivos</div><div class="v">${total}</div><div class="sub">${fmtR$(sumFm(getFlowsObraAtiva()))} flowmaster total</div></div>
    <div class="flow-card green"><div class="lbl">Finalizados</div><div class="v">${byDep.Finalizado||0}</div><div class="sub">${fmtR$(sumFm(getFlowsObraAtiva().filter(f=>f.dep==='Finalizado')))}</div></div>
    <div class="flow-card amber"><div class="lbl">Em andamento</div><div class="v">${(byDep.Projeto||0)+(byDep.Planejamento||0)+(byDep.Orçamento||0)+(byDep.Obra||0)}</div><div class="sub">${fmtR$(sumFm(getFlowsObraAtiva().filter(f=>!['Cancelado','Finalizado'].includes(f.dep))))}</div></div>
    <div class="flow-card gray"><div class="lbl">Cancelados</div><div class="v">${byDep.Cancelado||0}</div><div class="sub">${fmtR$(sumFm(getFlowsObraAtiva().filter(f=>f.dep==='Cancelado')))} (descartado)</div></div>
    <div class="flow-card purple"><div class="lbl">Aumento Real</div><div class="v">${fmtR$(tipoSums.aumento_real.v)}</div><div class="sub">${tipoSums.aumento_real.n} aditivos</div></div>
  `;
  const colors = {aumento_real:'var(--fgr-red-vivid)', remanejamento:'var(--text-medium)', economia:'var(--sem-ok)', pendente:'var(--sem-alerta)', cancelado:'var(--text-medium)', sem_classificacao:'var(--text-lighter)'};
  const labels = {aumento_real:'🔴 Aumento real', remanejamento:'🔵 Remanejamento', economia:'🟢 Economia', pendente:'🟡 Pendente', cancelado:'🚫 Cancelado', sem_classificacao:'⚪ Sem classificação'};
  const maxV = Math.max(...Object.values(tipoSums).map(t => Math.abs(t.v)), 1);
  document.getElementById('flowsByTipo').innerHTML = Object.entries(tipoSums).map(([t,v]) => `
    <div class="top-item">
      <div class="name">${labels[t]} <span style="color:var(--text-soft);font-size:11px;">(${v.n})</span></div>
      <div class="val">${fmtR$(v.v)}</div>
      <div class="top-bar"><div class="top-bar-fill" style="width:${Math.abs(v.v)/maxV*100}%;background:${colors[t]};"></div></div>
    </div>`).join('');
  // caixinha só aparece se houver "não refletir" (cancelados já viraram linha na lista)
  const elDesc = document.getElementById('flowsDescartados');
  if (elDesc) {
    if (descartados.length) {
      const valDesc = sumFm(descartados);
      elDesc.innerHTML = `
        <div style="background:var(--bg-soft); border-left:3px solid var(--text-lighter); border-radius:6px; padding:8px 12px; display:flex; justify-content:space-between; align-items:center; font-size:11.5px; color:var(--text-medium);">
          <span>❌ <strong>Marcados como "Não refletir":</strong> ${descartados.length} aditivo(s)</span>
          <strong style="color:var(--text-soft);">${fmtR$(valDesc)}</strong>
        </div>
      `;
    } else {
      elDesc.replaceChildren();
    }
  }
}

// ============ MULTI-SELECT (filtros estilo Excel) ============
// Estado: por chave, conjunto de valores EXCLUÍDOS (vazio = todos selecionados)
const MS_EXCLUDED = { dep: new Set(), tipo: new Set(), motivo: new Set(), solicitante: new Set(), refletido: new Set(), destino: new Set() };
const MS_LABELS = {
  dep: 'departamento(s)',
  tipo: 'tipo(s)',
  motivo: 'motivo(s)',
  solicitante: 'solicitante(s)',
  refletido: 'status de refletido(s)',
  destino: 'tipo(s) destino/origem',
};
const MS_TIPO_OPTS = [
  { v: 'aumento_real', l: '🔴 Aumento real' },
  { v: 'remanejamento', l: '🔵 Remanejamento' },
  { v: 'economia', l: '🟢 Economia' },
  { v: 'pendente', l: '🟡 Pendente' },
  { v: 'sem_classificacao', l: '⚪ Sem classificação' },
  { v: 'misto', l: '⚪ Misto' },
];
const MS_REFLETIDO_OPTS = [
  { v: 'pendente', l: '⏳ Pendente' },
  { v: 'sim', l: '✅ Sim - refletido' },
  { v: 'nao', l: '❌ Não - não refletir' },
];
const MS_DESTINO_OPTS = [
  { v: 'com_destino', l: '✓ Com destino' },
  { v: 'sem_destino', l: '✗ Sem destino' },
  { v: 'com_origem', l: '✓ Com origem' },
  { v: 'sem_origem', l: '✗ Sem origem' },
];

// Pega todos os valores possíveis para uma chave a partir dos dados
function msGetAllValues(key) {
  if (key === 'tipo') return MS_TIPO_OPTS.map(o => o.v);
  if (key === 'refletido') return MS_REFLETIDO_OPTS.map(o => o.v);
  if (key === 'destino') return MS_DESTINO_OPTS.map(o => o.v);
  if (!getFlowsObraAtiva() || !getFlowsObraAtiva().length) return [];
  const field = (key === 'solicitante') ? 'solicitante' : key;
  return [...new Set(getFlowsObraAtiva().map(f => f[field]).filter(v => v != null && v !== ''))].sort();
}

function msLabelFor(key, value) {
  if (key === 'tipo') {
    const o = MS_TIPO_OPTS.find(x => x.v === value);
    return o ? o.l : value;
  }
  if (key === 'refletido') {
    const o = MS_REFLETIDO_OPTS.find(x => x.v === value);
    return o ? o.l : value;
  }
  if (key === 'destino') {
    const o = MS_DESTINO_OPTS.find(x => x.v === value);
    return o ? o.l : value;
  }
  return value;
}

function msToggle(key) {
  const all = document.querySelectorAll('.ms-panel.open');
  all.forEach(p => { if (p.id !== `ms_${key}_panel`) p.classList.remove('open'); });
  const panel = document.getElementById(`ms_${key}_panel`);
  if (!panel) return;
  if (panel.classList.contains('open')) { panel.classList.remove('open'); return; }
  msRenderPanel(key);
  panel.classList.add('open');
}

// Fechar ao clicar fora
document.addEventListener('click', (e) => {
  if (!e.target.closest('.ms-wrap')) {
    document.querySelectorAll('.ms-panel.open').forEach(p => p.classList.remove('open'));
  }
});

function msRenderPanel(key) {
  const panel = document.getElementById(`ms_${key}_panel`);
  if (!panel) return;
  const allValues = msGetAllValues(key);
  // contagem por valor nos dados
  const counts = {};
  if (key === 'refletido') {
    getFlowsObraAtiva().forEach(f => {
      const v = f.refletido_status || 'pendente';
      counts[v] = (counts[v]||0) + 1;
    });
  } else if (key === 'destino') {
    const isReal = v => v && !['', '-', 'Não encontrado!', 'VERIFICAR'].includes(v) && !String(v).toUpperCase().includes('VERIFICAR');
    getFlowsObraAtiva().forEach(f => {
      if (isReal(f.insumo_planejamento)) counts['com_destino'] = (counts['com_destino']||0) + 1;
      else counts['sem_destino'] = (counts['sem_destino']||0) + 1;
      if (isReal(f.insumo_remanejamento)) counts['com_origem'] = (counts['com_origem']||0) + 1;
      else counts['sem_origem'] = (counts['sem_origem']||0) + 1;
    });
  } else {
    const field = (key === 'solicitante') ? 'solicitante' : key;
    getFlowsObraAtiva().forEach(f => {
      const v = f[field];
      if (v != null && v !== '') counts[v] = (counts[v]||0) + 1;
    });
  }

  const html = `
    <input type="text" class="ms-search" placeholder="🔍 buscar..." data-input-action="msFilterOpts" data-action-mode="arg-value" data-action-arg="${key}">
    <div class="ms-actions">
      <button type="button" data-click-action="msSelectAll" data-action-mode="arg-bool" data-action-arg="${key}" data-action-value="true">Marcar todos</button>
      <button type="button" data-click-action="msSelectAll" data-action-mode="arg-bool" data-action-arg="${key}" data-action-value="false">Desmarcar todos</button>
      <button type="button" data-click-action="msInvert" data-action-mode="arg" data-action-arg="${key}">Inverter</button>
    </div>
    <div class="ms-list" id="ms_${key}_list">
      ${allValues.map(v => {
        const checked = !MS_EXCLUDED[key].has(v);
        const label = msLabelFor(key, v);
        const c = counts[v] || 0;
        return `<label class="ms-opt" data-search="${escAttr(String(label).toLowerCase())}">
          <input type="checkbox" ${checked?'checked':''} data-ms-value="${escAttr(String(v))}">
          <span>${escHtml(label)}</span>
          <span class="ms-count">${c}</span>
        </label>`;
      }).join('')}
    </div>
    <div class="ms-footer">
      <span><span id="ms_${key}_status"></span></span>
      <button type="button" data-click-action="msClose" data-action-mode="arg" data-action-arg="${key}">Aplicar ✓</button>
    </div>
  `;
  panel.innerHTML = html;
  panel.querySelectorAll('input[data-ms-value]').forEach(input => {
    input.addEventListener('change', () => {
      msOnCheck(key, input.dataset.msValue, input.checked);
    });
  });
  msUpdateStatus(key);
}

function msFilterOpts(key, term) {
  const t = (term||'').toLowerCase();
  const opts = document.querySelectorAll(`#ms_${key}_list .ms-opt`);
  opts.forEach(o => {
    const txt = o.dataset.search || '';
    o.style.display = txt.includes(t) ? '' : 'none';
  });
}

function msSelectAll(key, marcar) {
  const allValues = msGetAllValues(key);
  if (marcar) MS_EXCLUDED[key].clear();
  else allValues.forEach(v => MS_EXCLUDED[key].add(v));
  // atualizar checkboxes
  document.querySelectorAll(`#ms_${key}_list input[type=checkbox]`).forEach(cb => cb.checked = marcar);
  msUpdateStatus(key);
  msUpdateBtn(key);
  renderFlowTable();
}

function msInvert(key) {
  const allValues = msGetAllValues(key);
  const newSet = new Set(allValues.filter(v => !MS_EXCLUDED[key].has(v)));
  MS_EXCLUDED[key] = newSet;
  msRenderPanel(key);
  msUpdateBtn(key);
  renderFlowTable();
}

function msOnCheck(key, value, checked) {
  if (checked) MS_EXCLUDED[key].delete(value);
  else MS_EXCLUDED[key].add(value);
  msUpdateStatus(key);
  msUpdateBtn(key);
  renderFlowTable();
}

function msUpdateStatus(key) {
  const allValues = msGetAllValues(key);
  const excluded = MS_EXCLUDED[key].size;
  const selected = allValues.length - excluded;
  const el = document.getElementById(`ms_${key}_status`);
  if (el) el.textContent = `${selected} de ${allValues.length} marcados`;
}

function msClose(key) {
  const p = document.getElementById(`ms_${key}_panel`);
  if (p) p.classList.remove('open');
}

function msUpdateBtn(key) {
  const btn = document.getElementById(`ms_${key}_btn`);
  if (!btn) return;
  const allValues = msGetAllValues(key);
  const excluded = MS_EXCLUDED[key].size;
  const totalSelected = allValues.length - excluded;
  const baseLabels = { dep: 'departamentos', tipo: 'tipos', motivo: 'motivos', solicitante: 'solicitantes', refletido: 'status', destino: 'tipos destino/origem' };
  if (excluded === 0) {
    btn.textContent = `Todos ${baseLabels[key]}`;
    btn.classList.remove('has-filter');
  } else if (totalSelected === 0) {
    btn.textContent = `Nenhum ${baseLabels[key].slice(0,-1)}`;
    btn.classList.add('has-filter');
  } else if (totalSelected === 1) {
    // Mostra o único valor selecionado
    const onlySel = allValues.find(v => !MS_EXCLUDED[key].has(v));
    btn.textContent = msLabelFor(key, onlySel);
    btn.classList.add('has-filter');
  } else {
    btn.textContent = `${totalSelected} de ${allValues.length} ${baseLabels[key]}`;
    btn.classList.add('has-filter');
  }
}

function msMatches(key, value) {
  // valor passa pelo filtro se NÃO estiver no conjunto de excluídos
  if (value == null || value === '') {
    // valores vazios: passam apenas se não houver exclusões
    return MS_EXCLUDED[key].size === 0;
  }
  return !MS_EXCLUDED[key].has(value);
}

function msResetAll() {
  Object.keys(MS_EXCLUDED).forEach(k => MS_EXCLUDED[k].clear());
  Object.keys(MS_EXCLUDED).forEach(k => msUpdateBtn(k));
}

// ============ SELEÇÃO E AÇÕES EM MASSA ============
const MASS_SELECTED = new Set();

function toggleMassSelect(cb) {
  const n = cb.dataset.n;
  if (cb.checked) MASS_SELECTED.add(n);
  else MASS_SELECTED.delete(n);
  // Visual: marcar linha
  const tr = cb.closest('tr');
  if (tr) tr.classList.toggle('row-selected', cb.checked);
  updateMassBar();
  // Sincronizar checkbox header
  syncSelectAllHeader();
}

function toggleSelectAllVisible(cb) {
  const checkboxes = document.querySelectorAll('#flowTbody input[type="checkbox"][data-n]');
  checkboxes.forEach(c => {
    c.checked = cb.checked;
    const n = c.dataset.n;
    if (cb.checked) MASS_SELECTED.add(n);
    else MASS_SELECTED.delete(n);
    const tr = c.closest('tr');
    if (tr) tr.classList.toggle('row-selected', cb.checked);
  });
  updateMassBar();
}

function syncSelectAllHeader() {
  const head = document.getElementById('flowSelectAll');
  if (!head) return;
  const checkboxes = document.querySelectorAll('#flowTbody input[type="checkbox"][data-n]');
  const total = checkboxes.length;
  const checked = [...checkboxes].filter(c => c.checked).length;
  head.checked = (total > 0 && checked === total);
  head.indeterminate = (checked > 0 && checked < total);
}

function clearMassSelection() {
  MASS_SELECTED.clear();
  document.querySelectorAll('#flowTbody input[type="checkbox"][data-n]').forEach(c => c.checked = false);
  document.querySelectorAll('#flowTbody tr').forEach(tr => tr.classList.remove('row-selected'));
  const head = document.getElementById('flowSelectAll');
  if (head) { head.checked = false; head.indeterminate = false; }
  updateMassBar();
}

function updateMassBar() {
  const bar = document.getElementById('massBar');
  if (!bar) return;
  if (!isEditorDaObraAtiva()) {
    MASS_SELECTED.clear();
    bar.style.display = 'none';
    bar.replaceChildren();
    return;
  }
  const n = MASS_SELECTED.size;
  if (n === 0) { bar.style.display = 'none'; bar.replaceChildren(); return; }
  // Soma dos valores selecionados
  const selFlows = [...MASS_SELECTED].map(nAlt => getFlowsObraAtiva().find(f => f.n_alteracao === nAlt)).filter(Boolean);
  const totVal = selFlows.reduce((s,f) => s + (f.custo_flowmaster||0), 0);
  bar.style.display = 'flex';
  bar.className = 'mass-bar';
  bar.innerHTML = `
    <strong>☑️ ${n} aditivo${n>1?'s':''} selecionado${n>1?'s':''}</strong>
    <span style="opacity:0.85; font-size:12px;">· Σ ${fmtR$(totVal)}</span>
    <span style="margin-left:auto;"></span>
    <button class="btn-mass" data-click-action="massAplicarDestino" title="Aplica o mesmo INSUMO PLANEJAMENTO em todos os selecionados">🎯 Aplicar Destino</button>
    <button class="btn-mass" data-click-action="massAplicarOrigem" title="Aplica o mesmo INSUMO REMANEJAMENTO em todos os selecionados">🔄 Aplicar Origem</button>
    <button class="btn-mass" data-click-action="massAplicarRefletido" title="Marca todos com o mesmo status de reflexo">✅ Marcar Refletido</button>
    <button class="btn-mass danger" data-click-action="clearMassSelection">🗑️ Limpar seleção</button>
  `;
}

// Modal genérico de aplicação em massa
function massPrompt(titulo, descricao, opcoesHtml, callback) {
  const html = `
    <form data-modal-form="mass">
    <h2>${titulo}</h2>
    <div class="meta" style="margin-bottom: 14px;">${descricao}</div>
    <div class="form-grid">
      ${opcoesHtml}
    </div>
    <div class="form-actions">
      <button type="button" class="btn-sm" data-click-action="closeModal">Cancelar</button>
      <button type="submit" class="btn-sm primary" data-action="mass-confirm">✓ Aplicar a ${MASS_SELECTED.size} aditivo(s)</button>
    </div>
    </form>
  `;
  window._massCallback = callback;
  window.massConfirmCallback = () => {
    try {
      window._massCallback();
      closeModal();
      renderFlowTable();
      renderFlows();
      // Sincronizar TODAS as telas (Visão Geral, Tendência de Obra, Controle Projeção)
      syncAllViewsFromFlows();
    } catch (e) { authToast('❌ Erro: ' + e.message, 'err', 5000); }
  };
  document.getElementById('modalContent').innerHTML = html;
  openModal({ initialFocus: 'input, select, textarea' });
}

// Limita a concorrência para não saturar a API durante edições em massa.
async function supaBulkUpsertClassifications(payloads) {
  if (!isEditorDaObraAtiva() || !SUPA || !payloads.length) return;
  if (payloads.some(item => item.codigo_obra !== OBRA_ATIVA)) return;
  const batchSize = 12;
  for (let i = 0; i < payloads.length; i += batchSize) {
    const batch = payloads.slice(i, i + batchSize);
    await Promise.all(batch.map(({ codigo_obra, n_alteracao, updated_at, ...patch }) =>
      supaPatchClassification(n_alteracao, patch, codigo_obra)
    ));
  }
}

function massAplicarDestino() {
  if (!requireEditorForActiveProject('classificar aditivos em massa')) return;
  const opt = `
    <div class="full">
      <label for="massDestInput">INSUMO PLANEJAMENTO (destino) a aplicar em ${MASS_SELECTED.size} aditivo(s):</label>
      <input type="text" id="massDestInput" list="insumosDatalist" placeholder="digite p/ buscar..." style="width:100%; padding:8px 10px; border:1px solid var(--border-strong); border-radius:6px; font-size:13px;">
      <div style="font-size:11px; color:var(--text-soft); margin-top:4px;">Aceita opções especiais (Aumento de obra, Não encontrado!, etc.) e os 125 insumos da tendência</div>
    </div>
  `;
  massPrompt('🎯 Aplicar Destino em massa', `Substitui o campo INSUMO PLANEJAMENTO em <strong>${MASS_SELECTED.size}</strong> aditivo(s) selecionado(s).`, opt, () => {
    const novo = valueFromDisplay(document.getElementById('massDestInput').value);
    if (novo === null || novo === undefined) throw new Error('Valor inválido');
    // localStorage lido UMA vez antes do loop
    const map = readClassificationMap();
    const bulkPayloads = [];
    MASS_SELECTED.forEach(nAlt => {
      const f = getFlowsObraAtiva().find(x => x.n_alteracao === nAlt);
      if (!f) return;
      f.insumo_planejamento = novo;
      f._edited_p = true;
      f.tipo = classifyFlow(f.insumo_planejamento, f.insumo_remanejamento);
      const codigoObra = f.codigo_obra || OBRA_ATIVA || '';
      const key = codigoObra + ':' + nAlt;
      if (!map[key]) map[key] = { codigo_obra: codigoObra };
      map[key].insumo_planejamento = novo;
      bulkPayloads.push({ codigo_obra: codigoObra, n_alteracao: nAlt, insumo_planejamento: novo, updated_at: new Date().toISOString() });
    });
    // Escrita no localStorage UMA vez após o loop
    SafeStorage.set(STORAGE_KEY, JSON.stringify(map));
    // Supabase bulk (1 requisição em vez de N)
    void runAsyncSafely(supaBulkUpsertClassifications(bulkPayloads), 'Classificações/destino em massa', 'As alterações em massa foram salvas apenas neste navegador.');
    buildLinks();
  });
}

function massAplicarOrigem() {
  if (!requireEditorForActiveProject('classificar aditivos em massa')) return;
  const opt = `
    <div class="full">
      <label for="massOrigInput">INSUMO DE REMANEJAMENTO (origem) a aplicar em ${MASS_SELECTED.size} aditivo(s):</label>
      <input type="text" id="massOrigInput" list="insumosDatalist" placeholder="digite p/ buscar..." style="width:100%; padding:8px 10px; border:1px solid var(--border-strong); border-radius:6px; font-size:13px;">
    </div>
  `;
  massPrompt('🔄 Aplicar Origem em massa', `Substitui o campo INSUMO DE REMANEJAMENTO em <strong>${MASS_SELECTED.size}</strong> aditivo(s) selecionado(s).`, opt, () => {
    const novo = valueFromDisplay(document.getElementById('massOrigInput').value);
    if (novo === null || novo === undefined) throw new Error('Valor inválido');
    const map = readClassificationMap();
    const bulkPayloads = [];
    MASS_SELECTED.forEach(nAlt => {
      const f = getFlowsObraAtiva().find(x => x.n_alteracao === nAlt);
      if (!f) return;
      f.insumo_remanejamento = novo;
      f._edited_r = true;
      f.tipo = classifyFlow(f.insumo_planejamento, f.insumo_remanejamento);
      const codigoObra = f.codigo_obra || OBRA_ATIVA || '';
      const key = codigoObra + ':' + nAlt;
      if (!map[key]) map[key] = { codigo_obra: codigoObra };
      map[key].insumo_remanejamento = novo;
      bulkPayloads.push({ codigo_obra: codigoObra, n_alteracao: nAlt, insumo_remanejamento: novo, updated_at: new Date().toISOString() });
    });
    SafeStorage.set(STORAGE_KEY, JSON.stringify(map));
    void runAsyncSafely(supaBulkUpsertClassifications(bulkPayloads), 'Classificações/origem em massa', 'As alterações em massa foram salvas apenas neste navegador.');
    buildLinks();
  });
}

function massAplicarRefletido() {
  if (!requireEditorForActiveProject('classificar aditivos em massa')) return;
  const opt = `
    <div class="full">
      <label for="massReflInput">Status de reflexo a aplicar em ${MASS_SELECTED.size} aditivo(s):</label>
      <select id="massReflInput" style="width:100%; padding:8px 10px; border:1px solid var(--border-strong); border-radius:6px; font-size:13px;">
        <option value="sim">✅ Sim — refletir no planejamento</option>
        <option value="nao">❌ Não — não refletir (ex: cancelado)</option>
        <option value="pendente">⏳ Pendente — ainda não decidido</option>
      </select>
    </div>
  `;
  massPrompt('✅ Marcar status de reflexo em massa', `Aplica o status em <strong>${MASS_SELECTED.size}</strong> aditivo(s) selecionado(s).`, opt, () => {
    const status = document.getElementById('massReflInput').value;
    const map = readClassificationMap();
    const bulkPayloads = [];
    MASS_SELECTED.forEach(nAlt => {
      const f = getFlowsObraAtiva().find(x => x.n_alteracao === nAlt);
      if (!f) return;
      f.refletido_status = status;
      f.refletido = (status === 'sim');
      const codigoObra = f.codigo_obra || OBRA_ATIVA || '';
      const key = codigoObra + ':' + nAlt;
      if (!map[key]) map[key] = { codigo_obra: codigoObra };
      map[key].refletido_status = status;
      map[key].refletido = (status === 'sim');
      bulkPayloads.push({ codigo_obra: codigoObra, n_alteracao: nAlt, refletido_status: status, updated_at: new Date().toISOString() });
    });
    SafeStorage.set(STORAGE_KEY, JSON.stringify(map));
    void runAsyncSafely(supaBulkUpsertClassifications(bulkPayloads), 'Classificações/reflexo em massa', 'As alterações em massa foram salvas apenas neste navegador.');
  });
}

// ============ EDIÇÃO DE VALOR (Fluxo Planejamento) ============
// parseNumBR agora é um alias para parseNumero (definido no início do script)

function onValorChange(input) {
  if (!requireEditorForActiveProject('alterar valores de aditivos')) {
    renderFlowTable();
    return;
  }
  const nAlt = input.dataset.n;
  const novo = parseNumero(input.value);
  const f = getFlowsObraAtiva().find(x => x.n_alteracao === nAlt);
  if (!f) return;
  f.custo_flowmaster = novo;
  f._edited_v = true;
  // usar chave composta (codigo_obra:n_alteracao) + sync com Supabase
  const codigoObra = f.codigo_obra || OBRA_ATIVA || '';
  const key = codigoObra + ':' + nAlt;
  const map = readClassificationMap();
  if (!map[key]) map[key] = { codigo_obra: codigoObra };
  map[key].custo_flowmaster = novo;
  SafeStorage.set(STORAGE_KEY, JSON.stringify(map));
  // Sync com Supabase (persiste entre uploads/dispositivos)
  void runAsyncSafely(
    supaPatchClassification(nAlt, { custo_flowmaster: novo }, codigoObra),
    'Classificações/salvar valor no Supabase',
    'O valor foi salvo apenas neste navegador.'
  );
  // Atualizar display canônico
  input.value = novo != null ? fmt(novo) : '';
  input.classList.add('edited');
  input.classList.remove('pos','neg');
  if (novo != null) input.classList.add(novo < 0 ? 'neg' : 'pos');
  // Recalcular agregados em todas as telas
  syncAllViewsFromFlows();
  // Atualizar contador rodapé
  refreshFlowCountFooter();
}

function refreshFlowCountFooter() {
  // Re-renderiza apenas o contador, sem recriar a tabela toda
  const tbody = document.getElementById('flowTbody');
  if (!tbody) return;
  const visibleRows = tbody.querySelectorAll('tr').length;
  // Soma dos valores atualmente no DATA_F filtrado: recalcular do zero é mais simples
  // Reusa renderFlowTable se filtros mudaram, mas aqui só atualiza o texto
  // Como onValorChange já chamou render dos agregados, basta atualizar o footer
  // baseado nos valores brutos das linhas — vamos simplesmente reaplicar render se mais simples
}

// Lista oficial de motivos (usada no formulário de aditivo manual)
const MOTIVOS_OFICIAIS = ["ACRÉSCIMO ESCOPO COMERCIAL", "ALTERAÇÃO DE VENDA", "BAIXA PRODUTIVIDADE", "COMPRA / CONTRATAÇÃO EMERGENCIAL", "CONSUMO SUBESTIMADO", "DESPERDÍCIO / PERDAS INCORPORADAS", "DETALHAMENTO DE INSUMOS NA COMPOSIÇÃO PARA COMPRA", "DIRETRIZES DE CONCESSIONÁRIAS E ORGÃOS PÚBLICOS", "DIVERGENCIA DE QUANTITATIVOS COM PROJETO", "EMISSÃO DE PROJETO EXECUTIVO", "EXECUÇÃO DIVERGENTE DE PROJETO", "FALTA DE ESPECIFICAÇÃO TÉCNICA", "FURTO/ROUBO", "INDENIZAÇÕES", "INTERFERENCIA ENTRE PROJETOS", "INTERPÉRIES / PERIODO CHUVOSO", "MATERIAL COM MÁ QUALIDADE", "MODELO/ESTRATÉGIA DE CONTRATAÇÃO", "MUDANÇA DE ESTRATÉGIA COORPORATIVA", "MUDANÇA DE ESTRATÉGIA/METODOLOGIA EXECUTIVA", "OMISSÃO EM ESPOCO PARA CONTRATAÇÃO", "OMISSÃO EM LINHA DE BALANÇO", "OMISSÃO EM ORÇAMENTO", "OMISSÃO EM PROJETO", "PRODUÇÃO SUPERESTIMADA / SUBESTIMADA", "QUALIFICAÇÃO DA MÃO DE OBRA / EMPREITEIROS", "REVISÃO DE PROJETO EXECUTIVO", "SEQUENCIAMENTO PLANEJADO INADEQUADO", "VARIAÇÃO DE PREÇO UNITÁRIO"];

// ============ MANUAIS ============
// (declarado em CONFIG no topo)

function loadManuals() {
  try {
    const raw = localStorage.getItem(MANUAL_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch(e) {
    reportNonFatalError('Manuais/estado local inválido', e, 'Os aditivos manuais locais não puderam ser lidos.');
    return [];
  }
}

function saveManuals(arr) {
  if (!isEditorDaObraAtiva()) return false;
  SafeStorage.set(MANUAL_KEY, JSON.stringify(arr));
  // Sync com Supabase: identifica quais mudaram desde a última chamada é caro,
  // então faz upsert de todos (idempotente). Para excluídos, chamamos supaDeleteManual quando o botão é clicado.
  if (SUPA) {
    void runAsyncSafely(
      Promise.all(arr.map(m => supaUpsertManual(m))),
      'Manuais/sincronizar no Supabase',
      'Os aditivos manuais foram salvos apenas neste navegador.'
    );
  }
}

function applyManuals() {
  // Remove anteriores e adiciona novamente (idempotente)
  DATA_F = DATA_F.filter(f => !f.is_manual);
  const manuals = loadManuals();
  manuals.forEach(m => {
    DATA_F.push({
      ...m,
      is_manual: true,
      tipo: classifyFlow(m.insumo_planejamento, m.insumo_remanejamento),
    });
  });
}

function nextManualId() {
  const manuals = loadManuals();
  let max = 0;
  manuals.forEach(m => {
    const m1 = String(m.n_alteracao||'').match(/^M(\d+)$/);
    if (m1) max = Math.max(max, parseInt(m1[1]));
  });
  return 'M' + String(max + 1).padStart(3, '0');
}

function openManualForm(editing) {
  if (!requireEditorForActiveProject('adicionar ou editar aditivos manuais')) return;
  const f = editing || {};
  const today = new Date().toLocaleDateString('pt-BR');
  const tpl = document.getElementById('tpl-manual-form').content.cloneNode(true);

  // Preencher ID
  tpl.querySelector('.id-placeholder').textContent = f.n_alteracao || nextManualId();

  // Preencher select de departamentos
  const depSelect = tpl.querySelector('#m_dep');
  ['Obra','Projeto','Orçamento','Planejamento','Suprimentos','Finalizado','Cancelado'].forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    if (f.dep === d) opt.selected = true;
    depSelect.appendChild(opt);
  });

  // Preencher data
  const dataInput = tpl.querySelector('#m_data');
  dataInput.value = f.data_br || today;
  dataInput.placeholder = today;

  // Preencher descrição
  tpl.querySelector('#m_desc').value = f.descricao || '';

  // Preencher motivos
  const motivoSelect = tpl.querySelector('#m_motivo');
  MOTIVOS_OFICIAIS.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    if (f.motivo === m) opt.selected = true;
    motivoSelect.appendChild(opt);
  });

  // Preencher valor
  tpl.querySelector('#m_valor').value = f.custo_flowmaster != null ? fmt(f.custo_flowmaster) : '';

  // Preencher destino e origem
  tpl.querySelector('#m_dest').value = displayForValue(f.insumo_planejamento || '');
  tpl.querySelector('#m_orig').value = displayForValue(f.insumo_remanejamento || '');

  // Preencher justificativa
  tpl.querySelector('#m_just').value = f.justificativa || '';

  // Preencher data-n no botão salvar
  tpl.querySelector('[data-action="save-manual"]').dataset.n = f.n_alteracao || '';

  // Renderizar
  const content = document.getElementById('modalContent');
  content.replaceChildren();
  content.appendChild(tpl);
  openModal({ initialFocus: '#m_desc' });
}

function saveManualForm(editingId) {
  if (!requireEditorForActiveProject('salvar aditivos manuais')) return;
  const get = id => document.getElementById(id).value.trim();
  const dep = get('m_dep');
  const data = get('m_data');
  const desc = get('m_desc');
  const motivo = get('m_motivo');
  const valor = parseNumero(get('m_valor'));
  const dest = valueFromDisplay(get('m_dest'));
  const orig = valueFromDisplay(get('m_orig'));
  const just = get('m_just');

  if (!desc) { authToast('⚠️ Descrição é obrigatória.', 'warn', 3000); return; }
  if (!dep) { authToast('⚠️ Departamento é obrigatório.', 'warn', 3000); return; }

  const manuals = loadManuals();
  const id = editingId || nextManualId();

  const obj = {
    n_alteracao: id,
    n_adt: '',
    dep, descricao: desc,
    data: data, data_br: data,
    aprovador_dep: '', aprovador: '',
    solicitante_dep: '', solicitante: '',
    custo_flowmaster: valor, custo_planejamento: valor,
    motivo, justificativa: just,
    incl_orcamento: '', incl_planej: '', incl_tendencia: '', revisao_tendencia: '',
    insumo_planejamento: dest, insumo_remanejamento: orig,
    obs: '',
  };

  // se editando, substitui; senão adiciona
  const idx = manuals.findIndex(m => m.n_alteracao === id);
  if (idx >= 0) manuals[idx] = obj;
  else manuals.push(obj);

  saveManuals(manuals);
  applyManuals();
  closeModal();
  // Sincronizar todas as telas com debounce (evita múltiplas renderizações)
  debouncedRender();
  authToast(`✅ Aditivo manual ${id} salvo.`, 'ok', 3000);
}

async function deleteManual(id) {
  if (!requireEditor('excluir aditivo manual')) return;
  const confirmed = await confirmModal('Excluir aditivo manual?', 'Excluir o aditivo manual ' + id + '?\nEssa ação não pode ser desfeita.', { confirmText: 'Excluir', destructive: true });
  if (!confirmed) return;
  const manuals = loadManuals().filter(m => m.n_alteracao !== id);
  saveManuals(manuals);
  void runAsyncSafely(supaDeleteManual(id), 'Manuais/excluir no Supabase', 'O aditivo foi removido apenas neste navegador.');
  applyManuals();
  // Sincronizar todas as telas com debounce (evita múltiplas renderizações)
  debouncedRender();
}

// Visualização de Flows fornecida por ui/views/flows.mjs.

// ============ UPLOAD POR ABA ============
// Interface de uploads fornecida por ui/uploads.mjs.

// Parsers de Tendência, Flows e Gestões são instalados por assets/js/parsers/index.mjs.

// Visualização de Tendência de Obra fornecida por ui/views/projection.mjs.

// Controle de projeção fornecido por ui/views/projection-control.mjs.

// v0.63.3 — Exports XLSX padronizados
// Adiciona: exportarDetalhamentoXLSX, exportarFlowsXLSX, exportarControleProjXLSX
// Todos seguem o padrão da Projeção Detalhada (v0.60.3):
//   - Aba principal com dados da OBRA ATIVA (tabela completa, ignora filtros)
//   - Aba "Metadados" com contexto (obra, usuário, timestamp, data corte, etc)
//   - Format code Excel nativo #,##0.00;-#,##0.00;"-" nas cols monetárias
//   - Arquivo nomeado: <tipo>_<codigo_obra>_<AAAA-MM-DD>.xlsx

// ============================================================================
// HELPER GENÉRICO — cria WB de 2 abas com format code nas cols monetárias
// ============================================================================
function _criarWorkbookXLSX(nomeAba, linhas, larguras, metaEntries, colunasMonetariasIdx) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(linhas);
  if (larguras && larguras.length) ws['!cols'] = larguras;

  // Aplicar format code nativo Excel nas cols monetárias
  if (Array.isArray(colunasMonetariasIdx) && colunasMonetariasIdx.length && ws['!ref']) {
    const FMT = '#,##0.00;-#,##0.00;"-"';
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = range.s.r + 1; R <= range.e.r; R++) {
      for (const C of colunasMonetariasIdx) {
        const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = ws[cellRef];
        if (cell && typeof cell.v === 'number') {
          cell.t = 'n';
          cell.z = FMT;
        }
      }
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, nomeAba);

  if (metaEntries && metaEntries.length) {
    const wsMeta = XLSX.utils.json_to_sheet(metaEntries);
    wsMeta['!cols'] = [{ wch: 32 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsMeta, 'Metadados');
  }

  return wb;
}

function _metaBase(fonteAba) {
  return [
    { 'Campo': 'Aba de origem', 'Valor': fonteAba },
    { 'Campo': 'Obra ativa', 'Valor': OBRA_ATIVA || '(não selecionada)' },
    { 'Campo': 'Nome da obra', 'Valor': (getObraInfo && getObraInfo(OBRA_ATIVA)?.nome) || '' },
    { 'Campo': 'Usuário logado', 'Valor': AUTH?.user?.email || '(anônimo)' },
    { 'Campo': 'Papel do usuário', 'Valor': AUTH?.role || (AUTH?.isAdminGeral ? 'admin' : AUTH?.isEditor ? 'editor' : 'anônimo') },
    { 'Campo': 'Versão do dashboard', 'Valor': 'v0.63.3' },
    { 'Campo': 'Exportado em', 'Valor': new Date().toLocaleString('pt-BR') },
  ];
}

// ============================================================================
// EXPORT 1 — DETALHAMENTO
// ============================================================================
async function exportarDetalhamentoXLSX() {
  try {
    if (!Array.isArray(DATA_T) || !DATA_T.length) {
      authToast('⚠️ Sem dados de Tendência carregados para esta obra. Suba o arquivo primeiro.', 'warn', 5000);
      return;
    }
    await ensureXlsx();
    // Ignora filtros — exporta TUDO da obra ativa (DATA_T já é por obra)
    const linhas = DATA_T.map(d => ({
      'Grupo': d.grupo || '',
      'Código': d.cod || '',
      'Item': d.item || '',
      'Cód. Serviço': d.cod_servico || '',
      'Cód. Insumo': d.cod_insumo || '',
      'Nível': d.nivel || '',
      'Tipo': d.tipo || '',
      'É folha': d.is_folha ? 'Sim' : 'Não',
      'Licitação (R$)': (d.licitacao != null) ? Math.round(d.licitacao * 100) / 100 : null,
      'Corrigido IPCA (R$)': (d.corrigido_ipca != null) ? Math.round(d.corrigido_ipca * 100) / 100 : null,
      'Corrigido INCC (R$)': (d.corrigido_incc != null) ? Math.round(d.corrigido_incc * 100) / 100 : null,
      'Gestão (R$)': (d.gestao != null) ? Math.round(d.gestao * 100) / 100 : null,
      'Δ R$ (Licitação - Gestão)': (d.diferenca != null) ? Math.round(d.diferenca * 100) / 100 : null,
      'Δ % (vs Licitação)': (d.licitacao && d.gestao != null) ? Math.round(((d.gestao - d.licitacao) / d.licitacao) * 10000) / 100 : null,
      'Aditivos Total (R$)': (d.aditivo_total != null) ? Math.round(d.aditivo_total * 100) / 100 : null,
      'Evolução Teórica (%)': (d.evolucao_teorica != null) ? Math.round(d.evolucao_teorica * 100) / 100 : null,
      'Evolução Financeira (%)': (d.evolucao_financeira != null) ? Math.round(d.evolucao_financeira * 100) / 100 : null,
    }));
    const larguras = [
      { wch: 32 }, { wch: 14 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 8 },
      { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 18 },
    ];
    // Cols monetárias (0-indexed): Licitação=8, IPCA=9, INCC=10, Gestão=11, Δ R$=12, Aditivos=14
    const colsMon = [8, 9, 10, 11, 12, 14];
    const wb = _criarWorkbookXLSX('Detalhamento', linhas, larguras, _metaBase('Detalhamento por Item'), colsMon);
    const nome = `detalhamento_${OBRA_ATIVA || 'obra'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, nome);
    console.log(`[EXPORT] Detalhamento exportado: ${nome} (${linhas.length} linhas)`);
  } catch (e) {
    console.error('[EXPORT] Detalhamento erro:', e);
    authToast('❌ Erro ao exportar: ' + (e.message || e), 'err', 5000);
  }
}

// ============================================================================
// EXPORT 2 — FLOWS / ADITIVOS
// ============================================================================
async function exportarFlowsXLSX() {
  try {
    const flows = (typeof getFlowsObraAtiva === 'function') ? getFlowsObraAtiva() : [];
    if (!flows.length) {
      authToast('⚠️ Sem aditivos carregados para esta obra. Suba o CSV do Flows primeiro.', 'warn', 5000);
      return;
    }
    await ensureXlsx();
    const refletidoLabel = { sim: 'Sim', nao: 'Não', pendente: 'Pendente' };
    const tipoLabel = {
      aumento_real: 'Aumento real',
      remanejamento: 'Remanejamento',
      economia: 'Economia',
      pendente: 'Pendente',
      cancelado: 'Cancelado',
      sem_classificacao: 'Sem classificação',
      misto: 'Misto',
    };
    const linhas = flows.map(f => ({
      'N° Alteração': f.n_alteracao || '',
      'Data': f.data_br || '',
      'Departamento': f.dep || '',
      'Descrição': f.descricao || '',
      'Motivo': f.motivo || '',
      'Justificativa': f.justificativa || '',
      'Custo Flowmaster (R$)': (f.custo_flowmaster != null) ? Math.round(f.custo_flowmaster * 100) / 100 : null,
      'Custo Planejamento (R$)': (f.custo_planejamento != null) ? Math.round(f.custo_planejamento * 100) / 100 : null,
      'Insumo Planejamento (destino)': f.insumo_planejamento || '',
      'Insumo Remanejamento (origem)': f.insumo_remanejamento || '',
      'Tipo classificação': tipoLabel[f.tipo] || f.tipo || '',
      'Refletido?': refletidoLabel[f.refletido_status] || f.refletido_status || 'Pendente',
      'Solicitante Dep.': f.solicitante_dep || '',
      'É manual': f.is_manual ? 'Sim' : 'Não',
    }));
    const larguras = [
      { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 50 }, { wch: 28 }, { wch: 50 },
      { wch: 18 }, { wch: 18 }, { wch: 28 }, { wch: 28 }, { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 8 },
    ];
    // Cols monetárias: Custo Flow=6, Custo Planej=7
    const colsMon = [6, 7];
    const wb = _criarWorkbookXLSX('Aditivos', linhas, larguras, _metaBase('Flows / Aditivos'), colsMon);
    const nome = `flows_${OBRA_ATIVA || 'obra'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, nome);
    console.log(`[EXPORT] Flows exportado: ${nome} (${linhas.length} linhas)`);
  } catch (e) {
    console.error('[EXPORT] Flows erro:', e);
    authToast('❌ Erro ao exportar: ' + (e.message || e), 'err', 5000);
  }
}

// ============================================================================
// EXPORT 3 — CONTROLE DE PROJEÇÃO (substitui exportMovs CSV)
// ============================================================================
async function exportarControleProjXLSX() {
  try {
    const movs = (PROJ_CTRL_STATE?.movimentacoes) || [];
    if (!movs.length) {
      authToast('⚠️ Sem movimentações cadastradas para esta obra.', 'warn', 5000);
      return;
    }
    await ensureXlsx();
    // Ordenar por data (mais antiga primeiro)
    const movsOrd = [...movs].sort((a, b) => (a.data || '').localeCompare(b.data || ''));

    const tipoLabel = {
      aporte: 'Aporte',
      devolucao: 'Devolução',
      aditivo: 'Aditivo',
      remanejamento: 'Remanejamento',
    };

    // Calcular saldo acumulado linha a linha
    let saldo = PROJ_CTRL_STATE?.saldo_inicial || 0;
    const linhas = [];
    // Linha 1: saldo inicial (se configurado)
    if (PROJ_CTRL_STATE?.saldo_inicial != null) {
      linhas.push({
        'ID': '(inicial)',
        'Tipo': 'Saldo inicial',
        'Data': PROJ_CTRL_STATE?.data_ref || '',
        'Data (BR)': '',
        'Origem/Descrição': 'Saldo inicial configurado',
        'Destino': '',
        'Valor (R$)': PROJ_CTRL_STATE.saldo_inicial,
        'Saldo acumulado (R$)': saldo,
        'Responsável': '',
        'Justificativa': '',
        'Criado em': '',
        'Criado por': '',
      });
    }
    movsOrd.forEach(m => {
      const v = m.valor || 0;
      const isEntrada = ['aporte', 'devolucao'].includes(m.tipo);
      saldo += isEntrada ? v : -v;
      linhas.push({
        'ID': m.id || '',
        'Tipo': tipoLabel[m.tipo] || m.tipo || '',
        'Data': m.data || '',
        'Data (BR)': m.data_br || '',
        'Origem/Descrição': m.origem || m.descricao || '',
        'Destino': m.destino || '',
        'Valor (R$)': isEntrada ? v : -v,
        'Saldo acumulado (R$)': saldo,
        'Responsável': m.responsavel || '',
        'Justificativa': m.justificativa || '',
        'Criado em': m.created_at ? new Date(m.created_at).toLocaleString('pt-BR') : '',
        'Criado por': m.created_by || '',
      });
    });

    const larguras = [
      { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 24 },
      { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 40 }, { wch: 18 }, { wch: 22 },
    ];
    // Cols monetárias: Valor=6, Saldo=7
    const colsMon = [6, 7];

    const metaExtra = _metaBase('Controle Projeção');
    metaExtra.push({ 'Campo': 'Insumo controlado', 'Valor': PROJ_CTRL_STATE?.insumo || '' });
    metaExtra.push({ 'Campo': 'Saldo inicial (R$)', 'Valor': PROJ_CTRL_STATE?.saldo_inicial ?? '' });
    metaExtra.push({ 'Campo': 'Data de referência', 'Valor': PROJ_CTRL_STATE?.data_ref || '' });
    metaExtra.push({ 'Campo': 'Total de movimentações', 'Valor': movs.length });
    metaExtra.push({ 'Campo': 'Saldo final calculado (R$)', 'Valor': Math.round(saldo * 100) / 100 });

    const wb = _criarWorkbookXLSX('Movimentações', linhas, larguras, metaExtra, colsMon);
    const nome = `controle-projecao_${OBRA_ATIVA || 'obra'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, nome);
    console.log(`[EXPORT] Controle Projeção exportado: ${nome} (${linhas.length} linhas)`);
  } catch (e) {
    console.error('[EXPORT] Controle Projeção erro:', e);
    authToast('❌ Erro ao exportar: ' + (e.message || e), 'err', 5000);
  }
}

// Alias pra retrocompat (código antigo chamava exportMovs())
function exportMovs() { return exportarControleProjXLSX(); }

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

// ============================================================================
// v0.62 — AUTH MULTI-PROVIDER (Google + Email/Senha + Roles)
// Centraliza: handleAuthClick(), provedores de login e permissões por papel
// Adiciona: openLoginModal, closeLoginModal, doSignInEmail, doSignUpEmail,
//           doSignInGoogle, mostrar tela pending
// ============================================================================

// -------- MODAL DE LOGIN --------

function openLoginModal(modo = 'login') {
  switchLoginTab(modo);
  // Limpar campos
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginSenha').value = '';
  document.getElementById('signupEmail').value = '';
  document.getElementById('signupSenha').value = '';
  document.getElementById('signupSenha2').value = '';
  document.getElementById('signupNome').value = '';
  document.getElementById('loginErro').textContent = '';
  document.getElementById('signupErro').textContent = '';
  openModalLayer(document.getElementById('loginModalBackdrop'), {
    initialFocus: modo === 'signup' ? '#signupNome' : '#loginEmail',
  });
}

function closeLoginModal() {
  closeModalLayer(document.getElementById('loginModalBackdrop'), false);
}

function switchLoginTab(modo) {
  const isLogin = modo === 'login';
  document.getElementById('loginTabLogin').classList.toggle('active', isLogin);
  document.getElementById('loginTabSignup').classList.toggle('active', !isLogin);
  document.getElementById('loginPanelLogin').hidden = !isLogin;
  document.getElementById('loginPanelSignup').hidden = isLogin;
}

// -------- HANDLERS DE LOGIN --------

async function doSignInGoogle() {
  if (!SUPA) { authToast('Supabase não conectado', 'err'); return; }
  closeLoginModal();
  const { error } = await AUTH_SERVICE.signInWithGoogle({
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) {
    authToast('Erro no login Google: ' + error.message, 'err');
  }
}

async function doSignInEmail() {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const senha = document.getElementById('loginSenha').value;
  const erroEl = document.getElementById('loginErro');
  erroEl.textContent = '';
  if (!email || !senha) {
    erroEl.textContent = 'Preencha email e senha.';
    return;
  }
  if (!SUPA) { erroEl.textContent = 'Supabase não conectado.'; return; }
  const { error } = await AUTH_SERVICE.signInWithPassword({ email, password: senha });
  if (error) {
    // Mensagens mais amigáveis
    let msg = error.message || 'Erro desconhecido';
    if (msg.includes('Invalid login credentials')) msg = 'Email ou senha incorretos.';
    if (msg.includes('Email not confirmed')) msg = 'Email ainda não confirmado. Verifique sua caixa de entrada.';
    erroEl.textContent = msg;
    return;
  }
  closeLoginModal();
  // onAuthStateChange dispara e cuida do resto
}

async function doSignUpEmail() {
  const email = document.getElementById('signupEmail').value.trim().toLowerCase();
  const senha = document.getElementById('signupSenha').value;
  const senha2 = document.getElementById('signupSenha2').value;
  const nome  = document.getElementById('signupNome').value.trim();
  const erroEl = document.getElementById('signupErro');
  erroEl.textContent = '';
  if (!email || !senha) { erroEl.textContent = 'Preencha email e senha.'; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { erroEl.textContent = 'Email inválido.'; return; }
  if (senha.length < 6) { erroEl.textContent = 'Senha precisa ter no mínimo 6 caracteres.'; return; }
  if (senha !== senha2) { erroEl.textContent = 'As senhas não conferem.'; return; }
  if (!SUPA) { erroEl.textContent = 'Supabase não conectado.'; return; }
  const { error } = await AUTH_SERVICE.signUp({
    email,
    password: senha,
    name: nome,
    emailRedirectTo: window.location.origin + window.location.pathname,
  });
  if (error) {
    let msg = error.message || 'Erro desconhecido';
    if (msg.includes('already registered') || msg.includes('User already')) {
      msg = 'Este email já está cadastrado. Tente entrar em vez de criar conta.';
    }
    erroEl.textContent = msg;
    return;
  }
  authToast('✅ Cadastro realizado! Você entrou como "aguardando aprovação". Peça ao admin para liberar seu acesso.', 'ok', 6000);
  closeLoginModal();
  // Se auto-confirm estiver ativo, o Supabase já loga automaticamente e onAuthStateChange dispara.
  // Se auto-confirm estiver desativado, o usuário precisa clicar no link do email.
}

// -------- AÇÃO PRINCIPAL DE AUTENTICAÇÃO --------

async function handleAuthClick() {
  if (!SUPA) { authToast('Supabase não conectado', 'err'); return; }
  if (AUTH.user) {
    // Logout — mesmo comportamento de antes
    const confirmed = await confirmModal('Sair da conta?', 'Você continuará vendo o dashboard, mas não conseguirá editar.', { confirmText: 'Sair', destructive: false });
    if (!confirmed) return;
    const { error } = await AUTH_SERVICE.signOut();
    if (error) authToast('Erro ao sair: ' + error.message, 'err');
  } else {
    // Abrir modal em vez de ir direto pro Google
    openLoginModal('login');
  }
}
