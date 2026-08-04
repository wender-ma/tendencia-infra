import { replaceWithParsedMarkup } from '../dom.mjs';
import { PROJECTION_CATALOG } from '../../data/projection-catalog.mjs';
import { STORAGE_KEYS } from '../../config.js';
import { escAttr, escHtml, formatDate } from '../formatters.mjs';
import { isTableRowActivation, updateSortHeaderState } from '../table-interactions.mjs';
import {
  formatCompactNumber as fmtR$k,
  formatNumber as fmt,
  formatNumber as fmtR$,
} from '../dashboard-runtime.mjs';
import { parseNumber } from '../../parsers/shared.mjs';
import {
  buildHybridInputForecast,
  buildPhysicalForecastContext,
  FORECAST_METHOD_LABELS,
  normalizeInputForecastConfig,
} from '../../services/projection-forecast.mjs';
import {
  buildWorkforcePlan,
  normalizeWorkforceState,
  WORKFORCE_INPUTS,
} from './projection-workforce.mjs';
import { isReflectedStatus } from '../../services/flow-reflection.mjs';

const HIERARQUIA = PROJECTION_CATALOG.hierarchy;
const SERVICOS_META = PROJECTION_CATALOG.services;
const INSUMOS_META = PROJECTION_CATALOG.inputs;

let reportNonFatalError;
let resolveColor;
let renderApexChart;
let getProjRawObraAtiva;
let getFlowsObraAtiva;
let ensureXlsx;
let authToast;
let openModal;
let renderDashboardState;
let APP_STATE;
let renderAderenciaProj;
let getProjectionControlState;
let workforceRepository;
let canEditWorkforce;
let forecastRepository;
let canManageForecast;
let renderVisao;
let SafeStorage;
let projectionSettingsProject = null;
let projectionChartLocked = false;
let projectionDifferenceContext = null;
let projectionDifferenceSelectedMonth = null;
let projectionMonthlyTableModel = null;
let projectionColumnResize = null;
let projectionActiveColumnWidths = {};
let projectionColumnGroupProject = null;
let projectionColumnGroups = { summary: true, adherence: true };
let projectionWorkforceChartMode = 'effective';
const projectionWorkforceSaveTimers = new Map();
let projectionWorkforceRenderTimer = null;

const PROJECTION_SETTINGS_KEY = STORAGE_KEYS.projectionSettings;
const PROJECTION_COLUMN_WIDTHS_KEY = STORAGE_KEYS.projectionColumnWidths;
const PROJECTION_COLUMN_GROUPS_KEY = STORAGE_KEYS.projectionColumnGroups;
const PROJECTION_STATIC_COLUMNS = Object.freeze([
  { id: 'label', label: 'Grupo / Serviço / Insumo', width: 360, min: 240, max: 520 },
  { id: 'planned', group: 'summary', label: 'Valor planejado', width: 140, min: 110, max: 220 },
  { id: 'realized', group: 'summary', label: 'Realizado', width: 150, min: 110, max: 230 },
  { id: 'balance', group: 'summary', label: 'Saldo', width: 130, min: 100, max: 210 },
  { id: 'extrapolation', group: 'summary', label: 'Extrapolação', width: 140, min: 110, max: 230 },
  { id: 'tendency', group: 'summary', label: 'Tendência', width: 140, min: 110, max: 230 },
  {
    id: 'previousPlanned',
    group: 'adherence',
    label: 'Planejado anterior',
    width: 170,
    min: 130,
    max: 250,
  },
  {
    id: 'currentConsolidated',
    group: 'adherence',
    label: 'Consolidado atual',
    width: 170,
    min: 130,
    max: 250,
  },
  {
    id: 'adherenceDifference',
    group: 'adherence',
    label: 'Diferença',
    width: 140,
    min: 110,
    max: 220,
  },
]);
const PROJECTION_MONTH_COLUMN = Object.freeze({ width: 120, min: 90, max: 190 });
const PROJECTION_FORECAST_VERSION = 2;

// ============ TENDÊNCIA DE OBRA (PROJEÇÃO) ============

// APP_STATE.dados.projRaw declarado na seção ESTADO GLOBAL acima

// Definir mês corrente (default)
function defaultDataCorte() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function defaultDataFim() {
  // último mês do CSV
  // v0.58b: usa dados da obra ativa
  const _p =
    typeof getProjRawObraAtiva === 'function' ? getProjRawObraAtiva() : APP_STATE.dados.projRaw;
  if (!_p.length) return defaultDataCorte();
  return _p
    .map((r) => r.mes)
    .sort()
    .slice(-1)[0];
}

function activeProjectionProjectKey() {
  return String(APP_STATE?.obra?.ativa || '__global__');
}

function activeProjectionManagement() {
  const projectCode = activeProjectionProjectKey();
  return APP_STATE?.dados?.historico?.projectionManagementByProject?.[projectCode] || 'Atual';
}

