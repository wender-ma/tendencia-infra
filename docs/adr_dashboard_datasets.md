# ADR: persistência dos datasets do dashboard

Status: aprovado para implementação após validação no Supabase de desenvolvimento  
Data: 21/07/2026

## Contexto

Os snapshots processados de Tendência, Flows, Histórico e Curva S são hoje serializados por inteiro na coluna `dashboard_config.valor`. Esse desenho mistura preferências pequenas com datasets grandes, aumenta o custo de leitura e escrita da tabela e exige substituir blobs extensos a cada importação.

As classificações, os aditivos manuais e as movimentações já possuem tabelas próprias. Os quatro datasets restantes são snapshots derivados de arquivos importados e são lidos integralmente pelo frontend; não há edição concorrente de linhas nesses snapshots.

## Decisão

Persistir os snapshots como JSON versionado em um bucket privado dedicado e manter em uma tabela pequena somente os metadados e o ponteiro da versão ativa.

Não normalizar as linhas dos quatro datasets nesta etapa. A normalização aumentaria muito a quantidade de inserts, índices e contratos RLS sem trazer benefício para o padrão atual de acesso, que sempre carrega o snapshot completo. Tabelas normalizadas devem ser reconsideradas quando surgirem consultas parciais no servidor, relatórios SQL ou edição colaborativa por linha.

## Modelo proposto

- Bucket privado: `dashboard-datasets`.
- Caminho por obra: `<codigo_obra>/<tipo>/<versao>.json`.
- Caminho administrativo global: `_global/<tipo>/<versao>.json`.
- Tipos: `tendencia`, `flows`, `historico` e `projecao_raw`.
- Tabela `dashboard_datasets`: `id`, `codigo_obra`, `tipo`, `versao`, `storage_path`, `sha256`, `linhas`, `bytes`, `status`, `upload_history_id`, `created_at`, `created_by`.
- Restrição de uma versão `active` por escopo e tipo.
- RPC transacional para ativar uma versão somente depois que o objeto e os metadados forem persistidos.

`dashboard_config` permanece responsável apenas por configurações pequenas, como título, índice de correção, modo do card, evolução e rótulo de gestão.

## Segurança

- O bucket permanece privado.
- Leitura segue o mesmo contrato de visibilidade aprovado para cada obra.
- Escrita por obra exige editor ativo atribuído à obra.
- Datasets globais exigem administrador ativo.
- Policies de Storage validam o primeiro segmento do caminho; o cliente nunca fornece um caminho fora do escopo autorizado.
- Hash e tamanho são conferidos antes da ativação para detectar objetos incompletos.

## Migração gradual

1. Criar bucket, tabela, constraints, índices, policies e RPC em desenvolvimento.
2. Adicionar ao repositório leitura preferencial do snapshot ativo, com fallback para `dashboard_config`.
3. Implementar escrita dupla temporária e validar rollback de upload.
4. Executar backfill das chaves atuais para objetos versionados.
5. Comparar contagem, hash e conteúdo desserializado por tipo e obra.
6. Interromper a escrita dos quatro blobs em `dashboard_config`.
7. Após uma janela de estabilidade, remover somente as chaves grandes antigas.

## Critérios de aceite

- Troca de obra não baixa datasets de outras obras.
- Uma falha de upload não altera a versão ativa.
- Rollback reativa a versão anterior sem reprocessar o arquivo original.
- O frontend continua funcionando durante a migração com o fallback legado.
- `dashboard_config` deixa de armazenar `dados_tendencia`, `dados_flows`, `dados_historico` e `dados_projraw`.

## Consequências

O carregamento passa a envolver metadados e um objeto do Storage, mas evita blobs grandes em uma tabela de configuração e preserva o modelo de snapshot já usado pela aplicação. A implementação depende de migration e validação manual no projeto Supabase de desenvolvimento antes de qualquer mudança em produção.
