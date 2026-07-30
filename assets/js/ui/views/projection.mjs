import { replaceWithParsedMarkup } from '../dom.mjs';
import { PROJECTION_CATALOG } from '../../data/projection-catalog.mjs';
import { STORAGE_KEYS } from '../../config.js';
import { escAttr, escHtml, formatDate } from '../formatters.mjs';
import {
  bindSortableHeaders,
  isTableRowActivation,
  updateSortHeaderState,
} from '../table-interactions.mjs';
import {
  formatCompactNumber as fmtR$k,
  formatNumber as fmt,
  formatNumber as fmtR$,
} from '../dashboard-runtime.mjs';
import { parseNumber } from '../../parsers/shared.mjs';

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
let renderVisao;
let SafeStorage;
let projectionSettingsProject = null;
let projectionChartLocked = false;

const PROJECTION_SETTINGS_KEY = STORAGE_KEYS.projectionSettings;

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
      tableColspan: 7,
    });
    document.getElementById('projCount').textContent = '0 serviços';
    return;
  }
  const ultimo = defaultDataFim();
  document.getElementById('projUltimoMes').textContent = formatMonthLabel(ultimo);
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

// Calcula o ritmo histórico (R$/mês) somando os últimos N meses ANTES da data de corte
function calcularRitmoHistorico(meses, dataCorte, janelaMeses) {
  const past = Object.entries(meses)
    .filter(([m, v]) => m < dataCorte && v > 0)
    .sort();
  if (!past.length) return 0;
  // Pega os últimos N meses CONSECUTIVOS antes do corte
  const cutoffStart = addMonths(dataCorte, -janelaMeses);
  const dentroJanela = past.filter(([m]) => m >= cutoffStart);
  if (!dentroJanela.length) return 0;
  const total = dentroJanela.reduce((s, [, v]) => s + v, 0);
  return total / janelaMeses;
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
    if (
      !insDest ||
      ['', '-', 'Não encontrado!'].includes(insDest) ||
      String(insDest).toUpperCase().includes('VERIFICAR') ||
      insDest === 'Aumento de obra'
    ) {
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
export function projetarServico(servico, meses, dataCorte, dataFim, janelaMeses) {
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

function calcStatus(diff, planejado, tolerancia) {
  if (Math.abs(diff) <= tolerancia) return 'green';
  if (diff > 0 && planejado > 0 && diff <= planejado * 0.05) return 'amber';
  if (diff > 0) return 'red';
  return 'sobra';
}

function syncProjectionChartLockUi() {
  const container = document.getElementById('projChart');
  if (!container) return;
  container.classList.toggle('projection-chart-is-locked', projectionChartLocked);
  const control = container.querySelector('.projection-chart-lock-toggle');
  const button = container.querySelector('.projection-chart-lock-button');
  const symbol = container.querySelector('.projection-chart-lock-symbol');
  const label = projectionChartLocked
    ? 'Desbloquear zoom e movimentação'
    : 'Bloquear zoom e movimentação';
  if (control) control.title = label;
  if (button) button.setAttribute('aria-label', label);
  if (symbol) symbol.textContent = projectionChartLocked ? '🔒' : '🔓';
}

function toggleProjectionChartLock(_chartContext) {
  const nextLocked = !projectionChartLocked;
  if (nextLocked) {
    document.querySelector('#projChart .apexcharts-zoom-icon')?.click();
  }
  projectionChartLocked = nextLocked;
  syncProjectionChartLockUi();
}

function renderProjecao() {
  // v0.58b: filtra APP_STATE.dados.projRaw pela obra ativa
  const PROJ_OBRA = getProjRawObraAtiva();
  if (!PROJ_OBRA.length) {
    initProjecao();
    return;
  }
  syncProjectionInputs();
  const dataCorte = document.getElementById('projDataCorte').value || defaultDataCorte();
  const dataFim = document.getElementById('projDataFim').value || defaultDataFim();
  const janelaMeses = parseInt(document.getElementById('projMetodo').value) || 6;
  const tolerancia = parseNumber(document.getElementById('projTolerancia').value) ?? 0;

  // Agregar por serviço e por insumo
  const porServico = {};
  const porInsumo = {}; // chave "servico|insumo"
  PROJ_OBRA.forEach((r) => {
    if (!porServico[r.servico]) porServico[r.servico] = {};
    porServico[r.servico][r.mes] = (porServico[r.servico][r.mes] || 0) + r.valor;
    const k = r.servico + '|' + r.insumo;
    if (!porInsumo[k]) porInsumo[k] = { servico: r.servico, insumo: r.insumo, meses: {} };
    porInsumo[k].meses[r.mes] = (porInsumo[k].meses[r.mes] || 0) + r.valor;
  });

  // Projetar cada serviço
  const projServicos = Object.entries(porServico).map(([s, meses]) =>
    projetarServico(s, meses, dataCorte, dataFim, janelaMeses),
  );

  // Projetar cada insumo (herda regra de extrapolação do serviço pai)
  const projInsumosIndividuais = Object.values(porInsumo)
    .map((item) => projetarServico(item.servico, item.meses, dataCorte, dataFim, janelaMeses))
    .map((proj, idx) => {
      const item = Object.values(porInsumo)[idx];
      return { ...proj, insumo: item.insumo };
    });
  const projInsumos = distributeServiceProjection(projServicos, projInsumosIndividuais);

  // KPIs gerais
  const totRealizado = projServicos.reduce((s, l) => s + l.realizado, 0);
  const totPlanejado = projServicos.reduce((s, l) => s + l.planejado_total, 0);
  const totExtrap = projServicos.reduce((s, l) => s + l.extrapolacao, 0);
  const saldoPlanejamento = totPlanejado - totRealizado;
  const pctSaldoPlanejamento = totPlanejado ? (saldoPlanejamento / totPlanejado) * 100 : 0;

  // Quebrar a "extrapolação" entre o que é obra estendida (só Indiretos) e flows pendentes (qualquer grupo)
  // totExtrap (calculado acima) = só extrapolação clássica (obra estendida em Indiretos)
  // Vamos calcular separadamente o impacto dos flows pendentes por grupo
  const flowsPendByGrupo = calcularFlowsPendentesPorGrupo();
  const flowsPendInd =
    (flowsPendByGrupo['Custos Indiretos'] || 0) + (flowsPendByGrupo['Projeção de Gastos'] || 0);
  const flowsPendDir =
    (flowsPendByGrupo['Custos Diretos / Infraestrutura'] || 0) +
    (flowsPendByGrupo['Obras Civis'] || 0) +
    (flowsPendByGrupo['Outros'] || 0);
  const totIndiretosTend = totExtrap + flowsPendInd;
  const totDiretosTend = flowsPendDir;
  const totImpactoTendencia = totIndiretosTend + totDiretosTend;
  const pctImpactoTendencia = totPlanejado ? (totImpactoTendencia / totPlanejado) * 100 : 0;
  const totTendencia = totPlanejado + totIndiretosTend + totDiretosTend;
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
  renderProjChartGeral(porServico, projServicos, dataCorte, dataFim);

  // Aderência Físico × Financeira (renderiza se o container existir na página)
  try {
    if (typeof renderAderenciaProj === 'function') renderAderenciaProj();
  } catch (e) {
    console.warn('aderencia:', e);
  }

  // Tabela hierárquica
  renderProjTable(projInsumos, tolerancia, flowsPendByGrupo);
}

function createProjectionCurveTooltip(categories, planData, tendData) {
  return ({ dataPointIndex }) => {
    if (dataPointIndex < 0) return '';
    const planejado = planData[dataPointIndex] || 0;
    const tendencia = tendData[dataPointIndex] || 0;
    const diferenca = tendencia - planejado;
    const diferencaTexto =
      Math.abs(diferenca) < 0.005 ? '0,00' : `${diferenca > 0 ? '+' : ''}${fmtR$(diferenca)}`;
    const diferencaClasse =
      diferenca > 0
        ? 'projection-curve-tooltip-value--increase'
        : diferenca < 0
          ? 'projection-curve-tooltip-value--reduction'
          : '';

    return `<div class="projection-chart-tooltip projection-curve-tooltip">
      <strong class="projection-curve-tooltip-title">${escHtml(categories[dataPointIndex])}</strong>
      <div class="projection-curve-tooltip-row">
        <span><i class="projection-curve-tooltip-mark projection-curve-tooltip-mark--plan"></i>Planejado acumulado</span>
        <strong>${fmtR$(planejado)}</strong>
      </div>
      <div class="projection-curve-tooltip-row">
        <span><i class="projection-curve-tooltip-mark projection-curve-tooltip-mark--trend"></i>Tendência projetada</span>
        <strong>${fmtR$(tendencia)}</strong>
      </div>
      <div class="projection-curve-tooltip-row projection-curve-tooltip-row--difference">
        <span>Δ Diferença</span>
        <strong class="${diferencaClasse}">${diferencaTexto}</strong>
      </div>
    </div>`;
  };
}

function projectionCategoryLabelFormatter(categories, compact = false) {
  const maxLabels = compact ? 10 : 24;
  const step = Math.max(1, Math.ceil(categories.length / maxLabels));
  return (value, _timestamp, options) => {
    const index = Number.isInteger(options?.i) ? options.i : categories.indexOf(value);
    return index % step === 0 || index === categories.length - 1 ? value : '';
  };
}

function renderProjChartGeral(porServico, projServicos, dataCorte, dataFim) {
  // Acumular planejado total mês a mês
  const totalMeses = {};
  Object.values(porServico).forEach((meses) => {
    Object.entries(meses).forEach(([m, v]) => {
      totalMeses[m] = (totalMeses[m] || 0) + v;
    });
  });
  const todosMeses = Object.keys(totalMeses)
    .filter((month) => !dataFim || month <= dataFim)
    .sort();
  if (!todosMeses.length) {
    document.getElementById('projChart').replaceChildren();
    return;
  }

  // Mantém um ponto para cada mês, inclusive quando não houve movimento.
  const ultimoMes = todosMeses[todosMeses.length - 1];
  const chartEnd = dataFim && dataFim > ultimoMes ? dataFim : ultimoMes;
  const extended = buildMonthRange(todosMeses[0], chartEnd);

  // Linha A: planejado acumulado
  let acumPlan = 0;
  const planAcumulado = extended.map((m) => {
    acumPlan += totalMeses[m] || 0;
    return { mes: m, valor: acumPlan };
  });

  // Linha B: tendência acumulada
  const extrapPorMes = {};
  projServicos.forEach((p) => {
    if (p.extrapolacao > 0 && p.ultimo_mes_planejado && p.meses_gap > 0) {
      const perMonth = p.extrapolacao / p.meses_gap;
      let m = p.ultimo_mes_planejado;
      for (let i = 0; i < p.meses_gap; i++) {
        m = addMonths(m, 1);
        extrapPorMes[m] = (extrapPorMes[m] || 0) + perMonth;
      }
    }
  });
  let acumTend = 0;
  const tendAcumulada = extended.map((m) => {
    acumTend += (totalMeses[m] || 0) + (extrapPorMes[m] || 0);
    return { mes: m, valor: acumTend };
  });

  const categories = extended.map((m) => formatMonthLabel(m));
  const planData = planAcumulado.map((p) => p.valor);
  const tendData = tendAcumulada.map((p) => p.valor);

  // Posição do corte e do fim para annotations
  const findIdx = (m) => {
    let bestIdx = 0;
    for (let i = 0; i < extended.length; i++) {
      if (extended[i] <= m) bestIdx = i;
      else break;
    }
    return bestIdx;
  };
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
        formatter: projectionCategoryLabelFormatter(categories),
        style: { fontSize: '10px' },
      },
    },
    yaxis: {
      labels: { formatter: (val) => fmtR$k(val), style: { fontSize: '10px' } },
    },
    annotations: {
      xaxis: [
        {
          x: categories[corteIdx],
          borderColor: resolveColor('var(--fgr-red-vivid)'),
          strokeDashArray: 4,
          label: {
            text: 'Corte: ' + formatMonthLabel(dataCorte),
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
      custom: createProjectionCurveTooltip(categories, planData, tendData),
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
      size: [4, 4],
      strokeWidth: 2,
      strokeColors: resolveColor('var(--text-on-dark)'),
      hover: { sizeOffset: 3 },
    },
    responsive: [
      { breakpoint: 600, options: { chart: { height: 300 }, legend: { position: 'bottom' } } },
    ],
  };

  renderApexChart('projChart', options);
}

let projSortKey = null;
let projSortDir = 1;
const projExpanded = new Set(); // chaves de grupos/serviços expandidos

// Conta flows que apontam para um insumo (destino ou origem), ignorando cancelados
function flowsPorInsumo(insumo) {
  if (!insumo) return null;
  // Só mostrar flows REFLETIDOS (status === 'sim')
  const refletidos = (f) => (f.refletido_status || 'pendente') === 'sim';
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

function renderProjTable(projInsumos, tolerancia, flowsPendByGrupo = {}) {
  const q = document.getElementById('projSearch').value.toLowerCase();
  const fs = document.getElementById('projFilterStatus').value;
  const fg = document.getElementById('projFilterGrupo').value;

  const statusBadge = {
    red: '<span class="badge red">🔴 Vai estourar</span>',
    amber: '<span class="badge amber">🟡 Atenção</span>',
    green: '<span class="badge green">🟢 No esperado</span>',
    sobra: '<span class="badge green">💰 Vai sobrar</span>',
    done: '<span class="badge gray">✅ Concluído</span>',
    empty: '<span class="badge gray">— sem valor</span>',
  };

  // Indexar projeções por insumo para lookup rápido.
  const idxIns = {};
  projInsumos.forEach((p) => {
    idxIns[p.servico + '|' + p.insumo] = p;
  });

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
  const nodes = HIERARQUIA.map((n) => ({ ...n, children: [], parent: null }));
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
    while (stack.length && depthOf(stack[stack.length - 1]) >= d) stack.pop();
    if (stack.length) {
      n.parent = stack[stack.length - 1].ordem;
      stack[stack.length - 1].children.push(i);
    }
    stack.push(n);
  });

  const flowGroupParents = {
    'Custos Indiretos': nodes.findIndex((node) => node.cod === '01.01'),
    'Custos Diretos / Infraestrutura': nodes.findIndex((node) => node.cod === '01.02'),
    'Obras Civis': nodes.findIndex((node) => node.cod === '01.03'),
    'Projeção de Gastos': nodes.findIndex((node) => node.cod === '01.04'),
  };
  const rootIndex = nodes.findIndex((node) => node.tipo === 'raiz');
  const catalogProjectionKeys = new Set(
    nodes
      .filter((node) => node.tipo === 'insumo')
      .map((node) => `${node.cod_servico}|${node.cod_insumo}`),
  );
  projInsumos
    .filter(
      (projection) => !catalogProjectionKeys.has(`${projection.servico}|${projection.insumo}`),
    )
    .forEach((projection) => {
      const parentIndex = flowGroupParents[projection.grupo] ?? rootIndex;
      const index = nodes.length;
      nodes.push({
        ordem: index,
        cod: '',
        cod_servico: projection.servico,
        cod_insumo: projection.insumo,
        item: descInsumo(projection.insumo),
        nivel: 4,
        tipo: 'insumo',
        children: [],
        parent: parentIndex,
        isProjectionFallback: true,
        proj: projection,
      });
      if (parentIndex >= 0) nodes[parentIndex].children.push(index);
    });
  Object.entries(flowsPendByGrupo).forEach(([group, value]) => {
    if (Math.abs(value || 0) < 0.01) return;
    const parentIndex = flowGroupParents[group] ?? rootIndex;
    const index = nodes.length;
    nodes.push({
      ordem: index,
      cod: '',
      cod_servico: '',
      cod_insumo: '',
      item: `Flows pendentes · ${group}`,
      nivel: 3,
      tipo: 'outro',
      children: [],
      parent: parentIndex,
      flowGroup: group,
      isPendingFlow: true,
      proj: {
        realizado: 0,
        planejado_total: 0,
        planejado_futuro: 0,
        extrapolacao: value,
        tendencia: value,
        diff: value,
        flows_pendentes: value,
        empty: false,
      },
    });
    if (parentIndex >= 0) nodes[parentIndex].children.push(index);
  });

  // Calcular projeção de cada nó:
  // - Insumo: lookup direto em idxIns
  // - Outros (containers): soma dos descendentes folha (insumos)
  const assignedProjectionKeys = new Set();
  function getInsumoProj(node) {
    // Para o nó insumo: precisamos identificar qual serviço-pai contém esse insumo
    // O serviço-pai é o ancestral com cod_servico preenchido, ou o próprio cod do nó (servico header)
    let cur = node.parent;
    while (cur != null) {
      const p = nodes[cur];
      if (p.cod_servico) {
        const key = p.cod_servico + '|' + node.cod_insumo;
        if (idxIns[key] && !assignedProjectionKeys.has(key)) {
          assignedProjectionKeys.add(key);
          return idxIns[key];
        }
        break;
      }
      cur = p.parent;
    }
    return null;
  }

  // Computar agregados (pós-ordem)
  function compute(idx) {
    const n = nodes[idx];
    if (n.isPendingFlow) return n.proj;
    if (n.isProjectionFallback) return n.proj;
    if (n.tipo === 'insumo') {
      const p = getInsumoProj(n);
      const baseProj = p || {
        realizado: 0,
        planejado_total: 0,
        planejado_futuro: 0,
        extrapolacao: 0,
        tendencia: 0,
        diff: 0,
        meses_gap: 0,
        ritmo_historico: 0,
        ultimo_mes_planejado: null,
        grupo: grupoDoServico(getServicoCod(idx)),
        empty: true,
      };
      n.proj = baseProj;
      n.proj.empty =
        n.proj.planejado_total === 0 &&
        n.proj.realizado === 0 &&
        Math.abs(n.proj.extrapolacao || 0) < 0.01;
      return n.proj;
    }
    // Container: soma filhos
    const agg = {
      realizado: 0,
      planejado_total: 0,
      planejado_futuro: 0,
      extrapolacao: 0,
      tendencia: 0,
      diff: 0,
      empty: true,
    };
    n.children.forEach((ci) => {
      const sub = compute(ci);
      agg.realizado += sub.realizado || 0;
      agg.planejado_total += sub.planejado_total || 0;
      agg.planejado_futuro += sub.planejado_futuro || 0;
      agg.extrapolacao += sub.extrapolacao || 0;
      agg.tendencia += sub.tendencia || 0;
      agg.diff += sub.diff || 0;
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
  nodes.forEach((n, i) => {
    if (n.parent === null) compute(i);
  });

  // Determinar visibilidade pelos filtros (q, fs, fg)
  // Um nó é visível se:
  //  - Passar nos filtros próprios OU
  //  - Tiver descendente que passa (para containers)
  function matchesNode(n) {
    // Texto
    if (q) {
      const txt = (
        n.cod +
        ' ' +
        n.item +
        ' ' +
        (n.cod_insumo || '') +
        ' ' +
        (n.cod_servico || '')
      ).toLowerCase();
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
    const selfMatch = matchesNode(n);
    let anyChild = false;
    n.children.forEach((ci) => {
      if (checkVisible(ci)) anyChild = true;
    });
    if (selfMatch || anyChild) {
      visible.add(idx);
      return true;
    }
    return false;
  }
  nodes.forEach((n, i) => {
    if (n.parent === null) checkVisible(i);
  });

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
        leftValue = left.proj?.tendencia || 0;
        rightValue = right.proj?.tendencia || 0;
      } else if (projSortKey === 'saldo') {
        leftValue = (left.proj?.planejado_total || 0) - (left.proj?.realizado || 0);
        rightValue = (right.proj?.planejado_total || 0) - (right.proj?.realizado || 0);
      } else {
        leftValue = left.proj?.[projSortKey] ?? 0;
        rightValue = right.proj?.[projSortKey] ?? 0;
      }
      if (typeof leftValue === 'string')
        return projSortDir * leftValue.localeCompare(rightValue, 'pt-BR');
      return projSortDir * (leftValue - rightValue);
    });
  }

  function renderNode(idx, level) {
    const n = nodes[idx];
    if (!visible.has(idx)) return;
    const p = n.proj || {};
    const key = nodeKey(idx);
    const hasChildren = n.children.filter((ci) => visible.has(ci)).length > 0;
    const expanded = projExpanded.has(key);
    const st = nodeStatus(n);
    const depth = Math.min(level, 6);
    const ex = p.extrapolacao || 0;
    const rowClasses = ['projection-tree-row', `projection-tree-row--${n.tipo}`];
    if (n.tipo === 'insumo' && p.empty) rowClasses.push('is-empty');
    let icon = '',
      labelHtml = '';
    if (n.isPendingFlow) {
      icon = '📎';
      labelHtml = escHtml(n.item);
    } else if (n.tipo === 'raiz') {
      icon = expanded ? '▼' : '▶';
      labelHtml = `<strong>${escHtml(n.cod)} · ${escHtml(n.item)}</strong>`;
    } else if (n.tipo === 'grupo') {
      icon = expanded ? '▼' : '▶';
      labelHtml = `<strong>${escHtml(n.cod)} · ${escHtml(n.item)}</strong>`;
    } else if (n.tipo === 'subgrupo') {
      icon = expanded ? '▼' : '▶';
      labelHtml = `${escHtml(n.cod)} · ${escHtml(n.item)}`;
    } else if (n.tipo === 'servico' || n.tipo === 'outro') {
      icon = expanded ? '▼' : hasChildren ? '▶' : '🔍';
      const codeMark = n.cod_servico ? `<strong>${escHtml(n.cod_servico)}</strong> · ` : '';
      const chip = n.cod_servico ? flowChip(flowsPorServico(n.cod_servico)) : '';
      labelHtml = `${codeMark}${escHtml(n.item)}${chip}`;
    } else if (n.tipo === 'insumo') {
      icon = '🔍';
      const chip = flowChip(flowsPorInsumo(n.cod_insumo));
      labelHtml = `<span class="projection-input-code">${escHtml(n.cod_insumo)}</span> · ${escHtml(n.item)}${chip}`;
    }

    // Cores adaptadas ao fundo
    const isDark = n.tipo === 'raiz' || n.tipo === 'grupo';
    const flowsPendVal = p.flows_pendentes || 0;
    let extrapTitle = '';
    if (n.tipo === 'insumo' || n.tipo === 'servico' || n.tipo === 'outro') {
      const parts = [];
      if (p.ultimo_mes_planejado && p.meses_gap > 0) {
        parts.push(
          `Obra estendida: planejamento original termina em ${formatMonthLabel(p.ultimo_mes_planejado)}, extrapolando ${p.meses_gap} meses`,
        );
      }
      if (Math.abs(flowsPendVal) > 0.01) {
        parts.push(
          `Flows pendentes (ainda não refletidos): ${flowsPendVal >= 0 ? '+' : ''}${fmt(flowsPendVal)}`,
        );
      }
      extrapTitle = parts.join(' · ') || 'Sem extrapolação';
    }
    const extrapTxt =
      Math.abs(ex) > 0.01
        ? n.tipo === 'insumo' || n.tipo === 'servico' || n.tipo === 'outro'
          ? `<span class="projection-extrapolation projection-extrapolation--detail projection-extrapolation--${ex < 0 ? 'reduction' : 'increase'}" title="${escAttr(extrapTitle)}">${ex >= 0 ? '+' : ''}${fmt(ex)}${Math.abs(flowsPendVal) > 0.01 ? ' 📎' : ''}</span>`
          : `<span class="projection-extrapolation projection-extrapolation--${isDark ? 'dark' : ex < 0 ? 'reduction' : 'increase'}">${ex >= 0 ? '+' : ''}${fmt(ex)}</span>`
        : `<span class="projection-extrapolation projection-extrapolation--${isDark ? 'empty-dark' : 'empty'}">—</span>`;

    const valuesEmpty = p.empty || n.isPendingFlow;
    const fmtVal = (v) =>
      valuesEmpty ? '<span class="projection-empty-value">—</span>' : fmtR$(v || 0);

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

    const valorPlanejado = p.planejado_total || 0;
    const tendencia = p.tendencia ?? valorPlanejado + (p.extrapolacao || 0);
    const saldo = valorPlanejado - (p.realizado || 0);
    const planejadoEmpty = valuesEmpty && valorPlanejado === 0;

    html += `<tr class="${rowClasses.join(' ')}" ${actionAttrs}>
      <td class="projection-tree-icon projection-tree-depth-${depth}">${icon}</td>
      <td class="projection-tree-label projection-tree-depth-${depth}">${labelHtml}</td>
      <td class="num">${planejadoEmpty ? '<span class="projection-empty-value">—</span>' : fmtR$(valorPlanejado)}</td>
      <td class="num">${fmtVal(p.realizado)}</td>
      <td class="num">${planejadoEmpty ? '<span class="projection-empty-value">—</span>' : fmtR$(saldo)}</td>
      <td class="num">${extrapTxt}</td>
      <td class="num">${planejadoEmpty && Math.abs(p.extrapolacao || 0) < 0.01 ? '<span class="projection-empty-value">—</span>' : '<strong>' + fmtR$(tendencia) + '</strong>'}</td>
      <td>${statusBadge[st] || ''}</td>
    </tr>`;
    count++;

    if (expanded) {
      sortedNodeIndexes(n.children).forEach((ci) => {
        const nextLevel = level + 1;
        renderNode(ci, nextLevel);
      });
    }
  }

  // Render todos os roots
  sortedNodeIndexes(
    nodes.map((n, i) => (n.parent === null ? i : null)).filter((i) => i != null),
  ).forEach((i) => renderNode(i, 0));

  replaceWithParsedMarkup(document.getElementById('projTbody'), html);
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

function toggleProjExpand(key) {
  if (projExpanded.has(key)) projExpanded.delete(key);
  else projExpanded.add(key);
  renderProjecao();
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
  renderProjecao();
}

function projCollapseAll() {
  projExpanded.clear();
  renderProjecao();
}

// Exporta a Projeção Detalhada COMPLETA (hierarquia toda expandida, sem filtros) em Excel
async function exportarProjecaoDetalhada() {
  try {
    const _proj =
      typeof getProjRawObraAtiva === 'function' ? getProjRawObraAtiva() : APP_STATE.dados.projRaw;
    if (!_proj || !_proj.length) {
      authToast(
        '⚠️ Não há dados de Projeção para exportar. Carregue o CSV de Gestões primeiro.',
        'warn',
        5000,
      );
      return;
    }
    const XLSX = await ensureXlsx();
    const dataCorte = document.getElementById('projDataCorte').value || defaultDataCorte();
    const dataFim = document.getElementById('projDataFim').value || defaultDataFim();
    const janelaMeses = parseInt(document.getElementById('projMetodo').value) || 6;
    const tolerancia = parseNumber(document.getElementById('projTolerancia').value) ?? 50000;

    // Re-executa o pipeline pra pegar projServicos e projInsumos SEM depender do render (não muda estado)
    // Reagrupa APP_STATE.dados.projRaw por (servico, insumo, mes)
    const byServMes = {};
    const byServInsMes = {};
    _proj.forEach((r) => {
      byServMes[r.servico] = byServMes[r.servico] || {};
      byServMes[r.servico][r.mes] = (byServMes[r.servico][r.mes] || 0) + r.valor;
      const k = r.servico + '|' + r.insumo;
      byServInsMes[k] = byServInsMes[k] || { servico: r.servico, insumo: r.insumo, meses: {} };
      byServInsMes[k].meses[r.mes] = (byServInsMes[k].meses[r.mes] || 0) + r.valor;
    });
    const projServicos = Object.entries(byServMes).map(([servico, meses]) =>
      projetarServico(servico, meses, dataCorte, dataFim, janelaMeses),
    );
    const projInsumosIndividuais = Object.values(byServInsMes).map((x) => {
      const p = projetarServico(x.servico, x.meses, dataCorte, dataFim, janelaMeses);
      return { ...p, insumo: x.insumo };
    });
    const projInsumos = distributeServiceProjection(projServicos, projInsumosIndividuais);
    const idxIns = {};
    projInsumos.forEach((p) => (idxIns[p.servico + '|' + p.insumo] = p));

    // Percorrer HIERARQUIA e montar linhas
    const nodes = HIERARQUIA.map((n) => ({ ...n, children: [], parent: null }));
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
      while (stack.length && depthOf(stack[stack.length - 1]) >= d) stack.pop();
      if (stack.length) {
        n.parent = stack[stack.length - 1].ordem;
        stack[stack.length - 1].children.push(n.ordem);
      }
      stack.push(n);
    });
    const flowGroupParents = {
      'Custos Indiretos': nodes.findIndex((node) => node.cod === '01.01'),
      'Custos Diretos / Infraestrutura': nodes.findIndex((node) => node.cod === '01.02'),
      'Obras Civis': nodes.findIndex((node) => node.cod === '01.03'),
      'Projeção de Gastos': nodes.findIndex((node) => node.cod === '01.04'),
    };
    const rootIndex = nodes.findIndex((node) => node.tipo === 'raiz');
    const catalogProjectionKeys = new Set(
      nodes
        .filter((node) => node.tipo === 'insumo')
        .map((node) => `${node.cod_servico}|${node.cod_insumo}`),
    );
    projInsumos
      .filter(
        (projection) => !catalogProjectionKeys.has(`${projection.servico}|${projection.insumo}`),
      )
      .forEach((projection) => {
        const parentIndex = flowGroupParents[projection.grupo] ?? rootIndex;
        const index = nodes.length;
        nodes.push({
          ordem: index,
          cod: '',
          cod_servico: projection.servico,
          cod_insumo: projection.insumo,
          item: descInsumo(projection.insumo),
          nivel: 4,
          tipo: 'insumo',
          children: [],
          parent: parentIndex,
          isProjectionFallback: true,
          proj: projection,
        });
        if (parentIndex >= 0) nodes[parentIndex].children.push(index);
      });
    const flowsPendByGrupo = calcularFlowsPendentesPorGrupo();
    Object.entries(flowsPendByGrupo).forEach(([group, value]) => {
      if (Math.abs(value || 0) < 0.01) return;
      const parentIndex = flowGroupParents[group] ?? rootIndex;
      const index = nodes.length;
      nodes.push({
        ordem: index,
        cod: '',
        cod_servico: '',
        cod_insumo: '',
        item: `Flows pendentes · ${group}`,
        nivel: 3,
        tipo: 'outro',
        children: [],
        parent: parentIndex,
        flowGroup: group,
        isPendingFlow: true,
        proj: {
          realizado: 0,
          planejado_total: 0,
          planejado_futuro: 0,
          extrapolacao: value,
          tendencia: value,
          diff: value,
          flows_pendentes: value,
          empty: false,
        },
      });
      if (parentIndex >= 0) nodes[parentIndex].children.push(index);
    });
    const assignedProjectionKeys = new Set();
    function computeNode(idx) {
      const n = nodes[idx];
      if (n.isPendingFlow || n.isProjectionFallback) return n.proj;
      if (n.tipo === 'insumo') {
        // Buscar serviço pai
        let cur = n.parent,
          servCod = '';
        while (cur != null) {
          const pn = nodes[cur];
          if (pn.cod_servico) {
            servCod = pn.cod_servico;
            break;
          }
          cur = pn.parent;
        }
        const projectionKey = servCod + '|' + n.cod_insumo;
        const projection =
          idxIns[projectionKey] && !assignedProjectionKeys.has(projectionKey)
            ? idxIns[projectionKey]
            : null;
        if (projection) assignedProjectionKeys.add(projectionKey);
        const proj = projection || {
          realizado: 0,
          planejado_total: 0,
          planejado_futuro: 0,
          extrapolacao: 0,
          tendencia: 0,
          diff: 0,
          ritmo_historico: 0,
          ultimo_mes_planejado: null,
          meses_gap: 0,
          grupo: grupoDoServico(servCod),
        };
        n.proj = proj;
        n.proj.empty =
          n.proj.planejado_total === 0 &&
          n.proj.realizado === 0 &&
          Math.abs(n.proj.extrapolacao || 0) < 0.01;
        return n.proj;
      }
      const agg = {
        realizado: 0,
        planejado_total: 0,
        planejado_futuro: 0,
        extrapolacao: 0,
        tendencia: 0,
        diff: 0,
        flows_pendentes: 0,
        empty: true,
      };
      n.children.forEach((ci) => {
        const sub = computeNode(ci);
        agg.realizado += sub.realizado || 0;
        agg.planejado_total += sub.planejado_total || 0;
        agg.planejado_futuro += sub.planejado_futuro || 0;
        agg.extrapolacao += sub.extrapolacao || 0;
        agg.tendencia += sub.tendencia || 0;
        agg.flows_pendentes += sub.flows_pendentes || 0;
        if (!sub.empty) agg.empty = false;
      });
      n.proj = agg;
      return agg;
    }
    nodes.forEach((n) => {
      if (n.parent === null) computeNode(n.ordem);
    });

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
      return (
        { red: 'Vai estourar', amber: 'Atenção', green: 'No esperado', sobra: 'Vai sobrar' }[st] ||
        st
      );
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
      const tendUI = p.tendencia ?? (p.planejado_total || 0) + (p.extrapolacao || 0);
      const saldo = (p.planejado_total || 0) - (p.realizado || 0);
      linhas.push({
        Nível: nivel,
        Tipo: n.tipo,
        Código: n.cod || '',
        'Cod. Serviço': n.cod_servico || '',
        'Cod. Insumo': n.cod_insumo || '',
        Grupo: grupo,
        Descrição: prefixo + label,
        'Valor Planejado (R$)': Math.round((p.planejado_total || 0) * 100) / 100,
        'Realizado (R$)': Math.round((p.realizado || 0) * 100) / 100,
        'Saldo (R$)': Math.round(saldo * 100) / 100,
        'Planejado Total (R$)': Math.round((p.planejado_total || 0) * 100) / 100,
        'Planejado Futuro (R$)': Math.round((p.planejado_futuro || 0) * 100) / 100,
        'Extrapolação (R$)': Math.round((p.extrapolacao || 0) * 100) / 100,
        'Flows Pendentes (R$)': Math.round((p.flows_pendentes || 0) * 100) / 100,
        'Tendência (R$)': Math.round(tendUI * 100) / 100,
        'Δ vs Planejado (R$)': Math.round((p.diff || 0) * 100) / 100,
        'Ritmo Histórico (R$/mês)': Math.round((p.ritmo_historico || 0) * 100) / 100,
        'Último Mês Planejado': p.ultimo_mes_planejado || '',
        'Meses Gap': p.meses_gap || 0,
        Status: statusLabel(n),
      });
      n.children.forEach((ci) => walk(ci));
    }
    nodes.forEach((n) => {
      if (n.parent === null) walk(n.ordem);
    });

    // Aba de metadados
    const meta = [
      { Campo: 'Obra', Valor: APP_STATE.obra.ativa || '' },
      { Campo: 'Fonte do valor planejado', Valor: 'Gestão Atual' },
      { Campo: 'Data de corte', Valor: dataCorte },
      { Campo: 'Data fim', Valor: dataFim },
      { Campo: 'Janela ritmo histórico (meses)', Valor: janelaMeses },
      { Campo: 'Tolerância (R$)', Valor: tolerancia },
      { Campo: 'Exportado em', Valor: new Date().toLocaleString('pt-BR') },
    ];

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(linhas);
    // Ajustar largura das colunas
    ws1['!cols'] = [
      { wch: 6 },
      { wch: 10 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 28 },
      { wch: 60 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 18 },
      { wch: 18 },
      { wch: 16 },
      { wch: 18 },
      { wch: 16 },
      { wch: 18 },
      { wch: 20 },
      { wch: 18 },
      { wch: 10 },
      { wch: 16 },
    ];
    // aplicar format code Excel nas colunas numéricas monetárias
    // Colunas H..Q (índices 7..16) = Valor Planejado, Realizado, Saldo, Planejado Total,
    //   Planejado Futuro, Extrapolação, Flows Pendentes, Tendência, Δ vs Planejado, Ritmo Histórico
    const FMT_NUM = '#,##0.00;-#,##0.00;"-"'; // SheetJS interpreta e converte pro locale do Excel do usuário
    const range1 = XLSX.utils.decode_range(ws1['!ref']);
    for (let R = range1.s.r + 1; R <= range1.e.r; R++) {
      // pula header
      for (let C = 7; C <= 16; C++) {
        const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = ws1[cellRef];
        if (cell && typeof cell.v === 'number') {
          cell.t = 'n';
          cell.z = FMT_NUM;
        }
      }
    }
    XLSX.utils.book_append_sheet(wb, ws1, 'Projeção Detalhada');
    const ws2 = XLSX.utils.json_to_sheet(meta);
    ws2['!cols'] = [{ wch: 32 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Metadados');

    const nomeArq = `projecao-detalhada_${APP_STATE.obra.ativa || 'obra'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
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

  const projServico = projetarServico(servico, mesesServico, dataCorte, dataFim, janelaMeses);
  const projInsumos = distributeServiceProjection(
    [projServico],
    [...mesesPorInsumo].map(([inputCode, inputMonths]) => ({
      ...projetarServico(servico, inputMonths, dataCorte, dataFim, janelaMeses),
      insumo: inputCode,
    })),
  );

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

  // Construir dados para ApexCharts
  const todosMeses = Object.keys(meses)
    .filter((month) => !dataFim || month <= dataFim)
    .sort();
  const ultimoMes = todosMeses[todosMeses.length - 1] || dataFim;
  const chartEnd = dataFim && dataFim > ultimoMes ? dataFim : ultimoMes;
  const extended = todosMeses.length ? buildMonthRange(todosMeses[0], chartEnd) : [];

  let acumP = 0,
    acumT = 0;
  const extrapPorMes = {};
  if (proj.extrapolacao > 0 && proj.ultimo_mes_planejado && proj.meses_gap > 0) {
    const perMonth = proj.extrapolacao / proj.meses_gap;
    let m = proj.ultimo_mes_planejado;
    for (let i = 0; i < proj.meses_gap; i++) {
      m = addMonths(m, 1);
      extrapPorMes[m] = perMonth;
    }
  }
  const planAcum = extended.map((m) => {
    acumP += meses[m] || 0;
    return { mes: m, valor: acumP };
  });
  const tendAcum = extended.map((m) => {
    acumT += (meses[m] || 0) + (extrapPorMes[m] || 0);
    return { mes: m, valor: acumT };
  });

  const categories = extended.map((m) => formatMonthLabel(m));
  const planData = planAcum.map((p) => p.valor);
  const tendData = tendAcum.map((p) => p.valor);
  const saldoPlanejado = proj.planejado_total - proj.realizado;
  const extrapolacaoTexto =
    Math.abs(proj.extrapolacao) < 0.005
      ? '—'
      : `${proj.extrapolacao > 0 ? '+' : ''}${fmtR$(proj.extrapolacao)}`;

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
      <div class="kpi kpi-wide projection-modal-card ${proj.diff > 0 ? 'red' : proj.diff < 0 ? 'green' : ''}">
        <h3 class="projection-modal-card-title">🔮 Extrapolação</h3>
        <div class="projection-modal-metric">
          <div class="projection-modal-metric-label">Saldo</div>
          <strong class="projection-modal-metric-value">${fmtR$(saldoPlanejado)}</strong>
        </div>
        <div class="projection-modal-metric">
          <div class="projection-modal-metric-label">Extrapolação</div>
          <div class="projection-modal-extrapolation-line">
            <strong class="projection-modal-metric-value">${extrapolacaoTexto}</strong>
            <span class="projection-modal-calculation">- ${proj.meses_gap > 0 ? `${proj.meses_gap} meses × R$ ${fmt(proj.ritmo_historico, 0)}/m` : 'Sem meses adicionais'}</span>
          </div>
        </div>
        <hr class="border-top-soft projection-modal-divider">
        <div class="projection-modal-metric projection-modal-metric--total">
          <div class="projection-modal-metric-label">Tendência Final</div>
          <strong class="projection-modal-metric-value">${fmtR$(proj.tendencia)}</strong>
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
      { name: 'Planejado acumulado', type: 'area', data: planData },
      { name: 'Tendência projetada', type: 'line', data: tendData },
    ],
    chart: {
      height: 300,
      animations: { enabled: true, easing: 'easeinout', speed: 600 },
      toolbar: { show: false },
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
      size: [4, 4],
      strokeWidth: 2,
      strokeColors: resolveColor('var(--text-on-dark)'),
      hover: { sizeOffset: 3 },
    },
  };

  // Renderizar após o conteúdo do modal estar no DOM
  setTimeout(() => renderApexChart('modalProjChart', modalChartOptions), 50);
  openModal();
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
  // Pega flows REFLETIDOS (status === 'sim') E PENDENTES (status === 'pendente') que apontam para este servico/insumo
  const statusOf = (f) => f.refletido_status || 'pendente';
  const isRefl = (f) => statusOf(f) === 'sim';
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
  const api = {
    defaultDataCorte,
    defaultDataFim,
    initProjecao,
    calcularFlowsPendentesPorGrupo,
    projetarServico,
    renderProjecao,
    toggleProjExpand,
    openProjDrill,
    projExpandAll,
    projCollapseAll,
    exportarProjecaoDetalhada,
  };

  document.getElementById('projTbody')?.addEventListener('click', activateProjectionRow);
  document.getElementById('projTbody')?.addEventListener('keydown', activateProjectionRow);

  const sharedParameterIds = new Set([
    'projDataFim',
    'projDataCorte',
    'projMetodo',
    'projTolerancia',
  ]);
  [...sharedParameterIds, 'projSearch', 'projFilterStatus', 'projFilterGrupo'].forEach((id) => {
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
      if (!sharedParameterIds.has(id)) return;
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

  bindSortableHeaders(
    'th[data-sort-proj]',
    'data-sort-proj',
    () => ({ key: projSortKey, direction: projSortDir }),
    (key) => {
      if (projSortKey === key) projSortDir = -projSortDir;
      else {
        projSortKey = key;
        projSortDir = key === 'label' ? 1 : -1;
      }
      updateSortHeaderState('th[data-sort-proj]', 'data-sort-proj', projSortKey, projSortDir);
      renderProjecao();
    },
  );
  return Object.freeze(api);
}
