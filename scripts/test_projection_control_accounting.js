#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/services/projection-control-accounting.mjs'),
  );
  const {
    calculateProjectionBalance,
    getProjectionMovementAmount,
    getProjectionMovementSignedValue,
    PROJECTION_MOVEMENT_DIRECTIONS,
    resolveProjectionMovementDirection,
  } = await import(moduleUrl.href);

  const input = 'I011890';
  const scenarios = [
    { tipo: 'aporte', origem: 'EXTERNO', destino: input, valor: 200 },
    { tipo: 'devolucao', origem: input, destino: 'EXTERNO', valor: 50 },
    { tipo: 'remanejamento', origem: input, destino: 'I000001', valor: 100 },
    { tipo: 'remanejamento', origem: 'I000002', destino: input, valor: 40 },
  ].map((movement) => ({
    ...movement,
    direcao: resolveProjectionMovementDirection(movement, input),
  }));

  assert.deepStrictEqual(
    scenarios.map((movement) => movement.direcao),
    ['entrada', 'saida', 'saida', 'entrada'],
  );
  assert.strictEqual(calculateProjectionBalance(scenarios), 90);
  assert.strictEqual(getProjectionMovementAmount(-125.5), 125.5);
  assert.strictEqual(getProjectionMovementSignedValue({ direcao: 'saida', valor: -25 }), -25);
  assert.strictEqual(
    resolveProjectionMovementDirection({ tipo: 'aditivo', origem: input, destino: input }, input),
    PROJECTION_MOVEMENT_DIRECTIONS.INVALID,
  );
  assert.strictEqual(
    resolveProjectionMovementDirection(
      { tipo: 'remanejamento', origem: 'I1', destino: 'I2' },
      input,
    ),
    PROJECTION_MOVEMENT_DIRECTIONS.INVALID,
  );

  console.log('Controle de projeção: direções e saldos contábeis OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
