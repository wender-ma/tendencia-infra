# tendencia-infra
Dashboard de tendência orçamentária

## Estrutura do projeto

```text
.
├── index.html              # Aplicação principal
├── package.json            # Comandos de desenvolvimento, testes e build
├── package-lock.json       # Versões exatas das dependências instaladas
├── assets/
│   ├── css/                # Tokens, base, componentes e estilos do dashboard
│   ├── js/                 # Configuração, estado, parsers, serviços e interface
│   └── images/             # Imagens e capturas de tela
├── backups/                # Cópias antigas do index.html
│   └── snapshots/           # Backups automáticos compactados
├── docs/                   # Documentação e scripts de banco de dados
├── experiments/            # Protótipos e telas isoladas
├── scripts/                 # Scripts auxiliares do projeto
├── supabase/                # Auditoria, migrations, rollback e testes SQL
├── ROADMAP.md               # Prioridades e acompanhamento das melhorias
└── README.md
```

## Arquivos importantes

- `index.html`: arquivo principal do dashboard.
- `package.json`: scripts do Vite e suíte de contratos do projeto.
- `assets/css/`: folhas de estilo externas carregadas na ordem `tokens`, `base`, `components` e `dashboard`.
- `assets/js/bootstrap.js`: instala os serviços locais e inicia o dashboard; bibliotecas pesadas entram sob demanda.
- `assets/js/application.mjs`: coordena o boot idempotente da aplicação.
- `assets/js/config.js`: configurações imutáveis, chaves de armazenamento e variáveis de ambiente.
- `assets/js/state.js`: estado compartilhado de dados, obra ativa, filtros, uploads e preferências.
- `assets/js/performance.mjs`: métricas locais de boot, DOM, parsing e renderização.
- `assets/js/parsers/`: parsers testáveis de Tendência, Flows e Gestões e normalizadores compartilhados.
- `assets/js/ui/`: serviços compartilhados de feedback, loading e modais acessíveis.
- `public/_headers`: headers defensivos e política de cache para hospedagem estática compatível.
- `vercel.json`: build, saída e headers aplicados no ambiente publicado da Vercel.
- `assets/js/services/supabase-service.js`: criação do cliente Supabase e política compartilhada de retry.
- `assets/js/services/dependency-service.mjs`: carregamento sob demanda e cache do SheetJS e ApexCharts.
- `assets/js/services/excel-service.mjs`: leitura com progresso e processamento de planilhas em Web Worker.
- `assets/js/services/logger.mjs`: buffer local de diagnóstico com contexto e redação de dados sensíveis.
- `assets/js/services/upload-policy.mjs`: validação única de tamanho, arquivo vazio e extensões aceitas.
- `assets/js/services/upload-transaction.mjs`: coordenação de commit e rollback compensatório dos uploads.
- `assets/js/ui/actions.mjs`: delegação central das ações declaradas pelo HTML e pelos templates.
- `assets/js/services/auth-service.js`: sessão, login, whitelist e autorização por papel e obra.
- `docs/supabase_schema.sql`: schema histórico da fase sem autenticação; não executar em produção.
- `docs/supabase_audit_2026-07-20.md`: resultado da auditoria pública, sem leitura de registros.
- `docs/supabase_security_baseline_2026-07-20.md`: revisão dos metadados administrativos implantados.
- `docs/supabase_metadata_2026-07-20.json`: baseline de relações, colunas, grants, policies, funções e constraints.
- `docs/supabase_development_audit_2026-07-23.md`: evidência somente leitura do ambiente de desenvolvimento e estado das migrations.
- `docs/supabase_production_log_audit_2026-07-27.md`: auditoria agregada de atividade e escopo dos dados de produção, sem identidades ou conteúdo.
- `docs/innerhtml_inventory_2026-07-21.md`: inventário das renderizações HTML e regras contra regressões de XSS.
- `docs/operations.md`: execução local, validação, deploy, rollback e retenção.
- `docs/manual_validation.md`: checklist de Supabase real, dados, acessibilidade e publicação.
- `experiments/preview-modal.html`: protótipo isolado do modal.
- `backups/`: versões antigas preservadas para consulta.
- `ROADMAP.md`: plano priorizado e checklist de evolução do projeto.
- `scripts/audit_supabase_contract.sh`: valida o contrato anônimo nos perfis `baseline` e `hardened`.
- `scripts/audit_supabase_inventory.mjs`: inventaria deployment e volume de datasets pela Management API somente leitura, sem retornar conteúdo ou códigos de obra.
- `scripts/audit_supabase_logs.mjs`: agrega escritas, erros e autenticação em janelas limitadas, sem retornar eventos brutos ou identidades.
- `scripts/test_rls_migration.sh`: aplica as migrations de RLS e operações administrativas, valida regras e testa os rollbacks em PostgreSQL descartável.
- `supabase/audit/`: consultas somente leitura para inventariar o ambiente implantado, incluindo exportação em um único JSON.
- `supabase/drafts/`: SQL em revisão que não deve ser aplicado diretamente.
- `supabase/migrations/`: migrations incrementais revisadas e testadas localmente.
- `supabase/rollback/`: recuperação emergencial correspondente às migrations.
- `supabase/tests/`: fixture e asserções SQL de segurança.

