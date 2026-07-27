# Inventario do Supabase de producao - 24/07/2026

## Escopo

Inventario agregado autorizado pelo responsavel do projeto e executado em
24/07/2026, as 20:22 UTC, contra:

- project ref: `jmfgegnfctlyuevqadba`;
- nome confirmado pela Management API: `Tendência de Obras`;
- status: `ACTIVE_HEALTHY`;
- regiao: `us-east-2`;
- modo: `supabase-management-api-read-only`.

O auditor usou somente `/database/query/read-only`, recusou instrucoes mutaveis e
nao retornou conteudo dos datasets, codigos de obra, usuarios ou credenciais.

## Resultado agregado

### Deployment de snapshots

| Verificacao | Resultado |
| --- | ---: |
| `dashboard_config` | presente |
| `dashboard_datasets` | presente |
| RPC de ativacao | presente |
| RPC de falha | presente |
| RPC de rollback | presente |
| RPC de reset | **ausente** |
| RLS da tabela | habilitado |
| bucket privado `dashboard-datasets` | presente |
| policies da tabela | 3 |
| policies de Storage | 3 |
| deployment completo | **nao** |

O estado e compativel com a migration inicial de snapshots, mas ainda nao inclui
`20260724183000_dashboard_dataset_reset.sql` nem
`20260724190000_dashboard_dataset_cleanup_policies.sql`, que elevam o contrato
esperado para a RPC de reset e quatro policies em cada camada.

### Dados legados

| Escopo | Tipo | Chaves | Bytes |
| --- | --- | ---: | ---: |
| global | `flows` | 1 | 218238 |
| global | `historico` | 1 | 126289 |
| global | `projecao_raw` | 1 | 554997 |
| obra | `tendencia` | 1 | 74901 |
| **Total** |  | **4** | **974425** |

Tambem foram confirmados:

- zero snapshots em qualquer status;
- zero snapshots ativos;
- zero objetos no bucket `dashboard-datasets`;
- `backfill_review_required: true`.

## Decisao operacional

Producao deve permanecer em `VITE_DATASET_PERSISTENCE_MODE=dual`. Nao altere para
`snapshots` e nao remova as quatro chaves legadas neste estado.

Antes do backfill:

1. definir o responsavel tecnico e obter backup/export do banco;
2. aplicar, no alvo confirmado, as migrations de reset e policies de limpeza;
3. repetir o inventario e exigir `complete: true`, RPC de reset presente e
   contagens de policies `4 + 4`;
4. executar o runner de backfill primeiro em `--mode plan`;
5. revisar o resumo agregado e autorizar separadamente o modo de escrita.

O runner `scripts/run_production_dataset_backfill.mjs` foi preparado depois deste
inventario. Ele exige project ref repetido, nome do projeto, ambiente
`production`, conta admin ativa e dois opt-ins adicionais para escrever. O modo
`apply` cria snapshots, valida hash, tamanho e conteudo, detecta mudanca
concorrente, preserva os blobs legados e tenta rollback compensatorio em qualquer
falha.

Uma prova real em `--mode plan` foi interrompida antes do login administrativo,
como esperado, porque o deployment ainda esta incompleto. Nenhum backfill foi
executado.

## Verificacao apos migrations - 27/07/2026

As migrations `20260724183000_dashboard_dataset_reset.sql` e
`20260724190000_dashboard_dataset_cleanup_policies.sql` foram executadas
manualmente no projeto confirmado. O novo inventario read-only confirmou:

- `reset_rpc_exists: true`;
- `table_policy_count: 4`;
- `storage_policy_count: 4`;
- `complete: true`;
- os quatro blobs legados permanecem intactos (`974425` bytes);
- zero snapshots e zero objetos continuam no bucket.

O deployment de snapshots esta pronto para o backfill, mas o modo permanece
`dual` ate o plano autenticado, a revisao e a autorizacao especifica da escrita.

## Preflight de aplicacao em 27/07/2026

A Management API confirmou novamente os objetos das migrations anteriores:
funcoes de autorizacao, tres RPCs administrativas, a tabela de snapshots e a RPC
de reset estao presentes. O schema
`supabase_migrations.schema_migrations` ainda nao existe nesse projeto.

O projeto informou zero backups disponiveis e PITR desabilitado. A tentativa de
dump logico chegou ao pooler oficial, mas foi recusada antes de ler dados porque a
senha local configurada pertence ao projeto de desenvolvimento. Nenhuma migration
adicional foi aplicada durante esse preflight e nenhum dado de producao foi
alterado nessa tentativa.

Para continuar, preencha somente
`SUPABASE_PRODUCTION_DB_PASSWORD` em `.env.production-database.local`. Depois
disso, o fluxo automatizado deve:

1. gerar dumps separados de schema, dados e papeis;
2. validar tamanho e hash dos tres arquivos;
3. reconciliar como aplicadas as tres migrations ja comprovadas;
4. executar `db push --dry-run` e exigir somente as migrations quatro e cinco;
5. aplicar as duas migrations e repetir o inventario read-only.
