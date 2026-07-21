export const IMPORT_HEADER_RULES = Object.freeze({
  tendencia: Object.freeze({
    label: 'TENDÊNCIA',
    fields: Object.freeze({
      code: { label: 'Código', alternatives: [['codigo'], ['cod']] },
      service: { label: 'Serviço', alternatives: [['servico']] },
      input: { label: 'Insumo', alternatives: [['insumo']] },
      item: { label: 'Item', alternatives: [['item']] },
      bidding: { label: 'Orçamento Licitação', alternatives: [['licitacao']] },
      ipca: { label: 'IPCA', alternatives: [['ipca']] },
      incc: { label: 'INCC', alternatives: [['incc']] },
      management: { label: 'Gestão', alternatives: [['gestao']] },
      difference: { label: 'Diferença', alternatives: [['diferenca']] },
      theoreticalEvolution: {
        label: 'Evolução Teórica',
        alternatives: [['evolucao', 'teorica']],
      },
      financialEvolution: {
        label: 'Evolução Financeira',
        alternatives: [['evolucao', 'financeira']],
      },
    }),
  }),
  flows: Object.freeze({
    label: 'FLOWS',
    fields: Object.freeze({
      amendment: { label: 'Cod_aditivo', alternatives: [['cod', 'aditivo']] },
      status: { label: 'Descr_status', alternatives: [['descr', 'status']] },
      currentArea: { label: 'Descr_areaatual', alternatives: [['descr', 'areaatual']] },
      requesterDepartment: {
        label: 'Descr_setorcriacao',
        alternatives: [['descr', 'setorcriacao']],
      },
      createdAt: { label: 'Data_criacao', alternatives: [['data', 'criacao']] },
      reason: { label: 'Descr_motivo', alternatives: [['descr', 'motivo']] },
      justification: {
        label: 'Descr_observacao_motivo',
        alternatives: [['descr', 'observacao', 'motivo']],
      },
      description: {
        label: 'Descr_descricaoaditivo',
        alternatives: [['descr', 'descricaoaditivo']],
      },
      project: { label: 'Cod_obra', alternatives: [['cod', 'obra']] },
      flowValue: {
        label: 'Valor Aprovado ou Solicitado',
        alternatives: [['valor', 'aprovado'], ['valor', 'solicitado']],
      },
      planningValue: {
        label: 'Vlr_planejamento',
        alternatives: [['vlr', 'planejamento'], ['valor', 'planejamento']],
      },
      department: { label: 'Departamento', alternatives: [['departamento']] },
      planningInput: {
        label: 'Ins. Planej.',
        alternatives: [['ins', 'planej'], ['insumo', 'planejamento']],
      },
      reallocationInput: {
        label: 'Ins. Remanej.',
        alternatives: [['ins', 'remanej'], ['insumo', 'remanejamento']],
      },
      reflected: { label: 'Refletido', alternatives: [['refletido']] },
    }),
  }),
  gestoes: Object.freeze({
    label: 'GESTÕES',
    fields: Object.freeze({
      management: { label: 'Descr_gestao', alternatives: [['descr', 'gestao']] },
      financialClassification: {
        label: 'Descr_classificacaofinanceira',
        alternatives: [['descr', 'classificacaofinanceira']],
      },
      planningKey: { label: 'Key_planejamento', alternatives: [['key', 'planejamento']] },
      netValue: {
        label: 'Val_totalliquido',
        alternatives: [['val', 'totalliquido'], ['valor', 'total', 'liquido']],
      },
      paymentMonth: { label: 'Mes_pagamento', alternatives: [['mes', 'pagamento']] },
    }),
    optionalFields: Object.freeze({
      input: { alternatives: [['insumo']] },
      item: { alternatives: [['item']] },
      service: { alternatives: [['servico']] },
    }),
  }),
});

export function parseNumber(value, options = {}) {
  if (value == null) return null;
  let raw = String(value).trim();
  if (!raw || raw === '-' || raw.includes('#REF')) return null;

  const hadPercent = raw.includes('%');
  raw = raw.replace(/R\$/g, '').replace(/\s/g, '').replace(/%/g, '');
  if (options.allowPlus) raw = raw.replace(/^\+/, '');
  if (!raw) return null;

  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  let normalized;
  if (lastComma > lastDot) {
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    normalized = raw.replace(/,/g, '');
  } else {
    normalized = raw.replace(',', '.');
  }

  if (/[eE]/.test(normalized)) return null;
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  if (options.isPercentage && !hadPercent && number > 0 && number <= 1.5) {
    return number * 100;
  }
  return number;
}

export function normalizeImportHeader(value) {
  return String(value || '')
    .replace(/^\ufeff/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function headerMatches(value, alternatives) {
  const normalized = normalizeImportHeader(value);
  return alternatives.some(terms => terms.every(term => normalized.includes(term)));
}

function findHeaderIndex(headers, alternatives) {
  const exactIndex = headers.findIndex(value => {
    const normalized = normalizeImportHeader(value);
    return alternatives.some(terms => normalized === terms.join(' '));
  });
  if (exactIndex >= 0) return exactIndex;
  return headers.findIndex(value => headerMatches(value, alternatives));
}

function countDelimiters(text, delimiter) {
  let count = 0;
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') index += 1;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && character === delimiter) {
      count += 1;
    } else if (!inQuotes && (character === '\n' || character === '\r')) {
      break;
    }
  }
  return count;
}

