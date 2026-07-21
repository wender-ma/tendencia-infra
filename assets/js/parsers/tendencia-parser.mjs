import {
  createImportReport,
  parseDelimitedRows,
  parseNumber,
  rejectRow,
  resolveImportColumns,
} from './shared.mjs';

const GROUP_NAMES = Object.freeze({
  '01.01': 'Custos Indiretos',
  '01.02': 'Custos Diretos / Infraestrutura',
  '01.03': 'Obras Civis',
  '01.04': 'Projeção de Gastos',
  '01.09': 'Serviços Iniciais',
  '09.01': 'Serviços Iniciais Adicionais',
  '09.02': 'Serviços Iniciais Adicionais',
});

export function parseTendenciaFile(text, options = {}) {
  const rows = parseDelimitedRows(text);
  const columns = resolveImportColumns('tendencia', rows);
  if (rows.length < 3) throw new Error('TENDÊNCIA: arquivo sem linhas de dados.');

  const header = rows[0];
  const subheader = rows[1] || [];
  const report = createImportReport(rows.length - 2);
  const managementLabel = String(header[columns.management] || '').trim().replace(/\s+/g, ' ');
  const evolution = {
    teorica: parseNumber(subheader[columns.theoreticalEvolution], { isPercentage: true }),
    financeira: parseNumber(subheader[columns.financialEvolution], { isPercentage: true }),
  };
  const correctionIndex = options.correctionIndex === 'ipca' ? 'ipca' : 'incc';
  const groups = options.groups || GROUP_NAMES;
  const items = [];

  for (let index = 2; index < rows.length; index += 1) {
    const row = rows[index];
    const code = String(row[columns.code] || '').trim();
    const item = String(row[columns.item] || '').trim();
    if (!code || !item) {
      rejectRow(report, 'código ou item ausente', true);
      continue;
    }

    const serviceRaw = String(row[columns.service] || '').trim();
    const inputRaw = String(row[columns.input] || '').trim();
    const service = serviceRaw === '-1' ? '' : serviceRaw;
    const input = ['-1', 'INSUMOS'].includes(inputRaw) ? '' : inputRaw;
    const codeParts = code.split('.');
    const groupCode = codeParts.length >= 2 ? codeParts.slice(0, 2).join('.') : code;
    const incc = parseNumber(row[columns.incc]);
    const ipca = parseNumber(row[columns.ipca]);

    items.push({
      cod: code,
      cod_servico: service,
      cod_insumo: input,
      item,
      grupo_cod: groupCode,
      grupo: groups[groupCode] || groupCode,
      nivel: codeParts.length,
      is_folha: Boolean(input),
      licitacao: parseNumber(row[columns.bidding]),
      corrigido_incc: incc,
      corrigido_ipca: ipca,
      licitacao_corrigido: correctionIndex === 'ipca' ? ipca : incc,
      gestao: parseNumber(row[columns.management]),
      diferenca: parseNumber(row[columns.difference]),
      evolucao_teorica: parseNumber(row[columns.theoreticalEvolution]),
      evolucao_financeira: parseNumber(row[columns.financialEvolution]),
    });
    report.accepted += 1;
  }

  if (!items.length) throw new Error('TENDÊNCIA: nenhuma linha válida encontrada.');
  return { items, managementLabel, evolution, report };
}
