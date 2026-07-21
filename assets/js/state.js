import { STORAGE_KEYS } from './config.js';

function getBrowserStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    console.warn('[STATE] armazenamento local indisponivel:', error);
    return null;
  }
}

function readStorage(storage, key, fallback) {
  try {
    return storage?.getItem(key) || fallback;
  } catch (error) {
    console.warn(`[STATE] falha ao ler ${key}:`, error);
    return fallback;
  }
}

function readEvolution(storage) {
  const raw = readStorage(storage, STORAGE_KEYS.evolution, null);
  if (!raw) return { teorica: null, financeira: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.teorica != null || parsed.financeira != null)) return parsed;
  } catch (error) {
    console.warn('[STATE] evolucao local invalida:', error);
  }
  return { teorica: null, financeira: null };
}

export function createAppState({ storage = getBrowserStorage() } = {}) {
  return {
    dados: {
      tendencia: [],
      flows: [],
      historico: { gestoes: [], items: [], totals: {} },
      projRaw: [],
    },
    sort: {
      key: 'aditivo_total',
      dir: -1,
      keyF: 'data',
      dirF: -1,
    },
    config: {
      gestaoLabel: 'Gestão Atual',
      evolGlobal: readEvolution(storage),
      card3Modo: readStorage(storage, STORAGE_KEYS.cardMode, 'bruto'),
      correcaoIndice: readStorage(storage, STORAGE_KEYS.correctionIndex, 'incc'),
      headerEditable: false,
    },
    obra: {
      obras: [],
      ativa: null,
    },
    links: {
      destino: {},
      origem: {},
    },
    uploads: {
      tendencia: null,
      flows: null,
      gestoes: null,
    },
    donut: {
      hidden: new Set(),
      lastTipoSum: null,
    },
  };
}
