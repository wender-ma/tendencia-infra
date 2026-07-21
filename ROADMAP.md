# Roadmap técnico

Este documento registra as melhorias planejadas para o Dashboard de Tendência. Ele deve ser atualizado durante cada implementação para manter visíveis a prioridade, o progresso, as decisões e os critérios de conclusão.

Última atualização: 21/07/2026

## Como acompanhar

- `[ ]` Pendente
- `[ ]` Em andamento: acrescentar `**EM ANDAMENTO**` ao item
- `[x]` Concluído: acrescentar a referência do commit ou pull request
- `[ ]` Bloqueado: acrescentar `**BLOQUEADO**` e explicar o motivo
- Atualizar a data deste documento sempre que um status mudar.
- Não iniciar uma prioridade inferior enquanto houver risco crítico não tratado, salvo quando a atividade for independente e estiver claramente registrada.

## Níveis de prioridade

| Prioridade | Significado                                             | Momento recomendado |
| ---------- | ------------------------------------------------------- | ------------------- |
| P0 Crítico | Segurança, perda de dados ou acesso indevido            | Imediato            |
| P1 Alto    | Bugs, confiabilidade, mobile e acessibilidade essencial | Próxima versão      |
| P2 Médio   | Arquitetura, performance, testes e manutenção           | Após estabilização  |
| P3 Baixo   | Polimento visual, SEO e melhorias opcionais             | Evolução contínua   |

## Estado inicial

- [x] Revisão técnica inicial do `index.html` concluída.
- [x] Rotina de backup local criada.
- [x] Primeiro commit desta etapa criado.
- [x] Roadmap persistente criado no projeto.
- [ ] Confirmar responsável técnico pelas alterações no Supabase.
- [ ] Definir ambiente de desenvolvimento separado da produção.
- [ ] Criar obra e usuários de teste sem dados confidenciais.

## P0: segurança crítica

### 1. Auditar e versionar o Supabase

> Atenção em 20/07/2026: `docs/supabase_schema.sql` é um artefato histórico da fase sem autenticação, contém políticas `anon_all_*` e não representa as tabelas/campos multiobra usados pelo frontend. O arquivo recebeu um aviso para não ser executado em produção. A correção de RLS depende primeiro da exportação do schema realmente implantado.

> Auditoria pública em 20/07/2026: todas as tabelas/colunas esperadas foram confirmadas com `limit=0`, mas a role anônima consegue contabilizar linhas em `editores_permitidos`, `upload_history` e tabelas operacionais. Nenhum registro foi baixado. Evidências em `docs/supabase_audit_2026-07-20.md`.

> Baseline administrativo recebido e revisado em 20/07/2026: 11 relações com RLS, 24 policies, 231 grants, 25 índices, 21 constraints, quatro funções e um trigger. O JSON sem valores de negócio foi versionado em `docs/supabase_metadata_2026-07-20.json`; conclusões em `docs/supabase_security_baseline_2026-07-20.md`.

- [x] Exportar e revisar os metadados do schema realmente implantado no Supabase.
- [x] Comparar o schema implantado com `docs/supabase_schema.sql`.
- [x] Validar o contrato público de tabelas e colunas esperado pelo frontend (implementado em `1cb9096`).
- [x] Criar auditor somente leitura e inventário para o SQL Editor (implementado em `1cb9096`).
- [x] Criar diretório `supabase/migrations/` e separar rascunhos não executáveis (implementado em `1cb9096`).
- [x] Promover o rascunho de RLS para migration após comparar com o baseline real.
- [x] Versionar as tabelas `obras`, `editores_permitidos` e `upload_history` no baseline de metadados.
- [x] Versionar todos os campos `codigo_obra` esperados pelo frontend no baseline de metadados.
- [x] Criar rollback emergencial que restaura o baseline auditado.
- [x] Testar migration e rollback em PostgreSQL descartável com asserções por papel e obra.
- [x] Importar o schema/base no projeto Supabase de desenvolvimento antes da migration.
- [x] Aplicar a migration primeiro em um projeto Supabase de desenvolvimento.
- [x] Remover políticas `anon_all_*` permissivas.
- [x] Criar na migration políticas RLS separadas para leitura, inserção, atualização e exclusão.
- [x] Restringir na migration administradores pelo papel `admin` ativo.
- [x] Restringir na migration editores às obras atribuídas em `editores_permitidos`.
- [x] Revisar e endurecer na migration as políticas do bucket privado `uploads-history`.
- [ ] Confirmar se visualização anônima de dados é permitida pelo negócio.
- [ ] Auditar logs e dados para identificar alterações indevidas anteriores.
- [x] Testar a API diretamente como anônimo, usuário rejeitado, editor e administrador.
- [x] Executar `./scripts/audit_supabase_contract.sh hardened` após aplicar a migration.

