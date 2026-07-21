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
  return Promise.resolve(operation).catch(error => {
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
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || cssVar;
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
const SUPA_STATUS = { online: !!SUPA, lastSync: null, lastError: null };

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
        : 'background:#dcfce7; border:1px solid #16a34a; color:#166534;';
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
    return `<label style="display:flex; gap:8px; align-items:center; padding:5px 8px; border-radius:4px; cursor:pointer;" onmouseover="this.style.background='var(--fgr-red-light)'" onmouseout="this.style.background=''">
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
          <button class="btn-sm" data-action="aprovar-pendente" data-email="${escAttr(e.email)}" style="padding:3px 8px; font-size:11px; background:#dcfce7; border:1px solid #16a34a; color:#166534;" title="Definir papel e aprovar">✅ Aprovar</button>
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
const UPLOADS_BUCKET = 'uploads-history';
const UPLOADS_MAX_PER_TYPE = CONFIG.max_uploads_por_tipo; // rolling backup: mantém os N mais recentes por tipo

function sanitizeStoragePath(path) {
  const value = String(path || '').trim().replace(/^\/+/, '');
  if (
    !value
    || /^[a-z][a-z0-9+.-]*:/i.test(value)
    || /[\u0000-\u001f\u007f\\]/.test(value)
    || value.split('/').some(segment => !segment || segment === '.' || segment === '..')
  ) return '';
  return value;
}

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

async function supaCreateUploadRecord(tipo, nomeArquivo, tamanhoBytes, linhas, storagePath, uploadGroupId) {
  if (!SUPA) throw new Error('Supabase indisponível para registrar o upload');
  if (!requireUploadPermission(tipo, 'registrar este upload')) throw new Error('Sem permissão para registrar este upload');
  if (!OBRA_ATIVA) throw new Error('Nenhuma obra ativa para registrar o upload');
  const enviadoPor = (AUTH && AUTH.user) ? AUTH.user.email : null;
  const { data, error } = await SUPA.from('upload_history').insert({
    codigo_obra: OBRA_ATIVA,
    tipo, nome_arquivo: nomeArquivo,
    tamanho_bytes: tamanhoBytes || null,
    linhas: linhas || null,
    enviado_por: enviadoPor,
    storage_path: sanitizeStoragePath(storagePath) || null,
    upload_group_id: uploadGroupId || null,
    observacao: 'upload_state:processing',
    is_active: false,
  }).select().maybeSingle();
  if (error) {
    SUPA_STATUS.lastError = error.message;
    updateSupaBadge();
    throw error;
  }
  if (!data) throw new Error('Supabase não retornou o registro do upload');
  SUPA_STATUS.lastSync = new Date();
  updateSupaBadge();
  return data;
}

async function supaActivateUploadRecord(record) {
  if (!record?.id) throw new Error('Registro de upload inválido para ativação');
  const { data: previous, error: readError } = await SUPA.from('upload_history')
    .select('id')
    .eq('codigo_obra', record.codigo_obra)
    .eq('tipo', record.tipo)
    .eq('is_active', true)
    .neq('id', record.id);
  if (readError) throw readError;

  const previousIds = (previous || []).map(item => item.id);
  if (previousIds.length) {
    const { error } = await SUPA.from('upload_history')
      .update({ is_active: false })
      .eq('codigo_obra', record.codigo_obra)
      .eq('tipo', record.tipo)
      .in('id', previousIds);
    if (error) throw error;
  }

  const { data: active, error: activateError } = await SUPA.from('upload_history')
    .update({ is_active: true, observacao: 'upload_state:active' })
    .eq('codigo_obra', record.codigo_obra)
    .eq('tipo', record.tipo)
    .eq('id', record.id)
    .select()
    .maybeSingle();
  if (activateError || !active) {
    let restoreError = null;
    if (previousIds.length) {
      const restored = await SUPA.from('upload_history')
        .update({ is_active: true })
        .eq('codigo_obra', record.codigo_obra)
        .eq('tipo', record.tipo)
        .in('id', previousIds);
      restoreError = restored.error;
    }
    const failure = activateError || new Error('O novo upload não pôde ser ativado');
    if (restoreError) {
      throw new Error(`${failure.message}. O arquivo ativo anterior também não pôde ser restaurado: ${restoreError.message}`);
    }
    throw failure;
  }
  return { active, previousIds };
}

async function supaRollbackUploadActivation(activation) {
  if (!activation?.active?.id) return;
  const record = activation.active;
  const { error: deactivateError } = await SUPA.from('upload_history')
    .update({ is_active: false })
    .eq('codigo_obra', record.codigo_obra)
    .eq('tipo', record.tipo)
    .eq('id', record.id);
  if (deactivateError) throw deactivateError;
  if (activation.previousIds?.length) {
    const { error } = await SUPA.from('upload_history')
      .update({ is_active: true })
      .eq('codigo_obra', record.codigo_obra)
      .eq('tipo', record.tipo)
      .in('id', activation.previousIds);
    if (error) throw error;
  }
}

async function supaDeleteUploadRecords(records) {
  const ids = (records || []).map(record => record?.id).filter(Boolean);
  if (!ids.length) return;
  const { error } = await SUPA.from('upload_history')
    .delete()
    .eq('codigo_obra', OBRA_ATIVA)
    .in('id', ids);
  if (error) throw error;
}

async function supaMarkUploadRecordsFailed(records) {
  const ids = (records || []).map(record => record?.id).filter(Boolean);
  if (!ids.length) return;
  const { error } = await SUPA.from('upload_history')
    .update({ is_active: false, observacao: 'upload_state:failed' })
    .eq('codigo_obra', OBRA_ATIVA)
    .in('id', ids);
  if (error) throw error;
}

async function supaRemoveStoredUpload(storagePath) {
  const cleanPath = sanitizeStoragePath(storagePath);
  if (!cleanPath) return;
  const { error } = await SUPA.storage.from(UPLOADS_BUCKET).remove([cleanPath]);
  if (error) throw error;
}

async function supaCleanupIncompleteUploads(maxProcessingAgeMs = 60 * 60 * 1000) {
  if (!SUPA || !AUTH.user || !OBRA_ATIVA || !isEditorDaObraAtiva()) return 0;
  const { data, error } = await SUPA.from('upload_history')
    .select('id,tipo,storage_path,observacao,enviado_em')
    .eq('codigo_obra', OBRA_ATIVA)
    .in('observacao', ['upload_state:processing', 'upload_state:failed']);
  if (error) throw error;

  const cutoff = Date.now() - maxProcessingAgeMs;
  const stale = (data || []).filter(record => {
    const canManageKind = isGlobalUploadKind(record.tipo) ? isAdminGeral() : isEditorDaObraAtiva();
    const isStale = record.observacao === 'upload_state:failed'
      || new Date(record.enviado_em || 0).getTime() < cutoff;
    return canManageKind && isStale;
  });
  if (!stale.length) return 0;

  const staleIds = new Set(stale.map(record => record.id));
  const removablePaths = [];
  for (const storagePath of new Set(stale.map(record => sanitizeStoragePath(record.storage_path)).filter(Boolean))) {
    const { data: references, error: referenceError } = await SUPA.from('upload_history')
      .select('id')
      .eq('codigo_obra', OBRA_ATIVA)
      .eq('storage_path', storagePath);
    if (referenceError) throw referenceError;
    if ((references || []).every(reference => staleIds.has(reference.id))) removablePaths.push(storagePath);
  }

  if (removablePaths.length) {
    const { error: storageError } = await SUPA.storage.from(UPLOADS_BUCKET).remove(removablePaths);
    if (storageError) throw storageError;
  }
  const { error: deleteError } = await SUPA.from('upload_history')
    .delete()
    .eq('codigo_obra', OBRA_ATIVA)
    .in('id', [...staleIds]);
  if (deleteError) throw deleteError;
  return stale.length;
}

// Sobe o arquivo original; falhas interrompem o commit do upload.
async function supaUploadFile(tipo, file) {
  if (!SUPA || !SUPA.storage) throw new Error('Storage do Supabase indisponível');
  if (!requireUploadPermission(tipo, 'enviar este arquivo')) throw new Error('Sem permissão para enviar este arquivo');
  if (!OBRA_ATIVA) throw new Error('Nenhuma obra ativa para armazenar o upload');
  // Nome único: YYYYMMDD_HHMMSS_original.csv (evita colisão + facilita ordenação)
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  // Sanitiza nome (remove caracteres estranhos)
  const safeName = (file.name || 'arquivo.csv').replace(/[^\w.\-]/g, '_');
  // v0.58a: prefixa com codigo_obra pra isolamento no Storage
  const safeObra = OBRA_ATIVA.replace(/[^\w.\-]/g, '_');
  const path = `${safeObra}/${tipo}/${stamp}_${safeName}`;
  const { error } = await SUPA.storage.from(UPLOADS_BUCKET).upload(path, file, {
    contentType: file.type || 'text/csv',
    upsert: false,
  });
  if (error) {
    SUPA_STATUS.lastError = 'Storage: ' + error.message;
    updateSupaBadge();
    throw error;
  }
  return path;
}

// lista TODOS os uploads de um tipo (ordenado do mais recente)
async function supaListUploadsByType(tipo, limit = 50, strict = false) {
  if (!SUPA) return [];
  if (!OBRA_ATIVA) return [];
  const { data, error } = await SUPA.from('upload_history')
    .select('*').eq('codigo_obra', OBRA_ATIVA).eq('tipo', tipo)
    .order('enviado_em', { ascending: false }).limit(limit);
  if (error) {
    if (strict) throw error;
    console.warn('[SUPA] listUploads err:', error);
    return [];
  }
  return data || [];
}

// gera signed URL de download (válida por 60s)
async function supaGetDownloadURL(storagePath) {
  if (!SUPA || !AUTH || !AUTH.user || !OBRA_ATIVA) return null;
  const cleanPath = sanitizeStoragePath(storagePath);
  if (!cleanPath) return null;
  const safeObra = OBRA_ATIVA.replace(/[^\w.\-]/g, '_');
  if (!cleanPath.startsWith(safeObra + '/')) return null;
  const { data, error } = await SUPA.storage.from(UPLOADS_BUCKET)
    .createSignedUrl(cleanPath, 60);
  if (error) { console.warn('[SUPA] signedUrl err:', error); return null; }
  return data?.signedUrl || null;
}

// rolling backup — remove uploads mais antigos que passaram do limite
async function supaEnforceRollingBackup(tipo) {
  if (!SUPA || !requireUploadPermission(tipo, 'gerenciar os backups deste upload')) return;
  try {
    const all = await supaListUploadsByType(tipo, 100, true);
    if (all.length <= UPLOADS_MAX_PER_TYPE) return;
    // NUNCA descarta arquivo ativo, mesmo que seja o mais antigo.
    // Ordem: pega os que passaram do limite MAS filtra pra não incluir ativos.
    const excedentes = all.slice(UPLOADS_MAX_PER_TYPE);
    const toDelete = excedentes.filter(r => !r.is_active);
    if (!toDelete.length) return;
    console.log(`[SUPA] rolling backup ${tipo}: removendo ${toDelete.length} arquivo(s) antigo(s)`);
    const ids = toDelete.map(r => r.id);
    const idSet = new Set(ids);
    const removablePaths = [];
    const candidatePaths = new Set(toDelete.map(r => sanitizeStoragePath(r.storage_path)).filter(Boolean));
    for (const storagePath of candidatePaths) {
      const { data: references, error: referenceError } = await SUPA.from('upload_history')
        .select('id')
        .eq('codigo_obra', OBRA_ATIVA)
        .eq('storage_path', storagePath);
      if (referenceError) throw referenceError;
      if ((references || []).every(reference => idSet.has(reference.id))) removablePaths.push(storagePath);
    }

    // Remove primeiro os metadados; falha posterior deixa no máximo um arquivo órfão,
    // nunca uma entrada de histórico apontando para um arquivo inexistente.
    const { error: dbErr } = await SUPA.from('upload_history').delete()
      .eq('codigo_obra', OBRA_ATIVA).in('id', ids);
    if (dbErr) throw dbErr;

    if (removablePaths.length) {
      const { error: sErr } = await SUPA.storage.from(UPLOADS_BUCKET).remove(removablePaths);
      if (sErr) throw sErr;
    }
  } catch (e) {
    console.warn('[SUPA] rolling backup err:', e);
    throw e;
  }
}

async function supaLoadUploadsLatest() {
  // Retorna { tendencia: {...}, flows: {...}, gestoes: {...} } com o último por tipo,
  // filtrado pela OBRA_ATIVA.
  if (!SUPA) return {};
  if (!OBRA_ATIVA) return {};
  try {
    const { data, error } = await supaRetry(function() {
      return SUPA.from('upload_history_latest').select('*').eq('codigo_obra', OBRA_ATIVA);
    });
    if (error) {
      console.warn('[SUPA] view latest indisp, tentando fallback:', error.message);
      return await _supaLoadUploadsLatestFallback();
    }
    const map = {};
    (data || []).forEach(r => { map[r.tipo] = r; });
    return map;
  } catch (e) {
    console.warn('[SUPA] loadUploadsLatest err (após retries):', e);
    return {};
  }
}
async function _supaLoadUploadsLatestFallback() {
  const map = {};
  if (!OBRA_ATIVA) return map;
  for (const t of ['tendencia', 'flows', 'gestoes']) {
    const { data } = await SUPA.from('upload_history')
      .select('*').eq('codigo_obra', OBRA_ATIVA).eq('tipo', t).eq('is_active', true)
      .order('enviado_em', { ascending: false }).limit(1);
    if (data && data[0]) map[t] = data[0];
  }
  return map;
}

// LAST_UPLOADS declarado na seção ESTADO GLOBAL acima
// ---------- Badge visual de sincronização ----------
function updateSupaBadge() {
  // badges translúcidos brancos no header escuro (só ícone muda o "tom" de mensagem)
  const el = document.getElementById('supaBadge');
  if (!el) return;
  const baseBg = 'rgba(255,255,255,0.15)';
  const baseBorder = 'rgba(255,255,255,0.3)';
  el.style.color = 'white';
  el.style.border = '1px solid ' + baseBorder;
  el.style.background = baseBg;
  if (!SUPA) {
    el.textContent = '🔴 Offline';
    el.style.background = 'rgba(220,38,38,0.35)';
    el.style.borderColor = 'rgba(255,150,150,0.4)';
    el.title = 'Não conectado ao Supabase - dados só ficam salvos aqui';
    return;
  }
  if (SUPA_STATUS.lastError) {
    el.textContent = '⚠️ Erro sync';
    el.style.background = 'rgba(180,83,9,0.35)';
    el.style.borderColor = 'rgba(255,200,100,0.4)';
    el.title = 'Último erro: ' + SUPA_STATUS.lastError;
    return;
  }
  if (SUPA_STATUS.lastSync) {
    el.textContent = '☁️ Sincronizado';
    el.title = 'Última sincronização: ' + SUPA_STATUS.lastSync.toLocaleTimeString('pt-BR');
    return;
  }
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
    bannerEl.innerHTML = '<div class="alert-banner" style="background:linear-gradient(90deg, #FEE2E2 0%, #FECACA 100%); border-left-color:#DC2626;">'
      + '🔴 <strong>Dados muito desatualizados:</strong> último mês de gestão é <strong>' + m[1] + '/' + m[2] + '</strong> (' + mesesAtras + ' meses atrás). '
      + 'Atualize os dados na aba <a href="#" data-click-action="irParaAba" data-action-mode="arg" data-action-arg="uploads" style="color:#DC2626; font-weight:700;">📤 Uploads</a>.</div>';
  } else if (mesesAtras > 2) {
    // Mais de 2 meses: amarelo
    bannerEl.innerHTML = '<div class="alert-banner">'
      + '⚠️ <strong>Dados desatualizados:</strong> último mês de gestão é <strong>' + m[1] + '/' + m[2] + '</strong> (' + mesesAtras + ' meses atrás). '
      + 'Considere atualizar na aba <a href="#" data-click-action="irParaAba" data-action-mode="arg" data-action-arg="uploads" style="color:#92400E; font-weight:700;">📤 Uploads</a>.</div>';
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
      ${interp ? `<div style="padding:8px 10px; background:var(--bg-page); border-radius:5px; font-size:11.5px; color:#334155; margin-top:6px;">💡 ${interp}</div>` : ''}
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

// helpers de placeholder "sem dados"
// Retorna HTML de CTA amigável quando obra não tem Tendência carregada
function renderPlaceholderSemDados(icone, titulo, subtitulo) {
  const obraInfo = (typeof getObraInfo === 'function') ? getObraInfo() : null;
  const nomeObra = obraInfo ? obraInfo.nome : (OBRA_ATIVA || '—');
  return `
    <div style="text-align:center; padding:60px 24px; color:var(--text-soft); background:var(--bg-page); border:2px dashed var(--border-strong); border-radius:12px; margin:20px 0;">
      <div style="font-size:48px; margin-bottom:12px;">${icone || '📭'}</div>
      <h3 style="font-size:16px; color:#334155; margin:0 0 6px; font-weight:600;">${titulo || 'Sem dados para exibir'}</h3>
      <p style="font-size:13px; margin:0 0 20px;">${subtitulo || ('Envie o Excel de Tendência de <strong>' + escHtml(nomeObra) + '</strong> na aba <strong>📤 Uploads</strong>.')}</p>
      <button class="btn-sm primary" data-click-action="irParaAba" data-action-mode="arg" data-action-arg="uploads" style="padding:8px 18px; font-size:13px;">
        📤 Ir para Uploads
      </button>
    </div>
  `;
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
    if (kpisEl) kpisEl.innerHTML = renderPlaceholderSemDados('📈', 'Visão Geral sem dados', null);
    if (gruposEl) gruposEl.replaceChildren();
    if (alertEl) alertEl.replaceChildren();
    // Limpar donut e top 10 também
    const donutEl = document.getElementById('donut');
    const topUpEl = document.getElementById('topUp');
    const topDownEl = document.getElementById('topDown');
    if (donutEl) donutEl.innerHTML = '<div style="text-align:center; color:var(--text-lighter); padding:40px;">—</div>';
    if (topUpEl) topUpEl.replaceChildren();
    if (topDownEl) topDownEl.replaceChildren();
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
          <div style="font-size:18px; font-weight:700; color:#5b21b6; margin-top:2px;">${fmtR$(totCorrigido)}</div>
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
      ${bdLine('💱 Inflação ' + indiceLabel, (inflacaoAbs>=0?'+':'') + fmtR$(inflacaoAbs), '#5b21b6', 'externa, inevitável')}
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
      ${bdLine('🏗️ Tend. Indiretos', (tendIndiretos>=0?'+':'') + fmtR$(tendIndiretos), '#5b21b6', 'extrapolação + flows pendentes')}
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
    const aditInfo = Math.abs(v.aditivos) > 0.01 ? ` · <span style="color:#8b5cf6;">📎 ${fmtR$k(v.aditivos)} em aditivos</span>` : '';
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

// ============ DETALHAMENTO ============
function updateSortHeaderState(selector, dataAttribute, activeKey, direction) {
  document.querySelectorAll(selector).forEach(header => {
    const key = header.getAttribute(dataAttribute);
    const state = key === activeKey ? (direction > 0 ? 'ascending' : 'descending') : 'none';
    const label = header.textContent.trim();
    header.setAttribute('aria-sort', state);
    header.setAttribute(
      'aria-label',
      state === 'none'
        ? `${label}. Ativar ordenação`
        : `${label}. Ordenação ${state === 'ascending' ? 'crescente' : 'decrescente'}`
    );
  });
}

function bindSortableHeaders(selector, dataAttribute, getState, activateSort) {
  document.querySelectorAll(selector).forEach(header => {
    header.tabIndex = 0;
    const activate = () => activateSort(header.getAttribute(dataAttribute));
    header.addEventListener('click', activate);
    header.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activate();
    });
  });
  const state = getState();
  updateSortHeaderState(selector, dataAttribute, state.key, state.direction);
}

function isTableRowActivation(event) {
  return event.type === 'click' || event.key === 'Enter' || event.key === ' ';
}

function populateFilters() {
  const grupos = [...new Set(DATA_T.map(d => d.grupo))].sort();
  const sel = document.getElementById('filterGrupo');
  const cur = sel.value;
  sel.replaceChildren(
    new Option('Todos os grupos', ''),
    ...grupos.map(g => new Option(String(g || ''), String(g || '')))
  );
  sel.value = cur;
}

// cor da célula de Evolução Financeira baseada no descolamento vs Teórica
function _evolClass(d) {
  if (d.evolucao_teorica == null || d.evolucao_financeira == null) return 'var(--sem-alerta)';
  if (d.evolucao_teorica === 0) return 'var(--sem-alerta)';
  // Ratio: quanto o financeiro adiantou/atrasou em relação ao teórico
  const ratio = d.evolucao_financeira / d.evolucao_teorica;
  if (ratio > 1.15) return 'var(--sem-erro)'; // gastando muito acima do executado
  if (ratio < 0.85) return 'var(--sem-ok)'; // executando bem mais do que gastando
  return 'var(--sem-alerta)'; // dentro da faixa
}

function renderTable() {
  // atualizar header da coluna Gestão com o GESTAO_LABEL atual
  const thG = document.getElementById('thGestao');
  if (thG && GESTAO_LABEL) {
    // Encurta 'GESTÃO 07-2026' pra 'Gestão 07/26' pra caber
    const m = GESTAO_LABEL.match(/GEST[ÃA]O\s+(\d{2})-(\d{4})/i);
    thG.textContent = m ? `Gestão ${m[1]}/${m[2].slice(-2)}` : GESTAO_LABEL;
  }
  // guard sem dados
  if (!obraTemTendencia()) {
    const tbody = document.getElementById('tbody');
    const countEl = document.getElementById('count');
    if (tbody) tbody.innerHTML = '<tr><td colspan="11">' + renderPlaceholderSemDados('📋', 'Detalhamento sem dados', null) + '</td></tr>';
    if (countEl) countEl.textContent = '';
    const emptyPage = paginateRows('detail', [], 'empty');
    renderPaginationControls('detailPagination', 'detail', emptyPage, renderTable);
    return;
  }
  const q = document.getElementById('search').value.toLowerCase();
  const fg = document.getElementById('filterGrupo').value;
  const fs = document.getElementById('filterStatus').value;
  const fa = document.getElementById('filterAditivo').value;
  const onlyFolhas = document.getElementById('onlyFolhas').checked;

  let rows = DATA_T.filter(d => {
    if (onlyFolhas && !d.is_folha) return false;
    if (q && !(d.item.toLowerCase().includes(q) || (d.cod_insumo||'').toLowerCase().includes(q) || (d.cod||'').toLowerCase().includes(q))) return false;
    if (fg && d.grupo !== fg) return false;
    if (fs) { const st = statusOf(d.licitacao, d.gestao); if (st !== fs) return false; }
    if (fa === 'com' && (!d.flows_destino || d.flows_destino.length === 0) && (!d.flows_origem || d.flows_origem.length === 0)) return false;
    if (fa === 'sem' && ((d.flows_destino && d.flows_destino.length > 0) || (d.flows_origem && d.flows_origem.length > 0))) return false;
    return true;
  });

  rows.sort((a,b) => {
    let va, vb;
    if (sortKey === 'pct') {
      va = a.licitacao ? (a.gestao - a.licitacao) / a.licitacao : -Infinity;
      vb = b.licitacao ? (b.gestao - b.licitacao) / b.licitacao : -Infinity;
    } else if (sortKey === 'diferenca') {
      va = (a.licitacao != null && a.gestao != null) ? a.gestao - a.licitacao : -Infinity;
      vb = (b.licitacao != null && b.gestao != null) ? b.gestao - b.licitacao : -Infinity;
    } else if (sortKey === 'aditivo_total') {
      va = Math.abs(a.aditivo_total || 0); vb = Math.abs(b.aditivo_total || 0);
    } else { va = a[sortKey]; vb = b[sortKey]; }
    if (va == null) va = -Infinity; if (vb == null) vb = -Infinity;
    if (typeof va === 'string') return sortDir * va.localeCompare(vb);
    return sortDir * (va - vb);
  });

  // Marca cada item com seu índice original em DATA_T (evita indexOf O(n²) no render)
  const idxMap = new Map();
  DATA_T.forEach((d, i) => idxMap.set(d, i));
  const detailPage = paginateRows(
    'detail',
    rows,
    JSON.stringify([q, fg, fs, fa, onlyFolhas, sortKey, sortDir, OBRA_ATIVA]),
  );

  document.getElementById('tbody').innerHTML = detailPage.items.map((d, idx) => {
    const st = statusOf(d.licitacao, d.gestao);
    const diff = (d.licitacao != null && d.gestao != null) ? (d.gestao - d.licitacao) : null;
    const pct = (d.licitacao && d.gestao != null) ? (diff/d.licitacao*100) : null;
    const badge = st ? `<span class="badge ${st}">${st==='red'?'🔴 Estouro':st==='amber'?'🟡 Atenção':'🟢 OK'}</span>` : '';
    if (!d.is_folha) {
      const cls = d.nivel <= 2 ? 'row-grupo' : 'row-sub';
      return `<tr class="${cls}"><td colspan="11">${escHtml(d.cod)} · ${escHtml(d.item)}</td></tr>`;
    }
    const hasAdt = (d.flows_destino && d.flows_destino.length > 0) || (d.flows_origem && d.flows_origem.length > 0);
    const adt = d.aditivo_total || 0;
    const adtTxt = hasAdt ? `<span class="${adt<0?'pos':'neg'}">${adt>=0?'+':''}${fmt(adt)}</span> <span style="color:var(--text-lighter);font-size:10px;">(${(d.flows_destino?.length||0)+(d.flows_origem?.length||0)})</span>` : '<span style="color:var(--text-lighter);">-</span>';
    const origIdx = idxMap.get(d);
    return `<tr class="folha ${hasAdt?'has-aditivo':''}" data-idx="${origIdx}" tabindex="0" aria-label="Abrir detalhes de ${escAttr(d.item || d.cod_insumo || 'item')}">
      <td>${escHtml(d.grupo)}</td>
      <td>${escHtml(d.item)}</td>
      <td style="color:var(--text-soft);font-size:11px;">${escHtml(d.cod_insumo||'')}</td>
      <td class="num">${fmtR$(d.licitacao)}</td>
      <td class="num">${fmtR$(d.gestao)}</td>
      <td class="num ${diff<=0?'pos':'neg'}">${diff!=null?(diff>=0?'+':'')+fmt(diff):'-'}</td>
      <td class="num ${pct<=0?'pos':'neg'}">${pct!=null?fmtPct(pct):'-'}</td>
      <td class="num">${adtTxt}</td>
      <td class="num" style="color:var(--fgr-red);">${d.evolucao_teorica != null ? fmt(d.evolucao_teorica, 0) : '<span style="color:var(--border-strong);">-</span>'}</td>
      <td class="num" style="color:${_evolClass(d)}">${d.evolucao_financeira != null ? fmt(d.evolucao_financeira, 0) : '<span style="color:var(--border-strong);">-</span>'}</td>
      <td>${badge}</td>
    </tr>`;
  }).join('');
  document.getElementById('count').textContent = `${rows.filter(r=>r.is_folha).length} itens · exibindo ${detailPage.start}–${detailPage.end}`;
  renderPaginationControls('detailPagination', 'detail', detailPage, renderTable);
  updateSortHeaderState('th[data-sort]', 'data-sort', sortKey, sortDir);
}

bindSortableHeaders(
  'th[data-sort]',
  'data-sort',
  () => ({ key: sortKey, direction: sortDir }),
  k => {
    if (sortKey === k) sortDir = -sortDir;
    else { sortKey = k; sortDir = (['item','grupo','cod_insumo'].includes(k)) ? 1 : -1; }
    updateSortHeaderState('th[data-sort]', 'data-sort', sortKey, sortDir);
    renderTable();
  }
);

function activateDetailRow(event) {
  if (!isTableRowActivation(event)) return;
  const tr = event.target.closest('tr[data-idx]');
  if (!tr) return;
  if (event.type === 'keydown') event.preventDefault();
  const idx = parseInt(tr.dataset.idx, 10);
  if (!isNaN(idx)) openItem(idx);
}

// Event delegation para abrir detalhes por clique, Enter ou Espaço.
document.getElementById('tbody')?.addEventListener('click', activateDetailRow);
document.getElementById('tbody')?.addEventListener('keydown', activateDetailRow);

// Salvar filtros no localStorage
function salvarFiltros() {
  try {
    const filtros = {
      search: document.getElementById('search')?.value || '',
      filterGrupo: document.getElementById('filterGrupo')?.value || '',
      filterStatus: document.getElementById('filterStatus')?.value || '',
      filterAditivo: document.getElementById('filterAditivo')?.value || '',
      onlyFolhas: document.getElementById('onlyFolhas')?.checked ?? true,
    };
    localStorage.setItem('jzurique_filters_' + (OBRA_ATIVA || 'default'), JSON.stringify(filtros));
  } catch(e) { reportNonFatalError('Filtros/salvar', e); }
}

// Restaurar filtros do localStorage
function restaurarFiltros() {
  try {
    const raw = localStorage.getItem('jzurique_filters_' + (OBRA_ATIVA || 'default'));
    if (!raw) return;
    const filtros = JSON.parse(raw);
    const el = (id) => document.getElementById(id);
    if (el('search')) el('search').value = filtros.search || '';
    if (el('filterGrupo')) el('filterGrupo').value = filtros.filterGrupo || '';
    if (el('filterStatus')) el('filterStatus').value = filtros.filterStatus || '';
    if (el('filterAditivo')) el('filterAditivo').value = filtros.filterAditivo || '';
    if (el('onlyFolhas')) el('onlyFolhas').checked = filtros.onlyFolhas !== false;
  } catch(e) { reportNonFatalError('Filtros/restaurar', e); }
}

// Debounce para filtros — evita re-renderização a cada tecla digitada
const debouncedFiltros = debounce(() => { renderTable(); salvarFiltros(); }, 300);
['search','filterGrupo','filterStatus','filterAditivo','onlyFolhas'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', debouncedFiltros);
    el.addEventListener('change', debouncedFiltros);
  }
});

// ============ MODAL DE ITEM ============
function openItem(idx) {
  const d = DATA_T[idx];
  if (!d.is_folha) return;
  const diff = (d.licitacao != null && d.gestao != null) ? (d.gestao - d.licitacao) : null;
  const pct = (d.licitacao && d.gestao != null) ? (diff/d.licitacao*100) : null;
  const dest = d.flows_destino || [];
  const orig = d.flows_origem || [];
  const totDest = dest.reduce((s,f)=>s+(f.custo_flowmaster||0), 0);
  const totOrig = orig.reduce((s,f)=>s+(f.custo_flowmaster||0), 0);

  document.getElementById('modalContent').innerHTML = `
    <h2>${escHtml(d.item)}</h2>
    <div class="meta">${escHtml(d.grupo)} · Código ${escHtml(d.cod)} · Insumo ${escHtml(d.cod_insumo)}</div>
    <div class="kpis" style="margin-bottom: 16px;">
      <div class="kpi"><div class="label">Licitação</div><div class="value">${fmtR$(d.licitacao)}</div></div>
      <div class="kpi"><div class="label">Gestão atual</div><div class="value">${fmtR$(d.gestao)}</div></div>
      <div class="kpi ${diff>0?'red':'green'}"><div class="label">Desvio</div><div class="value">${diff!=null?(diff>=0?'+':'')+fmtR$(diff):'-'}</div><div class="sub">${pct!=null?fmtPct(pct):''}</div></div>
      <div class="kpi purple"><div class="label">Coberto por aditivo</div><div class="value">${fmtR$(totDest - totOrig)}</div><div class="sub">${dest.length} entrada / ${orig.length} saída</div></div>
    </div>

    ${dest.length > 0 ? `<h3 style="font-size:13px; margin-bottom:8px; color:#7c3aed;">➡️ Aditivos que ENTRARAM neste item (${fmt(totDest)})</h3>` : ''}
    ${dest.map(f => renderFlowMini(f)).join('')}

    ${orig.length > 0 ? `<h3 style="font-size:13px; margin: 14px 0 8px; color:var(--text-medium);">⬅️ Aditivos que SAÍRAM deste item para outros (${fmt(totOrig)})</h3>` : ''}
    ${orig.map(f => renderFlowMini(f, true)).join('')}

    ${dest.length === 0 && orig.length === 0 ? '<div style="text-align:center; color:var(--text-lighter); padding:20px;">Nenhum aditivo vinculado a este item.</div>' : ''}

    ${diff > 0 && totDest < diff ? `<div class="alert-banner" style="margin-top:14px;">
      ⚠️ <strong>Atenção:</strong> o desvio deste item é de ${fmtR$(diff)} mas só ${fmtR$(totDest)} estão formalizados em aditivo. <strong>${fmtR$(diff - totDest)}</strong> ainda são tendência sem aditivo.
    </div>` : ''}
  `;
  openModal();
}

function renderFlowMini(f, isOrigem=false) {
  const tipoLabel = {aumento_real:'🔴 Aumento real', remanejamento:'🔵 Remanejamento', economia:'🟢 Economia', pendente:'🟡 Pendente', cancelado:'🚫 Cancelado', sem_classificacao:'⚪ Sem class.', misto:'⚪ Misto'};
  const depBadge = {Finalizado:'green', Projeto:'amber', Cancelado:'gray', Planejamento:'blue', Orçamento:'blue', Obra:'amber'};
  const linkTxt = isOrigem
    ? `→ destino: ${escHtml(f.insumo_planejamento || '-')}`
    : (f.insumo_remanejamento && !['', '-', 'Não encontrado!'].includes(f.insumo_remanejamento) && !f.insumo_remanejamento.includes('VERIFICAR')
        ? `← origem: ${escHtml(f.insumo_remanejamento)}` : '');
  return `
    <div class="flow-mini-card ${escAttr(f.tipo)}">
      <div class="head">
        <strong>Nº ${escHtml(f.n_alteracao)} ${f.n_adt ? '· '+escHtml(f.n_adt) : ''}</strong>
        <span class="${(f.custo_flowmaster||0)<0?'pos':'neg'}" style="font-weight:700;">${fmtR$(f.custo_flowmaster)}</span>
      </div>
      <div style="font-size:11px;color:var(--text-soft);">
        ${escHtml(formatDate(f.data_br))} · <span class="badge ${depBadge[f.dep]||'gray'}">${escHtml(f.dep)}</span>
        · ${tipoLabel[f.tipo]||escHtml(f.tipo)} · ${escHtml(f.motivo)} ${linkTxt ? '· '+linkTxt : ''}
      </div>
      <div class="desc">${escHtml(f.descricao)}</div>
      ${f.justificativa ? `<div class="desc"><em>Justificativa:</em> ${escHtml(f.justificativa)}</div>` : ''}
    </div>`;
}

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

// ============ FLOWS TAB ============
function renderFlows() {
  // guard sem dados de Flows
  if (!Array.isArray(getFlowsObraAtiva()) || getFlowsObraAtiva().length === 0) {
    const flowSummary = document.getElementById('flowSummary');
    const flowsByTipo = document.getElementById('flowsByTipo');
    const flowsTbody = document.getElementById('flowsTbody');
    if (flowSummary) flowSummary.innerHTML = renderPlaceholderSemDados('🔗', 'Sem aditivos carregados', 'Envie o Excel <strong>Flows</strong> na aba <strong>📤 Uploads</strong>.');
    if (flowsByTipo) flowsByTipo.replaceChildren();
    if (flowsTbody) flowsTbody.replaceChildren();
    return;
  }
  const total = getFlowsObraAtiva().length;
  const byDep = {};
  getFlowsObraAtiva().forEach(f => { byDep[f.dep] = (byDep[f.dep]||0) + 1; });
  const sumFm = arr => arr.reduce((s,f) => s + (f.custo_flowmaster || 0), 0);
  // Cancelado agora é uma classificação própria (some pelo dep OU pelo tipo)
  const isCancelado = f => f.dep === 'Cancelado' || f.tipo === 'cancelado';
  const isNaoRefletir = f => !isCancelado(f) && f.refletido_status === 'nao';
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
  const cancelados = getFlowsObraAtiva().filter(isCancelado);
  if (cancelados.length) {
    tipoSums['cancelado'] = {n: cancelados.length, v: sumFm(cancelados)};
  }
  const descartados = getFlowsObraAtiva().filter(isNaoRefletir);

  document.getElementById('flowSummary').innerHTML = `
    <div class="flow-card"><div class="lbl">Total Aditivos</div><div class="v">${total}</div><div class="sub">${fmtR$(sumFm(getFlowsObraAtiva()))} flowmaster total</div></div>
    <div class="flow-card green"><div class="lbl">Finalizados</div><div class="v">${byDep.Finalizado||0}</div><div class="sub">${fmtR$(sumFm(getFlowsObraAtiva().filter(f=>f.dep==='Finalizado')))}</div></div>
    <div class="flow-card amber"><div class="lbl">Em andamento</div><div class="v">${(byDep.Projeto||0)+(byDep.Planejamento||0)+(byDep.Orçamento||0)+(byDep.Obra||0)}</div><div class="sub">${fmtR$(sumFm(getFlowsObraAtiva().filter(f=>!['Cancelado','Finalizado'].includes(f.dep))))}</div></div>
    <div class="flow-card gray"><div class="lbl">Cancelados</div><div class="v">${byDep.Cancelado||0}</div><div class="sub">${fmtR$(sumFm(getFlowsObraAtiva().filter(f=>f.dep==='Cancelado')))} (descartado)</div></div>
    <div class="flow-card purple"><div class="lbl">Aumento Real</div><div class="v">${fmtR$(tipoSums.aumento_real.v)}</div><div class="sub">${tipoSums.aumento_real.n} aditivos</div></div>
  `;

  // Tipos com barras
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

  // Motivos (só não cancelados)
  const byMot = {};
  active.forEach(f => {
    const m = f.motivo || 'Não informado';
    if (!byMot[m]) byMot[m] = {n:0, v:0};
    byMot[m].n += 1; byMot[m].v += (f.custo_flowmaster || 0);
  });
  const motArr = Object.entries(byMot).sort((a,b) => Math.abs(b[1].v) - Math.abs(a[1].v)).slice(0,8);
  const maxM = Math.max(...motArr.map(m => Math.abs(m[1].v)), 1);
  document.getElementById('flowsByMotivo').innerHTML = motArr.map(([m,v]) => `
    <div class="top-item">
      <div class="name">${escHtml(m)} <span style="color:var(--text-soft);font-size:11px;">(${v.n})</span></div>
      <div class="val ${v.v<0?'pos':'neg'}">${v.v>=0?'+':''}${fmtR$(v.v)}</div>
      <div class="top-bar"><div class="top-bar-fill ${v.v<0?'green':''}" style="width:${Math.abs(v.v)/maxM*100}%;"></div></div>
    </div>`).join('');

  // Filtros multi-select: apenas atualizar labels dos botões (panel é renderizado on-demand)
  ['dep','tipo','motivo','solicitante','refletido','destino'].forEach(k => msUpdateBtn(k));

  renderFlowTable();
}

function flowMatchesDate(f, ini, fim) {
  if (!ini && !fim) return true;
  // f.data_br pode ser dd/mm/yyyy ou serial Excel já convertido em data formatada
  const formatted = formatDate(f.data_br); // dd/mm/yyyy
  const m = formatted.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return true; // se não conseguir parsear, não filtra
  const yyyy_mm = `${m[3]}-${m[2]}`;
  if (ini && yyyy_mm < ini) return false;
  if (fim && yyyy_mm > fim) return false;
  return true;
}

function clearFlowFilters() {
  ['flowSearch','flowFilterDataIni','flowFilterDataFim','flowFilterValMin','flowFilterValMax'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  msResetAll();
  renderFlowTable();
}

function renderFlowTable() {
  const q = document.getElementById('flowSearch').value.toLowerCase();
  const fdi = document.getElementById('flowFilterDataIni')?.value || '';
  const fdf = document.getElementById('flowFilterDataFim')?.value || '';
  const fvmin = parseFloat(document.getElementById('flowFilterValMin')?.value);
  const fvmax = parseFloat(document.getElementById('flowFilterValMax')?.value);
  const editDisabled = isEditorDaObraAtiva() ? '' : ' disabled';

  const isRealVal = v => v && !['', '-', 'Não encontrado!', 'VERIFICAR'].includes(v) && !String(v).toUpperCase().includes('VERIFICAR');

  let rows = getFlowsObraAtiva().filter(f => {
    if (q) {
      const txt = `${f.descricao} ${f.justificativa} ${f.motivo} ${f.insumo_planejamento} ${f.insumo_remanejamento} ${f.solicitante||''}`.toLowerCase();
      if (!txt.includes(q)) return false;
    }
    if (!msMatches('dep', f.dep)) return false;
    if (!msMatches('tipo', f.tipo)) return false;
    if (!msMatches('motivo', f.motivo)) return false;
    if (!msMatches('solicitante', f.solicitante)) return false;
    // Refletido: status do aditivo (precisa default 'pendente')
    const fStat = f.refletido_status || 'pendente';
    if (!msMatches('refletido', fStat)) return false;
    // Destino/Origem: precisa testar SE pelo menos uma das categorias marcadas bate
    // Esquema: para cada valor MS_DESTINO_OPTS, vejo se está selecionado E se este flow se enquadra.
    // Se não há nada excluído, passa. Se algum value tipo "com_destino" está EXCLUÍDO, e o flow tem destino, falha.
    const allDest = MS_DESTINO_OPTS.map(o => o.v);
    const excludedDest = MS_EXCLUDED['destino'];
    if (excludedDest.size > 0) {
      const tags = {
        com_destino: isRealVal(f.insumo_planejamento),
        sem_destino: !isRealVal(f.insumo_planejamento),
        com_origem: isRealVal(f.insumo_remanejamento),
        sem_origem: !isRealVal(f.insumo_remanejamento),
      };
      // Se TODAS as tags ativas do flow estão excluídas, ele cai fora
      // Mais simples: se há qualquer tag ativa NÃO excluída → passa
      const algumPassa = Object.keys(tags).some(k => tags[k] && !excludedDest.has(k));
      if (!algumPassa) return false;
    }
    if (!flowMatchesDate(f, fdi, fdf)) return false;
    const v = f.custo_flowmaster || 0;
    if (!isNaN(fvmin) && v < fvmin) return false;
    if (!isNaN(fvmax) && v > fvmax) return false;
    return true;
  });

  rows.sort((a,b) => {
    let va = a[sortKeyF], vb = b[sortKeyF];
    if (va == null) va = ''; if (vb == null) vb = '';
    if (typeof va === 'string' && typeof vb === 'string') {
      if (sortKeyF === 'n_alteracao') return sortDirF * (parseInt(va) - parseInt(vb));
      return sortDirF * va.localeCompare(vb);
    }
    return sortDirF * (va - vb);
  });

  const tipoLabel = {aumento_real:'<span class="badge red">🔴 Aum.real</span>', remanejamento:'<span class="badge cyan">🔵 Remanej.</span>',
    economia:'<span class="badge green">🟢 Economia</span>', pendente:'<span class="badge amber">🟡 Pendente</span>',
    cancelado:'<span class="badge gray">🚫 Cancelado</span>',
    sem_classificacao:'<span class="badge gray">⚪ Sem class.</span>', misto:'<span class="badge gray">⚪ Misto</span>'};
  const depBadge = {Finalizado:'green', Projeto:'amber', Cancelado:'gray', Planejamento:'blue', Orçamento:'blue', Obra:'amber'};
  const flowPage = paginateRows(
    'flows',
    rows,
    JSON.stringify([
      q, fdi, fdf, Number.isNaN(fvmin) ? '' : fvmin, Number.isNaN(fvmax) ? '' : fvmax,
      sortKeyF, sortDirF, OBRA_ATIVA,
      ...Object.keys(MS_EXCLUDED).sort().map(key => `${key}:${[...MS_EXCLUDED[key]].sort().join(',')}`),
    ]),
  );

  document.getElementById('flowTbody').innerHTML = flowPage.items.map(f => {
    const valEdited = f._edited_v ? ' edited' : '';
    const valCls = (f.custo_flowmaster||0) < 0 ? 'neg' : (f.custo_flowmaster||0) > 0 ? 'pos' : '';
    const valStr = f.custo_flowmaster != null ? fmt(f.custo_flowmaster) : '';
    const manualBadge = f.is_manual ? '<span class="badge-manual">✋ Manual</span>' : '';
    const delBtn = f.is_manual ? `<button class="btn-del-manual" data-editor-only data-action="delete-manual" data-n="${escAttr(f.n_alteracao)}" title="Excluir este aditivo manual" aria-label="Excluir aditivo manual ${escAttr(f.n_alteracao)}">🗑️</button>` : '';
    const status = f.refletido_status || 'pendente';
    const trStyle = status === 'sim' ? 'background:#ecfdf5;' : status === 'nao' ? 'background:#fef2f2;' : '';
    const isSelected = MASS_SELECTED.has(f.n_alteracao);
    return `
    <tr style="${trStyle}" class="${isSelected ? 'row-selected' : ''}" data-n="${escAttr(f.n_alteracao)}">
      <td style="text-align:center; vertical-align:middle;">
        <input type="checkbox" ${isSelected ? 'checked' : ''} data-edit-control${editDisabled} data-n="${escAttr(f.n_alteracao)}" data-change-action="toggleMassSelect" data-action-mode="self" style="cursor:pointer; transform:scale(1.15);">
      </td>
      <td style="vertical-align:middle; padding:6px;">
        <select class="refletido-select status-${escAttr(f.refletido_status || 'pendente')}" data-edit-control${editDisabled} data-n="${escAttr(f.n_alteracao)}" data-change-action="onRefletidoChange" data-action-mode="self" title="Status de reflexo no planejamento">
          <option value="pendente" ${(f.refletido_status||'pendente')==='pendente'?'selected':''}>⏳ Pendente</option>
          <option value="sim" ${f.refletido_status==='sim'?'selected':''}>✅ Sim</option>
          <option value="nao" ${f.refletido_status==='nao'?'selected':''}>❌ Não</option>
        </select>
      </td>
      <td>${escHtml(f.n_alteracao)}${manualBadge}${delBtn}</td>
      <td style="font-size:11px;color:var(--text-soft);">${escHtml(formatDate(f.data_br))}</td>
      <td><span class="badge ${depBadge[f.dep]||'gray'}">${escHtml(f.dep||'')}</span></td>
      <td>${tipoLabel[f.tipo]||''}</td>
      <td class="classif-cell">${renderInsumoSelect(f, 'insumo_planejamento')}</td>
      <td class="classif-cell">${renderInsumoSelect(f, 'insumo_remanejamento')}</td>
      <td class="classif-cell"><input type="text" class="valor-input ${valCls}${valEdited}" data-edit-control${editDisabled}
        value="${escAttr(valStr)}" data-n="${escAttr(f.n_alteracao)}"
        data-change-action="onValorChange" data-action-mode="self" data-select-on-focus
        title="Aceita valores como 1234,56 ou -1.234,56" placeholder="0,00"></td>
      <td style="font-size:11px;"><strong>${escHtml(f.motivo||'')}</strong><br><span style="color:var(--text-soft);">${escHtml((f.descricao||'').length>110?(f.descricao||'').slice(0,107)+'...':(f.descricao||''))}</span></td>
    </tr>`;
  }).join('');
  const refletidos = rows.filter(r => (r.refletido_status||'') === 'sim').length;
  const naorefl = rows.filter(r => (r.refletido_status||'') === 'nao').length;
  document.getElementById('flowCount').textContent = `${rows.length} aditivos · exibindo ${flowPage.start}–${flowPage.end} · ✅ ${refletidos} · ❌ ${naorefl} · Σ ${fmtR$(rows.reduce((s,f)=>s+(f.custo_flowmaster||0),0))}`;
  renderPaginationControls('flowPagination', 'flows', flowPage, renderFlowTable);
  updateSortHeaderState('th[data-sort-flow]', 'data-sort-flow', sortKeyF, sortDirF);
  // Sincronizar checkbox header e barra de massa
  syncSelectAllHeader();
  updateMassBar();
}

// Handler do select de "refletido" (3 estados: pendente / sim / nao)
function onRefletidoChange(sel) {
  if (!requireEditorForActiveProject('alterar o status de reflexo')) {
    renderFlowTable();
    return;
  }
  const nAlt = sel.dataset.n;
  const status = sel.value; // 'pendente' | 'sim' | 'nao'
  const f = getFlowsObraAtiva().find(x => x.n_alteracao === nAlt);
  if (!f) return;
  f.refletido_status = status;
  // manter campo legado 'refletido' = (status === 'sim') por compatibilidade
  f.refletido = (status === 'sim');
  // chave composta + sync Supabase
  const codigoObra = f.codigo_obra || OBRA_ATIVA || '';
  const key = codigoObra + ':' + nAlt;
  const map = readClassificationMap();
  if (!map[key]) map[key] = { codigo_obra: codigoObra };
  map[key].refletido_status = status;
  map[key].refletido = (status === 'sim'); // compat
  SafeStorage.set(STORAGE_KEY, JSON.stringify(map));
  void runAsyncSafely(
    supaPatchClassification(nAlt, { refletido_status: status }, codigoObra),
    'Classificações/salvar reflexo no Supabase',
    'O status foi salvo apenas neste navegador.'
  );
  // Atualizar visual: cor da linha e classe do select
  const tr = sel.closest('tr');
  if (tr) tr.style.background = status === 'sim' ? '#ecfdf5' : (status === 'nao' ? '#fef2f2' : '');
  sel.className = 'refletido-select status-' + status;
  renderFlowTable();
  // Sincronizar TODAS as telas (Visão Geral, Tendência de Obra, Controle Projeção)
  syncAllViewsFromFlows();
}

bindSortableHeaders(
  'th[data-sort-flow]',
  'data-sort-flow',
  () => ({ key: sortKeyF, direction: sortDirF }),
  k => {
    if (sortKeyF === k) sortDirF = -sortDirF;
    else { sortKeyF = k; sortDirF = -1; }
    updateSortHeaderState('th[data-sort-flow]', 'data-sort-flow', sortKeyF, sortDirF);
    renderFlowTable();
  }
);

// Event delegation para botão delete-manual na tabela de flows
document.getElementById('flowTbody')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="delete-manual"]');
  if (btn) deleteManual(btn.dataset.n);
});
// Debounce para filtros de flows
const debouncedFlowTable = debounce(renderFlowTable, 300);
['flowSearch','flowFilterDataIni','flowFilterDataFim','flowFilterValMin','flowFilterValMax'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', debouncedFlowTable);
    el.addEventListener('change', debouncedFlowTable);
  }
});

// ============ UPLOAD POR ABA ============
const MANUAL_TEXT = {
  tendencia: '📈 ABA TENDÊNCIA (formato v0.55+)\n\nExporte da planilha:\n1. Abra o arquivo .xlsm\n2. Vá na aba TENDÊNCIA\n3. Arquivo → Salvar Como → CSV UTF-8 (.csv)\n4. Carregue aqui usando o botão "📤 Carregar CSV"\n\nO arquivo deve manter as colunas de Código, Serviço, Insumo, Item, Licitação, IPCA, INCC, Gestão, Diferença e Evoluções nas posições documentadas.\n\n⚠️ O formato antigo de 17 colunas não é mais aceito.\nVeja a aba "ℹ️ Manual" para detalhes completos.',
  flows: '🔗 ABA FlowsValor\n\nExporte da planilha:\n1. Abra o arquivo .xlsm\n2. Vá na aba FlowsValor (layout Fabric v0.63)\n3. Arquivo → Salvar Como → CSV UTF-8 (.csv)\n4. Carregue aqui\n\nO arquivo deve manter as 15 colunas na ordem oficial, de Cod_aditivo até Refletido.\n\n⚠️ As edições e aditivos manuais NÃO são apagados ao recarregar.\n\nVeja a aba "ℹ️ Manual" para detalhes completos.',
  gestoes: '📅 ABA Gestões\n\nExporte da planilha:\n1. Abra o arquivo .xlsm\n2. Vá na aba Gestões\n3. Arquivo → Salvar Como → CSV UTF-8 (.csv)\n4. Carregue aqui\n\nCabeçalhos obrigatórios: Descr_gestao, Descr_classificacaofinanceira, Key_planejamento, Val_totalliquido e Mes_pagamento.\n\nVeja a aba "ℹ️ Manual" para detalhes completos.',
};

// ============================================================
// v0.52 — Upload handler (refatorado pra usar Central de Uploads)
// ============================================================
function handleUpload(ev, kind /* 'tendencia' | 'flows' | 'gestoes' */) {
  if (!requireUploadPermission(kind, 'enviar este arquivo')) {
    ev.target.value = '';
    return;
  }
  // v0.58a: guard obra ativa (upload sem obra selecionada não faz sentido)
  if (!OBRA_ATIVA) {
    authToast('❌ Nenhuma obra selecionada. Escolha uma obra no header antes de fazer upload.', 'err', 5000);
    ev.target.value = '';
    return;
  }
  const file = ev.target.files[0];
  if (!file) return;
  
  const validation = validateUploadFile(file, 'csv');
  if (!validation.valid) {
    authToast('❌ ' + validation.message, 'err', 5000);
    ev.target.value = '';
    return;
  }
  
  const cardMeta = document.querySelector(`.upload-card[data-kind="${kind}"] .upload-card-meta`);
  if (cardMeta) cardMeta.textContent = '⏳ Lendo arquivo: 0%';
  setUploadRuntimeState(kind, 'processing', 'Lendo e validando o arquivo');

  const reader = new FileReader();
  reader.onprogress = e => {
    if (cardMeta && e.lengthComputable) {
      cardMeta.textContent = `⏳ Lendo arquivo: ${Math.round((e.loaded / e.total) * 100)}%`;
    }
  };
  reader.onload = async e => {
    const memorySnapshot = captureInMemoryUploadState();
    try {
      const txt = e.target.result;
      let result = '';
      let linhas = 0;

      if (kind === 'tendencia') {
        const parsed = parseTendencia(txt);
        if (!parsed.length) throw new Error('TENDÊNCIA: nenhuma linha válida encontrada. Os dados atuais foram mantidos.');
        DATA_T = parsed;
        // fallback pra coluna Gestão vazia (virada de mês)
        aplicarFallbackGestaoDoHistorico();
        // rebuildar datalist de insumos após upload novo
        try { INSUMOS_OPTIONS = buildInsumosList(); buildDatalist(); } catch(e) { reportNonFatalError('Upload/reconstruir lista de insumos', e); }
        linhas = DATA_T.length;
        result = `TENDÊNCIA: ${linhas} linhas`;
      } else if (kind === 'flows') {
        const parsed = parseFlowsValor(txt);
        if (!parsed.length) throw new Error('FLOWS: nenhum aditivo válido encontrado. Os dados atuais foram mantidos.');
        DATA_F = parsed;
        applyManuals();
        loadClassifications();
        linhas = DATA_F.length;
        result = `FLOWS: ${linhas} aditivos`;
      } else if (kind === 'gestoes') {
        const parsed = parseGestoes(txt);
        // v0.57.1 FIX: só sobrescrever se realmente veio conteúdo (evita zerar HISTORICO com CSV/aba vazia)
        if (parsed && parsed.items && parsed.items.length > 0) {
          HISTORICO = parsed;
          // sobrescreve GESTAO_LABEL com última gestão cronológica
          atualizarGestaoLabelPelaHistoria();
          // se coluna Gestão da Tendência estiver vazia, usa HISTORICO como fallback
          aplicarFallbackGestaoDoHistorico();
        } else {
          console.warn('[GESTÕES] arquivo/aba veio vazio — mantendo dados anteriores');
          throw new Error('Aba Gestões não retornou linhas válidas. Filtro esperado: empreendimento=Jardins Zurique, classificação financeira=Obra, chave contendo -21O-. Verifique se está no formato correto.');
        }
        linhas = parsed.items ? parsed.items.length : 0;
        result = `GESTÕES: ${linhas} itens · ${parsed.gestoes.length} gestões`;
      }

      setUploadRuntimeState(kind, 'processing', 'Sincronizando arquivo e dados');
      await commitPreparedUpload({
        file,
        storageType: kind,
        items: [{ kind, linhas }],
        memorySnapshot,
      });

      // Limpeza do backup ocorre depois do commit e não invalida o novo dataset.
      await runAsyncSafely(
        supaEnforceRollingBackup(kind),
        'Upload/limpeza de backups',
        'O upload foi concluído, mas os backups antigos não puderam ser limpos.'
      );

      // Usar debounce para evitar múltiplas renderizações
      debouncedRender();
      renderUploadsCentral();
      renderSourcesHeaders();
      updateEditCount();
      authToast('✅ ' + result + ' · 📦 arquivado e sincronizado', 'ok', 3500);

    } catch (err) {
      console.error(err);
      restoreInMemoryUploadState(memorySnapshot);
      setUploadRuntimeState(kind, 'failed', err.message || String(err));
      authToast('❌ Upload não concluído: ' + err.message, 'err', 7000);
      if (cardMeta) renderUploadsCentral();
    }
    ev.target.value = ''; // permite recarregar mesmo arquivo
  };
  reader.onerror = () => {
    setUploadRuntimeState(kind, 'failed', 'Falha ao ler o arquivo local');
    authToast('❌ Não foi possível ler o arquivo selecionado.', 'err', 5000);
    renderUploadsCentral();
    ev.target.value = '';
  };
  reader.readAsText(file, 'UTF-8');
}

// ============================================================
// v0.52 — Central de Uploads: renderização + drag-and-drop
// ============================================================
// ============================================================
// v0.54 — EXCEL UPLOAD MODULE
// Aceita 1 arquivo .xlsx/.xlsm com 3 abas (Tendência, Flows, Gestões)
// e processa cada aba usando os parsers CSV existentes.
// ============================================================

// Padrões de nome de aba (case-insensitive, sem acentos)
const EXCEL_SHEET_PATTERNS = {
  tendencia: [/^tend[eê]ncia$/i, /^tendencia$/i, /tend/i],
  flows:     [/^flows?\s*valor$/i, /^flows_valor$/i, /flows.*valor/i, /flowsvalor/i],
  gestoes:   [/^gest[oõ]es$/i, /^gestoes$/i, /^gest[aã]o$/i, /gest/i],
};

function _normalizeSheetName(name) {
  return String(name || '').trim();
}

// Tenta identificar automaticamente cada tipo pelo nome da aba.
// Retorna { tendencia: 'nomeAba' | null, flows: ..., gestoes: ... }
function _autoDetectSheets(sheetNames) {
  const result = { tendencia: null, flows: null, gestoes: null };
  for (const kind of Object.keys(EXCEL_SHEET_PATTERNS)) {
    for (const pattern of EXCEL_SHEET_PATTERNS[kind]) {
      const match = sheetNames.find(n => pattern.test(_normalizeSheetName(n)));
      if (match) { result[kind] = match; break; }
    }
  }
  return result;
}

// Obtém o CSV preparado pelo Worker (os parsers existentes continuam independentes do Excel).
function _sheetToCSV(workbook, sheetName) {
  return workbook?.csvBySheet?.[sheetName] || '';
}

function _preflightExcelHeaders(workbook, mapping) {
  const errors = [];
  for (const kind of ['tendencia', 'flows', 'gestoes']) {
    const sheetName = mapping[kind];
    if (!sheetName) continue;
    try {
      const csv = _sheetToCSV(workbook, sheetName);
      validateImportHeaders(kind, parseCSVRows(csv));
    } catch (error) {
      errors.push({ kind, sheetName, message: error.message });
    }
  }
  return errors;
}

// ============================================================
// Handler principal do upload Excel
// ============================================================
async function handleExcelUpload(ev) {
  if (!requireAdmin('enviar a planilha Excel completa')) { ev.target.value = ''; return; }
  // v0.58a: guard obra ativa
  if (!OBRA_ATIVA) {
    authToast('❌ Nenhuma obra selecionada. Escolha uma obra no header antes de fazer upload.', 'err', 5000);
    ev.target.value = '';
    return;
  }
  const file = ev.target.files[0];
  if (!file) return;
  ev.target.value = '';
  
  const validation = validateUploadFile(file, 'excel');
  if (!validation.valid) {
    authToast('❌ ' + validation.message, 'err', 5000);
    return;
  }

  const excelKinds = ['tendencia', 'flows', 'gestoes'];
  setUploadRuntimeState(excelKinds, 'processing', 'Lendo a planilha Excel');
  _renderExcelProgress('⏳ Lendo arquivo: 0%');
  let workbook;
  try {
    workbook = await readExcelFile(file, {
      onProgress: percent => _renderExcelProgress(`⏳ Lendo arquivo: ${percent}%`),
      onReadComplete: () => _renderExcelProgress('⚙️ Processando planilha...'),
    });
  } catch (e) {
    setUploadRuntimeState(excelKinds, 'failed', e.message || String(e));
    authToast('❌ Erro ao ler o arquivo: ' + e.message, 'err', 5000);
    _renderExcelProgress(null);
    renderUploadsCentral();
    return;
  }

  const sheetNames = workbook.sheetNames || [];
  _renderExcelProgress(`📋 ${sheetNames.length} aba(s) encontrada(s): ${sheetNames.join(', ')}`);

  // Tentar auto-detectar
  let mapping = _autoDetectSheets(sheetNames);
  const missing = Object.entries(mapping).filter(([k, v]) => !v).map(([k]) => k);

  if (missing.length > 0) {
    // Abrir modal pro usuário mapear manualmente
    _renderExcelProgress(null);
    const userMapping = await _promptSheetMapping(sheetNames, mapping);
    if (!userMapping) {
      setUploadRuntimeState(excelKinds, 'idle');
      authToast('❌ Upload cancelado', 'warn', 2500);
      return;
    }
    mapping = userMapping;
  } else {
    _renderExcelProgress(`✅ Auto-detectadas: 📈 ${mapping.tendencia} · 🔗 ${mapping.flows} · 📅 ${mapping.gestoes}`);
  }

  const headerErrors = _preflightExcelHeaders(workbook, mapping);
  if (headerErrors.length) {
    setUploadRuntimeState(excelKinds, 'failed', headerErrors.map(error => error.message).join(' · '));
    _renderExcelProgress(null);
    renderUploadsCentral();
    headerErrors.forEach(error => {
      authToast(`❌ Aba "${error.sheetName}": ${error.message}`, 'err', 8000);
    });
    return;
  }

  // Processar as 3 abas
  await _processExcelSheets(workbook, mapping, file);
}

// ============================================================
// Modal pra usuário mapear abas manualmente
// ============================================================
function _promptSheetMapping(sheetNames, autoDetected) {
  return new Promise((resolve) => {
    const modalContent = document.getElementById('modalContent');
    const modalBg = document.getElementById('modalBg');
    if (!modalContent || !modalBg) { resolve(null); return; }

    const opt = (name, selected) =>
      `<option value="${escAttr(name)}" ${name === selected ? 'selected' : ''}>${escHtml(name)}</option>`;

    modalContent.innerHTML = `
      <h2>🗂️ Mapeamento de abas</h2>
      <div class="meta">Não consegui identificar automaticamente todas as abas. Selecione manualmente qual é cada uma:</div>
      <div style="margin: 18px 0;">
        <div class="sheet-mapping-row">
          <label for="mapSheet_tendencia">📈 Tendência:</label>
          <select id="mapSheet_tendencia">${['<option value="">— nenhuma —</option>', ...sheetNames.map(n => opt(n, autoDetected.tendencia))].join('')}</select>
        </div>
        <div class="sheet-mapping-row">
          <label for="mapSheet_flows">🔗 Flows:</label>
          <select id="mapSheet_flows">${['<option value="">— nenhuma —</option>', ...sheetNames.map(n => opt(n, autoDetected.flows))].join('')}</select>
        </div>
        <div class="sheet-mapping-row">
          <label for="mapSheet_gestoes">📅 Gestões:</label>
          <select id="mapSheet_gestoes">${['<option value="">— nenhuma —</option>', ...sheetNames.map(n => opt(n, autoDetected.gestoes))].join('')}</select>
        </div>
        <p style="font-size:11.5px; color:var(--text-soft); margin-top:10px;">
          💡 Se uma aba não existir na planilha, deixe em "— nenhuma —" e ela não será processada.
        </p>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
        <button class="btn-sm" id="mapSheetsCancel">Cancelar</button>
        <button class="btn-sm primary" id="mapSheetsOk">✅ Processar</button>
      </div>
    `;
    const finish = (result) => closeModal(result);
    document.getElementById('mapSheetsCancel').addEventListener('click', () => finish(null));
    document.getElementById('mapSheetsOk').addEventListener('click', () => {
      const r = {
        tendencia: document.getElementById('mapSheet_tendencia').value || null,
        flows:     document.getElementById('mapSheet_flows').value || null,
        gestoes:   document.getElementById('mapSheet_gestoes').value || null,
      };
      if (!r.tendencia && !r.flows && !r.gestoes) {
        authToast('⚠️ Selecione ao menos uma aba pra processar', 'warn', 3000);
        return;
      }
      finish(r);
    });
    openModal({
      onClose: result => resolve(result || null),
      initialFocus: '#mapSheet_tendencia',
    });
  });
}

// ============================================================
// Processar as abas selecionadas do Excel
// ============================================================
async function _processExcelSheets(workbook, mapping, file) {
  if (!requireAdmin('processar a planilha Excel completa')) return;
  // upload_group_id = todos os 3 registros do mesmo Excel compartilham este UUID
  const groupId = _uuid4();
  const results = {};
  const memorySnapshot = captureInMemoryUploadState();

  // 1) Processar todas as abas antes de iniciar qualquer escrita remota.
  const steps = [
    { kind: 'tendencia', label: 'Tendência', icon: '📈', parser: 'tendencia' },
    { kind: 'flows',     label: 'Flows',     icon: '🔗', parser: 'flows' },
    { kind: 'gestoes',   label: 'Gestões',   icon: '📅', parser: 'gestoes' },
  ];
  const selectedKinds = steps.filter(step => mapping[step.kind]).map(step => step.kind);
  setUploadRuntimeState(['tendencia', 'flows', 'gestoes'], 'idle');
  setUploadRuntimeState(selectedKinds, 'processing', 'Validando todas as abas da planilha');

  for (const step of steps) {
    const sheetName = mapping[step.kind];
    if (!sheetName) {
      results[step.kind] = { skipped: true };
      continue;
    }

    _renderExcelProgress(`⚙️ Processando aba "${sheetName}" (${step.icon} ${step.label})...`);
    let csv;
    try {
      csv = _sheetToCSV(workbook, sheetName);
    } catch(e) {
      results[step.kind] = { error: 'Falha ao ler aba: ' + e.message };
      continue;
    }

    // Os parsers repetem a validação do preflight como defesa contra chamadas diretas.
    let linhas = 0;
    try {
      if (step.parser === 'tendencia') {
        const parsed = parseTendencia(csv);
        if (!parsed.length) throw new Error('TENDÊNCIA: nenhuma linha válida encontrada.');
        DATA_T = parsed;
        // rebuildar datalist de insumos após upload novo
        try { INSUMOS_OPTIONS = buildInsumosList(); buildDatalist(); } catch(e) { reportNonFatalError('Excel/reconstruir lista de insumos', e); }
        // fallback pra coluna Gestão vazia (virada de mês)
        aplicarFallbackGestaoDoHistorico();
        linhas = DATA_T.length;
      } else if (step.parser === 'flows') {
        const parsed = parseFlowsValor(csv);
        if (!parsed.length) throw new Error('FLOWS: nenhum aditivo válido encontrado.');
        DATA_F = parsed;
        applyManuals();
        loadClassifications();
        linhas = DATA_F.length;
      } else if (step.parser === 'gestoes') {
        const parsed = parseGestoes(csv);
        // v0.57.1 FIX: só sobrescrever se realmente veio conteúdo (evita zerar HISTORICO com CSV/aba vazia)
        if (parsed && parsed.items && parsed.items.length > 0) {
          HISTORICO = parsed;
          // sobrescreve GESTAO_LABEL com última gestão cronológica
          atualizarGestaoLabelPelaHistoria();
          // se coluna Gestão da Tendência estiver vazia, usa HISTORICO como fallback
          aplicarFallbackGestaoDoHistorico();
        } else {
          console.warn('[GESTÕES] arquivo/aba veio vazio — mantendo dados anteriores');
          throw new Error('Aba Gestões não retornou linhas válidas. Filtro esperado: empreendimento=Jardins Zurique, classificação financeira=Obra, chave contendo -21O-. Verifique se está no formato correto.');
        }
        linhas = parsed.items ? parsed.items.length : 0;
      }
      results[step.kind] = { ok: true, linhas };
    } catch (e) {
      results[step.kind] = { error: e.message };
      continue;
    }

  }

  const parseErrors = Object.entries(results).filter(([, value]) => value.error);
  if (parseErrors.length) {
    restoreInMemoryUploadState(memorySnapshot);
    const summary = parseErrors.map(([kind, value]) => `${kind}: ${value.error}`).join(' · ');
    setUploadRuntimeState(selectedKinds, 'failed', summary);
    _renderExcelProgress(null);
    renderUploadsCentral();
    authToast(`❌ Planilha rejeitada: ${parseErrors.length} aba(s) com erro. Nenhum dado foi alterado.`, 'err', 7000);
    parseErrors.forEach(([kind, value]) => {
      console.error(`[Excel] ${kind}:`, value.error);
      authToast(`❌ ${kind}: ${value.error}`, 'err', 7000);
    });
    return;
  }

  const processedItems = Object.entries(results)
    .filter(([, value]) => value.ok)
    .map(([kind, value]) => ({ kind, linhas: value.linhas }));
  if (!processedItems.length) {
    restoreInMemoryUploadState(memorySnapshot);
    setUploadRuntimeState(selectedKinds, 'failed', 'Nenhuma aba foi selecionada para processamento');
    _renderExcelProgress(null);
    authToast('❌ Nenhuma aba válida foi processada.', 'err', 5000);
    return;
  }

  try {
    _renderExcelProgress('📤 Sincronizando arquivo, dados e histórico...');
    await commitPreparedUpload({
      file,
      storageType: 'excel',
      items: processedItems,
      groupId,
      memorySnapshot,
    });
  } catch (error) {
    restoreInMemoryUploadState(memorySnapshot);
    setUploadRuntimeState(selectedKinds, 'failed', error.message || String(error));
    _renderExcelProgress(null);
    renderUploadsCentral();
    authToast('❌ Upload da planilha não concluído: ' + error.message, 'err', 8000);
    return;
  }

  await Promise.all(processedItems.map(item => runAsyncSafely(
    supaEnforceRollingBackup(item.kind),
    `Excel/limpeza de backups/${item.kind}`,
    `A planilha foi concluída, mas os backups antigos de ${item.kind} não puderam ser limpos.`
  )));

  // 2) Re-render apenas depois do commit completo.
  debouncedRender();
  renderUploadsCentral();
  renderSourcesHeaders();
  updateEditCount();
  _renderExcelProgress(null);

  // 3) Toast de resumo
  const ok = Object.entries(results).filter(([k, v]) => v.ok);
  const skipped = Object.entries(results).filter(([k, v]) => v.skipped);
  const parts = [];
  if (ok.length) parts.push(`✅ ${ok.length} aba(s) processada(s)`);
  if (skipped.length) parts.push(`⏭️ ${skipped.length} pulada(s)`);
  authToast('📊 ' + parts.join(' · ') + ' · 📦 sincronizado', 'ok', 5000);
}

// Renderiza mensagem de progresso dentro do card Excel
function _renderExcelProgress(msg) {
  const card = document.querySelector('.upload-excel-card .upload-progress');
  if (!card) return;
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  card.setAttribute('aria-atomic', 'true');
  if (!msg) { card.replaceChildren(); card.style.display = 'none'; card.setAttribute('aria-hidden', 'true'); return; }
  card.setAttribute('aria-hidden', 'false');
  card.style.display = 'block';
  const step = document.createElement('div');
  step.className = 'prog-step';
  step.textContent = String(msg);
  card.replaceChildren(step);
}

// UUID v4 (não precisa de biblioteca)
function _uuid4() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Toggle do "modo avançado" (uploads individuais CSV)
function toggleAdvancedUploads() {
  const body = document.getElementById('uploadsAdvancedBody');
  const toggle = document.getElementById('uploadsAdvancedToggle');
  if (!body || !toggle) return;
  const open = body.classList.toggle('open');
  toggle.innerHTML = (open ? '▼' : '▶') + ' <strong>Modo avançado</strong> — enviar cada CSV individualmente (uso legado)';
}

const UPLOAD_META = {
  tendencia: {
    label: 'TENDÊNCIA',
    icon: '📈',
    color: 'var(--fgr-red-vivid)',
    desc: 'Alimenta: KPIs da Visão Geral, tabela de Detalhamento, curva S de Tendência de Obra e Controle de Projeção. Fonte: aba TENDÊNCIA da planilha.',
    manualKey: 'tendencia',
  },
  flows: {
    label: 'FLOWS / ADITIVOS',
    icon: '🔗',
    color: 'var(--text-medium)',
    desc: 'Alimenta: aba Flows/Aditivos, decomposição do desvio na Visão Geral e Controle de Projeção. Fonte: aba FlowsValor da planilha.',
    manualKey: 'flows',
    global: true,
  },
  gestoes: {
    label: 'GESTÕES 🌐',
    icon: '📅',
    color: 'var(--text-medium)',
    desc: 'Alimenta: Histórico Mensal e curva S da Tendência de Obra. Fonte: aba Gestões da planilha. ⚠️ ARQUIVO COMPARTILHADO: 1 upload afeta TODAS as obras (v0.58b).',
    manualKey: 'gestoes',
    global: true,
  },
};

function fmtUploadDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' })
       + ' às ' + d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
}
function fmtUploadDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' })
       + ' ' + d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
}
function fmtBytes(b) {
  if (b == null) return '';
  if (b < 1024) return b + ' B';
  if (b < 1024*1024) return (b/1024).toFixed(0) + ' KB';
  return (b/(1024*1024)).toFixed(1) + ' MB';
}

function renderUploadRuntimeBlock(kinds) {
  const states = (Array.isArray(kinds) ? kinds : [kinds])
    .map(kind => UPLOAD_RUNTIME_STATE[kind])
    .filter(Boolean);
  const processing = states.find(state => state.status === 'processing');
  if (processing) {
    return `<div role="status" class="upload-card-meta" style="background:var(--sem-alerta-bg); color:var(--sem-alerta);">⏳ ${escHtml(processing.message || 'Upload em processamento...')}</div>`;
  }
  const failed = states.find(state => state.status === 'failed');
  if (failed) {
    return `<div role="alert" class="upload-card-meta" style="background:var(--fgr-red-light); color:var(--sem-erro);">❌ Última tentativa não foi aplicada: ${escHtml(failed.message || 'falha desconhecida')}</div>`;
  }
  return '';
}

function renderUploadsCentral() {
  const root = document.getElementById('uploadsCentral');
  if (!root) return;
  const kinds = ['tendencia', 'flows', 'gestoes'];

  // ============================================================
  // Bloco Excel destacado no topo
  // ============================================================
  // "Última planilha Excel" = pegar o registro mais recente com upload_group_id
  // que existe em pelo menos um dos LAST_UPLOADS.
  const groupCandidates = kinds.map(k => LAST_UPLOADS[k]).filter(u => u && u.upload_group_id);
  const excelRuntimeBlock = renderUploadRuntimeBlock(kinds);
  const excelProcessing = kinds.some(kind => UPLOAD_RUNTIME_STATE[kind]?.status === 'processing');
  let lastExcel = null;
  if (groupCandidates.length) {
    // Ordenar por data e pegar o mais recente
    groupCandidates.sort((a, b) => new Date(b.enviado_em) - new Date(a.enviado_em));
    const gid = groupCandidates[0].upload_group_id;
    const relatedKinds = kinds.filter(k => LAST_UPLOADS[k] && LAST_UPLOADS[k].upload_group_id === gid);
    lastExcel = {
      ...groupCandidates[0],
      relatedKinds,
    };
  }

  const excelMeta = lastExcel ? `
    <div class="upload-card-meta filled">
      📁 <strong>${escHtml(lastExcel.nome_arquivo)}</strong>${lastExcel.tamanho_bytes ? ' <span style="color:var(--text-soft);">('+fmtBytes(lastExcel.tamanho_bytes)+')</span>' : ''}<br>
      📅 Enviado ${lastExcel.enviado_por ? 'por <code>'+escHtml(lastExcel.enviado_por)+'</code> ' : ''}em ${escHtml(fmtUploadDate(lastExcel.enviado_em))}<br>
      📊 Abas processadas: ${lastExcel.relatedKinds.map(k => `${UPLOAD_META[k].icon} ${UPLOAD_META[k].label.split(' ')[0]}`).join(' · ')}
    </div>` : `
    <div class="upload-card-meta empty">📭 Nenhuma planilha Excel enviada ainda. Você pode enviar 1 arquivo <code>.xlsx</code>/<code>.xlsm</code> com as 3 abas ou usar o modo avançado abaixo.</div>`;

  const excelCard = `
    <div class="upload-excel-card" id="excelUploadCard">
      <h3>📊 Upload Completo (Excel) <span style="font-size:11px; color:#059669; font-weight:600; margin-left:4px;">RECOMENDADO</span></h3>
      <p class="subtitle">Envie a planilha inteira (<code>.xlsx</code> ou <code>.xlsm</code>) e o dashboard extrai automaticamente as abas <strong>Tendência</strong>, <strong>FlowsValor</strong> e <strong>Gestões</strong>.</p>
      ${excelRuntimeBlock}
      ${excelMeta}
      <div class="upload-progress" role="status" aria-live="polite" aria-atomic="true" aria-hidden="true" style="display:none;"></div>
      <div class="upload-card-actions">
        <button class="btn-sm primary" data-editor-only data-admin-control ${isAdminGeral() && !excelProcessing ? '' : 'disabled'} data-click-action="" data-file-target="fileInput_excel">
          📊 ${lastExcel ? 'Substituir planilha' : 'Escolher planilha Excel'}
        </button>
        <button class="btn-sm" data-click-action="openUploadsHistory" data-action-mode="arg" data-action-arg="tendencia" title="Ver todos os uploads">📜 Histórico</button>
        <input type="file" id="fileInput_excel" accept=".xlsx,.xlsm,.xls" aria-label="Selecionar planilha Excel" style="display:none" data-change-action="handleExcelUpload" data-action-mode="event">
      </div>
    </div>`;

  // ============================================================
  // Accordion "modo avançado" — uploads individuais CSV
  // ============================================================
  const csvCardsHtml = kinds.map(k => {
    const meta = UPLOAD_META[k];
    const last = LAST_UPLOADS[k];
    const runtimeBlock = renderUploadRuntimeBlock(k);
    const isProcessing = UPLOAD_RUNTIME_STATE[k]?.status === 'processing';
    const permissionAttr = meta.global
      ? `data-admin-control ${isAdminGeral() ? '' : 'disabled'}`
      : `data-edit-control ${isEditorDaObraAtiva() ? '' : 'disabled'}`;
    let metaBlock;
    if (last) {
      const detalhes = [
        last.tamanho_bytes ? fmtBytes(last.tamanho_bytes) : null,
        last.linhas ? (last.linhas + ' linhas') : null,
      ].filter(Boolean).join(' · ');
      const sourceTag = last.upload_group_id
        ? ' <span style="font-size:10px; color:#059669; background:#d1fae5; padding:1px 6px; border-radius:8px; margin-left:4px;">via Excel</span>'
        : '';
      metaBlock = `
        <div class="upload-card-meta filled">
          📁 <strong>${escHtml(last.nome_arquivo)}</strong>${sourceTag}${detalhes ? ' <span style="color:var(--text-soft);">('+detalhes+')</span>' : ''}<br>
          📅 Enviado ${last.enviado_por ? 'por <code>'+escHtml(last.enviado_por)+'</code> ' : ''}em ${escHtml(fmtUploadDate(last.enviado_em))}
        </div>`;
    } else {
      metaBlock = `<div class="upload-card-meta empty">📭 Nenhum arquivo carregado ainda.</div>`;
    }
    return `
      <div class="upload-card" data-kind="${k}" style="border-top: 3px solid ${meta.color};">
        <div class="upload-card-header">
          <div>
            <h3 class="upload-card-title">${meta.icon} ${meta.label}</h3>
            <p class="upload-card-sub">${escHtml(meta.desc)}</p>
          </div>
        </div>
        ${runtimeBlock}
        ${metaBlock}
        <div class="upload-card-actions">
          <button class="btn-sm primary" data-editor-only ${permissionAttr} ${isProcessing ? 'disabled' : ''} data-click-action="" data-file-target="fileInput_${k}">
            📤 ${last ? 'Substituir arquivo' : 'Escolher arquivo'}
          </button>
          <button class="btn-sm" data-click-action="openUploadsHistory" data-action-mode="arg" data-action-arg="${k}" title="Ver arquivos enviados anteriormente (últimos ${UPLOADS_MAX_PER_TYPE})">📜 Histórico</button>
          <button class="btn-sm" data-click-action="showManualText" data-action-mode="arg" data-action-arg="${meta.manualKey}">ℹ️ Como exportar?</button>
          <input type="file" id="fileInput_${k}" accept=".csv" aria-label="Selecionar arquivo CSV de ${escAttr(meta.label)}" style="display:none" data-change-action="handleUpload" data-action-mode="event-arg" data-action-arg="${k}">
        </div>
      </div>`;
  }).join('');

  root.innerHTML = `
    ${excelCard}
    <div id="uploadsAdvancedToggle" class="uploads-advanced-toggle" data-click-action="toggleAdvancedUploads">
      ▶ <strong>Modo avançado</strong> — enviar cada CSV individualmente (uso legado)
    </div>
    <div id="uploadsAdvancedBody" class="uploads-advanced-body">
      ${csvCardsHtml}
    </div>
  `;

  // Drag-and-drop no card Excel
  const excelCardEl = document.getElementById('excelUploadCard');
  if (excelCardEl) {
    excelCardEl.addEventListener('dragover', e => { e.preventDefault(); excelCardEl.classList.add('dragover'); });
    excelCardEl.addEventListener('dragleave', e => { e.preventDefault(); excelCardEl.classList.remove('dragover'); });
    excelCardEl.addEventListener('drop', e => {
      e.preventDefault();
      excelCardEl.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const fakeEvt = { target: { files: [file], value: '' }};
      handleExcelUpload(fakeEvt);
    });
  }

  // Drag-and-drop nos cards CSV individuais
  root.querySelectorAll('.upload-card').forEach(card => {
    const kind = card.dataset.kind;
    card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('dragover'); });
    card.addEventListener('dragleave', e => { e.preventDefault(); card.classList.remove('dragover'); });
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const fakeEvt = { target: { files: [file], value: '' }};
      handleUpload(fakeEvt, kind);
    });
  });
}

// modal com histórico completo de uploads de um tipo
async function openUploadsHistory(kind) {
  const meta = UPLOAD_META[kind];
  if (!meta) return;
  const modalContent = document.getElementById('modalContent');
  if (!modalContent) return;
  modalContent.innerHTML = `
    <h2>📜 Histórico de uploads — ${meta.icon} ${meta.label}</h2>
    <div class="meta">Mantemos os últimos <strong>${UPLOADS_MAX_PER_TYPE}</strong> arquivos por tipo (mais antigos são descartados automaticamente).</div>
    <div id="uploadsHistoryList" style="margin-top:14px;">⏳ Carregando...</div>
  `;
  openModal();
  await _renderUploadsHistoryList(kind);
}

// extraído em função separada pra poder re-renderizar após ações (ativar/excluir)
async function _renderUploadsHistoryList(kind) {
  const meta = UPLOAD_META[kind];
  const list = await supaListUploadsByType(kind, UPLOADS_MAX_PER_TYPE + 5);
  const box = document.getElementById('uploadsHistoryList');
  if (!box) return;
  if (!list.length) {
    box.innerHTML = '<div style="text-align:center; color:var(--text-lighter); padding:30px;">Nenhum upload registrado ainda.</div>';
    return;
  }
  const isEditor = isEditorDaObraAtiva();
  const isGlobal = meta.global === true; // Gestões é compartilhado entre obras
  const canManage = isGlobal ? isAdminGeral() : isEditor;
  box.innerHTML = `
    <table style="width:100%; font-size:12.5px; border-collapse:collapse;">
      <thead>
        <tr style="background:var(--bg-page); text-align:left;">
          <th style="padding:8px; border-bottom:2px solid var(--border);">Data / Hora</th>
          <th style="padding:8px; border-bottom:2px solid var(--border);">Arquivo</th>
          <th style="padding:8px; border-bottom:2px solid var(--border);">Tamanho</th>
          <th style="padding:8px; border-bottom:2px solid var(--border);">Linhas</th>
          <th style="padding:8px; border-bottom:2px solid var(--border);">Enviado por</th>
          <th style="padding:8px; border-bottom:2px solid var(--border); text-align:right;">Ações</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(r => {
          const isAtivo = !!r.is_active;
          const cleanStoragePath = sanitizeStoragePath(r.storage_path);
          const safeObra = OBRA_ATIVA ? OBRA_ATIVA.replace(/[^\w.\-]/g, '_') : '';
          const hasValidStoragePath = !!cleanStoragePath && !!safeObra && cleanStoragePath.startsWith(safeObra + '/');
          const canDownload = hasValidStoragePath && AUTH && AUTH.user
            && (isGlobal ? isAdminGeral() : isEditor);
          const canReativar = canManage && !isAtivo && !!r.storage_path;
          const canExcluir = canManage && !isAtivo; // BLOQUEADO se ativo
          const btnDownload = canDownload
            ? `<button class="btn-sm" data-action="download-upload" data-path="${escAttr(cleanStoragePath)}" data-filename="${escAttr(r.nome_arquivo)}" title="Baixar arquivo" aria-label="Baixar ${escAttr(r.nome_arquivo)}">📥</button>`
            : (cleanStoragePath
                ? `<span style="color:var(--text-lighter); font-size:11px;" title="${hasValidStoragePath ? 'Faça login para baixar' : 'Arquivo indisponível para a obra ativa'}">🔒</span>`
                : `<span style="color:var(--text-lighter); font-size:11px;" title="Upload anterior à v0.53, arquivo não foi armazenado">—</span>`);
          const btnAtivar = canReativar && hasValidStoragePath
            ? `<button class="btn-sm primary" data-action="ativar-upload" data-id="${r.id}" data-kind="${escAttr(kind)}" title="Usar este arquivo como fonte de dados">⭐ Ativar</button>`
            : (isAtivo
                ? ''
                : `<span style="color:var(--text-lighter); font-size:11px;" title="Arquivo sem storage_path — não pode ser reativado">—</span>`);
          const btnExcluir = canExcluir
            ? `<button class="btn-sm danger" data-action="excluir-upload" data-id="${r.id}" data-kind="${escAttr(kind)}" title="Excluir arquivo" aria-label="Excluir ${escAttr(r.nome_arquivo)}" style="background:var(--fgr-red-light); border:1px solid #fca5a5; color:var(--sem-erro);">🗑️</button>`
            : (isAtivo && canManage
                ? `<span style="color:var(--text-lighter); font-size:11px;" title="Ative outro arquivo antes de excluir este">🔒</span>`
                : '');
          return `
            <tr style="border-bottom:1px solid #f1f5f9; ${isAtivo?'background:#f0fdf4;':''}">
              <td style="padding:8px;">${escHtml(fmtUploadDate(r.enviado_em))} ${isAtivo?'<span style="display:inline-block; margin-left:4px; padding:2px 8px; background:#059669; color:white; font-size:9px; font-weight:700; border-radius:10px; letter-spacing:0.3px;">📌 ATIVO</span>':''}</td>
              <td style="padding:8px; font-family:monospace; font-size:11.5px;">${escHtml(r.nome_arquivo)}</td>
              <td style="padding:8px; color:var(--text-soft);">${fmtBytes(r.tamanho_bytes)}</td>
              <td style="padding:8px; color:var(--text-soft);">${r.linhas != null ? r.linhas.toLocaleString('pt-BR') : '-'}</td>
              <td style="padding:8px; font-size:11.5px; color:#475569;">${r.enviado_por ? escHtml(r.enviado_por) : '<em>anônimo</em>'}</td>
              <td style="padding:8px; text-align:right; white-space:nowrap;">
                <span style="display:inline-flex; gap:4px; align-items:center;">${btnDownload} ${btnAtivar} ${btnExcluir}</span>
              </td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>
    <div style="margin-top:12px; padding:10px 14px; background:var(--bg-page); border-radius:4px; font-size:11.5px; color:var(--text-soft); line-height:1.5;">
      💡 <strong>Ativar:</strong> marca esse arquivo como fonte de dados do dashboard (substitui o atual sem apagar).<br>
      🗑️ <strong>Excluir:</strong> apaga permanentemente do banco e Storage. Só permitido em arquivos não-ativos.<br>
      📌 <strong>Ativo:</strong> arquivo cujos dados estão sendo usados no dashboard agora.<br>
      🔄 <strong>Rolling backup:</strong> mantém apenas os últimos ${UPLOADS_MAX_PER_TYPE} arquivos. Ativo nunca é descartado automaticamente.
      ${isGlobal ? '<br>🌐 <strong>Gestões é compartilhado:</strong> trocar o ativo afeta TODAS as obras.' : ''}
    </div>
  `;
  // Event delegation para botões do histórico de uploads (renderizado dinamicamente)
  const uploadsBox = document.getElementById('uploadsHistoryList');
  if (uploadsBox && !uploadsBox._delegationSet) {
    uploadsBox._delegationSet = true;
    uploadsBox.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'download-upload') downloadUploadFile(btn.dataset.path, btn.dataset.filename);
      else if (action === 'ativar-upload') marcarUploadComoAtivo(parseInt(btn.dataset.id, 10), btn.dataset.kind);
      else if (action === 'excluir-upload') excluirUpload(parseInt(btn.dataset.id, 10), btn.dataset.kind);
    });
  }
}

