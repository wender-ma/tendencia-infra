import { DASHBOARD_CONFIG } from '../../config.js';
import { replaceWithParsedMarkup } from '../dom.mjs';
import { escAttr, escHtml } from '../formatters.mjs';
import {
  debounce,
  formatCompactNumber as fmtR$k,
  formatNumber as fmt,
  formatNumber as fmtR$,
  LICENSE_LABEL as LIC_LABEL,
} from '../dashboard-runtime.mjs';

let uiCriarKpi;
let resolveColor;
let renderApexChart;
let getHistoricoObraAtiva;
let paginateRows;
let renderPaginationControls;
let renderDashboardState;
let APP_STATE;

const CENT_TOLERANCE = DASHBOARD_CONFIG.tolerancia_centavos; // R$ 1,00
const isFlat = (delta) => Math.abs(delta) < CENT_TOLERANCE;
let filtersBound = false;

function bindHistoryFilters() {
  if (filtersBound) return;
  filtersBound = true;
  const debouncedHistHeatmap = debounce(renderHistHeatmap, 300);
  ['histSearch', 'histCompare', 'histOnlyChanged'].forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener('input', debouncedHistHeatmap);
      element.addEventListener('change', debouncedHistHeatmap);
    }
  });
}

// APP_STATE.dados.historico declarado na seção ESTADO GLOBAL acima

// v0.58b: helpers de filtragem por obra ativa
// APP_STATE.dados.historico e APP_STATE.dados.projRaw são globais (todas as obras), filtramos em memória ao renderizar.
// getHistoricoObraAtiva, getProjRawObraAtiva, getFlowsObraAtiva agora são aliases
// para filtrarPorObraAtiva (definidos no início do script)

function renderHistorico() {
  bindHistoryFilters();
  // v0.58b: filtra pela obra ativa
  const HIST_OBRA = getHistoricoObraAtiva();
  // guard com placeholder amigável
  if (!HIST_OBRA || !HIST_OBRA.items || !HIST_OBRA.items.length) {
    const kpisEl = document.getElementById('histKpis');
    const chartEl = document.getElementById('histChart');
    const heatEl = document.getElementById('histHeatmap');
    if (kpisEl)
      renderDashboardState(kpisEl, {
        title: 'Sem histórico para esta obra',
        message: 'Envie a planilha de Gestões para visualizar a evolução mensal.',
        action: { label: 'Ir para Uploads', tab: 'uploads' },
      });
    if (chartEl) chartEl.replaceChildren();
    if (heatEl) heatEl.replaceChildren();
    document.getElementById('histLegend')?.replaceChildren();
    document.getElementById('histTopUp')?.replaceChildren();
    document.getElementById('histTopDown')?.replaceChildren();
    document.getElementById('histThead')?.replaceChildren();
    document.getElementById('histTbody')?.replaceChildren();
    document.getElementById('historyPagination')?.replaceChildren();
    const histCount = document.getElementById('histCount');
    if (histCount) histCount.textContent = '0 itens';
    return;
  }
  // Construir cópias que incluam o Orçamento Licitação como ponto zero
  const gestoes = [LIC_LABEL, ...HIST_OBRA.gestoes];
  // Mapa insumo → licitação (a partir da Tendência)
  const licMap = {};
  APP_STATE.dados.tendencia.forEach((t) => {
    if (t.is_folha && t.cod_insumo && t.licitacao != null) {
      licMap[t.cod_insumo] = (licMap[t.cod_insumo] || 0) + t.licitacao;
    }
  });
  // Anexar valor de licitação em cada item
  const items = HIST_OBRA.items.map((it) => ({
    ...it,
    [LIC_LABEL]: licMap[it.insumo] || 0,
  }));
  // Totais (inclui licitação)
  const totals = {
    [LIC_LABEL]: Object.values(licMap).reduce((s, v) => s + v, 0),
    ...HIST_OBRA.totals,
  };

  // KPIs: total atual, variação vs primeira, qtd itens que mudaram
  const primeira = gestoes[0];
  const ultima = gestoes[gestoes.length - 1];
  const totPrim = totals[primeira] || 0;
  const totUlt = totals[ultima] || 0;
  const totDiff = totUlt - totPrim;
  let changed = 0;
  items.forEach((it) => {
    for (let i = 1; i < gestoes.length; i++) {
      if (!isFlat((it[gestoes[i]] || 0) - (it[gestoes[i - 1]] || 0))) {
        changed++;
        break;
      }
    }
  });
  const diffKpiCls = isFlat(totDiff) ? '' : totDiff > 0 ? 'red' : 'green';
  const diffKpiVal = isFlat(totDiff)
    ? '<span style="color:var(--text-soft);font-size:16px;">estável</span>'
    : `${totDiff >= 0 ? '+' : ''}${fmtR$(totDiff)}`;
  const diffKpiSub = isFlat(totDiff)
    ? `variação &lt; R$ ${CENT_TOLERANCE.toFixed(2)}`
    : totPrim
      ? ((totDiff / totPrim) * 100).toFixed(2) + '%'
      : '';
  replaceWithParsedMarkup(
    document.getElementById('histKpis'),
    [
      uiCriarKpi({
        titulo:
          primeira === LIC_LABEL ? 'Orçamento Licitação (base)' : `Primeira gestão (${primeira})`,
        valor: fmtR$(totPrim),
        subtitulo: `${items.length} itens`,
      }),
      uiCriarKpi({
        titulo: `Última gestão (${ultima})`,
        valor: fmtR$(totUlt),
        subtitulo: 'vigente',
      }),
      uiCriarKpi({
        titulo: 'Variação total',
        valor: diffKpiVal,
        subtitulo: diffKpiSub,
        cor: diffKpiCls,
      }),
      uiCriarKpi({
        titulo: 'Itens que variaram',
        valor: changed,
        subtitulo: `de ${items.length} itens totais`,
        cor: 'amber',
      }),
      uiCriarKpi({
        titulo: 'Gestões disponíveis',
        valor: gestoes.length,
        subtitulo: gestoes.join(' → '),
      }),
    ].join(''),
  );

  renderHistChart(gestoes, totals);
  renderHistTopChanges(items, gestoes);
  renderHistHeatmap(items, gestoes);
}

