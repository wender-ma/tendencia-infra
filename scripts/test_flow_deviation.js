#!/usr/bin/env node

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/services/flow-deviation.mjs'),
  );
  const { buildManagementDeviationBreakdown, managementCutoffMonth } = await import(moduleUrl.href);

  assert.equal(managementCutoffMonth('GESTÃO 07-2026'), '2026-07');
  assert.equal(managementCutoffMonth('Atual', new Date(2026, 7, 4)), '2026-08');

  const flows = [
    {
      n_alteracao: 'INF-JUL-IPCA',
      tipo: 'aumento_real',
      refletido_status: 'ipca',
      refletido_mes: '2026-07-01',
      custo_flowmaster: 100,
    },
    {
      n_alteracao: 'INF-JUL-INCC-NEG',
      tipo: 'economia',
      refletido_status: 'incc',
      refletido_mes: '2026-07-01',
      custo_flowmaster: -10,
    },
    {
      n_alteracao: 'INF-AGO',
      tipo: 'aumento_real',
      refletido_status: 'ipca',
      refletido_mes: '2026-08-01',
      custo_flowmaster: 50,
    },
    {
      n_alteracao: 'ADITIVO-JUL',
      tipo: 'aumento_real',
      refletido_status: 'sim',
      refletido_mes: '2026-07-01',
      custo_flowmaster: 25,
    },
    {
      n_alteracao: 'ECONOMIA-JUL',
      tipo: 'economia',
      refletido_status: 'sim',
      refletido_mes: '2026-07-01',
      custo_flowmaster: -5,
    },
    {
      n_alteracao: 'REMANEJAMENTO',
      tipo: 'remanejamento',
      refletido_status: 'sim',
      refletido_mes: '2026-07-01',
      custo_flowmaster: 999,
    },
    {
      n_alteracao: 'PENDENTE',
      tipo: 'aumento_real',
      refletido_status: 'pendente',
      custo_flowmaster: 999,
    },
    {
      n_alteracao: 'INCOMPLETO',
      tipo: 'aumento_real',
      refletido_status: 'ipca',
      custo_flowmaster: 999,
    },
    {
      n_alteracao: 'CANCELADO',
      dep: 'Cancelado',
      tipo: 'aumento_real',
      refletido_status: 'ipca',
      refletido_mes: '2026-07-01',
      custo_flowmaster: 999,
    },
  ];

  const july = buildManagementDeviationBreakdown({
    flows,
    managementLabel: 'GESTÃO 07-2026',
  });
  assert.equal(july.inflation, 90);
  assert.equal(july.otherReflected, 20);
  assert.deepEqual(july.totalsByIndex, { ipca: 100, incc: -10 });
  assert.deepEqual(
    july.inflationFlows.map((flow) => flow.n_alteracao),
    ['INF-JUL-IPCA', 'INF-JUL-INCC-NEG'],
  );
  assert.deepEqual(
    july.incompleteInflationFlows.map((flow) => flow.n_alteracao),
    ['INCOMPLETO'],
  );

  const august = buildManagementDeviationBreakdown({
    flows,
    managementLabel: 'GESTÃO 08-2026',
  });
  assert.equal(august.inflation, 140);
  assert.equal(august.totalsByIndex.ipca, 150);

  console.log('Inflação incorporada: corte mensal, índices, sinais e exclusões OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