export function detectDelimiter(text) {
  const candidates = [';', '\t', ','];
  const scores = candidates.map(delimiter => [delimiter, countDelimiters(text, delimiter)]);
  scores.sort((left, right) => right[1] - left[1]);
  if (!scores[0][1]) {
    throw new Error('CSV: delimitador não identificado. Use ponto e vírgula, vírgula ou tabulação.');
  }
  return scores[0][0];
}

export function parseDelimitedRows(text, delimiter = null) {
  if (typeof text !== 'string') throw new Error('CSV: conteúdo inválido.');
  const source = text.replace(/^\ufeff/, '');
  if (!source.trim()) throw new Error('CSV: arquivo vazio.');
  if (source.includes('\ufffd')) {
    throw new Error('CSV: encoding inválido. Exporte novamente como UTF-8.');
  }

  const separator = delimiter || detectDelimiter(source);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let closedQuote = false;

  const pushRow = () => {
    row.push(field);
    if (row.some(value => value.trim() !== '')) rows.push(row);
    row = [];
    field = '';
    closedQuote = false;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (inQuotes) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
        closedQuote = true;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field.trim()) throw new Error(`CSV: aspas malformadas próximas à linha ${rows.length + 1}.`);
      inQuotes = true;
      closedQuote = false;
    } else if (character === separator) {
      row.push(field);
      field = '';
      closedQuote = false;
    } else if (character === '\n') {
      pushRow();
    } else if (character === '\r') {
      if (next !== '\n') pushRow();
    } else if (closedQuote && !/\s/.test(character)) {
      throw new Error(`CSV: conteúdo inesperado após aspas na linha ${rows.length + 1}.`);
    } else if (!closedQuote) {
      field += character;
    }
  }

  if (inQuotes) throw new Error('CSV: campo entre aspas não foi encerrado.');
  if (field || row.length) pushRow();
  return rows;
}

export function resolveImportColumns(kind, rows) {
  const rules = IMPORT_HEADER_RULES[kind];
  if (!rules) throw new Error(`Tipo de importação desconhecido: ${kind}`);
  if (!Array.isArray(rows) || !rows.length || !rows[0].some(cell => String(cell || '').trim())) {
    throw new Error(`${rules.label}: arquivo vazio ou sem linha de cabeçalho.`);
  }

  const headers = rows[0];
  const indexes = {};
  const missing = [];
  for (const [field, rule] of Object.entries(rules.fields)) {
    const index = findHeaderIndex(headers, rule.alternatives);
    if (index < 0) missing.push(rule.label);
    else indexes[field] = index;
  }

  if (missing.length) {
    throw new Error(
      `${rules.label}: cabeçalho inválido (ausentes: ${missing.join(', ')}). ` +
      'Nenhum dado foi importado. Confirme o layout e exporte o arquivo em CSV UTF-8.'
    );
  }

  for (const [field, rule] of Object.entries(rules.optionalFields || {})) {
    indexes[field] = findHeaderIndex(headers, rule.alternatives);
  }
  return indexes;
}

export function validateImportHeaders(kind, rows) {
  resolveImportColumns(kind, rows);
  return rows[0];
}

function normalizeDateYear(rawYear) {
  const year = Number(rawYear);
  if (!Number.isInteger(year)) return null;
  if (String(rawYear).length === 2) return year >= 70 ? 1900 + year : 2000 + year;
  return year;
}

function isValidCalendarDate(year, month, day) {
  if (![year, month, day].every(Number.isInteger)) return false;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function toIsoDate(value, preferredOrder = 'br') {
  if (value == null || value === '') return null;
  const raw = String(value).trim().split(/[ T]/)[0];
  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (!isValidCalendarDate(year, month, day)) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!slashMatch) return null;
  const first = Number(slashMatch[1]);
  const second = Number(slashMatch[2]);
  const year = normalizeDateYear(slashMatch[3]);
  let order = preferredOrder;
  if (first > 12 && second <= 12) order = 'br';
  else if (second > 12 && first <= 12) order = 'us';
  else if (first > 12 && second > 12) return null;

  const day = order === 'us' ? second : first;
  const month = order === 'us' ? first : second;
  if (!isValidCalendarDate(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isoDateToBr(value) {
  const iso = toIsoDate(value);
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

export function normalizeInput(value) {
  const normalized = String(value || '').trim();
  if (['', '-', 'Não encontrado!', 'Cancelado'].includes(normalized)) return normalized;
  if (normalized.toUpperCase().includes('VERIFICAR')) return 'VERIFICAR';
  return normalized;
}

export function classifyFlow(planningInput, reallocationInput) {
  const planning = normalizeInput(planningInput);
  const reallocation = normalizeInput(reallocationInput);
  const invalid = ['', '-', 'Não encontrado!', 'VERIFICAR', 'Cancelado'];
  const isReal = value => value && !invalid.includes(value);

  if (planning === 'Cancelado' || reallocation === 'Cancelado') return 'cancelado';
  if (planning === 'Não encontrado!' || reallocation === 'VERIFICAR') return 'pendente';
  if (isReal(planning) && isReal(reallocation)) return 'remanejamento';
  if (isReal(planning) && reallocation === '-') return 'aumento_real';
  if (planning === '-' && isReal(reallocation)) return 'economia';
  if (!isReal(planning) && !isReal(reallocation)) return 'sem_classificacao';
  return 'misto';
}

export function createImportReport(totalRows) {
  return {
    total: Math.max(0, totalRows),
    accepted: 0,
    ignored: 0,
    rejected: 0,
    reasons: {},
  };
}

export function rejectRow(report, reason, ignored = false) {
  const key = reason || 'inválida';
  if (ignored) report.ignored += 1;
  else report.rejected += 1;
  report.reasons[key] = (report.reasons[key] || 0) + 1;
}
