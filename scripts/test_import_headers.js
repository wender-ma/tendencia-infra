#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

function extractSource(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(`Bloco não encontrado: ${startMarker}`);
  }
  return html.slice(start, end);
}

const validationSource = extractSource('const IMPORT_HEADER_RULES =', '// parseNum agora');
const csvParserSource = extractSource('function parseCSVRows(text)', 'function normInsumo');
const context = {};

vm.runInNewContext(`${validationSource}\n${csvParserSource}`, context);

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
  expectedParts.forEach(part => {
    assert(message.includes(part), `Mensagem não contém "${part}": ${message}`);
  });
}

const tendencia = Array(14).fill('');
tendencia[1] = ' CÓD. ';
tendencia[2] = 'Cód. Serviço';
tendencia[3] = 'Cód. Insumo';
tendencia[4] = 'Item';
tendencia[6] = 'ORÇ. LICITAÇÃO';
tendencia[7] = 'CORRIGIDO IPCA';
tendencia[8] = 'CORRIGIDO INCC';
tendencia[9] = 'GESTÃO 05-2026';
tendencia[10] = 'DIFERENÇA';
tendencia[12] = 'EVOLUÇÃO\nTEÓRICA';
tendencia[13] = 'EVOLUÇÃO FINANCEIRA';
context.validateImportHeaders('tendencia', [tendencia]);

const flows = [
  '\ufeffCod_aditivo',
  'Descr_status',
  'Descr_areaatual',
  'Descr_setorcriacao',
  'Data_criacao',
  'Descr_motivo',
  'Descr_observacao_motivo',
  'Descr_descricaoaditivo',
  'Cod_obra',
  'Valor Aprovado ou Solicitado',
  'Vlr_planejamento',
  'Departamento',
  'Ins. Planej.',
  'Ins. Remanej.',
  'Refletido',
];
context.validateImportHeaders('flows', [flows]);

const gestoes = [
  'Mês pagamento',
  'Key planejamento',
  'Descr classificaçãofinanceira',
  'Valor total líquido',
  'Descr gestão',
];
context.validateImportHeaders('gestoes', [gestoes]);

const csvRows = context.parseCSVRows(flows.map(value => `"${value}"`).join(';') + '\n1;x');
context.validateImportHeaders('flows', csvRows);

expectError(
  () => context.validateImportHeaders('gestoes', [['Descr_gestao']]),
  ['Key_planejamento', 'Nenhum dado foi importado']
);

const shiftedFlows = flows.slice();
[shiftedFlows[0], shiftedFlows[1]] = [shiftedFlows[1], shiftedFlows[0]];
expectError(
  () => context.validateImportHeaders('flows', [shiftedFlows]),
  ['posição incorreta', 'coluna 1']
);

console.log('Validação de cabeçalhos: 6 cenários OK');
