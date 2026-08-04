import { replaceWithParsedMarkup } from '../dom.mjs';
import { escHtml } from '../formatters.mjs';
import { createOverviewDetailView } from './overview-detail-view.mjs';
import { buildManagementDeviationBreakdown } from '../../services/flow-deviation.mjs';
import {
  formatReflectionMonth,
  inflationIndexFromReflectionStatus,
  isReflectedStatus,
} from '../../services/flow-reflection.mjs';
import {
  formatCompactNumber as fmtR$k,
  formatNumber as fmtR$,
  formatPercentage as fmtPct,
} from '../dashboard-runtime.mjs';

let reportNonFatalError;
let runAsyncSafely;
let resolveColor;
let renderApexChart;
let destroyApexChart;
let getFlowsObraAtiva;
let SafeStorage;
let renderDashboardState;
let supaSaveDashboardKey;
let isAdminGeral;
let APP_STATE;
let refreshHeaderSubtitle;
let verificarDadosDesatualizados;
let calcularFlowsPendentesPorGrupo;
let buildProjectionSnapshot;
let getProjectionControlState;
let getAllMovimentacoes;
let overviewDetailView;
let openModal;

function activeManagementLabel() {
  return (
    APP_STATE.dados.historico?.projectionManagementByProject?.[APP_STATE.obra.ativa] ||
    APP_STATE.config.gestaoLabel ||
    'Atual'
  );
}

function flowDescription(flow) {
  return (
    String(flow.descricao || flow.motivo || flow.justificativa || '').trim() || 'Sem descrição'
  );
}

function openIncorporatedInflationDetail() {
  const breakdown = buildManagementDeviationBreakdown({
    flows: getFlowsObraAtiva(),
    managementLabel: activeManagementLabel(),
  });
  const indexLabel = { ipca: 'IPCA', incc: 'INCC' };
  const signed = (value) => `${value > 0 ? '+' : ''}${fmtR$(value)}`;
  const rows = breakdown.inflationFlows
    .map(
      (flow) => `<tr>
        <td>${escHtml(flow.n_alteracao || 'Sem número')}</td>
        <td>${escHtml(flowDescription(flow))}</td>
        <td>${escHtml(formatReflectionMonth(flow.refletido_mes))}</td>
        <td>${escHtml(indexLabel[inflationIndexFromReflectionStatus(flow.refletido_status)] || '—')}</td>
        <td class="num">${signed(Number(flow.custo_flowmaster) || 0)}</td>
      </tr>`,
    )
    .join('');
  const incompleteRows = breakdown.incompleteInflationFlows
    .map((flow) => {
      const missing = [];
      if (isReflectedStatus(flow.refletido_status) && !flow.refletido_mes) {
        missing.push('mês refletido');
      }
      return `<li><strong>${escHtml(flow.n_alteracao || 'Sem número')}</strong> · ${escHtml(flowDescription(flow))} <span>${escHtml(missing.join(' e '))}</span></li>`;
    })
    .join('');

  replaceWithParsedMarkup(
    document.getElementById('modalContent'),
    `<h2>Inflação incorporada</h2>
    <div class="meta">Obra: <strong>${escHtml(APP_STATE.obra.ativa)}</strong> · Gestão-base: <strong>${escHtml(activeManagementLabel())}</strong> · Corte: <strong>${escHtml(breakdown.cutoffMonth ? formatReflectionMonth(`${breakdown.cutoffMonth}-01`) : '—')}</strong></div>
    <div class="overview-inflation-summary">
      <div><span>IPCA</span><strong>${signed(breakdown.totalsByIndex.ipca)}</strong></div>
      <div><span>INCC</span><strong>${signed(breakdown.totalsByIndex.incc)}</strong></div>
      <div class="overview-inflation-summary-total"><span>Total incorporado</span><strong>${signed(breakdown.inflation)}</strong></div>
    </div>
    <div class="table-wrap overview-inflation-table-wrap">
      <table class="overview-inflation-table">
        <thead><tr><th>Flow</th><th>Descrição</th><th>Mês refletido</th><th>Índice</th><th class="num">Valor</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="overview-inflation-empty">Nenhuma parcela de inflação incorporada até esta Gestão.</td></tr>'}</tbody>
        <tfoot><tr><th colspan="4">Total conciliado</th><th class="num">${signed(breakdown.inflation)}</th></tr></tfoot>
      </table>
    </div>
    ${incompleteRows ? `<section class="overview-inflation-incomplete"><h3>Atenção: parcelas incompletas não contabilizadas</h3><ul>${incompleteRows}</ul></section>` : ''}`,
  );
  openModal({ initialFocus: '[data-click-action="closeModal"]' });
}

// ============ VISÃO GERAL ============
// APP_STATE.config.gestaoLabel, APP_STATE.config.evolGlobal, APP_STATE.config.card3Modo, APP_STATE.config.correcaoIndice
// declarados na seção ESTADO GLOBAL acima

function setCard3Modo(v) {
  APP_STATE.config.card3Modo = v;
  SafeStorage.set('jzurique_card3_modo', v);
  if (isAdminGeral()) {
    void runAsyncSafely(
      supaSaveDashboardKey('card3_modo', v),
      'Config/salvar modo do card',
      'A configuração foi salva apenas neste navegador.',
    );
  }
  if (typeof renderVisao === 'function') renderVisao({ cardsOnly: true });
}

