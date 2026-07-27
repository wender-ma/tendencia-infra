# Baseline de segurança do Supabase - 20/07/2026

## Escopo

Revisão somente leitura dos metadados administrativos exportados do projeto implantado. O artefato versionado em `supabase_metadata_2026-07-20.json` contém definições estruturais e permissões, sem linhas das tabelas, tokens ou emails de usuários.

Nenhuma alteração foi aplicada ao banco remoto durante esta etapa.

## Inventário recebido

| Categoria | Quantidade |
| --- | ---: |
| Relações com estado de RLS | 11 |
| Views públicas | 1 |
| Grants | 231 |
| Buckets | 1 |
| Colunas | 114 |
| Índices | 25 |
| Policies | 24 |
| Triggers | 1 |
| Funções | 4 |
| Constraints | 21 |

O baseline confirma as oito tabelas usadas pelo frontend, a view `upload_history_latest`, o bucket privado `uploads-history`, o trigger `on_auth_user_created` e as funções legadas de autorização.

## Achados críticos

### Grants excessivos

As roles `anon` e `authenticated` receberam privilégios amplos nas tabelas públicas, incluindo operações que o cliente não precisa, como `TRUNCATE`, `TRIGGER` e `REFERENCES`. O mesmo padrão aparece nas tabelas de Storage.

RLS continua filtrando operações comuns, mas grants tão amplos aumentam o impacto de uma policy incorreta e dificultam provar o princípio do menor privilégio.

### Whitelist e histórico legíveis anonimamente

As policies de `editores_permitidos` e `upload_history` permitem leitura pública. A view `upload_history_latest` pertence a `postgres` e não estava configurada como `security_invoker`, portanto poderia executar fora do contexto RLS esperado pelo chamador.

### Autorização global em recursos compartilhados

`dashboard_config` usa `is_editor()` sem escopo de obra. As policies antigas de Storage também usam a função global e não validam o prefixo do caminho. Um editor ativo poderia alcançar recursos além da obra atribuída se o frontend fosse contornado.

### Leitura operacional pública

As tabelas `obras`, `flow_classifications`, `flow_manuals`, `projecao_config`, `projecao_movimentacoes` e `dashboard_config` têm leitura pública. Como o frontend atual permite visualização sem login, a migration preserva temporariamente esse comportamento. A continuidade dessa exposição exige decisão explícita do negócio.

## Correção preparada

A migration `../supabase/migrations/20260720172000_rls_hardening.sql`:

- remove grants desnecessários das roles do cliente;
- separa policies por operação e papel;
- exige admin ativo para operações administrativas e uploads globais;
- limita editores à obra atribuída;
- limita metadados de upload à obra atribuída e arquivos globais ao admin;
- bloqueia leitura anônima da whitelist e do histórico de uploads;
- configura a view de uploads como `security_invoker`;
- valida bucket, caminho e tipo nas policies de Storage;
- retira funções internas da superfície RPC pública.

O runner `../scripts/test_rls_migration.sh` validou a aplicação e o rollback em PostgreSQL 15 descartável. O teste cobre grants, policies, funções, view e regras de admin/editor. A implantação no Supabase remoto permanece pendente.

## Próximo checkpoint

1. Aplicar a migration em um projeto Supabase de desenvolvimento.
2. Validar cadastro de usuário e acesso pendente.
3. Exercitar a matriz por obra com a API real.
4. Executar `./scripts/audit_supabase_contract.sh hardened`.
5. Agendar produção somente após backup e aprovação do responsável técnico.
