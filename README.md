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
│   ├── js/                 # Configuração, estado, parsers, serviços e código legado
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
- `assets/js/bootstrap.js`: carrega Supabase, SheetJS e ApexCharts pelos pacotes locais antes de iniciar o dashboard.
- `assets/js/config.js`: configurações imutáveis, chaves de armazenamento e variáveis de ambiente.
- `assets/js/state.js`: estado compartilhado de dados, obra ativa, filtros, uploads e preferências.
- `assets/js/performance.mjs`: métricas locais de boot, DOM, parsing e renderização.
- `assets/js/parsers/`: parsers testáveis de Tendência, Flows e Gestões e normalizadores compartilhados.
- `assets/js/ui/`: serviços compartilhados de feedback, loading e modais acessíveis.
- `public/_headers`: headers defensivos e política de cache para hospedagem estática compatível.
- `assets/js/services/supabase-service.js`: criação do cliente Supabase e política compartilhada de retry.
- `assets/js/services/auth-service.js`: sessão, login, whitelist e autorização por papel e obra.
- `assets/js/dashboard-legacy.js`: JavaScript principal preservado como script clássico durante a modularização gradual.
- `docs/supabase_schema.sql`: schema histórico da fase sem autenticação; não executar em produção.
- `docs/supabase_audit_2026-07-20.md`: resultado da auditoria pública, sem leitura de registros.
- `docs/supabase_security_baseline_2026-07-20.md`: revisão dos metadados administrativos implantados.
- `docs/supabase_metadata_2026-07-20.json`: baseline de relações, colunas, grants, policies, funções e constraints.
- `experiments/preview-modal.html`: protótipo isolado do modal.
- `backups/`: versões antigas preservadas para consulta.
- `ROADMAP.md`: plano priorizado e checklist de evolução do projeto.
- `scripts/audit_supabase_contract.sh`: valida o contrato anônimo nos perfis `baseline` e `hardened`.
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

Use `hardened` no lugar de `baseline` depois de aplicar a migration de RLS no projeto de desenvolvimento.

## Validação de importações

Para executar todos os contratos automatizados:

```bash
npm test
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

## Desenvolvimento e build

Requisito: Node.js `^20.19.0` ou `>=22.12.0`.

Instale as dependências e inicie o servidor local:

```bash
npm install
npm run dev
```

O Vite disponibiliza a aplicação em `http://localhost:5173/` por padrão.

As bibliotecas do navegador são instaladas pelo gerenciador de pacotes e empacotadas pelo Vite. O SheetJS usa o pacote oficial `0.20.3`, distribuído pelo CDN oficial do projeto porque o registro npm parou na versão vulnerável `0.18.5`.

O projeto mantém valores padrão para a configuração pública do Supabase. Para usar outro ambiente sem editar o código, crie um arquivo `.env.local` baseado em `.env.example`:

```bash
VITE_SUPABASE_URL="https://seu-projeto.supabase.co"
VITE_SUPABASE_ANON_KEY="sua-chave-anon-public"
```

A chave `anon public` é exposta ao navegador por definição. A proteção dos dados continua dependendo das políticas RLS e da autorização no Supabase.

Para gerar e validar o pacote de produção:

```bash
npm run build
npm run preview
```

O build é criado em `dist/`, que não deve ser versionado.

Para executar o smoke test no Chromium, incluindo o build e o servidor de preview:

```bash
npx playwright install chromium
npm run test:browser
```

## Backup frequente

O projeto possui um script de backup em `scripts/backup.sh` e uma rotina agendada para executá-lo a cada 30 minutos.

Ele cria um arquivo compactado em `backups/snapshots/`, mantém os 12 backups mais recentes e remove automaticamente os mais antigos.

Para criar um backup manual:

```bash
./scripts/backup.sh
```

Para agendar um backup automático a cada 30 minutos no cron:

```bash
*/30 * * * * cd /workspaces/tendencia-infra && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Com esse agendamento, serão preservadas aproximadamente as últimas 6 horas de backups.
