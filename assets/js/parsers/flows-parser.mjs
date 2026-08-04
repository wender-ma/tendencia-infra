import {
  classifyFlow,
  createImportReport,
  isoDateToBr,
  normalizeImportHeader,
  parseDelimitedRows,
  parseNumber,
  rejectRow,
  resolveImportColumns,
  toIsoDate,
} from './shared.mjs';

function createProjectLookup(projects) {
  const lookup = {};
  for (const project of projects || []) {
    if (!project?.codigo_obra) continue;
    const code = String(project.codigo_obra);
    const parts = code.split('-');
    if (parts.length >= 2) lookup[parts.slice(1).join('-')] = code;
    lookup[code] = code;
  }
  return lookup;
}

function normalizeReflected(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (['sim', 's', 'yes', 'refletido'].includes(normalized)) return 'sim';
  if (normalized === 'ipca') return 'ipca';
  if (normalized === 'incc') return 'incc';
  if (['não', 'nao', 'n', 'no'].includes(normalized)) return 'nao';
  return 'pendente';
}

function detectFlowDateOrder(rows, dateColumn, defaultOrder = 'br') {
  for (let index = 1; index < Math.min(rows.length, 250); index += 1) {
    const raw = String(rows[index]?.[dateColumn] || '')
      .trim()
      .split(/[ T]/)[0];
    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(?:\d{2}|\d{4})$/);
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 12 && second <= 12) return 'br';
    if (second > 12 && first <= 12) return 'us';
  }
  return defaultOrder;
}

function createPreviousFlowLookup(flows) {
  const lookup = new Map();
  for (const flow of flows || []) {
    const project = String(flow?.codigo_obra || '').trim();
    const amendment = String(flow?.n_alteracao || flow?.n_adt || '').trim();
    if (project && amendment) lookup.set(`${project}:${amendment}`, flow);
  }
  return lookup;
}

function resolveDepartment(currentArea, status, explicitDepartment) {
  if (explicitDepartment) return explicitDepartment;
  return normalizeImportHeader(currentArea) === 'fora da esteira de aprovacao'
    ? status
    : currentArea;
}

function resolveFlowValue(row, columns, previousFlow, report) {
  const approvedValue = parseNumber(row[columns.flowValue]);
  if (approvedValue != null) return approvedValue;

  if (previousFlow) {
    report.preservedFlowValues += 1;
    return previousFlow.custo_flowmaster ?? null;
  }

  const estimatedValue = parseNumber(row[columns.estimatedValue]);
  if (estimatedValue != null) report.estimatedValueFallbacks += 1;
  return estimatedValue;
}

export function discoverFlowProjectReferences(text) {
  const rows = parseDelimitedRows(text);
  const columns = resolveImportColumns('flows', rows);
  const references = new Set();
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const amendment = String(row[columns.amendment] || '').trim();
    const project = String(row[columns.project] || '').trim();
    if (/^\d+$/.test(amendment) && project) references.add(project);
  }
  return [...references];
}

export function parseFlowsFile(text, options = {}) {
  const rows = parseDelimitedRows(text);
  const columns = resolveImportColumns('flows', rows);
  if (rows.length < 2) throw new Error('FLOWS: arquivo sem linhas de dados.');

  const projectLookup = createProjectLookup(options.projects);
  const descriptionLimit = options.descriptionLimit || 300;
  const justificationLimit = options.justificationLimit || 400;
  const report = createImportReport(rows.length - 1);
  report.preservedFlowValues = 0;
  report.estimatedValueFallbacks = 0;
  const unknownProjects = new Set();
  const items = [];
  const previousFlows = createPreviousFlowLookup(options.previousFlows);
  const newModel = columns.sourceLabel >= 0 || columns.estimatedValue >= 0;
  const dateOrder = detectFlowDateOrder(rows, columns.createdAt, newModel ? 'us' : 'br');

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const amendment = String(row[columns.amendment] || '').trim();
    if (!/^\d+$/.test(amendment)) {
      rejectRow(report, 'código de aditivo inválido', true);
      continue;
    }

    const sourceProject = String(row[columns.project] || '').trim();
    const projectCode = projectLookup[sourceProject] || null;
    if (!projectCode) {
      unknownProjects.add(sourceProject || '(vazio)');
      rejectRow(report, 'obra não cadastrada');
      continue;
    }

    const rawDate = String(row[columns.createdAt] || '').trim();
    const date = toIsoDate(rawDate, dateOrder);
    if (rawDate && !date) {
      rejectRow(report, 'data inválida');
      continue;
    }

    const status = String(row[columns.status] || '').trim();
    const currentArea = String(row[columns.currentArea] || '').trim();
    const departmentValue = String(row[columns.department] || '').trim();
    const department = resolveDepartment(currentArea, status, departmentValue);
    const planningInput = String(row[columns.planningInput] || '').trim();
    const reallocationInput = String(row[columns.reallocationInput] || '').trim();
    const reflected = String(row[columns.reflected] || '').trim();
    const previousFlow = previousFlows.get(`${projectCode}:${amendment}`);

    items.push({
      n_alteracao: amendment,
      n_adt: amendment,
      codigo_obra: projectCode,
      dep: department,
      data: date,
      data_br: isoDateToBr(date),
      descricao: String(row[columns.description] || '')
        .trim()
        .slice(0, descriptionLimit),
      motivo: String(row[columns.reason] || '').trim(),
      justificativa: String(row[columns.justification] || '')
        .trim()
        .slice(0, justificationLimit),
      custo_flowmaster: resolveFlowValue(row, columns, previousFlow, report),
      custo_planejamento: parseNumber(row[columns.planningValue]),
      insumo_planejamento: planningInput,
      insumo_remanejamento: reallocationInput,
      tipo: classifyFlow(planningInput, reallocationInput),
      refletido_status: normalizeReflected(reflected),
      incl_tendencia: reflected,
      descr_status: status,
      descr_areaatual: currentArea,
      solicitante_dep: String(row[columns.requesterDepartment] || '').trim(),
      aprovador_dep: '',
      aprovador: '',
      solicitante: '',
      incl_orcamento: '',
      incl_planej: '',
      revisao_tendencia: '',
      obs: '',
    });
    report.accepted += 1;
  }

  if (!items.length) throw new Error('FLOWS: nenhum aditivo válido encontrado.');
  report.unknownProjects = [...unknownProjects];
  return { items, report, unknownProjects: [...unknownProjects] };
}
