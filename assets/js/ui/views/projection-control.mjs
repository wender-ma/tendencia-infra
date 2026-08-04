import { replaceWithParsedMarkup } from '../dom.mjs';
import { DASHBOARD_CONFIG, STORAGE_KEYS } from '../../config.js';
import { parseNumber } from '../../parsers/shared.mjs';
import {
  calculateProjectionBalance,
  getProjectionMovementAmount,
  getProjectionMovementSignedValue,
  PROJECTION_MOVEMENT_DIRECTIONS,
  resolveProjectionMovementDirection,
} from '../../services/projection-control-accounting.mjs';
import { escAttr, escHtml, formatDate } from '../formatters.mjs';
import {
  debounce,
  formatCompactNumber as fmtR$k,
  formatNumber as fmt,
  formatNumber as fmtR$,
} from '../dashboard-runtime.mjs';
import { isReflectedStatus } from '../../services/flow-reflection.mjs';

const PROJ_CTRL_KEY = STORAGE_KEYS.projectionControl;

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
let APP_STATE;
let displayForValue;
let valueFromDisplay;

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
let _projCtrlInsumoOptionsSignature = '';

function syncProjCtrlInsumoOptions(select) {
  if (!select) return;
  const currentValue = (PROJ_CTRL_STATE.insumo || 'I011890').trim();
  const availableInputs = new Map();
  (APP_STATE.dados.tendencia || []).forEach((item) => {
    if (item.is_folha && item.cod_insumo && !availableInputs.has(item.cod_insumo)) {
      availableInputs.set(item.cod_insumo, item.item || '');
    }
  });
  const options = [...availableInputs.entries()].sort(([left], [right]) =>
    left.localeCompare(right, 'pt-BR'),
  );
  const signature = JSON.stringify([currentValue, options]);

  if (_projCtrlInsumoOptionsSignature !== signature) {
    const currentIsAvailable = availableInputs.has(currentValue);
    const missingOption = currentIsAvailable
      ? ''
      : `<option value="${escAttr(currentValue)}" disabled>${escHtml(currentValue)} — não encontrado na obra</option>`;
    const availableOptions = options
      .map(
        ([code, description]) =>
          `<option value="${escAttr(code)}">${escHtml(code)}${description ? ` — ${escHtml(description)}` : ''}</option>`,
      )
      .join('');
    replaceWithParsedMarkup(select, missingOption + availableOptions);
    _projCtrlInsumoOptionsSignature = signature;
  }

  select.value = currentValue;
}

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
      inp.disabled = !canEdit || (inp.tagName === 'SELECT' && trancado);
      inp.classList.toggle('is-locked', trancado || !canEdit);
    }
    if (btn) {
      btn.textContent = trancado ? '🔒' : '🔓';
      btn.title = trancado
        ? 'Trancado — clique para destravar'
        : 'Destravado — clique para trancar';
      btn.classList.toggle('is-locked', trancado);
      btn.setAttribute('aria-pressed', String(trancado));
    }
  });
}

