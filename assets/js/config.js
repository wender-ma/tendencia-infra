const DEFAULT_SUPABASE_URL = 'https://jmfgegnfctlyuevqadba.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptZmdlZ25mY3RseXVldnFhZGJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzMTg3NTQsImV4cCI6MjA5ODg5NDc1NH0.I46uFmDdXq3orJpkFq6wn4zATuENhbe-7Q1Xst3Vm0E';

function readEnvironment(name, fallback) {
  const value = import.meta.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export const SUPABASE_CONFIG = Object.freeze({
  url: readEnvironment('VITE_SUPABASE_URL', DEFAULT_SUPABASE_URL),
  anonKey: readEnvironment('VITE_SUPABASE_ANON_KEY', DEFAULT_SUPABASE_ANON_KEY),
});

export const STORAGE_KEYS = Object.freeze({
  header: 'jzurique_header_title',
  classifications: 'jzurique_flow_classifications_v1',
  manuals: 'jzurique_flow_manuals_v1',
  projectionControl: 'jzurique_proj_ctrl_v1',
});

export const DASHBOARD_CONFIG = Object.freeze({
  tolerancia_centavos: 1,
  tolerancia_conferencia: 1.0,
  tolerancia_projecao: 10000,
  max_uploads_por_tipo: 12,
  max_linhas_tabela: 1000,
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

export function installLegacyConfig(target = window) {
  Object.assign(target, {
    CONFIG: DASHBOARD_CONFIG,
    HEADER_KEY: STORAGE_KEYS.header,
    STORAGE_KEY: STORAGE_KEYS.classifications,
    MANUAL_KEY: STORAGE_KEYS.manuals,
    PROJ_CTRL_KEY: STORAGE_KEYS.projectionControl,
  });

  target.dashboardConfig = Object.freeze({
    dashboard: DASHBOARD_CONFIG,
    storageKeys: STORAGE_KEYS,
    supabaseUrl: SUPABASE_CONFIG.url,
  });
}
