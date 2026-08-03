# Operação, deploy e rollback

## Desenvolvimento local

Requisitos: Node.js `>=22.19.0` e npm.

```bash
npm ci
cp config/env/.env.example config/env/.env.development.local
npm run dev
```

Preencha o arquivo com um projeto Supabase exclusivo de desenvolvimento e mantenha
`VITE_APP_ENV=development`. Nunca use a URL de producao nesse arquivo. Para evitar
misturas acidentais, a aplicacao descarta as credenciais quando `VITE_APP_ENV` nao
corresponde ao modo do Vite; sem credenciais validas, ela funciona em modo offline.

As variaveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` sao publicas no bundle.
Nunca use `service_role` ou qualquer segredo de servidor no frontend.

`VITE_DATASET_PERSISTENCE_MODE` aceita `dual` ou `snapshots`. O padrao seguro e
`dual`, usado durante a migracao. O modo `snapshots` remove os quatro blobs grandes
do caminho de leitura e escrita e falha explicitamente se a infraestrutura
versionada nao estiver disponivel.

## Validação

Antes de publicar:

```bash
npm run release:check
```

`npm run check` executa lint, verificacao de formatacao, contratos e build. O teste
de navegador executa smoke funcional, axe e inspecoes responsivas com configuracao
Supabase ficticia e conexoes remotas bloqueadas.

`npm run test:lighthouse` audita o build de produção com mínimos de 65 em performance, 90 em acessibilidade, 85 em boas práticas e 75 em SEO. O relatório completo fica em `.lighthouseci/lhr.json`; a verificação de indexabilidade é omitida porque o produto ainda aguarda uma decisão explícita sobre indexação em buscadores e mantém `noindex` deliberadamente.

As validacoes que dependem de Supabase real, dados representativos, leitor de tela
ou decisao de negocio estao organizadas em `docs/manual_validation.md`.

Com `config/env/.env.development.local` preenchido, o smoke anônimo do ambiente real pode ser
executado por:

```bash
npm run test:development
```

O comando inicia um servidor isolado, confirma boot e sincronização e falha se o
navegador tentar qualquer método remoto diferente de `GET`, `HEAD` ou `OPTIONS`.

## Deploy do frontend

O Vercel deve usar:

- build: `npm run build:production`;
- diretório de saída: `dist`;
- variaveis publicas: `VITE_APP_ENV=production`, `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY` e `VITE_DATASET_PERSISTENCE_MODE`;
- configuração de headers: `vercel.json`.

O preflight do build bloqueia o deploy se uma das quatro variaveis estiver ausente,
se `VITE_APP_ENV` nao for `production` ou se a URL contiver `/rest/v1`. Cadastre
as variaveis no ambiente de producao do provedor antes de enviar este commit para a
branch publicada. O template `config/env/.env.production.example` serve apenas como referencia
local e nao deve receber valores reais versionados.

O deploy do frontend não aplica migrations nem altera o banco. Depois da publicação, confirme o carregamento, login, troca de obra e headers HTTP no domínio final.

Desde o commit `f1cb9fe`, a Vercel publica diretamente a branch `main` e o CI não
move mais uma branch intermediária. O deployment pode começar enquanto o workflow
ainda está em execução; por isso um release só deve ser considerado concluído após
confirmar, para o mesmo SHA, CI verde, deployment `Production / Ready` e smoke no
domínio oficial.

### Falha de deploy por configuracao

Em 27/07/2026, os primeiros deployments posteriores ao commit `e8f11fc` de 23/07
falharam porque as variaveis de Production ainda nao estavam configuradas. Depois
da configuracao, o deployment da `main` concluiu; o dominio respondeu HTTP 200,
serviu os assets atuais e o smoke tecnico confirmou boot concluido, headers
defensivos e nenhum erro de pagina. Esta intervencao esta registrada como EXT-02
concluida em `docs/external_actions.md`.

No painel da Vercel, abra **Settings > Environment Variables** e confirme, com
escopo **Production**, exatamente:

```text
VITE_APP_ENV=production
VITE_SUPABASE_URL=https://jmfgegnfctlyuevqadba.supabase.co
VITE_SUPABASE_ANON_KEY=<chave publica anon de producao>
VITE_DATASET_PERSISTENCE_MODE=snapshots
```

Nao use `/rest/v1` na URL e nao use a chave `service_role`. Depois de salvar,
republique o commit mais recente da `main`. O deployment deve terminar como
`Ready`; em seguida, confira os headers, o modo efetivo e os fluxos funcionais
antes de iniciar a janela de estabilidade.

## Rollback do frontend

Preferencial: no painel do Vercel, abra **Deployments**, selecione o último deploy estável e promova-o para produção. Isso restaura somente os assets do frontend.

Alternativa versionada:

```bash
git log --oneline
git revert <commit-problematico>
git push origin main
```

Não use `git reset --hard` em uma branch compartilhada.

## Mudanças no Supabase

Migrations ficam em `supabase/migrations/` e não são executadas pelo CI nem pelo deploy do frontend. Antes de qualquer migration remota:

1. execute `npm run env:target`, compare o project ref com a URL do SQL Editor e faça export/backup;
2. execute `./scripts/test_rls_migration.sh`;
3. aplique a migration no SQL Editor do ambiente correto;
4. execute as consultas de verificação correspondentes;
5. use o script pareado em `supabase/rollback/` somente se a reversão for necessária.

Rollback de frontend não reverte banco, Storage ou registros de upload.

A migration `20260728193000_global_upload_history.sql` deve ser aplicada depois
das migrations de RLS e datasets. Ela normaliza Flows e Gestões como históricos
globais, preserva Tendência por obra e adiciona `reset_global_dashboard_datasets`.
Depois da execução, rode
`supabase/tests/assert_global_upload_history.sql`; todos os campos do JSON
retornado devem ser `true`.

A migration `20260728235000_release_hardening.sql` vem por último. Ela mantém o
painel público, mas expõe ao papel `anon` somente as colunas consumidas pela
interface, oculta obras inativas e blobs legados, e publica as RPCs
administrativas usadas pelo cadastro transacional de obras encontradas no Excel.
Seu rollback pareado está em `supabase/rollback/`.
Depois de aplicá-la, execute a auditoria somente leitura
`supabase/audit/verify_release_hardening_deployment.sql` e exija
`complete: true`.

## Backup do banco de produção

O snapshot de fonte não contém dados do Supabase. Para um backup lógico diário:

1. copie `config/env/.env.production-database.example` para o equivalente
   `.local`;
2. em **Supabase > Connect**, copie a URI do **Session pooler** e substitua a
   senha do banco;
3. gere uma senha longa e exclusiva para `BACKUP_ENCRYPTION_PASSWORD`;
4. execute `npm run backup:database` e `npm run backup:database:verify`;
5. guarde a senha de criptografia em um gerenciador separado dos artefatos.

No GitHub, cadastre `SUPABASE_PRODUCTION_DB_URL` e
`BACKUP_ENCRYPTION_PASSWORD` em **Settings > Secrets and variables > Actions**.
O workflow `production-backup.yml` roda diariamente, valida o catálogo do dump e
retém cada artefato criptografado por 14 dias. Uma senha perdida torna os backups
irrecuperáveis; uma senha exposta exige rotação e uma nova cadeia de backups.

## Monitoramento

`production-smoke.yml` consulta o domínio publicado a cada 30 minutos, valida
HTML, asset principal, `robots.txt` e headers defensivos. Também pode ser iniciado
manualmente em **Actions > Production smoke > Run workflow**. Falhas ficam
visíveis no histórico do GitHub Actions; habilite as notificações de workflows
do repositório para receber o alerta.

Com o servidor local de produção aberto e dados reais, execute
`npm run smoke:local-release`. O smoke percorre as abas públicas, troca de obra,
alterna o tema, confirma que o autocadastro está oculto e rejeita erros de página
ou rede sem imprimir conteúdo de negócio.

Nunca use apenas o nome visual do projeto para escolher o alvo: confirme o project
ref exibido por `npm run env:target`. Uma migration aplicada no projeto incorreto
nao deve ser revertida automaticamente; primeiro registre o estado e avalie o
rollback com o responsavel pelo banco.

### Inventario remoto somente leitura

Para consultar o estado dos datasets sem executar SQL manualmente, copie
`config/env/.env.supabase.example` para `config/env/.env.supabase.local` e preencha o Personal Access
Token, a senha local usada pela CLI e o project ref padrao. O arquivo preenchido
e ignorado pelo Git e pelos backups.

Execute o auditor repetindo o alvo nos dois argumentos:

```bash
npm run audit:supabase:inventory -- \
  --project-ref abcdefghijklmnopqrst \
  --confirm-project-ref abcdefghijklmnopqrst \
  --expected-project-name "Nome conferido no painel"
