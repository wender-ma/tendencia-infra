import { loadEnv } from 'vite';

const mode = 'production';
const fileEnvironment =
  process.env.PRODUCTION_ENV_FILE_LOADING === 'disabled'
    ? {}
    : loadEnv(mode, 'config/env', 'VITE_');
const processEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => name.startsWith('VITE_')),
);
const environment = { ...fileEnvironment, ...processEnvironment };
const requiredNames = [
  'VITE_APP_ENV',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_DATASET_PERSISTENCE_MODE',
];
const missingNames = requiredNames.filter((name) => !environment[name]?.trim());

if (missingNames.length > 0) {
  console.error(
    `Build de producao bloqueado: configure ${missingNames.join(', ')} no ambiente de hospedagem.`,
  );
  process.exit(1);
}

if (environment.VITE_APP_ENV.trim() !== mode) {
  console.error('Build de producao bloqueado: VITE_APP_ENV deve ser exatamente "production".');
  process.exit(1);
}

if (!['dual', 'snapshots'].includes(environment.VITE_DATASET_PERSISTENCE_MODE.trim())) {
  console.error(
    'Build de producao bloqueado: VITE_DATASET_PERSISTENCE_MODE deve ser "dual" ou "snapshots".',
  );
  process.exit(1);
}

try {
  const supabaseUrl = new URL(environment.VITE_SUPABASE_URL);
  if (
    supabaseUrl.protocol !== 'https:' ||
    supabaseUrl.pathname !== '/' ||
    supabaseUrl.search ||
    supabaseUrl.hash
  ) {
    throw new Error('A URL deve ser a origem HTTPS do projeto, sem /rest/v1 ou outros caminhos.');
  }
} catch (error) {
  console.error(
    `Build de producao bloqueado: VITE_SUPABASE_URL invalida. ${error.message || error}`,
  );
  process.exit(1);
}

console.log('Configuracao publica do Supabase validada para producao.');
