#!/usr/bin/env node

const path = require('path');
const { pathToFileURL } = require('url');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function csv(rows) {
  return rows.map(row => row.map(value => {
    const text = String(value ?? '');
    return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(';')).join('\n');
}

async function main() {
  const parsersDirectory = path.resolve(__dirname, '../assets/js/parsers');
  const [{ parseTendenciaFile }, { parseFlowsFile }, { parseGestoesFile }] = await Promise.all([
    import(pathToFileURL(path.join(parsersDirectory, 'tendencia-parser.mjs')).href),
    import(pathToFileURL(path.join(parsersDirectory, 'flows-parser.mjs')).href),
    import(pathToFileURL(path.join(parsersDirectory, 'gestoes-parser.mjs')).href),
  ]);

  const tendencyHeaders = [
    'Item', 'Código', 'Serviço', 'Insumo', 'Orçamento Licitação', 'IPCA', 'INCC',
    'Gestão 07-2026', 'Diferença', 'Evolução Teórica', 'Evolução Financeira',
  ];
  const tendency = parseTendenciaFile(csv([
    tendencyHeaders,
    ['', '', '', '', '', '', '', '', '', '0,31', '28,5%'],
    ['Terraplenagem', '01.02.01', 'S001', 'I001', '1.000,00', '1.100,00', '1.080,00', '950,00', '-50,00', '10', '8'],
    ['', '01.02.02', '', '', '', '', '', '', '', '', ''],
  ]), { correctionIndex: 'ipca' });
  assert(tendency.items.length === 1, 'Parser de Tendência não preservou a linha válida');
  assert(tendency.items[0].licitacao_corrigido === 1100, 'Índice IPCA não foi aplicado');
  assert(tendency.managementLabel === 'Gestão 07-2026', 'Label de gestão não foi extraído');
  assert(tendency.evolution.teorica === 31, 'Percentual fracionário não foi normalizado');
  assert(tendency.report.accepted === 1 && tendency.report.ignored === 1, 'Relatório de Tendência incorreto');

  const flowHeaders = [
    'Cod_aditivo', 'Descr_status', 'Descr_areaatual', 'Descr_setorcriacao',
    'Data_criacao', 'Descr_motivo', 'Descr_observacao_motivo',
    'Descr_descricaoaditivo', 'Cod_obra', 'Valor Aprovado ou Solicitado',
    'Vlr_planejamento', 'Departamento', 'Ins. Planej.', 'Ins. Remanej.', 'Refletido',
  ];
  const maliciousText = '<script>alert(1)</script><img src=x onerror=alert(2)>" onmouseover="alert(3) javascript:alert(4)';
  const flows = parseFlowsFile(csv([
    flowHeaders,
    ['101', 'Aprovado', 'Engenharia', 'Obras', '20/07/2026', 'Escopo', maliciousText, 'Aditivo 101', '21O', '2.500,00', '2.450,00', '', 'I001', '-', 'Sim'],
    ['102', 'Aprovado', 'Engenharia', 'Obras', '31/02/2026', 'Escopo', 'Data ruim', 'Aditivo 102', '21O', '10', '10', '', 'I002', '-', 'Não'],
    ['103', 'Aprovado', 'Engenharia', 'Obras', '20/07/2026', 'Escopo', 'Obra ruim', 'Aditivo 103', 'XX', '10', '10', '', 'I003', '-', 'Não'],
  ]), { projects: [{ codigo_obra: '42-21O' }] });
  assert(flows.items.length === 1, 'Parser de Flows aceitou linhas inválidas');
  assert(flows.items[0].codigo_obra === '42-21O', 'Sufixo da obra não foi resolvido');
  assert(flows.items[0].justificativa === maliciousText, 'Texto externo foi alterado pelo parser');
  assert(flows.items[0].tipo === 'aumento_real', 'Classificação do Flow incorreta');
  assert(flows.report.rejected === 2, 'Relatório de Flows não contou rejeições');
  assert(flows.unknownProjects.join(',') === 'XX', 'Obra desconhecida não foi reportada');

  const managementHeaders = [
    'Mês pagamento', 'Key planejamento', 'Descr classificaçãofinanceira',
    'Valor total líquido', 'Descr gestão', 'Serviço', 'Insumo', 'Item',
  ];
  const planningKey = '42-21O-1-31005-S05765-I001-01.02.03';
  const managements = parseGestoesFile(csv([
    managementHeaders,
    ['01/07/2026', planningKey, 'Obra', '1.000,50', 'GESTÃO 06-2026', '', '', ''],
    ['01/08/2026', planningKey, 'Obra', '1.250,75', 'Atual', '', '', ''],
    ['01/08/2026', planningKey, 'Administrativo', '500,00', 'Atual', '', '', ''],
  ]));
  assert(managements.history.items.length === 1, 'Gestões não agregou a chave');
  assert(managements.history.items[0].servico === 'S05765', 'Fallback de serviço falhou');
  assert(managements.history.totals['42-21O'].Atual === 1250.75, 'Total por obra incorreto');
  assert(managements.projectionRows[0].mes === '2026-08', 'Projeção mensal incorreta');
  assert(managements.report.accepted === 2 && managements.report.ignored === 1, 'Relatório de Gestões incorreto');

  console.log('Parsers de importação: Tendência, Flows, Gestões e payloads XSS preservados como texto OK');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