```

O nome esperado e opcional, mas cria uma segunda verificacao humana alem do
project ref. O script consulta a lista de projetos acessiveis e usa apenas
`/database/query/read-only`; ele nao usa a senha do banco, nao solicita valores
dos datasets e agrega chaves por escopo e tipo para nao revelar codigos de obra.
O resultado informa se o deployment esta completo, quantos blobs legados exigem
backfill, quantos snapshots existem por status e quantos objetos estao no bucket.
Tambem retorna um inventario operacional agregado com contagens, primeira/ultima
atividade e quantidade de registros sem escopo obrigatorio; nenhum valor de
negocio ou identificador e consultado.

### Auditoria agregada de logs

Para revisar a atividade retida sem baixar eventos brutos, confirme o alvo e
informe o inicio em ISO-8601:

```bash
npm run audit:supabase:logs -- \
  --project-ref <ref-producao> \
  --confirm-project-ref <ref-producao> \
  --expected-project-name "<nome-conferido>" \
  --from 2026-07-20T00:00:00Z
```

O auditor aceita no maximo 31 dias, divide o periodo em janelas inferiores a 24
horas, respeita `Retry-After` e usa o endpoint ClickHouse atual. A saida possui
somente contagens por dia, recurso, status e papel, alem de erros PostgreSQL e
acoes de autenticacao agregadas. Ela nunca inclui evento bruto, caminho completo,
IP, email, ID de usuario, codigo de obra, arquivo ou payload. Logs agregados
ajudam a encontrar sinais, mas nao comprovam autoria ou intencao.

O resultado de producao de 27/07/2026 esta em
`docs/audits/supabase_production_log_audit_2026-07-27.md`.

### Snapshots versionados do dashboard

Para iniciar a migração gradual em desenvolvimento, aplique
`supabase/migrations/20260721211500_dashboard_datasets.sql` no SQL Editor depois
de executar o teste local. A aplicação continua lendo `dashboard_config` enquanto
a tabela ainda não existe; após a migration, ela passa a preferir o snapshot ativo
e mantém escrita dupla. Não faça backfill nem remova as chaves legadas antes de
validar imports, troca de obra e rollback de upload com dados de desenvolvimento.

Depois da aplicação, valide a publicação do novo contrato sem escrita remota:

```bash
set -a
source config/env/.env.development.local
set +a
./scripts/audit_supabase_contract.sh datasets
```

### Transicao para snapshots

Mantenha `VITE_DATASET_PERSISTENCE_MODE=dual` ate concluir o inventario do ambiente.
Para interromper o uso dos blobs grandes:

1. faça backup do banco e execute o inventario remoto somente leitura;
2. conclua qualquer backfill indicado por `backfill_review_required`;
3. compare contagem, hash e conteudo por tipo e obra;
4. configure `VITE_DATASET_PERSISTENCE_MODE=snapshots` na hospedagem e publique;
5. valide login, troca de obra, leitura, upload e rollback;
6. aguarde no mínimo sete dias corridos em produção sem regressão antes de remover chaves legadas.

No modo `snapshots`, `dashboard_config` continua armazenando apenas configuracoes
pequenas, como `gestao_label`. Se o deploy apresentar falha, restaure
`VITE_DATASET_PERSISTENCE_MODE=dual` e publique novamente. As chaves legadas so
servem como rollback enquanto ainda nao tiverem sido removidas.

O modo `snapshots` foi publicado em 27/07/2026. A janela de estabilidade termina
em 03/08/2026 e a limpeza nao deve ocorrer antes dessa data. No fim da janela,
repita o inventario somente leitura, confirme quatro snapshots ativos e quatro
objetos integros, execute os smokes anonimo e autenticado e obtenha autorizacao
explicita do responsavel tecnico antes de remover qualquer chave.

O procedimento final ja esta preparado, mas nao deve ser antecipado:

1. gere e valide um backup/export do banco;
2. execute `supabase/audit/verify_legacy_dataset_cleanup.sql`;
3. exija `cleanup_ready: true` e preserve o resultado junto ao deploy;
4. confirme novamente o project ref e a autorizacao do responsavel;
5. execute `supabase/maintenance/cleanup_legacy_dashboard_datasets.sql`;
6. exija `cleanup_complete: true`, `deleted_legacy_key_count: 4` e
   `remaining_legacy_key_count: 0`;
7. repita o inventario e os smokes no dominio publicado.

O SQL de manutencao e transacional, bloqueia datas anteriores a 03/08/2026,
inventario divergente, snapshots em processamento e ausencia de snapshot ou
objeto ativo. Ele nao remove registros de `dashboard_datasets` nem objetos do
Storage. Depois do commit, a restauracao dos blobs antigos depende do backup
feito no primeiro passo.

### Backfill controlado de producao

O inventario de 24/07/2026 e a verificacao de 27/07/2026 estao em
`docs/audits/supabase_production_inventory_2026-07-24.md`. As duas migrations de
manutencao ja foram aplicadas e o deployment foi confirmado como `complete: true`.
Continuam existindo quatro blobs legados, preservados durante o backfill e durante
a janela de estabilidade do modo `snapshots`.

Depois desse gate, copie `config/env/.env.production-backfill.example` para
`config/env/.env.production-backfill.local` e preencha somente localmente a URL/chave publica
de producao e uma conta de aplicacao que seja admin ativa. O Personal Access Token
continua em `config/env/.env.supabase.local`; nenhum dos dois arquivos preenchidos entra no
Git ou nos backups.

Gere primeiro apenas o plano:

```bash
npm run backfill:production:datasets -- \
  --project-ref <ref-producao> \
  --confirm-project-ref <ref-producao> \
  --expected-project-name "<nome-conferido>" \
  --mode plan