Critério de conclusão: chamadas anônimas de escrita, operações administrativas por não administradores e alterações em obras não atribuídas são rejeitadas pelo banco.

### 2. Corrigir autorização no frontend

- [x] Criar `requireEditorForActiveProject()` (implementado em `1cb9096`).
- [x] Criar `requireAdmin()` (implementado em `1cb9096`).
- [x] Fazer `requireEditor()` delegar ao guard da obra ativa (implementado em `1cb9096`).
- [x] Proteger `onValorChange()` (implementado em `1cb9096`).
- [x] Proteger `onRefletidoChange()` (implementado em `1cb9096`).
- [x] Proteger configurações e cadeados do controle de projeção (implementado em `1cb9096`).
- [x] Proteger criação, edição e exclusão de aditivos manuais (implementado em `1cb9096`).
- [x] Proteger uploads por CSV e Excel; operações multiobra exigem administrador (implementado em `1cb9096`).
- [x] Proteger todas as funções administrativas, além de esconder a interface (implementado em `1cb9096`).
- [x] Impedir que uma aba Admin salva no `localStorage` seja restaurada sem permissão (implementado em `1cb9096`).
- [x] Desabilitar controles editáveis para usuários somente leitura (implementado em `1cb9096`).
- [x] Revalidar permissão após troca de obra e renovação de sessão (implementado em `1cb9096`).

Critério de conclusão: nenhum fluxo de escrita depende apenas de elementos escondidos por CSS, e todos os handlers validam o papel e a obra ativa.

### 3. Eliminar vetores de XSS

- [x] Inventariar todas as atribuições de `innerHTML`.
- [x] Classificar cada valor como constante, interno ou externo.
- [x] Substituir `innerHTML` por `textContent`/`replaceChildren` quando não houver marcação necessária.
- [x] Criar opções dinâmicas com `new Option()` nos filtros auditados (implementado em `1cb9096`).
- [x] Criar opções dinâmicas com `new Option()` no seletor de obra do header.
- [x] Escapar grupos e códigos usados nos pontos auditados da Tendência (implementado em `1cb9096`).
- [x] Escapar datas, motivos e descrições usados nos pontos auditados de Flows (implementado em `1cb9096`).
- [x] Escapar nomes de arquivos e abas de Excel usados em HTML (implementado em `1cb9096`).
- [x] Escapar emails, nomes e mensagens retornadas pelo Supabase nos pontos auditados (implementado em `1cb9096`).
- [x] Remover HTML dinâmico das mensagens de progresso do Excel (implementado em `1cb9096`).
- [x] Remover dados importados de handlers JavaScript inline nos filtros e na árvore de projeção (implementado em `1cb9096`).
- [x] Avaliar Trusted Types: adiado até haver uma política sanitizadora estrita; os sinks `innerHTML` foram eliminados e um contrato impede regressão.
- [x] Criar testes com tags, atributos de evento, esquemas de URL e caminhos maliciosos.

Critério de conclusão: conteúdo importado como `<img onerror=...>` é exibido somente como texto e nunca executado.

### 4. Corrigir comunicação de privacidade

- [x] Remover a afirmação de funcionamento `100% offline` (implementado em `1cb9096`).
- [x] Explicar quais dados ficam no `localStorage` (implementado em `1cb9096`).
- [x] Explicar quais dados e arquivos são enviados ao Supabase (implementado em `1cb9096`).
- [x] Informar quem pode visualizar e editar cada obra.
- [x] Documentar retenção e exclusão dos backups de upload.
- [ ] Validar os textos com o responsável pelos dados do projeto.

