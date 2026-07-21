const STORAGE_KEYS = Object.freeze({
  evolution: 'jzurique_evol_global',
  cardMode: 'jzurique_card3_modo',
  correctionIndex: 'jzurique_indice_correcao',
});

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

const LEGACY_ALIASES = Object.freeze({
  DATA_T: ['dados', 'tendencia'],
  DATA_F: ['dados', 'flows'],
  HISTORICO: ['dados', 'historico'],
  PROJ_RAW: ['dados', 'projRaw'],
  sortKey: ['sort', 'key'],
  sortDir: ['sort', 'dir'],
  sortKeyF: ['sort', 'keyF'],
  sortDirF: ['sort', 'dirF'],
  GESTAO_LABEL: ['config', 'gestaoLabel'],
  EVOL_GLOBAL: ['config', 'evolGlobal'],
  CARD3_MODO: ['config', 'card3Modo'],
  CORRECAO_INDICE: ['config', 'correcaoIndice'],
  _headerEditable: ['config', 'headerEditable'],
  OBRAS: ['obra', 'obras'],
  OBRA_ATIVA: ['obra', 'ativa'],
  MAP_DESTINO: ['links', 'destino'],
  MAP_ORIGEM: ['links', 'origem'],
  donutHidden: ['donut', 'hidden'],
  _lastTipoSum: ['donut', 'lastTipoSum'],
});

function aliasDescriptor(state, [section, property]) {
  return {
    configurable: true,
    get: () => state[section][property],
    set: (value) => {
      state[section][property] = value;
    },
  };
}

export function installLegacyStateGlobals(state, target = window) {
  Object.defineProperty(target, 'AppState', {
    configurable: true,
    value: state,
  });

  const descriptors = Object.fromEntries(
    Object.entries(LEGACY_ALIASES).map(([name, path]) => [name, aliasDescriptor(state, path)]),
  );
  descriptors.LAST_UPLOADS = {
    configurable: true,
    get: () => state.uploads,
  };
  Object.defineProperties(target, descriptors);
  target.dashboardState = state;
}
