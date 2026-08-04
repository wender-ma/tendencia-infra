import { replaceWithParsedMarkup } from '../dom.mjs';
import { debounce, formatNumber as fmt, formatNumber as fmtR$ } from '../dashboard-runtime.mjs';
import { STORAGE_KEYS } from '../../config.js';
import { escAttr, escHtml, formatDate } from '../formatters.mjs';
import { bindSortableHeaders, updateSortHeaderState } from '../table-interactions.mjs';
import {
  formatReflectionMonth,
  isReflectedStatus,
  normalizeReflectionStatus,
  reflectionMonthInputValue,
  resolveReflectionMonth,
} from '../../services/flow-reflection.mjs';

const STORAGE_KEY = STORAGE_KEYS.classifications;
const FILTERS_STORAGE_KEY = STORAGE_KEYS.flowFilters;

let runAsyncSafely;
let getFlowsObraAtiva;
let SafeStorage;
let renderDashboardState;
let supaPatchClassification;
let isEditorDaObraAtiva;
let requireEditor;
let APP_STATE;
let deleteManual;
let msUpdateBtn;
let msResetAll;
let msMatches;
let MS_EXCLUDED;
let MASS_SELECTED;
let renderInsumoSelect;
let syncSelectAllHeader;
let updateMassBar;
let readClassificationMap;
let syncAllViewsFromFlows;
let restoredFilterProject = null;

function activeFilterStorageKey() {
  return `${FILTERS_STORAGE_KEY}:${APP_STATE.obra.ativa || 'sem-obra'}`;
}

function persistFlowFilters() {
  if (!MS_EXCLUDED || restoredFilterProject !== APP_STATE.obra.ativa) return;
  const excluded = Object.fromEntries(
    ['refletido', 'dep', 'destino', 'origem'].map((key) => [key, [...MS_EXCLUDED[key]]]),
  );
  SafeStorage.set(
    activeFilterStorageKey(),
    JSON.stringify({
      search: document.getElementById('flowSearch')?.value || '',
      reflectedMonth: document.getElementById('flowFilterRefletidoMes')?.value || '',
      excluded,
    }),
  );
}

function restoreFlowFilters() {
  const project = APP_STATE.obra.ativa;
  if (restoredFilterProject === project || !MS_EXCLUDED) return;
  msResetAll();
  let saved = {};
  try {
    saved = JSON.parse(SafeStorage.get(activeFilterStorageKey(), '{}')) || {};
  } catch {
    saved = {};
  }
  const search = document.getElementById('flowSearch');
  const reflectedMonth = document.getElementById('flowFilterRefletidoMes');
  if (search) search.value = String(saved.search || '');
  if (reflectedMonth) reflectedMonth.value = String(saved.reflectedMonth || '');
  for (const key of ['refletido', 'dep', 'destino', 'origem']) {
    MS_EXCLUDED[key].clear();
    for (const value of saved.excluded?.[key] || []) MS_EXCLUDED[key].add(String(value));
    msUpdateBtn(key);
  }
  restoredFilterProject = project;
}

// ============ FLOWS TAB ============
let interactionsBound = false;

function bindFlowInteractions() {
  if (interactionsBound) return;
  interactionsBound = true;

  bindSortableHeaders(
    'th[data-sort-flow]',
    'data-sort-flow',
    () => ({ key: APP_STATE.sort.keyF, direction: APP_STATE.sort.dirF }),
    (key) => {
      if (APP_STATE.sort.keyF === key) APP_STATE.sort.dirF = -APP_STATE.sort.dirF;
      else {
        APP_STATE.sort.keyF = key;
        APP_STATE.sort.dirF = -1;
      }
      updateSortHeaderState(
        'th[data-sort-flow]',
        'data-sort-flow',
        APP_STATE.sort.keyF,
        APP_STATE.sort.dirF,
      );
      renderFlowTable();
    },
  );

  document.getElementById('flowTbody')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="delete-manual"]');
    if (button) deleteManual(button.dataset.n);
  });

  const debouncedFlowTable = debounce(renderFlowTable, 300);
  ['flowSearch', 'flowFilterRefletidoMes'].forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener('input', debouncedFlowTable);
      element.addEventListener('change', debouncedFlowTable);
    }
  });
}