## P1: confiabilidade e funcionalidade

### 5. Tornar operações compostas atômicas

- [x] Criar RPC transacional para alteração de permissões de usuário (`20260720203000_admin_transactions.sql`).
- [x] Evitar apagar permissões antes de validar e inserir as novas (`20260720203000_admin_transactions.sql`).
- [x] Criar RPC transacional para exclusão completa de obra (`20260720203000_admin_transactions.sql`).
- [x] Configurar chaves estrangeiras e cascatas controladas (`20260720203000_admin_transactions.sql`).
- [x] Interromper upload quando Storage, metadata ou persistência falhar.
- [x] Adicionar estados `processing`, `active` e `failed` aos uploads.
- [x] Ativar um novo dataset somente após persistência completa.
- [x] Exibir erro parcial em vez de mensagem geral de sucesso.
- [x] Implementar recuperação ou limpeza de uploads incompletos.

### 6. Corrigir bugs conhecidos

- [x] Corrigir os limites de dados desatualizados de `90/60` para `3/2` meses.
- [x] Resolver `confirmModal(false)` ao fechar com Escape, backdrop ou botão X.
- [x] Unificar o fechamento e a resolução de todos os modais.
- [x] Remover a implementação antiga de `handleAuthClick()`.
- [x] Corrigir interpretação ambígua de datas brasileiras e americanas.
- [x] Validar cabeçalhos obrigatórios antes de iniciar cada parser.
- [x] Evitar concorrência no fluxo read-merge-write das classificações.
- [x] Exibir erros atualmente ocultados por blocos `catch` vazios.

### 7. Corrigir responsividade

- [x] Adicionar meta `viewport`.
- [x] Adicionar rolagem horizontal aos containers de tabela.
- [x] Adaptar header e ações para telas pequenas.
- [x] Adaptar abas para mobile sem perda de acesso.
- [x] Reorganizar toolbars e filtros em telas estreitas.
- [x] Revisar larguras mínimas e fixas de inputs e colunas.
- [x] Garantir que o header sticky não esconda conteúdo.
- [x] Testar em larguras de 320, 375, 768, 1024 e 1440 pixels (Playwright em 20/07/2026).

### 8. Implementar acessibilidade essencial

- [x] Criar `h1` e hierarquia consistente de headings.
- [x] Adotar `header`, `nav`, `main`, `section` e `footer`.
- [x] Converter abas em botões com `tablist`, `tab` e `tabpanel`.
- [x] Implementar navegação de abas por setas e teclado.
- [x] Associar labels e campos com `for` e `id`.
- [x] Usar formulários e eventos `submit` nos fluxos principais.
- [x] Adicionar `role="dialog"`, `aria-modal` e nomes acessíveis aos modais.
- [x] Implementar foco inicial, focus trap e restauração de foco.
- [x] Adicionar `aria-live` aos toasts, erros e estados de carregamento.
- [x] Tornar linhas clicáveis acessíveis por teclado ou usar botões/links.
- [x] Implementar ordenação acessível com `aria-sort`.
- [x] Adicionar nomes acessíveis a botões que exibem apenas ícones.
- [x] Criar estilo global `:focus-visible`.
- [x] Corrigir contraste de `--text-lighter` nos temas claro e escuro.
- [ ] Validar os fluxos principais com teclado e leitor de tela (teclado validado; leitor de tela pendente).

Critério de conclusão: os fluxos principais funcionam sem mouse e não apresentam erros graves no axe.

## P2: arquitetura e manutenção

### 9. Separar o arquivo monolítico

