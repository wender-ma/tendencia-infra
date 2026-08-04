#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../assets/js/ui/uploads.mjs'));
  const { autoDetectExcelSheets, normalizeImportTableRows } = await import(moduleUrl.href);
  const { validateImportHeaders } = await import(
    pathToFileURL(path.resolve(__dirname, '../assets/js/parsers/shared.mjs')).href
  );

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
  const tendencyAliases = [
    'Tendência',
    'TENDENCIA-21O',
    'Tendência de Obra',
    'TendênciaValor21O',
    'Base Tendência Atual',
    'Tend',
  ];
  const physicalScheduleAliases = [
    'Cronograma Físico',
    'Cronograma Fisico-Financeiro',
    'Cronograma da Obra',
    'Evolução Física',
  ];

  for (const alias of flowAliases) {
    assert.strictEqual(
      autoDetectExcelSheets([alias]).flows,
      alias,
      `Alias de Flows não reconhecido: ${alias}`,
    );
  }

  for (const alias of tendencyAliases) {
    assert.strictEqual(
      autoDetectExcelSheets([alias]).tendencia,
      alias,
      `Alias de Tendência não reconhecido: ${alias}`,
    );
  }

  for (const alias of physicalScheduleAliases) {
    assert.strictEqual(
      autoDetectExcelSheets([alias]).cronograma_fisico,
      alias,
      `Alias de Cronograma Físico não reconhecido: ${alias}`,
    );
  }

  assert.deepStrictEqual(
    autoDetectExcelSheets(['TENDÊNCIA-21O', 'Cronograma Físico', 'Flows', 'Gestões']),
    {
      tendencia: 'TENDÊNCIA-21O',
      cronograma_fisico: 'Cronograma Físico',
      flows: 'Flows',
      gestoes: 'Gestões',
    },
  );
  assert.strictEqual(
    autoDetectExcelSheets(['Workflow de aprovação']).flows,
    null,
    'Workflow não deve ser confundido com a aba de Flows',
  );

  const splitTendencyRows = [
    [
      '',
      '',
      '',
      '',
      'ITENS',
      '',
      'ORÇ. LICITAÇÃO',
      'IPCA 3,56%',
      'INCC 1,19%',
      'GESTÃO 07-2026',
      'DIFERENÇA',
      '',
      'EVOLUÇÃO TEÓRICA',
      'EVOLUÇÃO FINANCEIRA',
    ],
    [
      'Chave',
      'Código',
      'Serviço',
      'Insumo',
      'ÁREA VENDÁVEL',
      '',
      '100',
      '103,56',
      '101,19',
      '100',
      '0',
      '',
      '50%',
      '50%',
    ],
    ['chave', '01.01.01', 'S001', 'I001', 'Item'],
  ];
  const normalizedRows = normalizeImportTableRows(
    splitTendencyRows,
    'tendencia',
    validateImportHeaders,
  );
  assert.strictEqual(normalizedRows[0][1], 'Código', 'Cabeçalho dividido perdeu Código');
  assert.strictEqual(normalizedRows[0][4], 'ITENS', 'Cabeçalho dividido perdeu Item');
  assert.strictEqual(
    normalizedRows[1][12],
    '50%',
    'Linha de totais da Tendência não foi preservada',
  );

  console.log(
    `Detecção de abas Excel: ${flowAliases.length + tendencyAliases.length + 3} cenários OK`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
