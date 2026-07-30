#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../assets/js/ui/views/projection.mjs'));
  const {
    buildMonthRange,
    buildProjectionCurve,
    buildProjectionCurveDisplaySeries,
    buildProjectionDifferenceBreakdown,
    buildProjectionDifferenceFlowDetails,
    buildProjectionMonthlyTableModel,
    distributeServiceProjection,
    projetarServico,
  } = await import(moduleUrl.href);

  const serviceMonths = {
    '2026-01': 100,
    '2026-02': 100,
    '2027-01': 900,
  };
  const service = projetarServico('S05765', serviceMonths, '2026-03', '2026-04', 2);
  assert.strictEqual(service.realizado, 200, 'Realizado deveria respeitar a data final');
  assert.strictEqual(
    service.planejado_total,
    200,
    'Planejamento posterior ao término entrou no total',
  );
  assert.strictEqual(service.ultimo_mes_planejado, '2026-02');
  assert.strictEqual(service.meses_gap, 2);
  assert.strictEqual(service.extrapolacao, 200);

  const inputA = projetarServico(
    'S05765',
    { '2026-01': 60, '2026-02': 60 },
    '2026-03',
    '2026-04',
    2,
  );
  const inputB = projetarServico(
    'S05765',
    { '2026-01': 40, '2026-02': 40 },
    '2026-03',
    '2026-04',
    2,
  );
  const distributed = distributeServiceProjection(
    [service],
    [
      { ...inputA, insumo: 'A' },
      { ...inputB, insumo: 'B' },
    ],
  );
  const distributedTotal = distributed.reduce(
    (sum, projection) => sum + projection.extrapolacao,
    0,
  );
  assert.strictEqual(distributedTotal, service.extrapolacao);
  assert.deepStrictEqual(
    distributed.map((projection) => projection.extrapolacao),
    [120, 80],
  );

  const monthlyModel = buildProjectionMonthlyTableModel({
    projections: distributed,
    flows: [
      {
        dep: 'Em andamento',
        refletido_status: 'pendente',
        custo_flowmaster: 25,
        insumo_planejamento: 'A',
        n_alteracao: 'FLOW-PENDENTE',
        descricao: 'Acréscimo futuro',
      },
      {
        dep: 'Finalizado',
        refletido_status: 'sim',
        refletido_mes: '2026-03-01',
        custo_flowmaster: 30,
        insumo_planejamento: 'A',
        n_alteracao: 'FLOW-REFLETIDO',
        descricao: 'Já incorporado',
      },
      {
        dep: 'Em andamento',
        refletido_status: 'pendente',
        custo_flowmaster: -5,
        insumo_planejamento: '',
        n_alteracao: 'FLOW-SEM-INSUMO',
        descricao: 'Economia sem classificação',
      },
    ],
    dataCorte: '2026-03',
    dataFim: '2026-04',
    hierarchy: [
      { ordem: 0, cod: '1', item: 'RAIZ', tipo: 'raiz', nivel: 1 },
      { ordem: 1, cod: '01.01', item: 'INDIRETOS', tipo: 'grupo', nivel: 2 },
      {
        ordem: 2,
        cod: '01.01.01',
        cod_servico: 'S05765',
        item: 'SERVIÇO',
        tipo: 'servico',
        nivel: 3,
      },
      {
        ordem: 3,
        cod: '01.01.01',
        cod_servico: 'S05765',
        cod_insumo: 'A',
        item: 'INSUMO A',
        tipo: 'insumo',
        nivel: 4,
      },
      {
        ordem: 4,
        cod: '01.01.01',
        cod_servico: 'S05765',
        cod_insumo: 'B',
        item: 'INSUMO B',
        tipo: 'insumo',
        nivel: 4,
      },
    ],
  });
  assert.deepStrictEqual(monthlyModel.months, ['2026-03', '2026-04']);
  assert.strictEqual(monthlyModel.root.metrics.planned, 200);
  assert.strictEqual(monthlyModel.root.metrics.realized, 200);
  assert.strictEqual(monthlyModel.root.metrics.extrapolation, 200);
  assert.strictEqual(monthlyModel.root.metrics.pendingFlows, 20);
  assert.strictEqual(monthlyModel.root.metrics.tendency, 420);
  assert.strictEqual(monthlyModel.root.monthly['2026-03'].total, 120);
  assert.strictEqual(monthlyModel.root.monthly['2026-04'].total, 100);
  const inputAMonth = monthlyModel.nodes.find((node) => node.cod_insumo === 'A').monthly[
    '2026-03'
  ];
  assert.strictEqual(inputAMonth.extrapolation, 60);
  assert.strictEqual(inputAMonth.pendingFlows, 25);
  assert.strictEqual(inputAMonth.reflectedFlowItems.length, 1);
  assert.strictEqual(
    inputAMonth.total,
    85,
    'Flow refletido não pode ser somado novamente ao mês',
  );
  const unclassified = monthlyModel.nodes.find((node) => node.isFlowOnly);
  assert.strictEqual(unclassified.item, 'Sem insumo classificado');
  assert.strictEqual(unclassified.monthly['2026-03'].pendingFlows, -5);

  assert.deepStrictEqual(buildMonthRange('2026-01', '2026-04'), [
    '2026-01',
    '2026-02',
    '2026-03',
    '2026-04',
  ]);
  assert.deepStrictEqual(buildMonthRange('2026-04', '2026-01'), []);

  const curve = buildProjectionCurve(
    { '2026-01': 100, '2026-03': 200 },
    [{ extrapolacao: 60, ultimo_mes_planejado: '2026-03', meses_gap: 2 }],
    '2026-02',
    '2026-05',
    40,
  );
  assert.deepStrictEqual(curve.months, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']);
  assert.deepStrictEqual(
    curve.planned,
    [100, 100, 300, 300, 300],
    'Mês sem movimento deveria formar trecho plano',
  );
  assert.deepStrictEqual(
    curve.tendency,
    [null, 140, 340, 370, 400],
    'Tendência deveria começar no corte, incluir Flow e reconciliar o total final',
  );

  const longMonths = buildMonthRange('2015-01', '2028-04');
  const longCurve = {
    months: longMonths,
    planned: longMonths.map((_month, index) => index + 1),
    tendency: longMonths.map((_month, index) => index + 101),
  };
  const displayCurve = buildProjectionCurveDisplaySeries(longCurve, '2028-04', ['2026-07']);
  assert.strictEqual(displayCurve.monthlyStart, '2023-04');
  assert.strictEqual(displayCurve.condensed, true);
  assert.strictEqual(displayCurve.months[0], '2015-01');
  assert(displayCurve.months.includes('2015-12'), 'Deveria preservar o fechamento de 2015');
  assert(displayCurve.months.includes('2023-03'), 'Deveria preservar o mês de transição');
  assert(displayCurve.months.includes('2023-04'), 'A janela mensal deveria começar em abr/2023');
  assert(displayCurve.months.includes('2026-07'), 'O mês de corte deveria estar disponível');
  assert.strictEqual(displayCurve.months.at(-1), '2028-04');
  assert.strictEqual(displayCurve.planned.at(-1), longCurve.planned.at(-1));
  assert.strictEqual(displayCurve.tendency.at(-1), longCurve.tendency.at(-1));
  const oldYearCounts = displayCurve.months
    .filter((month) => month < '2023-04' && month !== '2015-01')
    .reduce((counts, month) => {
      counts[month.slice(0, 4)] = (counts[month.slice(0, 4)] || 0) + 1;
      return counts;
    }, {});
  assert(Object.values(oldYearCounts).every((count) => count === 1));

  const shortCurve = buildProjectionCurveDisplaySeries(curve, '2026-05', ['2026-02']);
  assert.strictEqual(shortCurve.condensed, false);
  assert.deepStrictEqual(shortCurve.months, curve.months);

  const breakdown = buildProjectionDifferenceBreakdown({
    projections: [
      {
        servico: 'S1',
        insumo: 'I1',
        extrapolacao: 60,
        ultimo_mes_planejado: '2026-03',
        meses_gap: 2,
      },
      {
        servico: 'S2',
        insumo: 'I2',
        extrapolacao: 40,
        ultimo_mes_planejado: '2026-03',
        meses_gap: 2,
      },
    ],
    pendingFlows: [
      {
        dep: 'Em andamento',
        refletido_status: 'pendente',
        custo_flowmaster: 10,
        insumo_planejamento: 'I1',
        n_alteracao: 'FLOW-10',
        descricao: 'Aumento de escopo',
      },
      {
        dep: 'Em andamento',
        refletido_status: 'pendente',
        custo_flowmaster: -5,
        insumo_planejamento: '',
        n_alteracao: 'FLOW-5',
        motivo: 'Economia contratual',
      },
      {
        dep: 'Cancelado',
        refletido_status: 'pendente',
        custo_flowmaster: 999,
        insumo_planejamento: 'I1',
      },
      {
        dep: 'Em andamento',
        refletido_status: 'sim',
        custo_flowmaster: 999,
        insumo_planejamento: 'I1',
      },
    ],
    selectedMonth: '2026-04',
    trendStart: '2026-02',
    dataFim: '2026-05',
    targetDifference: 55,
  });
  assert.strictEqual(breakdown.available, true);
  assert.strictEqual(breakdown.total, 55);
  assert.deepStrictEqual(
    breakdown.rows.map((row) => [row.insumo, row.extrapolacao, row.flows, row.total]),
    [
      ['I1', 30, 10, 40],
      ['I2', 20, 0, 20],
      ['__unclassified__', 0, -5, -5],
    ],
    'Composição mensal não reconciliou extrapolação e Flows por insumo',
  );
  const flowDetails = buildProjectionDifferenceFlowDetails({
    pendingFlows: [
      {
        dep: 'Em andamento',
        refletido_status: 'pendente',
        custo_flowmaster: 10,
        insumo_planejamento: 'I1',
        n_alteracao: 'FLOW-10',
        descricao: 'Aumento de escopo',
      },
      {
        dep: 'Em andamento',
        refletido_status: 'pendente',
        custo_flowmaster: -5,
        insumo_planejamento: '',
        n_alteracao: 'FLOW-5',
        motivo: 'Economia contratual',
      },
      {
        dep: 'Cancelado',
        refletido_status: 'pendente',
        custo_flowmaster: 999,
        n_alteracao: 'FLOW-CANCELADO',
      },
      {
        dep: 'Em andamento',
        refletido_status: 'sim',
        custo_flowmaster: 999,
        n_alteracao: 'FLOW-REFLETIDO',
      },
    ],
    selectedMonth: '2026-04',
    trendStart: '2026-02',
  });
  assert.deepStrictEqual(flowDetails, [
    {
      numero: 'FLOW-10',
      descricao: 'Aumento de escopo',
      insumo: 'I1',
      valor: 10,
    },
    {
      numero: 'FLOW-5',
      descricao: 'Economia contratual',
      insumo: '__unclassified__',
      valor: -5,
    },
  ]);
  assert.deepStrictEqual(
    buildProjectionDifferenceFlowDetails({
      pendingFlows: [{ custo_flowmaster: 10 }],
      selectedMonth: '2026-01',
      trendStart: '2026-02',
    }),
    [],
    'Flows não deveriam aparecer antes do mês de corte',
  );

  const beforeCutoff = buildProjectionDifferenceBreakdown({
    selectedMonth: '2026-01',
    trendStart: '2026-02',
  });
  assert.strictEqual(beforeCutoff.available, false);

  const zeroBreakdown = buildProjectionDifferenceBreakdown({
    pendingFlows: [
      {
        refletido_status: 'pendente',
        custo_flowmaster: 10,
        insumo_planejamento: 'I1',
      },
      {
        refletido_status: 'pendente',
        custo_flowmaster: -10,
        insumo_planejamento: 'I1',
      },
    ],
    selectedMonth: '2026-02',
    trendStart: '2026-02',
    targetDifference: 0,
  });
  assert.strictEqual(zeroBreakdown.total, 0);
  assert.deepStrictEqual(zeroBreakdown.rows, []);

  console.log('Cálculo da projeção: reconciliação, periodicidade, Curva S e composição mensal OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
