export const LICENSE_LABEL = 'Orç. Licitação';

function escapeText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function debounce(callback, wait, timers = globalThis) {
  let timeout;
  return function debounced(...args) {
    timers.clearTimeout(timeout);
    timeout = timers.setTimeout(() => callback.apply(this, args), wait);
  };
}

export function formatNumber(value, decimals = 2) {
  if (value == null) return '-';
  const absolute = Math.abs(value);
  const threshold = decimals > 0 ? 10 ** -decimals / 2 : 0.5;
  if (absolute < threshold) return '-';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatCompactNumber(value) {
  if (value == null || Math.abs(value) < 0.5) return '-';
  if (Math.abs(value) >= 1e6) {
    return `${(value / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M`;
  }
  if (Math.abs(value) >= 1e3) {
    return `${(value / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k`;
  }
  return formatNumber(value, 0);
}

export function formatPercentage(value) {
  return value == null ? '-' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

export function tendencyStatus(license, management) {
  if (!license || management == null) return null;
  const difference = (management - license) / license;
  if (difference <= 0) return 'green';
  if (difference <= 0.1) return 'amber';
  return 'red';
}

export function createDashboardRuntime({
  state,
  config,
  syncStatus,
  performanceMonitor,
  ensureApexCharts,
  documentRef = document,
  windowRef = window,
  logger,
  toast = () => {},
  populateFilters = () => {},
  renderSourcesHeaders = () => {},
  renderers = {},
}) {
  const charts = new Map();
  const chartVersions = new Map();
  let renderTimeout = null;

  function reportNonFatalError(context, error, userMessage) {
    logger?.warn(context, error);
    if (userMessage) toast(userMessage, 'warn', config.toast_duration_warn);
  }

  async function runAsyncSafely(operation, context, userMessage) {
    syncStatus.begin();
    try {
      const result = await operation;
      syncStatus.finish();
      return result;
    } catch (error) {
      syncStatus.finish(error);
      reportNonFatalError(context, error, userMessage);
      return null;
    }
  }

  function createKpi({ titulo, valor, subtitulo, cor, icon }) {
    const className = cor ? `kpi ${cor}` : 'kpi';
    const iconPrefix = icon ? `${icon} ` : '';
    const subtitle = subtitulo ? `<div class="sub">${escapeText(subtitulo)}</div>` : '';
    return `<div class="${className}"><div class="label">${iconPrefix}${escapeText(titulo)}</div><div class="value">${escapeText(valor)}</div>${subtitle}</div>`;
  }

  function resolveColor(value) {
    if (!value || !value.startsWith('var(')) return value;
    const variable = value.slice(4, -1).trim();
    const root = documentRef.body || documentRef.documentElement;
    return windowRef.getComputedStyle(root).getPropertyValue(variable).trim() || value;
  }

  async function renderApexChart(containerId, options) {
    const version = (chartVersions.get(containerId) || 0) + 1;
    chartVersions.set(containerId, version);
    const previous = charts.get(containerId);
    if (previous) {
      try {
        previous.destroy();
      } catch (error) {
        reportNonFatalError('ApexCharts/destruir', error);
      }
      charts.delete(containerId);
    }

    const container = documentRef.getElementById(containerId);
    if (!container) return null;
    container.replaceChildren();
    try {
      const ApexCharts = await ensureApexCharts();
      if (chartVersions.get(containerId) !== version || !container.isConnected) return null;
      const chart = new ApexCharts(container, options);
      await chart.render();
      charts.set(containerId, chart);
      return chart;
    } catch (error) {
      reportNonFatalError(`ApexCharts/renderizar/${containerId}`, error);
      return null;
    }
  }

  function filterByActiveProject(rows, field = 'codigo_obra') {
    if (!Array.isArray(rows) || !state.obra.ativa) return rows;
    return rows.filter((row) => row[field] === state.obra.ativa);
  }

  function getActiveHistory() {
    const history = state.dados.historico;
    if (!history?.items) return { items: [], gestoes: [], totals: {} };
    if (!state.obra.ativa) return history;
    return {
      items: filterByActiveProject(history.items),
      gestoes: history.gestoes || [],
      totals: history.totals?.[state.obra.ativa] || {},
    };
  }

  const getActiveProjection = () => filterByActiveProject(state.dados.projRaw);
  const getActiveFlows = () => filterByActiveProject(state.dados.flows);

  function buildLinks() {
    const destination = {};
    const origin = {};
    for (const flow of getActiveFlows()) {
      if (flow.dep === 'Cancelado') continue;
      const planningInput = flow.insumo_planejamento;
      const reallocationInput = flow.insumo_remanejamento;
      if (
        planningInput &&
        !['-', 'Não encontrado!'].includes(planningInput) &&
        !planningInput.includes('VERIFICAR')
      ) {
        (destination[planningInput] ||= []).push(flow);
      }
      if (
        reallocationInput &&
        !['-', 'Não encontrado!'].includes(reallocationInput) &&
        !reallocationInput.includes('VERIFICAR')
      ) {
        (origin[reallocationInput] ||= []).push(flow);
      }
    }
    state.links.destino = destination;
    state.links.origem = origin;

    for (const item of state.dados.tendencia) {
      if (!item.is_folha) {
        item.aditivo_total = 0;
        item.flows_destino = [];
        item.flows_origem = [];
        continue;
      }
      const incoming = destination[item.cod_insumo] || [];
      const outgoing = origin[item.cod_insumo] || [];
      item.flows_destino = incoming;
      item.flows_origem = outgoing;
      item.aditivo_total =
        incoming.reduce((sum, flow) => sum + (flow.custo_flowmaster || 0), 0) -
        outgoing.reduce((sum, flow) => sum + (flow.custo_flowmaster || 0), 0);
    }
  }

  function renderTab(tabName) {
    const startedAt = windowRef.performance.now();
    try {
      if (tabName === 'visao') renderers.overview?.();
      else if (tabName === 'flows') renderers.flows?.();
      else if (tabName === 'detalhe') renderers.details?.();
      else if (tabName === 'historico') renderers.history?.();
      else if (tabName === 'projecao') {
        if (state.dados.projRaw.length) renderers.projection?.();
        else renderers.initializeProjection?.();
      } else if (tabName === 'projecao_ctrl') renderers.projectionControl?.();
      else if (tabName === 'uploads') {
        renderers.uploads?.();
        renderSourcesHeaders();
      }
    } catch (error) {
      reportNonFatalError(`Render/${tabName}`, error);
    } finally {
      performanceMonitor?.record(`render:${tabName}`, windowRef.performance.now() - startedAt);
    }
  }

  function getActiveTabName() {
    return documentRef.querySelector('.tab.active')?.dataset.tab || 'visao';
  }

  function renderAll() {
    buildLinks();
    populateFilters();
    try {
      renderSourcesHeaders();
    } catch (error) {
      reportNonFatalError('Boot/renderizar fontes', error);
    }
    renderTab(getActiveTabName());
  }

  function debouncedRender(tabName) {
    windowRef.clearTimeout(renderTimeout);
    renderTimeout = windowRef.setTimeout(
      () => (tabName ? renderTab(tabName) : renderAll()),
      config.debounce_render,
    );
  }

  return Object.freeze({
    debounce,
    reportNonFatalError,
    runAsyncSafely,
    createKpi,
    resolveColor,
    renderApexChart,
    filterByActiveProject,
    getActiveHistory,
    getActiveProjection,
    getActiveFlows,
    buildLinks,
    renderTab,
    debouncedRender,
    getActiveTabName,
    renderAll,
  });
}
