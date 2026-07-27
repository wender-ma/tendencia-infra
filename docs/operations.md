# Operação, deploy e rollback

## Desenvolvimento local

Requisitos: Node.js `>=22.19.0` e npm.

```bash
npm ci
cp .env.example .env.development.local
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
npm run check
npm run test:browser
npm run test:lighthouse
npm audit --audit-level=high
```

`npm run check` executa lint, verificacao de formatacao, contratos e build. O teste
de navegador executa smoke funcional, axe e inspecoes responsivas com configuracao
Supabase ficticia e conexoes remotas bloqueadas.

`npm run test:lighthouse` audita o build de produção com mínimos de 65 em performance, 90 em acessibilidade, 85 em boas práticas e 75 em SEO. O relatório completo fica em `.lighthouseci/lhr.json`; a verificação de indexabilidade é omitida porque o dashboard interno usa `noindex` deliberadamente.

As validacoes que dependem de Supabase real, dados representativos, leitor de tela
ou decisao de negocio estao organizadas em `docs/manual_validation.md`.

Com `.env.development.local` preenchido, o smoke anônimo do ambiente real pode ser
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
branch publicada. O template `.env.production.example` serve apenas como referencia
local e nao deve receber valores reais versionados.

O deploy do frontend não aplica migrations nem altera o banco. Depois da publicação, confirme o carregamento, login, troca de obra e headers HTTP no domínio final.

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

Nunca use apenas o nome visual do projeto para escolher o alvo: confirme o project
ref exibido por `npm run env:target`. Uma migration aplicada no projeto incorreto
nao deve ser revertida automaticamente; primeiro registre o estado e avalie o
rollback com o responsavel pelo banco.

### Inventario remoto somente leitura

Para consultar o estado dos datasets sem executar SQL manualmente, copie
`.env.supabase.example` para `.env.supabase.local` e preencha o Personal Access
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
source .env.development.local
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
6. aguarde a janela de estabilidade antes de remover chaves legadas.

No modo `snapshots`, `dashboard_config` continua armazenando apenas configuracoes
pequenas, como `gestao_label`. Se o deploy apresentar falha, restaure
`VITE_DATASET_PERSISTENCE_MODE=dual` e publique novamente. As chaves legadas so
servem como rollback enquanto ainda nao tiverem sido removidas.

### Backfill controlado de producao

O inventario de 24/07/2026 e a verificacao de 27/07/2026 estao em
`docs/supabase_production_inventory_2026-07-24.md`. As duas migrations de
manutencao ja foram aplicadas e o deployment foi confirmado como `complete: true`.
Continuam existindo quatro blobs legados, que devem ser preservados durante o
backfill.

Depois desse gate, copie `.env.production-backfill.example` para
`.env.production-backfill.local` e preencha somente localmente a URL/chave publica
de producao e uma conta de aplicacao que seja admin ativa. O Personal Access Token
continua em `.env.supabase.local`; nenhum dos dois arquivos preenchidos entra no
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

Para validar as contas reais de desenvolvimento sem alterar dados, configure
`.env.roles.local` a partir de `.env.roles.example` e execute:

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
desenvolvimento: copie `.env.production-database.example` para
`.env.production-database.local` e preencha
`SUPABASE_PRODUCTION_DB_PASSWORD`. O arquivo local é ignorado pelo Git, pelos
snapshots de código e por commits.

## Retenção de uploads

O aplicativo mantém no Supabase os 12 uploads mais recentes por tipo. Ao registrar o 13º, remove o mais antigo. Um arquivo ativo não pode ser excluído antes da ativação de outro. A limpeza integral do histórico é uma operação administrativa e irreversível.

## Diagnóstico local

Erros não fatais recentes ficam somente na memória da aba, limitados a 100 entradas. O logger remove emails, tokens e parâmetros de URL antes de registrar. Para inspecionar o contexto técnico no console do navegador:

```js
dashboardServices.logger.snapshot()
```

O buffer não é persistido nem enviado a serviços externos e desaparece ao recarregar a página.
