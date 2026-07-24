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
- variaveis publicas: `VITE_APP_ENV=production`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`;
- configuração de headers: `vercel.json`.

O preflight do build bloqueia o deploy se uma das tres variaveis estiver ausente,
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
uma assercao falha. Nunca execute esse comando em producao.

Depois de confirmar a migration administrativa, valide edicao e administracao
pela interface:

```bash
ALLOW_DEVELOPMENT_WRITES=1 npm run test:development:workflows
```

O runner altera uma classificacao temporaria como editor e cria uma obra manual
temporaria como admin. A limpeza remove os dois registros; se a RPC administrativa
estiver ausente, a obra ainda e removida pela policy direta, mas o teste falha para
impedir que o ambiente seja considerado completo.

Se o REST ainda responder `PGRST205`, execute no SQL Editor
`supabase/audit/verify_dashboard_datasets_deployment.sql`. O resultado
`complete: true` comprova tabela, RPCs, RLS, bucket e seis policies; o campo
`data_inventory` informa blobs legados, snapshots por status e objetos no bucket.
A primeira instrução também solicita a recarga do schema do PostgREST.

## Backups locais do projeto

```bash
./scripts/backup.sh
```

O script cria snapshots em `backups/snapshots/`, mantém os 12 mais recentes e remove o mais antigo. Com agendamento a cada 30 minutos, a janela local é de aproximadamente seis horas.

Arquivos `.env*` nao entram nos arquivos compactados. Em uma restauracao, recrie a
configuracao local a partir dos templates versionados e do painel do provedor.

## Retenção de uploads

O aplicativo mantém no Supabase os 12 uploads mais recentes por tipo. Ao registrar o 13º, remove o mais antigo. Um arquivo ativo não pode ser excluído antes da ativação de outro. A limpeza integral do histórico é uma operação administrativa e irreversível.

## Diagnóstico local

Erros não fatais recentes ficam somente na memória da aba, limitados a 100 entradas. O logger remove emails, tokens e parâmetros de URL antes de registrar. Para inspecionar o contexto técnico no console do navegador:

```js
dashboardServices.logger.snapshot()
```

O buffer não é persistido nem enviado a serviços externos e desaparece ao recarregar a página.
