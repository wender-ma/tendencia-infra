#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tendencia-backup-'));
const fixtureScripts = path.join(fixtureRoot, 'scripts');
const fixtureBackups = path.join(fixtureRoot, 'backups', 'snapshots');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function write(relativePath, content = relativePath) {
  const target = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

try {
  fs.mkdirSync(fixtureScripts, { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts', 'backup.sh'), path.join(fixtureScripts, 'backup.sh'));
  fs.chmodSync(path.join(fixtureScripts, 'backup.sh'), 0o755);

  write('README.md', 'fonte');
  write('assets/app.js', 'console.log("fonte");');
  write('.env.example', 'VITE_APP_ENV=development');
  write('.env.production.example', 'VITE_APP_ENV=production');
  write('.env.local', 'SEGREDO=nao-arquivar');
  write('.env.supabase.local', 'TOKEN=nao-arquivar');
  write('node_modules/dependency/index.js');
  write('dist/index.html');
  write('playwright-report/index.html');
  write('test-results/result.json');
  write('.lighthouseci/lhr.json');
  write('supabase/.temp/project-ref');
  write('backups/database/production.sql', 'dados-reais-nao-arquivar');
  write('backups/backup.log');

  fs.mkdirSync(fixtureBackups, { recursive: true });
  const oldBackups = Array.from({ length: 12 }, (_, index) => {
    const name = `tendencia-infra-20000101-0000${String(index).padStart(2, '0')}.tar.gz`;
    fs.writeFileSync(path.join(fixtureBackups, name), 'backup-antigo');
    return name;
  });

  const result = spawnSync(path.join(fixtureScripts, 'backup.sh'), {
    cwd: fixtureRoot,
    encoding: 'utf8',
  });
  assert(result.status === 0, `Backup falhou: ${result.stderr || result.stdout}`);

  const backups = fs
    .readdirSync(fixtureBackups)
    .filter((file) => /^tendencia-infra-.*\.tar\.gz$/.test(file))
    .sort();
  assert(backups.length === 12, `Retencao deveria manter 12 backups, encontrou ${backups.length}`);
  assert(!backups.includes(oldBackups[0]), 'Backup mais antigo nao foi removido');

  const currentBackup = backups.find((file) => !oldBackups.includes(file));
  assert(currentBackup, 'Novo backup nao foi criado');

  const listing = spawnSync('tar', ['-tzf', path.join(fixtureBackups, currentBackup)], {
    encoding: 'utf8',
  });
  assert(listing.status === 0, `Arquivo criado nao e um tar.gz valido: ${listing.stderr}`);
  const entries = new Set(listing.stdout.trim().split('\n'));

  for (const required of [
    './README.md',
    './assets/app.js',
    './.env.example',
    './.env.production.example',
  ]) {
    assert(entries.has(required), `Arquivo recuperavel ausente do backup: ${required}`);
  }

  for (const forbidden of [
    './.env.local',
    './.env.supabase.local',
    './node_modules/dependency/index.js',
    './dist/index.html',
    './playwright-report/index.html',
    './test-results/result.json',
    './.lighthouseci/lhr.json',
    './supabase/.temp/project-ref',
    './backups/database/production.sql',
    './backups/backup.log',
  ]) {
    assert(
      !entries.has(forbidden),
      `Arquivo sensivel ou regeneravel entrou no backup: ${forbidden}`,
    );
  }

  console.log('Backup: fonte e templates recuperaveis, segredos omitidos e retencao de 12 OK');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
