const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const backup = fs.readFileSync('scripts/backup_database.sh', 'utf8');
const verify = fs.readFileSync('scripts/verify_database_backup.sh', 'utf8');
const runner = fs.readFileSync('scripts/run_database_backup.mjs', 'utf8');
const workflow = fs.readFileSync('.github/workflows/production-backup.yml', 'utf8');
const gitignore = fs.readFileSync('.gitignore', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  backup.includes('pg_dump') &&
    backup.includes('aes-256-cbc') &&
    backup.includes('BACKUP_ENCRYPTION_PASSWORD'),
  'backup de banco deve usar pg_dump e criptografia',
);
assert(
  verify.includes('pg_restore --list') && verify.includes('openssl enc -d'),
  'backup deve ser verificado por descriptografia e leitura do catalogo',
);
assert(
  runner.includes('spawnSync') &&
    !backup.includes('source "$ENV_FILE"') &&
    !verify.includes('source "$ENV_FILE"'),
  'arquivo de ambiente deve ser carregado pelo Node sem source do shell',
);
assert(
  workflow.includes('schedule:') &&
    workflow.includes('retention-days: 14') &&
    workflow.includes('secrets.SUPABASE_PRODUCTION_DB_URL'),
  'workflow deve executar diariamente, reter 14 dias e usar segredo de conexao',
);
assert(gitignore.includes('backups/database/'), 'dumps nao podem ser versionados');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tendencia-db-backup-'));
try {
  fs.mkdirSync(path.join(fixture, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(fixture, 'bin'), { recursive: true });
  for (const script of ['backup_database.sh', 'verify_database_backup.sh']) {
    fs.copyFileSync(path.join('scripts', script), path.join(fixture, 'scripts', script));
    fs.chmodSync(path.join(fixture, 'scripts', script), 0o755);
  }

  const fakeDump = path.join(fixture, 'bin', 'pg_dump');
  const fakeRestore = path.join(fixture, 'bin', 'pg_restore');
  fs.writeFileSync(fakeDump, '#!/usr/bin/env bash\nprintf "PGDMP-fixture-content\\n"\n');
  fs.writeFileSync(
    fakeRestore,
    '#!/usr/bin/env bash\ncat >/dev/null\nfor i in $(seq 1 20); do echo "entry-$i"; done\n',
  );
  fs.chmodSync(fakeDump, 0o755);
  fs.chmodSync(fakeRestore, 0o755);

  const env = {
    ...process.env,
    PATH: `${path.join(fixture, 'bin')}:${process.env.PATH}`,
    SUPABASE_PRODUCTION_DB_URL: 'postgresql://fixture.invalid/postgres',
    BACKUP_ENCRYPTION_PASSWORD: 'fixture-password-not-for-production',
  };
  const created = spawnSync(path.join(fixture, 'scripts', 'backup_database.sh'), {
    cwd: fixture,
    env,
    encoding: 'utf8',
  });
  assert(created.status === 0, `geracao criptografada falhou: ${created.stderr}`);

  const verified = spawnSync(path.join(fixture, 'scripts', 'verify_database_backup.sh'), {
    cwd: fixture,
    env,
    encoding: 'utf8',
  });
  assert(verified.status === 0, `verificacao do backup falhou: ${verified.stderr}`);
  assert(
    verified.stdout.includes('20 entradas'),
    'verificacao deve confirmar o catalogo descriptografado',
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log('database backup contract: encrypted generation and verification ok');
