import { normalizeImportHeader, parseDelimitedRows, parseNumber } from './shared.mjs';

const SERIES = Object.freeze(['base', 'planned', 'actual']);
const PERCENT_TOLERANCE = 0.1;

function monthKey(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`;
  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) return `${match[3]}-${String(Number(match[2])).padStart(2, '0')}`;
  return '';
}

function parseDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return text;
  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return '';
  return `${match[3]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`;
}

function parseExportDate(rows) {
  const title = String(rows?.[0]?.[0] || '');
  const match = title.match(/exportad[oa]\s+em\s+(\d{1,2}[/-]\d{1,2}[/-]\d{4})/i);
  return match ? parseDate(match[1]) : '';
}

function assertMonotonic(item, months) {
  for (const series of SERIES) {
    let previous = 0;
    for (const month of months) {
      const value = item.monthly[month][series];
      if (value + PERCENT_TOLERANCE < previous) {
        throw new Error(
          `Cronograma Físico: ${item.code} · ${item.description} possui ${series} acumulado decrescente em ${month}.`,
        );
      }
      previous = value;
    }
  }
}

function weightedCurve(items, months) {
  return months.map((month) => {
    const point = { month, base: 0, planned: 0, actual: 0 };
    for (const item of items) {
      for (const series of SERIES) {
        point[series] += item.weight * item.monthly[month][series];
      }
    }
    return point;
  });
}

function inferCutoff(curve) {
  let index = 0;
  for (let current = 1; current < curve.length; current += 1) {
    if (Math.abs(curve[current].actual - curve[current - 1].actual) >= 0.0001) index = current;
  }
  return curve[index]?.month || '';
}

export function normalizePhysicalScheduleCurve(curve, officialEvolution, cutoffMonth) {
  const cutoffIndex = curve.findIndex((point) => point.month === cutoffMonth);
  if (cutoffIndex < 0) return curve.map((point) => ({ ...point }));
  const official = Math.min(100, Math.max(0, Number(officialEvolution) || 0));
  const rawActual = curve[cutoffIndex].actual;
  const rawPlanned = curve[cutoffIndex].planned;
  const actualScale = rawActual > 0 ? official / rawActual : 1;
  const plannedRemaining = Math.max(0.0001, 100 - rawPlanned);
  const officialRemaining = Math.max(0, 100 - official);

  return curve.map((point, index) => {
    const actual =
      index <= cutoffIndex ? Math.min(official, Math.max(0, point.actual * actualScale)) : official;
    const planned =
      index <= cutoffIndex
        ? Math.min(official, Math.max(0, point.planned * actualScale))
        : Math.min(
            100,
            Math.max(
              official,
              official + ((point.planned - rawPlanned) / plannedRemaining) * officialRemaining,
            ),
          );
    return { ...point, actual, planned };
  });
}

export function parsePhysicalScheduleFile(text) {
  const rows = parseDelimitedRows(text);
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(normalizeImportHeader);
    return (
      headers.includes('codigo eap') &&
      headers.includes('descricao') &&
      headers.includes('total r') &&
      headers.includes('base') &&
      headers.includes('previsto') &&
      headers.includes('realizado')
    );
  });
  if (headerIndex < 1) {
    throw new Error(
      'Cronograma Físico: cabeçalho não identificado. Esperado: Código EAP, Descrição, Total (R$), Base, Previsto e Realizado.',
    );
  }

  const headers = rows[headerIndex].map(normalizeImportHeader);
  const dateRow = rows[headerIndex - 1] || [];
  const levelIndex = headers.indexOf('nivel');
  const codeIndex = headers.indexOf('codigo eap');
  const descriptionIndex = headers.indexOf('descricao');
  const startIndex = headers.indexOf('inicio');
  const endIndex = headers.indexOf('fim');
  const materialIndex = headers.indexOf('material r');
  const laborIndex = headers.indexOf('mao de obra r');
  const totalIndex = headers.indexOf('total r');
  const firstSeriesIndex = headers.findIndex(
    (header, index) => index > totalIndex && header === 'base',
  );
  if (
    [codeIndex, descriptionIndex, startIndex, endIndex, totalIndex, firstSeriesIndex].some(
      (v) => v < 0,
    )
  ) {
    throw new Error('Cronograma Físico: estrutura obrigatória incompleta.');
  }

  const monthColumns = [];
  for (let index = firstSeriesIndex; index < headers.length; index += 3) {
    const triple = headers.slice(index, index + 3);
    if (!triple.some(Boolean)) break;
    if (triple.join('|') !== 'base|previsto|realizado') {
      throw new Error(`Cronograma Físico: trio mensal inválido a partir da coluna ${index + 1}.`);
    }
    const month = monthKey(dateRow[index + 1] || dateRow[index] || dateRow[index + 2]);
    if (!month) throw new Error(`Cronograma Físico: mês inválido na coluna ${index + 2}.`);
    if (monthColumns.some((entry) => entry.month === month)) {
      throw new Error(`Cronograma Físico: mês duplicado (${month}).`);
    }
    monthColumns.push({ month, index });
  }
  const months = monthColumns.map((entry) => entry.month);
  if (!months.length || months.some((month, index) => index && month <= months[index - 1])) {
    throw new Error('Cronograma Físico: os meses devem estar em ordem cronológica.');
  }

  const warnings = [];
  let clippedPercentages = 0;
  const codes = new Set();
  const items = rows
    .slice(headerIndex + 1)
    .filter(
      (row) => String(row[codeIndex] || '').trim() || String(row[descriptionIndex] || '').trim(),
    )
    .map((row, offset) => {
      const sourceRow = headerIndex + offset + 2;
      const code = String(row[codeIndex] || '').trim();
      const description = String(row[descriptionIndex] || '').trim();
      if (!code || !description) {
        throw new Error(`Cronograma Físico: código ou descrição ausente na linha ${sourceRow}.`);
      }
      if (codes.has(code)) throw new Error(`Cronograma Físico: Código EAP duplicado (${code}).`);
      codes.add(code);

      const total = parseNumber(row[totalIndex]);
      if (!(total > 0)) {
        throw new Error(`Cronograma Físico: Total (R$) inválido para ${code} · ${description}.`);
      }
      const material = parseNumber(row[materialIndex]) || 0;
      const labor = parseNumber(row[laborIndex]) || 0;
      if (Math.abs(material + labor - total) > 0.02) {
        throw new Error(
          `Cronograma Físico: Material + Mão de obra não reconcilia com o total de ${code}.`,
        );
      }
      const start = parseDate(row[startIndex]);
      const end = parseDate(row[endIndex]);
      if (!start || !end || start > end) {
        throw new Error(`Cronograma Físico: intervalo de datas inválido para ${code}.`);
      }

      const monthly = {};
      for (const entry of monthColumns) {
        monthly[entry.month] = {};
        SERIES.forEach((series, seriesIndex) => {
          const parsed = parseNumber(row[entry.index + seriesIndex]);
          const value = parsed == null ? 0 : parsed;
          if (value < 0 || value > 100 + PERCENT_TOLERANCE) {
            throw new Error(
              `Cronograma Físico: percentual fora de 0% a 100% para ${code} em ${entry.month}.`,
            );
          }
          if (value > 100) clippedPercentages += 1;
          monthly[entry.month][series] = Math.min(100, value);
        });
      }
      const item = {
        level: Number.parseInt(row[levelIndex], 10) || 1,
        code,
        description,
        start,
        end,
        total,
        monthly,
      };
      assertMonotonic(item, months);
      return item;
    });

  if (!items.length) throw new Error('Cronograma Físico: nenhuma atividade válida encontrada.');
  const totalValue = items.reduce((sum, item) => sum + item.total, 0);
  items.forEach((item) => {
    item.weight = item.total / totalValue;
  });
  if (clippedPercentages) {
    warnings.push(
      `${clippedPercentages} percentual(is) entre 100% e 100,10% foram limitados a 100%.`,
    );
  }
  const curve = weightedCurve(items, months);
  const suggestedCutoff = inferCutoff(curve);

  return {
    items,
    months,
    curve,
    suggestedCutoff,
    exportDate: parseExportDate(rows),
    totalWeightValue: totalValue,
    report: {
      rowsRead: rows.length,
      imported: items.length,
      months: months.length,
      clippedPercentages,
      warnings,
    },
  };
}