function renderHistChart(gestoes, totals) {
  const vals = gestoes.map((g) => totals[g]);
  const categories = gestoes.map((g) => g.replace('GESTÃO ', '').replace('Atual', 'Atual'));
  const seriesData = vals;

  const options = {
    series: [{ name: 'Total da obra', data: seriesData }],
    chart: {
      type: 'area',
      height: 350,
      animations: { enabled: true, easing: 'easeinout', speed: 800 },
      toolbar: {
        show: true,
        tools: { download: true, selection: true, zoom: true, pan: true, reset: true },
      },
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
      labels: { formatter: (val) => fmtR$k(val), style: { fontSize: '10px' } },
    },
    tooltip: {
      enabled: true,
      shared: false,
      theme: document.body.classList.contains('dark') ? 'dark' : 'light',
      custom: function ({ series, seriesIndex, dataPointIndex, w: _w }) {
        const valor = series[seriesIndex][dataPointIndex];
        const gestaoLabel = gestoes[dataPointIndex];
        const prevVal = dataPointIndex > 0 ? vals[dataPointIndex - 1] : null;
        const variacao = prevVal != null ? valor - prevVal : 0;
        const variacaoPct =
          prevVal && prevVal !== 0 ? ((variacao / prevVal) * 100).toFixed(2) : null;
        const variacaoFmt = variacao >= 0 ? '+' + fmtR$(variacao) : fmtR$(variacao);
        let html = '<div style="padding:8px 12px; font-size:12px;">';
        html += '<strong>' + escHtml(gestaoLabel) + '</strong><br>';
        html +=
          '<span style="color:var(--text-soft);">Total:</span> <strong>' +
          fmtR$(valor) +
          '</strong>';
        if (prevVal != null) {
          html +=
            '<br><span style="color:var(--text-soft);">Δ vs anterior:</span> <strong>' +
            variacaoFmt +
            '</strong>';
          if (variacaoPct !== null) html += ' (' + variacaoPct + '%)';
        }
        if (dataPointIndex === 0)
          html += '<br><span style="color:var(--text-soft); font-size:11px;">Orçamento base</span>';
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
      hover: { sizeOffset: 3 },
    },
  };

  renderApexChart('histChart', options);

  // Legenda com variação entre gestões consecutivas (mantida em HTML separado)
  const leg = [];
  for (let i = 1; i < gestoes.length; i++) {
    const d = totals[gestoes[i]] - totals[gestoes[i - 1]];
    if (isFlat(d)) {
      leg.push(
        `<span><strong>${escHtml(gestoes[i - 1])} → ${escHtml(gestoes[i])}:</strong> <span style="color:var(--text-soft);">estável</span></span>`,
      );
    } else {
      const pct = totals[gestoes[i - 1]] ? (d / totals[gestoes[i - 1]]) * 100 : 0;
      const cls = d > 0 ? 'neg' : 'pos';
      leg.push(
        `<span><strong>${escHtml(gestoes[i - 1])} → ${escHtml(gestoes[i])}:</strong> <span class="${cls}">${d >= 0 ? '+' : ''}${fmtR$(d)} (${pct.toFixed(2)}%)</span></span>`,
      );
    }
  }
  replaceWithParsedMarkup(
    document.getElementById('histLegend'),
    leg.join(' · ') +
      ` <span style="color:var(--text-lighter); margin-left:8px;">· variações &lt; R$ ${CENT_TOLERANCE.toFixed(2)} ignoradas (arredondamento)</span>`,
  );
}

function renderHistTopChanges(items, gestoes) {
  // Variação entre a primeira e a última gestão
  const first = gestoes[0],
    last = gestoes[gestoes.length - 1];
  const enriched = items.map((it) => ({
    ...it,
    delta: (it[last] || 0) - (it[first] || 0),
    delta_pct: it[first] ? (((it[last] || 0) - it[first]) / it[first]) * 100 : null,
  }));
  const ups = enriched
    .filter((x) => x.delta >= CENT_TOLERANCE)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 10);
  const downs = enriched
    .filter((x) => x.delta <= -CENT_TOLERANCE)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 10);

  const renderList = (arr, isUp) => {
    if (!arr.length)
      return '<div style="color:var(--text-lighter); text-align:center; padding:20px;">Sem variações neste período.</div>';
    const maxAbs = Math.max(...arr.map((x) => Math.abs(x.delta)));
    return arr
      .map((x) => {
        // Tentar achar o nome do item na tendência via insumo
        const tendMatch = APP_STATE.dados.tendencia.find((t) => t.cod_insumo === x.insumo);
        const nome = tendMatch ? tendMatch.item : x.insumo + ' (' + x.item_cod + ')';
        return `
        <div class="top-item">
          <div class="name" title="${escAttr(nome)}">${escHtml(x.insumo)} — ${escHtml(nome.length > 40 ? nome.slice(0, 37) + '...' : nome)}</div>
          <div class="val ${x.delta < 0 ? 'pos' : 'neg'}">${x.delta >= 0 ? '+' : ''}${fmtR$(x.delta)}</div>
          <div class="top-bar"><div class="top-bar-fill ${isUp ? '' : 'green'}" style="width:${(Math.abs(x.delta) / maxAbs) * 100}%;"></div></div>
        </div>`;
      })
      .join('');
  };
  replaceWithParsedMarkup(document.getElementById('histTopUp'), renderList(ups, true));
  replaceWithParsedMarkup(document.getElementById('histTopDown'), renderList(downs, false));
}