function setCorrecaoIndice(v) {
  APP_STATE.config.correcaoIndice = v;
  SafeStorage.set('jzurique_indice_correcao', v);
  if (isAdminGeral()) {
    void runAsyncSafely(
      supaSaveDashboardKey('indice_correcao', v),
      'Config/salvar índice',
      'O índice foi salvo apenas neste navegador.',
    );
  }
  if (Array.isArray(APP_STATE.dados.tendencia)) {
    APP_STATE.dados.tendencia.forEach((d) => {
      d.licitacao_corrigido = v === 'ipca' ? d.corrigido_ipca : d.corrigido_incc;
    });
  }
  if (typeof renderVisao === 'function') renderVisao({ cardsOnly: true });
}

// v0.55 — Card 4: Aderência Físico-Financeira (Prevision)
// Compara Evolução Teórica (cronograma) vs Evolução Financeira (gastos).
// Valores vêm do subheader (linha 1) do CSV Tendência — só obra civil, sem indiretos.
function renderCardAderencia() {
  const evol =
    typeof APP_STATE.config.evolGlobal !== 'undefined'
      ? APP_STATE.config.evolGlobal
      : { teorica: null, financeira: null };
  const teor = evol.teorica;
  const fin = evol.financeira;
  if (teor == null && fin == null) {
    // placeholder amigável em vez de esconder o card
    return `
    <div class="kpi kpi-wide overview-adherence-card--empty">
      <div class="overview-card-heading">
        <div class="label overview-card-label">🏗️ Aderência Físico-Financeira</div>
        <span class="overview-source-chip">Prevision</span>
      </div>
      <div class="overview-adherence-empty">
        📭 <strong>Aguardando dados</strong><br>
        <span class="overview-adherence-empty-help">Envie a aba TENDÊNCIA no formato v0.55 (com colunas EVOLUÇÃO TEÓRICA e EVOLUÇÃO FINANCEIRA)</span>
      </div>
    </div>`;
  }
  const delta = teor != null && fin != null ? fin - teor : null;
  const absD = delta != null ? Math.abs(delta) : null;
  const nominalSource = APP_STATE.dados.tendencia.find(
    (item) => item.evolucao_teorica != null && item.evolucao_financeira != null,
  );
  const nominalTheoretical = evol.teoricaNominal ?? nominalSource?.evolucao_teorica ?? null;
  const nominalFinancial = evol.financeiraNominal ?? nominalSource?.evolucao_financeira ?? null;
  const nominalDelta =
    nominalTheoretical != null && nominalFinancial != null
      ? nominalFinancial - nominalTheoretical
      : null;

  // Semáforo: verde ≤5pp, amber 5-15pp, red >15pp
  let semaLabel, semaCls, ico;
  if (absD == null) {
    semaLabel = 'sem comparativo';
    semaCls = '';
    ico = '⚪';
  } else if (absD <= 5) {
    semaLabel = 'Dentro do esperado';
    semaCls = 'green';
    ico = '🟢';
  } else if (absD <= 15) {
    semaLabel = 'Descolamento moderado';
    semaCls = 'amber';
    ico = '🟡';
  } else {
    semaLabel = 'Descolamento crítico';
    semaCls = 'red';
    ico = '🔴';
  }

  const fmtAdherenceNumber = (value) =>
    value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPP = (v) => (v == null ? '-' : fmtAdherenceNumber(v) + 'pp');
  const fmtPct = (v) => (v == null ? '-' : fmtAdherenceNumber(v) + '%');
  const varianceTone = delta == null ? 'neutral' : delta > 0 ? 'negative' : 'positive';
  const nominalTone = nominalDelta == null ? 'neutral' : nominalDelta > 0 ? 'negative' : 'positive';
  const clampPercentage = (value) => Math.max(0, Math.min(100, Number(value)));
  const physicalPosition = teor == null ? null : clampPercentage(teor);
  const financialPosition = fin == null ? null : clampPercentage(fin);
  const gapStart =
    physicalPosition != null && financialPosition != null
      ? Math.min(physicalPosition, financialPosition)
      : null;
  const gapWidth =
    physicalPosition != null && financialPosition != null
      ? Math.abs(financialPosition - physicalPosition)
      : null;
  const progressEnd =
    physicalPosition != null && financialPosition != null
      ? Math.min(physicalPosition, financialPosition)
      : (physicalPosition ?? financialPosition);
  const svgPosition = (value) => (value * 3).toFixed(2);
  const fmtBarPct = (value) => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
  const markerLabel = (position, otherPosition, isPhysical) => {
    const scaledPosition = position * 3;
    if (position <= 8) return { x: scaledPosition + 5, anchor: 'start' };
    if (position >= 92) return { x: scaledPosition - 5, anchor: 'end' };
    if (otherPosition == null) return { x: scaledPosition, anchor: 'middle' };
    const comesFirst = position < otherPosition || (position === otherPosition && isPhysical);
    return {
      x: scaledPosition + (comesFirst ? -5 : 5),
      anchor: comesFirst ? 'end' : 'start',
    };
  };
  const physicalLabel =
    physicalPosition == null ? null : markerLabel(physicalPosition, financialPosition, true);
  const financialLabel =
    financialPosition == null ? null : markerLabel(financialPosition, physicalPosition, false);

  return `
    <div class="kpi kpi-wide ${semaCls}">
      <div class="overview-card-heading">
        <div class="label overview-card-label">🏗️ Aderência Físico-Financeira</div>
        <span class="overview-source-chip" title="Fonte: Prevision (aba TENDÊNCIA). Indiretos não entram nesta conta.">Prevision</span>
      </div>
      <hr class="overview-divider">
      <div class="overview-adherence-lines">
        <div class="overview-adherence-line">
          <span>🎯 Evolução física</span>
          <strong class="overview-adherence-value--theoretical">${fmtPct(teor)}</strong>
        </div>
        <div class="overview-adherence-line">
          <span>💰 Evolução financeira</span>
          <strong class="overview-adherence-value--financial">${fmtPct(fin)}</strong>
        </div>
      </div>
      <hr class="overview-divider">
      <div class="overview-adherence-line overview-adherence-status overview-tone--${varianceTone}">
        <span>${ico} ${semaLabel}</span>
        <strong>${delta != null ? (delta >= 0 ? '+' : '') + fmtPP(delta) : '-'}</strong>
      </div>
      <div class="overview-adherence-line overview-adherence-nominal overview-tone--${nominalTone}" title="Diferença nominal entre N3 e M3 da aba Tendência">
        <span>💱 Diferença nominal</span>
        <strong>${nominalDelta != null ? (nominalDelta >= 0 ? '+' : '') + fmtR$(nominalDelta) : '-'}</strong>
      </div>
      <div class="overview-adherence-bar">
        <svg
          class="overview-adherence-bar-svg"
          viewBox="0 0 300 30"
          role="img"
          aria-label="Comparação percentual: evolução física ${fmtPct(teor)} e evolução financeira ${fmtPct(fin)}"
        >
          <rect class="overview-adherence-bar-track" x="0" y="15" width="300" height="6" rx="3"></rect>
          ${
            progressEnd != null
              ? `<rect class="overview-adherence-bar-progress" x="0" y="15" width="${svgPosition(progressEnd)}" height="6" rx="3"></rect>`
              : ''
          }
          ${
            gapStart != null && gapWidth != null
              ? `<rect class="overview-adherence-bar-gap overview-adherence-bar-gap--${varianceTone}" x="${svgPosition(gapStart)}" y="15" width="${svgPosition(gapWidth)}" height="6" rx="3"></rect>`
              : ''
          }
          ${
            physicalPosition != null
              ? `<text class="overview-adherence-bar-value" x="${physicalLabel.x.toFixed(2)}" y="9" text-anchor="${physicalLabel.anchor}">${fmtBarPct(teor)}</text>
                 <line class="overview-adherence-bar-marker overview-adherence-bar-marker--physical" x1="${svgPosition(physicalPosition)}" x2="${svgPosition(physicalPosition)}" y1="12" y2="24" vector-effect="non-scaling-stroke"></line>`
              : ''
          }
          ${
            financialPosition != null
              ? `<text class="overview-adherence-bar-value" x="${financialLabel.x.toFixed(2)}" y="9" text-anchor="${financialLabel.anchor}">${fmtBarPct(fin)}</text>
                 <line class="overview-adherence-bar-marker overview-adherence-bar-marker--financial" x1="${svgPosition(financialPosition)}" x2="${svgPosition(financialPosition)}" y1="12" y2="24" vector-effect="non-scaling-stroke"></line>`
              : ''
          }
        </svg>
        <div class="overview-adherence-bar-legend" aria-hidden="true">
          <span class="overview-adherence-bar-key overview-adherence-bar-key--physical">Físico</span>
          <span class="overview-adherence-bar-key overview-adherence-bar-key--financial">Financeiro</span>
        </div>
      </div>
    </div>`;
}

