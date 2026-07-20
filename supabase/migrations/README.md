# Migrations do Supabase

Este diretório contém apenas migrations incrementais revisadas. As migrations `20260720172000_rls_hardening.sql` e `20260720203000_admin_transactions.sql` foram comparadas com o baseline administrativo de 20/07/2026 e validadas localmente em PostgreSQL 15.

O baseline versionado em `../../docs/supabase_metadata_2026-07-20.json` inclui relações, colunas, tipos, constraints, índices, grants, policies, funções, trigger, view e bucket. Ele não contém linhas das tabelas nem credenciais.

Rascunhos que não devem ser aplicados ficam em `../drafts/`.

## Estado das migrations

- Revisão contra o baseline administrativo: concluída.
- Teste local de aplicação das duas migrations: concluído.
- Teste local dos dois rollbacks: concluído.
- Aplicação em Supabase de desenvolvimento: pendente.
- Aplicação em produção: pendente.

Teste local reproduzível:

```bash
./scripts/test_rls_migration.sh
```

Ordem de aplicação:

1. `20260720172000_rls_hardening.sql`
2. `20260720203000_admin_transactions.sql`

Em uma reversão completa, execute os arquivos de `../rollback/` na ordem inversa. A segunda migration adiciona RPCs atômicas para permissões e exclusão de obra, além de seis chaves estrangeiras com cascata controlada.

## Fluxo obrigatório

1. Exportar o schema implantado.
2. Salvar o baseline sem segredos.
3. Comparar o baseline com o frontend e os rascunhos.
4. Criar uma migration incremental.
5. Aplicar em desenvolvimento.
6. Executar a matriz de testes por papel e obra.
7. Revisar o diff produzido pelo Supabase.
8. Aplicar em produção com backup e rollback definidos.
