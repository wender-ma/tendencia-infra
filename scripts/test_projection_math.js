#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../assets/js/ui/views/projection.mjs'));
  const {
    buildMonthRange,
    buildProjectionCurve,
    buildProjectionDifferenceBreakdown,
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
      },
      {
        dep: 'Em andamento',
        refletido_status: 'pendente',
        custo_flowmaster: -5,
        insumo_planejamento: '',
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
