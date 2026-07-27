# Auditoria agregada de logs e dados de producao - 27/07/2026

## Escopo e privacidade

A auditoria foi executada contra o projeto confirmado
`jmfgegnfctlyuevqadba` (`Tendência de Obras`) usando somente a Management API.
O periodo solicitado foi de `2026-07-20T00:00:00Z` ate
`2026-07-27T13:09:52Z`, dividido em oito janelas inferiores a 24 horas.

O runner utilizou o endpoint ClickHouse `analytics/endpoints/logs`, que substitui
o endpoint legado `logs.all`. A saida conteve apenas contagens por dia, metodo,
recurso, status e papel. Nao foram consultados ou impressos eventos brutos,
caminhos completos, IPs, emails, IDs de usuario, codigos de obra, nomes de
arquivo ou payloads.

Referencias oficiais:

- https://supabase.com/docs/guides/telemetry/logs
- https://supabase.com/changelog/48235-migration-of-supabase-management-api-logs-all-analytics-endpoint-to-logs-endpoint

## Atividade de escrita retida

| Data | Metodo | Recurso agregado | Papel | Status | Eventos |
| --- | --- | --- | --- | ---: | ---: |
| 27/07/2026 | `PATCH` | `editores_permitidos` | `authenticated` | 204 | 1 |
| 27/07/2026 | `POST` | `dashboard_datasets` | `authenticated` | 201 | 4 |
| 27/07/2026 | `POST` | `rpc` | `authenticated` | 200 | 7 |
| 27/07/2026 | `POST` | `storage` | `authenticated` | 200 | 4 |
| **Total** |  |  |  |  | **16** |

Todos os 16 eventos foram autenticados e bem-sucedidos. O periodo retido nao
apresentou gravacao bem-sucedida com papel `anon` ou sem papel. As contagens de
datasets, RPC e Storage sao compativeis com o backfill autorizado executado no
mesmo dia, mas logs agregados isoladamente nao comprovam intencao.

## Sinais de banco e autenticacao

Foram agregados 50 eventos PostgreSQL relevantes:

| SQLSTATE | Papel de banco | Eventos | Interpretacao |
| --- | --- | ---: | --- |
| `42501` | `authenticator` | 40 | operacoes recusadas por permissao |
| `08006` | `supabase_admin` | 9 | interrupcoes de conexao, sem evidencia de escrita |
| `42P01` | `supabase_read_only_user` | 1 | consulta conhecida ao historico de migrations ausente |

Os `42501` ocorreram em 20, 21, 24 e 27/07 e sao coerentes com os testes de RLS e
preflights executados durante o endurecimento. Como a saida nao inclui identidade
ou evento bruto, eles comprovam bloqueio pelo banco, mas nao atribuem autoria.

Os 47 eventos de autenticacao agregados incluem renovacao/revogacao de tokens,
logins, logouts, uma recuperacao e um cadastro. Nenhum nome, email ou ID foi
coletado.

## Inventario operacional agregado

Uma consulta separada em `/database/query/read-only` registrou apenas contagens,
datas extremas e linhas sem escopo obrigatorio:

| Relacao | Linhas | Primeira atividade | Ultima atividade | Sem escopo |
| --- | ---: | --- | --- | ---: |
| `dashboard_config` | 11 | 07/07/2026 | 15/07/2026 | 0 |
| `editores_permitidos` | 2 | 06/07/2026 | 27/07/2026 | 0 |
| `flow_classifications` | 126 | 10/07/2026 | 10/07/2026 | 0 |
| `flow_manuals` | 0 | - | - | 0 |
| `obras` | 7 | 07/07/2026 | 07/07/2026 | 0 |
| `projecao_config` | 1 | 08/07/2026 | 08/07/2026 | 0 |
| `projecao_movimentacoes` | 1 | 08/07/2026 | 08/07/2026 | 0 |
| `upload_history` | 5 | 08/07/2026 | 09/07/2026 | 0 |
| **Total** | **153** |  |  | **0** |

O inventario nao encontrou registros sem `codigo_obra` onde o escopo e
obrigatorio. Os dados mais antigos foram criados antes da janela de logs
solicitada, portanto sua autoria e intencao nao podem ser reconstruidas por esta
evidencia.

## Conclusao

Nao foi encontrada evidencia agregada de escrita anonima bem-sucedida no periodo
retido, nem registros operacionais sem escopo obrigatorio. As escritas observadas
foram autenticadas e coincidem em quantidade e data com as operacoes autorizadas
de backfill e configuracao.

Esta conclusao nao prova a ausencia historica de alteracoes indevidas. A cobertura
depende da retencao do plano, de quais fontes foram registradas e das configuracoes
de log vigentes em cada data. Para auditoria futura com atribuicao, habilite
pgAudit para escritas e defina uma politica de retencao antes de ocorrer um
incidente; essa mudanca deve considerar custo, privacidade e volume de logs.
