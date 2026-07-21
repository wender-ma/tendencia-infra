/* eslint-disable no-undef */
import { replaceWithParsedMarkup } from '../dom.mjs';
import {
  formatCompactNumber as fmtR$k,
  formatNumber as fmtR$,
  formatPercentage as fmtPct,
} from '../dashboard-runtime.mjs';

let reportNonFatalError;
let runAsyncSafely;
let resolveColor;
let renderApexChart;
let getProjRawObraAtiva;
let getFlowsObraAtiva;
let SafeStorage;
let renderDashboardState;
let supaSaveDashboardKey;

// ============ VISÃO GERAL ============
// GESTAO_LABEL, EVOL_GLOBAL, CARD3_MODO, CORRECAO_INDICE
// declarados na seção ESTADO GLOBAL acima

function setCard3Modo(v) {
  CARD3_MODO = v;
  SafeStorage.set('jzurique_card3_modo', v);
  if (isAdminGeral()) {
    void runAsyncSafely(
      supaSaveDashboardKey('card3_modo', v),
      'Config/salvar modo do card',
      'A configuração foi salva apenas neste navegador.',
    );
  }
  if (typeof renderVisao === 'function') renderVisao();
}

function setCorrecaoIndice(v) {
  CORRECAO_INDICE = v;
  SafeStorage.set('jzurique_indice_correcao', v);
  if (isAdminGeral()) {
    void runAsyncSafely(
      supaSaveDashboardKey('indice_correcao', v),
      'Config/salvar índice',
      'O índice foi salvo apenas neste navegador.',
    );
  }
  if (Array.isArray(DATA_T)) {
    DATA_T.forEach((d) => {
      d.licitacao_corrigido = v === 'ipca' ? d.corrigido_ipca : d.corrigido_incc;
    });
  }
  if (typeof renderVisao === 'function') renderVisao();
}

// v0.55 — Card 4: Aderência Físico-Financeira (Prevision)
// Compara Evolução Teórica (cronograma) vs Evolução Financeira (gastos).
// Valores vêm do subheader (linha 1) do CSV Tendência — só obra civil, sem indiretos.
function renderCardAderencia() {
  const evol =
    typeof EVOL_GLOBAL !== 'undefined' ? EVOL_GLOBAL : { teorica: null, financeira: null };
  const teor = evol.teorica;
  const fin = evol.financeira;
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
  const delta = teor != null && fin != null ? fin - teor : null;
  const absD = delta != null ? Math.abs(delta) : null;

  // Semáforo: verde ≤5pp, amber 5-15pp, red >15pp
  let sema, semaLabel, semaCls, ico;
  if (absD == null) {
    sema = 'var(--text-soft)';
    semaLabel = 'sem comparativo';
    semaCls = '';
    ico = '⚪';
  } else if (absD <= 5) {
    sema = 'var(--sem-ok)';
    semaLabel = 'Dentro do esperado';
    semaCls = 'green';
    ico = '🟢';
  } else if (absD <= 15) {
    sema = 'var(--sem-alerta)';
    semaLabel = 'Descolamento moderado';
    semaCls = 'amber';
    ico = '🟡';
  } else {
    sema = 'var(--sem-erro)';
    semaLabel = 'Descolamento crítico';
    semaCls = 'red';
    ico = '🔴';
  }

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

  const fmtPP = (v) => (v == null ? '-' : v.toFixed(2) + 'pp');
  const fmtPct = (v) => (v == null ? '-' : v.toFixed(2) + '%');

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
    Array.isArray(DATA_T) &&
    DATA_T.some((d) => d.is_folha && (d.licitacao != null || d.gestao != null))
  );
}