// v0.57.2 — Função que estava faltando! (usada em renderProjecao na aba Tendência de Obra)
// Renderiza o card de Aderência Físico × Financeira dentro da aba de Tendência de Obra.
function renderAderenciaProj() {
  const el = document.getElementById('cardAderenciaProj');
  if (!el) return; // aba não tem esse card, ignora
  // Reusa a mesma lógica do card da Visão Geral
  replaceWithParsedMarkup(el, renderCardAderencia());
}

// navegar entre abas via JS (usado em botões de CTA)
function irParaAba(nomeAba) {
  const tab = document.querySelector(`.tab[data-tab="${nomeAba}"]`);
  if (tab) tab.click();
}

// Verifica se a obra ativa tem dados de Tendência carregados
function obraTemTendencia() {
  return (
    Array.isArray(APP_STATE.dados.tendencia) &&
    APP_STATE.dados.tendencia.some((d) => d.is_folha && (d.licitacao != null || d.gestao != null))
  );
}

export function buildOverviewProjectionMetrics({
  correctedBudget,
  management,
  indirectTendency = 0,
  directTendency = 0,
  projectionReserve = 0,
}) {
  const roundCurrency = (value) => Math.round((Number(value) || 0) * 100) / 100;
  const corrected = roundCurrency(correctedBudget);
  const managed = roundCurrency(management);
  const indirect = roundCurrency(indirectTendency);
  const direct = roundCurrency(directTendency);
  const reserve = roundCurrency(projectionReserve);
  const projectedTotal = roundCurrency(managed + indirect + direct);
  const managementVsCorrected = roundCurrency(managed - corrected);
  const grossDifference = roundCurrency(projectedTotal - corrected);
  const liquidProjectedTotal = roundCurrency(projectedTotal - reserve);
  const liquidDifference = roundCurrency(liquidProjectedTotal - corrected);
  return {
    projectedTotal,
    managementVsCorrected,
    grossDifference,
    liquidProjectedTotal,
    liquidDifference,
    grossPercentage: corrected ? (grossDifference / corrected) * 100 : 0,
    liquidPercentage: corrected ? (liquidDifference / corrected) * 100 : 0,
  };
}

