# ADR: persistência dos datasets do dashboard

Status: modo snapshots publicado; em janela de estabilidade
Data: 23/07/2026

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
- A RPC de ativação confirma que o objeto existe; o cliente calcula hash e tamanho ao gravar e os valida novamente antes de consumir o JSON, usando o fallback legado se a integridade falhar.

## Migração gradual

1. Criar bucket, tabela, constraints, índices, policies e RPC em desenvolvimento.
2. Adicionar ao repositório leitura preferencial do snapshot ativo, com fallback para `dashboard_config`. Concluído no frontend.
3. Implementar escrita dupla temporária e validar rollback de upload. Concluído localmente e no Supabase de desenvolvimento em 24/07/2026.
4. Executar backfill das chaves atuais para objetos versionados. Dispensado no desenvolvimento em 24/07/2026 por ausência de dados. Concluído em produção em 27/07/2026: quatro blobs e 974425 bytes originaram quatro snapshots ativos e quatro objetos privados, com as chaves legadas preservadas.
5. Comparar contagem, hash e conteúdo desserializado por tipo e obra. Validado em desenvolvimento com duas versões de Tendência por editor e duas de Flows por admin, incluindo leitura e rollback. Em produção, o runner releu os quatro objetos e verificou hash, tamanho, conteúdo e 6695 linhas antes de concluir.
6. Interromper a leitura e a escrita dos quatro blobs em `dashboard_config`. Concluído em produção em 27/07/2026: o modo `snapshots` foi publicado e validado com login, recarga, abas, troca de obra, administração e smoke anônimo.
7. Após uma janela mínima de sete dias corridos em `snapshots`, remover somente as chaves grandes antigas. A janela começou em 27/07/2026 e a limpeza não pode ocorrer antes de 03/08/2026; exige novo inventário íntegro e autorização explícita do responsável técnico. A auditoria e o SQL transacional estão preparados em `supabase/audit/verify_legacy_dataset_cleanup.sql` e `supabase/maintenance/cleanup_legacy_dashboard_datasets.sql`.

## Critérios de aceite

- Troca de obra não baixa datasets de outras obras.
- Uma falha de upload não altera a versão ativa.
- Rollback reativa a versão anterior sem reprocessar o arquivo original.
- Reset de cache remove ponteiros versionados e chaves legadas na mesma transação e confirma a limpeza posterior dos objetos.
- O frontend continua funcionando durante a migração com o fallback legado.
- `dashboard_config` deixa de armazenar `dados_tendencia`, `dados_flows`, `dados_historico` e `dados_projraw`.

## Consequências

O carregamento passa a envolver metadados e um objeto do Storage, mas evita blobs grandes em uma tabela de configuração e preserva o modelo de snapshot já usado pela aplicação. A migration, a leitura, a integridade, as permissões, o rollback e o reset transacional foram validados em desenvolvimento. O inventário próprio de produção está registrado em `supabase_production_inventory_2026-07-24.md`; migrations, backfill e validações funcionais em `dual` e `snapshots` foram concluídos em 27/07/2026. Resta cumprir a janela até 03/08/2026, repetir o inventário e obter autorização para a limpeza legada.
