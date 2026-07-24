#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const verifier = path.join(root, 'scripts/verify_production_environment.mjs');
const cleanEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('VITE_')),
);
const validEnvironment = {
  ...cleanEnvironment,
  VITE_APP_ENV: 'production',
  VITE_SUPABASE_URL: 'https://production-example.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'public-anon-key',
};

function verify(environment) {
  return spawnSync(process.execPath, [verifier], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
  });
}

const missingMode = verify(validEnvironment);
assert.notStrictEqual(missingMode.status, 0);
assert(missingMode.stderr.includes('VITE_DATASET_PERSISTENCE_MODE'));

const invalidMode = verify({
  ...validEnvironment,
  VITE_DATASET_PERSISTENCE_MODE: 'automatico',
});
assert.notStrictEqual(invalidMode.status, 0);
assert(invalidMode.stderr.includes('deve ser "dual" ou "snapshots"'));

for (const mode of ['dual', 'snapshots']) {
  const valid = verify({
    ...validEnvironment,
    VITE_DATASET_PERSISTENCE_MODE: mode,
  });
  assert.strictEqual(valid.status, 0, valid.stderr);
  assert(valid.stdout.includes('Configuracao publica do Supabase validada para producao.'));
}

console.log('Preflight de produção: variável obrigatória e modos dual/snapshots OK');
