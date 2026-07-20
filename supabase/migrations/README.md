# Migrations do Supabase

Este diretório receberá apenas migrations revisadas e testadas contra um ambiente Supabase de desenvolvimento.

Ainda não há migration executável aqui porque o dump completo do ambiente implantado não está disponível. O contrato público confirma tabelas e colunas, mas não revela tipos, constraints, triggers, grants ou policies existentes.

Rascunhos que não devem ser aplicados ficam em `../drafts/`.

## Fluxo obrigatório

1. Exportar o schema implantado.
2. Salvar o baseline sem segredos.
3. Comparar o baseline com o frontend e os rascunhos.
4. Criar uma migration incremental.
5. Aplicar em desenvolvimento.
6. Executar a matriz de testes por papel e obra.
7. Revisar o diff produzido pelo Supabase.
8. Aplicar em produção com backup e rollback definidos.
