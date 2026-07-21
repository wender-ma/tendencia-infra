import {
  createImportReport,
  parseDelimitedRows,
  parseNumber,
  rejectRow,
  resolveImportColumns,
  toIsoDate,
} from './shared.mjs';

function extractProjectCode(planningKey) {
  const parts = String(planningKey || '').split('-');
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : null;
}

function detailsFromKey(planningKey) {
  const parts = String(planningKey || '').split('-');
  return {
    service: parts.length >= 5 ? parts[4] : '',
    input: parts.length >= 6 ? parts[5] : '',
    item: parts.length >= 7 ? parts.slice(6).join('-') : '',
  };
}

function managementSortKey(management) {
  if (management === 'Atual') return [9999, 99];
  const match = management.match(/GEST[ÃA]O\s+(\d{2})-(\d{4})/i);
  return match ? [Number(match[2]), Number(match[1])] : [0, 0];
}

export function parseGestoesFile(text) {
  const rows = parseDelimitedRows(text);
  const columns = resolveImportColumns('gestoes', rows);
  if (rows.length < 2) throw new Error('GESTÕES: arquivo sem linhas de dados.');

  const report = createImportReport(rows.length - 1);
  const aggregated = new Map();
  const managementNames = new Set();
  const projectionRows = [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (String(row[columns.financialClassification] || '').trim() !== 'Obra') {
      rejectRow(report, 'classificação diferente de Obra', true);
      continue;
    }

    const planningKey = String(row[columns.planningKey] || '').trim();
    const management = String(row[columns.management] || '').trim();
    const projectCode = extractProjectCode(planningKey);
    if (!planningKey || !management || !projectCode) {
      rejectRow(report, 'chave, gestão ou obra ausente');
      continue;
    }

    const fallback = detailsFromKey(planningKey);
    const service = String(row[columns.service] || '').trim() || fallback.service;
    const input = String(row[columns.input] || '').trim() || fallback.input;
    const item = String(row[columns.item] || '').trim() || fallback.item;
    const aggregateKey = `${projectCode}|${planningKey}`;
    if (!aggregated.has(aggregateKey)) {
      aggregated.set(aggregateKey, {
        meta: {
          codigo_obra: projectCode,
          servico: service,
          insumo: input,
          item_cod: item,
        },
        values: {},
      });
    }

    const entry = aggregated.get(aggregateKey);
    entry.values[management] = (entry.values[management] || 0)
      + (parseNumber(row[columns.netValue]) || 0);
    managementNames.add(management);
    report.accepted += 1;

    if (management !== 'Atual') continue;
    const paymentDate = toIsoDate(String(row[columns.paymentMonth] || '').trim(), 'br');
    const value = parseNumber(row[columns.netValue]) || 0;
    if (!paymentDate || value <= 0) continue;
    projectionRows.push({
      codigo_obra: projectCode,
      servico: service,
      insumo: input,
      mes: paymentDate.slice(0, 7),
      valor: value,
    });
  }

  const managements = [...managementNames].sort((left, right) => {
    const leftKey = managementSortKey(left);
    const rightKey = managementSortKey(right);
    return leftKey[0] * 100 + leftKey[1] - (rightKey[0] * 100 + rightKey[1]);
  });
  const items = [...aggregated.entries()].map(([aggregateKey, entry]) => {
    const item = {
      key: aggregateKey.slice(aggregateKey.indexOf('|') + 1),
      ...entry.meta,
    };
    for (const management of managements) {
      item[management] = Math.round((entry.values[management] || 0) * 100) / 100;
    }
    return item;
  });

  if (!items.length) throw new Error('GESTÕES: nenhuma linha válida encontrada.');
  const totals = {};
  for (const item of items) {
    totals[item.codigo_obra] ||= {};
    for (const management of managements) {
      totals[item.codigo_obra][management] = Math.round(
        ((totals[item.codigo_obra][management] || 0) + (item[management] || 0)) * 100,
      ) / 100;
    }
  }

  return {
    history: { gestoes: managements, items, totals },
    projectionRows,
    report,
  };
}
