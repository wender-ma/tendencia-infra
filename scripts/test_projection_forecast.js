#!/usr/bin/env node

const assert = require('node:assert/strict');

(async () => {
  const { buildPhysicalForecastContext, buildHybridInputForecast } = await import(
    '../assets/js/services/projection-forecast.mjs'
  );
  const schedule = {
    cutoffMonth: '2026-07',
    curve: [
      { month: '2026-01', base: 10, planned: 10, actual: 8 },
      { month: '2026-02', base: 20, planned: 20, actual: 16 },
      { month: '2026-03', base: 30, planned: 30, actual: 24 },
      { month: '2026-04', base: 40, planned: 40, actual: 30 },
      { month: '2026-05', base: 50, planned: 50, actual: 36 },
      { month: '2026-06', base: 60, planned: 60, actual: 42 },
      { month: '2026-07', base: 70, planned: 70, actual: 48 },
      { month: '2026-08', base: 80, planned: 80, actual: 48 },
      { month: '2026-09', base: 90, planned: 90, actual: 48 },
      { month: '2026-10', base: 100, planned: 100, actual: 48 },
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
    '2026-07': 100,
    '2026-08': 0,
  };
  const forecast = buildHybridInputForecast({
    monthlyValues,
    dataCorte: '2026-08',
    dataFim: '2026-10',
    windowMonths: 6,
    group: 'Custos Indiretos',
    physicalContext: physical,
    override: 'ramp_down',
  });
  assert.equal(forecast.available, true);
  assert.equal(forecast.selectedMethod, 'ramp_down');
  assert.ok(forecast.extrapolationByMonth['2026-08'] > forecast.extrapolationByMonth['2026-10']);

  const direct = buildHybridInputForecast({
    monthlyValues,
    dataCorte: '2026-08',
    dataFim: '2026-10',
    group: 'Custos Diretos / Infraestrutura',
    physicalContext: physical,
  });
  assert.equal(direct.extrapolation, 0);

  console.log('Projection forecast contract: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