function renderVisao({ cardsOnly = false } = {}) {
  // guard sem dados de Tendência
  if (!obraTemTendencia()) {
    const kpisEl = document.getElementById('kpis');
    const gruposEl = document.getElementById('grupos');
    const alertEl = document.getElementById('alertBanner');
    if (kpisEl)
      renderDashboardState(kpisEl, {
        title: 'Visão Geral sem dados',
        message: 'Envie a planilha de Tendência desta obra para visualizar os indicadores.',
        action: { label: 'Ir para Uploads', tab: 'uploads' },
      });
    if (gruposEl) gruposEl.replaceChildren();
    if (alertEl) alertEl.replaceChildren();
    // Limpar composição do desvio
    const donutEl = document.getElementById('donutChart');
    const donutLegendEl = document.getElementById('donutLegend');
    const donutCenterEl = document.getElementById('donutCenter');
    if (donutEl)
      renderDashboardState(donutEl, { title: 'Sem composição disponível', compact: true });
    if (donutLegendEl) donutLegendEl.replaceChildren();
    if (donutCenterEl) donutCenterEl.hidden = true;
    const detailBody = document.getElementById('overviewInputTbody');
    if (detailBody) {
      replaceWithParsedMarkup(
        detailBody,
        '<tr><td colspan="4" class="overview-input-empty">Sem insumos para detalhar.</td></tr>',
      );
    }
    refreshHeaderSubtitle();
    verificarDadosDesatualizados();
    return;
  }
  const folhas = APP_STATE.dados.tendencia.filter((d) => d.is_folha);
  // Atualiza subtítulo do header com a gestão atual
  refreshHeaderSubtitle();
  let totLicit = 0,
    totGestao = 0;
  folhas.forEach((d) => {
    totLicit += d.licitacao || 0;
    totGestao += d.gestao || 0;
  });
  const totDiff = totGestao - totLicit;

  // KPIs de flows por tipo
  const tipoSum = {};
  ['aumento_real', 'remanejamento', 'economia', 'pendente', 'sem_classificacao'].forEach((t) => {
    tipoSum[t] = getFlowsObraAtiva()
      .filter((f) => f.tipo === t && f.dep !== 'Cancelado')
      .reduce((s, f) => s + (f.custo_flowmaster || 0), 0);
  });
  const totAumentoReal = tipoSum.aumento_real;
  const totPendente = tipoSum.pendente;

  // Totais corrigidos (folhas)
  let totIncc = 0,
    totIpca = 0;
  folhas.forEach((d) => {
    totIncc += d.corrigido_incc || 0;
    totIpca += d.corrigido_ipca || 0;
  });
  const totCorrigido = APP_STATE.config.correcaoIndice === 'ipca' ? totIpca : totIncc;
  const indiceLabel = APP_STATE.config.correcaoIndice.toUpperCase();
  // Diferenças vs licitação
  const inflacaoAbs = totCorrigido - totLicit;
  // Estouro bruto (gestão vs licitação)
  const desvioBrutoPct = totLicit ? (totDiff / totLicit) * 100 : 0;
  // ===== Cálculo das tendências (Card 3) =====
  const flowsPend =
    typeof calcularFlowsPendentesPorGrupo === 'function'
      ? calcularFlowsPendentesPorGrupo()
      : {
          'Custos Indiretos': 0,
          'Custos Diretos / Infraestrutura': 0,
          'Obras Civis': 0,
          'Projeção de Gastos': 0,
          Outros: 0,
        };
  const projectionSnapshot = buildProjectionSnapshot();
  const totExtrapInd = projectionSnapshot.serviceProjections
    .filter(
      (projection) =>
        projection.grupo === 'Custos Indiretos' || projection.grupo === 'Projeção de Gastos',
    )
    .reduce((sum, projection) => sum + (projection.extrapolacao || 0), 0);
  const tendIndiretos =
    totExtrapInd + flowsPend['Custos Indiretos'] + flowsPend['Projeção de Gastos'];
  const tendDiretos =
    flowsPend['Custos Diretos / Infraestrutura'] + flowsPend['Obras Civis'] + flowsPend['Outros'];

  // Reserva (Projeção de Gastos) - vem do saldo atual da aba Controle Projeção
  const projectionControlState = getProjectionControlState();
  const insumoControlado = projectionControlState?.insumo || 'I011890';
  let reservaProj = 0;
  try {
    if (typeof getAllMovimentacoes === 'function') {
      const movs = getAllMovimentacoes();
      const totEnt = movs
        .filter((m) => m.direcao === 'entrada')
        .reduce((s, m) => s + (m.valor || 0), 0);
      const totSai = movs
        .filter((m) => m.direcao === 'saida')
        .reduce((s, m) => s + (m.valor || 0), 0);
      reservaProj = totEnt - totSai;
    }
  } catch (e) {
    reservaProj = 0;
    reportNonFatalError('Visão geral/calcular reserva de projeção', e);
  }
  const projectionMetrics = buildOverviewProjectionMetrics({
    correctedBudget: totCorrigido,
    management: totGestao,
    indirectTendency: tendIndiretos,
    directTendency: tendDiretos,
    projectionReserve: reservaProj,
  });
  const tendFinal = projectionMetrics.projectedTotal;
  const gestaoVsCorrigido = projectionMetrics.managementVsCorrected;
  const tendVsCorrigido = projectionMetrics.grossDifference;
  const tendFinalLiq = projectionMetrics.liquidProjectedTotal;
  const tendVsCorrigidoLiq = projectionMetrics.liquidDifference;
  const tendVsCorrigidoPct = projectionMetrics.grossPercentage;
  const tendVsCorrigidoLiqPct = projectionMetrics.liquidPercentage;
  const tendBrutoCls =
    tendVsCorrigidoPct > 10
      ? 'red'
      : tendVsCorrigidoPct > 5
        ? 'amber'
        : tendVsCorrigidoPct > 0
          ? 'amber'
          : 'green';
  const tendLiqCls =
    tendVsCorrigidoLiqPct > 10
      ? 'red'
      : tendVsCorrigidoLiqPct > 5
        ? 'amber'
        : tendVsCorrigidoLiqPct > 0
          ? 'amber'
          : 'green';

  // Decomposição do Fluxo Atual
  const desvioBruto = totDiff; // gestao - licit
  const managementDeviation = buildManagementDeviationBreakdown({
    flows: getFlowsObraAtiva(),
    managementLabel: activeManagementLabel(),
  });
  const inflacaoIncorporada = managementDeviation.inflation;
  const aditivoRastreado = managementDeviation.otherReflected;
  const restoNaoRastreado = desvioBruto - inflacaoIncorporada - aditivoRastreado;

  const kpiBrutoCls = desvioBrutoPct > 5 ? 'red' : desvioBrutoPct > 0 ? 'amber' : 'green';
  // Toggle INCC/IPCA
  const toggleHtml = `
    <div class="toggle-group overview-index-toggle">
      <button type="button" data-click-action="setCorrecaoIndice" data-action-mode="arg" data-action-arg="incc" class="toggle-btn ${APP_STATE.config.correcaoIndice === 'incc' ? 'active' : ''}">INCC</button>
      <button type="button" data-click-action="setCorrecaoIndice" data-action-mode="arg" data-action-arg="ipca" class="toggle-btn ${APP_STATE.config.correcaoIndice === 'ipca' ? 'active' : ''}">IPCA</button>
    </div>
  `;

  // Helper: linha de breakdown dentro do card
  const signedTone = (value) => (value > 0 ? 'negative' : value < 0 ? 'positive' : 'neutral');
  const budgetBaseShare =
    totCorrigido > 0 ? Math.max(0, Math.min(100, (totLicit / totCorrigido) * 100)) : 0;
  const budgetCorrectionShare = Math.max(0, 100 - budgetBaseShare);
  const budgetBarNumber = (value) => value.toFixed(2);
  const bdLine = (label, valor, tone = 'neutral', hint, action) => `
    <${action ? 'button' : 'div'} ${action ? `type="button" data-click-action="${action}"` : ''} class="overview-breakdown-line${action ? ' overview-breakdown-line--action' : ''}">
      <span class="overview-breakdown-label">${label}${hint ? ` <span class="overview-breakdown-hint">(${hint})</span>` : ''}</span>
      <strong class="overview-tone--${tone}">${valor}</strong>
    </${action ? 'button' : 'div'}>
  `;
  const card3Details = [
    bdLine(
      '🎯 Gestão vs Licitação corrigida (' + indiceLabel + ')',
      (gestaoVsCorrigido >= 0 ? '+' : '') + fmtR$(gestaoVsCorrigido),
      signedTone(gestaoVsCorrigido),
    ),
    bdLine('🏗️ Tend. Indiretos', (tendIndiretos >= 0 ? '+' : '') + fmtR$(tendIndiretos), 'purple'),
    bdLine('🧱 Tend. Diretos', (tendDiretos >= 0 ? '+' : '') + fmtR$(tendDiretos), 'warning'),
    `<div class="overview-total-block">
            <div class="overview-total-line">
              <span class="overview-total-label">📈 Δ bruto vs Licitação corrigida</span>
              <strong class="overview-total-value overview-tone--${signedTone(tendVsCorrigido)}">${tendVsCorrigido >= 0 ? '+' : ''}${fmtR$(tendVsCorrigido)}</strong>
            </div>
            ${
              APP_STATE.config.card3Modo === 'liquido'
                ? ''
                : `
            <div class="overview-total-line">
              <span class="overview-projection-reserve-label">${escHtml(insumoControlado)} - Projeção de Gastos</span>
              <strong class="overview-total-value overview-tone--${signedTone(-reservaProj)}">${reservaProj > 0 ? '−' : reservaProj < 0 ? '+' : ''}${fmtR$(Math.abs(reservaProj))}</strong>
            </div>
            <div class="overview-total-line">
              <span class="overview-total-label">💧 Δ líquido vs Licitação corrigida</span>
              <strong class="overview-total-value overview-tone--${signedTone(tendVsCorrigidoLiq)}">${tendVsCorrigidoLiq >= 0 ? '+' : ''}${fmtR$(tendVsCorrigidoLiq)}</strong>
            </div>`
            }
          </div>`,
  ].join('');

  replaceWithParsedMarkup(
    document.getElementById('kpis'),
    `
    <!-- Card Licitação + Correção -->
    <div class="kpi kpi-wide overview-budget-card">
      <div class="label">📋 Orçamento Licitação</div>
      <div class="value">${fmtR$(totLicit)}</div>
      <div class="overview-budget-correction-head">
        <div class="overview-kpi-overline">Correção monetária (${indiceLabel})</div>
        ${toggleHtml}
      </div>
      <div class="overview-kpi-split">
        <div class="overview-kpi-adjustment overview-tone--purple">${inflacaoAbs >= 0 ? '+' : ''}${fmtR$(inflacaoAbs)}</div>
      </div>
      <hr class="overview-divider">
      <div class="overview-budget-total">
        <span class="overview-budget-caption">Total corrigido</span>
        <strong class="overview-kpi-corrected-total">${fmtR$(totCorrigido)}</strong>
      </div>
      <div class="overview-budget-bar">
        <svg
          class="overview-budget-bar-svg"
          viewBox="0 0 100 6"
          preserveAspectRatio="none"
          role="img"
          aria-label="Composição do orçamento corrigido: valor original e correção monetária pelo ${indiceLabel}"
        >
          <rect class="overview-budget-bar-track" x="0" y="0" width="100" height="6" rx="3"></rect>
          <rect class="overview-budget-bar-base" x="0" y="0" width="${budgetBarNumber(budgetBaseShare)}" height="6" rx="3"></rect>
          <rect class="overview-budget-bar-correction" x="${budgetBarNumber(budgetBaseShare)}" y="0" width="${budgetBarNumber(budgetCorrectionShare)}" height="6" rx="3"></rect>
        </svg>
        <div class="overview-budget-bar-legend" aria-hidden="true">
          <span class="overview-budget-bar-key overview-budget-bar-key--base">Base</span>
          <span class="overview-budget-bar-key overview-budget-bar-key--correction">Correção ${indiceLabel}</span>
        </div>
      </div>
    </div>

    <!-- Card Fluxo Atual (Gestão) -->
    <div class="kpi kpi-wide ${kpiBrutoCls}">
      <div class="label">📊 ${escHtml(APP_STATE.config.gestaoLabel)}</div>
      <div class="value">${fmtR$(totGestao)}</div>
      <div class="overview-breakdown-heading">Decomposição do desvio</div>
      ${bdLine('💱 Inflação incorporada', (inflacaoIncorporada > 0 ? '+' : '') + fmtR$(inflacaoIncorporada), 'purple', `via Flows até ${managementDeviation.cutoffMonth ? formatReflectionMonth(`${managementDeviation.cutoffMonth}-01`) : 'o mês atual'}`, 'openIncorporatedInflationDetail')}
      ${bdLine('📎 Aditivos refletidos', (aditivoRastreado > 0 ? '+' : '') + fmtR$(aditivoRastreado), 'warning', 'rastreado em Flows')}
      ${bdLine('❓ Não rastreado', (restoNaoRastreado > 0 ? '+' : '') + fmtR$(restoNaoRastreado), signedTone(restoNaoRastreado), 'atualização de orçamento')}
      <div class="overview-total-block">
        <div class="overview-total-line">
          <span class="overview-total-label">🎯 Total · Desvio bruto <span class="overview-total-hint">(${fmtPct(desvioBrutoPct)})</span></span>
          <strong class="overview-total-value overview-tone--${signedTone(desvioBruto)}">${desvioBruto >= 0 ? '+' : ''}${fmtR$(desvioBruto)}</strong>
        </div>
      </div>
    </div>

    <!-- Card 3 — Tendência projetada (versão compacta v0.43) -->
    <div class="kpi kpi-wide ${APP_STATE.config.card3Modo === 'liquido' ? tendLiqCls : tendBrutoCls}">
      <div class="label">🔮 Tendência Final Projetada</div>
      <div class="overview-projection-head">
        <div class="overview-projection-number">${fmtR$(APP_STATE.config.card3Modo === 'liquido' ? tendFinalLiq : tendFinal)}</div>
        <div class="toggle-group">
          <button type="button" data-click-action="setCard3Modo" data-action-mode="arg" data-action-arg="bruto" class="toggle-btn ${APP_STATE.config.card3Modo === 'bruto' ? 'active' : ''}">Bruto</button>
          <button type="button" data-click-action="setCard3Modo" data-action-mode="arg" data-action-arg="liquido" class="toggle-btn ${APP_STATE.config.card3Modo === 'liquido' ? 'active' : ''}">Líquido</button>
        </div>
      </div>
      ${card3Details}
    </div>

    <!-- Card 4 (v0.55) — Aderência Físico-Financeira (Prevision) -->
    ${renderCardAderencia()}
  `,
  );

  overviewDetailView.render({
    snapshot: projectionSnapshot,
    correctedBudget: totCorrigido,
    finalTendency: tendFinal,
  });

  if (cardsOnly) return;

  // Alerta de pendentes
  if (totPendente > 0) {
    replaceWithParsedMarkup(
      document.getElementById('alertBanner'),
      `
      <div class="alert-banner">
        ⚠️ <strong>Atenção:</strong> existem ${fmtR$(totPendente)} em aditivos ainda <strong>pendentes de classificação</strong> (Insumo Planejamento = "Não encontrado!"). Classificá-los permitirá entender se são aumento real, remanejamento ou economia. Hoje só ${fmtR$(totAumentoReal)} de aumento real estão formalizados, mas o desvio total é de ${fmtR$(totDiff)} — boa parte ainda é tendência não rastreada.
      </div>`,
    );
  } else {
    document.getElementById('alertBanner').replaceChildren();
  }

  // Verificar se dados estão desatualizados
  verificarDadosDesatualizados();

  // Grupos
  const byGrupo = {};
  folhas.forEach((d) => {
    const g = d.grupo || 'Outros';
    if (!byGrupo[g]) byGrupo[g] = { licit: 0, gestao: 0, n: 0, aditivos: 0 };
    byGrupo[g].licit += d.licitacao || 0;
    byGrupo[g].gestao += d.gestao || 0;
    byGrupo[g].aditivos += d.aditivo_total || 0;
    byGrupo[g].n += 1;
  });
  // Ordem fixa dos grupos (e exclusões)
  const GRUPO_ORDER = [
    'Custos Indiretos',
    'Custos Diretos / Infraestrutura',
    'Obras Civis',
    'Projeção de Gastos',
  ];
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
  replaceWithParsedMarkup(
    document.getElementById('grupos'),
    gruposOrdenados
      .map(([g, v]) => {
        const diff = v.gestao - v.licit;
        const pct = v.licit ? (diff / v.licit) * 100 : null;
        const st = pct == null ? 'gray' : pct > 10 ? 'red' : pct > 0 ? 'amber' : 'green';
        const barWidth = Math.min(100, Math.abs(pct || 0) * 5);
        const aditInfo =
          Math.abs(v.aditivos) > 0.01
            ? ` · <span class="overview-group-aditivos">📎 ${fmtR$k(v.aditivos)} em aditivos</span>`
            : '';
        return `
      <div class="grupo-row">
        <div class="grupo-nome"><span class="dot ${st}"></span>${escHtml(g)}<span class="overview-group-count">(${v.n})${aditInfo}</span></div>
        <div class="overview-group-meta">${fmtR$k(v.licit)} → ${fmtR$k(v.gestao)}</div>
        <div class="${diff <= 0 ? 'pos' : 'neg'} overview-group-diff">${pct != null ? fmtPct(pct) : 'novo'}</div>
        <progress class="grupo-bar-progress grupo-bar-progress--${st}" max="100" value="${barWidth}" aria-hidden="true">${barWidth}</progress>
      </div>`;
      })
      .join(''),
  );

  renderDonut(tipoSum);
}

