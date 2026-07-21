import {
  classifyFlow,
  createImportReport,
  isoDateToBr,
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
  const normalized = String(value || '').trim().toLowerCase();
  if (['sim', 's', 'yes', 'refletido'].includes(normalized)) return 'sim';
  if (['não', 'nao', 'n', 'no'].includes(normalized)) return 'nao';
  return 'pendente';
}

export function parseFlowsFile(text, options = {}) {
  const rows = parseDelimitedRows(text);
  const columns = resolveImportColumns('flows', rows);
  if (rows.length < 2) throw new Error('FLOWS: arquivo sem linhas de dados.');

  const projectLookup = createProjectLookup(options.projects);
  const descriptionLimit = options.descriptionLimit || 300;
  const justificationLimit = options.justificationLimit || 400;
  const report = createImportReport(rows.length - 1);
  const unknownProjects = new Set();
  const items = [];

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
    const date = toIsoDate(rawDate, 'br');
    if (rawDate && !date) {
      rejectRow(report, 'data inválida');
      continue;
    }

    const status = String(row[columns.status] || '').trim();
    const currentArea = String(row[columns.currentArea] || '').trim();
    const departmentValue = String(row[columns.department] || '').trim();
    const department = departmentValue
      || (currentArea === 'Fora da Esteira de Aprovação' ? status : currentArea);
    const planningInput = String(row[columns.planningInput] || '').trim();
    const reallocationInput = String(row[columns.reallocationInput] || '').trim();
    const reflected = String(row[columns.reflected] || '').trim();

    items.push({
      n_alteracao: amendment,
      n_adt: amendment,
      codigo_obra: projectCode,
      dep: department,
      data: date,
      data_br: isoDateToBr(date),
      descricao: String(row[columns.description] || '').trim().slice(0, descriptionLimit),
      motivo: String(row[columns.reason] || '').trim(),
      justificativa: String(row[columns.justification] || '').trim().slice(0, justificationLimit),
      custo_flowmaster: parseNumber(row[columns.flowValue]),
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
  return { items, report, unknownProjects: [...unknownProjects] };
}