- [x] Manter no `index.html` apenas metadados, landmarks e containers; abas e diálogos estáticos estão em `assets/views`.
- [x] Criar `assets/css/tokens.css`.
- [x] Criar `assets/css/base.css`.
- [x] Criar `assets/css/components.css`.
- [x] Criar `assets/css/dashboard.css`.
- [x] Criar módulo de configuração e inicialização.
- [x] Criar módulo de autenticação e autorização.
- [x] Criar serviço de acesso ao Supabase.
- [x] Criar módulo único de estado.
- [x] Separar parsers de Tendência, Flows e Gestões.
- [x] Separar modais, toasts e loading em módulos de UI.
- [x] Separar uploads em módulos próprios de política, transação, repositório, coordenação e interface.
- [x] Separar tabelas em módulos de UI.
- [x] Separar cada aba dinâmica em um módulo de visualização (a aba Manual permanece estática).
- [ ] Remover aliases e variáveis globais gradualmente (catálogo e ciclo de obras, armazenamento, uploads, manutenção destrutiva, persistência, exportações, autenticação, shell e editor de Flows isolados; adaptadores temporários permanecem enquanto o coordenador legado é reduzido).
- [x] Remover handlers `onclick`, `onchange`, `oninput` e `onfocus` inline.

### 10. Modernizar dependências e build

- [x] Criar `package.json` e lockfile.
- [x] Fixar versões exatas de Supabase, SheetJS e ApexCharts.
- [x] Configurar Vite ou ferramenta equivalente.
- [x] Gerar assets minificados e com hash, incluindo o script clássico legado.
- [x] Remover scripts bloqueantes do `head`.
- [x] Externalizar favicon e logo em arquivos otimizados.
- [ ] Configurar Content Security Policy sem `unsafe-inline` (scripts já restritos a `self`; estilos inline do legado/ApexCharts ainda impedem a conclusão).
- [x] Configurar headers de segurança adequados ao ambiente de hospedagem.

### 11. Melhorar performance

- [x] Consultar somente configurações necessárias para a obra ativa.
- [x] Evitar carregar todas as classificações de todas as obras no boot.
- [ ] Retirar datasets grandes de `dashboard_config`.
- [ ] Avaliar tabelas normalizadas ou JSON versionado no Storage.
- [x] Renderizar somente a aba ativa.
- [x] Carregar SheetJS somente na primeira importação, reativação ou exportação Excel.
- [x] Carregar ApexCharts somente quando uma visualização possui gráfico para renderizar.
- [x] Separar editor, uploads e visualizações em chunks próprios durante o boot.
- [x] Evitar que `renderAll()` redesenhe abas ocultas após pequenas alterações.
- [x] Paginar Detalhamento, Flows e Histórico em blocos de 100 linhas.
- [x] Processar Excel em Web Worker.
- [ ] Revisar o limite de upload de 50 MB com arquivos reais representativos (política já centralizada e limites automatizados).
- [x] Medir tempo de boot, tempo de parsing/renderização e quantidade de nós no DOM.
- [x] Manter o descarte de instâncias ApexCharts antes de redesenhar.

### 12. Fortalecer os parsers

- [x] Mapear colunas por nome de cabeçalho, não por posição fixa.
- [x] Validar delimitador, BOM e encoding.
- [x] Definir formato de data explícito e sem ambiguidade.
- [x] Validar números nos formatos brasileiro e internacional.
- [x] Detectar aspas ou linhas malformadas.
- [x] Validar o arquivo inteiro antes de alterar o estado global.
- [x] Produzir relatório de linhas aceitas, ignoradas e rejeitadas.
- [x] Preservar o dataset anterior quando a importação falhar.

## P2: qualidade, testes e operação

- [x] Criar testes unitários para números e datas.
- [x] Criar testes unitários para os três parsers.
- [x] Criar testes de autorização por papel e obra.
- [x] Criar testes de XSS para campos importados.
- [x] Criar testes de integração para upload, falhas por etapa e rollback parcial.
- [ ] Criar testes E2E para login, troca de obra, edição e administração.
- [x] Criar testes visuais para mobile e desktop.
- [x] Executar axe no CI.
- [x] Executar Lighthouse no CI com orçamentos e relatório para download.
- [x] Configurar lint e formatação automática para os módulos extraídos.
- [x] Adicionar logs de erro com contexto, retenção limitada e redação de dados sensíveis.
- [x] Documentar execução local, build, deploy e rollback.

## P3: UX, UI e metadados

