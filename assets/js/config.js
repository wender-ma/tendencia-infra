function readEnvironment(name, fallback = '') {
  const value = import.meta.env?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

const buildMode = readEnvironment('MODE', 'development');
const declaredEnvironment = readEnvironment('VITE_APP_ENV');
const requestedSupabaseUrl = readEnvironment('VITE_SUPABASE_URL');
const requestedSupabaseAnonKey = readEnvironment('VITE_SUPABASE_ANON_KEY');
const requestedDatasetPersistenceMode = readEnvironment(
  'VITE_DATASET_PERSISTENCE_MODE',
  'dual',
).toLowerCase();
const allowSelfSignup = readEnvironment('VITE_ALLOW_SELF_SIGNUP', 'false').toLowerCase() === 'true';
const datasetPersistenceMode = ['dual', 'snapshots'].includes(requestedDatasetPersistenceMode)
  ? requestedDatasetPersistenceMode
  : 'dual';
const hasSupabaseCredentials = Boolean(requestedSupabaseUrl && requestedSupabaseAnonKey);
const configurationStatus = !hasSupabaseCredentials
  ? 'missing-credentials'
  : !declaredEnvironment
    ? 'missing-environment'
    : declaredEnvironment !== buildMode
      ? 'environment-mismatch'
      : 'ready';
const canConnectToSupabase = configurationStatus === 'ready';

export const SUPABASE_CONFIG = Object.freeze({
  url: canConnectToSupabase ? requestedSupabaseUrl : '',
  anonKey: canConnectToSupabase ? requestedSupabaseAnonKey : '',
  environment: declaredEnvironment || 'unconfigured',
  buildMode,
  configurationStatus,
});

export const DATASET_PERSISTENCE_CONFIG = Object.freeze({
  mode: datasetPersistenceMode,
  configurationStatus:
    datasetPersistenceMode === requestedDatasetPersistenceMode ? 'ready' : 'invalid-mode',
});

export const AUTH_CONFIG = Object.freeze({
  allowSelfSignup,
});

export const STORAGE_KEYS = Object.freeze({
  header: 'jzurique_header_title',
  classifications: 'jzurique_flow_classifications_v1',
  manuals: 'jzurique_flow_manuals_v1',
  projectionControl: 'jzurique_proj_ctrl_v1',
  projectionSettings: 'jzurique_proj_settings_v1',
  projectionColumnWidths: 'jzurique_proj_column_widths_v1',
  activeProject: 'jzurique_obra_ativa',
  evolution: 'jzurique_evol_global',
  cardMode: 'jzurique_card3_modo',
  correctionIndex: 'jzurique_indice_correcao',
});

export const DASHBOARD_CONFIG = Object.freeze({
  tolerancia_centavos: 1,
  tolerancia_conferencia: 1.0,
  tolerancia_projecao: 10000,
  max_uploads_por_tipo: 12,
  max_linhas_tabela: 1000,
  table_page_size: 100,
  max_descricao_flow: 300,
  max_justificativa_flow: 400,
  debounce_render: 200,
  toast_duration_info: 3500,
  toast_duration_ok: 2500,
  toast_duration_warn: 5000,
  toast_duration_err: 5000,
  obra_default: '42-21O',
  insumo_controlado: 'I011890',
  janela_ritmo_historico: 6,
  grupos_map: Object.freeze({
    '01.01': 'Custos Indiretos',
    '01.02': 'Custos Diretos / Infraestrutura',
    '01.03': 'Obras Civis',
    '01.04': 'Projeção de Gastos',
    '01.09': 'Serviços Iniciais',
    '09.01': 'Serviços Iniciais Adicionais',
    '09.02': 'Serviços Iniciais Adicionais',
  }),
});
