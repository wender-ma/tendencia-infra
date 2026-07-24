# Validacao manual de ambientes e dados

Esta checklist cobre apenas atividades que nao podem ser executadas de forma segura
no repositorio: acesso a Supabase, dados reais, decisoes de negocio e tecnologias
assistivas. Execute-a depois de `npm run check` e `npm run test:browser` estarem
verdes no commit que sera avaliado.

## 1. Responsabilidade e ambientes

- Registrar quem aprova migrations, politicas RLS e deploys de banco.
- Criar ou confirmar um projeto Supabase exclusivo de desenvolvimento, sem dados
  confidenciais de producao.
- Criar uma obra de teste e usuarios ativos de `admin` e `editor`, alem de um
  usuario `rejected`; cada conta deve usar email sem dados pessoais reais.
- Copiar `.env.roles.example` para `.env.roles.local`, preencher somente com as
  contas ficticias de desenvolvimento e executar `npm run test:development:roles`.
  O runner nao imprime senhas e recusa escritas remotas fora do endpoint de login.
- Depois da matriz de papeis passar, executar
  `ALLOW_DEVELOPMENT_WRITES=1 npm run test:development:snapshots`; confirmar os
  dois bloqueios de RLS, os dois ciclos de versao e zero snapshots ativos ao final.
- Confirmar `verify_admin_transactions_deployment.sql` com `complete: true` e
  executar `ALLOW_DEVELOPMENT_WRITES=1 npm run test:development:workflows`; o
  resultado deve validar e remover a classificacao e a obra temporarias.
- Preencher `.env.development.local` com `VITE_APP_ENV=development` e as
  credenciais anon do projeto de desenvolvimento.
- Executar `npm run env:target` e comparar o project ref exibido com a URL do SQL
  Editor antes de cada migration.
- Executar `npm run test:development`; o smoke anonimo deve sincronizar sem erros
  e sem requisicoes remotas de escrita.
- Cadastrar no provedor de hospedagem somente as variaveis de producao:
  `VITE_APP_ENV=production`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
- Confirmar que a URL do Supabase e a origem do projeto, sem `/rest/v1`.

Aceite: desenvolvimento e producao usam IDs de projeto Supabase diferentes; um
build de producao passa por `npm run build:production` sem depender de arquivos
locais nao versionados.

## 2. Migrations e snapshots versionados

- Exportar ou registrar um backup do schema e dos dados do ambiente de
  desenvolvimento antes de alterar o banco.
- Executar `./scripts/test_rls_migration.sh` localmente quando Docker estiver
  disponivel.
- Aplicar, na ordem, as migrations em `supabase/migrations/` no SQL Editor do
  projeto de desenvolvimento.
- Executar `./scripts/audit_supabase_contract.sh datasets` com as variaveis do
  ambiente de desenvolvimento; o comando deve terminar sem divergencias.
- Se o endpoint ainda retornar `PGRST205`, executar
  `supabase/audit/verify_dashboard_datasets_deployment.sql` no SQL Editor e
  confirmar `complete: true`; guardar também o objeto `data_inventory`.
- Executar as consultas de `supabase/tests/` correspondentes e guardar o resultado
  da validacao junto ao ticket ou deploy.
- Aplicar `20260721211500_dashboard_datasets.sql`, importar dados de teste e
  validar upload, ativacao, troca de obra e rollback de upload.
- Se `data_inventory.backfill_review_required` for verdadeiro, fazer o backfill
  dos blobs legados apenas depois de os snapshots ativos serem lidos corretamente.
  Nao interromper a escrita dupla antes do teste autenticado e da comparacao.

Aceite: as politicas RLS bloqueiam papeis indevidos, os snapshots ativos carregam
os mesmos dados esperados e um rollback mantem o dashboard utilizavel.

## 3. Matriz de permissoes em ambiente real

Com um navegador sem sessao previa, verificar os cenarios abaixo:

| Perfil | Acao esperada |
| --- | --- |
| Anonimo | Le acesso somente ao que a decisao de negocio permitir; nao cria, altera ou baixa arquivo privado. |
| Editor da obra A | Edita e envia dados apenas da obra A. |
| Editor sem acesso a obra B | Nao edita nem enxerga dados privados da obra B. |
| Usuario rejected | Nao recebe permissao de edicao. |
| Admin | Administra obras e editores e pode operar todas as obras autorizadas. |

O comando `npm run test:development:roles` automatiza a autenticacao e a
resolucao de papeis desta matriz sem alterar dados. Edicao, upload e administracao
continuam exigindo a validacao manual controlada descrita nas etapas seguintes.

Registrar qualquer linha, arquivo ou botao acessivel fora do esperado antes de
seguir para producao.

## 4. Acessibilidade assistida

- Navegar por login, troca de abas, upload, modais, formularios e confirmacoes
  apenas com teclado.
- Em Windows, usar NVDA; em macOS/iOS, usar VoiceOver. Confirmar leitura de
  titulos, campos obrigatorios, mensagens de erro, toast, estado de sincronizacao
  e abertura/fechamento de modais.
- Verificar que o foco retorna ao controle que abriu cada modal e que nao fica
  preso atras de um dialogo.
- Registrar navegador, leitor de tela e data da validacao.

Aceite: todos os fluxos principais sao compreensiveis sem mouse e sem leitura
visual exclusiva da tela.

## 5. Arquivos representativos e privacidade

- Testar CSV e Excel reais ou anonimizados, incluindo o maior arquivo esperado e
  um proximo de 50 MB.
- Medir tempo de leitura, memoria perceptivel, progresso e mensagem de falha em
  conexao lenta.
- Confirmar com o responsavel pelos dados os textos de privacidade, quais campos
  sao enviados ao Supabase e a regra para visualizacao anonima.
- Auditar logs e dados historicos do Supabase para identificar alteracoes indevidas
  anteriores antes do endurecimento final das politicas.

Aceite: o limite de upload atende o uso real, os textos foram aprovados e nao ha
exposicao anonima sem autorizacao expressa do negocio.

## 6. Publicacao

- Manter `noindex, nofollow` enquanto o dashboard for interno.
- So adicionar Open Graph se houver uma decisao de tornar o produto publico e uma
  imagem/texto de preview aprovados.
- Depois do deploy, conferir headers HTTP, login, troca de obra, upload e o estado
  de sincronizacao no dominio final.

Aceite: o deploy usa variaveis de producao, os headers configurados em `vercel.json`
estao presentes e os fluxos da matriz de permissoes continuam corretos.
