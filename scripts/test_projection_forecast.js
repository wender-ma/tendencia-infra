#!/usr/bin/env node

const assert = require('node:assert/strict');

(async () => {
  const { buildPhysicalForecastContext, buildHybridInputForecast, normalizeInputForecastConfig } =
    await import('../assets/js/services/projection-forecast.mjs');
  const schedule = {
    cutoffMonth: '2026-07',
    curve: [
      { month: '2026-01', base: 8, planned: 8, actual: 6 },
      { month: '2026-02', base: 16, planned: 16, actual: 12 },
      { month: '2026-03', base: 24, planned: 24, actual: 18 },
      { month: '2026-04', base: 34, planned: 34, actual: 25 },
      { month: '2026-05', base: 46, planned: 46, actual: 33 },
      { month: '2026-06', base: 60, planned: 60, actual: 42 },
      { month: '2026-07', base: 72, planned: 72, actual: 50 },
      { month: '2026-08', base: 84, planned: 84, actual: 50 },
      { month: '2026-09', base: 94, planned: 94, actual: 50 },
      { month: '2026-10', base: 100, planned: 100, actual: 50 },
    ],
  };
  const physical = buildPhysicalForecastContext({
    schedule,
    officialEvolution: 31,
    dataCorte: '2026-08',
    dataFim: '2026-10',
  });
  assert.equal(physical.officialEvolution, 31);
  assert.equal(physical.plannedByMonth['2026-10'], 100);

  const monthlyValues = {
    '2026-01': 100,
    '2026-02': 100,
    '2026-03': 100,
    '2026-04': 100,
    '2026-05': 100,
    '2026-06': 100,
    '2026-07': 1000,
  };
  const fixed = buildHybridInputForecast({
    monthlyValues,
    dataCorte: '2026-08',
    dataFim: '2026-10',
    group: 'Custos Indiretos',
    physicalContext: physical,
    override: { method: 'fixed', sampleMonths: 12 },
  });
  assert.equal(fixed.available, true);
  assert.equal(fixed.selectedMethod, 'fixed');
  assert.equal(fixed.runRate, 100, 'mediana robusta nao deve ser inflada pelo pico');
  assert.equal(fixed.extrapolation, 300);
  assert.deepEqual(fixed.details.outliers, [{ month: '2026-07', value: 1000 }]);

  const physicalMethod = buildHybridInputForecast({
    monthlyValues: Object.fromEntries(
      Object.keys(monthlyValues).map((month) => [month, month === '2026-07' ? 120 : 100]),
    ),
    dataCorte: '2026-08',
    dataFim: '2026-10',
    group: 'Custos Indiretos',
    physicalContext: physical,
    override: { method: 'physical', sampleMonths: 12 },
  });
  assert.equal(physicalMethod.selectedMethod, 'physical');
  assert.ok(physicalMethod.extrapolationByMonth['2026-08'] > 0);
  assert.ok(
    physicalMethod.extrapolationByMonth['2026-08'] > physicalMethod.extrapolationByMonth['2026-10'],
    'queda do avanco fisico deve reduzir a projecao',
  );

  const mixed = buildHybridInputForecast({
    monthlyValues,
    dataCorte: '2026-08',
    dataFim: '2026-10',
    group: 'Custos Indiretos',
    physicalContext: physical,
    override: { method: 'mixed', sampleMonths: 12, fixedShare: 70 },
  });
  assert.equal(mixed.selectedMethod, 'mixed');
  assert.ok(mixed.extrapolationByMonth['2026-10'] >= 70);
  assert.ok(mixed.details.fixedMonthly === 70);

  const manual = buildHybridInputForecast({
    monthlyValues,
    dataCorte: '2026-08',
    dataFim: '2026-10',
    group: 'Custos Indiretos',
    physicalContext: physical,
    override: { method: 'manual', manualMonthlyValue: 250 },
  });
  assert.equal(manual.extrapolation, 750);
  assert.equal(manual.confidence, 'manual');

  const manualWithoutHistory = buildHybridInputForecast({
    monthlyValues: { '2026-07': 50 },
    dataCorte: '2026-01',
    dataFim: '2026-10',
    group: 'Custos Indiretos',
    physicalContext: physical,
    override: { method: 'manual', manualMonthlyValue: 250 },
  });
  assert.equal(manualWithoutHistory.extrapolation, 750);

  const none = buildHybridInputForecast({
    monthlyValues,
    dataCorte: '2026-08',
    dataFim: '2026-10',
    group: 'Custos Indiretos',
    physicalContext: physical,
    override: { method: 'none' },
  });
  assert.equal(none.extrapolation, 0);

  const inactive = buildHybridInputForecast({
    monthlyValues: {
      '2025-12': 1000,
      '2026-01': 0,
      '2026-02': 0,
      '2026-03': 0,
      '2026-04': 0,
      '2026-05': 0,
      '2026-06': 0,
      '2026-07': 50,
    },
    dataCorte: '2026-07',
    dataFim: '2026-10',
    group: 'Custos Indiretos',
    physicalContext: physical,
    override: { method: 'fixed', sampleMonths: 12 },
  });
  assert.equal(inactive.extrapolation, 0);
  assert.match(inactive.details.fallbackReason, /seis últimos meses/);

  const direct = buildHybridInputForecast({
    monthlyValues,
    dataCorte: '2026-08',
    dataFim: '2026-10',
    group: 'Custos Diretos / Infraestrutura',
    physicalContext: physical,
    override: { method: 'fixed' },
  });
  assert.equal(direct.extrapolation, 0);

  assert.deepEqual(normalizeInputForecastConfig('run_rate'), {
    method: 'fixed',
    sampleMonths: 12,
    lagMonths: 0,
    fixedShare: 70,
    manualMonthlyValue: 0,
  });

  console.log('Projection forecast contract: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