function renderFlows() {
  restoreFlowFilters();
  bindFlowInteractions();
  // guard sem dados de Flows
  if (!Array.isArray(getFlowsObraAtiva()) || getFlowsObraAtiva().length === 0) {
    const flowSummary = document.getElementById('flowSummaryBars');
    const flowsByTipo = document.getElementById('flowsByTipo');
    const flowsTbody = document.getElementById('flowTbody');
    if (flowSummary)
      renderDashboardState(flowSummary, {
        title: 'Sem aditivos carregados',
        message: 'Envie a planilha de Flows para consultar os aditivos desta obra.',
        action: { label: 'Ir para Uploads', tab: 'uploads' },
      });
    if (flowsByTipo) flowsByTipo.replaceChildren();
    if (flowsTbody)
      renderDashboardState(flowsTbody, {
        title: 'Sem aditivos para listar',
        compact: true,
        tableColspan: 12,
      });
    document.getElementById('flowsByMotivo')?.replaceChildren();
    document.getElementById('flowsDescartados')?.replaceChildren();
    const flowCount = document.getElementById('flowCount');
    if (flowCount) flowCount.textContent = '0 aditivos';
    return;
  }
  const total = getFlowsObraAtiva().length;
  const byDep = {};
  getFlowsObraAtiva().forEach((f) => {
    byDep[f.dep] = (byDep[f.dep] || 0) + 1;
  });
  const sumFm = (arr) => arr.reduce((s, f) => s + (f.custo_flowmaster || 0), 0);
  // Cancelado agora é uma classificação própria (some pelo dep OU pelo tipo)
  const isCancelado = (f) => f.dep === 'Cancelado' || f.tipo === 'cancelado';
  const isNaoRefletir = (f) => !isCancelado(f) && f.refletido_status === 'nao';
  const active = getFlowsObraAtiva().filter((f) => !isCancelado(f) && !isNaoRefletir(f));
  const tipoSums = {};
  ['aumento_real', 'remanejamento', 'economia', 'pendente'].forEach((t) => {
    const arr = active.filter((f) => f.tipo === t);
    tipoSums[t] = { n: arr.length, v: sumFm(arr) };
  });
  const semClassVivos = active.filter((f) => f.tipo === 'sem_classificacao');
  if (semClassVivos.length) {
    tipoSums['sem_classificacao'] = { n: semClassVivos.length, v: sumFm(semClassVivos) };
  }
  const cancelados = getFlowsObraAtiva().filter(isCancelado);
  if (cancelados.length) {
    tipoSums['cancelado'] = { n: cancelados.length, v: sumFm(cancelados) };
  }
  const descartados = getFlowsObraAtiva().filter(isNaoRefletir);
  const totalValue = sumFm(getFlowsObraAtiva());
  const finalizedRows = getFlowsObraAtiva().filter((f) => f.dep === 'Finalizado');
  const inProgressRows = getFlowsObraAtiva().filter(
    (f) => !['Cancelado', 'Finalizado'].includes(f.dep),
  );
  const canceledRows = getFlowsObraAtiva().filter((f) => f.dep === 'Cancelado');
  const summaryRows = [
    { key: 'total', label: '📋 Total de aditivos', count: total, value: totalValue },
    {
      key: 'finalizado',
      label: '✅ Finalizados',
      count: byDep.Finalizado || 0,
      value: sumFm(finalizedRows),
    },
    {
      key: 'andamento',
      label: '🟡 Em andamento',
      count: inProgressRows.length,
      value: sumFm(inProgressRows),
    },
    {
      key: 'cancelado',
      label: '⚪ Cancelados',
      count: byDep.Cancelado || 0,
      value: sumFm(canceledRows),
    },
    {
      key: 'aumento-real',
      label: '🔴 Aumento real',
      count: tipoSums.aumento_real.n,
      value: tipoSums.aumento_real.v,
    },
  ];
  const summaryMax = Math.max(...summaryRows.map((row) => Math.abs(row.value)), 1);

  replaceWithParsedMarkup(
    document.getElementById('flowSummaryBars'),
    summaryRows
      .map(
        (row) => `
    <div class="top-item flow-summary-item">
      <div class="name">${row.label} <span class="top-item-count">(${row.count})</span></div>
      <div class="val">${fmtR$(row.value)}</div>
      <progress class="top-bar-progress top-bar-progress--summary-${row.key}" max="${summaryMax}" value="${Math.abs(row.value)}">${Math.abs(row.value)}</progress>
    </div>`,
      )
      .join(''),
  );

  // Tipos com barras
  const labels = {
    aumento_real: '🔴 Aumento real',
    remanejamento: '🔵 Remanejamento',
    economia: '🟢 Economia',
    pendente: '🟡 Pendente',
    cancelado: '🚫 Cancelado',
    sem_classificacao: '⚪ Sem classificação',
  };
  const maxV = Math.max(...Object.values(tipoSums).map((t) => Math.abs(t.v)), 1);
  replaceWithParsedMarkup(
    document.getElementById('flowsByTipo'),
    Object.entries(tipoSums)
      .map(
        ([t, v]) => `
    <div class="top-item">
      <div class="name">${labels[t]} <span class="top-item-count">(${v.n})</span></div>
      <div class="val">${fmtR$(v.v)}</div>
      <progress class="top-bar-progress top-bar-progress--${t}" max="${maxV}" value="${Math.abs(v.v)}">${Math.abs(v.v)}</progress>
    </div>`,
      )
      .join(''),
  );
  // caixinha só aparece se houver "não refletir" (cancelados já viraram linha na lista)
  const elDesc = document.getElementById('flowsDescartados');
  if (elDesc) {
    if (descartados.length) {
      const valDesc = sumFm(descartados);
      replaceWithParsedMarkup(
        elDesc,
        `
        <div class="flow-discarded-summary">
          <span>❌ <strong>Marcados como "Não refletir":</strong> ${descartados.length} aditivo(s)</span>
          <strong class="flow-discarded-value">${fmtR$(valDesc)}</strong>
        </div>
      `,
      );
    } else {
      elDesc.replaceChildren();
    }
  }

  // Motivos (só não cancelados)
  const byMot = {};
  active.forEach((f) => {
    const m = f.motivo || 'Não informado';
    if (!byMot[m]) byMot[m] = { n: 0, v: 0 };
    byMot[m].n += 1;
    byMot[m].v += f.custo_flowmaster || 0;
  });
  const motArr = Object.entries(byMot)
    .sort((a, b) => Math.abs(b[1].v) - Math.abs(a[1].v))
    .slice(0, 6);
  const maxM = Math.max(...motArr.map((m) => Math.abs(m[1].v)), 1);
  replaceWithParsedMarkup(
    document.getElementById('flowsByMotivo'),
    motArr
      .map(
        ([m, v]) => `
    <div class="top-item">
      <div class="name">${escHtml(m)} <span class="top-item-count">(${v.n})</span></div>
      <div class="val ${v.v < 0 ? 'pos' : 'neg'}">${v.v >= 0 ? '+' : ''}${fmtR$(v.v)}</div>
      <progress class="top-bar-progress ${v.v < 0 ? 'top-bar-progress--green' : ''}" max="${maxM}" value="${Math.abs(v.v)}">${Math.abs(v.v)}</progress>
    </div>`,
      )
      .join(''),
  );

  // Filtros multi-select: apenas atualizar labels dos botões (panel é renderizado on-demand)
  ['refletido', 'dep', 'destino', 'origem'].forEach((k) => msUpdateBtn(k));

  renderFlowTable();
}