async function downloadUploadFile(storagePath, filename) {
  if (!AUTH || !AUTH.user) {
    authToast('🔑 Faça login para baixar arquivos', 'warn', 3500);
    return;
  }
  const cleanPath = sanitizeStoragePath(storagePath);
  if (!cleanPath) {
    authToast('❌ Arquivo indisponível no histórico', 'err', 4000);
    return;
  }
  authToast('⏳ Gerando link de download...', 'info', 2000);
  const url = await supaGetDownloadURL(cleanPath);
  if (!url) {
    authToast('❌ Arquivo indisponível ou fora da obra ativa', 'err', 4500);
    return;
  }
  // Trigger download
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download.csv';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ============================================================
// v0.60 — Controle manual de arquivo ativo
// ============================================================

// Marca um upload específico como ativo (desativa os anteriores do mesmo obra+tipo)
// Depois: baixa o arquivo do Storage, re-parseia e substitui os dados no Supabase.
async function marcarUploadComoAtivo(uploadId, kind) {
  if (!requireUploadPermission(kind, 'trocar este arquivo ativo')) return;
  const meta = UPLOAD_META[kind];
  const isGlobal = meta && meta.global === true;
  // Aviso especial pra Gestões (global)
  if (isGlobal) {
    const confirmed = await confirmModal(
      'Ativar arquivo global de Gestões',
      'Trocar o arquivo ativo atualizará o Histórico Mensal e a Curva S de TODAS as obras.',
      { confirmText: 'Ativar arquivo', destructive: false }
    );
    if (!confirmed) return;
  } else {
    const confirmed = await confirmModal(
      'Trocar arquivo ativo',
      `Trocar o arquivo ativo de ${meta ? meta.label : kind} para esta versão?\n\nO dashboard substituirá os dados atuais pelos deste arquivo.`,
      { confirmText: 'Ativar arquivo', destructive: false }
    );
    if (!confirmed) return;
  }
  authToast('⏳ Ativando arquivo...', 'info', 2500);
  const memorySnapshot = captureInMemoryUploadState();
  let dashboardSnapshot = null;
  let dashboardPersisted = false;
  let activation = null;
  let alvo = null;
  setUploadRuntimeState(kind, 'processing', 'Validando e ativando arquivo do histórico');
  try {
    // 1) Buscar o registro alvo
    const { data: targetRecord, error: readErr } = await SUPA.from('upload_history')
      .select('*').eq('id', uploadId).maybeSingle();
    alvo = targetRecord;
    if (readErr || !alvo) throw new Error('Arquivo não encontrado no banco');
    if (alvo.codigo_obra !== OBRA_ATIVA) throw new Error('Arquivo fora do escopo da obra ativa');
    if (!alvo.storage_path) throw new Error('Arquivo não tem cópia no Storage (upload muito antigo). Impossível reativar.');
    // 2) Baixar o arquivo do Storage
    const url = await supaGetDownloadURL(alvo.storage_path);
    if (!url) throw new Error('Falha ao gerar link de download do arquivo');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Falha ao baixar arquivo: HTTP ' + resp.status);
    const isExcel = /\.xlsx?$|\.xlsm$/i.test(alvo.nome_arquivo);
    // 3) Re-parseia
    if (isExcel) {
      const buf = await resp.arrayBuffer();
      const wb = await readExcelBuffer(buf);
      const sheetNames = wb.sheetNames || [];
      const mapping = _autoDetectSheets(sheetNames);
      // Só processa a aba correspondente ao tipo
      const sheetName = mapping[kind];
      if (!sheetName) throw new Error(`Aba correspondente a "${kind}" não encontrada no Excel`);
      const csv = _sheetToCSV(wb, sheetName);
      _parsearECarregar(kind, csv);
    } else {
      // CSV direto
      const csv = await resp.text();
      _parsearECarregar(kind, csv);
    }
    // 4) Persistir antes de ativar; ambos possuem compensação em caso de falha.
    dashboardSnapshot = await supaCaptureDashboardRows([kind]);
    await supaSaveAllData([kind]);
    dashboardPersisted = true;
    activation = await supaActivateUploadRecord(alvo);
  } catch (e) {
    console.error('[v0.60] marcarUploadComoAtivo:', e);
    const cleanupErrors = [];
    if (activation) {
      try { await supaRollbackUploadActivation(activation); }
      catch (cleanupError) { cleanupErrors.push('arquivo ativo: ' + cleanupError.message); }
    }
    if (dashboardPersisted) {
      try { await supaRestoreDashboardRows(dashboardSnapshot); }
      catch (cleanupError) { cleanupErrors.push('dados anteriores: ' + cleanupError.message); }
    }
    restoreInMemoryUploadState(memorySnapshot);
    setUploadRuntimeState(kind, 'failed', e.message || String(e));
    renderUploadsCentral();
    authToast('❌ Erro ao ativar: ' + e.message, 'err', 5000);
    if (cleanupErrors.length) {
      authToast('⚠️ A recuperação ficou parcial: ' + cleanupErrors.join('; '), 'warn', 8000);
    }
    return;
  }

  LAST_UPLOADS[kind] = activation.active;
  setUploadRuntimeState(kind, 'active');
  debouncedRender();
  renderUploadsCentral();
  renderSourcesHeaders();
  await _renderUploadsHistoryList(kind);
  authToast(`✅ Arquivo ativado: ${alvo.nome_arquivo}`, 'ok', 3500);
}

// Helper interno: parseia CSV do tipo correspondente e atualiza estruturas em memória
function _parsearECarregar(kind, csv) {
  const firstLines = csv.split(/\r?\n/).slice(0,3).join(' ');
  const fu = firstLines.toUpperCase();
  if (kind === 'tendencia') {
    if (!fu.includes('LICITAÇÃO') || !fu.includes('IPCA') || !fu.includes('INCC') || !fu.includes('EVOLUÇÃO')) {
      throw new Error('CSV Tendência em formato inesperado');
    }
    const parsed = parseTendencia(csv);
    if (!parsed.length) throw new Error('CSV Tendência não retornou linhas válidas');
    DATA_T = parsed;
    // rebuildar datalist de insumos após upload novo
    try { INSUMOS_OPTIONS = buildInsumosList(); buildDatalist(); } catch(e) { reportNonFatalError('Histórico/reconstruir lista de insumos', e); }
        // fallback pra coluna Gestão vazia (virada de mês)
        aplicarFallbackGestaoDoHistorico();
  } else if (kind === 'flows') {
    if (!firstLines.includes('Cod_aditivo') && !firstLines.includes('INSUMO PLANEJAMENTO') && !firstLines.includes('CONTROLE DE ALTERAÇÕES')) {
      throw new Error('CSV Flows em formato inesperado');
    }
    const parsed = parseFlowsValor(csv);
    if (!parsed.length) throw new Error('CSV Flows não retornou aditivos válidos');
    DATA_F = parsed;
    applyManuals();
    loadClassifications();
  } else if (kind === 'gestoes') {
    if (!firstLines.includes('Descr_gestao') && !firstLines.includes('Key_planejamento')) {
      throw new Error('CSV Gestões em formato inesperado');
    }
    const parsed = parseGestoes(csv);
    if (parsed && parsed.items && parsed.items.length > 0) {
      HISTORICO = parsed;
      atualizarGestaoLabelPelaHistoria();
    } else {
      throw new Error('CSV Gestões não retornou linhas válidas');
    }
  }
}

// Exclui um upload específico (bloqueado se for o ativo — check no HTML)
async function excluirUpload(uploadId, kind) {
  if (!requireUploadPermission(kind, 'excluir este arquivo')) return;
  try {
    // Buscar pra confirmar que não é o ativo
    const { data: rec, error: readErr } = await SUPA.from('upload_history')
      .select('id, nome_arquivo, storage_path, is_active, codigo_obra')
      .eq('id', uploadId).maybeSingle();
    if (readErr || !rec) throw new Error('Arquivo não encontrado');
    if (rec.codigo_obra !== OBRA_ATIVA) throw new Error('Arquivo fora do escopo da obra ativa');
    if (rec.is_active) {
      authToast('🔒 Não é possível excluir o arquivo ativo. Ative outro primeiro.', 'warn', 4500);
      return;
    }
    const confirmed = await confirmModal(
      'Excluir arquivo do histórico',
      `Excluir permanentemente o arquivo "${rec.nome_arquivo}"?\n\nOs dados do dashboard não serão afetados; somente este arquivo e seu registro serão removidos.`,
      { confirmText: 'Excluir arquivo' }
    );
    if (!confirmed) return;
    authToast('🗑️ Excluindo...', 'info', 2000);
    // Verifica antes se o arquivo é compartilhado por outros registros do Excel.
    const cleanStoragePath = sanitizeStoragePath(rec.storage_path);
    let removeStoredFile = false;
    if (cleanStoragePath) {
      const { data: otherReferences, error: referenceError } = await SUPA.from('upload_history')
        .select('id')
        .eq('codigo_obra', OBRA_ATIVA)
        .eq('storage_path', cleanStoragePath)
        .neq('id', uploadId)
        .limit(1);
      if (referenceError) throw referenceError;
      removeStoredFile = !otherReferences?.length;
    }
    // Remove primeiro o metadata para nunca deixar o histórico apontando para arquivo ausente.
    const { error: dbErr } = await SUPA.from('upload_history').delete()
      .eq('codigo_obra', OBRA_ATIVA).eq('id', uploadId);
    if (dbErr) throw dbErr;
    if (removeStoredFile) {
      const { error: sErr } = await SUPA.storage.from(UPLOADS_BUCKET).remove([cleanStoragePath]);
      if (sErr) {
        reportNonFatalError('Uploads/remover arquivo sem referências', sErr, 'O registro foi excluído, mas o arquivo órfão não pôde ser removido do Storage.');
      }
    }
    // Re-render do modal
    await _renderUploadsHistoryList(kind);
    authToast(`✅ Arquivo excluído`, 'ok', 3000);
  } catch (e) {
    console.error('[v0.60] excluirUpload:', e);
    authToast('❌ Erro ao excluir: ' + e.message, 'err', 5000);
  }
}

function renderSourcesHeaders() {
  document.querySelectorAll('.sources-header').forEach(el => {
    const kinds = (el.dataset.sources || '').split(',').map(k => k.trim()).filter(Boolean);
    const parts = kinds.map(k => {
      const meta = UPLOAD_META[k];
      const last = LAST_UPLOADS[k];
      if (!last) {
        return `<span class="src-item src-empty" title="Nenhum arquivo enviado ainda para ${meta ? meta.label : k}">${meta ? meta.icon : ''} ${meta ? meta.label : k}: (sem dados)</span>`;
      }
      const tip = `${last.nome_arquivo} · ${fmtUploadDate(last.enviado_em)}${last.enviado_por ? ' · '+last.enviado_por : ''}`;
      return `<span class="src-item" title="${escAttr(tip)}"><strong>${meta.icon} ${meta.label}:</strong> <code>${escHtml(last.nome_arquivo)}</code> <span style="color:var(--text-soft);">(${escHtml(fmtUploadDateShort(last.enviado_em))})</span></span>`;
    });
    el.innerHTML = '📎 ' + parts.join(' <span class="src-sep">·</span> ');
  });
}

// Parsers de Tendência, Flows e Gestões são instalados por assets/js/parsers/index.mjs.

// ============ TENDÊNCIA DE OBRA (PROJEÇÃO) ============

// PROJ_RAW declarado na seção ESTADO GLOBAL acima

// Definir mês corrente (default)
function defaultDataCorte() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function defaultDataFim() {
  // último mês do CSV
  // v0.58b: usa dados da obra ativa
  const _p = (typeof getProjRawObraAtiva === 'function') ? getProjRawObraAtiva() : PROJ_RAW;
  if (!_p.length) return defaultDataCorte();
  return _p.map(r => r.mes).sort().slice(-1)[0];
}

// Metadados de serviço (descrição + grupo) — pré-carregado da Tendência
const HIERARQUIA = [{"ordem": 0, "cod": "1", "cod_servico": "", "cod_insumo": "", "item": "PLANEJAMENTO OBRA", "nivel": 1, "tipo": "raiz"}, {"ordem": 1, "cod": "01.01", "cod_servico": "", "cod_insumo": "", "item": "CUSTOS INDIRETOS", "nivel": 2, "tipo": "grupo"}, {"ordem": 2, "cod": "01.01.01", "cod_servico": "", "cod_insumo": "", "item": "MÃO DE OBRA", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 3, "cod": "01.01.01.02", "cod_servico": "S05765", "cod_insumo": "", "item": "MÃO DE OBRA - RATEIO DIFERENCIADO", "nivel": 4, "tipo": "servico"}, {"ordem": 4, "cod": "01.01.01.02", "cod_servico": "S05765", "cod_insumo": "ADM5189", "item": "ASSESSORIA E CONSULTORIA GERENCIAL - OBRA", "nivel": 4, "tipo": "insumo"}, {"ordem": 5, "cod": "01.01.01.02", "cod_servico": "S05765", "cod_insumo": "CONDH271", "item": "MAO DE OBRA - RATEIO DIFERENCIADO - OBRA", "nivel": 4, "tipo": "insumo"}, {"ordem": 6, "cod": "01.01.01.02", "cod_servico": "S05765", "cod_insumo": "I002226", "item": "PLR (PARTICIPACAO DE LUCROS E RESULTADOS)", "nivel": 4, "tipo": "insumo"}, {"ordem": 7, "cod": "01.01.02", "cod_servico": "", "cod_insumo": "", "item": "CANTEIRO, MAQUINAS E EQUIPAMENTOS", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 8, "cod": "01.01.02", "cod_servico": "S05751", "cod_insumo": "", "item": "MOBILIZAÇÃO / ALUGUEL CONTAINER", "nivel": 3, "tipo": "servico"}, {"ordem": 9, "cod": "01.01.02", "cod_servico": "S05751", "cod_insumo": "I013329", "item": "MOBILIZAÇÃO / ALUGUEL DE CONTAINER", "nivel": 3, "tipo": "insumo"}, {"ordem": 10, "cod": "01.01.02.02", "cod_servico": "", "cod_insumo": "", "item": "CONFECÇÃO DO CANTEIRO DE OBRAS", "nivel": 4, "tipo": "outro"}, {"ordem": 11, "cod": "01.01.02.02", "cod_servico": "S02544", "cod_insumo": "", "item": "CONFECÇÃO DO CANTEIRO DE OBRAS", "nivel": 4, "tipo": "servico"}, {"ordem": 12, "cod": "01.01.02.02", "cod_servico": "S02544", "cod_insumo": "I001609", "item": "TAPUME METALICO", "nivel": 4, "tipo": "insumo"}, {"ordem": 13, "cod": "01.01.02.02", "cod_servico": "S02544", "cod_insumo": "I002242", "item": "LIMPEZA E CONSERVACAO", "nivel": 4, "tipo": "insumo"}, {"ordem": 14, "cod": "01.01.02.02", "cod_servico": "S02544", "cod_insumo": "I013233", "item": "CONFECÇÃO DE CANTEIROS", "nivel": 4, "tipo": "insumo"}, {"ordem": 15, "cod": "01.01.02.02", "cod_servico": "S02544", "cod_insumo": "I013234", "item": "CONSTRUÇÃO REFORMA E MANUTENÇÃO DE ESCRITÓRIO - OBRA", "nivel": 4, "tipo": "insumo"}, {"ordem": 16, "cod": "01.01.02.02", "cod_servico": "S02544", "cod_insumo": "I019735", "item": "MENSALIDADE DE ALOJAMENTO MODULAR", "nivel": 4, "tipo": "insumo"}, {"ordem": 17, "cod": "01.01.02.03", "cod_servico": "", "cod_insumo": "", "item": "FOSSA SEPTCA/BANHEIRO QUÍMICO", "nivel": 4, "tipo": "outro"}, {"ordem": 18, "cod": "01.01.02.03", "cod_servico": "S05753", "cod_insumo": "", "item": "FOSSA SEPTICA/BANHEIRO QUÍMICO", "nivel": 4, "tipo": "servico"}, {"ordem": 19, "cod": "01.01.02.03", "cod_servico": "S05753", "cod_insumo": "I013235", "item": "FOSSA SEPTICA / BANHEIRO QUIMICO", "nivel": 4, "tipo": "insumo"}, {"ordem": 20, "cod": "01.01.02.04", "cod_servico": "", "cod_insumo": "", "item": "PERFURAÇÃO DE POÇO ARTESIANO", "nivel": 4, "tipo": "outro"}, {"ordem": 21, "cod": "01.01.02.04", "cod_servico": "S04314", "cod_insumo": "", "item": "PERFURAÇÃO DE POÇO ARTESIANO", "nivel": 4, "tipo": "servico"}, {"ordem": 22, "cod": "01.01.02.04", "cod_servico": "S04314", "cod_insumo": "I009447", "item": "MATERIAL POÇO ARTESIANO", "nivel": 4, "tipo": "insumo"}, {"ordem": 23, "cod": "01.01.02.04", "cod_servico": "S04314", "cod_insumo": "I009888", "item": "EMPREITEIRO PERFURAÇÃO POÇO ARTESIANO", "nivel": 4, "tipo": "insumo"}, {"ordem": 24, "cod": "01.01.02.05", "cod_servico": "", "cod_insumo": "", "item": "SEGURANÇA DO CANTEIRO", "nivel": 4, "tipo": "outro"}, {"ordem": 25, "cod": "01.01.02.05", "cod_servico": "S05766", "cod_insumo": "", "item": "SEGURANÇA DO CANTEIRO", "nivel": 4, "tipo": "servico"}, {"ordem": 26, "cod": "01.01.02.05", "cod_servico": "S05766", "cod_insumo": "I004804", "item": "VIGIA / SEGURANÇA DE OBRA", "nivel": 4, "tipo": "insumo"}, {"ordem": 27, "cod": "01.01.03", "cod_servico": "", "cod_insumo": "", "item": "CUSTOS INDIRETOS DE OBRA", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 28, "cod": "01.01.03.01", "cod_servico": "", "cod_insumo": "", "item": "CONSUMOS INDIRETOS GERAIS", "nivel": 4, "tipo": "outro"}, {"ordem": 29, "cod": "01.01.03.01", "cod_servico": "S05745", "cod_insumo": "", "item": "CONSUMO DE TELEFONE, INTERNET, ÁGUA, ESGOTO e ENERGIA", "nivel": 4, "tipo": "servico"}, {"ordem": 30, "cod": "01.01.03.01", "cod_servico": "S05745", "cod_insumo": "I001266", "item": "EQUIPAMENTOS DE INFORMATICA", "nivel": 4, "tipo": "insumo"}, {"ordem": 31, "cod": "01.01.03.01", "cod_servico": "S05745", "cod_insumo": "I013236", "item": "TELEFONE / INTERNET / ENERGIA / AGUA - OBRA", "nivel": 4, "tipo": "insumo"}, {"ordem": 32, "cod": "01.01.03.01", "cod_servico": "S05745", "cod_insumo": "I013237", "item": "TECNOLOGIA DA INFORMAÇÃO", "nivel": 4, "tipo": "insumo"}, {"ordem": 33, "cod": "01.01.03.02", "cod_servico": "S02595", "cod_insumo": "", "item": "MÓVEIS E EQUIPAMENTOS DE OBRA", "nivel": 4, "tipo": "servico"}, {"ordem": 34, "cod": "01.01.03.02", "cod_servico": "S02595", "cod_insumo": "I003192", "item": "UNIFORMES", "nivel": 4, "tipo": "insumo"}, {"ordem": 35, "cod": "01.01.03.02", "cod_servico": "S02595", "cod_insumo": "I013238", "item": "FERRAMENTAS E EQUIPAMENTOS", "nivel": 4, "tipo": "insumo"}, {"ordem": 36, "cod": "01.01.03.02", "cod_servico": "S02595", "cod_insumo": "I013239", "item": "MATERIAL DE ESCRITÓRIO", "nivel": 4, "tipo": "insumo"}, {"ordem": 37, "cod": "01.01.03.02", "cod_servico": "S02595", "cod_insumo": "I013240", "item": "EQUIPAMENTO DE PROTECÃO INDIVIDUAL E COLETIVA", "nivel": 4, "tipo": "insumo"}, {"ordem": 38, "cod": "01.01.03.03", "cod_servico": "S01899", "cod_insumo": "", "item": "CAFÉ DA MANHA", "nivel": 4, "tipo": "servico"}, {"ordem": 39, "cod": "01.01.03.03", "cod_servico": "S01899", "cod_insumo": "I009448", "item": "CAFE DA MANHÃ", "nivel": 4, "tipo": "insumo"}, {"ordem": 40, "cod": "01.01.03.04", "cod_servico": "S00837", "cod_insumo": "", "item": "CONTROLE TECNOLÓGICO", "nivel": 4, "tipo": "servico"}, {"ordem": 41, "cod": "01.01.03.04", "cod_servico": "S00837", "cod_insumo": "I002272", "item": "CONTROLE TECNOLÓGICO DE CONCRETO", "nivel": 4, "tipo": "insumo"}, {"ordem": 42, "cod": "01.01.03.05", "cod_servico": "S05746", "cod_insumo": "", "item": "IMPLANTAÇÃO TOPOGRAFICA", "nivel": 4, "tipo": "servico"}, {"ordem": 43, "cod": "01.01.03.05", "cod_servico": "S05746", "cod_insumo": "I001713", "item": "MAPEAMENTO COM DRONE", "nivel": 4, "tipo": "insumo"}, {"ordem": 44, "cod": "01.01.03.05", "cod_servico": "S05746", "cod_insumo": "I013241", "item": "EQUIPE DE TOPOGRAFIA", "nivel": 4, "tipo": "insumo"}, {"ordem": 45, "cod": "01.01.03.06", "cod_servico": "S05747", "cod_insumo": "", "item": "SERVIÇO DE PORTARIA E VIGILÂNCIA", "nivel": 4, "tipo": "servico"}, {"ordem": 46, "cod": "01.01.03.06", "cod_servico": "S05747", "cod_insumo": "I013324", "item": "PORTARIA/VIGILÂNCIA - OBRA", "nivel": 4, "tipo": "insumo"}, {"ordem": 47, "cod": "01.01.03.07", "cod_servico": "S05748", "cod_insumo": "", "item": "ALUGUEL DE VEÍCULOS", "nivel": 4, "tipo": "servico"}, {"ordem": 48, "cod": "01.01.03.07", "cod_servico": "S05748", "cod_insumo": "I001275", "item": "COMBUSTIVEL", "nivel": 4, "tipo": "insumo"}, {"ordem": 49, "cod": "01.01.03.07", "cod_servico": "S05748", "cod_insumo": "I004807", "item": "ALUGUEL DE VEICULO DE PASSEIO", "nivel": 4, "tipo": "insumo"}, {"ordem": 50, "cod": "01.01.03.07", "cod_servico": "S05748", "cod_insumo": "I004808", "item": "CAMINHÃO PIPA - LOCAÇÃO", "nivel": 4, "tipo": "insumo"}, {"ordem": 51, "cod": "01.01.03.07", "cod_servico": "S05748", "cod_insumo": "I013424", "item": "DESPESAS COM TRANSPORTE – UBER", "nivel": 4, "tipo": "insumo"}, {"ordem": 52, "cod": "01.01.03.07", "cod_servico": "S05748", "cod_insumo": "I020929", "item": "LOCAÇÃO DE EQUIPAMENTO", "nivel": 4, "tipo": "insumo"}, {"ordem": 53, "cod": "01.01.22", "cod_servico": "S04257", "cod_insumo": "", "item": "CAIXA DE OBRA", "nivel": 3, "tipo": "servico"}, {"ordem": 54, "cod": "01.01.22", "cod_servico": "S04257", "cod_insumo": "I009752", "item": "CAIXA DE OBRAS", "nivel": 3, "tipo": "insumo"}, {"ordem": 55, "cod": "01.02", "cod_servico": "", "cod_insumo": "", "item": "CUSTO DIRETOS INFRAESTRUTURA", "nivel": 2, "tipo": "grupo"}, {"ordem": 56, "cod": "01.02.01", "cod_servico": "", "cod_insumo": "", "item": "SERVIÇOS PERIODICOS", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 57, "cod": "01.02.01.01", "cod_servico": "S05767", "cod_insumo": "", "item": "SERVIÇOS PERIÓDICOS", "nivel": 4, "tipo": "servico"}, {"ordem": 58, "cod": "01.02.01.01", "cod_servico": "S05767", "cod_insumo": "I006784", "item": "EXECUÇÃO DE LAUDO DE VIZINHANÇA", "nivel": 4, "tipo": "insumo"}, {"ordem": 59, "cod": "01.02.01.01", "cod_servico": "S05767", "cod_insumo": "I013242", "item": "COMPENSAÇÃO AMBIENTAL DA SUPRESSÃO", "nivel": 4, "tipo": "insumo"}, {"ordem": 60, "cod": "01.02.01.01", "cod_servico": "S05767", "cod_insumo": "I019429", "item": "MANUTENÇÃO DE ÁREAS PRÉ-OBRA", "nivel": 4, "tipo": "insumo"}, {"ordem": 61, "cod": "01.02.01.02", "cod_servico": "S05752", "cod_insumo": "", "item": "PRAD - PLANO DE RECUPERAÇÃO DE ÁREAS DEGRADADAS", "nivel": 4, "tipo": "servico"}, {"ordem": 62, "cod": "01.02.01.02", "cod_servico": "S05752", "cod_insumo": "I011126", "item": "MANUTENÇÃO DE PLANTIO", "nivel": 4, "tipo": "insumo"}, {"ordem": 63, "cod": "01.02.01.02", "cod_servico": "S05752", "cod_insumo": "I013243", "item": "REFLORESTAMENTO / FORNECIMENTO DE MUDAS", "nivel": 4, "tipo": "insumo"}, {"ordem": 64, "cod": "01.02.01.02", "cod_servico": "S05752", "cod_insumo": "I013244", "item": "CONSULTORIA AMBIENTAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 65, "cod": "01.02.01.03", "cod_servico": "S00893", "cod_insumo": "", "item": "PLANO DE GERENCIAMENTO DE RESÍDUOS", "nivel": 4, "tipo": "servico"}, {"ordem": 66, "cod": "01.02.01.03", "cod_servico": "S00893", "cod_insumo": "I002245", "item": "PLANO DE GERENCIAMENTO DE RESÍDUOS", "nivel": 4, "tipo": "insumo"}, {"ordem": 67, "cod": "01.02.02", "cod_servico": "", "cod_insumo": "", "item": "SUPRESSÃO VEGETAL", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 68, "cod": "01.02.02.01", "cod_servico": "S05749", "cod_insumo": "", "item": "SUPRESSÃO VEGETAL", "nivel": 4, "tipo": "servico"}, {"ordem": 69, "cod": "01.02.02.01", "cod_servico": "S05749", "cod_insumo": "I012012", "item": "EMPREITEIRO ROÇAGEM DE MANUTENÇÃO", "nivel": 4, "tipo": "insumo"}, {"ordem": 70, "cod": "01.02.02.01", "cod_servico": "S05749", "cod_insumo": "I013246", "item": "RETIRADA DE ENTULHOS / DEMOLIÇÕES", "nivel": 4, "tipo": "insumo"}, {"ordem": 71, "cod": "01.02.02.01", "cod_servico": "S05749", "cod_insumo": "I013247", "item": "ABERTURA DE RUAS", "nivel": 4, "tipo": "insumo"}, {"ordem": 72, "cod": "01.02.02.01", "cod_servico": "S05749", "cod_insumo": "I013248", "item": "SUPRESSAO VEGETAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 73, "cod": "01.02.03", "cod_servico": "", "cod_insumo": "", "item": "TERRAPLANAGEM", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 74, "cod": "01.02.03.01", "cod_servico": "S03369", "cod_insumo": "", "item": "CUSTOS INDIRETOS PARA SERVIÇO DE TERRAPLANAGEM", "nivel": 4, "tipo": "servico"}, {"ordem": 75, "cod": "01.02.03.01", "cod_servico": "S03369", "cod_insumo": "I013249", "item": "EMPREITEIRO DE TERRAPLANAGEM INTERNA", "nivel": 4, "tipo": "insumo"}, {"ordem": 76, "cod": "01.02.03.01", "cod_servico": "S03369", "cod_insumo": "I013250", "item": "EMPREITEIRO DE TERRAPLANAGEM PISTA DE ACESSO", "nivel": 4, "tipo": "insumo"}, {"ordem": 77, "cod": "01.02.04", "cod_servico": "", "cod_insumo": "", "item": "DRENAGEM", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 78, "cod": "01.02.04.01", "cod_servico": "S03368", "cod_insumo": "", "item": "CUSTOS INDIRETOS PARA SERVIÇO DE GALERIAIS SUPERFICIAIS", "nivel": 4, "tipo": "servico"}, {"ordem": 79, "cod": "01.02.04.01", "cod_servico": "S03368", "cod_insumo": "I008103", "item": "DRENAGEM - MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 80, "cod": "01.02.04.01", "cod_servico": "S03368", "cod_insumo": "I008127", "item": "EMPREITEIRO DRENAGEM", "nivel": 4, "tipo": "insumo"}, {"ordem": 81, "cod": "01.02.04.02", "cod_servico": "S03725", "cod_insumo": "", "item": "LANÇAMENTOS DRENAGEM", "nivel": 4, "tipo": "servico"}, {"ordem": 82, "cod": "01.02.04.02", "cod_servico": "S03725", "cod_insumo": "I008105", "item": "LANÇAMENTOS DRENAGEM - MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 83, "cod": "01.02.04.02", "cod_servico": "S03725", "cod_insumo": "I008129", "item": "EMPREITEIRO LANÇAMENTOS DRENAGEM", "nivel": 4, "tipo": "insumo"}, {"ordem": 84, "cod": "01.02.04.03", "cod_servico": "S03724", "cod_insumo": "", "item": "BOCA DE LOBO / CHAMINÉS", "nivel": 4, "tipo": "servico"}, {"ordem": 85, "cod": "01.02.04.03", "cod_servico": "S03724", "cod_insumo": "I008104", "item": "BOCA DE LOBO/CHAMINÉS - MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 86, "cod": "01.02.04.03", "cod_servico": "S03724", "cod_insumo": "I013328", "item": "EMPREITEIRO BOCA DE LOBO /CHAMINÉS", "nivel": 4, "tipo": "insumo"}, {"ordem": 87, "cod": "01.02.04.03", "cod_servico": "S03724", "cod_insumo": "I024034", "item": "GRELHA DE PAVIMENTO", "nivel": 4, "tipo": "insumo"}, {"ordem": 88, "cod": "01.02.05", "cod_servico": "", "cod_insumo": "", "item": "GALERIA DE ÁGUAS PLUVIAIS - EXTERNO", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 89, "cod": "01.02.05.01", "cod_servico": "S03368", "cod_insumo": "", "item": "CUSTOS INDIRETOS PARA SERVIÇO DE GALERIAIS SUPERFICIAIS", "nivel": 4, "tipo": "servico"}, {"ordem": 90, "cod": "01.02.05.01", "cod_servico": "S03368", "cod_insumo": "I008103", "item": "DRENAGEM - MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 91, "cod": "01.02.05.01", "cod_servico": "S03368", "cod_insumo": "I008127", "item": "EMPREITEIRO DRENAGEM", "nivel": 4, "tipo": "insumo"}, {"ordem": 92, "cod": "01.02.05.02", "cod_servico": "S03725", "cod_insumo": "", "item": "LANÇAMENTOS DRENAGEM", "nivel": 4, "tipo": "servico"}, {"ordem": 93, "cod": "01.02.05.02", "cod_servico": "S03725", "cod_insumo": "I008105", "item": "LANÇAMENTOS DRENAGEM - MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 94, "cod": "01.02.05.02", "cod_servico": "S03725", "cod_insumo": "I008129", "item": "EMPREITEIRO LANÇAMENTOS DRENAGEM", "nivel": 4, "tipo": "insumo"}, {"ordem": 95, "cod": "01.02.05.03", "cod_servico": "S03724", "cod_insumo": "", "item": "BOCA DE LOBO / CHAMINÉS", "nivel": 4, "tipo": "servico"}, {"ordem": 96, "cod": "01.02.05.03", "cod_servico": "S03724", "cod_insumo": "I008104", "item": "BOCA DE LOBO/CHAMINÉS - MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 97, "cod": "01.02.05.03", "cod_servico": "S03724", "cod_insumo": "I013328", "item": "EMPREITEIRO BOCA DE LOBO /CHAMINÉS", "nivel": 4, "tipo": "insumo"}, {"ordem": 98, "cod": "01.02.06", "cod_servico": "", "cod_insumo": "", "item": "REDE DE ESGOTO SANITARIO", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 99, "cod": "01.02.06.01", "cod_servico": "S05743", "cod_insumo": "", "item": "REDE DE ESGOTO", "nivel": 4, "tipo": "servico"}, {"ordem": 100, "cod": "01.02.06.01", "cod_servico": "S05743", "cod_insumo": "I013255", "item": "EMPREITEIRO DE REDE DE ESGOTO", "nivel": 4, "tipo": "insumo"}, {"ordem": 101, "cod": "01.02.06.01", "cod_servico": "S05743", "cod_insumo": "I013256", "item": "MATERIAIS DE REDE DE ESGOTO", "nivel": 4, "tipo": "insumo"}, {"ordem": 102, "cod": "01.02.06.01", "cod_servico": "S05743", "cod_insumo": "I013258", "item": "EMPREITEIRO ESTAÇÃO ELEVATÓRIA DE ESGOTO/TRATAMENTO DE ESGOTO", "nivel": 4, "tipo": "insumo"}, {"ordem": 103, "cod": "01.02.07", "cod_servico": "", "cod_insumo": "", "item": "REDE DE AGUA POTAVEL", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 104, "cod": "01.02.07.01", "cod_servico": "S03726", "cod_insumo": "", "item": "CUSTOS INDIRETOS PARA SERVIÇO DE REDE DE ÁGUA", "nivel": 4, "tipo": "servico"}, {"ordem": 105, "cod": "01.02.07.01", "cod_servico": "S03726", "cod_insumo": "I008131", "item": "EMPREITEIRO REDE DE ÁGUA", "nivel": 4, "tipo": "insumo"}, {"ordem": 106, "cod": "01.02.07.01", "cod_servico": "S03726", "cod_insumo": "I012679", "item": "EMPREITEIRO CENTRO DE RESERVAÇÃO", "nivel": 4, "tipo": "insumo"}, {"ordem": 107, "cod": "01.02.07.01", "cod_servico": "S03726", "cod_insumo": "I013261", "item": "MATERIAIS DE REDE DE ÁGUA", "nivel": 4, "tipo": "insumo"}, {"ordem": 108, "cod": "01.02.07.01", "cod_servico": "S03726", "cod_insumo": "I013264", "item": "EMPREITEIRO ADUTORA / POÇO ARTESIANO", "nivel": 4, "tipo": "insumo"}, {"ordem": 109, "cod": "01.02.08", "cod_servico": "", "cod_insumo": "", "item": "MURO E FECHAMENTOS", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 110, "cod": "01.02.08.01", "cod_servico": "S05764", "cod_insumo": "", "item": "MURO / FECHAMENTOS", "nivel": 4, "tipo": "servico"}, {"ordem": 111, "cod": "01.02.08.01", "cod_servico": "S05764", "cod_insumo": "I007387", "item": "EMPREITEIRO PARA INSTALAÇÃO GRADIL", "nivel": 4, "tipo": "insumo"}, {"ordem": 112, "cod": "01.02.08.01", "cod_servico": "S05764", "cod_insumo": "I008461", "item": "EMPREITEIRO CERCAMENTO EM GRADIL", "nivel": 4, "tipo": "insumo"}, {"ordem": 113, "cod": "01.02.08.01", "cod_servico": "S05764", "cod_insumo": "I013266", "item": "EMPREITEIRO DE MURO", "nivel": 4, "tipo": "insumo"}, {"ordem": 114, "cod": "01.02.08.01", "cod_servico": "S05764", "cod_insumo": "I013267", "item": "MATERIAIS DE MURO / GRADIL", "nivel": 4, "tipo": "insumo"}, {"ordem": 115, "cod": "01.02.09", "cod_servico": "", "cod_insumo": "", "item": "PAVIMENTAÇÃO", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 116, "cod": "01.02.09.01", "cod_servico": "S05744", "cod_insumo": "", "item": "PAVIMENTAÇÃO INTERNO", "nivel": 4, "tipo": "servico"}, {"ordem": 117, "cod": "01.02.09.01", "cod_servico": "S05744", "cod_insumo": "I002878", "item": "EMPREITEIRO PISO INTERTRAVADO", "nivel": 4, "tipo": "insumo"}, {"ordem": 118, "cod": "01.02.09.01", "cod_servico": "S05744", "cod_insumo": "I008100", "item": "PAVIMENTAÇÃO - MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 119, "cod": "01.02.09.01", "cod_servico": "S05744", "cod_insumo": "I008101", "item": "PAVIMENTAÇÃO BLOCO INTERTRAVADO - MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 120, "cod": "01.02.09.01", "cod_servico": "S05744", "cod_insumo": "I008124", "item": "EMPREITEIRO PAVIMENTAÇÃO", "nivel": 4, "tipo": "insumo"}, {"ordem": 121, "cod": "01.02.09.01", "cod_servico": "S05744", "cod_insumo": "I014713", "item": "EMPREITEIRO DE PAVIMENTAÇÃO DE PISTA DE ACESSO", "nivel": 4, "tipo": "insumo"}, {"ordem": 122, "cod": "01.02.10", "cod_servico": "", "cod_insumo": "", "item": "MEIO-FIO", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 123, "cod": "01.02.10.01", "cod_servico": "S03723", "cod_insumo": "", "item": "MEIO FIO", "nivel": 4, "tipo": "servico"}, {"ordem": 124, "cod": "01.02.10.01", "cod_servico": "S03723", "cod_insumo": "I013269", "item": "EMPREITEIRO MEIO FIO INTERNO", "nivel": 4, "tipo": "insumo"}, {"ordem": 125, "cod": "01.02.10.01", "cod_servico": "S03723", "cod_insumo": "I013270", "item": "EMPREITEIRO DE PINTURA DE MEIO-FIO INTERNO E GRELHAS", "nivel": 4, "tipo": "insumo"}, {"ordem": 126, "cod": "01.02.10.01", "cod_servico": "S03723", "cod_insumo": "I013271", "item": "MEIO FIO - MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 127, "cod": "01.02.10.01", "cod_servico": "S03723", "cod_insumo": "I013272", "item": "EMPREITEIRO MEIO-FIO EXTERNO", "nivel": 4, "tipo": "insumo"}, {"ordem": 128, "cod": "01.02.11", "cod_servico": "", "cod_insumo": "", "item": "REDE ELETRICA", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 129, "cod": "01.02.11.01", "cod_servico": "S03727", "cod_insumo": "", "item": "INSTALAÇÕES ELÉTRICAS", "nivel": 4, "tipo": "servico"}, {"ordem": 130, "cod": "01.02.11.01", "cod_servico": "S03727", "cod_insumo": "I001934", "item": "ILUMINACAO PUBLICA EXTERNA", "nivel": 4, "tipo": "insumo"}, {"ordem": 131, "cod": "01.02.11.01", "cod_servico": "S03727", "cod_insumo": "I008108", "item": "INSTALAÇÕES ELÉTRICAS - MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 132, "cod": "01.02.11.01", "cod_servico": "S03727", "cod_insumo": "I013273", "item": "EMPREITEIRO INFRAESTRUTURA ELÉTRICA SUBTERRÂNEA", "nivel": 4, "tipo": "insumo"}, {"ordem": 133, "cod": "01.02.11.01", "cod_servico": "S03727", "cod_insumo": "I013274", "item": "EMPREITEIRO REDE DISTRIBUIÇÃO AÉREA", "nivel": 4, "tipo": "insumo"}, {"ordem": 134, "cod": "01.02.11.01", "cod_servico": "S03727", "cod_insumo": "I013544", "item": "EMPREITEIRO ELETROMECANICA", "nivel": 4, "tipo": "insumo"}, {"ordem": 135, "cod": "01.02.12", "cod_servico": "", "cod_insumo": "", "item": "PAISAGISMO", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 136, "cod": "01.02.12.01", "cod_servico": "S01041", "cod_insumo": "", "item": "PAISAGISMO", "nivel": 4, "tipo": "servico"}, {"ordem": 137, "cod": "01.02.12.01", "cod_servico": "S01041", "cod_insumo": "I001549", "item": "PAISAGISMO - MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 138, "cod": "01.02.12.01", "cod_servico": "S01041", "cod_insumo": "I002379", "item": "EMPREITEIRO PAISAGISMO", "nivel": 4, "tipo": "insumo"}, {"ordem": 139, "cod": "01.02.12.01", "cod_servico": "S01041", "cod_insumo": "I011024", "item": "MANUTENÇÃO E LIMPEZA DA MATA", "nivel": 4, "tipo": "insumo"}, {"ordem": 140, "cod": "01.02.12.01", "cod_servico": "S01041", "cod_insumo": "I013276", "item": "EMPREITEIRO PLANTIO DE MIX", "nivel": 4, "tipo": "insumo"}, {"ordem": 141, "cod": "01.02.12.01", "cod_servico": "S01041", "cod_insumo": "I020929", "item": "LOCAÇÃO DE EQUIPAMENTO", "nivel": 4, "tipo": "insumo"}, {"ordem": 142, "cod": "01.02.12.01", "cod_servico": "S01041", "cod_insumo": "I024029", "item": "EMPREITEIRO PLANTIO DE GRAMA", "nivel": 4, "tipo": "insumo"}, {"ordem": 143, "cod": "01.02.13", "cod_servico": "", "cod_insumo": "", "item": "SISTEMA DE SEGURANCA / CFTV / FIBRA OPTICA", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 144, "cod": "01.02.13.01", "cod_servico": "S03732", "cod_insumo": "", "item": "INSTALAÇÕES DE CFTV", "nivel": 4, "tipo": "servico"}, {"ordem": 145, "cod": "01.02.13.01", "cod_servico": "S03732", "cod_insumo": "I008113", "item": "INSTALAÇÕES DE CFTV - MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 146, "cod": "01.02.13.01", "cod_servico": "S03732", "cod_insumo": "I008137", "item": "EMPREITEIRO INSTALAÇÕES DE CFTV", "nivel": 4, "tipo": "insumo"}, {"ordem": 147, "cod": "01.02.13.01", "cod_servico": "S03732", "cod_insumo": "I014940", "item": "EMPREITEIRO CAIXA DE PASSAGEM PARA FIBRA ÓPTICA", "nivel": 4, "tipo": "insumo"}, {"ordem": 148, "cod": "01.02.14", "cod_servico": "", "cod_insumo": "", "item": "SINALIZAÇÃO", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 149, "cod": "01.02.14.01", "cod_servico": "S03730", "cod_insumo": "", "item": "SINALIZAÇÃO", "nivel": 4, "tipo": "servico"}, {"ordem": 150, "cod": "01.02.14.01", "cod_servico": "S03730", "cod_insumo": "I008135", "item": "EMPREITEIRO SINALIZAÇÃO", "nivel": 4, "tipo": "insumo"}, {"ordem": 151, "cod": "01.02.14.01", "cod_servico": "S03730", "cod_insumo": "I013281", "item": "EMPREITEIRO SINALIZAÇÃO INTERNO", "nivel": 4, "tipo": "insumo"}, {"ordem": 152, "cod": "01.03", "cod_servico": "", "cod_insumo": "", "item": "OBRAS CIVIS", "nivel": 2, "tipo": "grupo"}, {"ordem": 153, "cod": "01.03.01", "cod_servico": "", "cod_insumo": "", "item": "PORTARIA", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 154, "cod": "01.03.01.01", "cod_servico": "S03734", "cod_insumo": "", "item": "PORTARIA", "nivel": 4, "tipo": "servico"}, {"ordem": 155, "cod": "01.03.01.01", "cod_servico": "S03734", "cod_insumo": "I003248", "item": "EMPREITEIRO DE ESTRUTURAS METALICAS", "nivel": 4, "tipo": "insumo"}, {"ordem": 156, "cod": "01.03.01.01", "cod_servico": "S03734", "cod_insumo": "I008115", "item": "PORTARIA - MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 157, "cod": "01.03.01.01", "cod_servico": "S03734", "cod_insumo": "I008138", "item": "EMPREITEIRO ACADEMIA", "nivel": 4, "tipo": "insumo"}, {"ordem": 158, "cod": "01.03.01.01", "cod_servico": "S03734", "cod_insumo": "I013286", "item": "EMPRETEIRO ESTRUTURA DE CONCRETO", "nivel": 4, "tipo": "insumo"}, {"ordem": 159, "cod": "01.03.01.01", "cod_servico": "S03734", "cod_insumo": "I013288", "item": "EMPRETEIRO OBRA FINA", "nivel": 4, "tipo": "insumo"}, {"ordem": 160, "cod": "01.03.02", "cod_servico": "", "cod_insumo": "", "item": "PRAÇAS", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 161, "cod": "01.03.02.01", "cod_servico": "S03740", "cod_insumo": "", "item": "PRAÇAS", "nivel": 4, "tipo": "servico"}, {"ordem": 162, "cod": "01.03.02.01", "cod_servico": "S03740", "cod_insumo": "I001148", "item": "MURO DE ARRIMO - MÃO DE OBRA E MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 163, "cod": "01.03.02.01", "cod_servico": "S03740", "cod_insumo": "I002878", "item": "EMPREITEIRO PISO INTERTRAVADO", "nivel": 4, "tipo": "insumo"}, {"ordem": 164, "cod": "01.03.02.01", "cod_servico": "S03740", "cod_insumo": "I004837", "item": "PLANTIO DE HORTA", "nivel": 4, "tipo": "insumo"}, {"ordem": 165, "cod": "01.03.02.01", "cod_servico": "S03740", "cod_insumo": "I008121", "item": "PRAÇAS - MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 166, "cod": "01.03.02.01", "cod_servico": "S03740", "cod_insumo": "I008186", "item": "EMPREITEIRO INSTALAÇÕES", "nivel": 4, "tipo": "insumo"}, {"ordem": 167, "cod": "01.03.02.01", "cod_servico": "S03740", "cod_insumo": "I013292", "item": "EMPREITEIRO ESTAÇÃO DE GINÁSTICA", "nivel": 4, "tipo": "insumo"}, {"ordem": 168, "cod": "01.03.02.01", "cod_servico": "S03740", "cod_insumo": "I013293", "item": "EMPREITEIRO PERGOLADOS/DUCHA", "nivel": 4, "tipo": "insumo"}, {"ordem": 169, "cod": "01.03.02.01", "cod_servico": "S03740", "cod_insumo": "I013298", "item": "EMPREITEIRO PET PLACE", "nivel": 4, "tipo": "insumo"}, {"ordem": 170, "cod": "01.03.02.01", "cod_servico": "S03740", "cod_insumo": "I014233", "item": "EMPREITEIRO DE ASSENTAMENTO DE GUARDA CORPO", "nivel": 4, "tipo": "insumo"}, {"ordem": 171, "cod": "01.03.03", "cod_servico": "", "cod_insumo": "", "item": "PLAYGROUND", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 172, "cod": "01.03.03.01", "cod_servico": "S03739", "cod_insumo": "", "item": "PLAYGROUND", "nivel": 4, "tipo": "servico"}, {"ordem": 173, "cod": "01.03.03.01", "cod_servico": "S03739", "cod_insumo": "I013300", "item": "EMPREITEIRO PLAYGROUND", "nivel": 4, "tipo": "insumo"}, {"ordem": 174, "cod": "01.03.03.01", "cod_servico": "S03739", "cod_insumo": "I013301", "item": "EMPREITEIRO BRINQUEDOS", "nivel": 4, "tipo": "insumo"}, {"ordem": 175, "cod": "01.03.04", "cod_servico": "", "cod_insumo": "", "item": "QUADRAS ESPORTIVAS", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 176, "cod": "01.03.04.01", "cod_servico": "S05760", "cod_insumo": "", "item": "QUADRAS ESPORTIVAS", "nivel": 4, "tipo": "servico"}, {"ordem": 177, "cod": "01.03.04.01", "cod_servico": "S05760", "cod_insumo": "I013302", "item": "EMPREITEIRO CAMPO SOCIETY SINTÉTICO", "nivel": 4, "tipo": "insumo"}, {"ordem": 178, "cod": "01.03.04.01", "cod_servico": "S05760", "cod_insumo": "I013304", "item": "EMPRETEIRO QUADRA DE AREIA", "nivel": 4, "tipo": "insumo"}, {"ordem": 179, "cod": "01.03.04.01", "cod_servico": "S05760", "cod_insumo": "I013305", "item": "EMPREITEIRO QUADRA DE TENIS", "nivel": 4, "tipo": "insumo"}, {"ordem": 180, "cod": "01.03.05", "cod_servico": "", "cod_insumo": "", "item": "QUIOSQUE", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 181, "cod": "01.03.05.01", "cod_servico": "S03738", "cod_insumo": "", "item": "QUIOSQUES", "nivel": 4, "tipo": "servico"}, {"ordem": 182, "cod": "01.03.05.01", "cod_servico": "S03738", "cod_insumo": "I008119", "item": "QUIOSQUE 2 - MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 183, "cod": "01.03.05.01", "cod_servico": "S03738", "cod_insumo": "I008143", "item": "EMPREITEIRO QUIOSQUE 2", "nivel": 4, "tipo": "insumo"}, {"ordem": 184, "cod": "01.03.05.01", "cod_servico": "S03738", "cod_insumo": "I013286", "item": "EMPRETEIRO ESTRUTURA DE CONCRETO", "nivel": 4, "tipo": "insumo"}, {"ordem": 185, "cod": "01.03.06", "cod_servico": "", "cod_insumo": "", "item": "PISTA DE COOPER", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 186, "cod": "01.03.06.01", "cod_servico": "S03741", "cod_insumo": "", "item": "PISTA DE COOPER", "nivel": 4, "tipo": "servico"}, {"ordem": 187, "cod": "01.03.06.01", "cod_servico": "S03741", "cod_insumo": "I008122", "item": "PISTA DE COOPER - MATERIAL", "nivel": 4, "tipo": "insumo"}, {"ordem": 188, "cod": "01.03.06.01", "cod_servico": "S03741", "cod_insumo": "I008146", "item": "EMPREITEIRO PISTA DE COOPER", "nivel": 4, "tipo": "insumo"}, {"ordem": 189, "cod": "01.03.07", "cod_servico": "", "cod_insumo": "", "item": "CALÇADA EXTERNA", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 190, "cod": "01.03.07.01", "cod_servico": "S05757", "cod_insumo": "", "item": "CALÇADA EXTERNA", "nivel": 4, "tipo": "servico"}, {"ordem": 191, "cod": "01.03.07.01", "cod_servico": "S05757", "cod_insumo": "I013313", "item": "EMPREITEIRO DE CALÇADA EXTERNA", "nivel": 4, "tipo": "insumo"}, {"ordem": 192, "cod": "01.03.07.01", "cod_servico": "S05757", "cod_insumo": "I013314", "item": "MATERIAIS DE CALÇADA EXTERNA", "nivel": 4, "tipo": "insumo"}, {"ordem": 193, "cod": "01.03.08", "cod_servico": "", "cod_insumo": "", "item": "LIMPEZA FINAL DE OBRA", "nivel": 3, "tipo": "subgrupo"}, {"ordem": 194, "cod": "01.03.08.01", "cod_servico": "S00449", "cod_insumo": "", "item": "LIMPEZA FINAL DE OBRA", "nivel": 4, "tipo": "servico"}, {"ordem": 195, "cod": "01.03.08.01", "cod_servico": "S00449", "cod_insumo": "I001169", "item": "EMPREITEIRO LIMPEZA FINAL DE OBRA", "nivel": 4, "tipo": "insumo"}, {"ordem": 196, "cod": "01.04", "cod_servico": "", "cod_insumo": "", "item": "PROJEÇÃO DE GASTOS", "nivel": 2, "tipo": "grupo"}, {"ordem": 197, "cod": "01.04.01", "cod_servico": "S05305", "cod_insumo": "", "item": "PROJEÇÃO DE GASTOS", "nivel": 3, "tipo": "servico"}, {"ordem": 198, "cod": "01.04.01", "cod_servico": "S05305", "cod_insumo": "I011890", "item": "PROJEÇÃO DE GASTOS", "nivel": 3, "tipo": "insumo"}, {"ordem": 199, "cod": "01.09", "cod_servico": "", "cod_insumo": "", "item": "SERVIÇOS INICIAIS", "nivel": 2, "tipo": "grupo"}, {"ordem": 200, "cod": "09.01.01", "cod_servico": "PLAN2013", "cod_insumo": "", "item": "MAO DE OBRA - OBRA", "nivel": 3, "tipo": "servico"}, {"ordem": 201, "cod": "09.01.01", "cod_servico": "PLAN2013", "cod_insumo": "CONDH271", "item": "MAO DE OBRA - RATEIO DIFERENCIADO - OBRA", "nivel": 3, "tipo": "insumo"}, {"ordem": 202, "cod": "09.02.01", "cod_servico": "RJSMIL0004", "cod_insumo": "", "item": "SERVICOS INICIAIS", "nivel": 3, "tipo": "servico"}, {"ordem": 203, "cod": "09.02.01", "cod_servico": "RJSMIL0004", "cod_insumo": "V0000005", "item": "LIMPEZA DO TERRENO", "nivel": 3, "tipo": "insumo"}, {"ordem": 204, "cod": "09.02.01", "cod_servico": "RJSMIL0004", "cod_insumo": "V0000017", "item": "ABERTURA DE RUAS", "nivel": 3, "tipo": "insumo"}, {"ordem": 205, "cod": "09.02.02", "cod_servico": "RJSMIL0007", "cod_insumo": "", "item": "SERVICOS TOPOGRAFICOS E CONTROLE TECNOLOGICO", "nivel": 3, "tipo": "servico"}, {"ordem": 206, "cod": "09.02.02", "cod_servico": "RJSMIL0007", "cod_insumo": "SR10007", "item": "IMPLANTACAO TOPOGRAFICA", "nivel": 3, "tipo": "insumo"}];

const SERVICOS_META = {"S05765": {"descricao": "MÃO DE OBRA - RATEIO DIFERENCIADO", "cod": "01.01.01.02", "grupo_cod": "01.01", "grupo": "Custos Indiretos"}, "S05751": {"descricao": "MOBILIZAÇÃO / ALUGUEL CONTAINER", "cod": "01.01.02", "grupo_cod": "01.01", "grupo": "Custos Indiretos"}, "S02544": {"descricao": "CONFECÇÃO DO CANTEIRO DE OBRAS", "cod": "01.01.02.02", "grupo_cod": "01.01", "grupo": "Custos Indiretos"}, "S05753": {"descricao": "FOSSA SEPTICA/BANHEIRO QUÍMICO", "cod": "01.01.02.03", "grupo_cod": "01.01", "grupo": "Custos Indiretos"}, "S04314": {"descricao": "PERFURAÇÃO DE POÇO ARTESIANO", "cod": "01.01.02.04", "grupo_cod": "01.01", "grupo": "Custos Indiretos"}, "S05766": {"descricao": "SEGURANÇA DO CANTEIRO", "cod": "01.01.02.05", "grupo_cod": "01.01", "grupo": "Custos Indiretos"}, "S05745": {"descricao": "CONSUMO DE TELEFONE, INTERNET, ÁGUA, ESGOTO e ENERGIA", "cod": "01.01.03.01", "grupo_cod": "01.01", "grupo": "Custos Indiretos"}, "S02595": {"descricao": "MÓVEIS E EQUIPAMENTOS DE OBRA", "cod": "01.01.03.02", "grupo_cod": "01.01", "grupo": "Custos Indiretos"}, "S01899": {"descricao": "CAFÉ DA MANHA", "cod": "01.01.03.03", "grupo_cod": "01.01", "grupo": "Custos Indiretos"}, "S00837": {"descricao": "CONTROLE TECNOLÓGICO", "cod": "01.01.03.04", "grupo_cod": "01.01", "grupo": "Custos Indiretos"}, "S05746": {"descricao": "IMPLANTAÇÃO TOPOGRAFICA", "cod": "01.01.03.05", "grupo_cod": "01.01", "grupo": "Custos Indiretos"}, "S05747": {"descricao": "SERVIÇO DE PORTARIA E VIGILÂNCIA", "cod": "01.01.03.06", "grupo_cod": "01.01", "grupo": "Custos Indiretos"}, "S05748": {"descricao": "ALUGUEL DE VEÍCULOS", "cod": "01.01.03.07", "grupo_cod": "01.01", "grupo": "Custos Indiretos"}, "S04257": {"descricao": "CAIXA DE OBRA", "cod": "01.01.22", "grupo_cod": "01.01", "grupo": "Custos Indiretos"}, "S05767": {"descricao": "SERVIÇOS PERIÓDICOS", "cod": "01.02.01.01", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S05752": {"descricao": "PRAD - PLANO DE RECUPERAÇÃO DE ÁREAS DEGRADADAS", "cod": "01.02.01.02", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S00893": {"descricao": "PLANO DE GERENCIAMENTO DE RESÍDUOS", "cod": "01.02.01.03", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S05749": {"descricao": "SUPRESSÃO VEGETAL", "cod": "01.02.02.01", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S03369": {"descricao": "CUSTOS INDIRETOS PARA SERVIÇO DE TERRAPLANAGEM", "cod": "01.02.03.01", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S03368": {"descricao": "CUSTOS INDIRETOS PARA SERVIÇO DE GALERIAIS SUPERFICIAIS", "cod": "01.02.05.01", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S03725": {"descricao": "LANÇAMENTOS DRENAGEM", "cod": "01.02.05.02", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S03724": {"descricao": "BOCA DE LOBO / CHAMINÉS", "cod": "01.02.05.03", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S05743": {"descricao": "REDE DE ESGOTO", "cod": "01.02.06.01", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S03726": {"descricao": "CUSTOS INDIRETOS PARA SERVIÇO DE REDE DE ÁGUA", "cod": "01.02.07.01", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S05764": {"descricao": "MURO / FECHAMENTOS", "cod": "01.02.08.01", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S05744": {"descricao": "PAVIMENTAÇÃO INTERNO", "cod": "01.02.09.01", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S03723": {"descricao": "MEIO FIO", "cod": "01.02.10.01", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S03727": {"descricao": "INSTALAÇÕES ELÉTRICAS", "cod": "01.02.11.01", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S01041": {"descricao": "PAISAGISMO", "cod": "01.02.12.01", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S03732": {"descricao": "INSTALAÇÕES DE CFTV", "cod": "01.02.13.01", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S03730": {"descricao": "SINALIZAÇÃO", "cod": "01.02.14.01", "grupo_cod": "01.02", "grupo": "Custos Diretos / Infraestrutura"}, "S03734": {"descricao": "PORTARIA", "cod": "01.03.01.01", "grupo_cod": "01.03", "grupo": "Obras Civis"}, "S03740": {"descricao": "PRAÇAS", "cod": "01.03.02.01", "grupo_cod": "01.03", "grupo": "Obras Civis"}, "S03739": {"descricao": "PLAYGROUND", "cod": "01.03.03.01", "grupo_cod": "01.03", "grupo": "Obras Civis"}, "S05760": {"descricao": "QUADRAS ESPORTIVAS", "cod": "01.03.04.01", "grupo_cod": "01.03", "grupo": "Obras Civis"}, "S03738": {"descricao": "QUIOSQUES", "cod": "01.03.05.01", "grupo_cod": "01.03", "grupo": "Obras Civis"}, "S03741": {"descricao": "PISTA DE COOPER", "cod": "01.03.06.01", "grupo_cod": "01.03", "grupo": "Obras Civis"}, "S05757": {"descricao": "CALÇADA EXTERNA", "cod": "01.03.07.01", "grupo_cod": "01.03", "grupo": "Obras Civis"}, "S00449": {"descricao": "LIMPEZA FINAL DE OBRA", "cod": "01.03.08.01", "grupo_cod": "01.03", "grupo": "Obras Civis"}, "S05305": {"descricao": "PROJEÇÃO DE GASTOS", "cod": "01.04.01", "grupo_cod": "01.04", "grupo": "Projeção de Gastos"}, "PLAN2013": {"descricao": "MAO DE OBRA - OBRA", "cod": "09.01.01", "grupo_cod": "09.01", "grupo": "Serviços Iniciais Adicionais"}, "RJSMIL0004": {"descricao": "SERVICOS INICIAIS", "cod": "09.02.01", "grupo_cod": "09.02", "grupo": "Serviços Iniciais Adicionais"}, "RJSMIL0007": {"descricao": "SERVICOS TOPOGRAFICOS E CONTROLE TECNOLOGICO", "cod": "09.02.02", "grupo_cod": "09.02", "grupo": "Serviços Iniciais Adicionais"}};
const INSUMOS_META = {"ADM5189": {"descricao": "ASSESSORIA E CONSULTORIA GERENCIAL - OBRA", "servico_pai": "S05765"}, "CONDH271": {"descricao": "MAO DE OBRA - RATEIO DIFERENCIADO - OBRA", "servico_pai": "PLAN2013"}, "I002226": {"descricao": "PLR (PARTICIPACAO DE LUCROS E RESULTADOS)", "servico_pai": "S05765"}, "I013329": {"descricao": "MOBILIZAÇÃO / ALUGUEL DE CONTAINER", "servico_pai": "S05751"}, "I001609": {"descricao": "TAPUME METALICO", "servico_pai": "S02544"}, "I002242": {"descricao": "LIMPEZA E CONSERVACAO", "servico_pai": "S02544"}, "I013233": {"descricao": "CONFECÇÃO DE CANTEIROS", "servico_pai": "S02544"}, "I013234": {"descricao": "CONSTRUÇÃO REFORMA E MANUTENÇÃO DE ESCRITÓRIO - OBRA", "servico_pai": "S02544"}, "I019735": {"descricao": "MENSALIDADE DE ALOJAMENTO MODULAR", "servico_pai": "S02544"}, "I013235": {"descricao": "FOSSA SEPTICA / BANHEIRO QUIMICO", "servico_pai": "S05753"}, "I009447": {"descricao": "MATERIAL POÇO ARTESIANO", "servico_pai": "S04314"}, "I009888": {"descricao": "EMPREITEIRO PERFURAÇÃO POÇO ARTESIANO", "servico_pai": "S04314"}, "I004804": {"descricao": "VIGIA / SEGURANÇA DE OBRA", "servico_pai": "S05766"}, "I001266": {"descricao": "EQUIPAMENTOS DE INFORMATICA", "servico_pai": "S05745"}, "I013236": {"descricao": "TELEFONE / INTERNET / ENERGIA / AGUA - OBRA", "servico_pai": "S05745"}, "I013237": {"descricao": "TECNOLOGIA DA INFORMAÇÃO", "servico_pai": "S05745"}, "I003192": {"descricao": "UNIFORMES", "servico_pai": "S02595"}, "I013238": {"descricao": "FERRAMENTAS E EQUIPAMENTOS", "servico_pai": "S02595"}, "I013239": {"descricao": "MATERIAL DE ESCRITÓRIO", "servico_pai": "S02595"}, "I013240": {"descricao": "EQUIPAMENTO DE PROTECÃO INDIVIDUAL E COLETIVA", "servico_pai": "S02595"}, "I009448": {"descricao": "CAFE DA MANHÃ", "servico_pai": "S01899"}, "I002272": {"descricao": "CONTROLE TECNOLÓGICO DE CONCRETO", "servico_pai": "S00837"}, "I001713": {"descricao": "MAPEAMENTO COM DRONE", "servico_pai": "S05746"}, "I013241": {"descricao": "EQUIPE DE TOPOGRAFIA", "servico_pai": "S05746"}, "I013324": {"descricao": "PORTARIA/VIGILÂNCIA - OBRA", "servico_pai": "S05747"}, "I001275": {"descricao": "COMBUSTIVEL", "servico_pai": "S05748"}, "I004807": {"descricao": "ALUGUEL DE VEICULO DE PASSEIO", "servico_pai": "S05748"}, "I004808": {"descricao": "CAMINHÃO PIPA - LOCAÇÃO", "servico_pai": "S05748"}, "I013424": {"descricao": "DESPESAS COM TRANSPORTE – UBER", "servico_pai": "S05748"}, "I020929": {"descricao": "LOCAÇÃO DE EQUIPAMENTO", "servico_pai": "S01041"}, "I009752": {"descricao": "CAIXA DE OBRAS", "servico_pai": "S04257"}, "I006784": {"descricao": "EXECUÇÃO DE LAUDO DE VIZINHANÇA", "servico_pai": "S05767"}, "I013242": {"descricao": "COMPENSAÇÃO AMBIENTAL DA SUPRESSÃO", "servico_pai": "S05767"}, "I019429": {"descricao": "MANUTENÇÃO DE ÁREAS PRÉ-OBRA", "servico_pai": "S05767"}, "I011126": {"descricao": "MANUTENÇÃO DE PLANTIO", "servico_pai": "S05752"}, "I013243": {"descricao": "REFLORESTAMENTO / FORNECIMENTO DE MUDAS", "servico_pai": "S05752"}, "I013244": {"descricao": "CONSULTORIA AMBIENTAL", "servico_pai": "S05752"}, "I002245": {"descricao": "PLANO DE GERENCIAMENTO DE RESÍDUOS", "servico_pai": "S00893"}, "I012012": {"descricao": "EMPREITEIRO ROÇAGEM DE MANUTENÇÃO", "servico_pai": "S05749"}, "I013246": {"descricao": "RETIRADA DE ENTULHOS / DEMOLIÇÕES", "servico_pai": "S05749"}, "I013247": {"descricao": "ABERTURA DE RUAS", "servico_pai": "S05749"}, "I013248": {"descricao": "SUPRESSAO VEGETAL", "servico_pai": "S05749"}, "I013249": {"descricao": "EMPREITEIRO DE TERRAPLANAGEM INTERNA", "servico_pai": "S03369"}, "I013250": {"descricao": "EMPREITEIRO DE TERRAPLANAGEM PISTA DE ACESSO", "servico_pai": "S03369"}, "I008103": {"descricao": "DRENAGEM - MATERIAL", "servico_pai": "S03368"}, "I008127": {"descricao": "EMPREITEIRO DRENAGEM", "servico_pai": "S03368"}, "I008105": {"descricao": "LANÇAMENTOS DRENAGEM - MATERIAL", "servico_pai": "S03725"}, "I008129": {"descricao": "EMPREITEIRO LANÇAMENTOS DRENAGEM", "servico_pai": "S03725"}, "I008104": {"descricao": "BOCA DE LOBO/CHAMINÉS - MATERIAL", "servico_pai": "S03724"}, "I013328": {"descricao": "EMPREITEIRO BOCA DE LOBO /CHAMINÉS", "servico_pai": "S03724"}, "I024034": {"descricao": "GRELHA DE PAVIMENTO", "servico_pai": "S03724"}, "I013255": {"descricao": "EMPREITEIRO DE REDE DE ESGOTO", "servico_pai": "S05743"}, "I013256": {"descricao": "MATERIAIS DE REDE DE ESGOTO", "servico_pai": "S05743"}, "I013258": {"descricao": "EMPREITEIRO ESTAÇÃO ELEVATÓRIA DE ESGOTO/TRATAMENTO DE ESGOTO", "servico_pai": "S05743"}, "I008131": {"descricao": "EMPREITEIRO REDE DE ÁGUA", "servico_pai": "S03726"}, "I012679": {"descricao": "EMPREITEIRO CENTRO DE RESERVAÇÃO", "servico_pai": "S03726"}, "I013261": {"descricao": "MATERIAIS DE REDE DE ÁGUA", "servico_pai": "S03726"}, "I013264": {"descricao": "EMPREITEIRO ADUTORA / POÇO ARTESIANO", "servico_pai": "S03726"}, "I007387": {"descricao": "EMPREITEIRO PARA INSTALAÇÃO GRADIL", "servico_pai": "S05764"}, "I008461": {"descricao": "EMPREITEIRO CERCAMENTO EM GRADIL", "servico_pai": "S05764"}, "I013266": {"descricao": "EMPREITEIRO DE MURO", "servico_pai": "S05764"}, "I013267": {"descricao": "MATERIAIS DE MURO / GRADIL", "servico_pai": "S05764"}, "I002878": {"descricao": "EMPREITEIRO PISO INTERTRAVADO", "servico_pai": "S03740"}, "I008100": {"descricao": "PAVIMENTAÇÃO - MATERIAL", "servico_pai": "S05744"}, "I008101": {"descricao": "PAVIMENTAÇÃO BLOCO INTERTRAVADO - MATERIAL", "servico_pai": "S05744"}, "I008124": {"descricao": "EMPREITEIRO PAVIMENTAÇÃO", "servico_pai": "S05744"}, "I014713": {"descricao": "EMPREITEIRO DE PAVIMENTAÇÃO DE PISTA DE ACESSO", "servico_pai": "S05744"}, "I013269": {"descricao": "EMPREITEIRO MEIO FIO INTERNO", "servico_pai": "S03723"}, "I013270": {"descricao": "EMPREITEIRO DE PINTURA DE MEIO-FIO INTERNO E GRELHAS", "servico_pai": "S03723"}, "I013271": {"descricao": "MEIO FIO - MATERIAL", "servico_pai": "S03723"}, "I013272": {"descricao": "EMPREITEIRO MEIO-FIO EXTERNO", "servico_pai": "S03723"}, "I001934": {"descricao": "ILUMINACAO PUBLICA EXTERNA", "servico_pai": "S03727"}, "I008108": {"descricao": "INSTALAÇÕES ELÉTRICAS - MATERIAL", "servico_pai": "S03727"}, "I013273": {"descricao": "EMPREITEIRO INFRAESTRUTURA ELÉTRICA SUBTERRÂNEA", "servico_pai": "S03727"}, "I013274": {"descricao": "EMPREITEIRO REDE DISTRIBUIÇÃO AÉREA", "servico_pai": "S03727"}, "I013544": {"descricao": "EMPREITEIRO ELETROMECANICA", "servico_pai": "S03727"}, "I001549": {"descricao": "PAISAGISMO - MATERIAL", "servico_pai": "S01041"}, "I002379": {"descricao": "EMPREITEIRO PAISAGISMO", "servico_pai": "S01041"}, "I011024": {"descricao": "MANUTENÇÃO E LIMPEZA DA MATA", "servico_pai": "S01041"}, "I013276": {"descricao": "EMPREITEIRO PLANTIO DE MIX", "servico_pai": "S01041"}, "I024029": {"descricao": "EMPREITEIRO PLANTIO DE GRAMA", "servico_pai": "S01041"}, "I008113": {"descricao": "INSTALAÇÕES DE CFTV - MATERIAL", "servico_pai": "S03732"}, "I008137": {"descricao": "EMPREITEIRO INSTALAÇÕES DE CFTV", "servico_pai": "S03732"}, "I014940": {"descricao": "EMPREITEIRO CAIXA DE PASSAGEM PARA FIBRA ÓPTICA", "servico_pai": "S03732"}, "I008135": {"descricao": "EMPREITEIRO SINALIZAÇÃO", "servico_pai": "S03730"}, "I013281": {"descricao": "EMPREITEIRO SINALIZAÇÃO INTERNO", "servico_pai": "S03730"}, "I003248": {"descricao": "EMPREITEIRO DE ESTRUTURAS METALICAS", "servico_pai": "S03734"}, "I008115": {"descricao": "PORTARIA - MATERIAL", "servico_pai": "S03734"}, "I008138": {"descricao": "EMPREITEIRO ACADEMIA", "servico_pai": "S03734"}, "I013286": {"descricao": "EMPRETEIRO ESTRUTURA DE CONCRETO", "servico_pai": "S03738"}, "I013288": {"descricao": "EMPRETEIRO OBRA FINA", "servico_pai": "S03734"}, "I001148": {"descricao": "MURO DE ARRIMO - MÃO DE OBRA E MATERIAL", "servico_pai": "S03740"}, "I004837": {"descricao": "PLANTIO DE HORTA", "servico_pai": "S03740"}, "I008121": {"descricao": "PRAÇAS - MATERIAL", "servico_pai": "S03740"}, "I008186": {"descricao": "EMPREITEIRO INSTALAÇÕES", "servico_pai": "S03740"}, "I013292": {"descricao": "EMPREITEIRO ESTAÇÃO DE GINÁSTICA", "servico_pai": "S03740"}, "I013293": {"descricao": "EMPREITEIRO PERGOLADOS/DUCHA", "servico_pai": "S03740"}, "I013298": {"descricao": "EMPREITEIRO PET PLACE", "servico_pai": "S03740"}, "I014233": {"descricao": "EMPREITEIRO DE ASSENTAMENTO DE GUARDA CORPO", "servico_pai": "S03740"}, "I013300": {"descricao": "EMPREITEIRO PLAYGROUND", "servico_pai": "S03739"}, "I013301": {"descricao": "EMPREITEIRO BRINQUEDOS", "servico_pai": "S03739"}, "I013302": {"descricao": "EMPREITEIRO CAMPO SOCIETY SINTÉTICO", "servico_pai": "S05760"}, "I013304": {"descricao": "EMPRETEIRO QUADRA DE AREIA", "servico_pai": "S05760"}, "I013305": {"descricao": "EMPREITEIRO QUADRA DE TENIS", "servico_pai": "S05760"}, "I008119": {"descricao": "QUIOSQUE 2 - MATERIAL", "servico_pai": "S03738"}, "I008143": {"descricao": "EMPREITEIRO QUIOSQUE 2", "servico_pai": "S03738"}, "I008122": {"descricao": "PISTA DE COOPER - MATERIAL", "servico_pai": "S03741"}, "I008146": {"descricao": "EMPREITEIRO PISTA DE COOPER", "servico_pai": "S03741"}, "I013313": {"descricao": "EMPREITEIRO DE CALÇADA EXTERNA", "servico_pai": "S05757"}, "I013314": {"descricao": "MATERIAIS DE CALÇADA EXTERNA", "servico_pai": "S05757"}, "I001169": {"descricao": "EMPREITEIRO LIMPEZA FINAL DE OBRA", "servico_pai": "S00449"}, "I011890": {"descricao": "PROJEÇÃO DE GASTOS", "servico_pai": "S05305"}, "V0000005": {"descricao": "LIMPEZA DO TERRENO", "servico_pai": "RJSMIL0004"}, "V0000017": {"descricao": "ABERTURA DE RUAS", "servico_pai": "RJSMIL0004"}, "SR10007": {"descricao": "IMPLANTACAO TOPOGRAFICA", "servico_pai": "RJSMIL0007"}};

function initProjecao() {
  // v0.58b: verifica se há dados PARA A OBRA ATIVA
  const _proj = getProjRawObraAtiva();
  if (!_proj.length) {
    document.getElementById('projChart').innerHTML = '<div style="text-align:center; color:var(--text-lighter); padding:80px 20px; font-size:14px;">⚠️ Recarregue o CSV da aba <strong>Gestões</strong> usando a barra acima.<br>Os dados mensais não foram pré-carregados.</div>';
    document.getElementById('projKpis').replaceChildren();
    document.getElementById('projTbody').replaceChildren();
    return;
  }
  const ultimo = defaultDataFim();
  document.getElementById('projUltimoMes').textContent = formatMonthLabel(ultimo);
  const dfInput = document.getElementById('projDataFim');
  if (!dfInput.value) dfInput.value = ultimo;
  const dcInput = document.getElementById('projDataCorte');
  if (!dcInput.value) dcInput.value = defaultDataCorte();
  // popular filtro de grupos
  const fg = document.getElementById('projFilterGrupo');
  if (fg && fg.options.length <= 1) {
    const grupos = [...new Set(Object.values(SERVICOS_META).map(s => s.grupo))].sort();
    grupos.forEach(g => {
      const o = document.createElement('option'); o.value = g; o.textContent = g; fg.appendChild(o);
    });
  }
  renderProjecao();
}

// Retorna o grupo de um serviço (ou "Outros" se desconhecido)
function grupoDoServico(servico) {
  const meta = SERVICOS_META[servico];
  return meta ? meta.grupo : 'Outros';
}
function descServico(servico) {
  const meta = SERVICOS_META[servico];
  return meta ? meta.descricao : servico;
}
function descInsumo(insumo) {
  const meta = INSUMOS_META[insumo];
  return meta ? meta.descricao : insumo;
}

// Define se um grupo deve ter EXTRAPOLAÇÃO quando o planejamento termina antes da data fim
function grupoExtrapola(grupo) {
  // Só indiretos extrapolam (e Projeção de Gastos também é uma reserva variável)
  return grupo === 'Custos Indiretos' || grupo === 'Projeção de Gastos';
}

function formatMonthLabel(yyyy_mm) {
  if (!yyyy_mm || !yyyy_mm.match(/^\d{4}-\d{2}$/)) return yyyy_mm;
  const [y, m] = yyyy_mm.split('-');
  const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  return `${meses[parseInt(m)-1]}/${y}`;
}

function monthsBetween(start, end) {
  if (!start || !end) return 0;
  const [ys, ms] = start.split('-').map(Number);
  const [ye, me] = end.split('-').map(Number);
  return (ye - ys) * 12 + (me - ms);
}

function addMonths(yyyy_mm, n) {
  const [y, m] = yyyy_mm.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

// Calcula o ritmo histórico (R$/mês) somando os últimos N meses ANTES da data de corte
function calcularRitmoHistorico(meses, dataCorte, janelaMeses) {
  const past = Object.entries(meses)
    .filter(([m, v]) => m < dataCorte && v > 0)
    .sort();
  if (!past.length) return 0;
  // Pega os últimos N meses CONSECUTIVOS antes do corte
  const cutoffStart = addMonths(dataCorte, -janelaMeses);
  const dentroJanela = past.filter(([m, v]) => m >= cutoffStart);
  if (!dentroJanela.length) return 0;
  const total = dentroJanela.reduce((s, [m, v]) => s + v, 0);
  return total / janelaMeses;
}

// Calcula somatório de flows PENDENTES (refletido_status='pendente', exceto cancelados)
// agrupados por grupo do insumo de destino
// Retorna {indiretos: R$, diretos: R$, civis: R$, projecao: R$, outros: R$}
function calcularFlowsPendentesPorGrupo() {
  const out = { 'Custos Indiretos': 0, 'Custos Diretos / Infraestrutura': 0, 'Obras Civis': 0, 'Projeção de Gastos': 0, 'Outros': 0 };
  if (!Array.isArray(getFlowsObraAtiva())) return out;

  getFlowsObraAtiva().forEach(f => {
    if (f.dep === 'Cancelado') return;
    const status = f.refletido_status || 'pendente';
    if (status !== 'pendente') return;

    const valor = f.custo_flowmaster || 0;
    if (Math.abs(valor) < 0.01) return;

    const insDest = f.insumo_planejamento;
    if (!insDest || ['', '-', 'Não encontrado!'].includes(insDest) || String(insDest).toUpperCase().includes('VERIFICAR') || insDest === 'Aumento de obra') {
      out['Outros'] += valor;
      return;
    }
    const tendItem = (Array.isArray(DATA_T) ? DATA_T : []).find(t => t.is_folha && t.cod_insumo === insDest);
    if (tendItem && tendItem.grupo && out.hasOwnProperty(tendItem.grupo)) {
      out[tendItem.grupo] += valor;
    } else {
      out['Outros'] += valor;
    }
  });
  return out;
}

// Função central: calcula KPIs por SERVIÇO (a base de tudo)
function projetarServico(servico, meses, dataCorte, dataFim, janelaMeses) {
  const realizado = Object.entries(meses).filter(([m, v]) => m < dataCorte).reduce((s, [m, v]) => s + v, 0);
  const planejadoFuturo = Object.entries(meses).filter(([m, v]) => m >= dataCorte).reduce((s, [m, v]) => s + v, 0);
  const planejadoTotal = realizado + planejadoFuturo;

  // Identificar último mês com planejamento real (valor > 0)
  const mesesComValor = Object.entries(meses).filter(([m, v]) => v > 0).map(([m]) => m).sort();
  const ultimoMesPlanejado = mesesComValor.length ? mesesComValor[mesesComValor.length - 1] : null;

  // EXTRAPOLAÇÃO: só se grupo permitir E obra terminar depois do último mês planejado
  let extrapolacao = 0;
  let mesesGap = 0;
  const grupo = grupoDoServico(servico);
  const ritmoHist = calcularRitmoHistorico(meses, dataCorte, janelaMeses);
  if (ultimoMesPlanejado && dataFim > ultimoMesPlanejado && grupoExtrapola(grupo)) {
    mesesGap = monthsBetween(ultimoMesPlanejado, dataFim);
    extrapolacao = ritmoHist * mesesGap;
  }

  const tendencia = planejadoTotal + extrapolacao;
  const diff = tendencia - planejadoTotal; // = extrapolacao na prática

  return {
    servico, grupo,
    realizado,
    planejado_futuro: planejadoFuturo,
    planejado_total: planejadoTotal,
    ultimo_mes_planejado: ultimoMesPlanejado,
    ritmo_historico: ritmoHist,
    meses_gap: mesesGap,
    extrapolacao,
    tendencia,
    diff,
    meses, // para drill-down
  };
}

function calcStatus(diff, planejado, tolerancia) {
  if (Math.abs(diff) <= tolerancia) return 'green';
  if (diff > 0 && planejado > 0 && diff <= planejado * 0.05) return 'amber';
  if (diff > 0) return 'red';
  return 'sobra';
}

function renderProjecao() {
  // v0.58b: filtra PROJ_RAW pela obra ativa
  const PROJ_OBRA = getProjRawObraAtiva();
  if (!PROJ_OBRA.length) { initProjecao(); return; }
  const dataCorte = document.getElementById('projDataCorte').value || defaultDataCorte();
  const dataFim = document.getElementById('projDataFim').value || defaultDataFim();
  const janelaMeses = parseInt(document.getElementById('projMetodo').value) || 6;
  const tolerancia = parseFloat(document.getElementById('projTolerancia').value) || 0;

  // Agregar por serviço e por insumo
  const porServico = {};
  const porInsumo = {}; // chave "servico|insumo"
  PROJ_OBRA.forEach(r => {
    if (!porServico[r.servico]) porServico[r.servico] = {};
    porServico[r.servico][r.mes] = (porServico[r.servico][r.mes] || 0) + r.valor;
    const k = r.servico + '|' + r.insumo;
    if (!porInsumo[k]) porInsumo[k] = { servico: r.servico, insumo: r.insumo, meses: {} };
    porInsumo[k].meses[r.mes] = (porInsumo[k].meses[r.mes] || 0) + r.valor;
  });

  // Projetar cada serviço
  const projServicos = Object.entries(porServico).map(([s, meses]) =>
    projetarServico(s, meses, dataCorte, dataFim, janelaMeses)
  );

  // Projetar cada insumo (herda regra de extrapolação do serviço pai)
  const projInsumos = Object.values(porInsumo).map(item =>
    projetarServico(item.servico, item.meses, dataCorte, dataFim, janelaMeses)
  ).map((proj, idx) => {
    const item = Object.values(porInsumo)[idx];
    return { ...proj, insumo: item.insumo };
  });

  // Calcular totais por grupo (somando os serviços)
  const porGrupo = {};
  projServicos.forEach(p => {
    if (!porGrupo[p.grupo]) porGrupo[p.grupo] = {
      grupo: p.grupo, realizado: 0, planejado_total: 0,
      planejado_futuro: 0, extrapolacao: 0, tendencia: 0, diff: 0,
      servicos: []
    };
    const g = porGrupo[p.grupo];
    g.realizado += p.realizado;
    g.planejado_total += p.planejado_total;
    g.planejado_futuro += p.planejado_futuro;
    g.extrapolacao += p.extrapolacao;
    g.tendencia += p.tendencia;
    g.diff += p.diff;
    g.servicos.push(p);
  });

  // KPIs gerais
  const totRealizado = projServicos.reduce((s, l) => s + l.realizado, 0);
  const totPlanejado = projServicos.reduce((s, l) => s + l.planejado_total, 0);
  const totExtrap = projServicos.reduce((s, l) => s + l.extrapolacao, 0);
  const totTendencia = projServicos.reduce((s, l) => s + l.tendencia, 0);
  const totDiff = totTendencia - totPlanejado;
  const reds = projServicos.filter(l => calcStatus(l.diff, l.planejado_total, tolerancia) === 'red').length;
  const ambers = projServicos.filter(l => calcStatus(l.diff, l.planejado_total, tolerancia) === 'amber').length;
  const pctExecutado = totPlanejado ? (totRealizado / totPlanejado * 100) : 0;
  const diffCls = totDiff > tolerancia ? 'red' : totDiff < -tolerancia ? 'green' : '';
  const diffLabel = totDiff > tolerancia ? 'Vai precisar planejar mais' : totDiff < -tolerancia ? 'Vai sobrar verba' : 'No esperado';

  // Quebrar a "extrapolação" entre o que é obra estendida (só Indiretos) e flows pendentes (qualquer grupo)
  // totExtrap (calculado acima) = só extrapolação clássica (obra estendida em Indiretos)
  // Vamos calcular separadamente o impacto dos flows pendentes por grupo
  const flowsPendByGrupo = calcularFlowsPendentesPorGrupo();
  const flowsPendInd = (flowsPendByGrupo['Custos Indiretos']||0) + (flowsPendByGrupo['Projeção de Gastos']||0);
  const flowsPendDir = (flowsPendByGrupo['Custos Diretos / Infraestrutura']||0) + (flowsPendByGrupo['Obras Civis']||0) + (flowsPendByGrupo['Outros']||0);
  const totIndiretosTend = totExtrap + flowsPendInd;
  const totDiretosTend = flowsPendDir;
  const totFlowsPend = flowsPendInd + flowsPendDir;

  document.getElementById('projKpis').innerHTML = [
    uiCriarKpi({ titulo: `Realizado (até ${formatMonthLabel(dataCorte)})`, valor: fmtR$(totRealizado), subtitulo: `${pctExecutado.toFixed(1)}% do planejado total` }),
    uiCriarKpi({ titulo: 'Planejado Total (CSV)', valor: fmtR$(totPlanejado), subtitulo: 'passado + futuro planejado' }),
    uiCriarKpi({ titulo: 'Tend. Indiretos', valor: fmtR$(totIndiretosTend), subtitulo: `obra estendida ${fmtR$k(totExtrap)} + flows pendentes ${fmtR$k(flowsPendInd)}`, cor: 'purple', icon: '🏗️' }),
    uiCriarKpi({ titulo: 'Tend. Diretos', valor: fmtR$(totDiretosTend), subtitulo: `${fmtR$(totDiretosTend)} em flows pendentes (Diretos/Civis)`, cor: 'amber', icon: '🧱' }),
    uiCriarKpi({ titulo: 'Tendência Total', valor: fmtR$(totTendencia), subtitulo: `${diffLabel} (${totDiff>=0?'+':''}${fmtR$(totDiff)})`, cor: diffCls, icon: '🔮' }),
  ].join('');

  // Gráfico curva S geral
  renderProjChartGeral(porServico, projServicos, dataCorte, dataFim, janelaMeses);

  // Aderência Físico × Financeira (renderiza se o container existir na página)
  try { if (typeof renderAderenciaProj === 'function') renderAderenciaProj(); } catch(e) { console.warn('aderencia:', e); }

  // Tabela hierárquica
  renderProjTable(porGrupo, projServicos, projInsumos, tolerancia);
}

function renderProjChartGeral(porServico, projServicos, dataCorte, dataFim, janelaMeses) {
  // Acumular planejado total mês a mês
  const totalMeses = {};
  Object.values(porServico).forEach(meses => {
    Object.entries(meses).forEach(([m, v]) => { totalMeses[m] = (totalMeses[m] || 0) + v; });
  });
  const todosMeses = Object.keys(totalMeses).sort();
  if (!todosMeses.length) { document.getElementById('projChart').replaceChildren(); return; }

  // Estender meses até dataFim se necessário
  let extended = [...todosMeses];
  const ultimoMes = todosMeses[todosMeses.length - 1];
  if (dataFim > ultimoMes) {
    let m = ultimoMes;
    while (m < dataFim) { m = addMonths(m, 1); extended.push(m); if (!(m in totalMeses)) totalMeses[m] = 0; }
  }
  extended.sort();

  // Linha A: planejado acumulado
  let acumPlan = 0;
  const planAcumulado = extended.map(m => { acumPlan += (totalMeses[m] || 0); return { mes: m, valor: acumPlan }; });

  // Linha B: tendência acumulada
  const extrapPorMes = {};
  projServicos.forEach(p => {
    if (p.extrapolacao > 0 && p.ultimo_mes_planejado && p.meses_gap > 0) {
      const perMonth = p.extrapolacao / p.meses_gap;
      let m = p.ultimo_mes_planejado;
      for (let i = 0; i < p.meses_gap; i++) { m = addMonths(m, 1); extrapPorMes[m] = (extrapPorMes[m] || 0) + perMonth; }
    }
  });
  let acumTend = 0;
  const tendAcumulada = extended.map(m => { acumTend += (totalMeses[m] || 0) + (extrapPorMes[m] || 0); return { mes: m, valor: acumTend }; });

  const categories = extended.map(m => formatMonthLabel(m));
  const planData = planAcumulado.map(p => p.valor);
  const tendData = tendAcumulada.map(p => p.valor);

  // Posição do corte e do fim para annotations
  const findIdx = m => { let bestIdx = 0; for (let i = 0; i < extended.length; i++) { if (extended[i] <= m) bestIdx = i; else break; } return bestIdx; };
  const corteIdx = findIdx(dataCorte);
  const fimIdx = findIdx(dataFim);

  const options = {
    series: [
      { name: 'Planejado acumulado', type: 'area', data: planData },
      { name: 'Tendência projetada', type: 'line', data: tendData },
    ],
    chart: {
      height: 400,
      animations: { enabled: true, easing: 'easeinout', speed: 800 },
      toolbar: { show: true, tools: { download: true, selection: true, zoom: true, zoomin: true, zoomout: true, pan: true, reset: true } },
      zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
    },
    colors: [resolveColor('var(--fgr-red-deep)'), resolveColor('var(--sem-alerta)')],
    stroke: { curve: 'smooth', width: [2.5, 2.5] },
    fill: {
      type: ['gradient', 'solid'],
      gradient: { shadeIntensity: 1, opacityFrom: 0.15, opacityTo: 0.02, stops: [0, 100] },
    },
    xaxis: {
      categories: categories,
      labels: { rotate: -45, rotateAlways: true, style: { fontSize: '10px' } },
    },
    yaxis: {
      labels: { formatter: val => fmtR$k(val), style: { fontSize: '10px' } },
    },
    annotations: {
      xaxis: [
        {
          x: categories[corteIdx],
          borderColor: resolveColor('var(--fgr-red-vivid)'),
          strokeDashArray: 4,
          label: {
            text: 'Corte: ' + formatMonthLabel(dataCorte),
            style: { color: '#fff', background: resolveColor('var(--fgr-red-vivid)'), fontSize: '10px', padding: { left: 6, right: 6, top: 2, bottom: 2 } },
          }
        },
        {
          x: categories[fimIdx],
          borderColor: resolveColor('var(--text-soft)'),
          strokeDashArray: 2,
          label: {
            text: 'Fim: ' + formatMonthLabel(dataFim),
            style: { color: '#fff', background: resolveColor('var(--text-soft)'), fontSize: '10px', padding: { left: 6, right: 6, top: 2, bottom: 2 } },
          }
        }
      ]
    },
    tooltip: {
      enabled: true,
      shared: true,
      theme: document.body.classList.contains('dark') ? 'dark' : 'light',
      y: { formatter: val => fmtR$(val) },
    },
    legend: { show: true, position: 'top', fontSize: '12px', labels: { colors: resolveColor('var(--text-medium)') } },
    grid: { borderColor: resolveColor('var(--border)'), strokeDashArray: 3 },
    dataLabels: { enabled: false },
    markers: {
      size: [4, 4],
      strokeWidth: 2,
      strokeColors: '#fff',
      hover: { sizeOffset: 3 },
    },
    responsive: [{ breakpoint: 600, options: { chart: { height: 300 }, legend: { position: 'bottom' } } }],
  };

  renderApexChart('projChart', options);
}

let projSortKey = null;
let projSortDir = 1;
let projExpanded = new Set(); // chaves de grupos/serviços expandidos

// Conta flows que apontam para um insumo (destino ou origem), ignorando cancelados
function flowsPorInsumo(insumo) {
  if (!insumo) return null;
  // Só mostrar flows REFLETIDOS (status === 'sim')
  const refletidos = f => (f.refletido_status || 'pendente') === 'sim';
  const entrada = getFlowsObraAtiva().filter(f => refletidos(f) && f.insumo_planejamento === insumo);
  const saida = getFlowsObraAtiva().filter(f => refletidos(f) && f.insumo_remanejamento === insumo);
  if (!entrada.length && !saida.length) return null;
  const valEntrada = entrada.reduce((s,f) => s + (f.custo_flowmaster||0), 0);
  const valSaida = saida.reduce((s,f) => s + (f.custo_flowmaster||0), 0);
  return {
    total: entrada.length + saida.length,
    entrada: entrada.length, saida: saida.length,
    valEntrada, valSaida,
    refletidos: entrada.length + saida.length, // todos já são refletidos
  };
}

function flowsPorServico(cod_servico) {
  if (!cod_servico) return null;
  // pegar todos os insumos desse serviço a partir do PROJ_RAW
  const insumosSet = new Set(getProjRawObraAtiva().filter(r => r.servico === cod_servico).map(r => r.insumo));
  let totalN = 0, totalE = 0, totalS = 0, valE = 0, valS = 0, refl = 0;
  insumosSet.forEach(ins => {
    const info = flowsPorInsumo(ins);
    if (info) {
      totalN += info.total; totalE += info.entrada; totalS += info.saida;
      valE += info.valEntrada; valS += info.valSaida; refl += info.refletidos;
    }
  });
  if (totalN === 0) return null;
  return { total: totalN, entrada: totalE, saida: totalS, valEntrada: valE, valSaida: valS, refletidos: refl };
}

function flowChip(info) {
  if (!info) return '';
  const liquido = info.valEntrada - info.valSaida;
  const cor = liquido > 0 ? 'var(--sem-erro)' : liquido < 0 ? 'var(--sem-ok)' : 'var(--text-soft)';
  return `<span style="display:inline-block; padding:1px 6px; margin-left:6px; background:#ede9fe; color:#5b21b6; border-radius:10px; font-size:10px; font-weight:600; cursor:help;" title="✅ ${info.total} flow(s) refletidos em planejamento · ${info.entrada} entrada(s) (+${fmt(info.valEntrada)}) · ${info.saida} saída(s) (-${fmt(info.valSaida)})">📎 ${info.total} flow${info.total>1?'s':''} <span style="color:${cor};">${liquido>=0?'+':''}${fmtR$k(liquido)}</span></span>`;
}

function renderProjTable(porGrupo, projServicos, projInsumos, tolerancia) {
  const q = document.getElementById('projSearch').value.toLowerCase();
  const fs = document.getElementById('projFilterStatus').value;
  const fg = document.getElementById('projFilterGrupo').value;

  // mapa de Valor Gestão por (servico|insumo|item_cod) da última gestão fechada do HISTORICO
  // (filtrado pela obra ativa)
  const mapaValorGestao = {};
  let _ultGestaoLabel = null;
  if (HISTORICO && Array.isArray(HISTORICO.gestoes) && Array.isArray(HISTORICO.items)) {
    _ultGestaoLabel = acharUltimaGestaoCronologica(HISTORICO.gestoes);
    if (_ultGestaoLabel) {
      HISTORICO.items
        .filter(it => it.codigo_obra === OBRA_ATIVA)
        .forEach(it => {
          if (!it.insumo) return;
          const chaveComp = (it.servico||'') + '|' + (it.insumo||'') + '|' + (it.item_cod||'');
          mapaValorGestao[chaveComp] = (mapaValorGestao[chaveComp] || 0) + (it[_ultGestaoLabel] || 0);
        });
    }
  }

  const dataCorte = document.getElementById('projDataCorte').value || defaultDataCorte();
  const dataFim = document.getElementById('projDataFim').value || defaultDataFim();
  const janelaMeses = parseInt(document.getElementById('projMetodo').value) || 6;

  const statusBadge = {
    red: '<span class="badge red">🔴 Vai estourar</span>',
    amber: '<span class="badge amber">🟡 Atenção</span>',
    green: '<span class="badge green">🟢 No esperado</span>',
    sobra: '<span class="badge green">💰 Vai sobrar</span>',
    done: '<span class="badge gray">✅ Concluído</span>',
    empty: '<span class="badge gray">— sem valor</span>',
  };

  // Indexar projServicos e projInsumos por chave para lookup rápido
  const idxServ = {};
  projServicos.forEach(p => { idxServ[p.servico] = p; });
  const idxIns = {};
  projInsumos.forEach(p => { idxIns[p.servico + '|' + p.insumo] = p; });

  // Para cada nó da hierarquia, calcular sua projeção (se folha) ou agregar dos filhos
  // Estrutura: percorrer HIERARQUIA em ordem
  // Nós podem ser: raiz | grupo | subgrupo | servico | outro | insumo
  //
  // A "expansão" funciona assim:
  //  - raiz/grupo/subgrupo: tem um expander, mostra filhos diretos quando expandido
  //  - servico (linha header de serviço, sem insumo): mostra os insumos do mesmo cod
  //  - insumo: linha folha
  //
  // Como os "filhos" estão sequenciados no array após o pai, vamos construir uma árvore de visibilidade.

  // Mapa: para cada nó, qual é o "pai visual"?
  // Estratégia: usar uma pilha por nível hierárquico (1..4) E pelo tipo
  // Mais simples: percorrer linearmente e atribuir parent.ordem com base em regras
  const nodes = HIERARQUIA.map(n => ({ ...n, children: [], parent: null }));
  const stack = []; // pilha de candidatos a pai (cada item: {node, "depth"})
  function depthOf(n) {
    // raiz=0, grupo(01.xx)=1, subgrupo(01.xx.xx)=2, servico/outro(01.xx.xx.xx ou nivel 3 ou 4 sem insumo)=3, insumo=4
    if (n.tipo === 'raiz') return 0;
    if (n.tipo === 'grupo') return 1;
    if (n.tipo === 'subgrupo') return 2;
    if (n.tipo === 'servico' || n.tipo === 'outro') return 3;
    if (n.tipo === 'insumo') return 4;
    return n.nivel;
  }
  nodes.forEach((n, i) => {
    const d = depthOf(n);
    // remove tudo da pilha com depth >= d
    while (stack.length && depthOf(stack[stack.length-1]) >= d) stack.pop();
    if (stack.length) {
      n.parent = stack[stack.length-1].ordem;
      stack[stack.length-1].children.push(i);
    }
    stack.push(n);
  });

  // Calcular projeção de cada nó:
  // - Insumo: lookup direto em idxIns
  // - Outros (containers): soma dos descendentes folha (insumos)
  function getInsumoProj(node) {
    // Para o nó insumo: precisamos identificar qual serviço-pai contém esse insumo
    // O serviço-pai é o ancestral com cod_servico preenchido, ou o próprio cod do nó (servico header)
    let cur = node.parent;
    while (cur != null) {
      const p = nodes[cur];
      if (p.cod_servico) {
        const key = p.cod_servico + '|' + node.cod_insumo;
        if (idxIns[key]) return idxIns[key];
        break;
      }
      cur = p.parent;
    }
    return null;
  }

  // Helper: soma de flows PENDENTES (refletido_status = 'pendente') que tocam um insumo
  // Entrada (destino) = positivo · Saída (origem) = negativo
  function flowsPendentesInsumo(cod_insumo) {
    if (!cod_insumo || !Array.isArray(getFlowsObraAtiva())) return 0;
    let total = 0;
    getFlowsObraAtiva().forEach(f => {
      if (f.dep === 'Cancelado') return;
      const status = f.refletido_status || 'pendente';
      if (status !== 'pendente') return;
      const v = f.custo_flowmaster || 0;
      if (Math.abs(v) < 0.01) return;
      if (f.insumo_planejamento === cod_insumo) total += v;
      if (f.insumo_remanejamento === cod_insumo) total -= v;
    });
    return total;
  }

  // Computar agregados (pós-ordem)
  function compute(idx) {
    const n = nodes[idx];
    if (n.tipo === 'insumo') {
      const p = getInsumoProj(n);
      const baseProj = p || {
        realizado: 0, planejado_total: 0, planejado_futuro: 0,
        extrapolacao: 0, tendencia: 0, diff: 0, meses_gap: 0,
        ritmo_historico: 0, ultimo_mes_planejado: null,
        grupo: grupoDoServico(getServicoCod(idx)),
        empty: true,
      };
      // injetar Valor Gestão do HISTORICO por chave composta
      const _servCod = getServicoCod(idx);
      const _chaveVG = (_servCod||'') + '|' + (n.cod_insumo||'') + '|' + (n.cod||'');
      const _vg = mapaValorGestao[_chaveVG] || 0;
      baseProj.valor_gestao = _vg;
      // Adicionar flows pendentes na extrapolação (independente do grupo)
      const flowsPend = flowsPendentesInsumo(n.cod_insumo);
      if (Math.abs(flowsPend) > 0.01) {
        n.proj = {
          ...baseProj,
          valor_gestao: baseProj.valor_gestao || 0,
          extrapolacao: (baseProj.extrapolacao || 0) + flowsPend,
          tendencia: (baseProj.tendencia || baseProj.planejado_total || 0) + flowsPend,
          diff: (baseProj.diff || 0) + flowsPend,
          flows_pendentes: flowsPend,
          empty: false,
        };
      } else {
        n.proj = baseProj;
      }
      n.proj.empty = (n.proj.planejado_total === 0 && n.proj.realizado === 0 && Math.abs(flowsPend) < 0.01 && (n.proj.valor_gestao||0) === 0);
      return n.proj;
    }
    // Container: soma filhos
    const agg = {
      realizado: 0, planejado_total: 0, planejado_futuro: 0,
      extrapolacao: 0, tendencia: 0, diff: 0,
      valor_gestao: 0,
      empty: true,
    };
    n.children.forEach(ci => {
      const sub = compute(ci);
      agg.realizado += sub.realizado || 0;
      agg.planejado_total += sub.planejado_total || 0;
      agg.planejado_futuro += sub.planejado_futuro || 0;
      agg.extrapolacao += sub.extrapolacao || 0;
      agg.tendencia += sub.tendencia || 0;
      agg.diff += sub.diff || 0;
      agg.valor_gestao += sub.valor_gestao || 0;
      if (!sub.empty) agg.empty = false;
    });
    n.proj = agg;
    return agg;
  }
  function getServicoCod(idx) {
    let cur = idx;
    while (cur != null) {
      const p = nodes[cur];
      if (p.cod_servico) return p.cod_servico;
      cur = p.parent;
    }
    return '';
  }
  // Roots = nós sem parent
  nodes.forEach((n, i) => { if (n.parent === null) compute(i); });

  // Determinar visibilidade pelos filtros (q, fs, fg)
  // Um nó é visível se:
  //  - Passar nos filtros próprios OU
  //  - Tiver descendente que passa (para containers)
  function matchesNode(n) {
    const proj = n.proj || {};
    const grupo = proj.grupo || (n.tipo === 'grupo' ? n.item : '');
    // Texto
    if (q) {
      const txt = (n.cod + ' ' + n.item + ' ' + (n.cod_insumo||'') + ' ' + (n.cod_servico||'')).toLowerCase();
      if (!txt.includes(q)) return false;
    }
    // Grupo
    if (fg) {
      // Para nós internos sem proj.grupo, herda do ancestral
      const gNo = nodeGrupo(n);
      if (gNo !== fg) return false;
    }
    // Status
    if (fs) {
      const st = nodeStatus(n);
      if (st !== fs) return false;
    }
    return true;
  }
  function nodeGrupo(n) {
    // grupo direto (cod 01.XX)
    if (n.cod === '01.01') return 'Custos Indiretos';
    if (n.cod === '01.02') return 'Custos Diretos / Infraestrutura';
    if (n.cod === '01.03') return 'Obras Civis';
    if (n.cod === '01.04') return 'Projeção de Gastos';
    // procurar ancestral
    let cur = n.parent;
    while (cur != null) {
      const p = nodes[cur];
      if (p.cod === '01.01') return 'Custos Indiretos';
      if (p.cod === '01.02') return 'Custos Diretos / Infraestrutura';
      if (p.cod === '01.03') return 'Obras Civis';
      if (p.cod === '01.04') return 'Projeção de Gastos';
      if (p.cod_servico) return grupoDoServico(p.cod_servico);
      cur = p.parent;
    }
    return n.proj && n.proj.grupo ? n.proj.grupo : 'Outros';
  }
  function nodeStatus(n) {
    const p = n.proj || {};
    if (p.empty) return 'empty';
    return calcStatus(p.diff || 0, p.planejado_total || 0, tolerancia);
  }
  // Visibilidade recursiva (DFS)
  const visible = new Set();
  function checkVisible(idx) {
    const n = nodes[idx];
    let selfMatch = matchesNode(n);
    let anyChild = false;
    n.children.forEach(ci => { if (checkVisible(ci)) anyChild = true; });
    if (selfMatch || anyChild) { visible.add(idx); return true; }
    return false;
  }
  nodes.forEach((n, i) => { if (n.parent === null) checkVisible(i); });

  // Renderização recursiva — só desce em filhos quando o nó está expandido
  let html = '';
  let count = 0;

  function nodeKey(idx) {
    const n = nodes[idx];
    return n.tipo + ':' + n.ordem;
  }

  function sortedNodeIndexes(indexes) {
    if (!projSortKey) return indexes;
    return [...indexes].sort((leftIndex, rightIndex) => {
      const left = nodes[leftIndex];
      const right = nodes[rightIndex];
      let leftValue;
      let rightValue;
      if (projSortKey === 'label') {
        leftValue = left.item || left.cod || '';
        rightValue = right.item || right.cod || '';
      } else if (projSortKey === 'tendencia') {
        leftValue = (left.proj?.valor_gestao || 0) + (left.proj?.extrapolacao || 0);
        rightValue = (right.proj?.valor_gestao || 0) + (right.proj?.extrapolacao || 0);
      } else {
        leftValue = left.proj?.[projSortKey] ?? 0;
        rightValue = right.proj?.[projSortKey] ?? 0;
      }
      if (typeof leftValue === 'string') return projSortDir * leftValue.localeCompare(rightValue, 'pt-BR');
      return projSortDir * (leftValue - rightValue);
    });
  }

  function renderNode(idx, level) {
    const n = nodes[idx];
    if (!visible.has(idx)) return;
    const p = n.proj || {};
    const key = nodeKey(idx);
    const hasChildren = n.children.filter(ci => visible.has(ci)).length > 0;
    const expanded = projExpanded.has(key);
    const st = nodeStatus(n);
    const indent = level * 18;
    const dV = p.diff || 0;
    const ex = p.extrapolacao || 0;
    const isInsumo = n.tipo === 'insumo';
    const isContainer = !isInsumo;

    // Estilos por tipo
    let trStyle = '', tdStyle = '', icon = '', labelHtml = '';
    if (n.tipo === 'raiz') {
      trStyle = 'background:#0f172a; color:white; cursor:pointer; font-weight:700;';
      icon = expanded ? '▼' : '▶';
      labelHtml = `<strong>${escHtml(n.cod)} · ${escHtml(n.item)}</strong>`;
    } else if (n.tipo === 'grupo') {
      trStyle = 'background:var(--fgr-red-deep); color:white; cursor:pointer; font-weight:700;';
      icon = expanded ? '▼' : '▶';
      labelHtml = `<strong>${escHtml(n.cod)} · ${escHtml(n.item)}</strong>`;
    } else if (n.tipo === 'subgrupo') {
      trStyle = 'background:var(--fgr-red-light); cursor:pointer; font-weight:600; color:var(--fgr-red-deep);';
      icon = expanded ? '▼' : '▶';
      labelHtml = `${escHtml(n.cod)} · ${escHtml(n.item)}`;
    } else if (n.tipo === 'servico' || n.tipo === 'outro') {
      trStyle = 'background:var(--fgr-red-light); cursor:pointer; color:var(--fgr-red-deep);';
      icon = expanded ? '▼' : (hasChildren ? '▶' : '🔍');
      const codeMark = n.cod_servico ? `<strong>${escHtml(n.cod_servico)}</strong> · ` : '';
      const chip = n.cod_servico ? flowChip(flowsPorServico(n.cod_servico)) : '';
      labelHtml = `${codeMark}${escHtml(n.item)}${chip}`;
    } else if (n.tipo === 'insumo') {
      trStyle = p.empty ? 'cursor:pointer; color:var(--text-lighter);' : 'cursor:pointer;';
      icon = '🔍';
      const chip = flowChip(flowsPorInsumo(n.cod_insumo));
      labelHtml = `<span style="color:var(--text-soft);">${escHtml(n.cod_insumo)}</span> · ${escHtml(n.item)}${chip}`;
    }

    // Texto da ação
    const acao = p.empty ? '' :
      (dV > tolerancia ? `<span style="font-size:10.5px; color:var(--sem-erro); font-weight:600;">+${fmtR$k(dV)} a planejar</span>` :
       dV < -tolerancia ? `<span style="font-size:10.5px; color:var(--sem-ok);">sobram ${fmtR$k(-dV)}</span>` : '');

    // Cores adaptadas ao fundo
    const isDark = trStyle.includes('color:white');
    const numColor = isDark ? '' : '';
    const flowsPendVal = p.flows_pendentes || 0;
    let extrapTitle = '';
    if (n.tipo === 'insumo' || n.tipo === 'servico' || n.tipo === 'outro') {
      const parts = [];
      if (p.ultimo_mes_planejado && p.meses_gap > 0) {
        parts.push(`Obra estendida: planejamento original termina em ${formatMonthLabel(p.ultimo_mes_planejado)}, extrapolando ${p.meses_gap} meses`);
      }
      if (Math.abs(flowsPendVal) > 0.01) {
        parts.push(`Flows pendentes (ainda não refletidos): ${flowsPendVal>=0?'+':''}${fmt(flowsPendVal)}`);
      }
      extrapTitle = parts.join(' · ') || 'Sem extrapolação';
    }
    const extrapTxt = (Math.abs(ex) > 0.01)
      ? (n.tipo === 'insumo' || n.tipo === 'servico' || n.tipo === 'outro'
          ? `<span style="font-size:10px; color:${ex<0?'var(--sem-ok)':'var(--sem-alerta)'};" title="${escAttr(extrapTitle)}">${ex>=0?'+':''}${fmt(ex)}${Math.abs(flowsPendVal)>0.01?' 📎':''}</span>`
          : `<span style="color:${isDark?'#fbbf24':(ex<0?'var(--sem-ok)':'var(--sem-alerta)')};">${ex>=0?'+':''}${fmt(ex)}</span>`)
      : `<span style="color:${isDark?'rgba(255,255,255,0.5)':'var(--text-lighter)'};">—</span>`;

    const diffTxt = p.empty ? '<span style="color:var(--border-strong);">—</span>' :
      `<span style="color:${dV>tolerancia?(isDark?'#fca5a5':'var(--sem-erro)'):dV<-tolerancia?(isDark?'#86efac':'var(--sem-ok)'):''};">${dV>=0?'+':''}${fmt(dV)}</span>`;

    const valuesEmpty = p.empty;
    const fmtVal = v => valuesEmpty ? '<span style="color:var(--border-strong);">—</span>' : fmtR$(v||0);

    // A ação fica em data attributes para não misturar dados importados com JavaScript inline.
    let actionAttrs;
    if (hasChildren) {
      actionAttrs = `data-proj-action="expand" data-proj-key="${escAttr(key)}" tabindex="0" aria-expanded="${expanded}" aria-label="${expanded ? 'Recolher' : 'Expandir'} ${escAttr(n.item || n.cod)}"`;
    } else if (n.tipo === 'insumo') {
      const servicoCod = getServicoCod(idx);
      actionAttrs = `data-proj-action="drill" data-servico-cod="${escAttr(servicoCod)}" data-insumo-cod="${escAttr(n.cod_insumo)}" tabindex="0" aria-label="Abrir detalhes de ${escAttr(n.item || n.cod_insumo)}"`;
    } else if (n.cod_servico) {
      actionAttrs = `data-proj-action="drill" data-servico-cod="${escAttr(n.cod_servico)}" tabindex="0" aria-label="Abrir detalhes de ${escAttr(n.item || n.cod_servico)}"`;
    } else {
      actionAttrs = '';
    }

    // Tendência exibida = Valor Gestão + Extrapolação (consistente com o que a tabela mostra)
    const _vg = p.valor_gestao || 0;
    const _tendUI = _vg + (p.extrapolacao || 0);
    const vgEmpty = valuesEmpty && _vg === 0;

    html += `<tr style="${trStyle}" ${actionAttrs}>
      <td style="width:24px; padding-left:${4+indent}px;">${icon}</td>
      <td style="padding-left:${10+indent}px;">${labelHtml}</td>
      <td class="num">${vgEmpty ? '<span style="color:var(--border-strong);">—</span>' : fmtR$(_vg)}</td>
      <td class="num">${fmtVal(p.realizado)}</td>
      <td class="num">${extrapTxt}</td>
      <td class="num">${(vgEmpty && Math.abs(p.extrapolacao||0)<0.01) ? '<span style="color:var(--border-strong);">—</span>' : '<strong>'+fmtR$(_tendUI)+'</strong>'}</td>
      <td>${statusBadge[st]||''} ${acao}</td>
    </tr>`;
    count++;

    if (expanded) {
      sortedNodeIndexes(n.children).forEach(ci => {
        const nextLevel = level + 1;
        renderNode(ci, nextLevel);
      });
    }
  }

  // Render todos os roots
  sortedNodeIndexes(nodes.map((n, i) => n.parent === null ? i : null).filter(i => i != null))
    .forEach(i => renderNode(i, 0));

  document.getElementById('projTbody').innerHTML = html;
  document.getElementById('projCount').textContent = `${count} linhas`;
  updateSortHeaderState('th[data-sort-proj]', 'data-sort-proj', projSortKey, projSortDir);
}

function activateProjectionRow(event) {
  if (!isTableRowActivation(event)) return;
  const row = event.target.closest('tr[data-proj-action]');
  if (!row) return;
  if (event.target !== row && event.target.closest('button, input, select, textarea, a')) return;
  if (event.type === 'keydown') event.preventDefault();
  if (row.dataset.projAction === 'expand') {
    toggleProjExpand(row.dataset.projKey || '');
    return;
  }
  if (row.dataset.projAction === 'drill') {
    openProjDrill(row.dataset.servicoCod || '', row.dataset.insumoCod || undefined);
  }
}

document.getElementById('projTbody')?.addEventListener('click', activateProjectionRow);
document.getElementById('projTbody')?.addEventListener('keydown', activateProjectionRow);

function toggleProjExpand(key) {
  if (projExpanded.has(key)) projExpanded.delete(key);
  else projExpanded.add(key);
  renderProjecao();
}

function projExpandAll() {
  // Expandir todos os nós que tenham filhos
  if (typeof HIERARQUIA === 'undefined' || !HIERARQUIA) return;
  HIERARQUIA.forEach(n => {
    // Só vale a pena expandir containers
    if (n.tipo !== 'insumo') {
      projExpanded.add(n.tipo + ':' + n.ordem);
    }
  });
  renderProjecao();
}

function projCollapseAll() {
  projExpanded.clear();
  renderProjecao();
}

// Exporta a Projeção Detalhada COMPLETA (hierarquia toda expandida, sem filtros) em Excel
async function exportarProjecaoDetalhada() {
  try {
    const _proj = (typeof getProjRawObraAtiva === 'function') ? getProjRawObraAtiva() : PROJ_RAW;
    if (!_proj || !_proj.length) {
      authToast('⚠️ Não há dados de Projeção para exportar. Carregue o CSV de Gestões primeiro.', 'warn', 5000);
      return;
    }
    await ensureXlsx();
    const dataCorte = document.getElementById('projDataCorte').value || defaultDataCorte();
    const dataFim = document.getElementById('projDataFim').value || defaultDataFim();
    const janelaMeses = parseInt(document.getElementById('projMetodo').value) || 6;
    const tolerancia = parseFloat(document.getElementById('projTolerancia').value) || 50000;

    // Re-executa o pipeline pra pegar projServicos e projInsumos SEM depender do render (não muda estado)
    // Reagrupa PROJ_RAW por (servico, insumo, mes)
    const byServMes = {};
    const byServInsMes = {};
    _proj.forEach(r => {
      byServMes[r.servico] = byServMes[r.servico] || {};
      byServMes[r.servico][r.mes] = (byServMes[r.servico][r.mes] || 0) + r.valor;
      const k = r.servico + '|' + r.insumo;
      byServInsMes[k] = byServInsMes[k] || { servico: r.servico, insumo: r.insumo, meses: {} };
      byServInsMes[k].meses[r.mes] = (byServInsMes[k].meses[r.mes] || 0) + r.valor;
    });
    const projServicos = Object.entries(byServMes).map(([servico, meses]) =>
      projetarServico(servico, meses, dataCorte, dataFim, janelaMeses)
    );
    const projInsumos = Object.values(byServInsMes).map(x => {
      const p = projetarServico(x.servico, x.meses, dataCorte, dataFim, janelaMeses);
      return { ...p, insumo: x.insumo };
    });
    const idxServ = {}; projServicos.forEach(p => idxServ[p.servico] = p);
    const idxIns = {}; projInsumos.forEach(p => idxIns[p.servico + '|' + p.insumo] = p);

    // Mapa Valor Gestão (mesma lógica da render)
    const mapaValorGestao = {};
    let ultGestao = null;
    if (HISTORICO && Array.isArray(HISTORICO.gestoes) && Array.isArray(HISTORICO.items)) {
      ultGestao = acharUltimaGestaoCronologica(HISTORICO.gestoes);
      if (ultGestao) {
        HISTORICO.items.filter(it => it.codigo_obra === OBRA_ATIVA).forEach(it => {
          if (!it.insumo) return;
          const k = (it.servico||'') + '|' + (it.insumo||'') + '|' + (it.item_cod||'');
          mapaValorGestao[k] = (mapaValorGestao[k] || 0) + (it[ultGestao] || 0);
        });
      }
    }

    // Flows pendentes por insumo (mesma lógica)
    function flowsPendInsumo(cod_insumo) {
      if (!cod_insumo || !Array.isArray(getFlowsObraAtiva())) return 0;
      let total = 0;
      getFlowsObraAtiva().forEach(f => {
        if (f.dep === 'Cancelado') return;
        const status = f.refletido_status || 'pendente';
        if (status !== 'pendente') return;
        const v = f.custo_flowmaster || 0;
        if (Math.abs(v) < 0.01) return;
        if (f.insumo_planejamento === cod_insumo) total += v;
        if (f.insumo_remanejamento === cod_insumo) total -= v;
      });
      return total;
    }

    // Percorrer HIERARQUIA e montar linhas
    const nodes = HIERARQUIA.map(n => ({ ...n, children: [], parent: null }));
    const stack = [];
    function depthOf(n) {
      if (n.tipo === 'raiz') return 0;
      if (n.tipo === 'grupo') return 1;
      if (n.tipo === 'subgrupo') return 2;
      if (n.tipo === 'servico' || n.tipo === 'outro') return 3;
      if (n.tipo === 'insumo') return 4;
      return n.nivel;
    }
    nodes.forEach((n) => {
      const d = depthOf(n);
      while (stack.length && depthOf(stack[stack.length-1]) >= d) stack.pop();
      if (stack.length) { n.parent = stack[stack.length-1].ordem; stack[stack.length-1].children.push(n.ordem); }
      stack.push(n);
    });
    function getServicoCod(ordem) {
      let cur = ordem;
      while (cur != null) {
        const pn = nodes[cur];
        if (pn.cod_servico) return pn.cod_servico;
        cur = pn.parent;
      }
      return '';
    }

    function computeNode(idx) {
      const n = nodes[idx];
      if (n.tipo === 'insumo') {
        // Buscar serviço pai
        let cur = n.parent, servCod = '';
        while (cur != null) {
          const pn = nodes[cur];
          if (pn.cod_servico) { servCod = pn.cod_servico; break; }
          cur = pn.parent;
        }
        const proj = idxIns[servCod + '|' + n.cod_insumo] || {
          realizado: 0, planejado_total: 0, planejado_futuro: 0, extrapolacao: 0, tendencia: 0, diff: 0,
          ritmo_historico: 0, ultimo_mes_planejado: null, meses_gap: 0,
          grupo: grupoDoServico(servCod),
        };
        const fp = flowsPendInsumo(n.cod_insumo);
        const vg = mapaValorGestao[(servCod||'') + '|' + (n.cod_insumo||'') + '|' + (n.cod||'')] || 0;
        n.proj = {
          ...proj,
          valor_gestao: vg,
          flows_pendentes: fp,
          extrapolacao: (proj.extrapolacao||0) + fp,
          tendencia: (proj.planejado_total||0) + (proj.extrapolacao||0) + fp,
        };
        n.proj.empty = (n.proj.planejado_total === 0 && n.proj.realizado === 0 && vg === 0 && Math.abs(fp) < 0.01);
        return n.proj;
      }
      const agg = { realizado:0, planejado_total:0, planejado_futuro:0, extrapolacao:0, tendencia:0, diff:0, valor_gestao:0, flows_pendentes:0, empty:true };
      n.children.forEach(ci => {
        const sub = computeNode(ci);
        agg.realizado += sub.realizado || 0;
        agg.planejado_total += sub.planejado_total || 0;
        agg.planejado_futuro += sub.planejado_futuro || 0;
        agg.extrapolacao += sub.extrapolacao || 0;
        agg.tendencia += sub.tendencia || 0;
        agg.valor_gestao += sub.valor_gestao || 0;
        agg.flows_pendentes += sub.flows_pendentes || 0;
        if (!sub.empty) agg.empty = false;
      });
      n.proj = agg;
      return agg;
    }
    nodes.forEach(n => { if (n.parent === null) computeNode(n.ordem); });

    // Grupo do nó (mesma lógica do render)
    function nodeGrupo(n) {
      if (n.cod === '01.01') return 'Custos Indiretos';
      if (n.cod === '01.02') return 'Custos Diretos / Infraestrutura';
      if (n.cod === '01.03') return 'Obras Civis';
      if (n.cod === '01.04') return 'Projeção de Gastos';
      let cur = n.parent;
      while (cur != null) {
        const pn = nodes[cur];
        if (pn.cod === '01.01') return 'Custos Indiretos';
        if (pn.cod === '01.02') return 'Custos Diretos / Infraestrutura';
        if (pn.cod === '01.03') return 'Obras Civis';
        if (pn.cod === '01.04') return 'Projeção de Gastos';
        if (pn.cod_servico) return grupoDoServico(pn.cod_servico);
        cur = pn.parent;
      }
      return (n.proj && n.proj.grupo) || 'Outros';
    }
    function statusLabel(n) {
      const p = n.proj || {};
      if (p.empty) return 'Sem valor';
      const st = calcStatus(p.diff || 0, p.planejado_total || 0, tolerancia);
      return ({ red: 'Vai estourar', amber: 'Atenção', green: 'No esperado', sobra: 'Vai sobrar' })[st] || st;
    }

    // Nível (indentação por prefixo)
    function nivelDe(n) {
      if (n.tipo === 'raiz') return 0;
      if (n.tipo === 'grupo') return 1;
      if (n.tipo === 'subgrupo') return 2;
      if (n.tipo === 'servico' || n.tipo === 'outro') return 3;
      if (n.tipo === 'insumo') return 4;
      return 0;
    }

    // Montar linhas em ordem hierárquica (percurso pré-ordem)
    const linhas = [];
    function walk(idx) {
      const n = nodes[idx];
      const p = n.proj || {};
      const grupo = nodeGrupo(n);
      const nivel = nivelDe(n);
      const prefixo = '  '.repeat(nivel);
      let label = '';
      if (n.tipo === 'insumo') label = `${n.cod_insumo || ''} · ${n.item || ''}`;
      else if (n.cod_servico) label = `${n.cod_servico} · ${n.item || ''}`;
      else label = `${n.cod || ''} · ${n.item || ''}`;
      const tendUI = (p.valor_gestao || 0) + (p.extrapolacao || 0);
      linhas.push({
        'Nível': nivel,
        'Tipo': n.tipo,
        'Código': n.cod || '',
        'Cod. Serviço': n.cod_servico || '',
        'Cod. Insumo': n.cod_insumo || '',
        'Grupo': grupo,
        'Descrição': prefixo + label,
        'Valor Gestão (R$)': Math.round((p.valor_gestao || 0) * 100) / 100,
        'Realizado (R$)': Math.round((p.realizado || 0) * 100) / 100,
        'Planejado Total (R$)': Math.round((p.planejado_total || 0) * 100) / 100,
        'Planejado Futuro (R$)': Math.round((p.planejado_futuro || 0) * 100) / 100,
        'Extrapolação (R$)': Math.round((p.extrapolacao || 0) * 100) / 100,
        'Flows Pendentes (R$)': Math.round((p.flows_pendentes || 0) * 100) / 100,
        'Tendência (R$)': Math.round(tendUI * 100) / 100,
        'Δ vs Planejado (R$)': Math.round(((p.diff || 0)) * 100) / 100,
        'Ritmo Histórico (R$/mês)': Math.round((p.ritmo_historico || 0) * 100) / 100,
        'Último Mês Planejado': p.ultimo_mes_planejado || '',
        'Meses Gap': p.meses_gap || 0,
        'Status': statusLabel(n),
      });
      n.children.forEach(ci => walk(ci));
    }
    nodes.forEach(n => { if (n.parent === null) walk(n.ordem); });

    // Aba de metadados
    const meta = [
      { 'Campo': 'Obra', 'Valor': OBRA_ATIVA || '' },
      { 'Campo': 'Última gestão (Valor Gestão)', 'Valor': ultGestao || '' },
      { 'Campo': 'Data de corte', 'Valor': dataCorte },
      { 'Campo': 'Data fim', 'Valor': dataFim },
      { 'Campo': 'Janela ritmo histórico (meses)', 'Valor': janelaMeses },
      { 'Campo': 'Tolerância (R$)', 'Valor': tolerancia },
      { 'Campo': 'Exportado em', 'Valor': new Date().toLocaleString('pt-BR') },
    ];

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(linhas);
    // Ajustar largura das colunas
    ws1['!cols'] = [
      {wch:6},{wch:10},{wch:14},{wch:12},{wch:12},{wch:28},{wch:60},
      {wch:16},{wch:16},{wch:18},{wch:18},{wch:16},{wch:18},{wch:16},{wch:18},{wch:20},{wch:18},{wch:10},{wch:16},
    ];
    // aplicar format code Excel nas colunas numéricas monetárias
    // Colunas H..P (índices 7..15) = Valor Gestão, Realizado, Planejado Total, Planejado Futuro,
    //   Extrapolação, Flows Pendentes, Tendência, Δ vs Planejado, Ritmo Histórico
    const FMT_NUM = '#,##0.00;-#,##0.00;"-"';  // SheetJS interpreta e converte pro locale do Excel do usuário
    const range1 = XLSX.utils.decode_range(ws1['!ref']);
    for (let R = range1.s.r + 1; R <= range1.e.r; R++) { // pula header
      for (let C = 7; C <= 15; C++) {
        const cellRef = XLSX.utils.encode_cell({r: R, c: C});
        const cell = ws1[cellRef];
        if (cell && typeof cell.v === 'number') {
          cell.t = 'n';
          cell.z = FMT_NUM;
        }
      }
    }
    XLSX.utils.book_append_sheet(wb, ws1, 'Projeção Detalhada');
    const ws2 = XLSX.utils.json_to_sheet(meta);
    ws2['!cols'] = [{wch:32},{wch:40}];
    XLSX.utils.book_append_sheet(wb, ws2, 'Metadados');

    const nomeArq = `projecao-detalhada_${OBRA_ATIVA || 'obra'}_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, nomeArq);
    console.log('[EXPORT] Projeção Detalhada exportada:', nomeArq, `(${linhas.length} linhas)`);
  } catch (e) {
    console.error('[EXPORT] erro:', e);
    authToast('❌ Erro ao exportar: ' + (e.message || e), 'err', 5000);
  }
}

function openProjDrill(servico, insumo) {
  const dataCorte = document.getElementById('projDataCorte').value || defaultDataCorte();
  const dataFim = document.getElementById('projDataFim').value || defaultDataFim();
  const janelaMeses = parseInt(document.getElementById('projMetodo').value) || 6;

  // Pegar meses
  let meses = {};
  let titulo, subtitulo;
  if (insumo) {
    getProjRawObraAtiva().filter(r => r.servico === servico && r.insumo === insumo)
      .forEach(r => { meses[r.mes] = (meses[r.mes]||0) + r.valor; });
    titulo = `${servico} · ${insumo}`;
    subtitulo = descInsumo(insumo);
  } else {
    getProjRawObraAtiva().filter(r => r.servico === servico)
      .forEach(r => { meses[r.mes] = (meses[r.mes]||0) + r.valor; });
    titulo = servico;
    subtitulo = descServico(servico);
  }
  const proj = projetarServico(servico, meses, dataCorte, dataFim, janelaMeses);

  // Construir dados para ApexCharts
  const todosMeses = Object.keys(meses).sort();
  let extended = [...todosMeses];
  if (dataFim > (todosMeses[todosMeses.length-1] || dataFim)) {
    let m = todosMeses[todosMeses.length-1];
    while (m && m < dataFim) { m = addMonths(m, 1); extended.push(m); }
  }

  let acumP = 0, acumT = 0;
  const extrapPorMes = {};
  if (proj.extrapolacao > 0 && proj.ultimo_mes_planejado && proj.meses_gap > 0) {
    const perMonth = proj.extrapolacao / proj.meses_gap;
    let m = proj.ultimo_mes_planejado;
    for (let i = 0; i < proj.meses_gap; i++) { m = addMonths(m, 1); extrapPorMes[m] = perMonth; }
  }
  const planAcum = extended.map(m => { acumP += (meses[m] || 0); return { mes: m, valor: acumP }; });
  const tendAcum = extended.map(m => { acumT += (meses[m] || 0) + (extrapPorMes[m] || 0); return { mes: m, valor: acumT }; });

  const categories = extended.map(m => formatMonthLabel(m));
  const planData = planAcum.map(p => p.valor);
  const tendData = tendAcum.map(p => p.valor);

  const findIdx = m => { let i = 0; for (let j = 0; j < extended.length; j++) if (extended[j] <= m) i = j; return i; };
  const corteIdx = findIdx(dataCorte);
  const fimIdx = findIdx(dataFim);

  document.getElementById('modalContent').innerHTML = `
    <h2>🔮 Projeção · ${escHtml(titulo)}</h2>
    <div class="meta">${escHtml(subtitulo)} · Grupo: <strong>${escHtml(proj.grupo)}</strong> ${grupoExtrapola(proj.grupo)?'<span class="badge purple">extrapola</span>':'<span class="badge gray">não extrapola</span>'}</div>
    <div class="kpis kpi-2col" style="margin-bottom:14px;">
      <div class="kpi kpi-wide">
        <div class="label">📊 Planejado vs Realizado</div>
        <div class="value">${fmtR$(proj.planejado_total)}</div>
        <div class="sub">Planejado Total · até ${proj.ultimo_mes_planejado ? formatMonthLabel(proj.ultimo_mes_planejado) : '-'}</div>
        <hr class="border-top-soft" style="margin:10px 0;">
        <div>
          <div class="section-label">Realizado (até ${formatMonthLabel(dataCorte)})</div>
          <div class="kpi-value-md" style="margin-top:4px;">${fmtR$(proj.realizado)}</div>
        </div>
      </div>
      <div class="kpi kpi-wide ${proj.diff>0?'red':proj.diff<0?'green':''}">
        <div class="label">🔮 Extrapolação</div>
        <div class="value">${proj.extrapolacao>0?'+'+fmtR$(proj.extrapolacao):'—'}</div>
        <div class="sub">${proj.meses_gap>0?`${proj.meses_gap} meses × R$${fmt(proj.ritmo_historico,0)}/m`:'sem gap'}</div>
        <hr class="border-top-soft" style="margin:10px 0;">
        <div>
          <div class="section-label">Tendência Final</div>
          <div class="kpi-value-md" style="margin-top:4px;">${fmtR$(proj.tendencia)}</div>
          <div class="sub">Δ ${proj.diff>=0?'+':''}${fmtR$(proj.diff)}</div>
        </div>
      </div>
    </div>
    <h3 style="font-size:13px; margin-bottom:8px;">📈 Curva S individual</h3>
    <div id="modalProjChart" style="height:300px;"></div>
    ${renderFlowsRefletidosSection(servico, insumo)}
    ${renderMovimentacoesProjecaoSection(servico, insumo)}
  `;

  // Renderizar ApexCharts no modal
  const modalChartOptions = {
    series: [
      { name: 'Planejado acumulado', type: 'area', data: planData },
      { name: 'Tendência projetada', type: 'line', data: tendData },
    ],
    chart: {
      height: 300,
      animations: { enabled: true, easing: 'easeinout', speed: 600 },
      toolbar: { show: false },
    },
    colors: [resolveColor('var(--fgr-red-deep)'), resolveColor('var(--sem-alerta)')],
    stroke: { curve: 'smooth', width: [2.5, 2.5] },
    fill: { type: ['gradient', 'solid'], gradient: { shadeIntensity: 1, opacityFrom: 0.15, opacityTo: 0.02, stops: [0, 100] } },
    xaxis: { categories: categories, labels: { rotate: -45, rotateAlways: true, style: { fontSize: '10px' } } },
    yaxis: { labels: { formatter: val => fmtR$k(val), style: { fontSize: '10px' } } },
    annotations: {
      xaxis: [
        { x: categories[corteIdx], borderColor: resolveColor('var(--fgr-red-vivid)'), strokeDashArray: 4,
          label: { text: 'Corte', style: { color: '#fff', background: resolveColor('var(--fgr-red-vivid)'), fontSize: '10px', padding: { left: 6, right: 6, top: 2, bottom: 2 } } } },
        { x: categories[fimIdx], borderColor: resolveColor('var(--text-soft)'), strokeDashArray: 2,
          label: { text: 'Fim', orientation: 'vertical', position: 'bottom', offsetY: -10,
            style: { color: '#fff', background: resolveColor('var(--text-soft)'), fontSize: '10px', padding: { left: 6, right: 6, top: 2, bottom: 2 } } } },
      ]
    },
    tooltip: { enabled: true, shared: true, theme: document.body.classList.contains('dark') ? 'dark' : 'light', y: { formatter: val => fmtR$(val) } },
    legend: { show: true, position: 'top', fontSize: '11px', labels: { colors: resolveColor('var(--text-medium)') } },
    grid: { borderColor: resolveColor('var(--border)'), strokeDashArray: 3 },
    dataLabels: { enabled: false },
    markers: { size: [4, 4], strokeWidth: 2, strokeColors: '#fff', hover: { sizeOffset: 3 } },
  };

  // Renderizar após o innerHTML estar no DOM
  setTimeout(() => renderApexChart('modalProjChart', modalChartOptions), 50);
  openModal();
}

// Renderiza a seção "Movimentações de Projeção" no modal de drill-down da Tendência
function renderMovimentacoesProjecaoSection(servico, insumo) {
  // Só faz sentido se houver insumo (linhas folha) - para serviço é mais complicado
  const insumoControlado = PROJ_CTRL_STATE.insumo || 'I011890';
  // Para insumo específico: mostrar movimentações que tocaram esse insumo (vindas da Projeção)
  // Para serviço: agregar dos insumos do serviço
  let alvos = [];
  if (insumo) {
    alvos = [insumo];
  } else if (servico) {
    alvos = [...new Set(getProjRawObraAtiva().filter(r => r.servico === servico).map(r => r.insumo))];
  }
  if (!alvos.length) return '';
  // Excluir o próprio insumo controlado da lista de "outros impactados"
  alvos = alvos.filter(a => a !== insumoControlado);
  if (!alvos.length) return '';

  // Movimentações manuais (não-flow) que tocam algum desses alvos
  const movsManuais = (PROJ_CTRL_STATE.movimentacoes || []).filter(m => {
    return alvos.includes(m.origem) || alvos.includes(m.destino);
  });

  if (!movsManuais.length) {
    return `
      <div style="margin-top:16px; padding:12px; background:var(--bg-page); border-radius:8px; text-align:center; color:var(--text-lighter); font-size:11.5px;">
        💰 Nenhuma movimentação manual da Verba de Projeção (${escHtml(insumoControlado)}) registrada para este ${insumo ? 'insumo' : 'serviço'}.<br>
        <span style="font-size:10.5px;">Use a aba "📦 Controle Projeção" para registrar remanejamentos básicos, aportes ou devoluções fora de aditivos.</span>
      </div>
    `;
  }

  const tipoBadge = {
    aditivo: '<span class="badge blue">🔵 Aditivo</span>',
    remanejamento: '<span class="badge purple">🟣 Remanejamento</span>',
    aporte: '<span class="badge green">🟢 Aporte</span>',
    devolucao: '<span class="badge amber">🟠 Devolução</span>',
  };

  const totEntrada = movsManuais.filter(m => alvos.includes(m.destino)).reduce((s,m) => s + (m.valor||0), 0);
  const totSaida = movsManuais.filter(m => alvos.includes(m.origem)).reduce((s,m) => s + (m.valor||0), 0);
  const liquido = totEntrada - totSaida;

  // Ordenar por data desc
  movsManuais.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  const cards = movsManuais.map(m => {
    const ehEntrada = alvos.includes(m.destino);
    const dirColor = ehEntrada ? 'var(--sem-erro)' : 'var(--sem-ok)';
    const dirIcon = ehEntrada ? '➡️ entrada' : '⬅️ saída';
    const insumoAlvo = ehEntrada ? m.destino : m.origem;
    const valor = m.valor || 0;
    return `
      <div style="background:var(--bg-page); border-left:3px solid ${dirColor}; border-radius:6px; padding:10px 12px; margin-bottom:8px; font-size:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; gap:8px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <strong>${escHtml(m.id)}</strong>
            ${tipoBadge[m.tipo]||m.tipo}
            <span style="font-size:10.5px; color:var(--text-soft);">${escHtml(m.data_br||m.data||'')}</span>
            <span style="font-size:10.5px; color:${dirColor}; font-weight:700;">${dirIcon}</span>
            <span style="font-size:10.5px; color:var(--text-soft);"> · insumo ${escHtml(insumoAlvo)}</span>
            ${!insumo ? '' : ''}
          </div>
          <span style="font-weight:700; color:${ehEntrada?'var(--sem-erro)':'var(--sem-ok)'}; font-size:13px;">${ehEntrada?'+':'-'}${fmtR$(valor)}</span>
        </div>
        <div style="color:var(--text-medium); font-size:11.5px;">${escHtml(m.descricao||'')}</div>
        ${m.justificativa ? `<div style="color:var(--text-soft); font-size:10.5px; margin-top:3px;"><em>Justificativa:</em> ${escHtml(m.justificativa.slice(0,180))}${m.justificativa.length>180?'...':''}</div>` : ''}
        ${m.responsavel ? `<div style="color:var(--text-soft); font-size:10.5px; margin-top:2px;">Responsável: ${escHtml(m.responsavel)}</div>` : ''}
      </div>
    `;
  }).join('');

  return `
    <div style="margin-top:20px;">
      <h3 style="font-size:13px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
        💰 Movimentações da Verba de Projeção ${escHtml(insumoControlado)} <span style="font-size:11px; color:var(--text-soft); font-weight:400;">${movsManuais.length} movimentação(ões) manual(is)</span>
      </h3>
      <div style="background:var(--sem-alerta-bg); padding:10px 12px; border-radius:6px; margin-bottom:12px; font-size:12px; color:var(--sem-alerta); display:flex; gap:18px; flex-wrap:wrap;">
        <span><strong>${movsManuais.filter(m => alvos.includes(m.destino)).length}</strong> entrada(s): <strong style="color:var(--sem-erro);">+${fmtR$(totEntrada)}</strong></span>
        <span><strong>${movsManuais.filter(m => alvos.includes(m.origem)).length}</strong> saída(s): <strong style="color:var(--sem-ok);">-${fmtR$(totSaida)}</strong></span>
        <span>Líquido: <strong style="color:${liquido<0?'var(--sem-ok)':'var(--sem-erro)'};">${liquido>=0?'+':''}${fmtR$(liquido)}</strong></span>
      </div>
      ${cards}
    </div>
  `;
}

// Renderiza a seção "Flows Refletidos" dentro do modal de drill-down
function renderFlowsRefletidosSection(servico, insumo) {
  // Pega flows REFLETIDOS (status === 'sim') E PENDENTES (status === 'pendente') que apontam para este servico/insumo
  const statusOf = f => f.refletido_status || 'pendente';
  const isRefl = f => statusOf(f) === 'sim';
  const isPend = f => statusOf(f) === 'pendente';

  function coletarFlows(filtroStatus) {
    if (insumo) {
      return getFlowsObraAtiva().filter(f => filtroStatus(f) && f.dep !== 'Cancelado' && (f.insumo_planejamento === insumo || f.insumo_remanejamento === insumo))
                   .map(f => ({ ...f, _direcao: f.insumo_planejamento === insumo ? 'entrada' : 'saida' }));
    } else {
      const insumosSet = new Set(getProjRawObraAtiva().filter(r => r.servico === servico).map(r => r.insumo));
      return getFlowsObraAtiva().filter(f => filtroStatus(f) && f.dep !== 'Cancelado' && (insumosSet.has(f.insumo_planejamento) || insumosSet.has(f.insumo_remanejamento)))
                   .map(f => {
                     const ehEntrada = insumosSet.has(f.insumo_planejamento);
                     return { ...f, _direcao: ehEntrada ? 'entrada' : 'saida', _insumoAlvo: ehEntrada ? f.insumo_planejamento : f.insumo_remanejamento };
                   });
    }
  }

  const flowsRel = coletarFlows(isRefl);
  const flowsPend = coletarFlows(isPend);

  if (!flowsRel.length && !flowsPend.length) {
    return `
      <div style="margin-top:20px; padding:14px; background:var(--bg-page); border-radius:8px; text-align:center; color:var(--text-lighter); font-size:12px;">
        📎 Nenhum flow (refletido ou pendente) para este ${insumo ? 'insumo' : 'serviço'}.<br>
        <span style="font-size:11px;">Vá na aba "🔗 Flows / Aditivos" para classificar aditivos.</span>
      </div>
    `;
  }

  // Ordenar por data desc
  const ordenar = arr => arr.sort((a, b) => {
    const da = a.data || ''; const db = b.data || '';
    return db.localeCompare(da);
  });
  ordenar(flowsRel);
  ordenar(flowsPend);

  const depBadge = {Finalizado:'green', Projeto:'amber', Cancelado:'gray', Planejamento:'blue', Orçamento:'blue', Obra:'amber'};
  const tipoLabel = {
    aumento_real:'<span class="badge red">🔴 Aum.real</span>',
    remanejamento:'<span class="badge cyan">🔵 Remanej.</span>',
    economia:'<span class="badge green">🟢 Economia</span>',
    pendente:'<span class="badge amber">🟡 Pendente</span>',
    cancelado:'<span class="badge gray">🚫 Cancelado</span>',
    sem_classificacao:'<span class="badge gray">⚪ Sem class.</span>', 
    misto:'<span class="badge gray">⚪ Misto</span>',
  };

  function renderCard(f) {
    const dir = f._direcao;
    const dirIcon = dir === 'entrada' ? '➡️ entrada' : '⬅️ saída';
    const dirColor = dir === 'entrada' ? 'var(--sem-erro)' : 'var(--sem-ok)';
    const valor = f.custo_flowmaster || 0;
    const insAlvoTxt = f._insumoAlvo ? `<span style="font-size:10.5px; color:var(--text-soft);"> · insumo ${escHtml(f._insumoAlvo)}</span>` : '';
    return `
      <div style="background:var(--bg-page); border-left:3px solid ${dirColor}; border-radius:6px; padding:10px 12px; margin-bottom:8px; font-size:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; gap:8px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <strong>Nº ${escHtml(f.n_alteracao)}</strong>
            ${f.is_manual ? '<span class="badge-manual">✋ Manual</span>' : ''}
            <span class="badge ${depBadge[f.dep]||'gray'}">${escHtml(f.dep||'')}</span>
            ${tipoLabel[f.tipo]||''}
            <span style="font-size:10.5px; color:var(--text-soft);">${escHtml(formatDate(f.data_br))}</span>
            <span style="font-size:10.5px; color:${dirColor}; font-weight:700;">${dirIcon}</span>
            ${insAlvoTxt}
          </div>
          <span style="font-weight:700; color:${valor<0?'var(--sem-ok)':'var(--sem-erro)'}; font-size:13px;">${valor>=0?'+':''}${fmtR$(valor)}</span>
        </div>
        <div style="color:var(--text-medium); font-size:11.5px;"><strong>${escHtml(f.motivo||'')}</strong></div>
        <div style="color:var(--text-soft); font-size:11px; margin-top:3px;">${escHtml((f.descricao||'').slice(0,220))}${(f.descricao||'').length>220?'...':''}</div>
        ${f.justificativa ? `<div style="color:var(--text-soft); font-size:10.5px; margin-top:3px;"><em>Justificativa:</em> ${escHtml(f.justificativa.slice(0,180))}${f.justificativa.length>180?'...':''}</div>` : ''}
      </div>
    `;
  }

  function renderSecao(titulo, lista, corFundo, corTexto) {
    if (!lista.length) return '';
    const totE = lista.filter(f => f._direcao === 'entrada').reduce((s,f) => s + (f.custo_flowmaster||0), 0);
    const totS = lista.filter(f => f._direcao === 'saida').reduce((s,f) => s + (f.custo_flowmaster||0), 0);
    const liq = totE - totS;
    return `
      <div style="margin-top:20px;">
        <h3 style="font-size:13px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
          ${titulo} <span style="font-size:11px; color:var(--text-soft); font-weight:400;">${lista.length} aditivo(s)</span>
        </h3>
        <div style="background:${corFundo}; padding:10px 12px; border-radius:6px; margin-bottom:12px; font-size:12px; color:${corTexto}; display:flex; gap:18px; flex-wrap:wrap;">
          <span><strong>${lista.filter(f => f._direcao === 'entrada').length}</strong> entrada(s): <strong style="color:var(--sem-erro);">+${fmtR$(totE)}</strong></span>
          <span><strong>${lista.filter(f => f._direcao === 'saida').length}</strong> saída(s): <strong style="color:var(--sem-ok);">-${fmtR$(totS)}</strong></span>
          <span>Líquido: <strong style="color:${liq<0?'var(--sem-ok)':'var(--sem-erro)'};">${liq>=0?'+':''}${fmtR$(liq)}</strong></span>
        </div>
        ${lista.map(renderCard).join('')}
      </div>
    `;
  }

  return `
    ${renderSecao('✅ Flows refletidos no planejamento', flowsRel, '#ede9fe', '#5b21b6')}
    ${renderSecao('⏳ Flows pendentes (ainda não refletidos) — entram como extrapolação', flowsPend, 'var(--sem-alerta-bg)', 'var(--sem-alerta)')}
  `;
}

// Recarregar ao mudar parâmetros
document.addEventListener('DOMContentLoaded', () => {
  // já é chamado no boot
});
['projDataFim','projDataCorte','projMetodo','projTolerancia','projSearch','projFilterStatus','projFilterGrupo'].forEach(id => {
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) {
      // Função handler: re-renderiza projeção E visão geral (e controle projeção)
      const handler = () => {
        try { renderProjecao(); } catch(e) { reportNonFatalError('Projeção/renderizar após filtro', e); }
        // Os 4 primeiros (parâmetros) afetam também a Visão Geral (Card 3) e a Tendência de Obra
        // Os 3 últimos (search/filtros) só afetam a tabela da própria aba
        if (['projDataFim','projDataCorte','projMetodo','projTolerancia'].includes(id)) {
          try { renderVisao(); } catch(e) { reportNonFatalError('Visão geral/renderizar após projeção', e); }
        }
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    }
  }, 0);
});
bindSortableHeaders(
  'th[data-sort-proj]',
  'data-sort-proj',
  () => ({ key: projSortKey, direction: projSortDir }),
  k => {
    if (projSortKey === k) projSortDir = -projSortDir;
    else { projSortKey = k; projSortDir = k === 'label' ? 1 : -1; }
    updateSortHeaderState('th[data-sort-proj]', 'data-sort-proj', projSortKey, projSortDir);
    renderProjecao();
  }
);

// ============ CONTROLE PROJEÇÃO ============
// (declarado em CONFIG no topo)
let PROJ_CTRL_STATE = {
  saldo_inicial: null,
  data_ref: null,
  insumo: 'I011890',
  movimentacoes: [], // movimentações manuais (não-flow)
  locks: { saldo: false, data: false, insumo: false }, // v0.60.5
};

function loadProjCtrl() {
  // SUBSTITUI todo o estado (não mescla) — evita resíduo de obra anterior
  try {
    const raw = localStorage.getItem(PROJ_CTRL_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        PROJ_CTRL_STATE = {
          saldo_inicial: obj.saldo_inicial ?? null,
          data_ref: obj.data_ref || null,
          insumo: obj.insumo || 'I011890',
          movimentacoes: Array.isArray(obj.movimentacoes) ? obj.movimentacoes : [],
          locks: (obj.locks && typeof obj.locks === 'object')
            ? { saldo: !!obj.locks.saldo, data: !!obj.locks.data, insumo: !!obj.locks.insumo }
            : { saldo: false, data: false, insumo: false },
        };
        return;
      }
    }
    // Nenhum dado no localStorage — reset pro default
    PROJ_CTRL_STATE = {
      saldo_inicial: null,
      data_ref: null,
      insumo: 'I011890',
      movimentacoes: [],
      locks: { saldo: false, data: false, insumo: false },
    };
  } catch (e) { console.warn('Erro ao ler controle projeção:', e); }
}

function saveProjCtrl() {
  if (!isEditorDaObraAtiva()) return false;
  SafeStorage.set(PROJ_CTRL_KEY, JSON.stringify(PROJ_CTRL_STATE));
  // Sync config
  void runAsyncSafely(supaSaveProjConfig({
    insumo: PROJ_CTRL_STATE.insumo,
    saldo_inicial: PROJ_CTRL_STATE.saldo_inicial,
    data_ref: PROJ_CTRL_STATE.data_ref,
    locks: PROJ_CTRL_STATE.locks || { saldo: false, data: false, insumo: false },
  }), 'Projeção/sincronizar configuração', 'A configuração da projeção foi salva apenas neste navegador.');
  // Sync movimentações manuais (upsert todas — idempotente)
  if (SUPA && Array.isArray(PROJ_CTRL_STATE.movimentacoes)) {
    void runAsyncSafely(
      Promise.all(PROJ_CTRL_STATE.movimentacoes.map(m => supaUpsertMov(m))),
      'Projeção/sincronizar movimentações',
      'As movimentações foram salvas apenas neste navegador.'
    );
  }
}

function nextMovId() {
  let max = 0;
  PROJ_CTRL_STATE.movimentacoes.forEach(m => {
    const mt = String(m.id||'').match(/^MOV(\d+)$/);
    if (mt) max = Math.max(max, parseInt(mt[1]));
  });
  return 'MOV' + String(max + 1).padStart(3, '0');
}

let _projCtrlListenersAttached = false;

// v0.60.5 — aplica o estado dos cadeados aos inputs e botões da UI
function applyLocksToUI() {
  const map = [
    { key: 'saldo',  inputId: 'projCtrlSaldoInicial', btnId: 'lockBtnSaldo'  },
    { key: 'data',   inputId: 'projCtrlDataRef',      btnId: 'lockBtnData'   },
    { key: 'insumo', inputId: 'projCtrlInsumo',       btnId: 'lockBtnInsumo' },
  ];
  const locks = (PROJ_CTRL_STATE && PROJ_CTRL_STATE.locks) || { saldo:false, data:false, insumo:false };
  const canEdit = isEditorDaObraAtiva();
  map.forEach(m => {
    const inp = document.getElementById(m.inputId);
    const btn = document.getElementById(m.btnId);
    const trancado = !!locks[m.key];
    if (inp) {
      inp.readOnly = trancado || !canEdit;
      inp.disabled = !canEdit;
      inp.style.background = (trancado || !canEdit) ? 'var(--bg-soft)' : '';
      inp.style.color = (trancado || !canEdit) ? 'var(--text-soft)' : '';
      inp.style.cursor = (trancado || !canEdit) ? 'not-allowed' : '';
    }
    if (btn) {
      btn.textContent = trancado ? '🔒' : '🔓';
      btn.title = trancado ? 'Trancado — clique para destravar' : 'Destravado — clique para trancar';
      btn.style.background = trancado ? 'var(--sem-alerta-bg)' : 'white';
      btn.style.borderColor = trancado ? 'var(--sem-alerta)' : 'var(--border-strong)';
    }
  });
}

// v0.60.5 — alterna o cadeado de um campo (saldo | data | insumo)
function toggleLockCampo(campo) {
  if (!requireEditorForActiveProject('alterar os bloqueios da projeção')) return;
  if (!PROJ_CTRL_STATE.locks) PROJ_CTRL_STATE.locks = { saldo:false, data:false, insumo:false };
  PROJ_CTRL_STATE.locks[campo] = !PROJ_CTRL_STATE.locks[campo];
  applyLocksToUI();
  saveProjCtrl();
}

function initProjCtrl() {
  try {
    loadProjCtrl();
    const elSaldo = document.getElementById('projCtrlSaldoInicial');
    const elDataRef = document.getElementById('projCtrlDataRef');
    const elIns = document.getElementById('projCtrlInsumo');

    // Preencher campos com valores salvos
    if (elSaldo) {
      if (PROJ_CTRL_STATE.saldo_inicial != null) {
        elSaldo.value = fmt(PROJ_CTRL_STATE.saldo_inicial);
      } else {
        elSaldo.value = '';
      }
    }
    if (elDataRef && PROJ_CTRL_STATE.data_ref) elDataRef.value = PROJ_CTRL_STATE.data_ref;
    if (elIns) elIns.value = PROJ_CTRL_STATE.insumo || 'I011890';
    // v0.60.5 — aplicar estado dos cadeados aos 3 campos
    applyLocksToUI();

    // Anexar listeners SÓ UMA VEZ (idempotente)
    if (!_projCtrlListenersAttached) {
      if (elSaldo) {
        // Salvar enquanto digita (sem reformatar caractere a caractere, evita perder cursor)
        elSaldo.addEventListener('input', () => {
          const parsed = parseNumero(elSaldo.value);
          PROJ_CTRL_STATE.saldo_inicial = parsed;
          saveProjCtrl();
          renderProjCtrl();
        });
        // Formatar ao sair do campo
        elSaldo.addEventListener('blur', () => {
          const parsed = parseNumero(elSaldo.value);
          if (parsed != null) {
            elSaldo.value = fmt(parsed);
            PROJ_CTRL_STATE.saldo_inicial = parsed;
            saveProjCtrl();
            renderProjCtrl();
          } else {
            elSaldo.value = '';
            PROJ_CTRL_STATE.saldo_inicial = null;
            saveProjCtrl();
            renderProjCtrl();
          }
        });
      }
      if (elDataRef) {
        elDataRef.addEventListener('change', () => {
          PROJ_CTRL_STATE.data_ref = elDataRef.value;
          saveProjCtrl();
          renderProjCtrl();
        });
      }
      if (elIns) {
        elIns.addEventListener('change', () => {
          PROJ_CTRL_STATE.insumo = elIns.value.trim() || 'I011890';
          saveProjCtrl();
          renderProjCtrl();
        });
      }
      // Listeners dos filtros da tabela de movimentações (com debounce)
      const debouncedProjCtrl = debounce(renderProjCtrl, 300);
      ['movSearch','movFilterTipo','movFilterDirecao'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('input', debouncedProjCtrl);
          el.addEventListener('change', debouncedProjCtrl);
        }
      });
      _projCtrlListenersAttached = true;
    }
    renderProjCtrl();
  } catch (e) {
    console.error('Erro em initProjCtrl:', e);
  }
}

// Reúne movimentações (manuais + flows refletidos que tocam o insumo)
function getAllMovimentacoes() {
  const insumo = (PROJ_CTRL_STATE.insumo || 'I011890').trim();
  const out = [];

  // Saldo inicial como pseudo-movimentação
  if (PROJ_CTRL_STATE.saldo_inicial != null && PROJ_CTRL_STATE.saldo_inicial !== 0) {
    out.push({
      id: '__INICIAL__',
      tipo: 'aporte',
      data: PROJ_CTRL_STATE.data_ref || '2024-01',
      data_br: PROJ_CTRL_STATE.data_ref ? PROJ_CTRL_STATE.data_ref.split('-').reverse().join('/') : '01/2024',
      origem: 'Saldo inicial',
      destino: insumo,
      descricao: 'Saldo inicial da verba',
      justificativa: '',
      responsavel: '',
      valor: PROJ_CTRL_STATE.saldo_inicial,
      direcao: 'entrada',
      origem_dado: 'inicial',
      bloqueada: true,
    });
  }

  // Flows refletidos que tocam o insumo
  getFlowsObraAtiva().filter(f => (f.refletido_status || 'pendente') === 'sim').forEach(f => {
    let direcao = null;
    if (f.insumo_planejamento === insumo) direcao = 'entrada';
    else if (f.insumo_remanejamento === insumo) direcao = 'saida';
    if (!direcao) return;
    out.push({
      id: 'FLOW' + f.n_alteracao,
      tipo: 'aditivo',
      data: f.data || '',
      data_br: formatDate(f.data_br),
      origem: f.insumo_remanejamento || '',
      destino: f.insumo_planejamento || '',
      descricao: f.descricao || '',
      justificativa: f.justificativa || '',
      responsavel: f.solicitante || '',
      valor: f.custo_flowmaster || 0,
      direcao,
      origem_dado: 'flow',
      flow_n: f.n_alteracao,
      bloqueada: true,
    });
  });

  // Movimentações manuais
  PROJ_CTRL_STATE.movimentacoes.forEach(m => {
    let direcao;
    if (m.destino === insumo) direcao = 'entrada';
    else if (m.origem === insumo) direcao = 'saida';
    else direcao = 'entrada'; // fallback
    out.push({
      ...m,
      direcao,
      origem_dado: 'manual',
      bloqueada: false,
    });
  });

  // Ordenar por data ASC (para calcular saldo cumulativo)
  out.sort((a, b) => {
    const da = (a.data || a.data_br || '');
    const db = (b.data || b.data_br || '');
    // tentar parsear data_br para iso
    const toIso = s => {
      if (!s) return '';
      if (s.match(/^\d{4}-\d{2}/)) return s;
      const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      const m2 = s.match(/(\d{2})\/(\d{4})/);
      if (m2) return `${m2[2]}-${m2[1]}-01`;
      return s;
    };
    return toIso(da).localeCompare(toIso(db));
  });

  return out;
}

function renderProjCtrl() {
  const movs = getAllMovimentacoes();

  // Calcula KPIs
  const totalEntradas = movs.filter(m => m.direcao === 'entrada').reduce((s,m) => s + (m.valor||0), 0);
  const totalSaidas = movs.filter(m => m.direcao === 'saida').reduce((s,m) => s + (m.valor||0), 0);
  const saldoAtual = totalEntradas - totalSaidas;
  const pctConsumido = totalEntradas > 0 ? (totalSaidas / totalEntradas * 100) : 0;
  const numFlows = movs.filter(m => m.origem_dado === 'flow').length;
  const numManuais = movs.filter(m => m.origem_dado === 'manual').length;

  // ===== CONFERÊNCIA COM SISTEMA (TENDÊNCIA) =====
  // Busca o valor atual do insumo controlado na aba TENDÊNCIA
  const insumoCtrl = (PROJ_CTRL_STATE.insumo || 'I011890').trim();
  let valorSistema = null;
  if (Array.isArray(DATA_T)) {
    // Soma de todos os insumos da Tendência que casam com o cod_insumo (geralmente 1 único)
    valorSistema = DATA_T.filter(t => t.is_folha && t.cod_insumo === insumoCtrl)
                         .reduce((s, t) => s + (t.gestao || 0), 0);
    if (valorSistema === 0) valorSistema = null; // não encontrado
  }
  const TOL_CONF = CONFIG.tolerancia_conferencia; // tolerância em R$
  let confDiff = null, confStatus = 'na';
  if (valorSistema != null) {
    confDiff = valorSistema - saldoAtual;
    if (Math.abs(confDiff) <= TOL_CONF) confStatus = 'ok';
    else confStatus = 'divergente';
  }

  const saldoCls = saldoAtual > 0 ? 'green' : saldoAtual < 0 ? 'red' : '';
  const confCls = confStatus === 'ok' ? 'green' : confStatus === 'divergente' ? 'red' : '';

  document.getElementById('projCtrlKpis').innerHTML = `
    <div class="kpi ${confCls}"><div class="label">🔍 Valor no Sistema</div><div class="value">${valorSistema != null ? fmtR$(valorSistema) : '—'}</div><div class="sub">${valorSistema != null ? `Tendência · insumo ${escHtml(insumoCtrl)}` : 'insumo não encontrado na Tendência'}</div></div>
    <div class="kpi ${saldoCls} kpi-wide"><div class="label">📊 Saldo Controlado</div><div class="value">${fmtR$(saldoAtual)}</div>
      <div style="margin-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; padding:2px 0; font-size:11.5px;">
          <span style="color:var(--sem-ok);">⬆️ Entradas (aportes)</span>
          <strong style="color:var(--sem-ok);">+${fmt(totalEntradas)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:baseline; padding:2px 0; font-size:11.5px;">
          <span style="color:var(--sem-erro);">⬇️ Saídas (verba utilizada)</span>
          <strong style="color:var(--sem-erro);">−${fmt(totalSaidas)}</strong>
        </div>
      </div>
    </div>
    <div class="kpi ${confCls}"><div class="label">${confStatus === 'ok' ? '✅ Conferido' : confStatus === 'divergente' ? '⚠️ Não identificado' : '— Conferência'}</div><div class="value">${confDiff != null ? (Math.abs(confDiff) <= TOL_CONF ? 'OK' : (confDiff>=0?'+':'') + fmtR$(confDiff)) : '—'}</div><div class="sub">${confStatus === 'ok' ? 'tudo confere' : confStatus === 'divergente' ? 'sistema − controlado' : 'sem comparação possível'}</div></div>
  `;

  // ===== BANNER de conferência (com a equação) =====
  const elBanner = document.getElementById('projCtrlConfBanner');
  if (elBanner) {
    if (valorSistema == null) {
      elBanner.innerHTML = `
        <div style="padding:10px 14px; background:var(--sem-alerta-bg); border-left:4px solid var(--sem-alerta); border-radius:6px; font-size:12.5px; color:var(--sem-alerta);">
          ⚠️ <strong>Insumo controlado (${escHtml(insumoCtrl)}) não foi encontrado na aba TENDÊNCIA.</strong> Verifique se está correto no campo "Insumo controlado" acima.
        </div>`;
    } else if (confStatus === 'ok') {
      elBanner.innerHTML = `
        <div style="padding:10px 14px; background:#d1fae5; border-left:4px solid var(--sem-ok); border-radius:6px; font-size:12.5px; color:var(--sem-ok);">
          ✅ <strong>Conferido!</strong> Saldo controlado (${fmtR$(saldoAtual)}) = Valor no sistema (${fmtR$(valorSistema)}). Diferença: ${fmtR$(confDiff)} (dentro da tolerância de R$ ${TOL_CONF.toFixed(2)}).
        </div>`;
    } else {
      const sinal = confDiff >= 0 ? 'a mais' : 'a menos';
      elBanner.innerHTML = `
        <div style="padding:10px 14px; background:var(--fgr-red-light); border-left:4px solid var(--fgr-red-vivid); border-radius:6px; font-size:12.5px; color:var(--sem-erro);">
          ⚠️ <strong>Divergência identificada:</strong> existem ${fmtR$(Math.abs(confDiff))} ${sinal} no sistema do que o controlado.
          <div style="margin-top:6px; font-size:11.5px; color:#7f1d1d; display:flex; gap:18px; flex-wrap:wrap;">
            <span>📊 Saldo controlado: <strong>${fmtR$(saldoAtual)}</strong></span>
            <span>🔍 Valor no sistema (Tendência): <strong>${fmtR$(valorSistema)}</strong></span>
            <span>❓ Não identificado: <strong>${confDiff>=0?'+':''}${fmtR$(confDiff)}</strong></span>
          </div>
          <div style="margin-top:6px; font-size:11px; color:#7f1d1d;">
            💡 Isso significa que há movimentações no sistema (Tendência) que ainda não foram registradas neste controle. Adicione uma movimentação manual ou ajuste o saldo inicial.
          </div>
        </div>`;
    }
  }

  renderProjCtrlChart(movs);
  renderMovTable(movs, saldoAtual);
}

function renderProjCtrlChart(movs) {
  if (!movs.length) {
    document.getElementById('projCtrlChart').innerHTML = '<div style="text-align:center; color:var(--text-lighter); padding:80px 20px; font-size:13px;">Nenhuma movimentação ainda.<br>Defina o saldo inicial ou clique em "➕ Nova movimentação" para começar.</div>';
    return;
  }

  // Saldo cumulativo ao longo do tempo
  let saldo = 0;
  const pontos = movs.map(m => {
    saldo += (m.direcao === 'entrada' ? 1 : -1) * (m.valor || 0);
    const isoData = m.data || (() => {
      const mm = (m.data_br||'').match(/(\d{2})\/(\d{2})\/(\d{4})/);
      return mm ? `${mm[3]}-${mm[2]}-${mm[1]}` : '';
    })();
    return { data: isoData, saldo, mov: m };
  });

  const categories = pontos.map(p => p.data ? p.data.slice(0, 7) : '');
  const seriesData = pontos.map(p => p.saldo);
  const dotColors = pontos.map(p => p.mov.direcao === 'entrada' ? resolveColor('var(--sem-ok)') : resolveColor('var(--fgr-red-vivid)'));

  const options = {
    series: [{ name: 'Saldo acumulado', data: seriesData }],
    chart: {
      type: 'area',
      height: 300,
      animations: { enabled: true, easing: 'easeinout', speed: 800 },
      toolbar: { show: true, tools: { download: true, selection: true, zoom: true, pan: true, reset: true } },
      zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
    },
    colors: ['#7c3aed'],
    stroke: { curve: 'smooth', width: 2.5 },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.25, opacityTo: 0.02, stops: [0, 100] },
    },
    xaxis: {
      categories: categories,
      labels: { rotate: -45, rotateAlways: true, style: { fontSize: '10px' } },
    },
    yaxis: {
      labels: { formatter: val => fmtR$k(val), style: { fontSize: '10px' } },
    },
    annotations: {
      yaxis: [{
        y: 0,
        borderColor: resolveColor('var(--text-lighter)'),
        strokeDashArray: 4,
        label: { text: 'Zero', style: { color: resolveColor('var(--text-soft)'), fontSize: '10px' } },
      }]
    },
    tooltip: {
      enabled: true,
      shared: false,
      theme: document.body.classList.contains('dark') ? 'dark' : 'light',
      custom: function({ series, seriesIndex, dataPointIndex, w }) {
        const p = pontos[dataPointIndex];
        const m = p.mov;
        const dirLabel = m.direcao === 'entrada' ? 'Entrada' : 'Saída';
        const valorFmt = (m.direcao === 'entrada' ? '+' : '-') + fmtR$(m.valor);
        const dataFmt = m.data_br || p.data;
        let html = '<div style="padding:8px 12px; font-size:12px;">';
        html += '<strong>' + escHtml(m.tipo || dirLabel) + '</strong><br>';
        html += '<span style="color:var(--text-soft);">Data:</span> ' + escHtml(dataFmt) + '<br>';
        html += '<span style="color:var(--text-soft);">Direção:</span> ' + escHtml(dirLabel) + '<br>';
        html += '<span style="color:var(--text-soft);">Valor:</span> <strong>' + valorFmt + '</strong><br>';
        html += '<span style="color:var(--text-soft);">Saldo:</span> <strong>' + fmtR$(p.saldo) + '</strong>';
        if (m.descricao) html += '<br><span style="color:var(--text-soft); font-size:11px;">' + escHtml(m.descricao.slice(0, 80)) + '</span>';
        html += '</div>';
        return html;
      }
    },
    legend: { show: true, position: 'top', fontSize: '12px', labels: { colors: resolveColor('var(--text-medium)') } },
    grid: { borderColor: resolveColor('var(--border)'), strokeDashArray: 3 },
    dataLabels: { enabled: false },
    markers: {
      size: 5,
      strokeWidth: 2,
      strokeColors: '#fff',
      colors: dotColors,
      hover: { sizeOffset: 3 },
    },
  };

  renderApexChart('projCtrlChart', options);
}

function renderMovTable(movs, saldoFinal) {
  const q = (document.getElementById('movSearch')?.value || '').toLowerCase();
  const ft = document.getElementById('movFilterTipo')?.value || '';
  const fd = document.getElementById('movFilterDirecao')?.value || '';

  // Calcula saldos cumulativos na ordem cronológica completa
  // (movs já vem ordenado ASC por getAllMovimentacoes, e o saldo_inicial é a 1ª pseudo-movimentação)
  let saldoAcum = 0;
  const movsWithSaldo = movs.map(m => {
    saldoAcum += (m.direcao === 'entrada' ? 1 : -1) * (m.valor || 0);
    return { ...m, _saldo: saldoAcum };
  });

  // Aplicar filtros após calcular saldo
  const filtered = movsWithSaldo.filter(m => {
    if (q) {
      const txt = `${m.descricao||''} ${m.justificativa||''} ${m.origem||''} ${m.destino||''} ${m.responsavel||''}`.toLowerCase();
      if (!txt.includes(q)) return false;
    }
    if (ft && m.tipo !== ft) return false;
    if (fd && m.direcao !== fd) return false;
    return true;
  });

  // Ordenar exibição: mais recente primeiro (não altera saldoAcum, que usa ordem cronológica)
  filtered.sort((a, b) => {
    const da = a.data || a.data_br || '';
    const db = b.data || b.data_br || '';
    return db.localeCompare(da);
  });
  const historyPage = paginateRows(
    'history',
    filtered,
    JSON.stringify([q, compare, onlyChanged, OBRA_ATIVA, gestoes]),
  );

  const tipoBadge = {
    aditivo: '<span class="badge blue">🔵 Aditivo</span>',
    remanejamento: '<span class="badge purple">🟣 Remanejamento</span>',
    aporte: '<span class="badge green">🟢 Aporte</span>',
    devolucao: '<span class="badge amber">🟠 Devolução</span>',
  };

  document.getElementById('movTbody').innerHTML = filtered.map(m => {
    const dirIcon = m.direcao === 'entrada' ? '<span style="color:var(--sem-ok); font-size:16px;" title="Entrada (recebeu verba)">⬅️</span>' : '<span style="color:var(--sem-erro); font-size:16px;" title="Saída (liberou verba)">➡️</span>';
    const valCls = m.direcao === 'entrada' ? 'pos' : 'neg';
    const valSign = m.direcao === 'entrada' ? '+' : '-';

    // Chips para origem do dado
    let chips = '';
    if (m.origem_dado === 'flow') {
      chips = `<span style="display:inline-block; padding:1px 6px; margin-left:6px; background:var(--fgr-red-light); color:var(--fgr-red); border-radius:10px; font-size:10px; font-weight:600; cursor:help;" title="Importado do Flow #${escAttr(m.flow_n||'')}. Para alterar, vá na aba 🔗 Flows.">🔗 Flow #${escHtml(m.flow_n||'')}</span>`;
    } else if (m.origem_dado === 'inicial') {
      chips = `<span style="display:inline-block; padding:1px 6px; margin-left:6px; background:var(--sem-alerta-bg); color:var(--sem-alerta); border-radius:10px; font-size:10px; font-weight:600;">💰 Saldo inicial</span>`;
    } else if (m.origem_dado === 'manual') {
      chips = `<span style="display:inline-block; margin-left:6px;">
        <button data-editor-only data-action="edit-mov" data-id="${escAttr(m.id)}" style="padding:2px 6px; border:1px solid var(--fgr-red-light); background:var(--fgr-red-light); color:var(--fgr-red-dark); border-radius:4px; font-size:10px; font-weight:600; cursor:pointer; margin-right:3px;" title="Editar">✏️ Editar</button>
        <button data-editor-only data-action="delete-mov" data-id="${escAttr(m.id)}" style="padding:2px 6px; border:1px solid #fecaca; background:var(--fgr-red-light); color:var(--sem-erro); border-radius:4px; font-size:10px; font-weight:600; cursor:pointer;" title="Excluir">🗑️ Excluir</button>
      </span>`;
    }

    const trStyle = m.origem_dado === 'flow' ? 'background:#fafbff;' : m.origem_dado === 'inicial' ? 'background:#fef9c3;' : '';
    return `<tr style="${trStyle}">
      <td style="font-size:11.5px; color:var(--text-soft);">${escHtml(m.data_br || m.data || '')}</td>
      <td>${tipoBadge[m.tipo] || escHtml(m.tipo)}</td>
      <td style="text-align:center;">${dirIcon}</td>
      <td style="font-size:11.5px;">${escHtml(m.origem || '—')}</td>
      <td style="font-size:11.5px;">${escHtml(m.destino || '—')}</td>
      <td style="font-size:11.5px;">
        <div style="display:flex; align-items:center; flex-wrap:wrap; gap:2px;">
          <strong>${escHtml((m.descricao||'').slice(0,80))}${(m.descricao||'').length>80?'...':''}</strong>
          ${chips}
        </div>
        ${m.justificativa ? `<div style="color:var(--text-soft); font-size:10.5px; margin-top:2px;">${escHtml(m.justificativa.slice(0,80))}${m.justificativa.length>80?'...':''}</div>` : ''}
      </td>
      <td style="font-size:11px;">${escHtml(m.responsavel || '—')}</td>
      <td class="num ${valCls}"><strong>${valSign}${fmt(m.valor||0)}</strong></td>
      <td class="num"><span style="color:${m._saldo<0?'var(--sem-erro)':'var(--sem-ok)'}; font-weight:600;">${fmt(m._saldo)}</span></td>
    </tr>`;
  }).join('');

  document.getElementById('movCount').textContent = `${filtered.length} de ${movs.length} mov. · Saldo final: ${fmtR$(saldoFinal)}`;
}

// Event delegation para botões da tabela de movimentações
document.getElementById('movTbody')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  e.stopPropagation();
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (action === 'edit-mov') editMov(id);
  else if (action === 'delete-mov') deleteMov(id);
});

function clearMovFilters() {
  ['movSearch','movFilterTipo','movFilterDirecao'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderProjCtrl();
}

// (Listeners dos filtros agora ficam em initProjCtrl)

// Formulário de nova/editar movimentação
function openMovForm(editingId) {
  if (!requireEditor('adicionar/editar movimentação')) return;
  const m = editingId ? PROJ_CTRL_STATE.movimentacoes.find(x => x.id === editingId) : null;
  const today = new Date().toLocaleDateString('pt-BR');
  const insumo = PROJ_CTRL_STATE.insumo || 'I011890';
  const tipos = [
    { v: 'remanejamento', l: '🟣 Remanejamento básico' },
    { v: 'aporte', l: '🟢 Aporte' },
    { v: 'devolucao', l: '🟠 Devolução' },
    { v: 'aditivo', l: '🔵 Aditivo (manual, sem passar por Flow)' },
  ];
  const tipoOpts = tipos.map(t => `<option value="${t.v}" ${m && m.tipo === t.v ? 'selected' : ''}>${t.l}</option>`).join('');

  document.getElementById('modalContent').innerHTML = `
    <form data-modal-form="movement">
    <h2>${m ? '✏️ Editar movimentação' : '➕ Nova movimentação'}</h2>
    <div class="meta">Insumo controlado: <strong>${escHtml(insumo)}</strong></div>
    <div class="form-grid">
      <div>
      <label for="mov_tipo">Tipo</label>
        <select id="mov_tipo">${tipoOpts}</select>
      </div>
      <div>
      <label for="mov_data">Data (mm/aaaa ou dd/mm/aaaa)</label>
        <input type="text" id="mov_data" value="${escAttr(m ? m.data_br : today)}" placeholder="${today}">
      </div>
      <div>
      <label for="mov_origem">Origem (insumo de onde saiu)</label>
        <input type="text" id="mov_origem" list="insumosDatalist" value="${escAttr(m ? displayForValue(m.origem || '') : insumo)}" placeholder="ex: I011890">
      </div>
      <div>
      <label for="mov_destino">Destino (insumo de para onde foi)</label>
        <input type="text" id="mov_destino" list="insumosDatalist" value="${escAttr(m ? displayForValue(m.destino || '') : '')}" placeholder="ex: I013249">
      </div>
      <div class="full">
      <label for="mov_desc">Descrição</label>
        <input type="text" id="mov_desc" required value="${escAttr(m ? m.descricao : '')}" placeholder="ex: Remanejamento para drenagem rede 2">
      </div>
      <div>
      <label for="mov_resp">Responsável</label>
        <input type="text" id="mov_resp" value="${escAttr(m ? m.responsavel : '')}" placeholder="seu nome ou área">
      </div>
      <div>
      <label for="mov_valor">Valor (R$)</label>
        <input type="text" id="mov_valor" required value="${m && m.valor != null ? fmt(m.valor) : ''}" placeholder="ex: 12.500,00">
      </div>
      <div class="full">
      <label for="mov_just">Justificativa (opcional)</label>
        <textarea id="mov_just" placeholder="contexto, links de projeto, número do CTR, etc.">${escHtml(m ? (m.justificativa||'') : '')}</textarea>
      </div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn-sm" data-click-action="closeModal">Cancelar</button>
      <button type="submit" class="btn-sm primary" data-action="save-mov" data-id="${escAttr(editingId||'')}">💾 Salvar</button>
    </div>
    <div style="margin-top:10px; padding:8px 12px; background:var(--sem-alerta-bg); border-radius:6px; font-size:11px; color:var(--sem-alerta);">
      💡 A direção (entrada/saída) é calculada automaticamente: se o insumo controlado (${escHtml(insumo)}) aparecer no campo <strong>Destino</strong>, é uma entrada. Se aparecer em <strong>Origem</strong>, é uma saída.
    </div>
    </form>
  `;
  openModal({ initialFocus: '#mov_tipo' });
}

async function saveMovForm(editingId) {
  if (!requireEditorForActiveProject('salvar movimentações')) return;
  const get = id => document.getElementById(id).value.trim();
  const tipo = get('mov_tipo');
  const data = get('mov_data');
  const origem = valueFromDisplay(get('mov_origem'));
  const destino = valueFromDisplay(get('mov_destino'));
  const desc = get('mov_desc');
  const resp = get('mov_resp');
  const valor = parseNumero(get('mov_valor'));
  const just = get('mov_just');

  if (!desc) { authToast('⚠️ Descrição é obrigatória.', 'warn', 3000); return; }
  if (valor == null || valor === 0) { authToast('⚠️ Valor é obrigatório (e diferente de zero).', 'warn', 3000); return; }
  if (!origem && !destino) { authToast('⚠️ Informe pelo menos Origem ou Destino.', 'warn', 3000); return; }

  const insumo = PROJ_CTRL_STATE.insumo || 'I011890';
  if (origem !== insumo && destino !== insumo) {
    const confirmed = await confirmModal('Insumo controlado não encontrado', 'Nem Origem (' + origem + ') nem Destino (' + destino + ') é o insumo controlado (' + insumo + ').\nSalvar mesmo assim?', { confirmText: 'Salvar', destructive: false });
    if (!confirmed) return;
  }

  // tentar converter data dd/mm/aaaa em ISO
  let iso = '';
  let dataBr = data;
  const mDt = data.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (mDt) iso = `${mDt[3]}-${mDt[2]}-${mDt[1]}`;
  else {
    const m2 = data.match(/(\d{2})\/(\d{4})/);
    if (m2) { iso = `${m2[2]}-${m2[1]}-01`; dataBr = `01/${m2[1]}/${m2[2]}`; }
  }

  const obj = {
    id: editingId || nextMovId(),
    tipo,
    data: iso,
    data_br: dataBr,
    origem,
    destino,
    descricao: desc,
    justificativa: just,
    responsavel: resp,
    valor,
  };

  const idx = PROJ_CTRL_STATE.movimentacoes.findIndex(x => x.id === obj.id);
  if (idx >= 0) PROJ_CTRL_STATE.movimentacoes[idx] = obj;
  else PROJ_CTRL_STATE.movimentacoes.push(obj);

  saveProjCtrl();
  closeModal();
  renderProjCtrl();
}

function editMov(id) {
  if (!requireEditor('editar movimentação')) return;
  openMovForm(id);
}

async function deleteMov(id) {
  if (!requireEditor('excluir movimentação')) return;
  const confirmed = await confirmModal('Excluir movimentação?', 'Excluir esta movimentação?\nEssa ação não pode ser desfeita.', { confirmText: 'Excluir', destructive: true });
  if (!confirmed) return;
  PROJ_CTRL_STATE.movimentacoes = PROJ_CTRL_STATE.movimentacoes.filter(m => m.id !== id);
  saveProjCtrl();
  void runAsyncSafely(supaDeleteMov(id), 'Projeção/excluir movimentação no Supabase', 'A movimentação foi removida apenas neste navegador.');
  renderProjCtrl();
}

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
const CENT_TOLERANCE = CONFIG.tolerancia_centavos; // R$ 1,00
const isFlat = (delta) => Math.abs(delta) < CENT_TOLERANCE;

// HISTORICO declarado na seção ESTADO GLOBAL acima

// v0.58b: helpers de filtragem por obra ativa
// HISTORICO e PROJ_RAW são globais (todas as obras), filtramos em memória ao renderizar.
// getHistoricoObraAtiva, getProjRawObraAtiva, getFlowsObraAtiva agora são aliases
// para filtrarPorObraAtiva (definidos no início do script)

function renderHistorico() {
  // v0.58b: filtra pela obra ativa
  const HIST_OBRA = getHistoricoObraAtiva();
  // guard com placeholder amigável
  if (!HIST_OBRA || !HIST_OBRA.items || !HIST_OBRA.items.length) {
    const kpisEl = document.getElementById('histKpis');
    const chartEl = document.getElementById('histChart');
    const heatEl = document.getElementById('histHeatmap');
    if (kpisEl) kpisEl.innerHTML = renderPlaceholderSemDados('📅', 'Sem histórico para esta obra', 'Envie a aba <strong>Gestões</strong> na <strong>📤 Uploads</strong> (upload compartilhado — 1 arquivo cobre todas as obras).');
    if (chartEl) chartEl.replaceChildren();
    if (heatEl) heatEl.replaceChildren();
    return;
  }
  // Construir cópias que incluam o Orçamento Licitação como ponto zero
  const gestoes = [LIC_LABEL, ...HIST_OBRA.gestoes];
  // Mapa insumo → licitação (a partir da Tendência)
  const licMap = {};
  DATA_T.forEach(t => {
    if (t.is_folha && t.cod_insumo && t.licitacao != null) {
      licMap[t.cod_insumo] = (licMap[t.cod_insumo] || 0) + t.licitacao;
    }
  });
  // Anexar valor de licitação em cada item
  const items = HIST_OBRA.items.map(it => ({
    ...it,
    [LIC_LABEL]: licMap[it.insumo] || 0,
  }));
  // Totais (inclui licitação)
  const totals = { [LIC_LABEL]: Object.values(licMap).reduce((s,v) => s+v, 0), ...HIST_OBRA.totals };

  // KPIs: total atual, variação vs primeira, qtd itens que mudaram
  const primeira = gestoes[0];
  const ultima = gestoes[gestoes.length - 1];
  const totPrim = totals[primeira] || 0;
  const totUlt = totals[ultima] || 0;
  const totDiff = totUlt - totPrim;
  const totDiffDisplay = isFlat(totDiff) ? 0 : totDiff;
  let changed = 0;
  items.forEach(it => {
    for (let i = 1; i < gestoes.length; i++) {
      if (!isFlat((it[gestoes[i]]||0) - (it[gestoes[i-1]]||0))) { changed++; break; }
    }
  });
  const diffKpiCls = isFlat(totDiff) ? '' : (totDiff>0?'red':'green');
  const diffKpiVal = isFlat(totDiff)
    ? '<span style="color:var(--text-soft);font-size:16px;">estável</span>'
    : `${totDiff>=0?'+':''}${fmtR$(totDiff)}`;
  const diffKpiSub = isFlat(totDiff)
    ? `variação &lt; R$ ${CENT_TOLERANCE.toFixed(2)}`
    : (totPrim?((totDiff/totPrim*100).toFixed(2)+'%'):'');
  document.getElementById('histKpis').innerHTML = [
    uiCriarKpi({ titulo: primeira === LIC_LABEL ? 'Orçamento Licitação (base)' : `Primeira gestão (${primeira})`, valor: fmtR$(totPrim), subtitulo: `${items.length} itens` }),
    uiCriarKpi({ titulo: `Última gestão (${ultima})`, valor: fmtR$(totUlt), subtitulo: 'vigente' }),
    uiCriarKpi({ titulo: 'Variação total', valor: diffKpiVal, subtitulo: diffKpiSub, cor: diffKpiCls }),
    uiCriarKpi({ titulo: 'Itens que variaram', valor: changed, subtitulo: `de ${items.length} itens totais`, cor: 'amber' }),
    uiCriarKpi({ titulo: 'Gestões disponíveis', valor: gestoes.length, subtitulo: gestoes.join(' → ') }),
  ].join('');

  renderHistChart(gestoes, totals);
  renderHistTopChanges(items, gestoes);
  renderHistHeatmap(items, gestoes);
}

function renderHistChart(gestoes, totals) {
  const vals = gestoes.map(g => totals[g]);
  const categories = gestoes.map(g => g.replace('GESTÃO ', '').replace('Atual', 'Atual'));
  const seriesData = vals;

  const options = {
    series: [{ name: 'Total da obra', data: seriesData }],
    chart: {
      type: 'area',
      height: 350,
      animations: { enabled: true, easing: 'easeinout', speed: 800 },
      toolbar: { show: true, tools: { download: true, selection: true, zoom: true, pan: true, reset: true } },
      zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
    },
    colors: [resolveColor('var(--fgr-red-deep)')],
    stroke: { curve: 'smooth', width: 2.5 },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.3, opacityTo: 0.02, stops: [0, 100] },
    },
    xaxis: {
      categories: categories,
      labels: { style: { fontSize: '11px', fontWeight: '600' } },
    },
    yaxis: {
      labels: { formatter: val => fmtR$k(val), style: { fontSize: '10px' } },
    },
    tooltip: {
      enabled: true,
      shared: false,
      theme: document.body.classList.contains('dark') ? 'dark' : 'light',
      custom: function({ series, seriesIndex, dataPointIndex, w }) {
        const valor = series[seriesIndex][dataPointIndex];
        const gestaoLabel = gestoes[dataPointIndex];
        const prevVal = dataPointIndex > 0 ? vals[dataPointIndex - 1] : null;
        const variacao = prevVal != null ? valor - prevVal : 0;
        const variacaoPct = prevVal && prevVal !== 0 ? ((variacao / prevVal) * 100).toFixed(2) : null;
        const variacaoFmt = variacao >= 0 ? '+' + fmtR$(variacao) : fmtR$(variacao);
        let html = '<div style="padding:8px 12px; font-size:12px;">';
        html += '<strong>' + escHtml(gestaoLabel) + '</strong><br>';
        html += '<span style="color:var(--text-soft);">Total:</span> <strong>' + fmtR$(valor) + '</strong>';
        if (prevVal != null) {
          html += '<br><span style="color:var(--text-soft);">Δ vs anterior:</span> <strong>' + variacaoFmt + '</strong>';
          if (variacaoPct !== null) html += ' (' + variacaoPct + '%)';
        }
        if (dataPointIndex === 0) html += '<br><span style="color:var(--text-soft); font-size:11px;">Orçamento base</span>';
        html += '</div>';
        return html;
      }
    },
    legend: { show: true, position: 'top', fontSize: '12px', labels: { colors: resolveColor('var(--text-medium)') } },
    grid: { borderColor: resolveColor('var(--border)'), strokeDashArray: 3 },
    dataLabels: { enabled: false },
    markers: {
      size: 5,
      strokeWidth: 2,
      strokeColors: '#fff',
      hover: { sizeOffset: 3 },
    },
  };

  renderApexChart('histChart', options);

  // Legenda com variação entre gestões consecutivas (mantida em HTML separado)
  let leg = [];
  for (let i = 1; i < gestoes.length; i++) {
    const d = totals[gestoes[i]] - totals[gestoes[i-1]];
    if (isFlat(d)) {
      leg.push(`<span><strong>${escHtml(gestoes[i-1])} → ${escHtml(gestoes[i])}:</strong> <span style="color:var(--text-soft);">estável</span></span>`);
    } else {
      const pct = totals[gestoes[i-1]] ? (d/totals[gestoes[i-1]]*100) : 0;
      const cls = d > 0 ? 'neg' : 'pos';
      leg.push(`<span><strong>${escHtml(gestoes[i-1])} → ${escHtml(gestoes[i])}:</strong> <span class="${cls}">${d>=0?'+':''}${fmtR$(d)} (${pct.toFixed(2)}%)</span></span>`);
    }
  }
  document.getElementById('histLegend').innerHTML = leg.join(' · ') + ` <span style="color:var(--text-lighter); margin-left:8px;">· variações &lt; R$ ${CENT_TOLERANCE.toFixed(2)} ignoradas (arredondamento)</span>`;
}

function renderHistTopChanges(items, gestoes) {
  // Variação entre a primeira e a última gestão
  const first = gestoes[0], last = gestoes[gestoes.length - 1];
  const enriched = items.map(it => ({
    ...it,
    delta: (it[last]||0) - (it[first]||0),
    delta_pct: it[first] ? ((it[last]||0) - it[first]) / it[first] * 100 : null,
  }));
  const ups = enriched.filter(x => x.delta >= CENT_TOLERANCE).sort((a,b) => b.delta - a.delta).slice(0,10);
  const downs = enriched.filter(x => x.delta <= -CENT_TOLERANCE).sort((a,b) => a.delta - b.delta).slice(0,10);

  const renderList = (arr, isUp) => {
    if (!arr.length) return '<div style="color:var(--text-lighter); text-align:center; padding:20px;">Sem variações neste período.</div>';
    const maxAbs = Math.max(...arr.map(x => Math.abs(x.delta)));
    return arr.map(x => {
      // Tentar achar o nome do item na tendência via insumo
      const tendMatch = DATA_T.find(t => t.cod_insumo === x.insumo);
      const nome = tendMatch ? tendMatch.item : (x.insumo + ' (' + x.item_cod + ')');
      return `
        <div class="top-item">
          <div class="name" title="${escAttr(nome)}">${escHtml(x.insumo)} — ${escHtml(nome.length>40?nome.slice(0,37)+'...':nome)}</div>
          <div class="val ${x.delta<0?'pos':'neg'}">${x.delta>=0?'+':''}${fmtR$(x.delta)}</div>
          <div class="top-bar"><div class="top-bar-fill ${isUp?'':'green'}" style="width:${Math.abs(x.delta)/maxAbs*100}%;"></div></div>
        </div>`;
    }).join('');
  };
  document.getElementById('histTopUp').innerHTML = renderList(ups, true);
  document.getElementById('histTopDown').innerHTML = renderList(downs, false);
}

function renderHistHeatmap() {
  // v0.58b: filtra pela obra ativa
  const HIST_OBRA = getHistoricoObraAtiva();
  const items = HIST_OBRA.items;
  const gestoes = HIST_OBRA.gestoes;
  const q = document.getElementById('histSearch').value.toLowerCase();
  const compare = document.getElementById('histCompare').value;
  const onlyChanged = document.getElementById('histOnlyChanged').checked;

  let filtered = items.filter(it => {
    if (q) {
      const tendMatch = DATA_T.find(t => t.cod_insumo === it.insumo);
      const nome = tendMatch ? tendMatch.item : '';
      const txt = (it.insumo + ' ' + it.item_cod + ' ' + nome).toLowerCase();
      if (!txt.includes(q)) return false;
    }
    if (onlyChanged) {
      let changed = false;
      for (let i = 1; i < gestoes.length; i++) {
        if (!isFlat((it[gestoes[i]]||0) - (it[gestoes[i-1]]||0))) { changed = true; break; }
      }
      if (!changed) return false;
    }
    return true;
  });

  // Ordenar por maior variação total (módulo)
  filtered.sort((a, b) => {
    const da = Math.abs((a[gestoes[gestoes.length-1]]||0) - (a[gestoes[0]]||0));
    const db = Math.abs((b[gestoes[gestoes.length-1]]||0) - (b[gestoes[0]]||0));
    return db - da;
  });

  // Header
  document.getElementById('histThead').innerHTML = `
    <tr>
      <th class="hist-th label">Insumo</th>
      <th class="hist-th label">Item</th>
      ${gestoes.map(g => `<th class="hist-th">${escHtml(g === LIC_LABEL ? 'Licitação' : g.replace('GESTÃO ', ''))}</th>`).join('')}
      <th class="hist-th">Δ vs Licit. R$</th>
      <th class="hist-th">Δ %</th>
    </tr>
  `;

  // Tbody
  document.getElementById('histTbody').innerHTML = historyPage.items.map(it => {
    const cells = gestoes.map((g, i) => {
      const v = it[g] || 0;
      if (v === 0 && i > 0 && (it[gestoes[i-1]]||0) === 0) {
        return `<td class="hist-cell zero">—</td>`;
      }
      let cls = '';
      let title = `${escAttr(g)}: ${fmtR$(v)}`;
      if (i > 0) {
        const ref = compare === 'first' ? (it[gestoes[0]]||0) : (it[gestoes[i-1]]||0);
        const d = v - ref;
        const pct = ref ? (d/ref*100) : (v > 0 ? 100 : 0);
        if (!isFlat(d)) {
          if (d > 0) cls = Math.abs(pct) > 20 ? 'up-strong' : 'up';
          else cls = Math.abs(pct) > 20 ? 'down-strong' : 'down';
          title += ` (${d>=0?'+':''}${fmtR$(d)} vs ${escAttr(compare==='first'?gestoes[0]:gestoes[i-1])})`;
        } else cls = 'flat';
      }
      return `<td class="hist-cell ${cls}" title="${title}">${v ? fmt(v, 0) : '—'}</td>`;
    }).join('');
    const dTotalRaw = (it[gestoes[gestoes.length-1]]||0) - (it[gestoes[0]]||0);
    const dTotal = isFlat(dTotalRaw) ? 0 : dTotalRaw;
    const pctTot = (isFlat(dTotalRaw) || !it[gestoes[0]]) ? null : (dTotalRaw/it[gestoes[0]]*100);
    const tendMatch = DATA_T.find(t => t.cod_insumo === it.insumo);
    const nome = tendMatch ? tendMatch.item : it.item_cod;
    return `<tr>
      <td style="font-size:11px;color:var(--text-soft);">${escHtml(it.insumo)}</td>
      <td style="font-size:11.5px;">${escHtml(nome)}</td>
      ${cells}
      <td class="hist-cell ${dTotal<0?'down-strong':dTotal>0?'up-strong':'flat'}" style="font-weight:700;">${dTotal===0?'—':(dTotal>=0?'+':'')+fmt(dTotal, 0)}</td>
      <td class="hist-cell ${dTotal<0?'down-strong':dTotal>0?'up-strong':'flat'}" style="font-weight:700;">${pctTot!=null?(pctTot>=0?'+':'')+pctTot.toFixed(1)+'%':'—'}</td>
    </tr>`;
  }).join('');
  document.getElementById('histCount').textContent = `${filtered.length} de ${items.length} itens · exibindo ${historyPage.start}–${historyPage.end}`;
  renderPaginationControls('historyPagination', 'history', historyPage, renderHistHeatmap);
}

// Debounce para filtros do heatmap histórico
const debouncedHistHeatmap = debounce(renderHistHeatmap, 300);
['histSearch','histCompare','histOnlyChanged'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', debouncedHistHeatmap);
    el.addEventListener('change', debouncedHistHeatmap);
  }
});

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
  document.getElementById('loginPanelLogin').style.display = isLogin ? 'block' : 'none';
  document.getElementById('loginPanelSignup').style.display = isLogin ? 'none' : 'block';
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
