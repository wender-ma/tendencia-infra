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
source config/env/.env.development.local
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

O inventario remoto foi repetido em 24/07/2026 pelo comando
`npm run audit:supabase:inventory`, com confirmacao dupla do project ref,
nome esperado `Desenvolvimento Teste` e endpoint da Management API
`read-only`. A execucao confirmou:

- zero chaves legadas e zero bytes em `dashboard_config`;
- zero snapshots em qualquer status;
- zero objetos no bucket `dashboard-datasets`;
- quatro policies na tabela e quatro policies de Storage;
- deployment completo, com RLS, bucket privado e todas as RPCs esperadas;
- `backfill_review_required: false`.

O backfill foi dispensado exclusivamente neste projeto de desenvolvimento. A
escrita dupla continua ativa ate criar o primeiro snapshot por upload autenticado,
validar sua leitura e exercitar o rollback. Esta decisao nao se aplica ao projeto
legado nem a producao, que devem ter inventarios independentes.

## Matriz autenticada e snapshots em 24/07/2026

O runner Playwright autenticou as tres contas ficticias e confirmou:

- admin com papel global e acesso de edicao;
- editor restrito a `OBRA-TESTE`;
- usuario `rejected` autenticado, mas sem papel ou permissao de edicao;
- nenhuma escrita remota fora do endpoint de login.

O smoke de snapshots executou escritas minimas e temporarias no desenvolvimento:

- RLS recusou Tendencia para o usuario `rejected`;
- RLS recusou Flows global para o editor;
- o editor criou, leu e reverteu duas versoes de Tendencia;
- o admin criou, leu e reverteu duas versoes globais de Flows;
- hash, tamanho, ativacao da versao nova e restauracao da anterior foram validados;
- a limpeza terminou com zero snapshots ativos, zero metadados e zero objetos.

Durante a preparacao, foi corrigido o insert que solicitava `RETURNING` de uma
linha `processing`, invisivel pela policy de leitura ate a ativacao. O cliente
agora usa os metadados que acabou de gerar e nao amplia a policy RLS. A auditoria
REST e o smoke anonimo passaram novamente depois da limpeza.

## Migration administrativa confirmada em 24/07/2026

O historico remoto foi reconciliado com as migrations aplicadas manualmente e
`20260720203000_admin_transactions.sql` foi aplicada pela CLI no projeto de
desenvolvimento. A auditoria confirmou as tres RPCs administrativas.

O workflow real foi repetido e validou pela interface a edicao temporaria de uma
classificacao como editor e a criacao/exclusao de uma obra como admin. A limpeza
removeu os dois registros e o inventario de prefixos `E2E-` terminou zerado.

## Reset e limpeza de versoes em 24/07/2026

A auditoria posterior ao primeiro smoke identificou quatro metadados `failed` e
quatro objetos, todos criados pelo teste de Tendencia/Flows das 15:01 e sem versao
ativa. A API de Storage exige `SELECT` e `DELETE`, mas as policies iniciais
permitiam selecionar apenas objetos ativos; por isso a remocao retornava sem erro
e sem efeito.

Foram aplicadas `20260724183000_dashboard_dataset_reset.sql` e
`20260724190000_dashboard_dataset_cleanup_policies.sql`. A primeira remove
metadata versionada e chaves legadas na mesma transacao. A segunda permite
manutencao de versoes inativas somente ao editor da obra ou ao admin do escopo
global.

Os quatro residuos foram removidos pela nova RPC. O smoke autenticado foi repetido
e terminou com zero snapshots ativos, zero metadados em qualquer status e zero
objetos nos caminhos de Tendencia e Flows, mantendo os bloqueios de RLS.
