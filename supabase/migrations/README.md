# Migrations do Supabase

Este diretório contém apenas migrations incrementais revisadas. As cinco migrations foram validadas em sequência, com seus rollbacks, em PostgreSQL 15 descartável.

O baseline versionado em `../../docs/supabase_metadata_2026-07-20.json` inclui relações, colunas, tipos, constraints, índices, grants, policies, funções, trigger, view e bucket. Ele não contém linhas das tabelas nem credenciais.

Rascunhos que não devem ser aplicados ficam em `../drafts/`.

## Estado das migrations

- Revisão contra o baseline administrativo: concluída.
- Teste local de aplicação das cinco migrations: concluído.
- Teste local dos cinco rollbacks: concluído.
- Comportamento endurecido de RLS no Supabase de desenvolvimento: confirmado por auditoria anônima em 23/07/2026.
- Migration administrativa no Supabase de desenvolvimento: aplicada e as três RPCs auditadas em 24/07/2026.
- Migration de snapshots no Supabase de desenvolvimento: aplicada e confirmada por SQL e REST em 24/07/2026.
- Backfill no Supabase de desenvolvimento: dispensado em 24/07/2026 após inventário confirmar zero blobs legados, snapshots e objetos no bucket.
- Ciclo autenticado no Supabase de desenvolvimento: editor/Tendência e admin/Flows validados com duas versões, leitura, integridade, rollback e limpeza em 24/07/2026.
- Reset transacional e policies de manutenção aplicados no desenvolvimento em 24/07/2026; quatro resíduos antigos do smoke foram removidos e o novo ciclo terminou com zero metadados e objetos.
- O projeto antes chamado de legado, `jmfgegnfctlyuevqadba`, foi confirmado como o alvo atual de produção `Tendência de Obras`.
- Pacote de snapshots em produção: completo após aplicação manual das migrations de reset e policies em 27/07/2026; inventário agregado em `../../docs/supabase_production_inventory_2026-07-24.md`.
- Backfill em produção: necessário para quatro blobs legados e ainda não executado.

Teste local reproduzível:

```bash
./scripts/test_rls_migration.sh
```

Auditoria remota somente leitura após a quinta migration:

```text
supabase/audit/verify_dashboard_datasets_deployment.sql
```

O resultado deve indicar `complete: true`.

Ordem de aplicação:

1. `20260720172000_rls_hardening.sql`
2. `20260720203000_admin_transactions.sql`
3. `20260721211500_dashboard_datasets.sql`
4. `20260724183000_dashboard_dataset_reset.sql`
5. `20260724190000_dashboard_dataset_cleanup_policies.sql`

Antes de abrir o SQL, execute `npm run env:target` e compare o project ref com a
URL do SQL Editor.

Em uma reversão completa, execute os arquivos de `../rollback/` na ordem inversa. A terceira migration apenas prepara snapshots versionados e não remove os blobs atuais de `dashboard_config`. Seu rollback exige que o bucket `dashboard-datasets` esteja vazio.

## Fluxo obrigatório

1. Exportar o schema implantado.
2. Salvar o baseline sem segredos.
3. Comparar o baseline com o frontend e os rascunhos.
4. Criar uma migration incremental.
5. Aplicar em desenvolvimento.
6. Executar a matriz de testes por papel e obra.
7. Revisar o diff produzido pelo Supabase.
8. Aplicar em produção com backup e rollback definidos.