```

O plano autentica para ler os blobs, mas nao grava banco ou Storage e imprime
somente contagens, tipos, linhas e bytes agregados. Ele recusa deployment
incompleto, snapshots ativos, chaves inesperadas, alteracao de contagem/tamanho e
conta sem papel `admin` ativo.

O modo de escrita exige, alem da revisao do plano, dois opt-ins:

```bash
ALLOW_PRODUCTION_BACKFILL=1 npm run backfill:production:datasets -- \
  --project-ref <ref-producao> \
  --confirm-project-ref <ref-producao> \
  --expected-project-name "<nome-conferido>" \
  --mode apply \
  --confirmation BACKFILL_LEGACY_DATASETS
```

O runner cria uma versao ativa por blob, baixa e compara cada snapshot, verifica
que os blobs nao mudaram durante a copia e preserva todas as chaves legadas. Em
falha, reverte as ativacoes ja feitas; se a compensacao ficar incompleta, encerra
com erro explicito. Execute durante uma janela sem uploads e continue em modo
`dual` ate validar o dashboard publicado.

O backfill de producao foi concluido em 27/07/2026. O plano reconheceu quatro
datasets e 6695 linhas; a aplicacao criou e verificou quatro snapshots ativos e
quatro objetos privados, totalizando os mesmos 974425 bytes dos blobs legados.
Uma auditoria read-only independente confirmou as contagens e que as quatro
chaves antigas continuam disponiveis para rollback. Nao repita o backfill neste
estado. O proximo gate e validar login, troca de obra e leitura das quatro
visualizacoes com a hospedagem ainda configurada em `dual`.

Esse gate funcional foi aprovado pelo responsavel em 27/07/2026. Na mesma data,
`VITE_DATASET_PERSISTENCE_MODE=snapshots` foi publicado e os fluxos foram
revalidados. A leitura e a escrita dos blobs legados foram interrompidas; eles
permanecem apenas como rollback ate o fim da janela em 03/08/2026.

Para validar as contas reais de desenvolvimento sem alterar dados, configure
`config/env/.env.roles.local` a partir de `config/env/.env.roles.example` e execute:

```bash
npm run test:development:roles
```

O runner permite requisicoes de leitura e o `POST` do login; qualquer outra
escrita remota interrompe o teste.

Depois da matriz de papeis passar, valide o ciclo real de snapshots somente no
projeto de desenvolvimento:

```bash
ALLOW_DEVELOPMENT_WRITES=1 npm run test:development:snapshots
```

O teste cria duas versoes minimas de Tendencia como editor e duas de Flows como
admin, valida ativacao, integridade, leitura, rollback e bloqueios de RLS. Todas
as versoes e objetos criados sao removidos no bloco de limpeza, inclusive quando
uma assercao falha. O aceite exige zero metadata e zero objetos residuais, alem de
zero snapshots ativos. Nunca execute esse comando em producao.

Depois de confirmar a migration administrativa, valide edicao e administracao
pela interface:

```bash
ALLOW_DEVELOPMENT_WRITES=1 npm run test:development:workflows
```

O runner altera uma classificacao temporaria como editor e cria uma obra manual
temporaria como admin. A limpeza remove os dois registros. O teste falha se a RPC
administrativa estiver ausente e informa as causas internas de falhas paralelas
para que o ambiente nao seja considerado completo por engano.

Se o REST ainda responder `PGRST205`, execute no SQL Editor
`supabase/audit/verify_dashboard_datasets_deployment.sql`. O resultado
`complete: true` comprova tabela, RPCs, RLS, bucket e oito policies; o campo
`data_inventory` informa blobs legados, snapshots por status e objetos no bucket.
A primeira instrução também solicita a recarga do schema do PostgREST.

O reset de cache usa `reset_dashboard_datasets` para remover metadata versionada e
chaves legadas na mesma transacao. Depois do commit, o frontend remove os objetos
retornados pela API de Storage. As policies de manutencao permitem selecionar
versoes inativas somente a quem ja pode administrar a obra ou o escopo global,
pois o Storage exige `SELECT` e `DELETE` para concluir a remocao.

## Backups locais do projeto

```bash
./scripts/backup.sh
```

O script cria snapshots de forma atômica em `backups/snapshots/`, mantém os 12
mais recentes e remove os excedentes mais antigos. Com agendamento a cada 30
minutos, a janela local é de aproximadamente seis horas.

Arquivos locais `.env*` nao entram nos arquivos compactados, mas os templates
`*.example` entram. Dependencias, builds e relatorios gerados tambem sao omitidos;
depois de restaurar, execute `npm ci` e `npm run build`, e recrie as credenciais
locais a partir dos templates e do painel do provedor.

Backups lógicos de bancos remotos ficam separados em `backups/database/`. Essa
pasta pode conter dados reais, é ignorada pelo Git e nunca entra nos snapshots
frequentes do código.

Para um dump de produção, mantenha a senha separada das credenciais de
desenvolvimento: copie `config/env/.env.production-database.example` para
`config/env/.env.production-database.local`, preencha a URI do Session pooler em
`SUPABASE_PRODUCTION_DB_URL` e defina `BACKUP_ENCRYPTION_PASSWORD`. A senha do
banco faz parte da URI; a senha de criptografia deve ser diferente. O arquivo
local é ignorado pelo Git, pelos snapshots de código e por commits.

## Cadastro de contas

O frontend de produção oculta e bloqueia o autocadastro por padrão. Para impedir
também chamadas diretas à API de autenticação, desative **Allow new users to sign
up** em **Supabase > Authentication > Sign In / Providers > Email**. Login por
senha e Google continuam disponíveis para contas existentes; a whitelist da
aplicação segue definindo quem pode editar.

## Retenção de uploads

O aplicativo mantém no Supabase os 12 uploads mais recentes por tipo. Ao registrar o 13º, remove o mais antigo. Um arquivo ativo não pode ser excluído antes da ativação de outro. A limpeza integral do histórico é uma operação administrativa e irreversível.

## Diagnóstico local

Erros não fatais recentes ficam somente na memória da aba, limitados a 100 entradas. O logger remove emails, tokens e parâmetros de URL antes de registrar. Para inspecionar o contexto técnico no console do navegador:

```js
dashboardServices.logger.snapshot()
```

O buffer não é persistido nem enviado a serviços externos e desaparece ao recarregar a página.
