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
