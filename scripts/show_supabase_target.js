#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const environmentPath = path.join(root, '.env.development.local');

if (!fs.existsSync(environmentPath)) {
  console.error('Ambiente ausente: crie .env.development.local a partir de .env.example.');
  process.exit(1);
}

const values = Object.fromEntries(
  fs
    .readFileSync(environmentPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      const name = line.slice(0, separator).trim();
      const rawValue = line.slice(separator + 1).trim();
      const value = rawValue.replace(/^(['"])(.*)\1$/, '$2');
      return [name, value];
    }),
);

const projectUrl = new URL(values.VITE_SUPABASE_URL || '');
const projectRef = projectUrl.hostname.endsWith('.supabase.co')
  ? projectUrl.hostname.slice(0, -'.supabase.co'.length)
  : '';

if (!projectRef) {
  console.error('VITE_SUPABASE_URL nao identifica um projeto hospedado no Supabase.');
  process.exit(1);
}

console.log(`Ambiente: ${values.VITE_APP_ENV || 'nao informado'}`);
console.log(`Projeto Supabase: ${projectRef}`);
console.log(`URL: ${projectUrl.origin}`);
console.log('Confirme este project ref na URL do SQL Editor antes de executar migrations.');
