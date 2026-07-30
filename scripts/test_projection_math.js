#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../assets/js/ui/views/projection.mjs'));
  const { buildMonthRange, buildProjectionCurve, distributeServiceProjection, projetarServico } =
    await import(moduleUrl.href);

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

  console.log('Cálculo da projeção: reconciliação, periodicidade e Curva S mensal OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
