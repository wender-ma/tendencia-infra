# Backups Legados

Os monolitos antigos foram removidos do estado atual do repositorio. Eles seguem
recuperaveis pelo historico do Git, sem permanecer duplicados em cada checkout.

Backups de fonte ficam em `../snapshots/` com retencao de 12 itens. Dumps
criptografados do banco ficam em `../database/` e nunca entram no Git.