// Filtro interativo do donut (toggle por tipo) — APP_STATE.donut.hidden e APP_STATE.donut.lastTipoSum em AppState.donut

function toggleDonutSlice(key) {
  if (APP_STATE.donut.hidden.has(key)) APP_STATE.donut.hidden.delete(key);
  else APP_STATE.donut.hidden.add(key);
  if (APP_STATE.donut.lastTipoSum) renderDonut(APP_STATE.donut.lastTipoSum);
}

function renderDonutLegend(segments, total) {
  const legend = document.getElementById('donutLegend');
  if (!legend) return;
  const rows = segments
    .filter((segment) => segment.v > 0)
    .map((segment) => {
      const isVisible = !APP_STATE.donut.hidden.has(segment.key);
      const percentage = total > 0 ? Math.round((segment.v / total) * 100) : 0;
      return `
        <button
          type="button"
          class="overview-donut-legend-item${isVisible ? '' : ' is-hidden'}"
          data-click-action="toggleDonutSlice"
          data-action-mode="arg"
          data-action-arg="${segment.key}"
          aria-pressed="${isVisible}"
          title="${isVisible ? 'Ocultar' : 'Exibir'} ${segment.lbl}"
        >
          <span class="overview-donut-legend-swatch overview-donut-legend-swatch--${segment.key}" aria-hidden="true"></span>
          <span class="overview-donut-legend-copy">
            <strong>${segment.lbl}:</strong>
            <span>R$ ${fmtR$(segment.v)}</span>
            <span class="overview-donut-legend-percentage">(${percentage}%)</span>
          </span>
        </button>
      `;
    })
    .join('');
  replaceWithParsedMarkup(legend, rows);
}