- [x] Padronizar botões, formulários, toolbars e modais (classes compartilhadas nos controles e diálogos principais).
- [x] Reduzir estilos inline e regras com `!important` (HTML estático reduzido de 298 para zero estilos inline; `!important` reduzido de 18 para 15 regras necessárias para biblioteca, impressão e acessibilidade).
- [x] Consolidar as cores em tokens oficiais (paleta funcional e variantes claro/escuro; sem hex disperso no CSS ou runtime).
- [x] Melhorar feedback de salvamento e sincronização (serviço de estado isolado, badge transacional acessível, concorrência e erro sanitizado).
- [x] Mostrar progresso real na leitura de uploads grandes e etapas de processamento/sincronização.
- [x] Revisar estados vazios, loading e erro de cada aba (componente seguro compartilhado e navegação offline coberta no navegador).
- [x] Revisar textos e termos técnicos apresentados ao usuário.
- [x] Adicionar `meta description`.
- [x] Adicionar `robots noindex, nofollow` por se tratar de dashboard interno.
- [ ] Adicionar Open Graph somente se o produto for público.
- [x] Revisar impressão e exportação em diferentes navegadores (Chromium, Firefox e WebKit no Playwright/CI).

## Sequência de entregas

1. Segurança: RLS, autorização, XSS e privacidade.
2. Estabilidade: transações, uploads e bugs conhecidos.
3. Acessibilidade e responsividade: mobile, teclado, semântica e modais.
4. Arquitetura: módulos, CSS externo, dependências e CSP.
5. Performance: lazy rendering, paginação, dados e Web Worker.
6. Qualidade: testes automatizados, CI, documentação e observabilidade.
7. Polimento: consistência visual, UX e metadados.

## Registro de decisões

Use esta seção para registrar decisões que alterem o roadmap.

| Data       | Decisão                                                                     | Motivo                                                                                                     | Responsável |
| ---------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------- |
| 20/07/2026 | Priorizar auditoria do Supabase antes das mudanças visuais                  | Segurança e integridade dos dados dependem da camada de banco                                              | A definir   |
| 20/07/2026 | Reservar uploads de Flows, Gestões e Excel completo para administradores    | Esses arquivos alteram conjuntos globais ou multiobra                                                      | A definir   |
| 20/07/2026 | Planejar o dashboard como interno no primeiro rascunho de RLS               | É o perfil mais seguro até o negócio aprovar explicitamente leitura pública                                | A definir   |
| 20/07/2026 | Preservar temporariamente a leitura pública apenas das tabelas operacionais | Evita mudar o produto sem decisão do negócio; whitelist, histórico e arquivos passam a exigir autenticação | A definir   |

## Histórico de progresso

