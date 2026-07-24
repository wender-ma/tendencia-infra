# Auditoria do Supabase de desenvolvimento - 23/07/2026

## Escopo

Auditoria somente leitura executada contra o projeto de desenvolvimento com a
chave publica `anon`. Nenhuma linha, policy, funcao ou configuracao remota foi
alterada.

## Contrato endurecido

O perfil `hardened` de `scripts/audit_supabase_contract.sh` passou:

- `obras`: contrato de 7 colunas disponivel; 2 linhas anonimas visiveis;
- `editores_permitidos`: acesso anonimo bloqueado com HTTP 401;
- `flow_classifications`, `flow_manuals`, `projecao_config`,
  `projecao_movimentacoes` e `dashboard_config`: contratos disponiveis, sem linhas
  anonimas visiveis no momento da auditoria;
- `upload_history` e `upload_history_latest`: acesso anonimo bloqueado com HTTP 401.

O resultado confirma o comportamento remoto da migration de RLS para os contratos
consultados. A decisao de negocio sobre a exposicao anonima de `obras` e dos demais
dados de leitura continua pendente.

## Smoke do frontend

O frontend foi iniciado em modo `development` com a configuracao local e validado
em Chromium sem sessao:

- status da configuracao: `ready`;
- cliente Supabase criado e autenticacao inicializada sem usuario;
- boot concluido, obra ativa resolvida e estado de sincronizacao `synced`;
- nenhum erro de pagina;
- nenhuma requisicao remota de escrita.

O teste e reproduzivel por `npm run test:development`.

## Snapshots versionados

A migration `20260721211500_dashboard_datasets.sql` ainda nao estava aplicada:

- `dashboard_datasets`: HTTP 404, codigo `PGRST205`, tabela ausente do schema;
- `activate_dashboard_dataset(p_dataset_id)`: HTTP 404, codigo `PGRST202`, funcao
  ausente do schema.

Como a migration e transacional, a aplicacao completa deve publicar a tabela, as
RPCs, as policies e o bucket privado em conjunto. Depois de aplica-la no SQL Editor,
execute:

```bash
set -a
source .env.development.local
set +a
./scripts/audit_supabase_contract.sh datasets
```

Se o schema REST continuar sem a tabela, execute
`supabase/audit/verify_dashboard_datasets_deployment.sql`. A consulta retorna um
resumo booleano de todos os objetos e solicita a recarga do cache PostgREST.

Nao execute backfill nem interrompa a escrita dupla enquanto esse gate e os fluxos
reais de upload, ativacao e rollback nao estiverem validados.

## Divergencia de alvo identificada em 24/07/2026

A auditoria SQL retornou `complete: true`, mas o REST do projeto configurado como
desenvolvimento continuou respondendo `PGRST205`. A comparacao somente leitura dos
dois endpoints mostrou:

- desenvolvimento `xtfbhpisopvnrxmagrek`: `dashboard_datasets` ausente;
- projeto legado `jmfgegnfctlyuevqadba`: perfil `datasets` completo e tabela sem
  snapshots ativos visiveis;
- projeto legado: 11 chaves em `dashboard_config`, incluindo os quatro formatos de
  blob que motivaram a migration.

Portanto, a migration foi aplicada no projeto legado, nao no ambiente configurado
de desenvolvimento. O arquivo e aditivo e nao move nem remove os blobs existentes.
Nenhum rollback automatico foi executado. Antes da proxima aplicacao, execute
`npm run env:target` e confirme o mesmo project ref na URL do SQL Editor.

## Aplicacao confirmada no desenvolvimento em 24/07/2026

A migration foi reaplicada no alvo correto `xtfbhpisopvnrxmagrek`. A auditoria
SQL confirmou `complete: true` e a auditoria REST confirmou as 13 colunas de
`dashboard_datasets`, o perfil endurecido e zero snapshots ativos visiveis para
anonimo. O smoke real concluiu o boot sincronizado, sem erros de pagina e apenas
com requisicoes `GET`.

A auditoria SQL agora inclui `data_inventory`, sem retornar o conteudo dos blobs,
para decidir se existe backfill no ambiente e detectar snapshots ou objetos
residuais. A escrita dupla permanece ativa ate o fluxo autenticado validar upload,
ativacao, leitura e rollback.
