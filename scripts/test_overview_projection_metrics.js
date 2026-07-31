#!/usr/bin/env node

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const overviewUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/ui/views/overview.mjs'),
  );
  const { buildOverviewProjectionMetrics } = await import(overviewUrl.href);

  const metrics = buildOverviewProjectionMetrics({
    correctedBudget: 120,
    management: 130,
    indirectTendency: 10,
    directTendency: -5,
    projectionReserve: 3,
  });

  assert.deepEqual(metrics, {
    projectedTotal: 135,
    managementVsCorrected: 10,
    grossDifference: 15,
    liquidProjectedTotal: 132,
    liquidDifference: 12,
    grossPercentage: 12.5,
    liquidPercentage: 10,
  });
  assert.equal(
    metrics.managementVsCorrected + 10 - 5,
    metrics.grossDifference,
    'Gestão vs corrigido + tendências deve reconciliar com a diferença bruta',
  );
  assert.equal(
    metrics.grossDifference - 3,
    metrics.liquidDifference,
    'Diferença bruta - reserva deve reconciliar com a diferença líquida',
  );

  const zeroBaseline = buildOverviewProjectionMetrics({
    correctedBudget: 0,
    management: 50,
  });
  assert.equal(zeroBaseline.grossPercentage, 0);
  assert.equal(zeroBaseline.liquidPercentage, 0);

  console.log('Contrato da Visão Geral: Tendência reconciliada com a Licitação corrigida');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
