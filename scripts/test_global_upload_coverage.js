#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../assets/js/ui/uploads.mjs'));
  const { analyzeGlobalUploadCoverage } = await import(moduleUrl.href);

  const projects = [
    { codigo_obra: '42-21O', nome: 'Zurique', ativa: false },
    { codigo_obra: '18-JROMO', nome: 'Roma', ativa: true },
  ];
  const previousFlows = [
    ...Array.from({ length: 160 }, () => ({ codigo_obra: '42-21O' })),
    ...Array.from({ length: 41 }, () => ({ codigo_obra: '18-JROMO' })),
  ];
  const incomingFlows = [
    ...Array.from({ length: 35 }, () => ({ codigo_obra: '18-JROMO' })),
    { codigo_obra: '99-NOVA' },
  ];
  const result = analyzeGlobalUploadCoverage({
    previousFlows,
    incomingFlows,
    projects,
    selectedKinds: ['flows'],
  });

  assert.strictEqual(result.missing.length, 1, 'Obra zerada deveria bloquear');
  assert.deepStrictEqual(
    {
      code: result.missing[0].code,
      name: result.missing[0].name,
      active: result.missing[0].active,
      previous: result.missing[0].previous,
      incoming: result.missing[0].incoming,
      delta: result.missing[0].delta,
    },
    {
      code: '42-21O',
      name: 'Zurique',
      active: false,
      previous: 160,
      incoming: 0,
      delta: -160,
    },
    'Cobertura deve incluir nome, estado inativo e diferença',
  );
  assert.strictEqual(result.partialDrops.length, 1, 'Redução parcial deveria gerar alerta');
  assert.strictEqual(result.partialDrops[0].code, '18-JROMO');
  assert.strictEqual(result.partialDrops[0].previous, 41);
  assert.strictEqual(result.partialDrops[0].incoming, 35);
  assert.strictEqual(
    result.missing.some((row) => row.code === '99-NOVA'),
    false,
  );

  const firstUpload = analyzeGlobalUploadCoverage({
    incomingFlows: [{ codigo_obra: '42-21O' }],
    projects,
    selectedKinds: ['flows'],
  });
  assert.strictEqual(firstUpload.missing.length, 0, 'Primeiro upload não deveria bloquear');
  assert.strictEqual(firstUpload.partialDrops.length, 0);

  const managements = analyzeGlobalUploadCoverage({
    previousHistory: [{ codigo_obra: '42-21O' }],
    incomingHistory: [{ codigo_obra: '42-21O' }],
    projects,
    selectedKinds: ['gestoes'],
  });
  assert.strictEqual(managements.missing.length, 0, 'Cobertura preservada não deveria alertar');

  console.log('Cobertura de uploads globais: 7 cenários OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