function renderDonutCenter(value, filtered = false) {
  const center = document.getElementById('donutCenter');
  const total = document.getElementById('donutTotal');
  const label = document.getElementById('donutTotalLabel');
  if (!center || !total || !label) return;
  center.hidden = value == null;
  total.textContent = value == null ? '' : `R$ ${fmtR$k(value)}`;
  label.textContent = filtered ? 'total filtrado' : 'total flows';
}

function renderDonut(tipoSum) {
  APP_STATE.donut.lastTipoSum = tipoSum;
  const aum = Math.max(0, tipoSum.aumento_real);
  const rem = Math.max(0, tipoSum.remanejamento);
  const eco = Math.max(0, tipoSum.economia);
  const pen = Math.max(0, tipoSum.pendente);
  const sem = Math.max(0, tipoSum.sem_classificacao);
  const total = aum + rem + eco + pen + sem;

  if (total <= 0) {
    destroyApexChart('donutChart');
    document.getElementById('donutLegend')?.replaceChildren();
    renderDonutCenter(null);
    replaceWithParsedMarkup(
      document.getElementById('donutChart'),
      '<div class="overview-donut-empty">Sem aditivos para exibir.</div>',
    );
    return;
  }

  const allSegs = [
    { key: 'aum', v: aum, lbl: 'Aumento real' },
    { key: 'rem', v: rem, lbl: 'Remanejamento' },
    { key: 'eco', v: eco, lbl: 'Economia' },
    { key: 'pen', v: pen, lbl: 'Pendente' },
    { key: 'sem', v: sem, lbl: 'Sem classificação' },
  ];

  renderDonutLegend(allSegs, total);
  const visibleSegs = allSegs.filter((s) => s.v > 0 && !APP_STATE.donut.hidden.has(s.key));
  if (visibleSegs.length === 0) {
    destroyApexChart('donutChart');
    renderDonutCenter(null);
    replaceWithParsedMarkup(
      document.getElementById('donutChart'),
      '<div class="overview-donut-empty">Nenhuma categoria selecionada.</div>',
    );
    return;
  }
  const series = visibleSegs.map((s) => s.v);
  renderDonutCenter(
    series.reduce((sum, value) => sum + value, 0),
    APP_STATE.donut.hidden.size > 0,
  );
  const labels = visibleSegs.map((s) => s.lbl);
  const colorTokenMap = {
    aum: 'var(--sem-erro-vivid)',
    rem: 'var(--accent-info-vivid)',
    eco: 'var(--sem-ok-vivid)',
    pen: 'var(--sem-alerta-vivid)',
    sem: 'var(--chart-neutral)',
  };
  const themePalette = visibleSegs.map((s) => colorTokenMap[s.key]);
  const colors = themePalette.map(resolveColor);

  const options = {
    series: series,
    chart: {
      type: 'donut',
      height: 320,
      animations: { enabled: true, easing: 'easeinout', speed: 600 },
      toolbar: { show: false },
      events: {
        dataPointSelection: function (event, chartContext, config) {
          const segIndex = config.dataPointIndex;
          if (segIndex >= 0 && segIndex < visibleSegs.length) {
            toggleDonutSlice(visibleSegs[segIndex].key);
          }
        },
      },
    },
    labels: labels,
    themePalette,
    colors: colors,
    plotOptions: {
      pie: {
        donut: {
          size: '72%',
          labels: { show: false },
        },
      },
    },
    tooltip: {
      enabled: true,
      theme: document.body.classList.contains('dark') ? 'dark' : 'light',
      y: {
        formatter: function (val) {
          const pct = ((val / total) * 100).toFixed(1);
          return fmtR$(val) + ' (' + pct + '%)';
        },
      },
    },
    legend: {
      show: false,
    },
    stroke: { width: 0 },
    dataLabels: { enabled: false },
    responsive: [{ breakpoint: 480, options: { chart: { height: 260 } } }],
  };

  renderApexChart('donutChart', options);
}