| Data       | Alteração                                                                                                                                                | Referência                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 20/07/2026 | Roadmap inicial criado a partir da revisão técnica do `index.html`                                                                                       | `1cb9096`                                                   |
| 20/07/2026 | Guards por obra/admin, endurecimento de uploads globais, correções XSS e comunicação de privacidade                                                      | `1cb9096`                                                   |
| 20/07/2026 | Contrato público Supabase auditado; exposição anônima documentada; rascunho de RLS e inventário SQL preparados                                           | `1cb9096`                                                   |
| 20/07/2026 | Baseline administrativo versionado; migration incremental, rollback e testes locais preparados                                                           | `supabase/migrations/20260720172000_rls_hardening.sql`      |
| 20/07/2026 | CSS monolítico separado em tokens, base, componentes e dashboard, com contrato automatizado de assets                                                    | `assets/css/`                                               |
| 20/07/2026 | Vite configurado com lockfile, suíte centralizada em `npm test` e build de produção validado                                                             | `package.json`                                              |
| 20/07/2026 | Permissões e exclusão de obra migradas para RPCs atômicas; cascatas e proteção do último admin adicionadas                                               | `supabase/migrations/20260720203000_admin_transactions.sql` |
| 20/07/2026 | Formulários semânticos, linhas por teclado, ordenação acessível e validação em cinco viewports                                                           | `scripts/test_accessibility_contract.js`                    |
| 21/07/2026 | Dependências de navegador fixadas e carregadas localmente pelo Vite; CDNs removidos, JavaScript principal externalizado e smoke test de navegador criado | `assets/js/bootstrap.js`                                    |
| 21/07/2026 | Configuração e credenciais públicas extraídas do legado; cliente e retry centralizados em serviço Supabase com suporte a variáveis de ambiente           | `assets/js/services/supabase-service.js`                    |
| 21/07/2026 | Sessão, provedores de login, whitelist e autorização por papel/obra extraídos para serviço de autenticação                                               | `assets/js/services/auth-service.js`                        |
| 21/07/2026 | Estado compartilhado e aliases temporários extraídos do legado; autenticação ligada diretamente à obra ativa central                                     | `assets/js/state.js`                                        |
| 21/07/2026 | Parsers de Tendência, Flows e Gestões extraídos; layouts por cabeçalho, CSV robusto, relatórios e testes unitários adicionados                           | `assets/js/parsers/`                                        |
| 21/07/2026 | Feedback, loading e pilha de modais extraídos; confirmação dinâmica passou a usar APIs DOM seguras                                                       | `assets/js/ui/`                                             |
| 21/07/2026 | Favicon e logo externalizados; metadados de dashboard interno e headers defensivos adicionados                                                           | `public/_headers`                                           |
| 21/07/2026 | Renderização passou a atualizar estruturas compartilhadas e somente a aba ativa, inclusive nas trocas de visão                                           | `renderAll()`                                               |
| 21/07/2026 | Telemetria local adicionada para boot, nós do DOM, parsers e renderização por aba                                                                        | `assets/js/performance.mjs`                                 |
| 21/07/2026 | Baseline de `innerHTML` inventariado; limpezas migradas para DOM seguro e módulos protegidos por contrato XSS                                            | `docs/innerhtml_inventory_2026-07-21.md`                    |
| 21/07/2026 | CI configurado com qualidade, build, audit, axe e smoke visual em mobile/desktop                                                                         | `.github/workflows/ci.yml`                                  |
| 21/07/2026 | Manual alinhado às permissões por obra, falhas offline, retenção e parsers atuais                                                                        | `index.html`                                                |
| 21/07/2026 | Operação, deploy Vercel e rollbacks de frontend/Supabase documentados e separados                                                                        | `docs/operations.md`                                        |
| 21/07/2026 | Leituras de classificações e configurações limitadas à obra ativa e às chaves globais necessárias                                                        | `supaLoadDashboardConfig()`                                 |
| 21/07/2026 | SheetJS retirado do boot e carregado sob demanda, mantendo gráficos com descarte antes do redesenho                                                      | `dependency-service.mjs`                                    |
| 21/07/2026 | Leitura de arquivos com percentual e parsing/conversão de Excel movidos para Web Worker                                                                  | `excel-service.mjs`                                         |
| 21/07/2026 | Handlers inline removidos do HTML e dos templates; ações de interface centralizadas por delegação                                                        | `ui/actions.mjs`                                            |
| 21/07/2026 | CSP aplicada com scripts locais e conexões limitadas ao Supabase; exceção temporária mantida somente para estilos inline                                 | `public/_headers`                                           |
| 21/07/2026 | Logger local limitado criado com contexto e redação automática de emails, tokens e query strings                                                         | `services/logger.mjs`                                       |
| 21/07/2026 | Política de upload centralizada; CSV e Excel compartilham validação e progresso percentual de leitura                                                    | `services/upload-policy.mjs`                                |
| 21/07/2026 | Lighthouse integrado ao CI; ApexCharts sob demanda elevou performance medida de 37 para 73                                                               | `scripts/run_lighthouse.js`                                 |
| 21/07/2026 | Script clássico legado minificado após emissão, preservando fonte legível e nomes globais                                                                | `vite.config.mjs`                                           |
| 21/07/2026 | Testes XSS ampliados e caminhos de Storage endurecidos contra esquemas e travessia                                                                       | `test_xss_contract.js`                                      |
| 21/07/2026 | Coordenador de upload extraído e testado com commit, falha de ativação e rollback parcial                                                                | `upload-transaction.mjs`                                    |
| 21/07/2026 | Detalhamento, Flows e Histórico limitados a 100 linhas por página com controles acessíveis                                                               | `ui/pagination.mjs`                                         |
