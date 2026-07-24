const GLOBAL_KEYS = Object.freeze({
  dados_flows: 'flows',
  dados_historico: 'historico',
  dados_projraw: 'projecao_raw',
});

const GLOBAL_TYPES = Object.freeze(['flows', 'historico', 'projecao_raw']);
const PROJECT_KEY_PATTERN = /^([^:]+):dados_tendencia$/;
const UNSUPPORTED_PROJECT_FLOWS_PATTERN = /^[^:]+:dados_flows$/;
const SAFE_PROJECT_PATTERN = /^[^/\\\u0000-\u001f\u007f]+$/;

function parseDataset(row, type) {
  let data;
  try {
    data = JSON.parse(String(row.valor || ''));
  } catch {
    throw new Error(`Dataset legado ${type} possui JSON invalido`);
  }

  const valid =
    type === 'historico'
      ? data && Array.isArray(data.items) && data.items.length > 0
      : Array.isArray(data) && data.length > 0;
  if (!valid) throw new Error(`Dataset legado ${type} esta vazio ou possui formato invalido`);
  return data;
}

function rowCount(type, data) {
  return type === 'historico' ? data.items.length : data.length;
}

function classifyRow(row) {
  const key = String(row?.chave || '').trim();
  if (GLOBAL_KEYS[key]) {
    return { scope: 'global', type: GLOBAL_KEYS[key], projectCode: null, key };
  }
  if (UNSUPPORTED_PROJECT_FLOWS_PATTERN.test(key)) {
    throw new Error(
      'Foi encontrada uma chave dados_flows por obra; o modelo global exige revisao manual',
    );
  }
  const projectMatch = key.match(PROJECT_KEY_PATTERN);
  if (!projectMatch) throw new Error('A consulta de backfill retornou uma chave inesperada');

  const projectCode = projectMatch[1].trim();
  if (!projectCode || projectCode === '_global' || !SAFE_PROJECT_PATTERN.test(projectCode)) {
    throw new Error('Uma chave legada possui codigo de obra inseguro para o Storage');
  }
  return { scope: 'project', type: 'tendencia', projectCode, key };
}

export function buildBackfillPlan(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Nenhum dataset legado foi encontrado para backfill');
  }

  const identities = new Set();
  const entries = rows.map((row) => {
    const classification = classifyRow(row);
    const identity = `${classification.projectCode || '_global'}:${classification.type}`;
    if (identities.has(identity)) {
      throw new Error(`Dataset legado duplicado para ${classification.type}`);
    }
    identities.add(identity);

    const data = parseDataset(row, classification.type);
    return {
      ...classification,
      data,
      rows: rowCount(classification.type, data),
      bytes: Buffer.byteLength(String(row.valor || ''), 'utf8'),
    };
  });

  const presentGlobalTypes = new Set(
    entries.filter((entry) => entry.scope === 'global').map((entry) => entry.type),
  );
  const missingGlobalTypes = GLOBAL_TYPES.filter((type) => !presentGlobalTypes.has(type));
  if (missingGlobalTypes.length) {
    throw new Error(`Datasets globais ausentes: ${missingGlobalTypes.join(', ')}`);
  }
  if (!entries.some((entry) => entry.scope === 'project')) {
    throw new Error('Nenhum dataset de Tendencia por obra foi encontrado');
  }

  return entries.sort((left, right) => {
    const scopeOrder = left.scope.localeCompare(right.scope);
    return scopeOrder || left.type.localeCompare(right.type);
  });
}

export function summarizeBackfillPlan(entries, { mode, applied = false } = {}) {
  const rowsByType = {};
  for (const entry of entries) {
    rowsByType[entry.type] = (rowsByType[entry.type] || 0) + entry.rows;
  }

  return {
    mode,
    applied,
    dataset_count: entries.length,
    project_dataset_count: entries.filter((entry) => entry.scope === 'project').length,
    global_dataset_count: entries.filter((entry) => entry.scope === 'global').length,
    project_count: new Set(
      entries.filter((entry) => entry.projectCode).map((entry) => entry.projectCode),
    ).size,
    legacy_bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    types: [...new Set(entries.map((entry) => entry.type))].sort(),
    rows_by_type: Object.fromEntries(
      Object.entries(rowsByType).sort(([left], [right]) => left.localeCompare(right)),
    ),
    legacy_keys_preserved: true,
  };
}

export function assertProductionTarget({ environment, projectUrl, projectRef }) {
  if (environment !== 'production') {
    throw new Error('O backfill aceita somente VITE_APP_ENV=production');
  }
  let url;
  try {
    url = new URL(projectUrl);
  } catch {
    throw new Error('VITE_SUPABASE_URL invalida');
  }
  if (
    url.protocol !== 'https:' ||
    url.pathname !== '/' ||
    url.hostname !== `${projectRef}.supabase.co`
  ) {
    throw new Error('A URL do Supabase nao corresponde ao project ref confirmado');
  }
}

export function assertBackfillMode({ mode, writeOptIn, confirmation }) {
  if (!['plan', 'apply'].includes(mode)) {
    throw new Error('Use --mode plan ou --mode apply');
  }
  if (mode === 'apply') {
    if (writeOptIn !== '1') {
      throw new Error('Defina ALLOW_PRODUCTION_BACKFILL=1 para autorizar escritas');
    }
    if (confirmation !== 'BACKFILL_LEGACY_DATASETS') {
      throw new Error('Confirme a operacao com --confirmation BACKFILL_LEGACY_DATASETS');
    }
  }
}
