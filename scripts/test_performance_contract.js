#!/usr/bin/env node

const path = require('path');
const { pathToFileURL } = require('url');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/performance.mjs'),
  ).href;
  const { createPerformanceMonitor } = await import(moduleUrl);
  let now = 10;
  const monitor = createPerformanceMonitor({
    performanceRef: { now: () => (now += 5) },
    documentRef: { getElementsByTagName: () => ({ length: 321 }) },
  });

  assert(monitor.measure('sync', () => 42) === 42, 'Medição síncrona alterou retorno');
  await monitor.measure('async', async () => 'ok');
  try {
    monitor.measure('failed', () => { throw new Error('esperado'); });
  } catch (error) {
    assert(error.message === 'esperado', 'Medição alterou o erro original');
  }
  monitor.completeBoot();
  const snapshot = monitor.snapshot();
  assert(snapshot.boot.completed && snapshot.boot.domNodes === 321, 'Métrica de boot incompleta');
  assert(snapshot.operations.sync.count === 1, 'Operação síncrona não contabilizada');
  assert(snapshot.operations.async.count === 1, 'Operação assíncrona não contabilizada');
  assert(snapshot.operations.failed.count === 1, 'Operação com erro não contabilizada');
  console.log('Contrato de performance: boot, DOM, parser/render e erros mensuráveis OK');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
