# Scripts

Os scripts ficam agrupados por responsabilidade sem alterar os comandos públicos
do `package.json`:

- `browser/`: testes Playwright de navegador.
- `lib/`: módulos reutilizáveis pelos scripts operacionais.
- `audit_*.sh` e `audit_*.mjs`: auditorias somente leitura.
- `run_development_*.js`: smokes contra o ambiente de desenvolvimento.
- `test_*.js` e `test_rls_migration.sh`: contratos automatizados e testes locais.
- `backup.sh`, `backup_watch.sh`, `backup_database.sh` e
  `verify_database_backup.sh`: backups da fonte e do banco, com agendamento,
  retenção e verificação.
- `run_public_healthcheck.mjs`, `run_local_release_smoke.mjs`, `verify_*.mjs`,
  `verify_build.js` e runners de operação: monitoramento, validação de build e
  tarefas controladas de produção.

Os nomes na raiz são mantidos porque fazem parte dos comandos documentados, do
CI e dos contratos do projeto. Novos scripts devem entrar em `browser/`, `lib/`
ou receber um prefixo que deixe sua responsabilidade clara.
