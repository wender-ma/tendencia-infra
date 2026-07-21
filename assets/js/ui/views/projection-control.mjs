/* eslint-disable no-undef */
import { replaceWithParsedMarkup } from '../dom.mjs';
import {
  debounce,
  formatCompactNumber as fmtR$k,
  formatNumber as fmt,
  formatNumber as fmtR$,
} from '../dashboard-runtime.mjs';

let runAsyncSafely;
let resolveColor;
let renderApexChart;
let getFlowsObraAtiva;
let SafeStorage;
let authToast;
let openModal;
let closeModal;
let confirmModal;
let renderDashboardState;
let supaSaveProjConfig;
let supaUpsertMov;
let supaDeleteMov;
let SUPA;
let isEditorDaObraAtiva;
let requireEditor;

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
          locks:
            obj.locks && typeof obj.locks === 'object'
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
  } catch (e) {
    console.warn('Erro ao ler controle projeção:', e);
  }
}

function saveProjCtrl() {
  if (!isEditorDaObraAtiva()) return false;
  SafeStorage.set(PROJ_CTRL_KEY, JSON.stringify(PROJ_CTRL_STATE));
  // Sync config
  void runAsyncSafely(
    supaSaveProjConfig({
      insumo: PROJ_CTRL_STATE.insumo,
      saldo_inicial: PROJ_CTRL_STATE.saldo_inicial,
      data_ref: PROJ_CTRL_STATE.data_ref,
      locks: PROJ_CTRL_STATE.locks || { saldo: false, data: false, insumo: false },
    }),
    'Projeção/sincronizar configuração',
    'A configuração da projeção foi salva apenas neste navegador.',
  );
  // Sync movimentações manuais (upsert todas — idempotente)
  if (SUPA && Array.isArray(PROJ_CTRL_STATE.movimentacoes)) {
    void runAsyncSafely(
      Promise.all(PROJ_CTRL_STATE.movimentacoes.map((m) => supaUpsertMov(m))),
      'Projeção/sincronizar movimentações',
      'As movimentações foram salvas apenas neste navegador.',
    );
  }
}

function nextMovId() {
  let max = 0;
  PROJ_CTRL_STATE.movimentacoes.forEach((m) => {
    const mt = String(m.id || '').match(/^MOV(\d+)$/);
    if (mt) max = Math.max(max, parseInt(mt[1]));
  });
  return 'MOV' + String(max + 1).padStart(3, '0');
}

let _projCtrlListenersAttached = false;

// v0.60.5 — aplica o estado dos cadeados aos inputs e botões da UI
function applyLocksToUI() {
  const map = [
    { key: 'saldo', inputId: 'projCtrlSaldoInicial', btnId: 'lockBtnSaldo' },
    { key: 'data', inputId: 'projCtrlDataRef', btnId: 'lockBtnData' },
    { key: 'insumo', inputId: 'projCtrlInsumo', btnId: 'lockBtnInsumo' },
  ];
  const locks = (PROJ_CTRL_STATE && PROJ_CTRL_STATE.locks) || {
    saldo: false,
    data: false,
    insumo: false,
  };
  const canEdit = isEditorDaObraAtiva();
  map.forEach((m) => {
    const inp = document.getElementById(m.inputId);
    const btn = document.getElementById(m.btnId);
    const trancado = !!locks[m.key];
    if (inp) {
      inp.readOnly = trancado || !canEdit;
      inp.disabled = !canEdit;
      inp.style.background = trancado || !canEdit ? 'var(--bg-soft)' : '';
      inp.style.color = trancado || !canEdit ? 'var(--text-soft)' : '';
      inp.style.cursor = trancado || !canEdit ? 'not-allowed' : '';
    }
    if (btn) {
      btn.textContent = trancado ? '🔒' : '🔓';
      btn.title = trancado
        ? 'Trancado — clique para destravar'
        : 'Destravado — clique para trancar';
      btn.style.background = trancado ? 'var(--sem-alerta-bg)' : 'var(--bg-card)';
      btn.style.borderColor = trancado ? 'var(--sem-alerta)' : 'var(--border-strong)';
    }
  });
}

