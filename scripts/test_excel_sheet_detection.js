#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/ui/uploads.mjs'),
  );
  const { autoDetectExcelSheets } = await import(moduleUrl.href);

  const flowAliases = [
    'Aditivos_flowmaster',
    'Aditivos Flowmaster',
    'Flowmaster',
    'Flow Master',
    'FlowsValor',
    'Flows_Valor',
    'Flows',
    'Flow',
    'Fluxos',
    'Aditivos',
    'Base Flows 2026',
    'Flows / Aditivos',
  ];

  for (const alias of flowAliases) {
    assert.strictEqual(
      autoDetectExcelSheets([alias]).flows,
      alias,
      `Alias de Flows não reconhecido: ${alias}`,
    );
  }

  assert.deepStrictEqual(
    autoDetectExcelSheets(['TENDÊNCIA-21O', 'Flows', 'Gestões']),
    {
      tendencia: 'TENDÊNCIA-21O',
      flows: 'Flows',
      gestoes: 'Gestões',
    },
  );
  assert.strictEqual(
    autoDetectExcelSheets(['Workflow de aprovação']).flows,
    null,
    'Workflow não deve ser confundido com a aba de Flows',
  );

  console.log(`Detecção de abas Excel: ${flowAliases.length + 2} cenários OK`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
