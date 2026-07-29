#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const requireDatabase = process.argv.includes('--require-database');
const checks = [
  {
    label: 'fonte',
    directory: path.join(root, 'backups', 'snapshots'),
    pattern: /^tendencia-infra-.*\.tar\.gz$/,
    maxAgeHours: 1,
    required: true,
  },
  {
    label: 'banco',
    directory: path.join(root, 'backups', 'database'),
    pattern: /^tendencia-production-.*\.dump\.enc$/,
    maxAgeHours: 26,
    required: requireDatabase,
  },
];

let failed = false;
for (const check of checks) {
  const files = fs.existsSync(check.directory)
    ? fs
        .readdirSync(check.directory)
        .filter((name) => check.pattern.test(name))
        .map((name) => ({
          name,
          modifiedAt: fs.statSync(path.join(check.directory, name)).mtimeMs,
        }))
        .sort((left, right) => right.modifiedAt - left.modifiedAt)
    : [];

  if (!files.length) {
    console.log(`${check.label}: ${check.required ? 'AUSENTE' : 'ainda nao configurado'}`);
    failed ||= check.required;
    continue;
  }

  const ageHours = (Date.now() - files[0].modifiedAt) / 3_600_000;
  const healthy = ageHours <= check.maxAgeHours;
  console.log(
    `${check.label}: ${healthy ? 'OK' : 'ATRASADO'} · ${files[0].name} · ${ageHours.toFixed(1)}h`,
  );
  failed ||= !healthy;
}

if (failed) process.exitCode = 1;
