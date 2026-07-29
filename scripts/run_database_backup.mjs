#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const commands = {
  create: 'backup_database.sh',
  verify: 'verify_database_backup.sh',
};
const task = process.argv[2];
const script = commands[task];

if (!script) {
  console.error('Uso: run_database_backup.mjs <create|verify> [arquivo]');
  process.exit(2);
}

const result = spawnSync(path.join(scriptsDirectory, script), process.argv.slice(3), {
  env: process.env,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