// v0.60.5 — alterna o cadeado de um campo (saldo | data | insumo)
function toggleLockCampo(campo) {
  if (!requireEditor('alterar os bloqueios da projeção')) return;
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
    syncProjCtrlInsumoOptions(elIns);
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
          const parsed = parseNumber(elSaldo.value);
          PROJ_CTRL_STATE.saldo_inicial = parsed;
          saveProjCtrl();
          renderProjCtrl();
        });
        // Formatar ao sair do campo
        elSaldo.addEventListener('blur', () => {
          const parsed = parseNumber(elSaldo.value);
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
    .filter((f) => isReflectedStatus(f.refletido_status))
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
        valor: getProjectionMovementAmount(f.custo_flowmaster),
        direcao,
        origem_dado: 'flow',
        flow_n: f.n_alteracao,
        bloqueada: true,
      });
    });

  // Movimentações manuais
  PROJ_CTRL_STATE.movimentacoes.forEach((m) => {
    const direcao = resolveProjectionMovementDirection(m, insumo);
    out.push({
      ...m,
      valor: getProjectionMovementAmount(m.valor),
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
  syncProjCtrlInsumoOptions(document.getElementById('projCtrlInsumo'));
  const movs = getAllMovimentacoes();

  // Calcula KPIs
  const saldoAtual = calculateProjectionBalance(movs);

  // ===== CONFERÊNCIA COM SISTEMA (TENDÊNCIA) =====
  // Busca o valor atual do insumo controlado na aba TENDÊNCIA
  const insumoCtrl = (PROJ_CTRL_STATE.insumo || 'I011890').trim();
  let valorSistema = null;
  if (Array.isArray(APP_STATE.dados.tendencia)) {
    // Soma de todos os insumos da Tendência que casam com o cod_insumo (geralmente 1 único)
    valorSistema = APP_STATE.dados.tendencia
      .filter((t) => t.is_folha && t.cod_insumo === insumoCtrl)
      .reduce((s, t) => s + (t.gestao || 0), 0);
    if (valorSistema === 0) valorSistema = null; // não encontrado
  }
  const TOL_CONF = DASHBOARD_CONFIG.tolerancia_conferencia; // tolerância em R$
  let confDiff = null,
    confStatus = 'na';
  if (valorSistema != null) {
    confDiff = valorSistema - saldoAtual;
    if (Math.abs(confDiff) <= TOL_CONF) confStatus = 'ok';
    else confStatus = 'divergente';
  }

  const summaryPanel = document.getElementById('projCtrlSummary');
  if (summaryPanel) {
    summaryPanel.classList.toggle('is-balanced', confStatus === 'ok');
    summaryPanel.classList.toggle('is-divergent', confStatus === 'divergente');
    const diffIcon = confStatus === 'ok' ? '✅' : confStatus === 'divergente' ? '⚠️' : '➖';
    const diffValue = confDiff == null ? '—' : `${confDiff > 0 ? '+' : ''}${fmtR$(confDiff)}`;
    replaceWithParsedMarkup(
      summaryPanel,
      `
      <div class="projection-control-summary-row">
        <span>📊 Saldo Controlado</span>
        <strong>${fmtR$(saldoAtual)}</strong>
      </div>
      <div class="projection-control-summary-row">
        <span>🔍 Valor no Sistema</span>
        <strong>${valorSistema != null ? fmtR$(valorSistema) : '—'}</strong>
      </div>
      <div class="projection-control-summary-row projection-control-summary-row--difference">
        <span>${diffIcon} Diferença</span>
        <strong>${diffValue}</strong>
      </div>
    `,
    );
  }

  // ===== BANNER de conferência =====
  const elBanner = document.getElementById('projCtrlConfBanner');
  if (elBanner) {
    if (valorSistema == null) {
      replaceWithParsedMarkup(
        elBanner,
        `
        <div class="projection-conf-alert projection-conf-alert--warning">
          ⚠️ <strong>Insumo controlado (${escHtml(insumoCtrl)}) não foi encontrado na aba TENDÊNCIA.</strong> Verifique se está correto no campo "Insumo controlado" acima.
        </div>`,
      );
    } else if (confStatus === 'ok') {
      elBanner.replaceChildren();
    } else {
      const sinal = confDiff >= 0 ? 'a mais' : 'a menos';
      replaceWithParsedMarkup(
        elBanner,
        `
        <div class="projection-conf-alert projection-conf-alert--error">
          ⚠️ <strong>${fmtR$(Math.abs(confDiff))} ${sinal} no sistema.</strong>
          Registre a movimentação correspondente ou ajuste o saldo inicial.
        </div>`,
      );
    }
  }

  renderProjCtrlChart(movs);
  renderMovTable(movs);
}

function renderProjCtrlChart(movs) {
  const validMovements = movs.filter(
    (movement) => movement.direcao !== PROJECTION_MOVEMENT_DIRECTIONS.INVALID,
  );
  if (!validMovements.length) {
    renderDashboardState('projCtrlChart', {
      title: 'Nenhuma movimentação registrada',
      message: 'Defina o saldo inicial ou adicione uma movimentação para começar o controle.',
    });
    return;
  }

  // Saldo cumulativo ao longo do tempo
  let saldo = 0;
  const pontos = validMovements.map((m) => {
    saldo += getProjectionMovementSignedValue(m);
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
  const dotColorTokens = pontos.map((p) =>
    p.mov.direcao === 'entrada' ? 'var(--sem-ok)' : 'var(--fgr-red-vivid)',
  );
  const dotColors = dotColorTokens.map(resolveColor);

  const options = {
    series: [{ name: 'Saldo acumulado', data: seriesData }],
    chart: {
      type: 'area',
      height: 280,
      animations: { enabled: true, easing: 'easeinout', speed: 800 },
      toolbar: {
        show: true,
        tools: { download: true, selection: true, zoom: true, pan: true, reset: true },
      },
      zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
    },
    themePalette: ['var(--accent-purple-strong)'],
    themeMarkerPalette: dotColorTokens,
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
          borderColor: resolveColor('var(--chart-neutral)'),
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
        let html = '<div class="projection-chart-tooltip">';
        html += '<strong>' + escHtml(m.tipo || dirLabel) + '</strong><br>';
        html +=
          '<span class="projection-chart-tooltip-label">Data:</span> ' + escHtml(dataFmt) + '<br>';
        html +=
          '<span class="projection-chart-tooltip-label">Direção:</span> ' +
          escHtml(dirLabel) +
          '<br>';
        html +=
          '<span class="projection-chart-tooltip-label">Valor:</span> <strong>' +
          valorFmt +
          '</strong><br>';
        html +=
          '<span class="projection-chart-tooltip-label">Saldo:</span> <strong>' +
          fmtR$(p.saldo) +
          '</strong>';
        if (m.descricao)
          html +=
            '<br><span class="projection-chart-tooltip-description">' +
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
      labels: { colors: resolveColor('var(--chart-text)') },
    },
    grid: { borderColor: resolveColor('var(--chart-grid)'), strokeDashArray: 3 },
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

function renderMovTable(movs) {
  const q = (document.getElementById('movSearch')?.value || '').toLowerCase();
  const ft = document.getElementById('movFilterTipo')?.value || '';
  const fd = document.getElementById('movFilterDirecao')?.value || '';

  // Calcula saldos cumulativos na ordem cronológica completa
  // (movs já vem ordenado ASC por getAllMovimentacoes, e o saldo_inicial é a 1ª pseudo-movimentação)
  let saldoAcum = 0;
  const movsWithSaldo = movs.map((m) => {
    saldoAcum += getProjectionMovementSignedValue(m);
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

  // A exibição preserva a ordem cronológica usada no cálculo do saldo acumulado.
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
              ? '<span class="projection-direction-icon is-entry" title="Entrada (recebeu verba)">⬅️</span>'
              : m.direcao === 'saida'
                ? '<span class="projection-direction-icon is-exit" title="Saída (liberou verba)">➡️</span>'
                : '<span class="projection-direction-icon is-invalid" title="Movimentação inválida: informe o insumo controlado na origem ou no destino">⚠️</span>';
          const valCls =
            m.direcao === 'entrada' ? 'pos' : m.direcao === 'saida' ? 'neg' : 'is-invalid';
          const valSign = m.direcao === 'entrada' ? '+' : m.direcao === 'saida' ? '-' : '';

          // Chips para origem do dado
          let chips = '';
          if (m.origem_dado === 'flow') {
            chips = `<span class="projection-origin-chip projection-origin-chip--flow" title="Importado do Flow #${escAttr(m.flow_n || '')}. Para alterar, vá na aba 🔗 Flows.">🔗 Flow #${escHtml(m.flow_n || '')}</span>`;
          } else if (m.origem_dado === 'inicial') {
            chips = `<span class="projection-origin-chip projection-origin-chip--initial">💰 Saldo inicial</span>`;
          } else if (m.origem_dado === 'manual') {
            chips = `<span class="projection-movement-actions">
        <button class="projection-movement-action projection-movement-action--edit" data-editor-only data-action="edit-mov" data-id="${escAttr(m.id)}" title="Editar">✏️ Editar</button>
        <button class="projection-movement-action projection-movement-action--delete" data-editor-only data-action="delete-mov" data-id="${escAttr(m.id)}" title="Excluir">🗑️ Excluir</button>
      </span>`;
          }

          const rowClass =
            m.origem_dado === 'flow'
              ? 'projection-movement-row--flow'
              : m.origem_dado === 'inicial'
                ? 'projection-movement-row--initial'
                : '';
          return `<tr class="${rowClass}">
      <td class="projection-movement-date">${escHtml(m.data_br || m.data || '')}</td>
      <td>${tipoBadge[m.tipo] || escHtml(m.tipo)}</td>
      <td class="projection-movement-direction">${dirIcon}</td>
      <td class="projection-movement-origin">${escHtml(m.origem || '—')}</td>
      <td class="projection-movement-origin">${escHtml(m.destino || '—')}</td>
      <td class="projection-movement-description-cell">
        <div class="projection-movement-description">
          <strong>${escHtml((m.descricao || '').slice(0, 80))}${(m.descricao || '').length > 80 ? '...' : ''}</strong>
          ${chips}
        </div>
        ${m.justificativa ? `<div class="projection-movement-justification">${escHtml(m.justificativa.slice(0, 80))}${m.justificativa.length > 80 ? '...' : ''}</div>` : ''}
      </td>
      <td class="projection-movement-responsible">${escHtml(m.responsavel || '—')}</td>
      <td class="num ${valCls}"><strong>${valSign}${fmt(m.valor || 0)}</strong></td>
      <td class="num"><span class="projection-movement-balance ${m._saldo < 0 ? 'is-negative' : 'is-positive'}">${fmt(m._saldo)}</span></td>
    </tr>`;
        })
        .join(''),
    );

  document.getElementById('movCount').textContent =
    filtered.length === movs.length
      ? `${movs.length} movimentações`
      : `${filtered.length} de ${movs.length} movimentações`;
}

function clearMovFilters() {
  ['movSearch', 'movFilterTipo', 'movFilterDirecao'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderProjCtrl();
}

// (Listeners dos filtros agora ficam em initProjCtrl)

function formatCurrencyInputWhileTyping(input) {
  const rawValue = input.value;
  const caret = input.selectionStart ?? rawValue.length;
  const valueBeforeCaret = rawValue.slice(0, caret);
  const negative = /^\s*-/.test(rawValue);
  const hasDecimalSeparator = rawValue.includes(',');
  const sanitized = rawValue.replace(/[^\d,]/g, '');
  const [integerPart = '', decimalPart = ''] = sanitized.split(',');
  const integerDigits = integerPart.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const decimalDigits = decimalPart.replace(/\D/g, '').slice(0, 2);

  if (!integerDigits && !hasDecimalSeparator) {
    input.value = negative ? '-' : '';
    input.setSelectionRange(input.value.length, input.value.length);
    return;
  }

  const formattedInteger = Number(integerDigits || 0).toLocaleString('pt-BR', {
    maximumFractionDigits: 0,
  });
  const formattedValue = `${negative ? '-' : ''}${formattedInteger}${hasDecimalSeparator ? `,${decimalDigits}` : ''}`;
  const commaBeforeCaret = valueBeforeCaret.includes(',');
  const digitsBeforeCaret = valueBeforeCaret.replace(/\D/g, '').length;
  let nextCaret = negative ? 1 : 0;

  if (commaBeforeCaret) {
    const decimalDigitsBeforeCaret = valueBeforeCaret
      .split(',')
      .slice(1)
      .join('')
      .replace(/\D/g, '').length;
    nextCaret = formattedValue.indexOf(',') + 1 + decimalDigitsBeforeCaret;
  } else {
    let countedDigits = 0;
    for (let index = nextCaret; index < formattedValue.length; index += 1) {
      if (!/\d/.test(formattedValue[index])) continue;
      countedDigits += 1;
      nextCaret = index + 1;
      if (countedDigits >= digitsBeforeCaret) break;
    }
  }

  input.value = formattedValue;
  input.setSelectionRange(nextCaret, nextCaret);
}

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
        <input type="text" id="mov_valor" required inputmode="decimal" autocomplete="off" value="${m && m.valor != null ? fmt(m.valor) : ''}" placeholder="ex: 12.500,00">
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
    <div class="projection-movement-form-note">
      💡 <strong>Aporte</strong> entra no saldo e <strong>Devolução</strong> sai do saldo. Em Remanejamento ou Aditivo, o insumo controlado (${escHtml(insumo)}) no <strong>Destino</strong> indica entrada; na <strong>Origem</strong>, saída.
    </div>
    </form>
  `,
  );
  const valueInput = document.getElementById('mov_valor');
  const typeInput = document.getElementById('mov_tipo');
  const originInput = document.getElementById('mov_origem');
  const destinationInput = document.getElementById('mov_destino');
  typeInput?.addEventListener('change', () => {
    const controlledDisplay = displayForValue(insumo);
    if (typeInput.value === 'aporte') {
      if (valueFromDisplay(originInput.value) === insumo) originInput.value = '';
      destinationInput.value = controlledDisplay;
    } else if (typeInput.value === 'devolucao') {
      originInput.value = controlledDisplay;
      if (valueFromDisplay(destinationInput.value) === insumo) destinationInput.value = '';
    } else if (!originInput.value && !destinationInput.value) {
      originInput.value = controlledDisplay;
    }
  });
  valueInput?.addEventListener('input', () => formatCurrencyInputWhileTyping(valueInput));
  valueInput?.addEventListener('blur', () => {
    const parsed = parseNumber(valueInput.value);
    if (parsed != null) valueInput.value = fmt(parsed);
  });
  openModal({ initialFocus: '#mov_tipo' });
}

async function saveMovForm(editingId) {
  if (!requireEditor('salvar movimentações')) return;
  const get = (id) => document.getElementById(id).value.trim();
  const tipo = get('mov_tipo');
  const data = get('mov_data');
  let origem = valueFromDisplay(get('mov_origem'));
  let destino = valueFromDisplay(get('mov_destino'));
  const desc = get('mov_desc');
  const resp = get('mov_resp');
  const valor = parseNumber(get('mov_valor'));
  const just = get('mov_just');

  if (!desc) {
    authToast('⚠️ Descrição é obrigatória.', 'warn', 3000);
    return;
  }
  if (valor == null || valor <= 0) {
    authToast('⚠️ Informe um valor maior que zero.', 'warn', 3000);
    return;
  }

  const insumo = PROJ_CTRL_STATE.insumo || 'I011890';
  if (tipo === 'aporte') {
    destino = insumo;
  } else if (tipo === 'devolucao') {
    origem = insumo;
  } else {
    if (origem === insumo && destino === insumo) {
      authToast('⚠️ Origem e Destino não podem ser o mesmo insumo controlado.', 'warn', 3500);
      return;
    }
    if (origem !== insumo && destino !== insumo) {
      authToast(
        `⚠️ Informe o insumo controlado (${insumo}) na Origem ou no Destino.`,
        'warn',
        4000,
      );
      return;
    }
  }

  // tentar converter data dd/mm/aaaa em ISO
  let iso = '';
  let dataBr = data;
  const mDt = data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (mDt) {
    const parsedDate = new Date(Date.UTC(Number(mDt[3]), Number(mDt[2]) - 1, Number(mDt[1])));
    if (
      parsedDate.getUTCFullYear() !== Number(mDt[3]) ||
      parsedDate.getUTCMonth() !== Number(mDt[2]) - 1 ||
      parsedDate.getUTCDate() !== Number(mDt[1])
    ) {
      authToast('⚠️ Informe uma data válida no formato dd/mm/aaaa.', 'warn', 3500);
      return;
    }
    iso = `${mDt[3]}-${mDt[2]}-${mDt[1]}`;
  } else {
    const m2 = data.match(/^(\d{2})\/(\d{4})$/);
    if (m2) {
      if (Number(m2[1]) < 1 || Number(m2[1]) > 12) {
        authToast('⚠️ Informe um mês válido no formato mm/aaaa.', 'warn', 3500);
        return;
      }
      iso = `${m2[2]}-${m2[1]}-01`;
      dataBr = `01/${m2[1]}/${m2[2]}`;
    } else {
      authToast('⚠️ Use o formato mm/aaaa ou dd/mm/aaaa.', 'warn', 3500);
      return;
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

export function createProjectionControlView({
  runtime,
  storage,
  feedback,
  modals,
  viewStates,
  dashboardRepository,
  authService,
  authUi,
  supabaseClient,
  state,
  flowEditor,
}) {
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
  APP_STATE = state;
  displayForValue = flowEditor.displayForValue;
  valueFromDisplay = flowEditor.valueFromDisplay;
  const api = {
    loadProjCtrl,
    applyLocksToUI,
    initProjCtrl,
    renderProjCtrl,
    editMov,
    deleteMov,
    getState: () => PROJ_CTRL_STATE,
    setState: (value) => {
      PROJ_CTRL_STATE = value;
    },
    getAllMovimentacoes,
    toggleLockCampo,
    clearMovFilters,
    openMovForm,
    saveMovForm,
  };
  document.getElementById('movTbody')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    event.stopPropagation();
    if (button.dataset.action === 'edit-mov') editMov(button.dataset.id);
    if (button.dataset.action === 'delete-mov') deleteMov(button.dataset.id);
  });
  return Object.freeze(api);
}