## Validação de RLS

Com Docker disponível, execute:

```bash
./scripts/test_rls_migration.sh
```

O teste sobe um PostgreSQL temporário, recria o baseline auditado, aplica a migration, valida policies e permissões, executa o rollback e confirma a restauração. Nenhum banco remoto é alterado.

Para auditar um projeto Supabase remoto sem alterar o `index.html`, informe a URL do projeto e a chave `anon public` por variáveis de ambiente:

```bash
SUPABASE_URL="https://seu-projeto.supabase.co" \
SUPABASE_ANON_KEY="sua-chave-anon-public" \
./scripts/audit_supabase_contract.sh baseline
```

Use `hardened` no lugar de `baseline` depois de aplicar a migration de RLS no projeto de desenvolvimento. Depois da migration de snapshots versionados, use `datasets`; esse perfil também exige a tabela `dashboard_datasets`.

Para inventariar schema, policies e volume dos datasets sem abrir o SQL Editor,
crie `.env.supabase.local` a partir do template administrativo e informe um
Personal Access Token:

```bash
cp .env.supabase.example .env.supabase.local
npm run audit:supabase:inventory -- \
  --project-ref abcdefghijklmnopqrst \
  --confirm-project-ref abcdefghijklmnopqrst
```

O comando confirma que o token possui acesso ao alvo e usa exclusivamente o
endpoint SQL `read-only` da Management API. A saída contém apenas estado do
deployment, contagens e tamanhos agregados; não inclui conteúdo dos datasets,
códigos de obra, token ou senha.

## Validação de importações

Para executar todos os contratos automatizados:

```bash
npm test
```

Para validar lint, formatação, contratos e build em sequência:

```bash
npm run check
```

O smoke de navegador inclui axe e inspeções visuais responsivas:

```bash
npm run test:browser
```

Os testes podem também ser executados individualmente:

```bash
./scripts/test_import_headers.js
./scripts/test_import_dates.js
./scripts/test_modal_contract.js
./scripts/test_error_contract.js
./scripts/test_classification_contract.js
./scripts/test_asset_contract.js
./scripts/test_accessibility_contract.js
./scripts/test_responsive_contract.js
./scripts/test_upload_transaction_contract.js
./scripts/test_admin_transaction_contract.js
./scripts/test_dependency_contract.js
./scripts/test_module_contract.js
./scripts/test_auth_contract.js
./scripts/test_state_contract.js
```

Os testes cobrem cabeçalhos, datas, diálogos, dependências, módulos, estado, autorização e ausência de blocos de erro silenciosos.

## Desenvolvimento, ambientes e build

Requisito: Node.js `>=22.19.0`.