function renderHistHeatmap() {
  // v0.58b: filtra pela obra ativa
  const HIST_OBRA = getHistoricoObraAtiva();
  const items = HIST_OBRA.items;
  const gestoes = HIST_OBRA.gestoes;
  const q = document.getElementById('histSearch').value.toLowerCase();
  const compare = document.getElementById('histCompare').value;
  const onlyChanged = document.getElementById('histOnlyChanged').checked;

  const filtered = items.filter((it) => {
    if (q) {
      const tendMatch = APP_STATE.dados.tendencia.find((t) => t.cod_insumo === it.insumo);
      const nome = tendMatch ? tendMatch.item : '';
      const txt = (it.insumo + ' ' + it.item_cod + ' ' + nome).toLowerCase();
      if (!txt.includes(q)) return false;
    }
    if (onlyChanged) {
      let changed = false;
      for (let i = 1; i < gestoes.length; i++) {
        if (!isFlat((it[gestoes[i]] || 0) - (it[gestoes[i - 1]] || 0))) {
          changed = true;
          break;
        }
      }
      if (!changed) return false;
    }
    return true;
  });

  // Ordenar por maior variação total (módulo)
  filtered.sort((a, b) => {
    const da = Math.abs((a[gestoes[gestoes.length - 1]] || 0) - (a[gestoes[0]] || 0));
    const db = Math.abs((b[gestoes[gestoes.length - 1]] || 0) - (b[gestoes[0]] || 0));
    return db - da;
  });

  const historyPage = paginateRows(
    'history',
    filtered,
    JSON.stringify([q, compare, onlyChanged, APP_STATE.obra.ativa, gestoes]),
  );

  // Header
  replaceWithParsedMarkup(
    document.getElementById('histThead'),
    `
    <tr>
      <th class="hist-th label">Insumo</th>
      <th class="hist-th label">Item</th>
      ${gestoes.map((g) => `<th class="hist-th">${escHtml(g === LIC_LABEL ? 'Licitação' : g.replace('GESTÃO ', ''))}</th>`).join('')}
      <th class="hist-th">Δ vs Licit. R$</th>
      <th class="hist-th">Δ %</th>
    </tr>
  `,
  );

  // Tbody
  replaceWithParsedMarkup(
    document.getElementById('histTbody'),
    historyPage.items
      .map((it) => {
        const cells = gestoes
          .map((g, i) => {
            const v = it[g] || 0;
            if (v === 0 && i > 0 && (it[gestoes[i - 1]] || 0) === 0) {
              return `<td class="hist-cell zero">—</td>`;
            }
            let cls = '';
            let title = `${escAttr(g)}: ${fmtR$(v)}`;
            if (i > 0) {
              const ref = compare === 'first' ? it[gestoes[0]] || 0 : it[gestoes[i - 1]] || 0;
              const d = v - ref;
              const pct = ref ? (d / ref) * 100 : v > 0 ? 100 : 0;
              if (!isFlat(d)) {
                if (d > 0) cls = Math.abs(pct) > 20 ? 'up-strong' : 'up';
                else cls = Math.abs(pct) > 20 ? 'down-strong' : 'down';
                title += ` (${d >= 0 ? '+' : ''}${fmtR$(d)} vs ${escAttr(compare === 'first' ? gestoes[0] : gestoes[i - 1])})`;
              } else cls = 'flat';
            }
            return `<td class="hist-cell ${cls}" title="${title}">${v ? fmt(v, 0) : '—'}</td>`;
          })
          .join('');
        const dTotalRaw = (it[gestoes[gestoes.length - 1]] || 0) - (it[gestoes[0]] || 0);
        const dTotal = isFlat(dTotalRaw) ? 0 : dTotalRaw;
        const pctTot =
          isFlat(dTotalRaw) || !it[gestoes[0]] ? null : (dTotalRaw / it[gestoes[0]]) * 100;
        const tendMatch = APP_STATE.dados.tendencia.find((t) => t.cod_insumo === it.insumo);
        const nome = tendMatch ? tendMatch.item : it.item_cod;
        return `<tr>
      <td style="font-size:11px;color:var(--text-soft);">${escHtml(it.insumo)}</td>
      <td style="font-size:11.5px;">${escHtml(nome)}</td>
      ${cells}
      <td class="hist-cell ${dTotal < 0 ? 'down-strong' : dTotal > 0 ? 'up-strong' : 'flat'}" style="font-weight:700;">${dTotal === 0 ? '—' : (dTotal >= 0 ? '+' : '') + fmt(dTotal, 0)}</td>
      <td class="hist-cell ${dTotal < 0 ? 'down-strong' : dTotal > 0 ? 'up-strong' : 'flat'}" style="font-weight:700;">${pctTot != null ? (pctTot >= 0 ? '+' : '') + pctTot.toFixed(1) + '%' : '—'}</td>
    </tr>`;
      })
      .join(''),
  );
  document.getElementById('histCount').textContent =
    `${filtered.length} de ${items.length} itens · exibindo ${historyPage.start}–${historyPage.end}`;
  renderPaginationControls('historyPagination', 'history', historyPage, renderHistHeatmap);
}

export function createHistoryView({ runtime, pagination, viewStates, state }) {
  uiCriarKpi = runtime.createKpi;
  resolveColor = runtime.resolveColor;
  renderApexChart = runtime.renderApexChart;
  getHistoricoObraAtiva = runtime.getActiveHistory;
  paginateRows = pagination.paginate;
  renderPaginationControls = pagination.renderControls;
  renderDashboardState = viewStates.render;
  APP_STATE = state;
  return Object.freeze({ renderHistorico });
}
