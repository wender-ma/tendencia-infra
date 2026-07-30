#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/ui/views/projection.mjs'),
  );
  const { buildMonthRange, distributeServiceProjection, projetarServico } = await import(
    moduleUrl.href
  );

  const serviceMonths = {
    '2026-01': 100,
    '2026-02': 100,
    '2027-01': 900,
  };
  const service = projetarServico('S05765', serviceMonths, '2026-03', '2026-04', 2);
  assert.strictEqual(service.realizado, 200, 'Realizado deveria respeitar a data final');
  assert.strictEqual(service.planejado_total, 200, 'Planejamento posterior ao término entrou no total');
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

  console.log('Cálculo da projeção: 10 cenários de reconciliação e periodicidade OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