function clearFlowFilters() {
  ['flowSearch', 'flowFilterRefletidoMes'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  msResetAll();
  renderFlowTable();
}

function renderReflectionMonth(f) {
  const status = normalizeReflectionStatus(f.refletido_status);
  if (!isReflectedStatus(status)) {
    return '<span class="flow-reflection-month-empty">—</span>';
  }
  if (!isEditorDaObraAtiva()) {
    return `<span>${escHtml(formatReflectionMonth(f.refletido_mes))}</span>`;
  }
  return `<input type="month" class="refletido-month-input" data-edit-control
    value="${escAttr(reflectionMonthInputValue(f.refletido_mes))}"
    data-n="${escAttr(f.n_alteracao)}"
    data-change-action="onRefletidoMonthChange" data-action-mode="self"
    aria-label="Mês em que o Flow ${escAttr(f.n_alteracao)} foi refletido no planejamento"
    title="Mês em que o Flow foi refletido no planejamento">`;
}

function renderFlowTable() {
  bindFlowInteractions();
  persistFlowFilters();
  const q = document.getElementById('flowSearch').value.toLowerCase();
  const reflectedMonth = document.getElementById('flowFilterRefletidoMes')?.value || '';
  const editDisabled = isEditorDaObraAtiva() ? '' : ' disabled';

  const rows = getFlowsObraAtiva().filter((f) => {
    if (q) {
      const txt =
        `${f.n_alteracao || ''} ${f.descricao} ${f.justificativa} ${f.motivo} ${f.insumo_planejamento} ${f.insumo_remanejamento} ${f.solicitante || ''} ${f.observacao_classificacao || ''}`.toLowerCase();
      if (!txt.includes(q)) return false;
    }
    if (!msMatches('dep', f.dep)) return false;
    // Refletido: status do aditivo (precisa default 'pendente')
    const fStat = f.refletido_status || 'pendente';
    if (!msMatches('refletido', fStat)) return false;
    if (reflectedMonth && String(f.refletido_mes || '').slice(0, 7) !== reflectedMonth)
      return false;
    if (!msMatches('destino', f.insumo_planejamento)) return false;
    if (!msMatches('origem', f.insumo_remanejamento)) return false;
    return true;
  });

  rows.sort((a, b) => {
    let va = a[APP_STATE.sort.keyF],
      vb = b[APP_STATE.sort.keyF];
    if (va == null) va = '';
    if (vb == null) vb = '';
    if (typeof va === 'string' && typeof vb === 'string') {
      if (APP_STATE.sort.keyF === 'n_alteracao')
        return APP_STATE.sort.dirF * (parseInt(va) - parseInt(vb));
      return APP_STATE.sort.dirF * va.localeCompare(vb);
    }
    return APP_STATE.sort.dirF * (va - vb);
  });

  const tipoLabel = {
    aumento_real: '<span class="badge red">🔴 Aum.real</span>',
    remanejamento: '<span class="badge cyan">🔵 Remanej.</span>',
    economia: '<span class="badge green">🟢 Economia</span>',
    pendente: '<span class="badge amber">🟡 Pendente</span>',
    cancelado: '<span class="badge gray">🚫 Cancelado</span>',
    sem_classificacao: '<span class="badge gray">⚪ Sem class.</span>',
    misto: '<span class="badge gray">⚪ Misto</span>',
  };
  const depBadge = {
    Finalizado: 'green',
    Projeto: 'amber',
    Cancelado: 'gray',
    Planejamento: 'blue',
    Orçamento: 'blue',
    Obra: 'amber',
  };
  const flowPage = { items: rows, start: rows.length ? 1 : 0, end: rows.length };

  replaceWithParsedMarkup(
    document.getElementById('flowTbody'),
    flowPage.items
      .map((f) => {
        const valEdited = f._edited_v ? ' edited' : '';
        const valCls =
          (f.custo_flowmaster || 0) < 0 ? 'neg' : (f.custo_flowmaster || 0) > 0 ? 'pos' : '';
        const valStr = f.custo_flowmaster != null ? fmt(f.custo_flowmaster) : '';
        const manualBadge = f.is_manual ? '<span class="badge-manual">✋ Manual</span>' : '';
        const delBtn = f.is_manual
          ? `<button class="btn-del-manual" data-editor-only data-action="delete-manual" data-n="${escAttr(f.n_alteracao)}" title="Excluir este aditivo manual" aria-label="Excluir aditivo manual ${escAttr(f.n_alteracao)}">🗑️</button>`
          : '';
        const status = normalizeReflectionStatus(f.refletido_status);
        const statusClass = isReflectedStatus(status)
          ? 'flow-status-sim'
          : status === 'nao'
            ? 'flow-status-nao'
            : '';
        const isSelected = MASS_SELECTED.has(f.n_alteracao);
        return `
    <tr class="${statusClass} ${isSelected ? 'row-selected' : ''}" data-n="${escAttr(f.n_alteracao)}">
      <td class="flow-selection-cell">
        <input class="flow-selection-input" type="checkbox" ${isSelected ? 'checked' : ''} data-edit-control${editDisabled} data-n="${escAttr(f.n_alteracao)}" data-change-action="toggleMassSelect" data-action-mode="self">
      </td>
      <td class="flow-status-cell">
        <select class="refletido-select status-${escAttr(f.refletido_status || 'pendente')}" data-edit-control${editDisabled} data-n="${escAttr(f.n_alteracao)}" data-change-action="onRefletidoChange" data-action-mode="self" title="Status de reflexo no planejamento">
          <option value="pendente" ${(f.refletido_status || 'pendente') === 'pendente' ? 'selected' : ''}>⏳ Pendente</option>
          <option value="sim" ${f.refletido_status === 'sim' ? 'selected' : ''}>✅ Sim</option>
          <option value="ipca" ${f.refletido_status === 'ipca' ? 'selected' : ''}>📈 IPCA</option>
          <option value="incc" ${f.refletido_status === 'incc' ? 'selected' : ''}>🏗️ INCC</option>
          <option value="nao" ${f.refletido_status === 'nao' ? 'selected' : ''}>❌ Não</option>
        </select>
      </td>
      <td class="flow-reflection-month-cell">${renderReflectionMonth(f)}</td>
      <td>${escHtml(f.n_alteracao)}${manualBadge}${delBtn}</td>
      <td class="flow-date-cell">${escHtml(formatDate(f.data_br))}</td>
      <td><span class="badge ${depBadge[f.dep] || 'gray'}">${escHtml(f.dep || '')}</span></td>
      <td>${tipoLabel[f.tipo] || ''}</td>
      <td class="classif-cell">${renderInsumoSelect(f, 'insumo_planejamento')}</td>
      <td class="classif-cell">${renderInsumoSelect(f, 'insumo_remanejamento')}</td>
      <td class="classif-cell"><input type="text" class="valor-input ${valCls}${valEdited}" data-edit-control${editDisabled}
        value="${escAttr(valStr)}" data-n="${escAttr(f.n_alteracao)}"
        data-change-action="onValorChange" data-action-mode="self" data-select-on-focus
        title="Aceita valores como 1234,56 ou -1.234,56" placeholder="0,00"></td>
      <td class="flow-reason-cell"><strong>${escHtml(f.motivo || '')}</strong><br><span class="flow-reason-description">${escHtml((f.descricao || '').length > 110 ? (f.descricao || '').slice(0, 107) + '...' : f.descricao || '')}</span></td>
      <td class="flow-notes-cell"><input type="text" class="flow-notes-input" data-edit-control${editDisabled}
        value="${escAttr(f.observacao_classificacao || '')}" maxlength="500" data-n="${escAttr(f.n_alteracao)}"
        data-change-action="onFlowNotesChange" data-action-mode="self"
        aria-label="Observações ou anotações do Flow ${escAttr(f.n_alteracao)}" placeholder="Adicionar anotação..."></td>
    </tr>`;
      })
      .join(''),
  );
  updateSortHeaderState(
    'th[data-sort-flow]',
    'data-sort-flow',
    APP_STATE.sort.keyF,
    APP_STATE.sort.dirF,
  );
  // Sincronizar checkbox header e barra de massa
  syncSelectAllHeader();
  updateMassBar();
}

// Handler do select de reflexo, incluindo os índices de inflação incorporada.
function onRefletidoChange(sel) {
  if (!requireEditor('alterar o status de reflexo')) {
    renderFlowTable();
    return;
  }
  const nAlt = sel.dataset.n;
  const status = normalizeReflectionStatus(sel.value);
  const f = getFlowsObraAtiva().find((x) => x.n_alteracao === nAlt);
  if (!f) return;
  f.refletido_status = status;
  f.refletido_mes = resolveReflectionMonth(status, f.refletido_mes);
  f.refletido = isReflectedStatus(status);
  // chave composta + sync Supabase
  const codigoObra = f.codigo_obra || APP_STATE.obra.ativa || '';
  const key = codigoObra + ':' + nAlt;
  const map = readClassificationMap();
  if (!map[key]) map[key] = { codigo_obra: codigoObra };
  map[key].refletido_status = status;
  map[key].refletido_mes = f.refletido_mes;
  map[key].refletido = isReflectedStatus(status);
  SafeStorage.set(STORAGE_KEY, JSON.stringify(map));
  void runAsyncSafely(
    supaPatchClassification(
      nAlt,
      { refletido_status: status, refletido_mes: f.refletido_mes },
      codigoObra,
    ),
    'Classificações/salvar reflexo no Supabase',
    'O status foi salvo apenas neste navegador.',
  );
  // Atualizar visual: cor da linha e classe do select
  const tr = sel.closest('tr');
  if (tr) {
    tr.classList.remove('flow-status-sim', 'flow-status-nao');
    if (isReflectedStatus(status)) tr.classList.add('flow-status-sim');
    if (status === 'nao') tr.classList.add('flow-status-nao');
  }
  sel.className = 'refletido-select status-' + status;
  renderFlowTable();
  // Sincronizar TODAS as telas (Visão Geral, Tendência de Obra, Controle Projeção)
  syncAllViewsFromFlows();
}

function onRefletidoMonthChange(input) {
  if (!requireEditor('alterar o mês de reflexo')) {
    renderFlowTable();
    return;
  }
  const nAlt = input.dataset.n;
  const f = getFlowsObraAtiva().find((flow) => flow.n_alteracao === nAlt);
  if (!f || !isReflectedStatus(f.refletido_status)) {
    renderFlowTable();
    return;
  }
  const reflectedMonth = input.value
    ? resolveReflectionMonth(f.refletido_status, input.value)
    : null;
  f.refletido_mes = reflectedMonth;
  const codigoObra = f.codigo_obra || APP_STATE.obra.ativa || '';
  const key = `${codigoObra}:${nAlt}`;
  const map = readClassificationMap();
  if (!map[key]) map[key] = { codigo_obra: codigoObra };
  map[key].refletido_mes = reflectedMonth;
  SafeStorage.set(STORAGE_KEY, JSON.stringify(map));
  void runAsyncSafely(
    supaPatchClassification(nAlt, { refletido_mes: reflectedMonth }, codigoObra),
    'Classificações/salvar mês de reflexo no Supabase',
    'O mês de reflexo foi salvo apenas neste navegador.',
  );
  renderFlowTable();
}

function onFlowNotesChange(input) {
  if (!requireEditor('editar observações dos aditivos')) {
    renderFlowTable();
    return;
  }
  const flow = getFlowsObraAtiva().find((item) => item.n_alteracao === input.dataset.n);
  if (!flow) return;
  const observation = input.value.trim().slice(0, 500);
  flow.observacao_classificacao = observation;
  const codigoObra = flow.codigo_obra || APP_STATE.obra.ativa || '';
  const key = `${codigoObra}:${flow.n_alteracao}`;
  const map = readClassificationMap();
  if (!map[key]) map[key] = { codigo_obra: codigoObra };
  map[key].observacao = observation;
  SafeStorage.set(STORAGE_KEY, JSON.stringify(map));
  void runAsyncSafely(
    supaPatchClassification(flow.n_alteracao, { observacao: observation || null }, codigoObra),
    'Classificações/salvar observação',
    'A observação foi salva apenas neste navegador.',
  );
}

export function createFlowsView({
  runtime,
  storage,
  viewStates,
  dashboardRepository,
  authService,
  authUi,
  state,
  flowEditor,
}) {
  runAsyncSafely = runtime.runAsyncSafely;
  getFlowsObraAtiva = runtime.getActiveFlows;
  SafeStorage = storage;
  renderDashboardState = viewStates.render;
  supaPatchClassification = dashboardRepository.patchClassification;
  isEditorDaObraAtiva = authService.canEditActiveProject;
  requireEditor = authUi.requireEditor;
  APP_STATE = state;
  deleteManual = flowEditor.deleteManual;
  msUpdateBtn = flowEditor.msUpdateBtn;
  msResetAll = flowEditor.msResetAll;
  msMatches = flowEditor.msMatches;
  MS_EXCLUDED = flowEditor.getExcludedFilters();
  MASS_SELECTED = flowEditor.getMassSelection();
  renderInsumoSelect = flowEditor.renderInsumoSelect;
  syncSelectAllHeader = flowEditor.syncSelectAllHeader;
  updateMassBar = flowEditor.updateMassBar;
  readClassificationMap = flowEditor.readClassificationMap;
  syncAllViewsFromFlows = flowEditor.syncAllViewsFromFlows;
  return Object.freeze({
    renderFlows,
    renderFlowTable,
    clearFlowFilters,
    onRefletidoChange,
    onRefletidoMonthChange,
    onFlowNotesChange,
  });
}
