#!/usr/bin/env node

const path = require('path');
const { pathToFileURL } = require('url');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectError(callback, expectedParts) {
  let message = '';
  try {
    callback();
  } catch (error) {
    message = error.message;
  }
  for (const part of expectedParts) {
    assert(message.includes(part), `Mensagem não contém "${part}": ${message}`);
  }
}

async function main() {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/parsers/shared.mjs'),
  ).href;
  const {
    parseDelimitedRows,
    resolveImportColumns,
    validateImportHeaders,
  } = await import(moduleUrl);

  const tendencia = [
    'Item',
    'Cód. Serviço',
    'Cód. Insumo',
    'CÓD.',
    'ORÇ. LICITAÇÃO',
    'CORRIGIDO IPCA',
    'CORRIGIDO INCC',
    'GESTÃO 05-2026',
    'DIFERENÇA',
    'EVOLUÇÃO\nTEÓRICA',
    'EVOLUÇÃO FINANCEIRA',
  ];
  const tendencyColumns = resolveImportColumns('tendencia', [tendencia]);
  assert(tendencyColumns.item === 0, 'Tendência não mapeou colunas pelo cabeçalho');
  assert(tendencyColumns.code === 3, 'Código foi confundido com código de serviço');

  const flows = [
    'Descr_etiqueta',
    '\ufeffCod_aditivo',
    'Descr_setorcriacao',
    'Data_criacao',
    'Vlr_estimado',
    'Descr_motivo',
    'Descr_observacao_motivo',
    'Descr_areaatual',
    'Descr_descricaoaditivo',
    'Cod_obra',
    'Descr_usuariocriacao',
    'Descr_status',
    'Valor Aprovado ou Solicitado',
    'Vlr_planejamento',
  ];
  validateImportHeaders('flows', [flows]);
  const flowColumns = resolveImportColumns('flows', [flows]);
  assert(flowColumns.department === -1, 'Departamento novo deveria ser opcional');
  assert(flowColumns.planningInput === -1, 'Destino novo deveria ser opcional');
  assert(flowColumns.reallocationInput === -1, 'Origem nova deveria ser opcional');
  assert(flowColumns.reflected === -1, 'Refletido novo deveria ser opcional');
  assert(flowColumns.estimatedValue === 4, 'Valor estimado novo não foi mapeado');

  const gestoes = [
    'Mês pagamento',
    'Key planejamento',
    'Descr classificaçãofinanceira',
    'Valor total líquido',
    'Descr gestão',
  ];
  validateImportHeaders('gestoes', [gestoes]);

  const semicolonRows = parseDelimitedRows(flows.map(value => `"${value}"`).join(';') + '\n1;x');
  validateImportHeaders('flows', semicolonRows);
  const tabRows = parseDelimitedRows(flows.join('\t') + '\n1\tx');
  validateImportHeaders('flows', tabRows);

  expectError(
    () => validateImportHeaders('gestoes', [['Descr_gestao']]),
    ['Key_planejamento', 'Nenhum dado foi importado'],
  );
  expectError(
    () => parseDelimitedRows('a;b\n"campo sem fim'),
    ['aspas não foi encerrado'],
  );
  expectError(
    () => parseDelimitedRows('a;b\ntexto\ufffd;valor'),
    ['encoding inválido'],
  );

  console.log('Validação de cabeçalhos e CSV: 8 cenários OK');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
