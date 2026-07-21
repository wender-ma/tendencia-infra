/* eslint-disable no-undef */
import { replaceWithParsedMarkup } from '../dom.mjs';
import {
  formatCompactNumber as fmtR$k,
  formatNumber as fmt,
  formatNumber as fmtR$,
} from '../dashboard-runtime.mjs';

// ============ TENDÊNCIA DE OBRA (PROJEÇÃO) ============

// PROJ_RAW declarado na seção ESTADO GLOBAL acima

// Definir mês corrente (default)
function defaultDataCorte() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function defaultDataFim() {
  // último mês do CSV
  // v0.58b: usa dados da obra ativa
  const _p = typeof getProjRawObraAtiva === 'function' ? getProjRawObraAtiva() : PROJ_RAW;
  if (!_p.length) return defaultDataCorte();
  return _p
    .map((r) => r.mes)
    .sort()
    .slice(-1)[0];
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
  const dfInput = document.getElementById('projDataFim');
  if (!dfInput.value) dfInput.value = ultimo;
  const dcInput = document.getElementById('projDataCorte');
  if (!dcInput.value) dcInput.value = defaultDataCorte();
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
    const tendItem = (Array.isArray(DATA_T) ? DATA_T : []).find(
      (t) => t.is_folha && t.cod_insumo === insDest,
    );
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
  const realizado = Object.entries(meses)
    .filter(([m]) => m < dataCorte)
    .reduce((s, [, v]) => s + v, 0);
  const planejadoFuturo = Object.entries(meses)
    .filter(([m]) => m >= dataCorte)
    .reduce((s, [, v]) => s + v, 0);
  const planejadoTotal = realizado + planejadoFuturo;

  // Identificar último mês com planejamento real (valor > 0)
  const mesesComValor = Object.entries(meses)
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

function calcStatus(diff, planejado, tolerancia) {
  if (Math.abs(diff) <= tolerancia) return 'green';
  if (diff > 0 && planejado > 0 && diff <= planejado * 0.05) return 'amber';
  if (diff > 0) return 'red';
  return 'sobra';
}

function renderProjecao() {
  // v0.58b: filtra PROJ_RAW pela obra ativa
  const PROJ_OBRA = getProjRawObraAtiva();
  if (!PROJ_OBRA.length) {
    initProjecao();
    return;
  }
  const dataCorte = document.getElementById('projDataCorte').value || defaultDataCorte();
  const dataFim = document.getElementById('projDataFim').value || defaultDataFim();
  const janelaMeses = parseInt(document.getElementById('projMetodo').value) || 6;
  const tolerancia = parseFloat(document.getElementById('projTolerancia').value) || 0;

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
  const projInsumos = Object.values(porInsumo)
    .map((item) => projetarServico(item.servico, item.meses, dataCorte, dataFim, janelaMeses))
    .map((proj, idx) => {
      const item = Object.values(porInsumo)[idx];
      return { ...proj, insumo: item.insumo };
    });

  // Calcular totais por grupo (somando os serviços)
  const porGrupo = {};
  projServicos.forEach((p) => {
    if (!porGrupo[p.grupo])
      porGrupo[p.grupo] = {
        grupo: p.grupo,
        realizado: 0,
        planejado_total: 0,
        planejado_futuro: 0,
        extrapolacao: 0,
        tendencia: 0,
        diff: 0,
        servicos: [],
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
  const pctExecutado = totPlanejado ? (totRealizado / totPlanejado) * 100 : 0;
  const diffCls = totDiff > tolerancia ? 'red' : totDiff < -tolerancia ? 'green' : '';
  const diffLabel =
    totDiff > tolerancia
      ? 'Vai precisar planejar mais'
      : totDiff < -tolerancia
        ? 'Vai sobrar verba'
        : 'No esperado';

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

  replaceWithParsedMarkup(
    document.getElementById('projKpis'),
    [
      uiCriarKpi({
        titulo: `Realizado (até ${formatMonthLabel(dataCorte)})`,
        valor: fmtR$(totRealizado),
        subtitulo: `${pctExecutado.toFixed(1)}% do planejado total`,
      }),
      uiCriarKpi({
        titulo: 'Planejado Total (CSV)',
        valor: fmtR$(totPlanejado),
        subtitulo: 'passado + futuro planejado',
      }),
      uiCriarKpi({
        titulo: 'Tend. Indiretos',
        valor: fmtR$(totIndiretosTend),
        subtitulo: `obra estendida ${fmtR$k(totExtrap)} + flows pendentes ${fmtR$k(flowsPendInd)}`,
        cor: 'purple',
        icon: '🏗️',
      }),
      uiCriarKpi({
        titulo: 'Tend. Diretos',
        valor: fmtR$(totDiretosTend),
        subtitulo: `${fmtR$(totDiretosTend)} em flows pendentes (Diretos/Civis)`,
        cor: 'amber',
        icon: '🧱',
      }),
      uiCriarKpi({
        titulo: 'Tendência Total',
        valor: fmtR$(totTendencia),
        subtitulo: `${diffLabel} (${totDiff >= 0 ? '+' : ''}${fmtR$(totDiff)})`,
        cor: diffCls,
        icon: '🔮',
      }),
    ].join(''),
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
  renderProjTable(porGrupo, projServicos, projInsumos, tolerancia);
}

function renderProjChartGeral(porServico, projServicos, dataCorte, dataFim) {
  // Acumular planejado total mês a mês
  const totalMeses = {};
  Object.values(porServico).forEach((meses) => {
    Object.entries(meses).forEach(([m, v]) => {
      totalMeses[m] = (totalMeses[m] || 0) + v;
    });
  });
  const todosMeses = Object.keys(totalMeses).sort();
  if (!todosMeses.length) {
    document.getElementById('projChart').replaceChildren();
    return;
  }

  // Estender meses até dataFim se necessário
  const extended = [...todosMeses];
  const ultimoMes = todosMeses[todosMeses.length - 1];
  if (dataFim > ultimoMes) {
    let m = ultimoMes;
    while (m < dataFim) {
      m = addMonths(m, 1);
      extended.push(m);
      if (!(m in totalMeses)) totalMeses[m] = 0;
    }
  }
  extended.sort();

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
        },
      },
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
          borderColor: resolveColor('var(--text-soft)'),
          strokeDashArray: 2,
          label: {
            text: 'Fim: ' + formatMonthLabel(dataFim),
            style: {
              color: resolveColor('var(--text-on-dark)'),
              background: resolveColor('var(--text-soft)'),
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
      y: { formatter: (val) => fmtR$(val) },
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
  // pegar todos os insumos desse serviço a partir do PROJ_RAW
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
  const cor = liquido > 0 ? 'var(--sem-erro)' : liquido < 0 ? 'var(--sem-ok)' : 'var(--text-soft)';
  return `<span style="display:inline-block; padding:1px 6px; margin-left:6px; background:var(--accent-purple-bg); color:var(--accent-purple-dark); border-radius:10px; font-size:10px; font-weight:600; cursor:help;" title="✅ ${info.total} flow(s) refletidos em planejamento · ${info.entrada} entrada(s) (+${fmt(info.valEntrada)}) · ${info.saida} saída(s) (-${fmt(info.valSaida)})">📎 ${info.total} flow${info.total > 1 ? 's' : ''} <span style="color:${cor};">${liquido >= 0 ? '+' : ''}${fmtR$k(liquido)}</span></span>`;
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
        .filter((it) => it.codigo_obra === OBRA_ATIVA)
        .forEach((it) => {
          if (!it.insumo) return;
          const chaveComp =
            (it.servico || '') + '|' + (it.insumo || '') + '|' + (it.item_cod || '');
          mapaValorGestao[chaveComp] =
            (mapaValorGestao[chaveComp] || 0) + (it[_ultGestaoLabel] || 0);
        });
    }
  }

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
  projServicos.forEach((p) => {
    idxServ[p.servico] = p;
  });
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
    getFlowsObraAtiva().forEach((f) => {
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
      // injetar Valor Gestão do HISTORICO por chave composta
      const _servCod = getServicoCod(idx);
      const _chaveVG = (_servCod || '') + '|' + (n.cod_insumo || '') + '|' + (n.cod || '');
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
      n.proj.empty =
        n.proj.planejado_total === 0 &&
        n.proj.realizado === 0 &&
        Math.abs(flowsPend) < 0.01 &&
        (n.proj.valor_gestao || 0) === 0;
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
      valor_gestao: 0,
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
        leftValue = (left.proj?.valor_gestao || 0) + (left.proj?.extrapolacao || 0);
        rightValue = (right.proj?.valor_gestao || 0) + (right.proj?.extrapolacao || 0);
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
    const indent = level * 18;
    const dV = p.diff || 0;
    const ex = p.extrapolacao || 0;
    // Estilos por tipo
    let trStyle = '',
      icon = '',
      labelHtml = '';
    if (n.tipo === 'raiz') {
      trStyle =
        'background:var(--surface-inverse); color:var(--text-on-dark); cursor:pointer; font-weight:700;';
      icon = expanded ? '▼' : '▶';
      labelHtml = `<strong>${escHtml(n.cod)} · ${escHtml(n.item)}</strong>`;
    } else if (n.tipo === 'grupo') {
      trStyle =
        'background:var(--fgr-red-deep); color:var(--text-on-dark); cursor:pointer; font-weight:700;';
      icon = expanded ? '▼' : '▶';
      labelHtml = `<strong>${escHtml(n.cod)} · ${escHtml(n.item)}</strong>`;
    } else if (n.tipo === 'subgrupo') {
      trStyle =
        'background:var(--fgr-red-light); cursor:pointer; font-weight:600; color:var(--fgr-red-deep);';
      icon = expanded ? '▼' : '▶';
      labelHtml = `${escHtml(n.cod)} · ${escHtml(n.item)}`;
    } else if (n.tipo === 'servico' || n.tipo === 'outro') {
      trStyle = 'background:var(--fgr-red-light); cursor:pointer; color:var(--fgr-red-deep);';
      icon = expanded ? '▼' : hasChildren ? '▶' : '🔍';
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
    const acao = p.empty
      ? ''
      : dV > tolerancia
        ? `<span style="font-size:10.5px; color:var(--sem-erro); font-weight:600;">+${fmtR$k(dV)} a planejar</span>`
        : dV < -tolerancia
          ? `<span style="font-size:10.5px; color:var(--sem-ok);">sobram ${fmtR$k(-dV)}</span>`
          : '';

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
          ? `<span style="font-size:10px; color:${ex < 0 ? 'var(--sem-ok)' : 'var(--sem-alerta)'};" title="${escAttr(extrapTitle)}">${ex >= 0 ? '+' : ''}${fmt(ex)}${Math.abs(flowsPendVal) > 0.01 ? ' 📎' : ''}</span>`
          : `<span style="color:${isDark ? 'var(--badge-manual-bg)' : ex < 0 ? 'var(--sem-ok)' : 'var(--sem-alerta)'};">${ex >= 0 ? '+' : ''}${fmt(ex)}</span>`
        : `<span style="color:${isDark ? 'rgba(255,255,255,0.5)' : 'var(--text-lighter)'};">—</span>`;

    const valuesEmpty = p.empty;
    const fmtVal = (v) =>
      valuesEmpty ? '<span style="color:var(--border-strong);">—</span>' : fmtR$(v || 0);

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
      <td style="width:24px; padding-left:${4 + indent}px;">${icon}</td>
      <td style="padding-left:${10 + indent}px;">${labelHtml}</td>
      <td class="num">${vgEmpty ? '<span style="color:var(--border-strong);">—</span>' : fmtR$(_vg)}</td>
      <td class="num">${fmtVal(p.realizado)}</td>
      <td class="num">${extrapTxt}</td>
      <td class="num">${vgEmpty && Math.abs(p.extrapolacao || 0) < 0.01 ? '<span style="color:var(--border-strong);">—</span>' : '<strong>' + fmtR$(_tendUI) + '</strong>'}</td>
      <td>${statusBadge[st] || ''} ${acao}</td>
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
    const _proj = typeof getProjRawObraAtiva === 'function' ? getProjRawObraAtiva() : PROJ_RAW;
    if (!_proj || !_proj.length) {
      authToast(
        '⚠️ Não há dados de Projeção para exportar. Carregue o CSV de Gestões primeiro.',
        'warn',
        5000,
      );
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
    const projInsumos = Object.values(byServInsMes).map((x) => {
      const p = projetarServico(x.servico, x.meses, dataCorte, dataFim, janelaMeses);
      return { ...p, insumo: x.insumo };
    });
    const idxServ = {};
    projServicos.forEach((p) => (idxServ[p.servico] = p));
    const idxIns = {};
    projInsumos.forEach((p) => (idxIns[p.servico + '|' + p.insumo] = p));

    // Mapa Valor Gestão (mesma lógica da render)
    const mapaValorGestao = {};
    let ultGestao = null;
    if (HISTORICO && Array.isArray(HISTORICO.gestoes) && Array.isArray(HISTORICO.items)) {
      ultGestao = acharUltimaGestaoCronologica(HISTORICO.gestoes);
      if (ultGestao) {
        HISTORICO.items
          .filter((it) => it.codigo_obra === OBRA_ATIVA)
          .forEach((it) => {
            if (!it.insumo) return;
            const k = (it.servico || '') + '|' + (it.insumo || '') + '|' + (it.item_cod || '');
            mapaValorGestao[k] = (mapaValorGestao[k] || 0) + (it[ultGestao] || 0);
          });
      }
    }

    // Flows pendentes por insumo (mesma lógica)
    function flowsPendInsumo(cod_insumo) {
      if (!cod_insumo || !Array.isArray(getFlowsObraAtiva())) return 0;
      let total = 0;
      getFlowsObraAtiva().forEach((f) => {
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
    function computeNode(idx) {
      const n = nodes[idx];
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
        const proj = idxIns[servCod + '|' + n.cod_insumo] || {
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
        const fp = flowsPendInsumo(n.cod_insumo);
        const vg =
          mapaValorGestao[(servCod || '') + '|' + (n.cod_insumo || '') + '|' + (n.cod || '')] || 0;
        n.proj = {
          ...proj,
          valor_gestao: vg,
          flows_pendentes: fp,
          extrapolacao: (proj.extrapolacao || 0) + fp,
          tendencia: (proj.planejado_total || 0) + (proj.extrapolacao || 0) + fp,
        };
        n.proj.empty =
          n.proj.planejado_total === 0 && n.proj.realizado === 0 && vg === 0 && Math.abs(fp) < 0.01;
        return n.proj;
      }
      const agg = {
        realizado: 0,
        planejado_total: 0,
        planejado_futuro: 0,
        extrapolacao: 0,
        tendencia: 0,
        diff: 0,
        valor_gestao: 0,
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
        agg.valor_gestao += sub.valor_gestao || 0;
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
      const tendUI = (p.valor_gestao || 0) + (p.extrapolacao || 0);
      linhas.push({
        Nível: nivel,
        Tipo: n.tipo,
        Código: n.cod || '',
        'Cod. Serviço': n.cod_servico || '',
        'Cod. Insumo': n.cod_insumo || '',
        Grupo: grupo,
        Descrição: prefixo + label,
        'Valor Gestão (R$)': Math.round((p.valor_gestao || 0) * 100) / 100,
        'Realizado (R$)': Math.round((p.realizado || 0) * 100) / 100,
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
      { Campo: 'Obra', Valor: OBRA_ATIVA || '' },
      { Campo: 'Última gestão (Valor Gestão)', Valor: ultGestao || '' },
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
    // Colunas H..P (índices 7..15) = Valor Gestão, Realizado, Planejado Total, Planejado Futuro,
    //   Extrapolação, Flows Pendentes, Tendência, Δ vs Planejado, Ritmo Histórico
    const FMT_NUM = '#,##0.00;-#,##0.00;"-"'; // SheetJS interpreta e converte pro locale do Excel do usuário
    const range1 = XLSX.utils.decode_range(ws1['!ref']);
    for (let R = range1.s.r + 1; R <= range1.e.r; R++) {
      // pula header
      for (let C = 7; C <= 15; C++) {
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

    const nomeArq = `projecao-detalhada_${OBRA_ATIVA || 'obra'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
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
  const meses = {};
  let titulo, subtitulo;
  if (insumo) {
    getProjRawObraAtiva()
      .filter((r) => r.servico === servico && r.insumo === insumo)
      .forEach((r) => {
        meses[r.mes] = (meses[r.mes] || 0) + r.valor;
      });
    titulo = `${servico} · ${insumo}`;
    subtitulo = descInsumo(insumo);
  } else {
    getProjRawObraAtiva()
      .filter((r) => r.servico === servico)
      .forEach((r) => {
        meses[r.mes] = (meses[r.mes] || 0) + r.valor;
      });
    titulo = servico;
    subtitulo = descServico(servico);
  }
  const proj = projetarServico(servico, meses, dataCorte, dataFim, janelaMeses);

  // Construir dados para ApexCharts
  const todosMeses = Object.keys(meses).sort();
  const extended = [...todosMeses];
  if (dataFim > (todosMeses[todosMeses.length - 1] || dataFim)) {
    let m = todosMeses[todosMeses.length - 1];
    while (m && m < dataFim) {
      m = addMonths(m, 1);
      extended.push(m);
    }
  }

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
      <div class="kpi kpi-wide ${proj.diff > 0 ? 'red' : proj.diff < 0 ? 'green' : ''}">
        <div class="label">🔮 Extrapolação</div>
        <div class="value">${proj.extrapolacao > 0 ? '+' + fmtR$(proj.extrapolacao) : '—'}</div>
        <div class="sub">${proj.meses_gap > 0 ? `${proj.meses_gap} meses × R$${fmt(proj.ritmo_historico, 0)}/m` : 'sem gap'}</div>
        <hr class="border-top-soft" style="margin:10px 0;">
        <div>
          <div class="section-label">Tendência Final</div>
          <div class="kpi-value-md" style="margin-top:4px;">${fmtR$(proj.tendencia)}</div>
          <div class="sub">Δ ${proj.diff >= 0 ? '+' : ''}${fmtR$(proj.diff)}</div>
        </div>
      </div>
    </div>
    <h3 style="font-size:13px; margin-bottom:8px;">📈 Curva S individual</h3>
    <div id="modalProjChart" style="height:300px;"></div>
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
          borderColor: resolveColor('var(--text-soft)'),
          strokeDashArray: 2,
          label: {
            text: 'Fim',
            orientation: 'vertical',
            position: 'bottom',
            offsetY: -10,
            style: {
              color: resolveColor('var(--text-on-dark)'),
              background: resolveColor('var(--text-soft)'),
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
      y: { formatter: (val) => fmtR$(val) },
    },
    legend: {
      show: true,
      position: 'top',
      fontSize: '11px',
      labels: { colors: resolveColor('var(--text-medium)') },
    },
    grid: { borderColor: resolveColor('var(--border)'), strokeDashArray: 3 },
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
  const insumoControlado = PROJ_CTRL_STATE.insumo || 'I011890';
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
  const movsManuais = (PROJ_CTRL_STATE.movimentacoes || []).filter((m) => {
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
      const dirColor = ehEntrada ? 'var(--sem-erro)' : 'var(--sem-ok)';
      const dirIcon = ehEntrada ? '➡️ entrada' : '⬅️ saída';
      const insumoAlvo = ehEntrada ? m.destino : m.origem;
      const valor = m.valor || 0;
      return `
      <div style="background:var(--bg-page); border-left:3px solid ${dirColor}; border-radius:6px; padding:10px 12px; margin-bottom:8px; font-size:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; gap:8px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <strong>${escHtml(m.id)}</strong>
            ${tipoBadge[m.tipo] || m.tipo}
            <span style="font-size:10.5px; color:var(--text-soft);">${escHtml(m.data_br || m.data || '')}</span>
            <span style="font-size:10.5px; color:${dirColor}; font-weight:700;">${dirIcon}</span>
            <span style="font-size:10.5px; color:var(--text-soft);"> · insumo ${escHtml(insumoAlvo)}</span>
            ${!insumo ? '' : ''}
          </div>
          <span style="font-weight:700; color:${ehEntrada ? 'var(--sem-erro)' : 'var(--sem-ok)'}; font-size:13px;">${ehEntrada ? '+' : '-'}${fmtR$(valor)}</span>
        </div>
        <div style="color:var(--text-medium); font-size:11.5px;">${escHtml(m.descricao || '')}</div>
        ${m.justificativa ? `<div style="color:var(--text-soft); font-size:10.5px; margin-top:3px;"><em>Justificativa:</em> ${escHtml(m.justificativa.slice(0, 180))}${m.justificativa.length > 180 ? '...' : ''}</div>` : ''}
        ${m.responsavel ? `<div style="color:var(--text-soft); font-size:10.5px; margin-top:2px;">Responsável: ${escHtml(m.responsavel)}</div>` : ''}
      </div>
    `;
    })
    .join('');

  return `
    <div style="margin-top:20px;">
      <h3 style="font-size:13px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
        💰 Movimentações da Verba de Projeção ${escHtml(insumoControlado)} <span style="font-size:11px; color:var(--text-soft); font-weight:400;">${movsManuais.length} movimentação(ões) manual(is)</span>
      </h3>
      <div style="background:var(--sem-alerta-bg); padding:10px 12px; border-radius:6px; margin-bottom:12px; font-size:12px; color:var(--sem-alerta); display:flex; gap:18px; flex-wrap:wrap;">
        <span><strong>${movsManuais.filter((m) => alvos.includes(m.destino)).length}</strong> entrada(s): <strong style="color:var(--sem-erro);">+${fmtR$(totEntrada)}</strong></span>
        <span><strong>${movsManuais.filter((m) => alvos.includes(m.origem)).length}</strong> saída(s): <strong style="color:var(--sem-ok);">-${fmtR$(totSaida)}</strong></span>
        <span>Líquido: <strong style="color:${liquido < 0 ? 'var(--sem-ok)' : 'var(--sem-erro)'};">${liquido >= 0 ? '+' : ''}${fmtR$(liquido)}</strong></span>
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
      <div style="margin-top:20px; padding:14px; background:var(--bg-page); border-radius:8px; text-align:center; color:var(--text-lighter); font-size:12px;">
        📎 Nenhum flow (refletido ou pendente) para este ${insumo ? 'insumo' : 'serviço'}.<br>
        <span style="font-size:11px;">Vá na aba "🔗 Flows / Aditivos" para classificar aditivos.</span>
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
    const dirColor = dir === 'entrada' ? 'var(--sem-erro)' : 'var(--sem-ok)';
    const valor = f.custo_flowmaster || 0;
    const insAlvoTxt = f._insumoAlvo
      ? `<span style="font-size:10.5px; color:var(--text-soft);"> · insumo ${escHtml(f._insumoAlvo)}</span>`
      : '';
    return `
      <div style="background:var(--bg-page); border-left:3px solid ${dirColor}; border-radius:6px; padding:10px 12px; margin-bottom:8px; font-size:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; gap:8px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <strong>Nº ${escHtml(f.n_alteracao)}</strong>
            ${f.is_manual ? '<span class="badge-manual">✋ Manual</span>' : ''}
            <span class="badge ${depBadge[f.dep] || 'gray'}">${escHtml(f.dep || '')}</span>
            ${tipoLabel[f.tipo] || ''}
            <span style="font-size:10.5px; color:var(--text-soft);">${escHtml(formatDate(f.data_br))}</span>
            <span style="font-size:10.5px; color:${dirColor}; font-weight:700;">${dirIcon}</span>
            ${insAlvoTxt}
          </div>
          <span style="font-weight:700; color:${valor < 0 ? 'var(--sem-ok)' : 'var(--sem-erro)'}; font-size:13px;">${valor >= 0 ? '+' : ''}${fmtR$(valor)}</span>
        </div>
        <div style="color:var(--text-medium); font-size:11.5px;"><strong>${escHtml(f.motivo || '')}</strong></div>
        <div style="color:var(--text-soft); font-size:11px; margin-top:3px;">${escHtml((f.descricao || '').slice(0, 220))}${(f.descricao || '').length > 220 ? '...' : ''}</div>
        ${f.justificativa ? `<div style="color:var(--text-soft); font-size:10.5px; margin-top:3px;"><em>Justificativa:</em> ${escHtml(f.justificativa.slice(0, 180))}${f.justificativa.length > 180 ? '...' : ''}</div>` : ''}
      </div>
    `;
  }

  function renderSecao(titulo, lista, corFundo, corTexto) {
    if (!lista.length) return '';
    const totE = lista
      .filter((f) => f._direcao === 'entrada')
      .reduce((s, f) => s + (f.custo_flowmaster || 0), 0);
    const totS = lista
      .filter((f) => f._direcao === 'saida')
      .reduce((s, f) => s + (f.custo_flowmaster || 0), 0);
    const liq = totE - totS;
    return `
      <div style="margin-top:20px;">
        <h3 style="font-size:13px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
          ${titulo} <span style="font-size:11px; color:var(--text-soft); font-weight:400;">${lista.length} aditivo(s)</span>
        </h3>
        <div style="background:${corFundo}; padding:10px 12px; border-radius:6px; margin-bottom:12px; font-size:12px; color:${corTexto}; display:flex; gap:18px; flex-wrap:wrap;">
          <span><strong>${lista.filter((f) => f._direcao === 'entrada').length}</strong> entrada(s): <strong style="color:var(--sem-erro);">+${fmtR$(totE)}</strong></span>
          <span><strong>${lista.filter((f) => f._direcao === 'saida').length}</strong> saída(s): <strong style="color:var(--sem-ok);">-${fmtR$(totS)}</strong></span>
          <span>Líquido: <strong style="color:${liq < 0 ? 'var(--sem-ok)' : 'var(--sem-erro)'};">${liq >= 0 ? '+' : ''}${fmtR$(liq)}</strong></span>
        </div>
        ${lista.map(renderCard).join('')}
      </div>
    `;
  }

  return `
    ${renderSecao('✅ Flows refletidos no planejamento', flowsRel, 'var(--accent-purple-bg)', 'var(--accent-purple-dark)')}
    ${renderSecao('⏳ Flows pendentes (ainda não refletidos) — entram como extrapolação', flowsPend, 'var(--sem-alerta-bg)', 'var(--sem-alerta)')}
  `;
}

export function installLegacyProjectionView(target = window) {
  Object.assign(target, {
    defaultDataCorte,
    defaultDataFim,
    initProjecao,
    calcularFlowsPendentesPorGrupo,
    projetarServico,
    renderProjecao,
    toggleProjExpand,
    projExpandAll,
    projCollapseAll,
    exportarProjecaoDetalhada,
    openProjDrill,
  });

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
    const handler = () => {
      try {
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
}