function renderVisao() {
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
    // Limpar donut e top 10 também
    const donutEl = document.getElementById('donutChart');
    const topUpEl = document.getElementById('top10Up');
    const topDownEl = document.getElementById('top10Down');
    if (donutEl)
      renderDashboardState(donutEl, { title: 'Sem composição disponível', compact: true });
    if (topUpEl)
      renderDashboardState(topUpEl, { title: 'Sem aumentos para comparar', compact: true });
    if (topDownEl)
      renderDashboardState(topDownEl, { title: 'Sem reduções para comparar', compact: true });
    refreshHeaderSubtitle();
    verificarDadosDesatualizados();
    return;
  }
  const folhas = DATA_T.filter((d) => d.is_folha);
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
  const totCorrigido = CORRECAO_INDICE === 'ipca' ? totIpca : totIncc;
  const indiceLabel = CORRECAO_INDICE.toUpperCase();
  const totAltLabel = CORRECAO_INDICE === 'ipca' ? 'INCC' : 'IPCA';
  const totAltVal = CORRECAO_INDICE === 'ipca' ? totIncc : totIpca;
  // Diferenças vs licitação
  const inflacaoAbs = totCorrigido - totLicit;
  const inflacaoPct = totLicit ? (inflacaoAbs / totLicit) * 100 : 0;
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
  // Calcular extrapolação dos Indiretos rodando uma "mini-projeção" rápida
  let totExtrapInd = 0;
  // v0.58b: usa PROJ_RAW filtrado pela obra ativa
  const _PROJ_VG = typeof getProjRawObraAtiva === 'function' ? getProjRawObraAtiva() : PROJ_RAW;
  if (Array.isArray(_PROJ_VG) && _PROJ_VG.length && typeof projetarServico === 'function') {
    const dataCorteVG = document.getElementById('projDataCorte')?.value || defaultDataCorte();
    const dataFimVG = document.getElementById('projDataFim')?.value || defaultDataFim();
    const janelaVG = parseInt(document.getElementById('projMetodo')?.value) || 6;
    const porServVG = {};
    _PROJ_VG.forEach((r) => {
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
  const tendIndiretos =
    totExtrapInd + flowsPend['Custos Indiretos'] + flowsPend['Projeção de Gastos'];
  const tendDiretos =
    flowsPend['Custos Diretos / Infraestrutura'] + flowsPend['Obras Civis'] + flowsPend['Outros'];
  const tendFinal = totGestao + tendIndiretos + tendDiretos;
  const tendVsLic = tendFinal - totLicit;
  const tendVsLicPct = totLicit ? (tendVsLic / totLicit) * 100 : 0;
  const tendBrutoCls =
    tendVsLicPct > 10 ? 'red' : tendVsLicPct > 5 ? 'amber' : tendVsLicPct > 0 ? 'amber' : 'green';

  // Reserva (Projeção de Gastos) - vem do saldo atual da aba Controle Projeção
  const insumoControlado =
    typeof PROJ_CTRL_STATE === 'object' && PROJ_CTRL_STATE && PROJ_CTRL_STATE.insumo
      ? PROJ_CTRL_STATE.insumo
      : 'I011890';
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
  const reservaPct = totLicit ? (reservaProj / totLicit) * 100 : 0;
  const tendFinalLiq = tendFinal - reservaProj;
  const tendVsLicLiq = tendVsLic - reservaProj;
  const tendVsLicLiqPct = totLicit ? (tendVsLicLiq / totLicit) * 100 : 0;
  const tendLiqCls =
    tendVsLicLiqPct > 10
      ? 'red'
      : tendVsLicLiqPct > 5
        ? 'amber'
        : tendVsLicLiqPct > 0
          ? 'amber'
          : 'green';

  // Decomposição do Fluxo Atual
  const desvioBruto = totDiff; // gestao - licit
  // Aditivos refletidos = "rastreado" (do que conseguimos atribuir a um aditivo)
  // Usa totAumentoReal (já calculado acima) somado às outras categorias rastreadas
  const aditivoRastreado =
    (tipoSum.aumento_real || 0) + (tipoSum.economia || 0) + (tipoSum.remanejamento || 0);
  // Resto = parte do desvio que não tem aditivo refletido → atualização orçamentária/tendência não rastreada
  const restoNaoRastreado = desvioBruto - inflacaoAbs - aditivoRastreado;

  const kpiBrutoCls = desvioBrutoPct > 5 ? 'red' : desvioBrutoPct > 0 ? 'amber' : 'green';
  // Toggle INCC/IPCA
  const toggleHtml = `
    <div class="toggle-group" style="margin-top:8px;">
      <button type="button" data-click-action="setCorrecaoIndice" data-action-mode="arg" data-action-arg="incc" class="toggle-btn ${CORRECAO_INDICE === 'incc' ? 'active' : ''}">INCC</button>
      <button type="button" data-click-action="setCorrecaoIndice" data-action-mode="arg" data-action-arg="ipca" class="toggle-btn ${CORRECAO_INDICE === 'ipca' ? 'active' : ''}">IPCA</button>
    </div>
  `;

  // Helper: linha de breakdown dentro do card
  const bdLine = (label, valor, cor, hint) => `
    <div style="display:flex; justify-content:space-between; align-items:baseline; padding:3px 0; font-size:11.5px;">
      <span style="color:var(--text-soft);">${label}${hint ? ` <span style="font-size:10px; color:var(--text-lighter);">(${hint})</span>` : ''}</span>
      <strong style="color:${cor || 'var(--text-strong)'};">${valor}</strong>
    </div>
  `;

  replaceWithParsedMarkup(
    document.getElementById('kpis'),
    `
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
      ${bdLine('💱 Inflação ' + indiceLabel, (inflacaoAbs >= 0 ? '+' : '') + fmtR$(inflacaoAbs), 'var(--accent-purple-dark)', 'externa, inevitável')}
      ${bdLine('📎 Aditivos refletidos', (aditivoRastreado >= 0 ? '+' : '') + fmtR$(aditivoRastreado), 'var(--sem-alerta)', 'rastreado em Flows')}
      ${bdLine('❓ Não rastreado', (restoNaoRastreado >= 0 ? '+' : '') + fmtR$(restoNaoRastreado), restoNaoRastreado > 0 ? 'var(--sem-erro)' : 'var(--sem-ok)', 'atualização de orçamento')}
      <div style="border-top:2px solid var(--border-strong); margin-top:8px; padding-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; padding:2px 0; font-size:13px;">
          <span style="color:var(--text-strong); font-weight:700;">🎯 Total · Desvio bruto <span style="color:var(--text-soft); font-weight:600;">(${fmtPct(desvioBrutoPct)})</span></span>
          <strong style="color:${desvioBruto > 0 ? 'var(--sem-erro)' : desvioBruto < 0 ? 'var(--sem-ok)' : 'var(--text-soft)'}; font-size:14px;">${desvioBruto >= 0 ? '+' : ''}${fmtR$(desvioBruto)}</strong>
        </div>
      </div>
    </div>

    <!-- Card 3 — Tendência projetada (versão compacta v0.43) -->
    <div class="kpi kpi-wide ${CARD3_MODO === 'liquido' ? tendLiqCls : tendBrutoCls}">
      <div class="label">🔮 Tendência Final Projetada</div>
      <div style="display:flex; align-items:baseline; justify-content:space-between; gap:10px; flex-wrap:wrap; margin:6px 0 8px;">
        <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
          <div style="font-size:24px; font-weight:700; color:var(--text-strong);">${fmtR$(CARD3_MODO === 'liquido' ? tendFinalLiq : tendFinal)}</div>
          <div style="font-size:12px; color:var(--text-soft);">${CARD3_MODO === 'liquido' ? 'descontando reserva (' + escHtml(insumoControlado) + ')' : 'gestão atual + tendências de obra'}</div>
        </div>
        <div class="toggle-group">
          <button type="button" data-click-action="setCard3Modo" data-action-mode="arg" data-action-arg="bruto" class="toggle-btn ${CARD3_MODO === 'bruto' ? 'active' : ''}">Bruto</button>
          <button type="button" data-click-action="setCard3Modo" data-action-mode="arg" data-action-arg="liquido" class="toggle-btn ${CARD3_MODO === 'liquido' ? 'active' : ''}">Líquido</button>
        </div>
      </div>
      ${bdLine('🎯 Total · Desvio bruto (' + fmtPct(desvioBrutoPct) + ')', (desvioBruto >= 0 ? '+' : '') + fmtR$(desvioBruto), desvioBruto > 0 ? 'var(--sem-erro)' : desvioBruto < 0 ? 'var(--sem-ok)' : 'var(--text-soft)', 'gestão atual vs licitação')}
      ${bdLine('🏗️ Tend. Indiretos', (tendIndiretos >= 0 ? '+' : '') + fmtR$(tendIndiretos), 'var(--accent-purple-dark)', 'extrapolação + flows pendentes')}
      ${bdLine('🧱 Tend. Diretos', (tendDiretos >= 0 ? '+' : '') + fmtR$(tendDiretos), 'var(--sem-alerta)', 'flows pendentes em Diretos/Civis')}
      <div style="border-top:2px solid var(--border-strong); margin-top:8px; padding-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; padding:2px 0; font-size:13px;">
          <span style="color:var(--text-strong); font-weight:700;">📈 Δ vs Licitação <span style="color:var(--text-soft); font-weight:600;">(${fmtPct(tendVsLicPct)})</span></span>
          <strong style="color:${tendVsLic > 0 ? 'var(--sem-erro)' : tendVsLic < 0 ? 'var(--sem-ok)' : 'var(--text-soft)'}; font-size:14px;">${tendVsLic >= 0 ? '+' : ''}${fmtR$(tendVsLic)}</strong>
        </div>
        ${
          reservaProj > 0
            ? `
        <div style="display:flex; justify-content:space-between; align-items:baseline; padding:2px 0; font-size:11.5px; color:var(--text-soft);">
          <span>Reserva ${escHtml(insumoControlado)} (${fmtPct(reservaPct)} sobre licit.)</span>
          <span>−${fmtR$(reservaProj)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:baseline; padding:2px 0; font-size:13px;">
          <span style="color:var(--text-strong); font-weight:700;">💧 Δ vs Licitação (Líquido)</span>
          <strong style="color:${tendVsLicLiq > 0 ? 'var(--sem-erro)' : tendVsLicLiq < 0 ? 'var(--sem-ok)' : 'var(--text-soft)'}; font-size:14px;">${tendVsLicLiq >= 0 ? '+' : ''}${fmtR$(tendVsLicLiq)}</strong>
        </div>`
            : ''
        }
      </div>
    </div>

    <!-- Card 4 (v0.55) — Aderência Físico-Financeira (Prevision) -->
    ${renderCardAderencia()}
  `,
  );

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
        const barColor =
          st === 'red'
            ? 'var(--fgr-red-vivid)'
            : st === 'amber'
              ? 'var(--sem-alerta)'
              : st === 'green'
                ? 'var(--sem-ok)'
                : 'var(--text-lighter)';
        const barWidth = Math.min(100, Math.abs(pct || 0) * 5);
        const aditInfo =
          Math.abs(v.aditivos) > 0.01
            ? ` · <span style="color:var(--accent-purple);">📎 ${fmtR$k(v.aditivos)} em aditivos</span>`
            : '';
        return `
      <div class="grupo-row">
        <div class="grupo-nome"><span class="dot ${st}"></span>${escHtml(g)}<span style="font-weight:400;color:var(--text-soft);font-size:11px;">(${v.n})${aditInfo}</span></div>
        <div style="font-size:11px;color:var(--text-soft);">${fmtR$k(v.licit)} → ${fmtR$k(v.gestao)}</div>
        <div class="${diff <= 0 ? 'pos' : 'neg'}" style="font-weight:700;font-size:13px;">${pct != null ? fmtPct(pct) : 'novo'}</div>
        <div class="grupo-bar"><div class="grupo-bar-fill" style="width:${barWidth}%;background:${barColor};"></div></div>
      </div>`;
      })
      .join(''),
  );

  renderDonut(tipoSum);

  // Top 10 dividido em aumentos e reduções
  const todasFolhas = folhas
    .filter((d) => d.licitacao != null && d.gestao != null)
    .map((d) => ({ ...d, delta: d.gestao - d.licitacao }));
  const ups = todasFolhas
    .filter((d) => d.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 10);
  const downs = todasFolhas
    .filter((d) => d.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 10);

  const renderTopList = (arr, isUp, containerId) => {
    if (!arr.length) {
      replaceWithParsedMarkup(
        document.getElementById(containerId),
        '<div style="color:var(--text-lighter); text-align:center; padding:20px; font-size:12px;">Nenhum item nessa categoria.</div>',
      );
      return;
    }

    const barColor = isUp ? resolveColor('var(--fgr-red-vivid)') : resolveColor('var(--sem-ok)');
    const categories = arr.map((d) => (d.item.length > 35 ? d.item.slice(0, 32) + '...' : d.item));
    const seriesData = arr.map((d) => Math.abs(d.delta));

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
        },
      },
      xaxis: {
        categories: categories,
        labels: { formatter: (val) => fmtR$k(val), style: { fontSize: '10px' } },
      },
      yaxis: {
        labels: { style: { fontSize: '11px', colors: resolveColor('var(--text-medium)') } },
      },
      tooltip: {
        enabled: true,
        theme: document.body.classList.contains('dark') ? 'dark' : 'light',
        y: { formatter: (val) => fmtR$(val) },
      },
      dataLabels: {
        enabled: true,
        formatter: (val) => fmtR$k(val),
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
    if (_apexCharts['donutChart']) {
      _apexCharts['donutChart'].destroy();
      delete _apexCharts['donutChart'];
    }
    replaceWithParsedMarkup(
      document.getElementById('donutChart'),
      '<div style="text-align:center; color:var(--text-lighter); padding:80px 20px; font-size:13px;">Sem aditivos para exibir.</div>',
    );
    return;
  }

  const allSegs = [
    { key: 'aum', v: aum, lbl: 'Aumento real', icon: '🔴' },
    { key: 'rem', v: rem, lbl: 'ReManejamento', icon: '🔵' },
    { key: 'eco', v: eco, lbl: 'Economia', icon: '🟢' },
    { key: 'pen', v: pen, lbl: 'Pendente', icon: '🟡' },
    { key: 'sem', v: sem, lbl: 'Sem class.', icon: '⚪' },
  ];

  const visibleSegs = allSegs.filter((s) => s.v > 0 && !donutHidden.has(s.key));
  const series = visibleSegs.map((s) => s.v);
  const labels = visibleSegs.map((s) => s.icon + ' ' + s.lbl);
  const colorMap = {
    aum: resolveColor('var(--fgr-red-vivid)'),
    rem: resolveColor('var(--text-medium)'),
    eco: resolveColor('var(--sem-ok)'),
    pen: resolveColor('var(--sem-alerta)'),
    sem: resolveColor('var(--text-lighter)'),
  };
  const colors = visibleSegs.map((s) => colorMap[s.key]);

  const options = {
    series: series,
    chart: {
      type: 'donut',
      height: 320,
      animations: { enabled: true, easing: 'easeinout', speed: 600 },
      toolbar: { show: true, tools: { download: true, selection: false, zoom: false, pan: false } },
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
              formatter: function (w) {
                const sum = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                return fmtR$k(sum);
              },
            },
            value: {
              formatter: function (val) {
                return fmtR$(parseFloat(val));
              },
            },
          },
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
      show: true,
      position: 'bottom',
      fontSize: '12px',
      labels: { colors: resolveColor('var(--text-medium)') },
      itemMargin: { horizontal: 8, vertical: 4 },
    },
    stroke: { width: 2, colors: [resolveColor('var(--bg-card)')] },
    dataLabels: {
      enabled: true,
      formatter: function (val) {
        return val.toFixed(1) + '%';
      },
      style: { fontSize: '11px' },
      dropShadow: { enabled: false },
    },
    responsive: [
      { breakpoint: 480, options: { chart: { height: 260 }, legend: { position: 'bottom' } } },
    ],
  };

  renderApexChart('donutChart', options);
}

export function installLegacyOverviewView(
  { runtime, storage, viewStates, dashboardRepository },
  target = window,
) {
  reportNonFatalError = runtime.reportNonFatalError;
  runAsyncSafely = runtime.runAsyncSafely;
  resolveColor = runtime.resolveColor;
  renderApexChart = runtime.renderApexChart;
  getProjRawObraAtiva = runtime.getActiveProjection;
  getFlowsObraAtiva = runtime.getActiveFlows;
  SafeStorage = storage;
  renderDashboardState = viewStates.render;
  supaSaveDashboardKey = dashboardRepository.saveDashboardKey;
  Object.assign(target, {
    renderAderenciaProj,
    irParaAba,
    obraTemTendencia,
    renderVisao,
    toggleDonutSlice,
  });
  return Object.freeze({ setCard3Modo, setCorrecaoIndice });
}