function readProjectionSettings() {
  try {
    const parsed = JSON.parse(SafeStorage?.get(PROJECTION_SETTINGS_KEY, '{}') || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function savedDataFim() {
  const value = readProjectionSettings()[activeProjectionProjectKey()]?.dataFim;
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) ? value : '';
}

function saveDataFim(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) return;
  const settings = readProjectionSettings();
  const projectKey = activeProjectionProjectKey();
  settings[projectKey] = { ...(settings[projectKey] || {}), dataFim: value };
  SafeStorage?.set(PROJECTION_SETTINGS_KEY, JSON.stringify(settings));
}

function syncProjectionInputs() {
  const projectKey = activeProjectionProjectKey();
  const dfInput = document.getElementById('projDataFim');
  const dcInput = document.getElementById('projDataCorte');
  if (projectKey !== projectionSettingsProject && dfInput) {
    dfInput.value = savedDataFim() || defaultDataFim();
    projectionSettingsProject = projectKey;
  }
  if (dcInput) dcInput.value = defaultDataCorte();
}

// Metadados de serviço (descrição + grupo) — pré-carregado da Tendência

function initProjecao() {
  // v0.58b: verifica se há dados PARA A OBRA ATIVA
  const _proj = getProjRawObraAtiva();
  if (!_proj.length) {
    renderDashboardState('projChart', {
      title: 'Projeção sem dados mensais',
      message: 'Envie a planilha de Gestões para calcular a tendência da obra.',
      action: { label: 'Ir para Uploads', tab: 'uploads' },
    });
    document.getElementById('projKpis').replaceChildren();
    renderDashboardState('projTbody', {
      title: 'Sem serviços para projetar',
      compact: true,
      tableColspan: 6,
    });
    document.getElementById('projCount').textContent = '0 serviços';
    return;
  }
  const ultimo = defaultDataFim();
  document.getElementById('projUltimoMes').textContent = formatMonthLabel(ultimo);
  const source = document.getElementById('projBaseManagement');
  if (source) source.textContent = activeProjectionManagement();
  syncProjectionInputs();
  // popular filtro de grupos
  const fg = document.getElementById('projFilterGrupo');
  if (fg && fg.options.length <= 1) {
    const grupos = [...new Set(Object.values(SERVICOS_META).map((s) => s.grupo))].sort();
    grupos.forEach((g) => {
      const o = document.createElement('option');
      o.value = g;
      o.textContent = g;
      fg.appendChild(o);
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
  const meses = [
    'jan',
    'fev',
    'mar',
    'abr',
    'mai',
    'jun',
    'jul',
    'ago',
    'set',
    'out',
    'nov',
    'dez',
  ];
  return `${meses[parseInt(m) - 1]}/${y}`;
}

function formatEditableNumber(value) {
  return Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizeToleranciaInput(input) {
  if (!input || !String(input.value).trim()) return;
  const value = parseNumber(input.value);
  if (value != null) input.value = formatEditableNumber(value);
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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function buildMonthRange(start, end) {
  if (!/^\d{4}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}$/.test(end || '') || start > end) {
    return [];
  }
  const months = [];
  let current = start;
  while (current <= end) {
    months.push(current);
    current = addMonths(current, 1);
  }
  return months;
}

export function buildProjectionCurve(
  monthlyValues,
  projections,
  dataCorte,
  dataFim,
  pendingFlowImpact = 0,
  monthlyAdjustments = {},
) {
  const sourceMonths = Object.keys(monthlyValues || {})
    .filter((month) => !dataFim || month <= dataFim)
    .sort();
  if (!sourceMonths.length) {
    return { months: [], planned: [], tendency: [], trendStart: null };
  }

  const lastSourceMonth = sourceMonths[sourceMonths.length - 1];
  const chartEnd = dataFim && dataFim > lastSourceMonth ? dataFim : lastSourceMonth;
  const months = buildMonthRange(sourceMonths[0], chartEnd);
  const extrapolationByMonth = {};
  for (const projection of projections || []) {
    if (projection.extrapolationByMonth) {
      for (const [month, value] of Object.entries(projection.extrapolationByMonth)) {
        if (month <= chartEnd) {
          extrapolationByMonth[month] = (extrapolationByMonth[month] || 0) + (Number(value) || 0);
        }
      }
      continue;
    }
    if (
      projection.extrapolacao <= 0 ||
      !projection.ultimo_mes_planejado ||
      projection.meses_gap <= 0
    ) {
      continue;
    }
    const monthlyExtrapolation = projection.extrapolacao / projection.meses_gap;
    let month = projection.ultimo_mes_planejado;
    for (let index = 0; index < projection.meses_gap; index += 1) {
      month = addMonths(month, 1);
      if (month <= chartEnd) {
        extrapolationByMonth[month] = (extrapolationByMonth[month] || 0) + monthlyExtrapolation;
      }
    }
  }

  const trendStart =
    dataCorte < months[0] ? months[0] : dataCorte > chartEnd ? chartEnd : dataCorte;
  const flowImpactMonth = trendStart;
  let plannedAccumulated = 0;
  let tendencyAccumulated = 0;
  const planned = [];
  const tendency = [];
  for (const month of months) {
    const baseValue = monthlyValues[month] || 0;
    plannedAccumulated += baseValue;
    tendencyAccumulated +=
      baseValue + (extrapolationByMonth[month] || 0) + (monthlyAdjustments[month] || 0);
    if (month === flowImpactMonth) tendencyAccumulated += pendingFlowImpact || 0;
    planned.push(plannedAccumulated);
    tendency.push(month < trendStart ? null : tendencyAccumulated);
  }

  if (tendency.length) {
    const expectedFinal =
      planned[planned.length - 1] +
      (projections || []).reduce((sum, projection) => sum + (projection.extrapolacao || 0), 0) +
      (pendingFlowImpact || 0) +
      Object.values(monthlyAdjustments).reduce((sum, value) => sum + (Number(value) || 0), 0);
    tendency[tendency.length - 1] = expectedFinal;
  }

  return { months, planned, tendency, trendStart };
}

export function buildWorkforceCurveAdjustments({
  inputProjections = [],
  workforcePlan = null,
  dataCorte,
  dataFim,
} = {}) {
  const months = buildMonthRange(dataCorte, dataFim);
  const adjustments = Object.fromEntries(months.map((month) => [month, 0]));
  if (!workforcePlan) return adjustments;
  for (const input of WORKFORCE_INPUTS) {
    if (!workforcePlan.enabledByInput?.[input]) continue;
    const projections = inputProjections.filter((projection) => projection.insumo === input);
    const extrapolations = projections.map((projection) =>
      projectionMonthlyExtrapolation(projection, months, dataFim),
    );
    months.forEach((month) => {
      const replacedBase = projections.reduce(
        (sum, projection) => sum + (Number(projection.meses?.[month]) || 0),
        0,
      );
      const replacedExtrapolation = extrapolations.reduce(
        (sum, values) => sum + (Number(values[month]) || 0),
        0,
      );
      const workforce = Number(workforcePlan.byInput?.[input]?.[month]) || 0;
      adjustments[month] = roundCurrency(
        adjustments[month] + workforce - replacedBase - replacedExtrapolation,
      );
    });
  }
  return adjustments;
}

export function buildProjectionCurveDisplaySeries(
  curve,
  dataFim,
  requiredMonths = [],
  monthlyWindowMonths = 60,
) {
  const months = Array.isArray(curve?.months) ? curve.months : [];
  if (!months.length) {
    return {
      months: [],
      planned: [],
      tendency: [],
      pointKinds: [],
      monthlyStart: null,
      condensed: false,
    };
  }

  const chartEnd = /^\d{4}-\d{2}$/.test(dataFim || '') ? dataFim : months[months.length - 1];
  const monthlyStart = addMonths(chartEnd, -monthlyWindowMonths);
  if (months[0] >= monthlyStart) {
    return {
      months: [...months],
      planned: [...(curve.planned || [])],
      tendency: [...(curve.tendency || [])],
      pointKinds: months.map(() => 'monthly'),
      monthlyStart,
      condensed: false,
    };
  }

  const selectedIndexes = new Set([0, months.length - 1]);
  const annualClosingIndexes = new Map();
  months.forEach((month, index) => {
    if (month < monthlyStart) annualClosingIndexes.set(month.slice(0, 4), index);
    else selectedIndexes.add(index);
  });
  annualClosingIndexes.forEach((index) => selectedIndexes.add(index));
  for (const requiredMonth of requiredMonths) {
    const index = months.indexOf(requiredMonth);
    if (index >= 0) selectedIndexes.add(index);
  }

  const transitionIndex = [...annualClosingIndexes.values()].slice(-1)[0];
  const indexes = [...selectedIndexes].sort((left, right) => left - right);
  const pointKinds = indexes.map((index) => {
    if (months[index] >= monthlyStart) return 'monthly';
    if (index === transitionIndex) return 'transition';
    if (annualClosingIndexes.get(months[index].slice(0, 4)) === index) return 'annual';
    return 'initial';
  });

  return {
    months: indexes.map((index) => months[index]),
    planned: indexes.map((index) => curve.planned[index]),
    tendency: indexes.map((index) => curve.tendency[index]),
    pointKinds,
    monthlyStart,
    condensed: true,
  };
}

function isUnclassifiedPlanningInput(input) {
  const value = String(input || '').trim();
  return (
    !value ||
    ['-', 'Não encontrado!'].includes(value) ||
    value.toUpperCase().includes('VERIFICAR') ||
    value === 'Aumento de obra'
  );
}

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function buildProjectionDifferenceFlowDetails({
  pendingFlows = [],
  selectedMonth,
  trendStart,
} = {}) {
  if (
    !/^\d{4}-\d{2}$/.test(selectedMonth || '') ||
    !/^\d{4}-\d{2}$/.test(trendStart || '') ||
    selectedMonth < trendStart
  ) {
    return [];
  }

  return pendingFlows
    .filter(
      (flow) =>
        flow.dep !== 'Cancelado' &&
        (flow.refletido_status || 'pendente') === 'pendente' &&
        Math.abs(Number(flow.custo_flowmaster) || 0) >= 0.005,
    )
    .map((flow) => ({
      numero: String(flow.n_alteracao || '').trim() || 'Sem número',
      descricao:
        String(flow.descricao || flow.motivo || flow.justificativa || '').trim() || 'Sem descrição',
      insumo: isUnclassifiedPlanningInput(flow.insumo_planejamento)
        ? '__unclassified__'
        : String(flow.insumo_planejamento).trim(),
      valor: roundCurrency(flow.custo_flowmaster),
    }))
    .sort(
      (left, right) =>
        Math.abs(right.valor) - Math.abs(left.valor) ||
        left.numero.localeCompare(right.numero, 'pt-BR', { numeric: true }),
    );
}

export function buildProjectionDifferenceBreakdown({
  projections = [],
  pendingFlows = [],
  workforcePlan = null,
  selectedMonth,
  trendStart,
  dataFim,
  targetDifference,
} = {}) {
  if (
    !/^\d{4}-\d{2}$/.test(selectedMonth || '') ||
    !/^\d{4}-\d{2}$/.test(trendStart || '') ||
    selectedMonth < trendStart
  ) {
    return { available: false, total: 0, rows: [] };
  }

  const contributions = new Map();
  const getContribution = (input) => {
    const normalizedInput = isUnclassifiedPlanningInput(input)
      ? '__unclassified__'
      : String(input).trim();
    if (!contributions.has(normalizedInput)) {
      contributions.set(normalizedInput, {
        insumo: normalizedInput,
        servicos: new Set(),
        extrapolacao: 0,
        workforce: 0,
        flows: 0,
      });
    }
    return contributions.get(normalizedInput);
  };

  for (const projection of projections) {
    if (workforcePlan?.enabledByInput?.[projection.insumo]) continue;
    if (
      projection.extrapolacao <= 0 ||
      !projection.ultimo_mes_planejado ||
      projection.meses_gap <= 0
    ) {
      continue;
    }
    const contribution = getContribution(projection.insumo);
    if (projection.servico) contribution.servicos.add(projection.servico);
    if (projection.extrapolationByMonth) {
      for (const [month, value] of Object.entries(projection.extrapolationByMonth)) {
        if ((!dataFim || month <= dataFim) && month <= selectedMonth) {
          contribution.extrapolacao += Number(value) || 0;
        }
      }
    } else {
      const monthlyExtrapolation = projection.extrapolacao / projection.meses_gap;
      let month = projection.ultimo_mes_planejado;
      for (let index = 0; index < projection.meses_gap; index += 1) {
        month = addMonths(month, 1);
        if ((!dataFim || month <= dataFim) && month <= selectedMonth) {
          contribution.extrapolacao += monthlyExtrapolation;
        }
      }
    }
  }

  for (const input of WORKFORCE_INPUTS) {
    if (!workforcePlan?.enabledByInput?.[input]) continue;
    const contribution = getContribution(input);
    const inputProjections = projections.filter((projection) => projection.insumo === input);
    for (let month = trendStart; month <= selectedMonth; month = addMonths(month, 1)) {
      const workforce = Number(workforcePlan.byInput?.[input]?.[month]) || 0;
      const replacedBase = inputProjections.reduce(
        (sum, projection) => sum + (Number(projection.meses?.[month]) || 0),
        0,
      );
      contribution.workforce += workforce - replacedBase;
    }
  }

  const flowDetails = buildProjectionDifferenceFlowDetails({
    pendingFlows,
    selectedMonth,
    trendStart,
  });
  for (const flow of flowDetails) {
    getContribution(flow.insumo).flows += flow.valor;
  }

  const rows = [...contributions.values()]
    .map((row) => {
      const extrapolacao = roundCurrency(row.extrapolacao);
      const workforce = roundCurrency(row.workforce);
      const flows = roundCurrency(row.flows);
      return {
        insumo: row.insumo,
        servicos: [...row.servicos].sort(),
        extrapolacao,
        workforce,
        flows,
        total: roundCurrency(extrapolacao + workforce + flows),
      };
    })
    .filter((row) => Math.abs(row.total) >= 0.005)
    .sort((left, right) => Math.abs(right.total) - Math.abs(left.total));

  const expectedTotal = Number.isFinite(targetDifference)
    ? roundCurrency(targetDifference)
    : roundCurrency(rows.reduce((sum, row) => sum + row.total, 0));
  const displayedTotal = roundCurrency(rows.reduce((sum, row) => sum + row.total, 0));
  const roundingResidual = roundCurrency(expectedTotal - displayedTotal);
  if (Math.abs(roundingResidual) >= 0.005) {
    const targetRow =
      rows[0] ||
      (() => {
        const fallback = {
          insumo: '__unclassified__',
          servicos: [],
          extrapolacao: 0,
          workforce: 0,
          flows: 0,
          total: 0,
        };
        rows.push(fallback);
        return fallback;
      })();
    if (
      Math.abs(targetRow.extrapolacao) >= Math.abs(targetRow.flows) &&
      Math.abs(targetRow.extrapolacao) >= Math.abs(targetRow.workforce)
    ) {
      targetRow.extrapolacao = roundCurrency(targetRow.extrapolacao + roundingResidual);
    } else if (Math.abs(targetRow.workforce) >= Math.abs(targetRow.flows)) {
      targetRow.workforce = roundCurrency(targetRow.workforce + roundingResidual);
    } else {
      targetRow.flows = roundCurrency(targetRow.flows + roundingResidual);
    }
    targetRow.total = roundCurrency(targetRow.extrapolacao + targetRow.workforce + targetRow.flows);
  }

  return {
    available: true,
    total: expectedTotal,
    rows: rows.sort((left, right) => Math.abs(right.total) - Math.abs(left.total)),
  };
}

// Calcula o ritmo histórico (R$/mês) somando os últimos N meses ANTES da data de corte
function calcularRitmoHistorico(meses, dataCorte, janelaMeses) {
  const cutoffStart = addMonths(dataCorte, -janelaMeses);
  const total = Object.entries(meses || {})
    .filter(([month]) => month >= cutoffStart && month < dataCorte)
    .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
  return Math.max(0, total / janelaMeses);
}

// Calcula somatório de flows PENDENTES (refletido_status='pendente', exceto cancelados)
// agrupados por grupo do insumo de destino
// Retorna {indiretos: R$, diretos: R$, civis: R$, projecao: R$, outros: R$}
function calcularFlowsPendentesPorGrupo() {
  const out = {
    'Custos Indiretos': 0,
    'Custos Diretos / Infraestrutura': 0,
    'Obras Civis': 0,
    'Projeção de Gastos': 0,
    Outros: 0,
  };
  if (!Array.isArray(getFlowsObraAtiva())) return out;

  getFlowsObraAtiva().forEach((f) => {
    if (f.dep === 'Cancelado') return;
    const status = f.refletido_status || 'pendente';
    if (status !== 'pendente') return;

    const valor = f.custo_flowmaster || 0;
    if (Math.abs(valor) < 0.01) return;

    const insDest = f.insumo_planejamento;
    if (isUnclassifiedPlanningInput(insDest)) {
      out['Outros'] += valor;
      return;
    }
    const tendItem = (
      Array.isArray(APP_STATE.dados.tendencia) ? APP_STATE.dados.tendencia : []
    ).find((t) => t.is_folha && t.cod_insumo === insDest);
    if (tendItem && tendItem.grupo && out.hasOwnProperty(tendItem.grupo)) {
      out[tendItem.grupo] += valor;
    } else {
      out['Outros'] += valor;
    }
  });
  return out;
}

// Função central: calcula KPIs por SERVIÇO (a base de tudo)
export function projetarServico(
  servico,
  meses,
  dataCorte,
  dataFim,
  janelaMeses,
  forecastOptions = {},
) {
  const mesesAteTermino = Object.entries(meses).filter(([mes]) => !dataFim || mes <= dataFim);
  const realizado = mesesAteTermino.filter(([m]) => m < dataCorte).reduce((s, [, v]) => s + v, 0);
  const planejadoFuturo = mesesAteTermino
    .filter(([m]) => m >= dataCorte)
    .reduce((s, [, v]) => s + v, 0);
  const planejadoTotal = realizado + planejadoFuturo;

  // Identificar último mês com planejamento real (valor > 0)
  const mesesComValor = mesesAteTermino
    .filter(([, v]) => v > 0)
    .map(([m]) => m)
    .sort();
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

  const legacyExtrapolation = extrapolacao;
  const hybrid = buildHybridInputForecast({
    monthlyValues: meses,
    dataCorte,
    dataFim,
    windowMonths: janelaMeses,
    group: grupo,
    physicalContext: forecastOptions.physicalContext,
    override: forecastOptions.override || { method: 'fixed', sampleMonths: 12 },
  });
  if (forecastOptions.useHybrid && hybrid.available) {
    extrapolacao = hybrid.extrapolation;
    mesesGap = Object.keys(hybrid.extrapolationByMonth).length;
  }

  const tendencia = planejadoTotal + extrapolacao;
  const diff = tendencia - planejadoTotal; // = extrapolacao na prática

  return {
    servico,
    grupo,
    realizado,
    planejado_futuro: planejadoFuturo,
    planejado_total: planejadoTotal,
    ultimo_mes_planejado: ultimoMesPlanejado,
    ritmo_historico: ritmoHist,
    meses_gap: mesesGap,
    extrapolacao,
    extrapolationByMonth:
      forecastOptions.useHybrid && hybrid.available ? hybrid.extrapolationByMonth : null,
    legacy_extrapolacao: legacyExtrapolation,
    recommended_extrapolacao: hybrid.available ? hybrid.extrapolation : legacyExtrapolation,
    forecast_method:
      forecastOptions.useHybrid && hybrid.available ? hybrid.selectedMethod : 'legacy',
    forecast_recommended_method: hybrid.available ? hybrid.selectedMethod : 'legacy',
    forecast_confidence: hybrid.confidence,
    forecast_diagnostics: hybrid.diagnostics,
    forecast_run_rate: hybrid.runRate ?? ritmoHist,
    forecast_cost_per_point: hybrid.costPerPoint ?? null,
    forecast_config: hybrid.config,
    forecast_details: hybrid.details,
    tendencia,
    diff,
    meses, // para drill-down
  };
}

export function distributeServiceProjection(projServicos, projInsumos) {
  const serviceProjection = new Map(
    (projServicos || []).map((projection) => [projection.servico, projection]),
  );
  const inputsByService = new Map();
  for (const input of projInsumos || []) {
    const inputs = inputsByService.get(input.servico) || [];
    inputs.push(input);
    inputsByService.set(input.servico, inputs);
  }

  const distributed = [];
  for (const [serviceCode, inputs] of inputsByService) {
    const service = serviceProjection.get(serviceCode);
    const target = service?.extrapolacao || 0;
    const historicalWeights = inputs.map((input) => Math.max(input.ritmo_historico || 0, 0));
    let weights = historicalWeights;
    let totalWeight = weights.reduce((sum, value) => sum + value, 0);
    if (totalWeight <= 0) {
      weights = inputs.map((input) => Math.max(input.planejado_total || 0, 0));
      totalWeight = weights.reduce((sum, value) => sum + value, 0);
    }

    let allocated = 0;
    inputs.forEach((input, index) => {
      const isLast = index === inputs.length - 1;
      const extrapolation =
        isLast && totalWeight > 0
          ? target - allocated
          : totalWeight > 0
            ? target * (weights[index] / totalWeight)
            : 0;
      allocated += extrapolation;
      distributed.push({
        ...input,
        ultimo_mes_planejado: service?.ultimo_mes_planejado || input.ultimo_mes_planejado,
        meses_gap: service?.meses_gap || 0,
        extrapolacao: extrapolation,
        tendencia: (input.planejado_total || 0) + extrapolation,
        diff: extrapolation,
      });
    });
  }
  return distributed;
}

function projectionNodeDepth(node) {
  if (node.tipo === 'raiz') return 0;
  if (node.tipo === 'grupo') return 1;
  if (node.tipo === 'subgrupo') return 2;
  if (node.tipo === 'servico' || node.tipo === 'outro') return 3;
  if (node.tipo === 'insumo') return 4;
  return Number(node.nivel) || 0;
}

function emptyProjectionMonth() {
  return {
    planned: 0,
    extrapolation: 0,
    workforce: 0,
    workforceOverride: false,
    replacedPlanned: 0,
    replacedExtrapolation: 0,
    pendingFlows: 0,
    total: 0,
    pendingFlowItems: [],
    reflectedFlowItems: [],
  };
}

function projectionFlowDetail(flow) {
  return {
    numero: String(flow.n_alteracao || '').trim() || 'Sem número',
    descricao:
      String(flow.descricao || flow.motivo || flow.justificativa || '').trim() || 'Sem descrição',
    insumo: isUnclassifiedPlanningInput(flow.insumo_planejamento)
      ? '__unclassified__'
      : String(flow.insumo_planejamento).trim(),
    valor: roundCurrency(flow.custo_flowmaster),
  };
}

function projectionMonthlyExtrapolation(projection, months, dataFim) {
  const result = Object.fromEntries(months.map((month) => [month, 0]));
  const target = roundCurrency(projection?.extrapolacao);
  if (Math.abs(target) < 0.005 || !projection?.ultimo_mes_planejado || projection.meses_gap <= 0) {
    return result;
  }
  if (projection.extrapolationByMonth) {
    for (const month of months) {
      if (month <= dataFim) result[month] = roundCurrency(projection.extrapolationByMonth[month]);
    }
    return result;
  }
  const extrapolationMonths = buildMonthRange(
    addMonths(projection.ultimo_mes_planejado, 1),
    dataFim,
  ).slice(0, projection.meses_gap);
  if (!extrapolationMonths.length) return result;

  let allocated = 0;
  extrapolationMonths.forEach((month, index) => {
    const value =
      index === extrapolationMonths.length - 1
        ? roundCurrency(target - allocated)
        : roundCurrency(target / extrapolationMonths.length);
    allocated = roundCurrency(allocated + value);
    if (Object.hasOwn(result, month)) result[month] = value;
  });
  return result;
}

export function buildProjectionMonthlyTableModel({
  projections = [],
  flows = [],
  dataCorte,
  dataFim,
  hierarchy = HIERARQUIA,
  comparison = null,
  workforcePlan = null,
} = {}) {
  const months = buildMonthRange(dataCorte, dataFim);
  const nodes = hierarchy.map((node, index) => ({
    ...node,
    index,
    children: [],
    parent: null,
    projection: null,
    monthly: Object.fromEntries(months.map((month) => [month, emptyProjectionMonth()])),
  }));
  const stack = [];
  nodes.forEach((node, index) => {
    while (
      stack.length &&
      projectionNodeDepth(nodes[stack[stack.length - 1]]) >= projectionNodeDepth(node)
    ) {
      stack.pop();
    }
    if (stack.length) {
      node.parent = stack[stack.length - 1];
      nodes[node.parent].children.push(index);
    }
    stack.push(index);
  });

  const rootIndex = nodes.findIndex((node) => node.tipo === 'raiz');
  const groupParents = {
    'Custos Indiretos': nodes.findIndex((node) => node.cod === '01.01'),
    'Custos Diretos / Infraestrutura': nodes.findIndex((node) => node.cod === '01.02'),
    'Obras Civis': nodes.findIndex((node) => node.cod === '01.03'),
    'Projeção de Gastos': nodes.findIndex((node) => node.cod === '01.04'),
  };
  const projectionsByKey = new Map(
    projections.map((projection) => [`${projection.servico}|${projection.insumo}`, projection]),
  );
  const assignedProjectionKeys = new Set();

  for (const node of nodes) {
    if (node.tipo !== 'insumo') continue;
    const key = `${node.cod_servico || ''}|${node.cod_insumo || ''}`;
    const projection = projectionsByKey.get(key);
    if (!projection || assignedProjectionKeys.has(key)) continue;
    node.projection = projection;
    assignedProjectionKeys.add(key);
  }

  for (const projection of projections) {
    const key = `${projection.servico}|${projection.insumo}`;
    if (assignedProjectionKeys.has(key)) continue;
    const parent = groupParents[projection.grupo] ?? rootIndex;
    const index = nodes.length;
    nodes.push({
      ordem: index,
      index,
      cod: '',
      cod_servico: projection.servico,
      cod_insumo: projection.insumo,
      item: descInsumo(projection.insumo),
      nivel: 4,
      tipo: 'insumo',
      children: [],
      parent,
      isProjectionFallback: true,
      projection,
      monthly: Object.fromEntries(months.map((month) => [month, emptyProjectionMonth()])),
    });
    if (parent >= 0) nodes[parent].children.push(index);
    assignedProjectionKeys.add(key);
  }

  function nodeGroup(node) {
    if (node.cod === '01.01') return 'Custos Indiretos';
    if (node.cod === '01.02') return 'Custos Diretos / Infraestrutura';
    if (node.cod === '01.03') return 'Obras Civis';
    if (node.cod === '01.04') return 'Projeção de Gastos';
    if (node.projection?.grupo) return node.projection.grupo;
    if (node.cod_servico) return grupoDoServico(node.cod_servico);
    let parent = node.parent;
    while (parent != null && parent >= 0) {
      const parentNode = nodes[parent];
      if (parentNode.cod === '01.01') return 'Custos Indiretos';
      if (parentNode.cod === '01.02') return 'Custos Diretos / Infraestrutura';
      if (parentNode.cod === '01.03') return 'Obras Civis';
      if (parentNode.cod === '01.04') return 'Projeção de Gastos';
      parent = parentNode.parent;
    }
    return 'Outros';
  }

  for (const node of nodes) {
    node.grupo = nodeGroup(node);
    const projection = node.projection;
    if (node.tipo !== 'insumo' || !projection) continue;
    const extrapolationByMonth = projectionMonthlyExtrapolation(projection, months, dataFim);
    for (const month of months) {
      const cell = node.monthly[month];
      cell.planned = roundCurrency(projection.meses?.[month]);
      cell.extrapolation = extrapolationByMonth[month] || 0;
      cell.total = roundCurrency(cell.planned + cell.extrapolation);
    }
    node.metrics = {
      planned: roundCurrency(projection.planejado_total),
      realized: roundCurrency(projection.realizado),
      balance: roundCurrency(projection.planejado_total - projection.realizado),
      extrapolation: roundCurrency(projection.extrapolacao),
      pendingFlows: 0,
      workforce: 0,
      tendency: roundCurrency(projection.planejado_total + projection.extrapolacao),
      previousPlanned: 0,
      currentConsolidated: 0,
      adherenceDifference: 0,
    };
  }

  if (workforcePlan) {
    for (const input of WORKFORCE_INPUTS) {
      if (!workforcePlan.enabledByInput?.[input]) continue;
      const candidates = nodes.filter(
        (node) => node.tipo === 'insumo' && node.projection && node.cod_insumo === input,
      );
      if (!candidates.length) continue;
      for (const node of candidates) {
        for (const month of months) {
          const cell = node.monthly[month];
          cell.replacedPlanned = cell.planned;
          cell.replacedExtrapolation = cell.extrapolation;
          cell.workforce = 0;
          cell.workforceOverride = true;
          cell.extrapolation = 0;
          cell.total = 0;
        }
        node.metrics.extrapolation = 0;
        node.metrics.workforce = 0;
        node.metrics.tendency = roundCurrency(node.metrics.realized);
      }
      const node = candidates[0];
      let workforceTotal = 0;
      for (const month of months) {
        const cell = node.monthly[month];
        const workforce = roundCurrency(workforcePlan.byInput?.[node.cod_insumo]?.[month]);
        cell.workforce = workforce;
        cell.workforceOverride = true;
        cell.extrapolation = 0;
        cell.total = workforce;
        workforceTotal = roundCurrency(workforceTotal + workforce);
      }
      node.metrics.extrapolation = 0;
      node.metrics.workforce = workforceTotal;
      node.metrics.tendency = roundCurrency(node.metrics.realized + workforceTotal);
    }
  }

  if (comparison?.available) {
    const assignedComparisonKeys = new Set();
    for (const node of nodes) {
      if (node.tipo !== 'insumo') continue;
      const key = `${node.cod_servico || ''}|${node.cod_insumo || ''}`;
      if (assignedComparisonKeys.has(key)) continue;
      const values = comparison.byInput?.[key];
      if (!values) continue;
      node.metrics ||= {
        planned: 0,
        realized: 0,
        balance: 0,
        extrapolation: 0,
        pendingFlows: 0,
        workforce: 0,
        tendency: 0,
        previousPlanned: 0,
        currentConsolidated: 0,
        adherenceDifference: 0,
      };
      node.metrics.previousPlanned = roundCurrency(values.previousPlanned);
      node.metrics.currentConsolidated = roundCurrency(values.currentConsolidated);
      node.metrics.adherenceDifference = roundCurrency(
        values.currentConsolidated - values.previousPlanned,
      );
      assignedComparisonKeys.add(key);
    }
  }

  // Flows podem apontar para um insumo existente sem projeção automática.
  // Inicialize as métricas antes de conciliá-los para manter a árvore íntegra.
  for (const node of nodes) {
    node.metrics ||= {
      planned: 0,
      realized: 0,
      balance: 0,
      extrapolation: 0,
      pendingFlows: 0,
      workforce: 0,
      tendency: 0,
      previousPlanned: 0,
      currentConsolidated: 0,
      adherenceDifference: 0,
    };
  }

  let unclassifiedFlowNode = null;
  function appendFlowOnlyNode(input) {
    const index = nodes.length;
    const unclassified = input === '__unclassified__';
    const node = {
      ordem: index,
      index,
      cod: '',
      cod_servico: '',
      cod_insumo: unclassified ? '' : input,
      item: unclassified ? 'Sem insumo classificado' : descInsumo(input),
      nivel: 4,
      tipo: 'insumo',
      children: [],
      parent: rootIndex,
      isFlowOnly: true,
      grupo: 'Outros',
      projection: null,
      monthly: Object.fromEntries(months.map((month) => [month, emptyProjectionMonth()])),
      metrics: {
        planned: 0,
        realized: 0,
        balance: 0,
        extrapolation: 0,
        pendingFlows: 0,
        tendency: 0,
        previousPlanned: 0,
        currentConsolidated: 0,
        adherenceDifference: 0,
      },
    };
    nodes.push(node);
    if (rootIndex >= 0) nodes[rootIndex].children.push(index);
    return node;
  }

  function resolveFlowNode(flow) {
    const input = isUnclassifiedPlanningInput(flow.insumo_planejamento)
      ? '__unclassified__'
      : String(flow.insumo_planejamento).trim();
    if (input === '__unclassified__') {
      unclassifiedFlowNode ||= appendFlowOnlyNode(input);
      return unclassifiedFlowNode;
    }
    const candidates = nodes.filter(
      (node) => node.tipo === 'insumo' && node.cod_insumo === input && !node.isFlowOnly,
    );
    return (
      candidates.find((node) => node.projection) ||
      candidates[0] ||
      nodes.find((node) => node.isFlowOnly && node.cod_insumo === input) ||
      appendFlowOnlyNode(input)
    );
  }

  for (const flow of flows) {
    if (flow.dep === 'Cancelado') continue;
    const status = flow.refletido_status || 'pendente';
    if (status !== 'pendente' && !isReflectedStatus(status)) continue;
    const target = resolveFlowNode(flow);
    const detail = projectionFlowDetail(flow);
    if (status === 'pendente' && Math.abs(detail.valor) >= 0.005) {
      target.metrics.pendingFlows = roundCurrency(target.metrics.pendingFlows + detail.valor);
      target.metrics.tendency = roundCurrency(target.metrics.tendency + detail.valor);
      if (target.monthly[dataCorte]) {
        const cell = target.monthly[dataCorte];
        cell.pendingFlows = roundCurrency(cell.pendingFlows + detail.valor);
        cell.pendingFlowItems.push(detail);
        cell.total = roundCurrency(
          (cell.workforceOverride ? cell.workforce : cell.planned + cell.extrapolation) +
            cell.pendingFlows,
        );
      }
      continue;
    }
    const reflectedMonth = String(flow.refletido_mes || '').slice(0, 7);
    if (isReflectedStatus(status) && target.monthly[reflectedMonth]) {
      target.monthly[reflectedMonth].reflectedFlowItems.push(detail);
    }
  }

  for (const node of nodes) {
    node.metrics ||= {
      planned: 0,
      realized: 0,
      balance: 0,
      extrapolation: 0,
      pendingFlows: 0,
      workforce: 0,
      tendency: 0,
      previousPlanned: 0,
      currentConsolidated: 0,
      adherenceDifference: 0,
    };
  }

  function aggregateNode(index) {
    const node = nodes[index];
    if (!node.children.length) return node;
    node.metrics = {
      planned: 0,
      realized: 0,
      balance: 0,
      extrapolation: 0,
      pendingFlows: 0,
      workforce: 0,
      tendency: 0,
      previousPlanned: 0,
      currentConsolidated: 0,
      adherenceDifference: 0,
    };
    node.monthly = Object.fromEntries(months.map((month) => [month, emptyProjectionMonth()]));
    for (const childIndex of node.children) {
      const child = aggregateNode(childIndex);
      for (const key of Object.keys(node.metrics)) {
        node.metrics[key] = roundCurrency(node.metrics[key] + child.metrics[key]);
      }
      for (const month of months) {
        const target = node.monthly[month];
        const source = child.monthly[month];
        target.planned = roundCurrency(target.planned + source.planned);
        target.extrapolation = roundCurrency(target.extrapolation + source.extrapolation);
        target.workforce = roundCurrency(target.workforce + source.workforce);
        target.workforceOverride ||= source.workforceOverride;
        target.replacedPlanned = roundCurrency(target.replacedPlanned + source.replacedPlanned);
        target.replacedExtrapolation = roundCurrency(
          target.replacedExtrapolation + source.replacedExtrapolation,
        );
        target.pendingFlows = roundCurrency(target.pendingFlows + source.pendingFlows);
        target.total = roundCurrency(target.total + source.total);
        target.pendingFlowItems.push(...source.pendingFlowItems);
        target.reflectedFlowItems.push(...source.reflectedFlowItems);
      }
    }
    return node;
  }
  const roots = nodes.filter((node) => node.parent === null).map((node) => node.index);
  roots.forEach(aggregateNode);

  return {
    months,
    nodes,
    roots,
    root: rootIndex >= 0 ? nodes[rootIndex] : null,
    dataCorte,
    dataFim,
    comparison,
    workforcePlan,
  };
}

export function buildManagementAdherenceComparison({
  monthlyRowsByProjectManagement = {},
  comparisonByProject = {},
  projectCode = '',
} = {}) {
  const metadata = comparisonByProject?.[projectCode];
  const projectRows = monthlyRowsByProjectManagement?.[projectCode];
  if (!metadata || !projectRows) return { available: false, byInput: {} };
  const previousRows = projectRows[metadata.previousManagement] || [];
  const currentRows = projectRows[metadata.currentManagement] || [];
  const byInput = {};
  const add = (rows, field) => {
    for (const row of rows) {
      if (row.mes !== metadata.comparisonMonth) continue;
      const key = `${row.servico || ''}|${row.insumo || ''}`;
      byInput[key] ||= { previousPlanned: 0, currentConsolidated: 0 };
      byInput[key][field] = roundCurrency(byInput[key][field] + (Number(row.valor) || 0));
    }
  };
  add(previousRows, 'previousPlanned');
  add(currentRows, 'currentConsolidated');
  return { available: true, ...metadata, byInput };
}

function syncProjectionChartLockUi() {
  const label = projectionChartLocked
    ? 'Desbloquear zoom e movimentação'
    : 'Bloquear zoom e movimentação';
  for (const container of document.querySelectorAll('#projChart, #modalProjChart')) {
    container.classList.toggle('projection-chart-is-locked', projectionChartLocked);
    const control = container.querySelector('.projection-chart-lock-toggle');
    const button = container.querySelector('.projection-chart-lock-button');
    const symbol = container.querySelector('.projection-chart-lock-symbol');
    if (control) control.title = label;
    if (button) button.setAttribute('aria-label', label);
    if (symbol) symbol.textContent = projectionChartLocked ? '🔒' : '🔓';
  }
}

function toggleProjectionChartLock(chartContext) {
  const nextLocked = !projectionChartLocked;
  if (nextLocked) {
    chartContext?.el?.querySelector('.apexcharts-zoom-icon')?.click();
  }
  projectionChartLocked = nextLocked;
  syncProjectionChartLockUi();
}

export function buildProjectionSnapshot({
  rows = [],
  flows = [],
  dataCorte,
  dataFim,
  janelaMeses = 6,
  hierarchy = HIERARQUIA,
  comparison = null,
  workforce = null,
  physicalSchedule = null,
  officialEvolution = null,
  forecast = null,
} = {}) {
  const porServico = {};
  const porInsumo = {};
  for (const row of rows) {
    if (!porServico[row.servico]) porServico[row.servico] = {};
    porServico[row.servico][row.mes] =
      (porServico[row.servico][row.mes] || 0) + (Number(row.valor) || 0);
    const key = `${row.servico}|${row.insumo}`;
    if (!porInsumo[key]) {
      porInsumo[key] = { servico: row.servico, insumo: row.insumo, meses: {} };
    }
    porInsumo[key].meses[row.mes] = (porInsumo[key].meses[row.mes] || 0) + (Number(row.valor) || 0);
  }

  const physicalContext = buildPhysicalForecastContext({
    schedule: physicalSchedule,
    officialEvolution,
    dataCorte,
    dataFim,
  });
  const buildInputProjections = (useHybrid) =>
    Object.values(porInsumo).map((item) => ({
      ...projetarServico(item.servico, item.meses, dataCorte, dataFim, janelaMeses, {
        physicalContext,
        useHybrid,
        override: forecast?.overrides?.[`${item.servico}|${item.insumo}`] || {
          method: 'fixed',
          sampleMonths: 12,
        },
      }),
      insumo: item.insumo,
    }));
  const legacyProjections = buildInputProjections(false);
  const recommendedProjections = buildInputProjections(true);
  const hybridActive = Boolean(
    forecast?.active &&
    Number(forecast?.version) === PROJECTION_FORECAST_VERSION &&
    physicalContext?.available,
  );
  const inputProjections = hybridActive ? recommendedProjections : legacyProjections;
  const serviceProjections = inputProjections;
  const workforcePlan = buildWorkforcePlan({
    settings: workforce?.settings,
    rows: workforce?.rows,
    months: buildMonthRange(dataCorte, dataFim),
  });
  const buildMonthlyModel = (projections) =>
    buildProjectionMonthlyTableModel({
      projections,
      flows,
      dataCorte,
      dataFim,
      hierarchy,
      comparison,
      workforcePlan,
    });
  const legacyMonthlyModel = buildMonthlyModel(legacyProjections);
  const recommendedMonthlyModel = buildMonthlyModel(recommendedProjections);
  const monthlyModel = hybridActive ? recommendedMonthlyModel : legacyMonthlyModel;
  const workforceCurveAdjustments = buildWorkforceCurveAdjustments({
    inputProjections,
    workforcePlan,
    dataCorte,
    dataFim,
  });
  const methodCounts = recommendedProjections.reduce((counts, projection) => {
    const method = projection.forecast_recommended_method || 'legacy';
    counts[method] = (counts[method] || 0) + 1;
    return counts;
  }, {});
  const forecastComparison = {
    available: Boolean(physicalContext?.available),
    active: hybridActive,
    currentTotal: legacyMonthlyModel.root?.metrics?.tendency || 0,
    recommendedTotal: recommendedMonthlyModel.root?.metrics?.tendency || 0,
    methodCounts,
    sourceCutoff: physicalContext?.sourceCutoff || null,
    sourceFile: physicalContext?.sourceFile || '',
  };
  monthlyModel.forecastComparison = forecastComparison;
  monthlyModel.physicalContext = physicalContext;

  return {
    rows,
    flows,
    dataCorte,
    dataFim,
    janelaMeses,
    porServico,
    serviceProjections,
    inputProjections,
    monthlyModel,
    workforcePlan,
    workforceCurveAdjustments,
    physicalContext,
    forecastComparison,
    rootMetrics: monthlyModel.root?.metrics || {
      planned: 0,
      realized: 0,
      balance: 0,
      extrapolation: 0,
      pendingFlows: 0,
      workforce: 0,
      tendency: 0,
    },
  };
}

function buildActiveProjectionSnapshot() {
  const rows = getProjRawObraAtiva();
  const dataCorte = document.getElementById('projDataCorte')?.value || defaultDataCorte();
  const dataFim =
    document.getElementById('projDataFim')?.value || savedDataFim() || defaultDataFim();
  const janelaMeses = parseInt(document.getElementById('projMetodo')?.value) || 6;
  const projectCode = activeProjectionProjectKey();
  const history = APP_STATE?.dados?.historico || {};
  const comparison = buildManagementAdherenceComparison({
    monthlyRowsByProjectManagement: history.monthlyRowsByProjectManagement,
    comparisonByProject: history.projectionComparisonByProject,
    projectCode,
  });
  return buildProjectionSnapshot({
    rows,
    flows: getFlowsObraAtiva(),
    dataCorte,
    dataFim,
    janelaMeses,
    comparison,
    workforce: APP_STATE?.dados?.workforce,
    physicalSchedule: APP_STATE?.dados?.physicalSchedule,
    officialEvolution: APP_STATE?.config?.evolGlobal?.teorica,
    forecast: APP_STATE?.config?.projectionForecast,
  });
}

function workforceState() {
  APP_STATE.dados.workforce ||= { settings: [], rows: [] };
  return APP_STATE.dados.workforce;
}

function setWorkforceSaveStatus(message, tone = '') {
  const status = document.getElementById('workforceSaveStatus');
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function workforceRowById(id) {
  return workforceState().rows.find((row) => String(row.id) === String(id));
}

function scheduleProjectionAfterWorkforceEdit() {
  clearTimeout(projectionWorkforceRenderTimer);
  projectionWorkforceRenderTimer = setTimeout(() => {
    renderProjecao();
    renderVisao();
  }, 180);
}

async function persistWorkforceRow(row) {
  if (!canEditWorkforce?.() || !row?.cargo?.trim()) return;
  setWorkforceSaveStatus('Salvando...', 'saving');
  try {
    await workforceRepository.upsertWorkforceRow(row);
    setWorkforceSaveStatus('Salvo', 'saved');
  } catch (error) {
    reportNonFatalError('Mão de obra/salvar linha', error);
    setWorkforceSaveStatus('Erro ao salvar', 'error');
  }
}

function scheduleWorkforceRowSave(row) {
  clearTimeout(projectionWorkforceSaveTimers.get(row.id));
  setWorkforceSaveStatus('Alterações não salvas', 'pending');
  projectionWorkforceSaveTimers.set(
    row.id,
    setTimeout(() => {
      projectionWorkforceSaveTimers.delete(row.id);
      persistWorkforceRow(row);
    }, 650),
  );
}

function renderProjectionWorkforceChart(plan) {
  const container = document.getElementById('projectionWorkforceChart');
  if (!container) return;
  document
    .getElementById('workforceModeEffective')
    ?.classList.toggle('active', projectionWorkforceChartMode === 'effective');
  document
    .getElementById('workforceModeCost')
    ?.classList.toggle('active', projectionWorkforceChartMode === 'cost');
  document
    .getElementById('workforceModeEffective')
    ?.setAttribute('aria-pressed', String(projectionWorkforceChartMode === 'effective'));
  document
    .getElementById('workforceModeCost')
    ?.setAttribute('aria-pressed', String(projectionWorkforceChartMode === 'cost'));
  const series = plan.series
    .filter((row) => row.cargo)
    .map((row) => ({
      name: `${row.cargo} · ${row.insumo}`,
      data: projectionWorkforceChartMode === 'cost' ? row.costs : row.quantities,
    }));
  if (!series.length) {
    container.replaceChildren();
    return;
  }
  renderApexChart('projectionWorkforceChart', {
    series,
    chart: {
      type: 'bar',
      height: 290,
      stacked: true,
      animations: { enabled: false },
      toolbar: { show: false },
      zoom: { enabled: false },
    },
    plotOptions: { bar: { columnWidth: '68%' } },
    dataLabels: { enabled: false },
    xaxis: {
      categories: plan.months.map((month) => formatMonthLabel(month)),
      labels: { rotate: -45, style: { fontSize: '10px' } },
    },
    yaxis: {
      labels: {
        formatter:
          projectionWorkforceChartMode === 'cost'
            ? (value) => fmtR$k(value)
            : (value) => String(Math.round(value)),
      },
    },
    tooltip: {
      shared: true,
      intersect: false,
      theme: document.body.classList.contains('dark') ? 'dark' : 'light',
      y: {
        formatter:
          projectionWorkforceChartMode === 'cost'
            ? (value) => fmtR$(value)
            : (value) => `${Math.round(value)} pessoa(s)`,
      },
    },
    legend: {
      position: 'top',
      fontSize: '11px',
      labels: { colors: resolveColor('var(--chart-text)') },
    },
    grid: { borderColor: resolveColor('var(--chart-grid)'), strokeDashArray: 3 },
  });
}

function renderProjectionWorkforce(plan) {
  const editable = canEditWorkforce?.() === true;
  const normalized = normalizeWorkforceState(workforceState());
  for (const input of WORKFORCE_INPUTS) {
    const toggle = document.getElementById(`workforceToggle${input}`);
    if (toggle) {
      toggle.checked = normalized.enabledByInput[input];
      toggle.disabled = !editable;
    }
    const status = document.getElementById(`workforceStatus${input}`);
    if (status) status.textContent = normalized.enabledByInput[input] ? 'Ativo' : 'Inativo';
  }
  const activeInputs = WORKFORCE_INPUTS.filter((input) => normalized.enabledByInput[input]);
  const help = document.getElementById('workforceActivationHelp');
  if (help) {
    help.textContent = activeInputs.length
      ? `Ativo: substitui o futuro da Gestão e a extrapolação automática de ${activeInputs.join(' e ')}.`
      : 'Inativo: as linhas cadastradas não entram na Tendência até que o insumo seja ativado.';
  }
  const addButton = document.querySelector('[data-click-action="addProjectionWorkforceRow"]');
  if (addButton) addButton.disabled = !editable;
  const monthHeaders = plan.months
    .map((month) => `<th class="num">${escHtml(formatMonthLabel(month))}</th>`)
    .join('');
  replaceWithParsedMarkup(
    document.getElementById('projectionWorkforceThead'),
    `<tr><th>Insumo</th><th>Cargo</th><th class="num">Custo mensal</th>${monthHeaders}<th><span class="sr-only">Ações</span></th></tr>`,
  );
  const options = WORKFORCE_INPUTS.map(
    (input) => `<option value="${input}">${input}</option>`,
  ).join('');
  const rows = normalized.rows
    .map((row) => {
      const monthCells = plan.months
        .map(
          (month) => `<td class="num"><input
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            value="${row.distribuicao[month] || 0}"
            data-workforce-row="${escAttr(row.id)}"
            data-workforce-month="${month}"
            aria-label="${escAttr(`${row.cargo || 'Cargo'} em ${formatMonthLabel(month)}`)}"
            ${editable ? '' : 'disabled'}
          /></td>`,
        )
        .join('');
      return `<tr data-workforce-row-id="${escAttr(row.id)}">
        <td><select data-workforce-row="${escAttr(row.id)}" data-workforce-field="insumo" aria-label="Insumo da mão de obra" ${editable ? '' : 'disabled'}>${options.replace(`value="${row.insumo}"`, `value="${row.insumo}" selected`)}</select></td>
        <td><input type="text" maxlength="120" value="${escAttr(row.cargo)}" data-workforce-row="${escAttr(row.id)}" data-workforce-field="cargo" aria-label="Cargo" ${editable ? '' : 'disabled'}></td>
        <td class="num"><input type="text" inputmode="decimal" value="${escAttr(formatEditableNumber(row.custo_mensal))}" data-workforce-row="${escAttr(row.id)}" data-workforce-field="custo_mensal" aria-label="Custo mensal" ${editable ? '' : 'disabled'}></td>
        ${monthCells}
        <td><button type="button" class="icon-btn danger" data-click-action="deleteProjectionWorkforceRow" data-action-mode="arg" data-action-arg="${escAttr(row.id)}" title="Excluir linha" aria-label="Excluir ${escAttr(row.cargo || 'linha')}" ${editable ? '' : 'disabled'}>🗑️</button></td>
      </tr>`;
    })
    .join('');
  replaceWithParsedMarkup(
    document.getElementById('projectionWorkforceTbody'),
    rows ||
      `<tr><td colspan="${plan.months.length + 4}" class="projection-workforce-empty">Nenhuma linha cadastrada</td></tr>`,
  );
  renderProjectionWorkforceChart(plan);
}

function setProjectionWorkforceChartMode(mode) {
  if (!['effective', 'cost'].includes(mode)) return;
  projectionWorkforceChartMode = mode;
  renderProjectionWorkforceChart(buildActiveProjectionSnapshot().workforcePlan);
}

function addProjectionWorkforceRow() {
  if (!canEditWorkforce?.()) return;
  const rows = workforceState().rows;
  rows.push({
    id: crypto.randomUUID(),
    codigo_obra: activeProjectionProjectKey(),
    insumo: WORKFORCE_INPUTS[0],
    cargo: '',
    custo_mensal: 0,
    distribuicao: {},
    ordem: rows.length,
  });
  renderProjectionWorkforce(buildActiveProjectionSnapshot().workforcePlan);
  document
    .querySelector('#projectionWorkforceTbody tr:last-child [data-workforce-field="cargo"]')
    ?.focus();
}

async function deleteProjectionWorkforceRow(id) {
  if (!canEditWorkforce?.()) return;
  const state = workforceState();
  const index = state.rows.findIndex((row) => String(row.id) === String(id));
  if (index < 0) return;
  clearTimeout(projectionWorkforceSaveTimers.get(id));
  projectionWorkforceSaveTimers.delete(id);
  const [removed] = state.rows.splice(index, 1);
  setWorkforceSaveStatus('Salvando...', 'saving');
  try {
    await workforceRepository.deleteWorkforceRow(id);
    setWorkforceSaveStatus('Salvo', 'saved');
    renderProjecao();
    renderVisao();
  } catch (error) {
    state.rows.splice(index, 0, removed);
    reportNonFatalError('Mão de obra/excluir linha', error);
    setWorkforceSaveStatus('Erro ao salvar', 'error');
    renderProjectionWorkforce(buildActiveProjectionSnapshot().workforcePlan);
  }
}

async function changeProjectionWorkforceSetting(input, active) {
  if (!canEditWorkforce?.() || !WORKFORCE_INPUTS.includes(input)) return;
  const state = workforceState();
  const existing = state.settings.find((setting) => setting.insumo === input);
  if (existing) existing.ativo = active;
  else
    state.settings.push({
      codigo_obra: activeProjectionProjectKey(),
      insumo: input,
      ativo: active,
    });
  setWorkforceSaveStatus('Salvando...', 'saving');
  try {
    await workforceRepository.saveWorkforceSetting(input, active);
    setWorkforceSaveStatus('Salvo', 'saved');
    renderProjecao();
    renderVisao();
  } catch (error) {
    reportNonFatalError('Mão de obra/ativar planejamento', error);
    setWorkforceSaveStatus('Erro ao salvar', 'error');
    renderProjecao();
  }
}

function handleProjectionWorkforceInput(event) {
  const target = event.target.closest('[data-workforce-row]');
  if (!target || !canEditWorkforce?.()) return;
  const row = workforceRowById(target.dataset.workforceRow);
  if (!row) return;
  if (target.dataset.workforceMonth) {
    row.distribuicao ||= {};
    row.distribuicao[target.dataset.workforceMonth] = Math.max(
      0,
      Math.trunc(Number(target.value) || 0),
    );
  } else if (target.dataset.workforceField === 'custo_mensal') {
    row.custo_mensal = Math.max(0, parseNumber(target.value) || 0);
  } else if (target.dataset.workforceField) {
    row[target.dataset.workforceField] = target.value;
  }
  scheduleWorkforceRowSave(row);
  if (event.type === 'change') scheduleProjectionAfterWorkforceEdit();
}

function handleProjectionWorkforcePaste(event) {
  const target = event.target.closest('[data-workforce-month]');
  if (!target || !canEditWorkforce?.()) return;
  const matrix = String(event.clipboardData?.getData('text/plain') || '')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split('\t'));
  if (!matrix.length) return;
  event.preventDefault();
  const months = buildActiveProjectionSnapshot().workforcePlan.months;
  const startMonth = months.indexOf(target.dataset.workforceMonth);
  const rows = workforceState().rows;
  const startRow = rows.findIndex((row) => String(row.id) === target.dataset.workforceRow);
  const touched = new Set();
  matrix.forEach((values, rowOffset) => {
    const row = rows[startRow + rowOffset];
    if (!row) return;
    row.distribuicao ||= {};
    values.forEach((value, columnOffset) => {
      const month = months[startMonth + columnOffset];
      if (!month) return;
      const parsed = parseNumber(value);
      row.distribuicao[month] = Math.max(0, Math.trunc(parsed || 0));
      touched.add(row);
    });
  });
  touched.forEach((row) => persistWorkforceRow(row));
  renderProjecao();
  renderVisao();
}

function handleProjectionWorkforceKeydown(event) {
  if (event.key !== 'Enter' || event.target.tagName === 'BUTTON') return;
  const cell = event.target.closest('td');
  const row = cell?.parentElement;
  const nextRow = row?.nextElementSibling;
  if (!cell || !nextRow) return;
  const columnIndex = [...row.children].indexOf(cell);
  const nextControl = nextRow.children[columnIndex]?.querySelector('input, select');
  if (nextControl) {
    event.preventDefault();
    nextControl.focus();
    nextControl.select?.();
  }
}

function renderProjecao() {
  // v0.58b: filtra APP_STATE.dados.projRaw pela obra ativa
  const PROJ_OBRA = getProjRawObraAtiva();
  if (!PROJ_OBRA.length) {
    initProjecao();
    return;
  }
  syncProjectionInputs();
  const source = document.getElementById('projBaseManagement');
  if (source) source.textContent = activeProjectionManagement();
  const dataCorte = document.getElementById('projDataCorte').value || defaultDataCorte();
  const dataFim = document.getElementById('projDataFim').value || defaultDataFim();
  const tolerancia = parseNumber(document.getElementById('projTolerancia').value) ?? 0;
  const snapshot = buildActiveProjectionSnapshot();
  const porServico = snapshot.porServico;
  const projServicos = snapshot.serviceProjections;
  const projInsumos = snapshot.inputProjections;
  const flowsObra = snapshot.flows;
  const workforcePlan = snapshot.workforcePlan;
  projectionMonthlyTableModel = snapshot.monthlyModel;
  const rootMetrics = snapshot.rootMetrics;

  // KPIs gerais
  const totRealizado = rootMetrics.realized;
  const totPlanejado = rootMetrics.planned;
  const saldoPlanejamento = rootMetrics.balance;
  const pctSaldoPlanejamento = totPlanejado ? (saldoPlanejamento / totPlanejado) * 100 : 0;

  const groupImpact = (codes) =>
    projectionMonthlyTableModel.nodes
      .filter((node) => codes.includes(node.cod))
      .reduce((sum, node) => sum + node.metrics.tendency - node.metrics.planned, 0);
  const totIndiretosTend = groupImpact(['01.01', '01.04']);
  const totDiretosTend = rootMetrics.tendency - rootMetrics.planned - totIndiretosTend;
  const totImpactoTendencia = rootMetrics.tendency - rootMetrics.planned;
  const pctImpactoTendencia = totPlanejado ? (totImpactoTendencia / totPlanejado) * 100 : 0;
  const totTendencia = rootMetrics.tendency;
  const totDiff = totTendencia - totPlanejado;
  const diffCls = totDiff > tolerancia ? 'red' : totDiff < -tolerancia ? 'green' : '';
  const saldoPctLabel = pctSaldoPlanejamento.toFixed(2).replace('.', ',');
  const tendenciaPctLabel = pctImpactoTendencia.toFixed(2).replace('.', ',');

  replaceWithParsedMarkup(
    document.getElementById('projKpis'),
    `<div class="kpi projection-summary-card projection-execution-card">
      <h3 class="projection-summary-title">💰 Execução Orçamentária</h3>
      <div class="projection-summary-row projection-summary-row--no-divider">
        <span>📋 Valor total planejado</span>
        <strong>${fmtR$(totPlanejado)}</strong>
      </div>
      <div class="projection-summary-row">
        <span>✅ Realizado até ${formatMonthLabel(addMonths(dataCorte, -1))}</span>
        <strong>${fmtR$(totRealizado)}</strong>
      </div>
      <div class="projection-summary-row projection-summary-row--total">
        <span>💧 Saldo de planejamento ${saldoPctLabel}%</span>
        <strong>${fmtR$(saldoPlanejamento)}</strong>
      </div>
    </div>
    <div class="kpi projection-summary-card projection-trend-card ${diffCls}">
      <h3 class="projection-summary-title">🔮 Tendência Projetada</h3>
      <div class="projection-summary-row projection-summary-row--no-divider">
        <span>🏗️ Tendência · Indiretos</span>
        <strong>${totIndiretosTend >= 0 ? '+' : ''}${fmtR$(totIndiretosTend)}</strong>
      </div>
      <div class="projection-summary-row">
        <span>🧱 Tendência · Diretos</span>
        <strong>${totDiretosTend >= 0 ? '+' : ''}${fmtR$(totDiretosTend)}</strong>
      </div>
      <div class="projection-summary-row">
        <span>📈 Tendência Total - ${tendenciaPctLabel}%</span>
        <strong>${totImpactoTendencia >= 0 ? '+' : ''}${fmtR$(totImpactoTendencia)}</strong>
      </div>
      <div class="projection-summary-row projection-summary-row--total">
        <span>🎯 Total Tendência</span>
        <strong>${fmtR$(totTendencia)}</strong>
      </div>
    </div>`,
  );

  // Gráfico curva S geral
  renderProjChartGeral(
    porServico,
    projServicos,
    dataCorte,
    dataFim,
    rootMetrics.pendingFlows,
    projInsumos,
    flowsObra,
    snapshot.workforceCurveAdjustments,
  );

  renderProjectionForecastMethodology(snapshot);

  renderProjectionWorkforce(workforcePlan);

  // Aderência Físico × Financeira (renderiza se o container existir na página)
  try {
    if (typeof renderAderenciaProj === 'function') renderAderenciaProj();
  } catch (e) {
    console.warn('aderencia:', e);
  }

  // Tabela hierárquica
  renderProjectionMonthlyTable(projectionMonthlyTableModel);
}

function renderProjectionForecastMethodology(snapshot) {
  const root = document.getElementById('projectionForecastMethodology');
  if (!root) return;
  const comparison = snapshot.forecastComparison;
  if (!comparison?.available) {
    replaceWithParsedMarkup(
      root,
      `<div class="projection-forecast-heading"><h2>🧭 Metodologia da Previsão</h2><span class="badge gray">MODELO ATUAL</span></div>
       <p class="projection-forecast-empty">Cronograma Físico ainda não publicado para esta obra. A projeção permanece na média histórica simples.</p>`,
    );
    return;
  }
  const delta = comparison.recommendedTotal - comparison.currentTotal;
  const counts = Object.entries(comparison.methodCounts || {})
    .filter(([method]) => method !== 'legacy')
    .map(([method, count]) => `${FORECAST_METHOD_LABELS[method] || method}: ${count}`)
    .join(' · ');
  const canManage = canManageForecast?.() === true;
  replaceWithParsedMarkup(
    root,
    `<div class="projection-forecast-heading">
       <div><h2>🧭 Metodologia da Previsão</h2><p>${escHtml(comparison.sourceFile || 'Cronograma físico ativo')} · corte ${escHtml(formatMonthLabel(comparison.sourceCutoff))}</p></div>
       <span class="badge ${comparison.active ? 'green' : 'gray'}">${comparison.active ? 'MODELO CONFIGURÁVEL ATIVO' : 'EM COMPARAÇÃO'}</span>
     </div>
     <div class="projection-forecast-comparison">
       <div><span>Cálculo atual</span><strong>${fmtR$(comparison.currentTotal)}</strong></div>
       <div><span>Modelo configurável</span><strong>${fmtR$(comparison.recommendedTotal)}</strong></div>
       <div><span>Impacto</span><strong class="projection-difference-value--${projectionDifferenceTone(delta)}">${delta >= 0 ? '+' : ''}${fmtR$(delta)}</strong></div>
     </div>
     <div class="projection-forecast-footer">
       <span>${escHtml(counts || 'Sem insumos elegíveis para extrapolação automática')}</span>
       ${canManage ? `<button class="btn-sm ${comparison.active ? '' : 'primary'}" data-click-action="toggleProjectionForecastMode" data-action-mode="arg" data-action-arg="${comparison.active ? 'legacy' : 'hybrid'}">${comparison.active ? '↩ Usar cálculo atual' : '✓ Ativar metodologias configuradas'}</button>` : ''}
     </div>`,
  );
}

async function toggleProjectionForecastMode(mode) {
  if (!canManageForecast?.()) {
    authToast('Apenas administradores podem alterar a metodologia oficial.', 'warn', 4000);
    return;
  }
  const config = {
    ...(APP_STATE.config.projectionForecast || {}),
    version: PROJECTION_FORECAST_VERSION,
    active: mode === 'hybrid',
    overrides: { ...(APP_STATE.config.projectionForecast?.overrides || {}) },
  };
  try {
    await forecastRepository.saveDashboardKey(
      `${activeProjectionProjectKey()}:projection_forecast`,
      JSON.stringify(config),
    );
    APP_STATE.config.projectionForecast = config;
    renderProjecao();
    renderVisao();
    authToast(
      config.active
        ? 'Metodologias configuradas ativadas para esta obra.'
        : 'Cálculo atual restaurado.',
      'ok',
      3500,
    );
  } catch (error) {
    reportNonFatalError(
      'Projeção/salvar metodologia',
      error,
      'A metodologia não pôde ser alterada.',
    );
  }
}

async function changeProjectionForecastOverride(service, input, values) {
  if (!canManageForecast?.()) return false;
  const inputConfig = normalizeInputForecastConfig(values);
  const config = {
    ...(APP_STATE.config.projectionForecast || {}),
    version: PROJECTION_FORECAST_VERSION,
    active:
      Number(APP_STATE.config.projectionForecast?.version) === PROJECTION_FORECAST_VERSION &&
      APP_STATE.config.projectionForecast?.active === true,
    overrides: { ...(APP_STATE.config.projectionForecast?.overrides || {}) },
  };
  const key = `${service}|${input}`;
  config.overrides[key] = inputConfig;
  try {
    await forecastRepository.saveDashboardKey(
      `${activeProjectionProjectKey()}:projection_forecast`,
      JSON.stringify(config),
    );
    APP_STATE.config.projectionForecast = config;
    renderProjecao();
    renderVisao();
    authToast('Metodologia do insumo atualizada.', 'ok', 3000);
    return true;
  } catch (error) {
    reportNonFatalError('Projeção/salvar modelo do insumo', error, 'O ajuste não pôde ser salvo.');
    return false;
  }
}

function forecastConfidenceLabel(value) {
  if (value === 'high') return 'alta';
  if (value === 'medium') return 'média';
  if (value === 'manual') return 'manual';
  return 'baixa';
}

function forecastCorrelationLabel(value) {
  if (!Number.isFinite(value)) return 'indisponível';
  return Number(value).toFixed(2).replace('.', ',');
}

function forecastInputValue(value) {
  return (Number(value) || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function forecastConfigMarkup(proj, servico, insumo, activeSnapshot) {
  if (!insumo || !grupoExtrapola(proj.grupo)) return '';
  const stored = APP_STATE.config.projectionForecast?.overrides?.[`${servico}|${insumo}`];
  const config = normalizeInputForecastConfig(stored || proj.forecast_config);
  const details = proj.forecast_details || {};
  const diagnostic = proj.forecast_diagnostics?.[config.method] || {};
  const wape =
    diagnostic.wape == null
      ? 'indisponível'
      : `${(diagnostic.wape * 100).toFixed(1).replace('.', ',')}%`;
  const sampleLabel =
    details.sampleStart && details.sampleEnd
      ? `${formatMonthLabel(details.sampleStart)} a ${formatMonthLabel(details.sampleEnd)}`
      : 'Sem amostra';
  const outlierLabel = details.outliers?.length
    ? details.outliers.map((item) => formatMonthLabel(item.month)).join(', ')
    : 'Nenhum';
  const canManage = canManageForecast?.() === true;
  const option = (value, label) =>
    `<option value="${value}" ${config.method === value ? 'selected' : ''}>${label}</option>`;
  const sampleOption = (value, label) =>
    `<option value="${value}" ${config.sampleMonths === value ? 'selected' : ''}>${label}</option>`;
  const lagOption = (value, label) =>
    `<option value="${value}" ${config.lagMonths === value ? 'selected' : ''}>${label}</option>`;

  return `<section class="projection-modal-forecast" aria-labelledby="projectionForecastConfigTitle">
    <div class="projection-modal-forecast-heading">
      <div>
        <span id="projectionForecastConfigTitle">Metodologia do insumo</span>
        <strong>${escHtml(FORECAST_METHOD_LABELS[config.method] || 'Fixo mensal robusto')}</strong>
        ${proj.forecast_method !== config.method ? `<small>Cálculo exibido: ${escHtml(FORECAST_METHOD_LABELS[proj.forecast_method] || proj.forecast_method)}</small>` : ''}
      </div>
      <span class="badge ${proj.forecast_confidence === 'high' ? 'green' : proj.forecast_confidence === 'medium' ? 'yellow' : 'gray'}">CONFIANÇA ${escHtml(forecastConfidenceLabel(proj.forecast_confidence).toUpperCase())}</span>
    </div>
    <div class="projection-forecast-memory">
      <div><span>Amostra</span><strong>${escHtml(sampleLabel)} · ${Number(details.samples) || 0} meses</strong></div>
      <div><span>Base robusta</span><strong>${fmtR$(details.robustMonthly || 0)}/mês</strong></div>
      <div><span>Correlação física</span><strong>${escHtml(forecastCorrelationLabel(details.correlation))}</strong></div>
      <div><span>Erro histórico</span><strong>${escHtml(wape)} WAPE</strong></div>
      <div><span>Coeficiente físico</span><strong>${details.physicalCoefficient ? `${fmtR$(details.physicalCoefficient)}/pp` : '—'}</strong></div>
      <div><span>Extremos atenuados</span><strong>${escHtml(outlierLabel)}</strong></div>
    </div>
    ${details.fallbackReason ? `<p class="projection-forecast-warning">${escHtml(details.fallbackReason)}</p>` : ''}
    ${
      canManage
        ? `<form id="projectionForecastConfigForm" class="projection-forecast-config-form">
          <label>Método
            <select id="projectionForecastMethod" class="field-control">
              ${option('fixed', 'Fixo mensal robusto')}
              ${option('physical', 'Evolução física')}
              ${option('mixed', 'Misto · fixo + evolução física')}
              ${option('manual', 'Valor mensal manual')}
              ${option('none', 'Não extrapolar')}
            </select>
          </label>
          <label>Amostra histórica
            <select id="projectionForecastSample" class="field-control">
              ${sampleOption(6, '6 meses')}
              ${sampleOption(12, '12 meses')}
              ${sampleOption(18, '18 meses')}
              ${sampleOption(0, 'Todo histórico')}
            </select>
          </label>
          <label>Defasagem
            <select id="projectionForecastLag" class="field-control">
              ${lagOption(0, 'Mesmo mês')}
              ${lagOption(1, '1 mês')}
              ${lagOption(2, '2 meses')}
            </select>
          </label>
          <label>Parcela fixa (%)
            <input id="projectionForecastFixedShare" class="field-control" type="number" min="0" max="100" step="1" value="${config.fixedShare}">
          </label>
          <label>Valor mensal manual
            <input id="projectionForecastManualValue" class="field-control" inputmode="decimal" value="${escAttr(forecastInputValue(config.manualMonthlyValue))}">
          </label>
          <button class="btn-sm primary projection-forecast-save" type="submit">💾 Salvar metodologia</button>
        </form>`
        : ''
    }
    ${activeSnapshot.workforcePlan?.enabledByInput?.[insumo] ? '<p class="projection-forecast-warning">O Planejamento de Mão de Obra está ativo e tem prioridade sobre esta metodologia.</p>' : ''}
  </section>`;
}

function syncForecastConfigFields() {
  const method = document.getElementById('projectionForecastMethod')?.value;
  const lag = document.getElementById('projectionForecastLag');
  const fixedShare = document.getElementById('projectionForecastFixedShare');
  const manualValue = document.getElementById('projectionForecastManualValue');
  if (lag) lag.disabled = !['physical', 'mixed'].includes(method);
  if (fixedShare) fixedShare.disabled = method !== 'mixed';
  if (manualValue) manualValue.disabled = method !== 'manual';
}

function createProjectionCurveTooltip(
  categories,
  planData,
  tendData,
  { interactive = false, months = [], pointKinds = [] } = {},
) {
  return ({ dataPointIndex }) => {
    if (dataPointIndex < 0) return '';
    const planejado = Number(planData[dataPointIndex]) || 0;
    const tendenciaDisponivel = Number.isFinite(tendData[dataPointIndex]);
    const tendencia = tendenciaDisponivel ? Number(tendData[dataPointIndex]) : null;
    const diferenca = tendenciaDisponivel ? tendencia - planejado : null;
    const diferencaTexto =
      diferenca == null
        ? '—'
        : Math.abs(diferenca) < 0.005
          ? '0,00'
          : `${diferenca > 0 ? '+' : ''}${fmtR$(diferenca)}`;
    const diferencaClasse =
      diferenca == null
        ? ''
        : diferenca > 0
          ? 'projection-curve-tooltip-value--increase'
          : diferenca < 0
            ? 'projection-curve-tooltip-value--reduction'
            : '';
    const selectedMonth = months[dataPointIndex];
    const pointKind = pointKinds[dataPointIndex] || 'monthly';
    const tooltipTitle =
      pointKind === 'annual'
        ? `${formatMonthLabel(selectedMonth)} · fechamento anual`
        : pointKind === 'transition'
          ? `${formatMonthLabel(selectedMonth)} · fechamento do período anterior`
          : categories[dataPointIndex];
    if (interactive && selectedMonth && tendenciaDisponivel) {
      projectionDifferenceSelectedMonth = selectedMonth;
    }
    const compositionAction =
      interactive && selectedMonth && tendenciaDisponivel && Math.abs(diferenca || 0) >= 0.005
        ? `<button type="button" class="projection-curve-tooltip-action" data-click-action="openProjectionDifference" data-action-mode="arg" data-action-arg="${escAttr(selectedMonth)}">Ver composição</button>`
        : '';

    return `<div class="projection-chart-tooltip projection-curve-tooltip">
      <strong class="projection-curve-tooltip-title">${escHtml(tooltipTitle)}</strong>
      <div class="projection-curve-tooltip-row">
        <span><i class="projection-curve-tooltip-mark projection-curve-tooltip-mark--plan"></i>Planejado acumulado</span>
        <strong>${fmtR$(planejado)}</strong>
      </div>
      <div class="projection-curve-tooltip-row">
        <span><i class="projection-curve-tooltip-mark projection-curve-tooltip-mark--trend"></i>Tendência projetada</span>
        <strong>${tendenciaDisponivel ? fmtR$(tendencia) : '—'}</strong>
      </div>
      <div class="projection-curve-tooltip-row projection-curve-tooltip-row--difference">
        <span>Δ Diferença</span>
        <strong class="${diferencaClasse}">${diferencaTexto}</strong>
      </div>
      ${compositionAction}
    </div>`;
  };
}

function projectionCategoryLabelFormatter(categories, compact = false, requiredCategories = []) {
  const maxLabels = compact ? 10 : 24;
  const step = Math.max(1, Math.ceil(categories.length / maxLabels));
  const required = new Set(requiredCategories);
  return (value, _timestamp, options) => {
    const index = Number.isInteger(options?.i) ? options.i : categories.indexOf(value);
    return required.has(value) || index % step === 0 || index === categories.length - 1
      ? value
      : '';
  };
}

function renderProjChartGeral(
  porServico,
  projServicos,
  dataCorte,
  dataFim,
  pendingFlowImpact = 0,
  inputProjections = [],
  pendingFlows = [],
  monthlyAdjustments = {},
) {
  // Acumular planejado total mês a mês
  const totalMeses = {};
  Object.values(porServico).forEach((meses) => {
    Object.entries(meses).forEach(([m, v]) => {
      totalMeses[m] = (totalMeses[m] || 0) + v;
    });
  });
  const curve = buildProjectionCurve(
    totalMeses,
    projServicos,
    dataCorte,
    dataFim,
    pendingFlowImpact,
    monthlyAdjustments,
  );
  if (!curve.months.length) {
    projectionDifferenceContext = null;
    projectionDifferenceSelectedMonth = null;
    document.getElementById('projChart').replaceChildren();
    return;
  }
  projectionDifferenceContext = {
    curve,
    inputProjections,
    pendingFlows,
    dataFim,
    workforcePlan: projectionMonthlyTableModel?.workforcePlan,
  };
  projectionDifferenceSelectedMonth = curve.months[curve.months.length - 1] || null;

  const displayCurve = buildProjectionCurveDisplaySeries(curve, dataFim, [dataCorte, dataFim]);
  const extended = displayCurve.months;
  const categories = extended.map((month, index) => {
    if (displayCurve.pointKinds[index] === 'annual') return month.slice(0, 4);
    return formatMonthLabel(month);
  });
  const planData = displayCurve.planned;
  const tendData = displayCurve.tendency;

  // Posição do corte e do fim para annotations
  const findIdx = (m) => {
    let bestIdx = 0;
    for (let i = 0; i < extended.length; i++) {
      if (extended[i] <= m) bestIdx = i;
      else break;
    }
    return bestIdx;
  };
  const exactCutoffIndex = extended.indexOf(dataCorte);
  const corteIdx = exactCutoffIndex >= 0 ? exactCutoffIndex : findIdx(dataCorte);
  const fimIdx = findIdx(dataFim);
  const requiredAxisCategories = categories.filter((_category, index) =>
    ['annual', 'transition'].includes(displayCurve.pointKinds[index]),
  );
  requiredAxisCategories.push(categories[corteIdx], categories[fimIdx]);

  const options = {
    series: [
      {
        name: `Planejado acumulado · ${activeProjectionManagement()}`,
        type: 'area',
        data: planData,
      },
      { name: 'Tendência projetada', type: 'line', data: tendData },
    ],
    chart: {
      height: 400,
      animations: { enabled: true, easing: 'easeinout', speed: 800 },
      toolbar: {
        show: true,
        tools: {
          download: true,
          selection: true,
          zoom: true,
          zoomin: true,
          zoomout: true,
          pan: true,
          reset: true,
          customIcons: [
            {
              icon: `<button type="button" class="projection-chart-lock-button" aria-label="${projectionChartLocked ? 'Desbloquear zoom e movimentação' : 'Bloquear zoom e movimentação'}"><span class="projection-chart-lock-symbol" aria-hidden="true">${projectionChartLocked ? '🔒' : '🔓'}</span></button>`,
              index: 2,
              title: projectionChartLocked
                ? 'Desbloquear zoom e movimentação'
                : 'Bloquear zoom e movimentação',
              class: 'projection-chart-lock-toggle',
              click: toggleProjectionChartLock,
            },
          ],
        },
      },
      zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
      events: {
        mounted: syncProjectionChartLockUi,
        updated: syncProjectionChartLockUi,
        markerClick: (_event, _chartContext, { dataPointIndex }) => {
          const selectedMonth = extended[dataPointIndex];
          if (selectedMonth) openProjectionDifference(selectedMonth);
        },
        beforeZoom: (chartContext, { xaxis }) =>
          projectionChartLocked
            ? {
                xaxis: {
                  min: chartContext.w.globals.minX,
                  max: chartContext.w.globals.maxX,
                },
              }
            : { xaxis },
        beforeResetZoom: (chartContext) =>
          projectionChartLocked
            ? {
                xaxis: {
                  min: chartContext.w.globals.minX,
                  max: chartContext.w.globals.maxX,
                },
              }
            : undefined,
      },
    },
    themePalette: ['var(--chart-primary)', 'var(--sem-alerta)'],
    colors: [resolveColor('var(--chart-primary)'), resolveColor('var(--sem-alerta)')],
    stroke: { curve: 'smooth', width: [2.5, 2.5] },
    fill: {
      type: ['gradient', 'solid'],
      gradient: { shadeIntensity: 1, opacityFrom: 0.15, opacityTo: 0.02, stops: [0, 100] },
    },
    xaxis: {
      categories: categories,
      labels: {
        rotate: -45,
        rotateAlways: true,
        formatter: projectionCategoryLabelFormatter(categories, false, requiredAxisCategories),
        style: { fontSize: '10px' },
      },
    },
    yaxis: {
      labels: { formatter: (val) => fmtR$k(val), style: { fontSize: '10px' } },
    },
    annotations: {
      xaxis: [
        {
          id: 'projection-cutoff',
          x: categories[corteIdx],
          borderColor: resolveColor('var(--fgr-red-vivid)'),
          strokeDashArray: 4,
          label: {
            text: 'Corte: ' + formatMonthLabel(dataCorte),
            orientation: 'horizontal',
            position: 'top',
            offsetY: 8,
            style: {
              color: resolveColor('var(--text-on-dark)'),
              background: resolveColor('var(--fgr-red-vivid)'),
              fontSize: '10px',
              padding: { left: 6, right: 6, top: 2, bottom: 2 },
            },
          },
        },
        {
          x: categories[fimIdx],
          borderColor: resolveColor('var(--chart-neutral)'),
          strokeDashArray: 2,
          label: {
            text: 'Fim: ' + formatMonthLabel(dataFim),
            orientation: 'vertical',
            position: 'bottom',
            offsetY: -10,
            style: {
              color: resolveColor('var(--text-on-dark)'),
              background: resolveColor('var(--chart-neutral)'),
              fontSize: '10px',
              padding: { left: 6, right: 6, top: 2, bottom: 2 },
            },
          },
        },
      ],
    },
    tooltip: {
      enabled: true,
      shared: true,
      theme: document.body.classList.contains('dark') ? 'dark' : 'light',
      custom: createProjectionCurveTooltip(categories, planData, tendData, {
        interactive: true,
        months: extended,
        pointKinds: displayCurve.pointKinds,
      }),
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
      size: [0, 0],
      strokeWidth: 2,
      strokeColors: resolveColor('var(--text-on-dark)'),
      hover: { sizeOffset: 5 },
    },
    responsive: [
      { breakpoint: 600, options: { chart: { height: 300 }, legend: { position: 'bottom' } } },
    ],
  };

  renderApexChart('projChart', options);
}

function formatSignedProjectionValue(value) {
  if (Math.abs(value || 0) < 0.005) return '—';
  return `${value > 0 ? '+' : ''}${fmtR$(value)}`;
}

function projectionDifferenceTone(value) {
  return value > 0 ? 'increase' : value < 0 ? 'reduction' : 'neutral';
}

function openProjectionDifference(selectedMonth) {
  const context = projectionDifferenceContext;
  const dataPointIndex = context?.curve?.months?.indexOf(selectedMonth) ?? -1;
  if (dataPointIndex < 0) return;
  const planned = Number(context.curve.planned[dataPointIndex]) || 0;
  const tendency = context.curve.tendency[dataPointIndex];
  if (!Number.isFinite(tendency)) return;
  const targetDifference = roundCurrency(tendency - planned);
  if (Math.abs(targetDifference) < 0.005) return;

  const breakdown = buildProjectionDifferenceBreakdown({
    projections: context.inputProjections,
    pendingFlows: context.pendingFlows,
    workforcePlan: context.workforcePlan,
    selectedMonth,
    trendStart: context.curve.trendStart,
    dataFim: context.dataFim,
    targetDifference,
  });
  if (!breakdown.available) return;
  const flowDetails = buildProjectionDifferenceFlowDetails({
    pendingFlows: context.pendingFlows,
    selectedMonth,
    trendStart: context.curve.trendStart,
  });

  const rows = breakdown.rows
    .map((row) => {
      const unclassified = row.insumo === '__unclassified__';
      const inputLabel = unclassified ? 'Sem insumo classificado' : row.insumo;
      const inputDescription = unclassified ? '' : descInsumo(row.insumo);
      return `<tr>
        <td>
          <strong>${escHtml(inputLabel)}</strong>
          ${inputDescription && inputDescription !== inputLabel ? `<span>${escHtml(inputDescription)}</span>` : ''}
        </td>
        <td class="num projection-difference-value--${projectionDifferenceTone(row.extrapolacao)}">${formatSignedProjectionValue(row.extrapolacao)}</td>
        <td class="num projection-difference-value--${projectionDifferenceTone(row.workforce)}">${formatSignedProjectionValue(row.workforce)}</td>
        <td class="num projection-difference-value--${projectionDifferenceTone(row.flows)}">${formatSignedProjectionValue(row.flows)}</td>
        <td class="num projection-difference-value--${projectionDifferenceTone(row.total)}"><strong>${formatSignedProjectionValue(row.total)}</strong></td>
      </tr>`;
    })
    .join('');
  const flowRows = flowDetails
    .map((flow) => {
      const unclassified = flow.insumo === '__unclassified__';
      const inputLabel = unclassified ? 'Sem insumo classificado' : flow.insumo;
      return `<tr>
        <td><strong>${escHtml(flow.numero)}</strong></td>
        <td>${escHtml(flow.descricao)}</td>
        <td>
          <strong>${escHtml(inputLabel)}</strong>
          ${
            !unclassified && descInsumo(flow.insumo) !== flow.insumo
              ? `<span>${escHtml(descInsumo(flow.insumo))}</span>`
              : ''
          }
        </td>
        <td class="num projection-difference-value--${projectionDifferenceTone(flow.valor)}"><strong>${formatSignedProjectionValue(flow.valor)}</strong></td>
      </tr>`;
    })
    .join('');
  const flowTotal = roundCurrency(flowDetails.reduce((sum, flow) => sum + flow.valor, 0));
  const flowDetailsMarkup = flowDetails.length
    ? `<section class="projection-difference-flows" aria-labelledby="projectionDifferenceFlowsTitle">
        <div class="projection-difference-section-heading">
          <h3 id="projectionDifferenceFlowsTitle">Flows pendentes na diferença</h3>
          <span>${flowDetails.length} ${flowDetails.length === 1 ? 'Flow' : 'Flows'}</span>
        </div>
        <div class="table-wrap projection-difference-flows-table-wrap">
          <table class="projection-difference-flows-table">
            <thead>
              <tr>
                <th>Flow</th>
                <th>Descrição</th>
                <th>Insumo destino</th>
                <th class="num">Valor</th>
              </tr>
            </thead>
            <tbody>${flowRows}</tbody>
            <tfoot>
              <tr>
                <th colspan="3">Total dos Flows pendentes</th>
                <th class="num projection-difference-value--${projectionDifferenceTone(flowTotal)}">${formatSignedProjectionValue(flowTotal)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>`
    : '';

  replaceWithParsedMarkup(
    document.getElementById('modalContent'),
    `<h2>Δ Composição da diferença · ${escHtml(formatMonthLabel(selectedMonth))}</h2>
    <div class="meta">Base: <strong>${escHtml(activeProjectionManagement())}</strong> · acumulado até o mês selecionado</div>
    <div class="projection-difference-summary">
      <span>Diferença acumulada</span>
      <strong class="projection-difference-value--${projectionDifferenceTone(breakdown.total)}">${formatSignedProjectionValue(breakdown.total)}</strong>
    </div>
    <div class="table-wrap projection-difference-table-wrap">
      <table class="projection-difference-table">
        <thead>
          <tr>
            <th>Insumo</th>
            <th class="num">Extrapolação</th>
            <th class="num">Mão de obra</th>
            <th class="num">Flows pendentes</th>
            <th class="num">Contribuição</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <th>Total</th>
            <td></td>
            <td></td>
            <td></td>
            <th class="num projection-difference-value--${projectionDifferenceTone(breakdown.total)}">${formatSignedProjectionValue(breakdown.total)}</th>
          </tr>
        </tfoot>
      </table>
    </div>
    ${flowDetailsMarkup}`,
  );
  openModal({ initialFocus: '[data-click-action="closeModal"]' });
}

function openProjectionMonthDetail(argument) {
  const [rawIndex, month] = String(argument || '').split('|');
  const node = projectionMonthlyTableModel?.nodes?.[Number(rawIndex)];
  const cell = node?.monthly?.[month];
  if (!node || !cell || Math.abs(cell.total) < 0.005) return;

  const leaves = [];
  function collectLeaves(current) {
    if (!current.children.length) {
      const monthly = current.monthly[month];
      if (
        monthly &&
        (Math.abs(monthly.total) >= 0.005 ||
          monthly.pendingFlowItems.length ||
          monthly.reflectedFlowItems.length)
      ) {
        leaves.push(current);
      }
      return;
    }
    current.children.forEach((index) => collectLeaves(projectionMonthlyTableModel.nodes[index]));
  }
  collectLeaves(node);

  const componentRows = leaves
    .map((leaf) => {
      const monthly = leaf.monthly[month];
      const inputCode = leaf.cod_insumo || 'Sem insumo classificado';
      const description = leaf.cod_insumo ? leaf.item || descInsumo(leaf.cod_insumo) : leaf.item;
      return `<tr>
        <td>
          <strong>${escHtml(inputCode)}</strong>
          ${description && description !== inputCode ? `<span>${escHtml(description)}</span>` : ''}
        </td>
        <td class="num">${metricProjectionMonthValue(monthly.planned - monthly.replacedPlanned)}</td>
        <td class="num projection-difference-value--${projectionDifferenceTone(monthly.extrapolation)}">${formatSignedProjectionValue(monthly.extrapolation)}</td>
        <td class="num projection-difference-value--${projectionDifferenceTone(monthly.workforce)}">${formatSignedProjectionValue(monthly.workforce)}</td>
        <td class="num projection-difference-value--${projectionDifferenceTone(monthly.pendingFlows)}">${formatSignedProjectionValue(monthly.pendingFlows)}</td>
        <td class="num projection-difference-value--${projectionDifferenceTone(monthly.total)}"><strong>${metricProjectionMonthValue(monthly.total)}</strong></td>
      </tr>`;
    })
    .join('');

  function flowDetailRows(items) {
    return items
      .map((flow) => {
        const input = flow.insumo === '__unclassified__' ? 'Sem insumo classificado' : flow.insumo;
        return `<tr>
          <td><strong>${escHtml(flow.numero)}</strong></td>
          <td>${escHtml(flow.descricao)}</td>
          <td>${escHtml(input)}</td>
          <td class="num projection-difference-value--${projectionDifferenceTone(flow.valor)}">${formatSignedProjectionValue(flow.valor)}</td>
        </tr>`;
      })
      .join('');
  }

  const pendingTotal = roundCurrency(
    cell.pendingFlowItems.reduce((sum, flow) => sum + flow.valor, 0),
  );
  const pendingSection = cell.pendingFlowItems.length
    ? `<section class="projection-difference-flows">
        <div class="projection-difference-section-heading">
          <h3>📎 Flows pendentes incluídos no mês</h3>
          <span>${cell.pendingFlowItems.length} ${cell.pendingFlowItems.length === 1 ? 'Flow' : 'Flows'}</span>
        </div>
        <div class="table-wrap projection-difference-flows-table-wrap">
          <table class="projection-difference-flows-table">
            <thead><tr><th>Flow</th><th>Descrição</th><th>Insumo destino</th><th class="num">Valor</th></tr></thead>
            <tbody>${flowDetailRows(cell.pendingFlowItems)}</tbody>
            <tfoot><tr><th colspan="3">Total incluído</th><th class="num">${formatSignedProjectionValue(pendingTotal)}</th></tr></tfoot>
          </table>
        </div>
      </section>`
    : '';
  const reflectedSection = cell.reflectedFlowItems.length
    ? `<section class="projection-difference-flows projection-month-reflected-section">
        <div class="projection-difference-section-heading">
          <h3>✅ Flows já refletidos neste mês</h3>
          <span>Informativos · não somados novamente</span>
        </div>
        <div class="table-wrap projection-difference-flows-table-wrap">
          <table class="projection-difference-flows-table">
            <thead><tr><th>Flow</th><th>Descrição</th><th>Insumo destino</th><th class="num">Valor informado</th></tr></thead>
            <tbody>${flowDetailRows(cell.reflectedFlowItems)}</tbody>
          </table>
        </div>
      </section>`
    : '';

  replaceWithParsedMarkup(
    document.getElementById('modalContent'),
    `<h2>📅 Composição mensal · ${escHtml(formatMonthLabel(month))}</h2>
    <div class="meta">Obra: <strong>${escHtml(activeProjectionProjectKey())}</strong> · Base: <strong>${escHtml(activeProjectionManagement())}</strong> · ${escHtml(node.item || node.cod)}</div>
    <div class="projection-month-summary">
      <div><span>Gestão-base</span><strong>${metricProjectionMonthValue(cell.planned)}</strong></div>
      <div><span>Extrapolação</span><strong>${formatSignedProjectionValue(cell.extrapolation)}</strong></div>
      <div><span>Mão de obra manual</span><strong>${formatSignedProjectionValue(cell.workforce)}</strong></div>
      ${cell.workforceOverride ? `<div><span>Gestão substituída</span><strong>${formatSignedProjectionValue(cell.replacedPlanned + cell.replacedExtrapolation)}</strong></div>` : ''}
      <div><span>Flows pendentes</span><strong>${formatSignedProjectionValue(cell.pendingFlows)}</strong></div>
      <div class="projection-month-summary--total"><span>Total do mês</span><strong>${metricProjectionMonthValue(cell.total)}</strong></div>
    </div>
    <div class="table-wrap projection-difference-table-wrap">
      <table class="projection-difference-table projection-month-composition-table">
        <thead><tr><th>Insumo</th><th class="num">Gestão aplicada</th><th class="num">Extrapolação</th><th class="num">Mão de obra</th><th class="num">Flows pendentes</th><th class="num">Total</th></tr></thead>
        <tbody>${componentRows}</tbody>
        <tfoot><tr><th>Total conciliado</th><td class="num">${metricProjectionMonthValue(cell.planned - cell.replacedPlanned)}</td><td class="num">${formatSignedProjectionValue(cell.extrapolation)}</td><td class="num">${formatSignedProjectionValue(cell.workforce)}</td><td class="num">${formatSignedProjectionValue(cell.pendingFlows)}</td><th class="num">${metricProjectionMonthValue(cell.total)}</th></tr></tfoot>
      </table>
    </div>
    ${pendingSection}
    ${reflectedSection}`,
  );
  openModal({ initialFocus: '[data-click-action="closeModal"]' });
}

function metricProjectionMonthValue(value) {
  return Math.abs(value || 0) < 0.005 ? '—' : fmtR$(value);
}

function activateProjectionDifferenceFromKeyboard(event) {
  if (
    event.target !== event.currentTarget ||
    !['Enter', ' '].includes(event.key) ||
    !projectionDifferenceSelectedMonth
  ) {
    return;
  }
  event.preventDefault();
  openProjectionDifference(projectionDifferenceSelectedMonth);
}

let projSortKey = null;
let projSortDir = 1;
const projExpanded = new Set(); // chaves de grupos/serviços expandidos

// Conta flows que apontam para um insumo (destino ou origem), ignorando cancelados
function flowsPorInsumo(insumo) {
  if (!insumo) return null;
  const refletidos = (f) => isReflectedStatus(f.refletido_status);
  const entrada = getFlowsObraAtiva().filter(
    (f) => refletidos(f) && f.insumo_planejamento === insumo,
  );
  const saida = getFlowsObraAtiva().filter(
    (f) => refletidos(f) && f.insumo_remanejamento === insumo,
  );
  if (!entrada.length && !saida.length) return null;
  const valEntrada = entrada.reduce((s, f) => s + (f.custo_flowmaster || 0), 0);
  const valSaida = saida.reduce((s, f) => s + (f.custo_flowmaster || 0), 0);
  return {
    total: entrada.length + saida.length,
    entrada: entrada.length,
    saida: saida.length,
    valEntrada,
    valSaida,
    refletidos: entrada.length + saida.length, // todos já são refletidos
  };
}

function flowsPorServico(cod_servico) {
  if (!cod_servico) return null;
  // pegar todos os insumos desse serviço a partir do APP_STATE.dados.projRaw
  const insumosSet = new Set(
    getProjRawObraAtiva()
      .filter((r) => r.servico === cod_servico)
      .map((r) => r.insumo),
  );
  let totalN = 0,
    totalE = 0,
    totalS = 0,
    valE = 0,
    valS = 0,
    refl = 0;
  insumosSet.forEach((ins) => {
    const info = flowsPorInsumo(ins);
    if (info) {
      totalN += info.total;
      totalE += info.entrada;
      totalS += info.saida;
      valE += info.valEntrada;
      valS += info.valSaida;
      refl += info.refletidos;
    }
  });
  if (totalN === 0) return null;
  return {
    total: totalN,
    entrada: totalE,
    saida: totalS,
    valEntrada: valE,
    valSaida: valS,
    refletidos: refl,
  };
}

function flowChip(info) {
  if (!info) return '';
  const liquido = info.valEntrada - info.valSaida;
  const tone = liquido > 0 ? 'increase' : liquido < 0 ? 'reduction' : 'neutral';
  const title = `✅ ${info.total} flow(s) refletidos em planejamento · ${info.entrada} entrada(s) (+${fmt(info.valEntrada)}) · ${info.saida} saída(s) (-${fmt(info.valSaida)})`;
  return `<span class="projection-flow-chip" title="${escAttr(title)}">📎 ${info.total} flow${info.total > 1 ? 's' : ''} <span class="projection-flow-chip__value projection-flow-chip__value--${tone}">${liquido >= 0 ? '+' : ''}${fmtR$k(liquido)}</span></span>`;
}

function readProjectionColumnWidthStore() {
  try {
    const parsed = JSON.parse(SafeStorage?.get(PROJECTION_COLUMN_WIDTHS_KEY, '{}') || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readProjectionColumnGroupStore() {
  try {
    const parsed = JSON.parse(SafeStorage?.get(PROJECTION_COLUMN_GROUPS_KEY, '{}') || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function syncProjectionColumnGroups() {
  const project = activeProjectionProjectKey();
  if (projectionColumnGroupProject !== project) {
    const saved = readProjectionColumnGroupStore()[project] || {};
    projectionColumnGroups = {
      summary: saved.summary !== false,
      adherence: saved.adherence !== false,
    };
    projectionColumnGroupProject = project;
  }
  const controls = {
    summary: document.getElementById('projToggleSummaryColumns'),
    adherence: document.getElementById('projToggleAdherenceColumns'),
  };
  for (const [group, control] of Object.entries(controls)) {
    if (!control) continue;
    const expanded = projectionColumnGroups[group];
    control.textContent = `${expanded ? '−' : '+'} ${group === 'summary' ? 'Resumo' : 'Aderência'}`;
    control.setAttribute('aria-expanded', String(expanded));
    control.title = `${expanded ? 'Recolher' : 'Expandir'} colunas de ${group === 'summary' ? 'resumo' : 'aderência mensal'}`;
  }
}

function saveProjectionColumnGroups() {
  const store = readProjectionColumnGroupStore();
  store[activeProjectionProjectKey()] = { ...projectionColumnGroups };
  SafeStorage?.set(PROJECTION_COLUMN_GROUPS_KEY, JSON.stringify(store));
}

function toggleProjectionColumnGroup(group) {
  if (!['summary', 'adherence'].includes(group)) return;
  syncProjectionColumnGroups();
  projectionColumnGroups[group] = !projectionColumnGroups[group];
  saveProjectionColumnGroups();
  syncProjectionColumnGroups();
  renderProjectionMonthlyTable(projectionMonthlyTableModel);
}

function projectionStaticColumnDefinitions() {
  syncProjectionColumnGroups();
  return PROJECTION_STATIC_COLUMNS.filter(
    (column) => !column.group || projectionColumnGroups[column.group],
  );
}

function projectionColumnDefinitions(model = projectionMonthlyTableModel) {
  return [
    ...projectionStaticColumnDefinitions(),
    ...(model?.months || []).map((month) => ({
      id: `month:${month}`,
      label: formatMonthLabel(month).replace(/\/\d{2}(\d{2})$/, '/$1'),
      ...PROJECTION_MONTH_COLUMN,
      month,
    })),
  ];
}

function clampProjectionColumnWidth(definition, value) {
  const numeric = Number(value);
  const candidate = Number.isFinite(numeric) ? numeric : definition.width;
  return Math.round(Math.min(definition.max, Math.max(definition.min, candidate)) / 10) * 10;
}

function loadProjectionColumnWidths(model = projectionMonthlyTableModel) {
  const saved = readProjectionColumnWidthStore()[activeProjectionProjectKey()] || {};
  projectionActiveColumnWidths = Object.fromEntries(
    projectionColumnDefinitions(model).map((definition) => [
      definition.id,
      clampProjectionColumnWidth(definition, saved[definition.id]),
    ]),
  );
  return projectionActiveColumnWidths;
}

function saveProjectionColumnWidths() {
  const store = readProjectionColumnWidthStore();
  store[activeProjectionProjectKey()] = { ...projectionActiveColumnWidths };
  SafeStorage?.set(PROJECTION_COLUMN_WIDTHS_KEY, JSON.stringify(store));
}

function resetProjectionColumnWidths() {
  const store = readProjectionColumnWidthStore();
  delete store[activeProjectionProjectKey()];
  SafeStorage?.set(PROJECTION_COLUMN_WIDTHS_KEY, JSON.stringify(store));
  loadProjectionColumnWidths();
  renderProjectionMonthlyTable(projectionMonthlyTableModel);
}

function projectionStickyOffset(index, widths = projectionActiveColumnWidths) {
  return projectionStaticColumnDefinitions()
    .slice(0, index)
    .reduce((sum, column) => sum + (widths[column.id] || column.width), 0);
}

function projectionStickyClass(index, widths = projectionActiveColumnWidths) {
  const offset = Math.min(
    1600,
    Math.max(0, Math.round(projectionStickyOffset(index, widths) / 10) * 10),
  );
  return `projection-sticky-left-${offset}`;
}

function projectionStickyLimit() {
  const containerWidth = document.querySelector('.projection-table')?.clientWidth || 1200;
  return Math.max(520, Math.min(760, Math.round(containerWidth * 0.58)));
}

function projectionColumnIsSticky(index, widths = projectionActiveColumnWidths) {
  if (index === 0) return true;
  const definitions = projectionStaticColumnDefinitions();
  const definition = definitions[index];
  if (!definition) return false;
  return (
    projectionStickyOffset(index, widths) + (widths[definition.id] || definition.width) <=
    projectionStickyLimit()
  );
}

function projectionStickyClasses(index, widths = projectionActiveColumnWidths) {
  return projectionColumnIsSticky(index, widths)
    ? `projection-sticky-col ${projectionStickyClass(index, widths)}`
    : '';
}

function projectionColumnMarkup(model, widths) {
  return projectionColumnDefinitions(model)
    .map(
      (definition) =>
        `<col id="proj-col-${escAttr(definition.id.replace(':', '-'))}" data-projection-col="${escAttr(definition.id)}" width="${widths[definition.id]}">`,
    )
    .join('');
}

function projectionResizeHandle(definition, width) {
  return `<span
    class="projection-column-resizer"
    role="separator"
    aria-label="Redimensionar coluna ${escAttr(definition.label)}"
    aria-orientation="vertical"
    aria-valuemin="${definition.min}"
    aria-valuemax="${definition.max}"
    aria-valuenow="${width}"
    tabindex="0"
    data-projection-resize="${escAttr(definition.id)}"
  ></span>`;
}

function renderProjectionTableHeader(model, widths) {
  const staticHeaders = projectionStaticColumnDefinitions()
    .map((definition, index) => {
      const sortKeys = {
        label: 'label',
        planned: 'planned',
        realized: 'realized',
        balance: 'balance',
        extrapolation: 'extrapolation',
        tendency: 'tendency',
        previousPlanned: 'previousPlanned',
        currentConsolidated: 'currentConsolidated',
        adherenceDifference: 'adherenceDifference',
      };
      let label = definition.label;
      if (definition.id === 'realized') {
        label = `Realizado até ${formatMonthLabel(addMonths(model.dataCorte, -1))}`;
      } else if (definition.id === 'previousPlanned' && model.comparison?.available) {
        label = `Planejado ${model.comparison.previousManagement}`;
      } else if (definition.id === 'currentConsolidated' && model.comparison?.available) {
        label = `Consolidado ${model.comparison.currentManagement}`;
      } else if (definition.id === 'adherenceDifference' && model.comparison?.available) {
        label = `Diferença · ${formatMonthLabel(model.comparison.comparisonMonth)}`;
      }
      return `<th
      class="${definition.id === 'label' ? '' : 'num '}${projectionStickyClasses(index, widths)}"
      data-sticky-index="${index}"
      data-sort-proj="${sortKeys[definition.id]}"
      aria-sort="none"
      scope="col"
    ><span>${escHtml(label)}</span>${projectionResizeHandle(definition, widths[definition.id])}</th>`;
    })
    .join('');
  const monthHeaders = model.months
    .map((month) => {
      const definition = projectionColumnDefinitions(model).find(
        (column) => column.id === `month:${month}`,
      );
      return `<th class="num projection-month-header" scope="col"><span>${escHtml(definition.label)}</span>${projectionResizeHandle(definition, widths[definition.id])}</th>`;
    })
    .join('');
  replaceWithParsedMarkup(
    document.getElementById('projThead'),
    `<tr>${staticHeaders}${monthHeaders}</tr>`,
  );
  replaceWithParsedMarkup(
    document.getElementById('projColgroup'),
    projectionColumnMarkup(model, widths),
  );
  updateSortHeaderState('th[data-sort-proj]', 'data-sort-proj', projSortKey, projSortDir);
}

function syncProjectionColumnWidths() {
  for (const definition of projectionColumnDefinitions()) {
    const width = projectionActiveColumnWidths[definition.id] || definition.width;
    const column = document.querySelector(
      `#projColgroup col[data-projection-col="${CSS.escape(definition.id)}"]`,
    );
    column?.setAttribute('width', String(width));
    const handle = document.querySelector(
      `#projThead [data-projection-resize="${CSS.escape(definition.id)}"]`,
    );
    handle?.setAttribute('aria-valuenow', String(width));
  }
  document.querySelectorAll('#projMonthlyTable [data-sticky-index]').forEach((cell) => {
    for (const className of [...cell.classList]) {
      if (className.startsWith('projection-sticky-left-')) cell.classList.remove(className);
    }
    cell.classList.remove('projection-sticky-col');
    const index = Number(cell.dataset.stickyIndex) || 0;
    if (projectionColumnIsSticky(index)) {
      cell.classList.add('projection-sticky-col', projectionStickyClass(index));
    }
  });
}

function updateProjectionColumnWidth(columnId, width, persist = false) {
  const definition = projectionColumnDefinitions().find((column) => column.id === columnId);
  if (!definition) return;
  projectionActiveColumnWidths[columnId] = clampProjectionColumnWidth(definition, width);
  syncProjectionColumnWidths();
  if (persist) saveProjectionColumnWidths();
}

function handleProjectionColumnResizePointerDown(event) {
  const handle = event.target.closest('[data-projection-resize]');
  if (!handle || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const columnId = handle.dataset.projectionResize;
  projectionColumnResize = {
    columnId,
    startX: event.clientX,
    startWidth: projectionActiveColumnWidths[columnId],
    pointerId: event.pointerId,
  };
  handle.setPointerCapture?.(event.pointerId);
}

function handleProjectionColumnResizePointerMove(event) {
  if (!projectionColumnResize || event.pointerId !== projectionColumnResize.pointerId) return;
  updateProjectionColumnWidth(
    projectionColumnResize.columnId,
    projectionColumnResize.startWidth + event.clientX - projectionColumnResize.startX,
  );
}

function finishProjectionColumnResize(event) {
  if (!projectionColumnResize || event.pointerId !== projectionColumnResize.pointerId) return;
  projectionColumnResize = null;
  saveProjectionColumnWidths();
}

function handleProjectionColumnResizeKeydown(event) {
  const handle = event.target.closest('[data-projection-resize]');
  if (!handle || !['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const definition = projectionColumnDefinitions().find(
    (column) => column.id === handle.dataset.projectionResize,
  );
  if (!definition) return;
  const nextWidth =
    event.key === 'Home'
      ? definition.width
      : (projectionActiveColumnWidths[definition.id] || definition.width) +
        (event.key === 'ArrowRight' ? 10 : -10);
  updateProjectionColumnWidth(definition.id, nextWidth, true);
}

function activateProjectionSort(event) {
  if (event.target.closest('[data-projection-resize]')) return;
  if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
  const header = event.target.closest('th[data-sort-proj]');
  if (!header) return;
  if (event.type === 'keydown') event.preventDefault();
  const key = header.dataset.sortProj;
  if (projSortKey === key) projSortDir = -projSortDir;
  else {
    projSortKey = key;
    projSortDir = key === 'label' ? 1 : -1;
  }
  renderProjectionMonthlyTable(projectionMonthlyTableModel);
}

function renderProjectionMonthlyTable(model) {
  if (!model) return;
  const widths = loadProjectionColumnWidths(model);
  renderProjectionTableHeader(model, widths);
  const query = String(document.getElementById('projSearch')?.value || '').toLowerCase();
  const groupFilter = document.getElementById('projFilterGrupo')?.value || '';
  const visible = new Set();

  function matchesNode(node) {
    if (query) {
      const searchable = [node.cod, node.cod_servico, node.cod_insumo, node.item]
        .join(' ')
        .toLowerCase();
      if (!searchable.includes(query)) return false;
    }
    return !groupFilter || node.grupo === groupFilter;
  }

  function collectVisible(index) {
    const node = model.nodes[index];
    let childMatch = false;
    for (const childIndex of node.children) {
      if (collectVisible(childIndex)) childMatch = true;
    }
    const match = matchesNode(node);
    if (match || childMatch) visible.add(index);
    return match || childMatch;
  }
  model.roots.forEach(collectVisible);

  function sortedIndexes(indexes) {
    if (!projSortKey) return indexes;
    return [...indexes].sort((leftIndex, rightIndex) => {
      const left = model.nodes[leftIndex];
      const right = model.nodes[rightIndex];
      const leftValue =
        projSortKey === 'label' ? left.item || left.cod || '' : left.metrics[projSortKey] || 0;
      const rightValue =
        projSortKey === 'label' ? right.item || right.cod || '' : right.metrics[projSortKey] || 0;
      if (typeof leftValue === 'string') {
        return projSortDir * leftValue.localeCompare(rightValue, 'pt-BR', { numeric: true });
      }
      return projSortDir * (leftValue - rightValue);
    });
  }

  function stickyCellClass(index, extra = '') {
    return `${extra} ${projectionStickyClasses(index, widths)}`.trim();
  }

  function metricValue(value, strong = false) {
    const content =
      Math.abs(value || 0) < 0.005 ? '<span class="projection-empty-value">—</span>' : fmtR$(value);
    return strong && !content.includes('projection-empty-value')
      ? `<strong>${content}</strong>`
      : content;
  }

  function labelForNode(node, expanded, hasChildren) {
    let icon = '🔍';
    if (node.isFlowOnly) icon = '📎';
    else if (hasChildren) icon = expanded ? '▼' : '▶';
    const code = node.cod_insumo || node.cod_servico || node.cod || '';
    const codeMarkup = code ? `<strong>${escHtml(code)}</strong> · ` : '';
    let chip = '';
    if (node.tipo === 'insumo' && node.cod_insumo) chip = flowChip(flowsPorInsumo(node.cod_insumo));
    else if (node.cod_servico) chip = flowChip(flowsPorServico(node.cod_servico));
    return `<span class="projection-tree-inline-icon" aria-hidden="true">${icon}</span>${codeMarkup}${escHtml(node.item || '')}${chip}`;
  }

  let html = '';
  let count = 0;
  function renderNode(index, level) {
    if (!visible.has(index)) return;
    const node = model.nodes[index];
    const children = node.children.filter((childIndex) => visible.has(childIndex));
    const hasChildren = children.length > 0;
    const key = `${node.tipo}:${node.ordem}`;
    const expanded = projExpanded.has(key);
    const rowClasses = ['projection-tree-row', `projection-tree-row--${node.tipo}`];
    if (node.isFlowOnly) rowClasses.push('projection-tree-row--flow-only');

    let actionAttributes = '';
    if (hasChildren) {
      actionAttributes = `data-proj-action="expand" data-proj-key="${escAttr(key)}" tabindex="0" aria-expanded="${expanded}"`;
    } else if (node.projection) {
      actionAttributes = `data-proj-action="drill" data-servico-cod="${escAttr(node.projection.servico)}" data-insumo-cod="${escAttr(node.projection.insumo)}" tabindex="0"`;
    }

    const label = labelForNode(node, expanded, hasChildren);
    const metrics = node.metrics;
    const staticCells = projectionStaticColumnDefinitions()
      .map((definition, columnIndex) => {
        if (definition.id === 'label') {
          return `<td class="${stickyCellClass(columnIndex, `projection-tree-label projection-tree-depth-${Math.min(level, 6)}`)}" data-sticky-index="${columnIndex}">${label}</td>`;
        }
        let content = metricValue(metrics[definition.id]);
        let extraClass = 'num';
        if (definition.id === 'extrapolation') {
          content = formatSignedProjectionValue(metrics.extrapolation);
        } else if (definition.id === 'tendency') {
          content = metricValue(metrics.tendency, true);
        } else if (definition.group === 'adherence' && !model.comparison?.available) {
          content = '<span class="projection-empty-value">—</span>';
        } else if (definition.id === 'adherenceDifference') {
          content = formatSignedProjectionValue(metrics.adherenceDifference);
          extraClass += ` projection-adherence-value--${projectionDifferenceTone(metrics.adherenceDifference)}`;
        }
        return `<td class="${stickyCellClass(columnIndex, extraClass)}" data-sticky-index="${columnIndex}">${content}</td>`;
      })
      .join('');

    const monthCells = model.months
      .map((month) => {
        const cell = node.monthly[month];
        const hasExtrapolation = Math.abs(cell.extrapolation) >= 0.005;
        const hasPendingFlow = Math.abs(cell.pendingFlows) >= 0.005;
        const hasReflectedFlow = cell.reflectedFlowItems.length > 0;
        const hasWorkforce = cell.workforceOverride;
        const clickable = Math.abs(cell.total) >= 0.005;
        const classes = ['num', 'projection-month-cell'];
        if (hasExtrapolation) classes.push('projection-month-cell--extrapolated');
        if (hasPendingFlow) classes.push('projection-month-cell--flow');
        if (hasReflectedFlow) classes.push('projection-month-cell--reflected');
        if (hasWorkforce) classes.push('projection-month-cell--workforce');
        if (clickable) classes.push('projection-month-cell--clickable');
        const markers = `${hasExtrapolation ? '<span class="projection-month-source-mark" title="Contém extrapolação">◆</span>' : ''}${hasWorkforce ? '<span class="projection-month-workforce-mark" title="Planejamento manual de mão de obra">●</span>' : ''}${hasPendingFlow ? '<span class="projection-month-flow-mark" title="Contém Flow pendente">📎</span>' : ''}${hasReflectedFlow ? '<span class="projection-month-reflected-mark" title="Há Flow já refletido neste mês">✓</span>' : ''}`;
        const value = metricValue(cell.total);
        return `<td class="${classes.join(' ')}">${
          clickable
            ? `<button type="button" class="projection-month-value" data-click-action="openProjectionMonthDetail" data-action-mode="arg" data-action-arg="${index}|${escAttr(month)}" aria-label="Ver composição de ${escAttr(node.item || node.cod)} em ${escAttr(formatMonthLabel(month))}">${markers}<span>${value}</span></button>`
            : `${markers}${value}`
        }</td>`;
      })
      .join('');

    html += `<tr class="${rowClasses.join(' ')}" ${actionAttributes}>${staticCells}${monthCells}</tr>`;
    count += 1;
    if (expanded)
      sortedIndexes(children).forEach((childIndex) => renderNode(childIndex, level + 1));
  }
  sortedIndexes(model.roots).forEach((index) => renderNode(index, 0));

  replaceWithParsedMarkup(document.getElementById('projTbody'), html);
  document.getElementById('projCount').textContent =
    `${count} linhas · ${model.months.length} meses`;
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

function toggleProjExpand(key) {
  if (projExpanded.has(key)) projExpanded.delete(key);
  else projExpanded.add(key);
  renderProjectionMonthlyTable(projectionMonthlyTableModel);
}

function projExpandAll() {
  // Expandir todos os nós que tenham filhos
  if (typeof HIERARQUIA === 'undefined' || !HIERARQUIA) return;
  HIERARQUIA.forEach((n) => {
    // Só vale a pena expandir containers
    if (n.tipo !== 'insumo') {
      projExpanded.add(n.tipo + ':' + n.ordem);
    }
  });
  renderProjectionMonthlyTable(projectionMonthlyTableModel);
}

function projCollapseAll() {
  projExpanded.clear();
  renderProjectionMonthlyTable(projectionMonthlyTableModel);
}

// Exporta a Projeção Detalhada COMPLETA (hierarquia toda expandida, sem filtros) em Excel
async function exportarProjecaoDetalhada() {
  try {
    const model = projectionMonthlyTableModel;
    if (!model?.nodes?.length) {
      authToast('⚠️ Não há dados mensais de Projeção para exportar.', 'warn', 5000);
      return;
    }
    const XLSX = await ensureXlsx();
    const rows = [];
    function walk(index, level) {
      const node = model.nodes[index];
      const row = {
        Nível: level,
        Tipo: node.tipo,
        'Cod. Serviço': node.cod_servico || node.projection?.servico || '',
        'Cod. Insumo': node.cod_insumo || node.projection?.insumo || '',
        Grupo: node.grupo,
        Descrição: `${'  '.repeat(level)}${node.item || node.cod || ''}`,
        'Valor Planejado (R$)': node.metrics.planned,
        [`Realizado até ${formatMonthLabel(addMonths(model.dataCorte, -1))} (R$)`]:
          node.metrics.realized,
        'Saldo (R$)': node.metrics.balance,
        'Extrapolação (R$)': node.metrics.extrapolation,
        'Flows Pendentes (R$)': node.metrics.pendingFlows,
        'Tendência (R$)': node.metrics.tendency,
        'Modelo de previsão': node.projection
          ? FORECAST_METHOD_LABELS[node.projection.forecast_method] || ''
          : '',
        'Confiança da previsão': node.projection?.forecast_confidence || '',
        'Amostra da previsão': node.projection?.forecast_details?.samples || '',
        'Base robusta mensal (R$)': node.projection?.forecast_details?.robustMonthly || '',
        'Correlação física': Number.isFinite(node.projection?.forecast_details?.correlation)
          ? node.projection.forecast_details.correlation
          : '',
        'Coeficiente físico (R$/pp)': node.projection?.forecast_details?.physicalCoefficient || '',
        'Meses atípicos':
          node.projection?.forecast_details?.outliers
            ?.map((item) => formatMonthLabel(item.month))
            .join(', ') || '',
      };
      if (model.comparison?.available) {
        row[`Planejado ${model.comparison.previousManagement} (R$)`] = node.metrics.previousPlanned;
        row[`Consolidado ${model.comparison.currentManagement} (R$)`] =
          node.metrics.currentConsolidated;
        row[`Diferença ${formatMonthLabel(model.comparison.comparisonMonth)} (R$)`] =
          node.metrics.adherenceDifference;
      }
      for (const month of model.months) {
        row[`${formatMonthLabel(month).replace(/\/\d{2}(\d{2})$/, '/$1')} (R$)`] =
          node.monthly[month].total;
      }
      rows.push(row);
      node.children.forEach((childIndex) => walk(childIndex, level + 1));
    }
    model.roots.forEach((index) => walk(index, 0));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const currentWidths = loadProjectionColumnWidths(model);
    worksheet['!cols'] = [
      { wch: 7 },
      { wch: 12 },
      { wch: 16 },
      { wch: 16 },
      { wch: 28 },
      { wch: Math.max(36, Math.round(currentWidths.label / 7)) },
      ...PROJECTION_STATIC_COLUMNS.slice(1).map((column) => ({
        wch: Math.max(14, Math.round((currentWidths[column.id] || column.width) / 7)),
      })),
      ...model.months.map((month) => ({
        wch: Math.max(12, Math.round(currentWidths[`month:${month}`] / 7)),
      })),
    ];
    const numberFormat = '#,##0.00;-#,##0.00;"-"';
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
      for (let column = 6; column <= range.e.c; column += 1) {
        const reference = XLSX.utils.encode_cell({ r: row, c: column });
        const cell = worksheet[reference];
        if (cell && typeof cell.v === 'number') {
          cell.t = 'n';
          cell.z = numberFormat;
        }
      }
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Projeção Mensal');
    if (model.workforcePlan?.rows?.length) {
      const workforceRows = model.workforcePlan.rows.map((row) => {
        const exported = {
          Insumo: row.insumo,
          Cargo: row.cargo,
          'Custo mensal por pessoa (R$)': row.custo_mensal,
        };
        for (const month of model.months) {
          exported[`${formatMonthLabel(month)} · pessoas`] = row.distribuicao[month] || 0;
        }
        exported['Custo total (R$)'] = model.months.reduce(
          (sum, month) => sum + (row.distribuicao[month] || 0) * (Number(row.custo_mensal) || 0),
          0,
        );
        return exported;
      });
      const workforceSheet = XLSX.utils.json_to_sheet(workforceRows);
      workforceSheet['!cols'] = [
        { wch: 14 },
        { wch: 28 },
        { wch: 24 },
        ...model.months.map(() => ({ wch: 16 })),
        { wch: 18 },
      ];
      XLSX.utils.book_append_sheet(workbook, workforceSheet, 'Mão de Obra');
    }
    if (model.physicalContext) {
      const physicalMonths = [
        ...new Set([
          ...Object.keys(model.physicalContext.actualByMonth || {}),
          ...Object.keys(model.physicalContext.plannedByMonth || {}),
        ]),
      ].sort();
      const physicalRows = physicalMonths.map((month) => ({
        Mês: month,
        'Planejado normalizado (%)': model.physicalContext.plannedByMonth?.[month] ?? null,
        'Realizado normalizado (%)': model.physicalContext.actualByMonth?.[month] ?? null,
      }));
      const physicalSheet = XLSX.utils.json_to_sheet(physicalRows);
      physicalSheet['!cols'] = [{ wch: 12 }, { wch: 26 }, { wch: 26 }];
      XLSX.utils.book_append_sheet(workbook, physicalSheet, 'Evolução Física');
    }
    const metadata = XLSX.utils.json_to_sheet([
      { Campo: 'Obra', Valor: activeProjectionProjectKey() },
      { Campo: 'Gestão-base', Valor: activeProjectionManagement() },
      { Campo: 'Data de corte', Valor: model.dataCorte },
      { Campo: 'Data prevista de término', Valor: model.dataFim },
      {
        Campo: 'Regra mensal',
        Valor: 'Gestão ou mão de obra manual + extrapolação + Flows pendentes',
      },
      {
        Campo: 'Mão de obra manual',
        Valor:
          WORKFORCE_INPUTS.filter((input) => model.workforcePlan?.enabledByInput?.[input]).join(
            ', ',
          ) || 'Desativada',
      },
      {
        Campo: 'Metodologia da previsão',
        Valor: model.forecastComparison?.active ? 'Modelo configurável ativo' : 'Cálculo atual',
      },
      {
        Campo: 'Cronograma físico',
        Valor: model.forecastComparison?.sourceFile || 'Não disponível',
      },
      { Campo: 'Exportado em', Valor: new Date().toLocaleString('pt-BR') },
    ]);
    metadata['!cols'] = [{ wch: 32 }, { wch: 52 }];
    XLSX.utils.book_append_sheet(workbook, metadata, 'Metadados');
    const filename = `projecao-mensal_${activeProjectionProjectKey()}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, filename);
    authToast(`✅ Projeção mensal exportada: ${filename}`, 'ok', 3500);
  } catch (error) {
    reportNonFatalError('Projeção/exportar grade mensal', error);
    authToast(`❌ Erro ao exportar: ${error.message || error}`, 'err', 5000);
  }
}

function pendingFlowImpactForTarget(servico, insumo) {
  const targetInputs = insumo
    ? new Set([insumo])
    : new Set(
        getProjRawObraAtiva()
          .filter((row) => row.servico === servico)
          .map((row) => row.insumo),
      );
  return getFlowsObraAtiva().reduce((total, flow) => {
    if (flow.dep === 'Cancelado' || (flow.refletido_status || 'pendente') !== 'pendente') {
      return total;
    }
    const value = flow.custo_flowmaster || 0;
    let impact = 0;
    if (targetInputs.has(flow.insumo_planejamento)) impact += value;
    if (targetInputs.has(flow.insumo_remanejamento)) impact -= value;
    return total + impact;
  }, 0);
}

function openProjDrill(servico, insumo) {
  const dataCorte = document.getElementById('projDataCorte').value || defaultDataCorte();
  const dataFim = document.getElementById('projDataFim').value || defaultDataFim();
  const janelaMeses = parseInt(document.getElementById('projMetodo').value) || 6;
  const activeSnapshot = buildActiveProjectionSnapshot();

  const mesesServico = {};
  const mesesPorInsumo = new Map();
  getProjRawObraAtiva()
    .filter((row) => row.servico === servico)
    .forEach((row) => {
      mesesServico[row.mes] = (mesesServico[row.mes] || 0) + row.valor;
      const mesesDoInsumo = mesesPorInsumo.get(row.insumo) || {};
      mesesDoInsumo[row.mes] = (mesesDoInsumo[row.mes] || 0) + row.valor;
      mesesPorInsumo.set(row.insumo, mesesDoInsumo);
    });

  const projInsumos = activeSnapshot.inputProjections.filter(
    (projection) => projection.servico === servico,
  );
  const sumProjectionMetric = (metric) =>
    projInsumos.reduce((sum, projection) => sum + (Number(projection[metric]) || 0), 0);
  const projServico = {
    servico,
    grupo: grupoDoServico(servico),
    realizado: sumProjectionMetric('realizado'),
    planejado_futuro: sumProjectionMetric('planejado_futuro'),
    planejado_total: sumProjectionMetric('planejado_total'),
    ultimo_mes_planejado: projInsumos
      .map((projection) => projection.ultimo_mes_planejado)
      .filter(Boolean)
      .sort()
      .at(-1),
    ritmo_historico: sumProjectionMetric('ritmo_historico'),
    meses_gap: Math.max(0, ...projInsumos.map((projection) => projection.meses_gap || 0)),
    extrapolacao: sumProjectionMetric('extrapolacao'),
    tendencia: sumProjectionMetric('tendencia'),
    diff: sumProjectionMetric('diff'),
    meses: mesesServico,
  };

  let meses;
  let proj;
  let titulo, subtitulo;
  if (insumo) {
    meses = mesesPorInsumo.get(insumo) || {};
    proj =
      projInsumos.find((projection) => projection.insumo === insumo) ||
      projetarServico(servico, meses, dataCorte, dataFim, janelaMeses);
    titulo = `${servico} · ${insumo}`;
    subtitulo = descInsumo(insumo);
  } else {
    meses = mesesServico;
    proj = projServico;
    titulo = servico;
    subtitulo = descServico(servico);
  }

  const pendingFlowImpact = pendingFlowImpactForTarget(servico, insumo);
  const workforcePlan = activeSnapshot.workforcePlan;
  const curveProjections = insumo ? [proj] : projInsumos;
  const workforceAdjustments = buildWorkforceCurveAdjustments({
    inputProjections: curveProjections,
    workforcePlan,
    dataCorte,
    dataFim,
  });
  const curve = buildProjectionCurve(
    meses,
    curveProjections,
    dataCorte,
    dataFim,
    pendingFlowImpact,
    workforceAdjustments,
  );
  const extended = curve.months;
  const categories = extended.map((m) => formatMonthLabel(m));
  const planData = curve.planned;
  const tendData = curve.tendency;
  const saldoPlanejado = proj.planejado_total - proj.realizado;
  const monthlyNode = activeSnapshot.monthlyModel.nodes.find((node) =>
    insumo
      ? node.projection?.servico === servico && node.projection?.insumo === insumo
      : node.tipo === 'servico' && node.cod_servico === servico,
  );
  const effectiveExtrapolation = monthlyNode?.metrics.extrapolation ?? proj.extrapolacao;
  const workforceTotal = monthlyNode?.metrics.workforce || 0;
  const finalTrend = monthlyNode?.metrics.tendency ?? proj.tendencia + pendingFlowImpact;
  const finalDifference = finalTrend - proj.planejado_total;
  const extrapolacaoTexto =
    Math.abs(effectiveExtrapolation) < 0.005
      ? '—'
      : `${effectiveExtrapolation > 0 ? '+' : ''}${fmtR$(effectiveExtrapolation)}`;
  const forecastMethodMarkup = forecastConfigMarkup(proj, servico, insumo, activeSnapshot);

  const findIdx = (m) => {
    let i = 0;
    for (let j = 0; j < extended.length; j++) if (extended[j] <= m) i = j;
    return i;
  };
  const corteIdx = findIdx(dataCorte);
  const fimIdx = findIdx(dataFim);

  replaceWithParsedMarkup(
    document.getElementById('modalContent'),
    `
    <h2>🔮 Projeção · ${escHtml(titulo)}</h2>
    <div class="meta">${escHtml(subtitulo)} · Grupo: <strong>${escHtml(proj.grupo)}</strong> ${grupoExtrapola(proj.grupo) ? '<span class="badge purple">extrapola</span>' : '<span class="badge gray">não extrapola</span>'}</div>
    ${forecastMethodMarkup}
    <div class="kpis kpi-2col projection-modal-kpis">
      <div class="kpi kpi-wide projection-modal-card">
        <h3 class="projection-modal-card-title">📊 Planejado</h3>
        <div class="projection-modal-metric">
          <div class="projection-modal-metric-label">Planejado Total</div>
          <strong class="projection-modal-metric-value">${fmtR$(proj.planejado_total)}</strong>
        </div>
        <div class="projection-modal-metric">
          <div class="projection-modal-metric-label">Realizado</div>
          <strong class="projection-modal-metric-value">${fmtR$(proj.realizado)}</strong>
        </div>
        <hr class="border-top-soft projection-modal-divider">
        <div class="projection-modal-metric">
          <div class="projection-modal-metric-label">Saldo</div>
          <strong class="projection-modal-metric-value">${fmtR$(saldoPlanejado)}</strong>
        </div>
      </div>
      <div class="kpi kpi-wide projection-modal-card ${finalDifference > 0 ? 'red' : finalDifference < 0 ? 'green' : ''}">
        <h3 class="projection-modal-card-title">🔮 Extrapolação</h3>
        <div class="projection-modal-metric">
          <div class="projection-modal-metric-label">Saldo</div>
          <strong class="projection-modal-metric-value">${fmtR$(saldoPlanejado)}</strong>
        </div>
        <div class="projection-modal-metric">
          <div class="projection-modal-metric-label">Extrapolação</div>
          <div class="projection-modal-extrapolation-line">
            <strong class="projection-modal-metric-value">${extrapolacaoTexto}</strong>
            <span class="projection-modal-calculation">- ${proj.meses_gap > 0 ? `${proj.meses_gap} meses · ${escHtml(FORECAST_METHOD_LABELS[proj.forecast_method] || 'Média histórica')}` : 'Sem meses adicionais'}</span>
          </div>
        </div>
        ${
          Math.abs(workforceTotal) >= 0.005
            ? `<div class="projection-modal-metric">
          <div class="projection-modal-metric-label">Mão de obra manual</div>
          <strong class="projection-modal-metric-value">${fmtR$(workforceTotal)}</strong>
        </div>`
            : ''
        }
        ${
          Math.abs(pendingFlowImpact) >= 0.005
            ? `<div class="projection-modal-metric">
          <div class="projection-modal-metric-label">Flows pendentes</div>
          <strong class="projection-modal-metric-value">${pendingFlowImpact > 0 ? '+' : ''}${fmtR$(pendingFlowImpact)}</strong>
        </div>`
            : ''
        }
        <hr class="border-top-soft projection-modal-divider">
        <div class="projection-modal-metric projection-modal-metric--total">
          <div class="projection-modal-metric-label">Tendência Final</div>
          <strong class="projection-modal-metric-value">${fmtR$(finalTrend)}</strong>
        </div>
      </div>
    </div>
    <h3 class="projection-modal-chart-heading">📈 Curva S individual</h3>
    <div id="modalProjChart" class="projection-modal-chart"></div>
    ${renderFlowsRefletidosSection(servico, insumo)}
    ${renderMovimentacoesProjecaoSection(servico, insumo)}
  `,
  );

  // Renderizar ApexCharts no modal
  const modalChartOptions = {
    series: [
      {
        name: `Planejado acumulado · ${activeProjectionManagement()}`,
        type: 'area',
        data: planData,
      },
      { name: 'Tendência projetada', type: 'line', data: tendData },
    ],
    chart: {
      height: 300,
      animations: { enabled: true, easing: 'easeinout', speed: 600 },
      toolbar: {
        show: true,
        tools: {
          download: true,
          selection: true,
          zoom: true,
          zoomin: true,
          zoomout: true,
          pan: true,
          reset: true,
          customIcons: [
            {
              icon: `<button type="button" class="projection-chart-lock-button" aria-label="${projectionChartLocked ? 'Desbloquear zoom e movimentação' : 'Bloquear zoom e movimentação'}"><span class="projection-chart-lock-symbol" aria-hidden="true">${projectionChartLocked ? '🔒' : '🔓'}</span></button>`,
              index: 2,
              title: projectionChartLocked
                ? 'Desbloquear zoom e movimentação'
                : 'Bloquear zoom e movimentação',
              class: 'projection-chart-lock-toggle',
              click: toggleProjectionChartLock,
            },
          ],
        },
      },
      zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
      events: {
        mounted: syncProjectionChartLockUi,
        updated: syncProjectionChartLockUi,
        beforeZoom: (chartContext, { xaxis }) =>
          projectionChartLocked
            ? {
                xaxis: {
                  min: chartContext.w.globals.minX,
                  max: chartContext.w.globals.maxX,
                },
              }
            : { xaxis },
        beforeResetZoom: (chartContext) =>
          projectionChartLocked
            ? {
                xaxis: {
                  min: chartContext.w.globals.minX,
                  max: chartContext.w.globals.maxX,
                },
              }
            : undefined,
      },
    },
    themePalette: ['var(--chart-primary)', 'var(--sem-alerta)'],
    colors: [resolveColor('var(--chart-primary)'), resolveColor('var(--sem-alerta)')],
    stroke: { curve: 'smooth', width: [2.5, 2.5] },
    fill: {
      type: ['gradient', 'solid'],
      gradient: { shadeIntensity: 1, opacityFrom: 0.15, opacityTo: 0.02, stops: [0, 100] },
    },
    xaxis: {
      categories: categories,
      labels: {
        rotate: -45,
        rotateAlways: true,
        formatter: projectionCategoryLabelFormatter(categories, true),
        style: { fontSize: '10px' },
      },
    },
    yaxis: { labels: { formatter: (val) => fmtR$k(val), style: { fontSize: '10px' } } },
    annotations: {
      xaxis: [
        {
          x: categories[corteIdx],
          borderColor: resolveColor('var(--fgr-red-vivid)'),
          strokeDashArray: 4,
          label: {
            text: 'Corte',
            style: {
              color: resolveColor('var(--text-on-dark)'),
              background: resolveColor('var(--fgr-red-vivid)'),
              fontSize: '10px',
              padding: { left: 6, right: 6, top: 2, bottom: 2 },
            },
          },
        },
        {
          x: categories[fimIdx],
          borderColor: resolveColor('var(--chart-neutral)'),
          strokeDashArray: 2,
          label: {
            text: 'Fim',
            orientation: 'vertical',
            position: 'bottom',
            offsetY: -10,
            style: {
              color: resolveColor('var(--text-on-dark)'),
              background: resolveColor('var(--chart-neutral)'),
              fontSize: '10px',
              padding: { left: 6, right: 6, top: 2, bottom: 2 },
            },
          },
        },
      ],
    },
    tooltip: {
      enabled: true,
      shared: true,
      theme: document.body.classList.contains('dark') ? 'dark' : 'light',
      custom: createProjectionCurveTooltip(categories, planData, tendData),
    },
    legend: {
      show: true,
      position: 'top',
      fontSize: '11px',
      labels: { colors: resolveColor('var(--chart-text)') },
    },
    grid: { borderColor: resolveColor('var(--chart-grid)'), strokeDashArray: 3 },
    dataLabels: { enabled: false },
    markers: {
      size: [0, 0],
      strokeWidth: 2,
      strokeColors: resolveColor('var(--text-on-dark)'),
      hover: { sizeOffset: 5 },
    },
  };

  // Renderizar após o conteúdo do modal estar no DOM
  setTimeout(() => renderApexChart('modalProjChart', modalChartOptions), 50);
  openModal();
  const forecastMethod = document.getElementById('projectionForecastMethod');
  forecastMethod?.addEventListener('change', syncForecastConfigFields);
  syncForecastConfigFields();
  document.getElementById('projectionForecastConfigForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    const values = {
      method: document.getElementById('projectionForecastMethod')?.value,
      sampleMonths: Number(document.getElementById('projectionForecastSample')?.value),
      lagMonths: Number(document.getElementById('projectionForecastLag')?.value),
      fixedShare: Number(document.getElementById('projectionForecastFixedShare')?.value),
      manualMonthlyValue:
        parseNumber(document.getElementById('projectionForecastManualValue')?.value) || 0,
    };
    void changeProjectionForecastOverride(servico, insumo, values).then((saved) => {
      if (saved) openProjDrill(servico, insumo);
      else if (button) button.disabled = false;
    });
  });
}

// Renderiza a seção "Movimentações de Projeção" no modal de drill-down da Tendência
function renderMovimentacoesProjecaoSection(servico, insumo) {
  // Só faz sentido se houver insumo (linhas folha) - para serviço é mais complicado
  const projectionControlState = getProjectionControlState();
  const insumoControlado = projectionControlState?.insumo || 'I011890';
  // Para insumo específico: mostrar movimentações que tocaram esse insumo (vindas da Projeção)
  // Para serviço: agregar dos insumos do serviço
  let alvos = [];
  if (insumo) {
    alvos = [insumo];
  } else if (servico) {
    alvos = [
      ...new Set(
        getProjRawObraAtiva()
          .filter((r) => r.servico === servico)
          .map((r) => r.insumo),
      ),
    ];
  }
  if (!alvos.length) return '';
  // Excluir o próprio insumo controlado da lista de "outros impactados"
  alvos = alvos.filter((a) => a !== insumoControlado);
  if (!alvos.length) return '';

  // Movimentações manuais (não-flow) que tocam algum desses alvos
  const movsManuais = (projectionControlState?.movimentacoes || []).filter((m) => {
    return alvos.includes(m.origem) || alvos.includes(m.destino);
  });

  if (!movsManuais.length) {
    return `
      <div class="projection-detail-empty projection-detail-empty--movement">
        💰 Nenhuma movimentação manual da Verba de Projeção (${escHtml(insumoControlado)}) registrada para este ${insumo ? 'insumo' : 'serviço'}.<br>
        <span class="projection-detail-empty-help">Use a aba "📦 Controle Projeção" para registrar remanejamentos básicos, aportes ou devoluções fora de aditivos.</span>
      </div>
    `;
  }

  const tipoBadge = {
    aditivo: '<span class="badge blue">🔵 Aditivo</span>',
    remanejamento: '<span class="badge purple">🟣 Remanejamento</span>',
    aporte: '<span class="badge green">🟢 Aporte</span>',
    devolucao: '<span class="badge amber">🟠 Devolução</span>',
  };

  const totEntrada = movsManuais
    .filter((m) => alvos.includes(m.destino))
    .reduce((s, m) => s + (m.valor || 0), 0);
  const totSaida = movsManuais
    .filter((m) => alvos.includes(m.origem))
    .reduce((s, m) => s + (m.valor || 0), 0);
  const liquido = totEntrada - totSaida;

  // Ordenar por data desc
  movsManuais.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  const cards = movsManuais
    .map((m) => {
      const ehEntrada = alvos.includes(m.destino);
      const direcao = ehEntrada ? 'entrada' : 'saida';
      const dirIcon = ehEntrada ? '➡️ entrada' : '⬅️ saída';
      const insumoAlvo = ehEntrada ? m.destino : m.origem;
      const valor = m.valor || 0;
      return `
      <div class="projection-detail-card projection-detail-card--${direcao}">
        <div class="projection-detail-card-header">
          <div class="projection-detail-card-meta">
            <strong>${escHtml(m.id)}</strong>
            ${tipoBadge[m.tipo] || m.tipo}
            <span class="projection-detail-card-date">${escHtml(m.data_br || m.data || '')}</span>
            <span class="projection-detail-card-direction projection-detail-card-direction--${direcao}">${dirIcon}</span>
            <span class="projection-detail-card-target"> · insumo ${escHtml(insumoAlvo)}</span>
            ${!insumo ? '' : ''}
          </div>
          <span class="projection-detail-card-amount projection-detail-card-amount--${ehEntrada ? 'increase' : 'reduction'}">${ehEntrada ? '+' : '-'}${fmtR$(valor)}</span>
        </div>
        <div class="projection-detail-card-description">${escHtml(m.descricao || '')}</div>
        ${m.justificativa ? `<div class="projection-detail-card-justification"><em>Justificativa:</em> ${escHtml(m.justificativa.slice(0, 180))}${m.justificativa.length > 180 ? '...' : ''}</div>` : ''}
        ${m.responsavel ? `<div class="projection-detail-card-responsible">Responsável: ${escHtml(m.responsavel)}</div>` : ''}
      </div>
    `;
    })
    .join('');

  return `
    <div class="projection-detail-section">
      <h3 class="projection-detail-section-heading">
        💰 Movimentações da Verba de Projeção ${escHtml(insumoControlado)} <span class="projection-detail-section-count">${movsManuais.length} movimentação(ões) manual(is)</span>
      </h3>
      <div class="projection-detail-summary projection-detail-summary--manual">
        <span><strong>${movsManuais.filter((m) => alvos.includes(m.destino)).length}</strong> entrada(s): <strong class="projection-detail-summary-increase">+${fmtR$(totEntrada)}</strong></span>
        <span><strong>${movsManuais.filter((m) => alvos.includes(m.origem)).length}</strong> saída(s): <strong class="projection-detail-summary-reduction">-${fmtR$(totSaida)}</strong></span>
        <span>Líquido: <strong class="projection-detail-summary-${liquido < 0 ? 'reduction' : 'increase'}">${liquido >= 0 ? '+' : ''}${fmtR$(liquido)}</strong></span>
      </div>
      ${cards}
    </div>
  `;
}

// Renderiza a seção "Flows Refletidos" dentro do modal de drill-down
function renderFlowsRefletidosSection(servico, insumo) {
  // Pega Flows refletidos e pendentes que apontam para este serviço/insumo.
  const statusOf = (f) => f.refletido_status || 'pendente';
  const isRefl = (f) => isReflectedStatus(statusOf(f));
  const isPend = (f) => statusOf(f) === 'pendente';

  function coletarFlows(filtroStatus) {
    if (insumo) {
      return getFlowsObraAtiva()
        .filter(
          (f) =>
            filtroStatus(f) &&
            f.dep !== 'Cancelado' &&
            (f.insumo_planejamento === insumo || f.insumo_remanejamento === insumo),
        )
        .map((f) => ({ ...f, _direcao: f.insumo_planejamento === insumo ? 'entrada' : 'saida' }));
    } else {
      const insumosSet = new Set(
        getProjRawObraAtiva()
          .filter((r) => r.servico === servico)
          .map((r) => r.insumo),
      );
      return getFlowsObraAtiva()
        .filter(
          (f) =>
            filtroStatus(f) &&
            f.dep !== 'Cancelado' &&
            (insumosSet.has(f.insumo_planejamento) || insumosSet.has(f.insumo_remanejamento)),
        )
        .map((f) => {
          const ehEntrada = insumosSet.has(f.insumo_planejamento);
          return {
            ...f,
            _direcao: ehEntrada ? 'entrada' : 'saida',
            _insumoAlvo: ehEntrada ? f.insumo_planejamento : f.insumo_remanejamento,
          };
        });
    }
  }

  const flowsRel = coletarFlows(isRefl);
  const flowsPend = coletarFlows(isPend);

  if (!flowsRel.length && !flowsPend.length) {
    return `
      <div class="projection-detail-empty projection-detail-empty--flows">
        📎 Nenhum flow (refletido ou pendente) para este ${insumo ? 'insumo' : 'serviço'}.<br>
        <span class="projection-detail-empty-help projection-detail-empty-help--flows">Vá na aba "🔗 Flows / Aditivos" para classificar aditivos.</span>
      </div>
    `;
  }

  // Ordenar por data desc
  const ordenar = (arr) =>
    arr.sort((a, b) => {
      const da = a.data || '';
      const db = b.data || '';
      return db.localeCompare(da);
    });
  ordenar(flowsRel);
  ordenar(flowsPend);

  const depBadge = {
    Finalizado: 'green',
    Projeto: 'amber',
    Cancelado: 'gray',
    Planejamento: 'blue',
    Orçamento: 'blue',
    Obra: 'amber',
  };
  const tipoLabel = {
    aumento_real: '<span class="badge red">🔴 Aum.real</span>',
    remanejamento: '<span class="badge cyan">🔵 Remanej.</span>',
    economia: '<span class="badge green">🟢 Economia</span>',
    pendente: '<span class="badge amber">🟡 Pendente</span>',
    cancelado: '<span class="badge gray">🚫 Cancelado</span>',
    sem_classificacao: '<span class="badge gray">⚪ Sem class.</span>',
    misto: '<span class="badge gray">⚪ Misto</span>',
  };

  function renderCard(f) {
    const dir = f._direcao;
    const dirIcon = dir === 'entrada' ? '➡️ entrada' : '⬅️ saída';
    const valor = f.custo_flowmaster || 0;
    const insAlvoTxt = f._insumoAlvo
      ? `<span class="projection-detail-card-target"> · insumo ${escHtml(f._insumoAlvo)}</span>`
      : '';
    return `
      <div class="projection-detail-card projection-detail-card--${dir}">
        <div class="projection-detail-card-header">
          <div class="projection-detail-card-meta">
            <strong>Nº ${escHtml(f.n_alteracao)}</strong>
            ${f.is_manual ? '<span class="badge-manual">✋ Manual</span>' : ''}
            <span class="badge ${depBadge[f.dep] || 'gray'}">${escHtml(f.dep || '')}</span>
            ${tipoLabel[f.tipo] || ''}
            <span class="projection-detail-card-date">${escHtml(formatDate(f.data_br))}</span>
            <span class="projection-detail-card-direction projection-detail-card-direction--${dir}">${dirIcon}</span>
            ${insAlvoTxt}
          </div>
          <span class="projection-detail-card-amount projection-detail-card-amount--${valor < 0 ? 'reduction' : 'increase'}">${valor >= 0 ? '+' : ''}${fmtR$(valor)}</span>
        </div>
        <div class="projection-detail-card-description"><strong>${escHtml(f.motivo || '')}</strong></div>
        <div class="projection-detail-card-copy">${escHtml((f.descricao || '').slice(0, 220))}${(f.descricao || '').length > 220 ? '...' : ''}</div>
        ${f.justificativa ? `<div class="projection-detail-card-justification"><em>Justificativa:</em> ${escHtml(f.justificativa.slice(0, 180))}${f.justificativa.length > 180 ? '...' : ''}</div>` : ''}
      </div>
    `;
  }

  function renderSecao(titulo, lista, tone) {
    if (!lista.length) return '';
    const totE = lista
      .filter((f) => f._direcao === 'entrada')
      .reduce((s, f) => s + (f.custo_flowmaster || 0), 0);
    const totS = lista
      .filter((f) => f._direcao === 'saida')
      .reduce((s, f) => s + (f.custo_flowmaster || 0), 0);
    const liq = totE - totS;
    return `
      <div class="projection-detail-section">
        <h3 class="projection-detail-section-heading">
          ${titulo} <span class="projection-detail-section-count">${lista.length} aditivo(s)</span>
        </h3>
        <div class="projection-detail-summary projection-detail-summary--${tone}">
          <span><strong>${lista.filter((f) => f._direcao === 'entrada').length}</strong> entrada(s): <strong class="projection-detail-summary-increase">+${fmtR$(totE)}</strong></span>
          <span><strong>${lista.filter((f) => f._direcao === 'saida').length}</strong> saída(s): <strong class="projection-detail-summary-reduction">-${fmtR$(totS)}</strong></span>
          <span>Líquido: <strong class="projection-detail-summary-${liq < 0 ? 'reduction' : 'increase'}">${liq >= 0 ? '+' : ''}${fmtR$(liq)}</strong></span>
        </div>
        ${lista.map(renderCard).join('')}
      </div>
    `;
  }

  return `
    ${renderSecao('✅ Flows refletidos no planejamento', flowsRel, 'reflected')}
    ${renderSecao('⏳ Flows pendentes (ainda não refletidos) — entram como extrapolação', flowsPend, 'pending')}
  `;
}

export function createProjectionView({
  runtime,
  loadXlsx,
  storage,
  feedback,
  modals,
  viewStates,
  state,
  overview,
  projectionControl,
  dashboardRepository,
  authService,
}) {
  reportNonFatalError = runtime.reportNonFatalError;
  resolveColor = runtime.resolveColor;
  renderApexChart = runtime.renderApexChart;
  getProjRawObraAtiva = runtime.getActiveProjection;
  getFlowsObraAtiva = runtime.getActiveFlows;
  ensureXlsx = loadXlsx;
  authToast = feedback.toast;
  openModal = modals.open;
  renderDashboardState = viewStates.render;
  APP_STATE = state;
  renderAderenciaProj = overview.renderAderenciaProj;
  renderVisao = overview.renderVisao;
  SafeStorage = storage;
  getProjectionControlState = projectionControl.getState;
  workforceRepository = dashboardRepository;
  forecastRepository = dashboardRepository;
  canEditWorkforce = () => authService?.canEditActiveProject?.() === true;
  canManageForecast = () => authService?.isAdmin?.() === true;
  const api = {
    defaultDataCorte,
    defaultDataFim,
    initProjecao,
    calcularFlowsPendentesPorGrupo,
    projetarServico,
    buildSnapshot: buildActiveProjectionSnapshot,
    renderProjecao,
    toggleProjExpand,
    openProjDrill,
    openProjectionDifference,
    openProjectionMonthDetail,
    projExpandAll,
    projCollapseAll,
    toggleProjectionColumnGroup,
    setProjectionWorkforceChartMode,
    addProjectionWorkforceRow,
    deleteProjectionWorkforceRow,
    resetProjectionColumnWidths,
    toggleProjectionForecastMode,
    exportarProjecaoDetalhada,
  };

  document.getElementById('projTbody')?.addEventListener('click', activateProjectionRow);
  document.getElementById('projTbody')?.addEventListener('keydown', activateProjectionRow);
  const generalChart = document.getElementById('projChart');
  if (generalChart) {
    generalChart.tabIndex = 0;
    generalChart.setAttribute(
      'aria-label',
      'Curva S geral. Pressione Enter para detalhar a diferença do período selecionado.',
    );
    generalChart.addEventListener('keydown', activateProjectionDifferenceFromKeyboard);
  }
  const projectionHead = document.getElementById('projThead');
  projectionHead?.addEventListener('click', activateProjectionSort);
  projectionHead?.addEventListener('keydown', (event) => {
    handleProjectionColumnResizeKeydown(event);
    if (!event.defaultPrevented) activateProjectionSort(event);
  });
  projectionHead?.addEventListener('pointerdown', handleProjectionColumnResizePointerDown);
  document.addEventListener('pointermove', handleProjectionColumnResizePointerMove);
  document.addEventListener('pointerup', finishProjectionColumnResize);
  document.addEventListener('pointercancel', finishProjectionColumnResize);
  const workforceBody = document.getElementById('projectionWorkforceTbody');
  workforceBody?.addEventListener('input', handleProjectionWorkforceInput);
  workforceBody?.addEventListener('change', (event) => {
    handleProjectionWorkforceInput(event);
    if (event.target.dataset.workforceField === 'custo_mensal') {
      event.target.value = formatEditableNumber(parseNumber(event.target.value) || 0);
    }
  });
  workforceBody?.addEventListener('paste', handleProjectionWorkforcePaste);
  workforceBody?.addEventListener('keydown', handleProjectionWorkforceKeydown);
  document.getElementById('projectionWorkforceCard')?.addEventListener('change', (event) => {
    const input = event.target.dataset.workforceSetting;
    if (input) changeProjectionWorkforceSetting(input, event.target.checked);
  });

  const sharedParameterIds = new Set([
    'projDataFim',
    'projDataCorte',
    'projMetodo',
    'projTolerancia',
  ]);
  [...sharedParameterIds].forEach((id) => {
    const element = document.getElementById(id);
    if (!element) return;
    const handler = (event) => {
      if (id === 'projTolerancia' && event.type === 'change') {
        normalizeToleranciaInput(element);
      }
      try {
        if (id === 'projDataFim') saveDataFim(element.value);
        renderProjecao();
      } catch (error) {
        reportNonFatalError('Projeção/renderizar após filtro', error);
      }
      try {
        renderVisao();
      } catch (error) {
        reportNonFatalError('Visão geral/renderizar após projeção', error);
      }
    };
    element.addEventListener('input', handler);
    element.addEventListener('change', handler);
    if (id === 'projTolerancia')
      element.addEventListener('blur', () => normalizeToleranciaInput(element));
  });
  ['projSearch', 'projFilterGrupo'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => {
      renderProjectionMonthlyTable(projectionMonthlyTableModel);
    });
    document.getElementById(id)?.addEventListener('change', () => {
      renderProjectionMonthlyTable(projectionMonthlyTableModel);
    });
  });
  return Object.freeze(api);
}