O frontend nao possui endpoint ou chave Supabase padrao no codigo. Sem configuracao
explicita, ele inicia em modo offline e usa apenas o armazenamento local do navegador.
Isso evita que um desenvolvimento local grave acidentalmente no ambiente de producao.

Para desenvolvimento, use um projeto Supabase exclusivo e crie a configuracao local:

```bash
npm install
cp .env.example .env.development.local
```

Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com o projeto de
desenvolvimento. Mantenha `VITE_APP_ENV=development` e nao use a URL de
producao nesse arquivo. Mantenha `VITE_DATASET_PERSISTENCE_MODE=dual` enquanto
o ambiente ainda depender dos blobs antigos de `dashboard_config`; use
`snapshots` somente depois de confirmar a migration e os dados versionados.
Em seguida, inicie o servidor:

```bash
npm run dev
```

O Vite disponibiliza a aplicação em `http://localhost:5173/` por padrão.

As bibliotecas do navegador são instaladas pelo gerenciador de pacotes e empacotadas pelo Vite. O SheetJS usa o pacote oficial `0.20.3`, distribuído pelo CDN oficial do projeto porque o registro npm parou na versão vulnerável `0.18.5`.

Para producao, configure no provedor de hospedagem as quatro variaveis abaixo. O
endpoint deve ser a origem do projeto, por exemplo `https://abc.supabase.co`,
sem o sufixo `/rest/v1`:

```bash
VITE_APP_ENV="production"
VITE_SUPABASE_URL="https://seu-projeto.supabase.co"
VITE_SUPABASE_ANON_KEY="sua-chave-anon-public"
VITE_DATASET_PERSISTENCE_MODE="dual"
```

A configuracao e recusada quando `VITE_APP_ENV` nao corresponde ao modo do Vite.
A chave `anon public` e exposta ao navegador por definicao; a protecao dos dados
continua dependendo das politicas RLS e da autorizacao no Supabase.

O modo `dual` consulta e grava temporariamente os datasets versionados e os quatro
blobs legados. O modo `snapshots` deixa de consultar e gravar esses blobs, preserva
somente configuracoes pequenas em `dashboard_config` e bloqueia uploads se o schema
versionado estiver indisponivel. A troca para `snapshots` e o rollback para `dual`
nao exigem alteracao de codigo, mas devem seguir o inventario e os gates descritos
em `docs/operations.md`.

Para gerar e validar o pacote de producao pronto para publicar:

```bash
npm run build:production
npm run preview
```

O estado agregado do banco de produção está registrado em
`docs/supabase_production_inventory_2026-07-24.md`. O backfill dos datasets possui
um runner separado, bloqueado por alvo, deployment completo, admin ativo e opt-in
explícito. Consulte `docs/operations.md` e execute sempre `--mode plan` antes de
qualquer escrita.

`npm run build` continua disponivel para verificacoes locais e de CI; sem
credenciais ele gera deliberadamente uma versao offline do dashboard.

O build é criado em `dist/`, que não deve ser versionado.

Para executar o smoke test no Chromium, incluindo o build e o servidor de preview:

```bash
npx playwright install chromium
npm run test:browser
```

## Backup frequente

O projeto possui um script de backup em `scripts/backup.sh` e uma rotina agendada para executá-lo a cada 30 minutos.

Ele cria primeiro um arquivo temporário e só publica o snapshot depois que a
compactação termina. Os 12 backups completos mais recentes são mantidos e os mais
antigos são removidos automaticamente.

Configurações locais `.env*` são omitidas para não replicar credenciais. Os
templates `*.example`, código-fonte, documentação, migrations e lockfile entram no
snapshot. Dependências, build e relatórios gerados (`node_modules/`, `dist/`,
Playwright e Lighthouse) são omitidos porque podem ser recriados com `npm ci` e
`npm run build`.

Para criar um backup manual:

```bash
./scripts/backup.sh
```

Para agendar um backup automático a cada 30 minutos no cron:

```bash
*/30 * * * * cd /workspaces/tendencia-infra && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Com esse agendamento, serão preservadas aproximadamente as últimas 6 horas de backups.
