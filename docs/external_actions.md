# Registro de ações externas

Este documento reúne somente as ações que não podem ser concluídas pelo código,
pelos testes automatizados ou por acesso somente leitura. O `ROADMAP.md` usa os
mesmos IDs para que cada item aberto tenha responsável, dependência e evidência
de conclusão.

Última atualização: 29/07/2026

| ID | Status | Responsável | Dependência | Ação necessária | Evidência de aceite |
| --- | --- | --- | --- | --- | --- |
| EXT-01 | Aberta | Responsável do projeto | Nenhuma | Informar quem aprova e executa alterações futuras no Supabase de produção. | Nome ou função registrado no `ROADMAP.md`. |
| EXT-02 | Concluída | Administrador da Vercel | Acesso ao projeto na Vercel | Conferir as quatro variáveis de Production descritas em `docs/operations.md` e executar Redeploy da revisão atual. | Deployment concluído, domínio respondendo HTTP 200, preflight aprovado e smoke público sem erros em 27/07/2026. |
| EXT-03 | Concluída | Responsável funcional | EXT-02 concluída | Executar o checklist funcional de produção em `docs/manual_validation.md`. | Em 27/07/2026, o responsável confirmou dados, recarga, abas, troca de obra e administração sem erros funcionais. |
| EXT-04 | Concluída | Responsável pelo negócio | Nenhuma | Decidir se usuários anônimos podem visualizar dados operacionais. | Leitura operacional pública e escrita autenticada aprovadas em 27/07/2026; RLS, interface e smoke anônimo alinhados. |
| EXT-05 | Aguardando decisão | Responsável pelos dados | Nenhuma | Aprovar os textos de privacidade, retenção e compartilhamento. | Aprovação e eventuais ajustes registrados no roadmap. |
| EXT-06 | Aberta | Pessoa com leitor de tela | EXT-02 concluída | Validar login, navegação, formulários, modais e mensagens com NVDA ou VoiceOver. | Leitor, navegador, data e resultado registrados em `docs/manual_validation.md`. |
| EXT-07 | Aberta | Responsável técnico | Modo `snapshots` publicado em 27/07/2026 | Manter produção estável até pelo menos 03/08/2026, gerar backup, executar a auditoria preparada e autorizar o SQL transacional de limpeza. | `cleanup_ready: true`, autorização registrada, quatro chaves removidas, snapshots/objetos preservados e smokes verdes. |
| EXT-08 | Aberta | Responsável pelos arquivos reais | Arquivos reais ou anonimizados | Testar os maiores CSV/XLSX representativos, incluindo um próximo ao limite de 50 MB. | Arquivo/tamanho anonimizados, tempo, resultado e decisão sobre o limite registrados. |
| EXT-09 | Aguardando decisão | Responsável pelo produto | EXT-04 concluída | Decidir se o endereço público também deve ser indexado por buscadores e aprovar texto/imagem de Open Graph. | Decisão registrada; até lá, `noindex` permanece ativo e nenhum preview social é publicado. |
| EXT-10 | Concluída | Administrador do Supabase | Migration validada localmente | Aplicar `20260728235000_release_hardening.sql` no projeto de produção confirmado. | Em 29/07/2026, auditoria remota confirmou `complete: true`, 59 colunas públicas, quatro policies e duas RPCs. |
| EXT-11 | Aberta | Administrador do GitHub | Workflow versionado | Cadastrar `SUPABASE_PRODUCTION_DB_URL` e `BACKUP_ENCRYPTION_PASSWORD` nos Actions secrets e executar o primeiro backup manual. | Workflow verde, artefato criptografado criado e etapa `pg_restore --list` aprovada. |
| EXT-12 | Concluída | Administrador da Vercel | Branch `production` criada no release estável | Alterar a Production Branch de `main` para `production` antes do próximo push na `main`. | Em 29/07/2026, CI e Vercel publicaram o SHA `83828bd`; smokes público e com dados reais passaram. |
| EXT-13 | Concluída | Administrador do Supabase Auth | Contas responsáveis já criadas | Desativar `Allow new users to sign up` no provedor Email. | Em 29/07/2026, Management API confirmou `disable_signup: true`, com Email e Google habilitados para contas existentes. |

## Ordem mínima

1. Concluir EXT-11 para ativar o backup diário do banco.
2. Executar EXT-06 no domínio publicado.
3. Iniciar a janela de EXT-07 e só então avaliar a limpeza legada.
4. Resolver EXT-01, EXT-05, EXT-08 e EXT-09 com os responsáveis indicados.

Nenhuma ação deste registro exige compartilhar senha, token, chave privada,
conteúdo de arquivo ou dado pessoal no repositório.
