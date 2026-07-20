# tendencia-infra
Dashboard de tendência orçamentária

## Estrutura do projeto

```text
.
├── index.html              # Aplicação principal
├── assets/
│   └── images/             # Imagens e capturas de tela
├── backups/                # Cópias antigas do index.html
│   └── snapshots/           # Backups automáticos compactados
├── docs/                   # Documentação e scripts de banco de dados
├── experiments/            # Protótipos e telas isoladas
├── scripts/                 # Scripts auxiliares do projeto
└── README.md
```

## Arquivos importantes

- `index.html`: arquivo principal do dashboard.
- `docs/supabase_schema.sql`: schema do banco Supabase.
- `experiments/preview-modal.html`: protótipo isolado do modal.
- `backups/`: versões antigas preservadas para consulta.

## Backup frequente

O projeto possui um script de backup em `scripts/backup.sh`.

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
