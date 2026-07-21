import { parseFlowsFile } from './flows-parser.mjs';
import { parseGestoesFile } from './gestoes-parser.mjs';
import { parseTendenciaFile } from './tendencia-parser.mjs';
import {
  classifyFlow,
  isoDateToBr,
  normalizeImportHeader,
  normalizeInput,
  parseDelimitedRows,
  parseNumber,
  toIsoDate,
  validateImportHeaders,
} from './shared.mjs';

function persistTendencyEvolution(
  state,
  evolution,
  { canEdit, storage, saveDashboardKey, reportError },
) {
  if (!canEdit() || !state.obra.ativa) return;
  const serialized = JSON.stringify(evolution);
  storage.set('jzurique_evol_global', serialized);

  Promise.resolve(saveDashboardKey(`${state.obra.ativa}:evol_global`, serialized)).catch((error) =>
    reportError(
      'Tendência/salvar evolução remota',
      error,
      'A evolução foi importada, mas não foi sincronizada.',
    ),
  );
}

export function createImportParserService({
  state,
  config,
  monitor,
  canEdit = () => false,
  storage,
  saveDashboardKey = async () => {},
  reportError = () => {},
}) {
  const reports = { tendencia: null, flows: null, gestoes: null };
  const measured = (name, operation) =>
    monitor ? monitor.measure(`parse:${name}`, operation) : operation();

  const parseTendency = (text, options = {}) =>
    measured('tendencia', () =>
      parseTendenciaFile(text, {
        correctionIndex: options.correctionIndex ?? state.config.correcaoIndice,
        groups: options.groups ?? config.grupos_map,
      }),
    );
  const parseFlows = (text, options = {}) =>
    measured('flows', () =>
      parseFlowsFile(text, {
        projects: options.projects ?? state.obra.obras,
        descriptionLimit: options.descriptionLimit ?? config.max_descricao_flow,
        justificationLimit: options.justificationLimit ?? config.max_justificativa_flow,
      }),
    );
  const parseManagements = (text) => measured('gestoes', () => parseGestoesFile(text));

  function applyTendency(text) {
    const result = parseTendency(text);
    state.config.gestaoLabel = result.managementLabel || state.config.gestaoLabel;
    state.config.evolGlobal = result.evolution;
    reports.tendencia = result.report;
    persistTendencyEvolution(state, result.evolution, {
      canEdit,
      storage,
      saveDashboardKey,
      reportError,
    });
    return result.items;
  }

  function applyFlows(text) {
    const result = parseFlows(text);
    reports.flows = result.report;
    if (result.unknownProjects.length) {
      console.warn(`[FLOWS] obras não cadastradas: ${result.unknownProjects.join(', ')}`);
    }
    return result.items;
  }

  function applyManagements(text) {
    const result = parseManagements(text);
    state.dados.projRaw = result.projectionRows;
    reports.gestoes = result.report;
    return result.history;
  }

  return Object.freeze({
    parseNumber,
    parseDelimitedRows,
    normalizeImportHeader,
    validateImportHeaders,
    normalizeInput,
    classifyFlow,
    toIsoDate,
    isoDateToBr,
    parseTendencia: parseTendency,
    parseFlows,
    parseGestoes: parseManagements,
    applyTendency,
    applyFlows,
    applyManagements,
    reports,
  });
}
