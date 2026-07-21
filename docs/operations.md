# Operação, deploy e rollback

## Desenvolvimento local

Requisitos: Node.js `^20.19.0` ou `>=22.12.0` e npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

As variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` são públicas no bundle. Nunca use `service_role` ou qualquer segredo de servidor no frontend.

## Validação

Antes de publicar:

```bash
npm run check
npm run test:browser
npm audit --audit-level=high
```

`npm run check` executa lint, verificação de formatação, contratos e build. O teste de navegador executa smoke funcional, axe e inspeções responsivas com Supabase remoto bloqueado.

## Deploy do frontend

O Vercel deve usar:

- build: `npm run build`;
- diretório de saída: `dist`;
- variáveis públicas: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`;
- configuração de headers: `vercel.json`.

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

1. confirme o ambiente e faça export/backup;
2. execute `./scripts/test_rls_migration.sh`;
3. aplique a migration no SQL Editor do ambiente correto;
4. execute as consultas de verificação correspondentes;
5. use o script pareado em `supabase/rollback/` somente se a reversão for necessária.

Rollback de frontend não reverte banco, Storage ou registros de upload.

## Backups locais do projeto

```bash
./scripts/backup.sh
```

O script cria snapshots em `backups/snapshots/`, mantém os 12 mais recentes e remove o mais antigo. Com agendamento a cada 30 minutos, a janela local é de aproximadamente seis horas.

## Retenção de uploads

O aplicativo mantém no Supabase os 12 uploads mais recentes por tipo. Ao registrar o 13º, remove o mais antigo. Um arquivo ativo não pode ser excluído antes da ativação de outro. A limpeza integral do histórico é uma operação administrativa e irreversível.