export function createOverviewView({
  runtime,
  loadXlsx,
  storage,
  feedback,
  modals,
  viewStates,
  dashboardRepository,
  authService,
  state,
  shell,
  projection,
  projectionControl,
}) {
  reportNonFatalError = runtime.reportNonFatalError;
  runAsyncSafely = runtime.runAsyncSafely;
  resolveColor = runtime.resolveColor;
  renderApexChart = runtime.renderApexChart;
  destroyApexChart = runtime.destroyApexChart;
  getFlowsObraAtiva = runtime.getActiveFlows;
  SafeStorage = storage;
  renderDashboardState = viewStates.render;
  supaSaveDashboardKey = dashboardRepository.saveDashboardKey;
  isAdminGeral = authService.isAdmin;
  APP_STATE = state;
  refreshHeaderSubtitle = shell.refreshHeaderSubtitle;
  verificarDadosDesatualizados = shell.verificarDadosDesatualizados;
  calcularFlowsPendentesPorGrupo = projection.calcularFlowsPendentesPorGrupo;
  buildProjectionSnapshot = projection.buildSnapshot;
  getProjectionControlState = projectionControl.getState;
  getAllMovimentacoes = projectionControl.getAllMovimentacoes;
  overviewDetailView = createOverviewDetailView({
    storage,
    feedback,
    modals,
    loadXlsx,
    state,
    reportNonFatalError,
  });
  openModal = modals.open;
  return Object.freeze({
    renderAderenciaProj,
    irParaAba,
    obraTemTendencia,
    renderVisao,
    toggleDonutSlice,
    setCard3Modo,
    setCorrecaoIndice,
    openIncorporatedInflationDetail,
    overviewInputExpandAll: overviewDetailView.expandAll,
    overviewInputCollapseAll: overviewDetailView.collapseAll,
    restoreOverviewInputOriginalOrder: overviewDetailView.restoreOriginalOrder,
    resetOverviewInputColumnWidths: overviewDetailView.resetWidths,
    openOverviewInputDifference: overviewDetailView.openDifference,
    exportOverviewInputDetail: overviewDetailView.exportExcel,
  });
}
