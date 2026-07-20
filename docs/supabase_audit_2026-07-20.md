# Auditoria pública do Supabase - 20/07/2026

## Escopo

Auditoria somente leitura do projeto referenciado pelo `index.html`. As consultas usaram a chave pública, `GET`, `limit=0` e `Prefer: count=exact`.

Nenhuma linha de dados foi baixada e nenhuma operação de escrita foi enviada.

## Resultado do contrato

| Recurso | Colunas esperadas | Linhas visíveis anonimamente |
| --- | ---: | ---: |
| `obras` | 7 | 7 |
| `editores_permitidos` | 7 | 2 |
| `flow_classifications` | 7 | 126 |
| `flow_manuals` | 20 | 0 |
| `projecao_config` | 8 | 1 |
| `projecao_movimentacoes` | 13 | 1 |
| `dashboard_config` | 3 | 11 |
| `upload_history` | 11 | 5 |
| `upload_history_latest` | 11 | 4 |

Todas as tabelas, a view e as colunas esperadas pelo frontend responderam corretamente.

## Achados

### Crítico: dados de autorização expostos anonimamente

`editores_permitidos` possui linhas visíveis para a role anônima. Essa tabela contém ao menos email, nome, papel, status e escopo de obra. A leitura deve ser limitada ao próprio usuário autenticado e a administradores.

### Alto: metadados de uploads expostos anonimamente

`upload_history` e `upload_history_latest` possuem linhas visíveis sem autenticação. Os campos esperados incluem nome de arquivo, remetente, caminho no Storage e datas. A leitura deve exigir autenticação, e a view deve executar com as políticas do usuário chamador.

### Decisão de negócio pendente: leitura pública do dashboard

As tabelas operacionais também possuem linhas visíveis anonimamente. O frontend atual oferece visualização sem login, portanto restringir essas leituras pode alterar o produto. É necessário decidir explicitamente se o dashboard é público ou interno.

### Schema local desatualizado

`docs/supabase_schema.sql` não contém as tabelas e colunas multiobra encontradas. Ele também documenta políticas permissivas da fase sem autenticação e não deve ser usado como migration.

## Limitações

- O endpoint OpenAPI completo exige uma chave `service_role`.
- A auditoria pública não revela tipos, constraints, índices, triggers, funções ou políticas RLS.
- Não foram realizados testes anônimos de escrita para evitar qualquer mutação no banco.
- As políticas do bucket `uploads-history` ainda precisam ser exportadas e revisadas.

## Próximas ações

1. Exportar schema, policies, grants, triggers e views do ambiente implantado.
2. Criar um projeto Supabase separado para testes.
3. Revisar o rascunho de RLS em `supabase/drafts/` contra o dump real.
4. Aplicar primeiro no ambiente de teste.
5. Testar como anônimo, pendente, editor de outra obra, editor da obra e administrador.
6. Aplicar em produção somente com backup e plano de rollback.

## Reprodução

Execute:

```bash
./scripts/audit_supabase_contract.sh
```

O script valida apenas o contrato esperado e contagens anônimas; ele não baixa registros.
