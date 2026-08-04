#!/usr/bin/env node

const path = require('path');
const { pathToFileURL } = require('url');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function csv(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value ?? '');
          return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(';'),
    )
    .join('\n');
}

async function main() {
  const parsersDirectory = path.resolve(__dirname, '../assets/js/parsers');
  const [
    { parseTendenciaFile },
    { discoverFlowProjectReferences, parseFlowsFile },
    { discoverGestoesProjectCodes, parseGestoesFile },
  ] = await Promise.all([
    import(pathToFileURL(path.join(parsersDirectory, 'tendencia-parser.mjs')).href),
    import(pathToFileURL(path.join(parsersDirectory, 'flows-parser.mjs')).href),
    import(pathToFileURL(path.join(parsersDirectory, 'gestoes-parser.mjs')).href),
  ]);

  const tendencyHeaders = [
    'Item',
    'Código',
    'Serviço',
    'Insumo',
    'Orçamento Licitação',
    'IPCA',
    'INCC',
    'Gestão 07-2026',
    'Diferença',
    'Evolução Teórica',
    'Evolução Financeira',
  ];
  const tendency = parseTendenciaFile(
    csv([
      tendencyHeaders,
      ['', '', '', '', '', '', '', '', '', '0,31', '28,5%'],
      [
        'Terraplenagem',
        '01.02.01',
        'S001',
        'I001',
        '1.000,00',
        '1.100,00',
        '1.080,00',
        '950,00',
        '-50,00',
        '10',
        '8',
      ],
      ['', '01.02.02', '', '', '', '', '', '', '', '', ''],
    ]),
    { correctionIndex: 'ipca' },
  );
  assert(tendency.items.length === 1, 'Parser de Tendência não preservou a linha válida');
  assert(tendency.items[0].licitacao_corrigido === 1100, 'Índice IPCA não foi aplicado');
  assert(tendency.managementLabel === 'Gestão 07-2026', 'Label de gestão não foi extraído');
  assert(tendency.evolution.teorica === 31, 'Percentual fracionário não foi normalizado');
  assert(tendency.evolution.teoricaNominal === 10, 'Valor nominal de M3 não foi preservado');
  assert(tendency.evolution.financeiraNominal === 8, 'Valor nominal de N3 não foi preservado');
  assert(
    tendency.report.accepted === 1 && tendency.report.ignored === 1,
    'Relatório de Tendência incorreto',
  );

  const flowHeaders = [
    'Cod_aditivo',
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
  const maliciousText =
    '<script>alert(1)</script><img src=x onerror=alert(2)>" onmouseover="alert(3) javascript:alert(4)';
  const flowsCsv = csv([
    flowHeaders,
    [
      '101',
      'Aprovado',
      'Engenharia',
      'Obras',
      '20/07/2026',
      'Escopo',
      maliciousText,
      'Aditivo 101',
      '21O',
      '2.500,00',
      '2.450,00',
      '',
      'I001',
      '-',
      'Sim',
    ],
    [
      '102',
      'Aprovado',
      'Engenharia',
      'Obras',
      '31/02/2026',
      'Escopo',
      'Data ruim',
      'Aditivo 102',
      '21O',
      '10',
      '10',
      '',
      'I002',
      '-',
      'Não',
    ],
    [
      '103',
      'Aprovado',
      'Engenharia',
      'Obras',
      '20/07/2026',
      'Escopo',
      'Obra ruim',
      'Aditivo 103',
      'XX',
      '10',
      '10',
      '',
      'I003',
      '-',
      'Não',
    ],
  ]);
  const flows = parseFlowsFile(flowsCsv, { projects: [{ codigo_obra: '42-21O' }] });
  assert(flows.items.length === 1, 'Parser de Flows aceitou linhas inválidas');
  assert(flows.items[0].codigo_obra === '42-21O', 'Sufixo da obra não foi resolvido');
  assert(flows.items[0].justificativa === maliciousText, 'Texto externo foi alterado pelo parser');
  assert(flows.items[0].tipo === 'aumento_real', 'Classificação do Flow incorreta');
  assert(flows.report.rejected === 2, 'Relatório de Flows não contou rejeições');
  assert(flows.unknownProjects.join(',') === 'XX', 'Obra desconhecida não foi reportada');
  assert(
    discoverFlowProjectReferences(flowsCsv).join(',') === '21O,XX',
    'Descoberta de referências de obras em Flows falhou',
  );

  const currentFlowHeaders = [
    'Descr_etiqueta',
    'Cod_aditivo',
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
  const currentFlows = parseFlowsFile(
    csv([
      currentFlowHeaders,
      [
        'Em aprovação',
        '201',
        'Obra',
        '8/19/24 8:37',
        '2,965.53',
        'Escopo',
        '',
        'Orçamento',
        'Aditivo 201',
        '21O',
        'Usuário',
        'Ativo',
        '2,965.53',
        '',
      ],
      [
        'Em aprovação',
        '202',
        'Obra',
        '8/9/24 9:04',
        '100.00',
        'Escopo',
        '',
        'Fora da Esteira de Aprovação',
        'Aditivo 202',
        '21O',
        'Usuário',
        'Finalizado',
        '',
        '',
      ],
      [
        'Em aprovação',
        '203',
        'Obra',
        '9/10/24 9:04',
        '350.00',
        'Escopo',
        '',
        'Orçamento',
        'Aditivo 203',
        '21O',
        'Usuário',
        'Ativo',
        '',
        '',
      ],
    ]),
    {
      projects: [{ codigo_obra: '42-21O' }],
      previousFlows: [
        {
          codigo_obra: '42-21O',
          n_alteracao: '202',
          custo_flowmaster: -250,
        },
      ],
    },
  );
  assert(currentFlows.items.length === 3, 'Parser rejeitou o novo modelo de Flows');
  assert(currentFlows.items[0].data === '2024-08-19', 'Data americana não foi reconhecida');
  assert(currentFlows.items[1].data === '2024-08-09', 'Data americana ambígua foi invertida');
  assert(currentFlows.items[0].dep === 'Orçamento', 'Departamento não usou a área atual');
  assert(
    currentFlows.items[1].dep === 'Finalizado',
    'Departamento fora da esteira não usou o status',
  );
  assert(
    currentFlows.items[1].custo_flowmaster === -250,
    'Valor anterior assinado não foi preservado',
  );
  assert(
    currentFlows.items[2].custo_flowmaster === 350,
    'Aditivo novo sem valor aprovado não usou o valor estimado',
  );
  assert(
    currentFlows.report.preservedFlowValues === 1 &&
      currentFlows.report.estimatedValueFallbacks === 1,
    'Relatório não contabilizou a reconciliação de valores',
  );
  assert(
    currentFlows.items[0].tipo === 'sem_classificacao' &&
      currentFlows.items[0].refletido_status === 'pendente',
    'Campos gerenciados pelo dashboard não receberam os padrões corretos',
  );

  const managementHeaders = [
    'Mês pagamento',
    'Key planejamento',
    'Descr classificaçãofinanceira',
    'Valor total líquido',
    'Descr gestão',
    'Serviço',
    'Insumo',
    'Item',
  ];
  const planningKey = '42-21O-1-31005-S05765-I001-01.02.03';
  const secondPlanningKey = '43-ABC-1-31005-S05765-I002-01.02.04';
  const fallbackPlanningKey = '44-DEF-1-31005-S05765-I003-01.02.05';
  const managementCsv = csv([
    managementHeaders,
    ['01/07/2026', planningKey, 'Obra', '1.000,50', 'GESTÃO 06-2026', '', '', ''],
    ['01/07/2026', planningKey, 'Obra', '600,25', 'GESTÃO 07-2026', '', '', ''],
    ['01/08/2026', planningKey, 'Obra', '650,50', 'GESTÃO 07-2026', '', '', ''],
    ['01/08/2026', planningKey, 'Obra', '9.999,00', 'Atual', '', '', ''],
    ['01/06/2026', secondPlanningKey, 'Obra', '10,00', 'GESTÃO 05-2026', '', '', ''],
    ['01/07/2026', secondPlanningKey, 'Obra', '20,00', 'GESTÃO 06-2026', '', '', ''],
    ['01/08/2026', fallbackPlanningKey, 'Obra', '30,00', 'Atual', '', '', ''],
    ['01/08/2026', planningKey, 'Administrativo', '500,00', 'Atual', '', '', ''],
    ['01/08/2026', '99-XYZ-1-31005-S05765-I001-01.02.03', 'Obra', '10,00', 'Atual', '', '', ''],
  ]);
  const managements = parseGestoesFile(managementCsv, {
    projects: [{ codigo_obra: '42-21O' }, { codigo_obra: '43-ABC' }, { codigo_obra: '44-DEF' }],
  });
  assert(managements.history.items.length === 3, 'Gestões não agregou as chaves');
  assert(managements.history.items[0].servico === 'S05765', 'Fallback de serviço falhou');
  assert(managements.history.totals['42-21O'].Atual === 9999, 'Total por obra incorreto');
  assert(
    managements.projectionManagementByProject['42-21O'] === 'GESTÃO 07-2026',
    'Gestão nomeada mais recente não foi selecionada',
  );
  assert(
    managements.projectionManagementByProject['43-ABC'] === 'GESTÃO 06-2026',
    'Seleção da gestão não foi feita por obra',
  );
  assert(
    managements.projectionManagementByProject['44-DEF'] === 'Atual',
    'Fallback para Atual não foi aplicado',
  );
  assert(
    managements.projectionRows.length === 4 &&
      managements.projectionRows
        .filter((row) => row.codigo_obra === '42-21O')
        .reduce((sum, row) => sum + row.valor, 0) === 1250.75,
    'Projeção combinou gestões ou perdeu lançamentos mensais',
  );
  assert(
    managements.history.projectionManagementByProject['42-21O'] === 'GESTÃO 07-2026',
    'Fonte da projeção não foi persistida no histórico',
  );
  assert(
    JSON.stringify(managements.projectionComparisonByProject['42-21O']) ===
      JSON.stringify({
        currentManagement: 'GESTÃO 07-2026',
        previousManagement: 'GESTÃO 06-2026',
        comparisonMonth: '2026-06',
      }),
    'Comparativo entre Gestões foi montado incorretamente',
  );
  assert(
    managements.monthlyRowsByProjectManagement['42-21O']['GESTÃO 06-2026'].length === 1,
    'Série mensal da Gestão anterior não foi preservada',
  );
  let missingPreviousError = null;
  try {
    parseGestoesFile(
      csv([
        managementHeaders,
        ['01/07/2026', planningKey, 'Obra', '10,00', 'GESTÃO 07-2026', '', '', ''],
      ]),
      { projects: [{ codigo_obra: '42-21O' }] },
    );
  } catch (error) {
    missingPreviousError = error;
  }
  assert(
    /42-21O: GESTÃO 07-2026 exige GESTÃO 06-2026/.test(missingPreviousError?.message || ''),
    'Upload deveria bloquear a ausência da Gestão imediatamente anterior',
  );
  assert(
    managements.report.accepted === 7 && managements.report.ignored === 1,
    'Relatório de Gestões incorreto',
  );
  assert(
    managements.unknownProjects.join(',') === '99-XYZ',
    'Gestões não reportou a obra desconhecida',
  );
  assert(
    discoverGestoesProjectCodes(managementCsv).join(',') === '42-21O,43-ABC,44-DEF,99-XYZ',
    'Descoberta de obras em Gestões falhou',
  );

  console.log(
    'Parsers de importação: Tendência, Flows, Gestões e payloads XSS preservados como texto OK',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
