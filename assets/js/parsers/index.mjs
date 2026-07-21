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

function persistTendencyEvolution(target, state, evolution) {
  if (!target.isEditorDaObraAtiva?.() || !state.obra.ativa) return;
  const serialized = JSON.stringify(evolution);
  try {
    target.localStorage?.setItem('jzurique_evol_global', serialized);
  } catch (error) {
    target.reportNonFatalError?.('Tendência/salvar evolução local', error);
  }

  if (typeof target.supaSaveDashboardKey !== 'function') return;
  Promise.resolve(target.supaSaveDashboardKey(`${state.obra.ativa}:evol_global`, serialized))
    .catch(error => target.reportNonFatalError?.(
      'Tendência/salvar evolução remota',
      error,
      'A evolução foi importada, mas não foi sincronizada.',
    ));
}

export function installLegacyImportParsers({ state, config, target = window }) {
  const reports = { tendencia: null, flows: null, gestoes: null };

  const service = Object.freeze({
    parseNumber,
    parseTendencia: (text, options = {}) => parseTendenciaFile(text, {
      correctionIndex: options.correctionIndex ?? state.config.correcaoIndice,
      groups: options.groups ?? config.grupos_map,
    }),
    parseFlows: (text, options = {}) => parseFlowsFile(text, {
      projects: options.projects ?? state.obra.obras,
      descriptionLimit: options.descriptionLimit ?? config.max_descricao_flow,
      justificationLimit: options.justificationLimit ?? config.max_justificativa_flow,
    }),
    parseGestoes: parseGestoesFile,
  });

  Object.assign(target, {
    parseNumero: parseNumber,
    parseCSVRows: parseDelimitedRows,
    normalizeImportHeader,
    validateImportHeaders,
    normInsumo: normalizeInput,
    classifyFlow,
    toIsoDate,
    isoDateToBr,
    parseTendencia(text) {
      const result = service.parseTendencia(text);
      state.config.gestaoLabel = result.managementLabel || state.config.gestaoLabel;
      state.config.evolGlobal = result.evolution;
      reports.tendencia = result.report;
      persistTendencyEvolution(target, state, result.evolution);
      return result.items;
    },
    parseFlowsValor(text) {
      const result = service.parseFlows(text);
      reports.flows = result.report;
      if (result.unknownProjects.length) {
        console.warn(
          `[FLOWS] obras não cadastradas: ${result.unknownProjects.join(', ')}`,
        );
      }
      return result.items;
    },
    parseGestoes(text) {
      const result = service.parseGestoes(text);
      state.dados.projRaw = result.projectionRows;
      reports.gestoes = result.report;
      return result.history;
    },
  });

  Object.defineProperty(target, 'LAST_IMPORT_REPORTS', {
    configurable: true,
    get: () => reports,
  });
  return service;
}