// v0.60.5 — alterna o cadeado de um campo (saldo | data | insumo)
function toggleLockCampo(campo) {
  if (!requireEditorForActiveProject('alterar os bloqueios da projeção')) return;
  if (!PROJ_CTRL_STATE.locks) PROJ_CTRL_STATE.locks = { saldo: false, data: false, insumo: false };
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
      ['movSearch', 'movFilterTipo', 'movFilterDirecao'].forEach((id) => {
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
      data_br: PROJ_CTRL_STATE.data_ref
        ? PROJ_CTRL_STATE.data_ref.split('-').reverse().join('/')
        : '01/2024',
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
  getFlowsObraAtiva()
    .filter((f) => (f.refletido_status || 'pendente') === 'sim')
    .forEach((f) => {
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
  PROJ_CTRL_STATE.movimentacoes.forEach((m) => {
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
    const da = a.data || a.data_br || '';
    const db = b.data || b.data_br || '';
    // tentar parsear data_br para iso
    const toIso = (s) => {
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
  const totalEntradas = movs
    .filter((m) => m.direcao === 'entrada')
    .reduce((s, m) => s + (m.valor || 0), 0);
  const totalSaidas = movs
    .filter((m) => m.direcao === 'saida')
    .reduce((s, m) => s + (m.valor || 0), 0);
  const saldoAtual = totalEntradas - totalSaidas;

  // ===== CONFERÊNCIA COM SISTEMA (TENDÊNCIA) =====
  // Busca o valor atual do insumo controlado na aba TENDÊNCIA
  const insumoCtrl = (PROJ_CTRL_STATE.insumo || 'I011890').trim();
  let valorSistema = null;
  if (Array.isArray(DATA_T)) {
    // Soma de todos os insumos da Tendência que casam com o cod_insumo (geralmente 1 único)
    valorSistema = DATA_T.filter((t) => t.is_folha && t.cod_insumo === insumoCtrl).reduce(
      (s, t) => s + (t.gestao || 0),
      0,
    );
    if (valorSistema === 0) valorSistema = null; // não encontrado
  }
  const TOL_CONF = CONFIG.tolerancia_conferencia; // tolerância em R$
  let confDiff = null,
    confStatus = 'na';
  if (valorSistema != null) {
    confDiff = valorSistema - saldoAtual;
    if (Math.abs(confDiff) <= TOL_CONF) confStatus = 'ok';
    else confStatus = 'divergente';
  }

  const saldoCls = saldoAtual > 0 ? 'green' : saldoAtual < 0 ? 'red' : '';
  const confCls = confStatus === 'ok' ? 'green' : confStatus === 'divergente' ? 'red' : '';

  replaceWithParsedMarkup(
    document.getElementById('projCtrlKpis'),
    `
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
    <div class="kpi ${confCls}"><div class="label">${confStatus === 'ok' ? '✅ Conferido' : confStatus === 'divergente' ? '⚠️ Não identificado' : '— Conferência'}</div><div class="value">${confDiff != null ? (Math.abs(confDiff) <= TOL_CONF ? 'OK' : (confDiff >= 0 ? '+' : '') + fmtR$(confDiff)) : '—'}</div><div class="sub">${confStatus === 'ok' ? 'tudo confere' : confStatus === 'divergente' ? 'sistema − controlado' : 'sem comparação possível'}</div></div>
  `,
  );

  // ===== BANNER de conferência (com a equação) =====
  const elBanner = document.getElementById('projCtrlConfBanner');
  if (elBanner) {
    if (valorSistema == null) {
      replaceWithParsedMarkup(
        elBanner,
        `
        <div style="padding:10px 14px; background:var(--sem-alerta-bg); border-left:4px solid var(--sem-alerta); border-radius:6px; font-size:12.5px; color:var(--sem-alerta);">
          ⚠️ <strong>Insumo controlado (${escHtml(insumoCtrl)}) não foi encontrado na aba TENDÊNCIA.</strong> Verifique se está correto no campo "Insumo controlado" acima.
        </div>`,
      );
    } else if (confStatus === 'ok') {
      replaceWithParsedMarkup(
        elBanner,
        `
        <div style="padding:10px 14px; background:var(--sem-ok-bg); border-left:4px solid var(--sem-ok); border-radius:6px; font-size:12.5px; color:var(--sem-ok);">
          ✅ <strong>Conferido!</strong> Saldo controlado (${fmtR$(saldoAtual)}) = Valor no sistema (${fmtR$(valorSistema)}). Diferença: ${fmtR$(confDiff)} (dentro da tolerância de R$ ${TOL_CONF.toFixed(2)}).
        </div>`,
      );
    } else {
      const sinal = confDiff >= 0 ? 'a mais' : 'a menos';
      replaceWithParsedMarkup(
        elBanner,
        `
        <div style="padding:10px 14px; background:var(--fgr-red-light); border-left:4px solid var(--fgr-red-vivid); border-radius:6px; font-size:12.5px; color:var(--sem-erro);">
          ⚠️ <strong>Divergência identificada:</strong> existem ${fmtR$(Math.abs(confDiff))} ${sinal} no sistema do que o controlado.
          <div style="margin-top:6px; font-size:11.5px; color:var(--sem-erro-text); display:flex; gap:18px; flex-wrap:wrap;">
            <span>📊 Saldo controlado: <strong>${fmtR$(saldoAtual)}</strong></span>
            <span>🔍 Valor no sistema (Tendência): <strong>${fmtR$(valorSistema)}</strong></span>
            <span>❓ Não identificado: <strong>${confDiff >= 0 ? '+' : ''}${fmtR$(confDiff)}</strong></span>
          </div>
          <div style="margin-top:6px; font-size:11px; color:var(--sem-erro-text);">
            💡 Isso significa que há movimentações no sistema (Tendência) que ainda não foram registradas neste controle. Adicione uma movimentação manual ou ajuste o saldo inicial.
          </div>
        </div>`,
      );
    }
  }

  renderProjCtrlChart(movs);
  renderMovTable(movs, saldoAtual);
}

function renderProjCtrlChart(movs) {
  if (!movs.length) {
    renderDashboardState('projCtrlChart', {
      title: 'Nenhuma movimentação registrada',
      message: 'Defina o saldo inicial ou adicione uma movimentação para começar o controle.',
    });
    return;
  }

  // Saldo cumulativo ao longo do tempo
  let saldo = 0;
  const pontos = movs.map((m) => {
    saldo += (m.direcao === 'entrada' ? 1 : -1) * (m.valor || 0);
    const isoData =
      m.data ||
      (() => {
        const mm = (m.data_br || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
        return mm ? `${mm[3]}-${mm[2]}-${mm[1]}` : '';
      })();
    return { data: isoData, saldo, mov: m };
  });

  const categories = pontos.map((p) => (p.data ? p.data.slice(0, 7) : ''));
  const seriesData = pontos.map((p) => p.saldo);
  const dotColors = pontos.map((p) =>
    p.mov.direcao === 'entrada'
      ? resolveColor('var(--sem-ok)')
      : resolveColor('var(--fgr-red-vivid)'),
  );

  const options = {
    series: [{ name: 'Saldo acumulado', data: seriesData }],
    chart: {
      type: 'area',
      height: 300,
      animations: { enabled: true, easing: 'easeinout', speed: 800 },
      toolbar: {
        show: true,
        tools: { download: true, selection: true, zoom: true, pan: true, reset: true },
      },
      zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
    },
    colors: [resolveColor('var(--accent-purple-strong)')],
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
      labels: { formatter: (val) => fmtR$k(val), style: { fontSize: '10px' } },
    },
    annotations: {
      yaxis: [
        {
          y: 0,
          borderColor: resolveColor('var(--text-lighter)'),
          strokeDashArray: 4,
          label: {
            text: 'Zero',
            style: { color: resolveColor('var(--text-soft)'), fontSize: '10px' },
          },
        },
      ],
    },
    tooltip: {
      enabled: true,
      shared: false,
      theme: document.body.classList.contains('dark') ? 'dark' : 'light',
      custom: function ({ dataPointIndex }) {
        const p = pontos[dataPointIndex];
        const m = p.mov;
        const dirLabel = m.direcao === 'entrada' ? 'Entrada' : 'Saída';
        const valorFmt = (m.direcao === 'entrada' ? '+' : '-') + fmtR$(m.valor);
        const dataFmt = m.data_br || p.data;
        let html = '<div style="padding:8px 12px; font-size:12px;">';
        html += '<strong>' + escHtml(m.tipo || dirLabel) + '</strong><br>';
        html += '<span style="color:var(--text-soft);">Data:</span> ' + escHtml(dataFmt) + '<br>';
        html +=
          '<span style="color:var(--text-soft);">Direção:</span> ' + escHtml(dirLabel) + '<br>';
        html +=
          '<span style="color:var(--text-soft);">Valor:</span> <strong>' +
          valorFmt +
          '</strong><br>';
        html +=
          '<span style="color:var(--text-soft);">Saldo:</span> <strong>' +
          fmtR$(p.saldo) +
          '</strong>';
        if (m.descricao)
          html +=
            '<br><span style="color:var(--text-soft); font-size:11px;">' +
            escHtml(m.descricao.slice(0, 80)) +
            '</span>';
        html += '</div>';
        return html;
      },
    },
    legend: {
      show: true,
      position: 'top',
      fontSize: '12px',
      labels: { colors: resolveColor('var(--text-medium)') },
    },
    grid: { borderColor: resolveColor('var(--border)'), strokeDashArray: 3 },
    dataLabels: { enabled: false },
    markers: {
      size: 5,
      strokeWidth: 2,
      strokeColors: resolveColor('var(--text-on-dark)'),
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
  const movsWithSaldo = movs.map((m) => {
    saldoAcum += (m.direcao === 'entrada' ? 1 : -1) * (m.valor || 0);
    return { ...m, _saldo: saldoAcum };
  });

  // Aplicar filtros após calcular saldo
  const filtered = movsWithSaldo.filter((m) => {
    if (q) {
      const txt =
        `${m.descricao || ''} ${m.justificativa || ''} ${m.origem || ''} ${m.destino || ''} ${m.responsavel || ''}`.toLowerCase();
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
  const tipoBadge = {
    aditivo: '<span class="badge blue">🔵 Aditivo</span>',
    remanejamento: '<span class="badge purple">🟣 Remanejamento</span>',
    aporte: '<span class="badge green">🟢 Aporte</span>',
    devolucao: '<span class="badge amber">🟠 Devolução</span>',
  };

  const movTbody = document.getElementById('movTbody');
  if (!filtered.length) {
    renderDashboardState(movTbody, {
      title: movs.length ? 'Nenhuma movimentação encontrada' : 'Nenhuma movimentação registrada',
      message: movs.length
        ? 'Ajuste ou limpe os filtros para ver outros resultados.'
        : 'Use o botão Nova movimentação para iniciar o controle.',
      compact: true,
      tableColspan: 9,
    });
  } else
    replaceWithParsedMarkup(
      movTbody,
      filtered
        .map((m) => {
          const dirIcon =
            m.direcao === 'entrada'
              ? '<span style="color:var(--sem-ok); font-size:16px;" title="Entrada (recebeu verba)">⬅️</span>'
              : '<span style="color:var(--sem-erro); font-size:16px;" title="Saída (liberou verba)">➡️</span>';
          const valCls = m.direcao === 'entrada' ? 'pos' : 'neg';
          const valSign = m.direcao === 'entrada' ? '+' : '-';

          // Chips para origem do dado
          let chips = '';
          if (m.origem_dado === 'flow') {
            chips = `<span style="display:inline-block; padding:1px 6px; margin-left:6px; background:var(--fgr-red-light); color:var(--fgr-red); border-radius:10px; font-size:10px; font-weight:600; cursor:help;" title="Importado do Flow #${escAttr(m.flow_n || '')}. Para alterar, vá na aba 🔗 Flows.">🔗 Flow #${escHtml(m.flow_n || '')}</span>`;
          } else if (m.origem_dado === 'inicial') {
            chips = `<span style="display:inline-block; padding:1px 6px; margin-left:6px; background:var(--sem-alerta-bg); color:var(--sem-alerta); border-radius:10px; font-size:10px; font-weight:600;">💰 Saldo inicial</span>`;
          } else if (m.origem_dado === 'manual') {
            chips = `<span style="display:inline-block; margin-left:6px;">
        <button data-editor-only data-action="edit-mov" data-id="${escAttr(m.id)}" style="padding:2px 6px; border:1px solid var(--fgr-red-light); background:var(--fgr-red-light); color:var(--fgr-red-dark); border-radius:4px; font-size:10px; font-weight:600; cursor:pointer; margin-right:3px;" title="Editar">✏️ Editar</button>
        <button data-editor-only data-action="delete-mov" data-id="${escAttr(m.id)}" style="padding:2px 6px; border:1px solid var(--sem-erro-border); background:var(--fgr-red-light); color:var(--sem-erro); border-radius:4px; font-size:10px; font-weight:600; cursor:pointer;" title="Excluir">🗑️ Excluir</button>
      </span>`;
          }

          const trStyle =
            m.origem_dado === 'flow'
              ? 'background:var(--row-flow-bg);'
              : m.origem_dado === 'inicial'
                ? 'background:var(--row-initial-bg);'
                : '';
          return `<tr style="${trStyle}">
      <td style="font-size:11.5px; color:var(--text-soft);">${escHtml(m.data_br || m.data || '')}</td>
      <td>${tipoBadge[m.tipo] || escHtml(m.tipo)}</td>
      <td style="text-align:center;">${dirIcon}</td>
      <td style="font-size:11.5px;">${escHtml(m.origem || '—')}</td>
      <td style="font-size:11.5px;">${escHtml(m.destino || '—')}</td>
      <td style="font-size:11.5px;">
        <div style="display:flex; align-items:center; flex-wrap:wrap; gap:2px;">
          <strong>${escHtml((m.descricao || '').slice(0, 80))}${(m.descricao || '').length > 80 ? '...' : ''}</strong>
          ${chips}
        </div>
        ${m.justificativa ? `<div style="color:var(--text-soft); font-size:10.5px; margin-top:2px;">${escHtml(m.justificativa.slice(0, 80))}${m.justificativa.length > 80 ? '...' : ''}</div>` : ''}
      </td>
      <td style="font-size:11px;">${escHtml(m.responsavel || '—')}</td>
      <td class="num ${valCls}"><strong>${valSign}${fmt(m.valor || 0)}</strong></td>
      <td class="num"><span style="color:${m._saldo < 0 ? 'var(--sem-erro)' : 'var(--sem-ok)'}; font-weight:600;">${fmt(m._saldo)}</span></td>
    </tr>`;
        })
        .join(''),
    );

  document.getElementById('movCount').textContent =
    `${filtered.length} de ${movs.length} mov. · Saldo final: ${fmtR$(saldoFinal)}`;
}

function clearMovFilters() {
  ['movSearch', 'movFilterTipo', 'movFilterDirecao'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderProjCtrl();
}

// (Listeners dos filtros agora ficam em initProjCtrl)

// Formulário de nova/editar movimentação
function openMovForm(editingId) {
  if (!requireEditor('adicionar/editar movimentação')) return;
  const m = editingId ? PROJ_CTRL_STATE.movimentacoes.find((x) => x.id === editingId) : null;
  const today = new Date().toLocaleDateString('pt-BR');
  const insumo = PROJ_CTRL_STATE.insumo || 'I011890';
  const tipos = [
    { v: 'remanejamento', l: '🟣 Remanejamento básico' },
    { v: 'aporte', l: '🟢 Aporte' },
    { v: 'devolucao', l: '🟠 Devolução' },
    { v: 'aditivo', l: '🔵 Aditivo (manual, sem passar por Flow)' },
  ];
  const tipoOpts = tipos
    .map((t) => `<option value="${t.v}" ${m && m.tipo === t.v ? 'selected' : ''}>${t.l}</option>`)
    .join('');

  replaceWithParsedMarkup(
    document.getElementById('modalContent'),
    `
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
        <textarea id="mov_just" placeholder="contexto, links de projeto, número do CTR, etc.">${escHtml(m ? m.justificativa || '' : '')}</textarea>
      </div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn-sm" data-click-action="closeModal">Cancelar</button>
      <button type="submit" class="btn-sm primary" data-action="save-mov" data-id="${escAttr(editingId || '')}">💾 Salvar</button>
    </div>
    <div style="margin-top:10px; padding:8px 12px; background:var(--sem-alerta-bg); border-radius:6px; font-size:11px; color:var(--sem-alerta);">
      💡 A direção (entrada/saída) é calculada automaticamente: se o insumo controlado (${escHtml(insumo)}) aparecer no campo <strong>Destino</strong>, é uma entrada. Se aparecer em <strong>Origem</strong>, é uma saída.
    </div>
    </form>
  `,
  );
  openModal({ initialFocus: '#mov_tipo' });
}

async function saveMovForm(editingId) {
  if (!requireEditorForActiveProject('salvar movimentações')) return;
  const get = (id) => document.getElementById(id).value.trim();
  const tipo = get('mov_tipo');
  const data = get('mov_data');
  const origem = valueFromDisplay(get('mov_origem'));
  const destino = valueFromDisplay(get('mov_destino'));
  const desc = get('mov_desc');
  const resp = get('mov_resp');
  const valor = parseNumero(get('mov_valor'));
  const just = get('mov_just');

  if (!desc) {
    authToast('⚠️ Descrição é obrigatória.', 'warn', 3000);
    return;
  }
  if (valor == null || valor === 0) {
    authToast('⚠️ Valor é obrigatório (e diferente de zero).', 'warn', 3000);
    return;
  }
  if (!origem && !destino) {
    authToast('⚠️ Informe pelo menos Origem ou Destino.', 'warn', 3000);
    return;
  }

  const insumo = PROJ_CTRL_STATE.insumo || 'I011890';
  if (origem !== insumo && destino !== insumo) {
    const confirmed = await confirmModal(
      'Insumo controlado não encontrado',
      'Nem Origem (' +
        origem +
        ') nem Destino (' +
        destino +
        ') é o insumo controlado (' +
        insumo +
        ').\nSalvar mesmo assim?',
      { confirmText: 'Salvar', destructive: false },
    );
    if (!confirmed) return;
  }

  // tentar converter data dd/mm/aaaa em ISO
  let iso = '';
  let dataBr = data;
  const mDt = data.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (mDt) iso = `${mDt[3]}-${mDt[2]}-${mDt[1]}`;
  else {
    const m2 = data.match(/(\d{2})\/(\d{4})/);
    if (m2) {
      iso = `${m2[2]}-${m2[1]}-01`;
      dataBr = `01/${m2[1]}/${m2[2]}`;
    }
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

  const idx = PROJ_CTRL_STATE.movimentacoes.findIndex((x) => x.id === obj.id);
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
  const confirmed = await confirmModal(
    'Excluir movimentação?',
    'Excluir esta movimentação?\nEssa ação não pode ser desfeita.',
    { confirmText: 'Excluir', destructive: true },
  );
  if (!confirmed) return;
  PROJ_CTRL_STATE.movimentacoes = PROJ_CTRL_STATE.movimentacoes.filter((m) => m.id !== id);
  saveProjCtrl();
  void runAsyncSafely(
    supaDeleteMov(id),
    'Projeção/excluir movimentação no Supabase',
    'A movimentação foi removida apenas neste navegador.',
  );
  renderProjCtrl();
}

export function installLegacyProjectionControlView(
  {
    runtime,
    storage,
    feedback,
    modals,
    viewStates,
    dashboardRepository,
    authService,
    authUi,
    supabaseClient,
  },
  target = window,
) {
  runAsyncSafely = runtime.runAsyncSafely;
  resolveColor = runtime.resolveColor;
  renderApexChart = runtime.renderApexChart;
  getFlowsObraAtiva = runtime.getActiveFlows;
  SafeStorage = storage;
  authToast = feedback.toast;
  openModal = modals.open;
  closeModal = modals.close;
  confirmModal = modals.confirm;
  renderDashboardState = viewStates.render;
  supaSaveProjConfig = dashboardRepository.saveProjectionConfig;
  supaUpsertMov = dashboardRepository.upsertMovement;
  supaDeleteMov = dashboardRepository.deleteMovement;
  SUPA = supabaseClient;
  isEditorDaObraAtiva = authService.canEditActiveProject;
  requireEditor = authUi.requireEditor;
  Object.defineProperty(target, 'PROJ_CTRL_STATE', {
    configurable: true,
    get: () => PROJ_CTRL_STATE,
    set: (value) => {
      PROJ_CTRL_STATE = value;
    },
  });
  Object.assign(target, {
    loadProjCtrl,
    applyLocksToUI,
    initProjCtrl,
    renderProjCtrl,
    editMov,
    deleteMov,
  });
  document.getElementById('movTbody')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    event.stopPropagation();
    if (button.dataset.action === 'edit-mov') editMov(button.dataset.id);
    if (button.dataset.action === 'delete-mov') deleteMov(button.dataset.id);
  });
  return Object.freeze({ toggleLockCampo, clearMovFilters, openMovForm, saveMovForm });
}
