# Registro de ações externas

Este documento reúne somente as ações que não podem ser concluídas pelo código,
pelos testes automatizados ou por acesso somente leitura. O `ROADMAP.md` usa os
mesmos IDs para que cada item aberto tenha responsável, dependência e evidência
de conclusão.

Última atualização: 27/07/2026

| ID | Status | Responsável | Dependência | Ação necessária | Evidência de aceite |
| --- | --- | --- | --- | --- | --- |
| EXT-01 | Aberta | Responsável do projeto | Nenhuma | Informar quem aprova e executa alterações futuras no Supabase de produção. | Nome ou função registrado no `ROADMAP.md`. |
| EXT-02 | Concluída | Administrador da Vercel | Acesso ao projeto na Vercel | Conferir as quatro variáveis de Production descritas em `docs/operations.md` e executar Redeploy da revisão atual. | Deployment concluído, domínio respondendo HTTP 200, preflight aprovado e smoke público sem erros em 27/07/2026. |
| EXT-03 | Aberta | Responsável funcional | EXT-02 concluída | Executar o checklist de produção em `docs/manual_validation.md`. | Data, navegador, perfil e resultado registrados no checklist. |
| EXT-04 | Aguardando decisão | Responsável pelo negócio | Nenhuma | Decidir se usuários anônimos podem visualizar dados operacionais. | Decisão e escopo registrados no `ROADMAP.md`; RLS e interface alinhadas à decisão. |
| EXT-05 | Aguardando decisão | Responsável pelos dados | Nenhuma | Aprovar os textos de privacidade, retenção e compartilhamento. | Aprovação e eventuais ajustes registrados no roadmap. |
| EXT-06 | Aberta | Pessoa com leitor de tela | EXT-02 concluída | Validar login, navegação, formulários, modais e mensagens com NVDA ou VoiceOver. | Leitor, navegador, data e resultado registrados em `docs/manual_validation.md`. |
| EXT-07 | Aberta | Responsável técnico | EXT-02 concluída e janela de estabilidade | Manter produção em `snapshots`, observar a janela definida e autorizar a remoção dos quatro blobs legados. | Inventário sem regressão, janela cumprida, autorização registrada e limpeza verificada. |
| EXT-08 | Aberta | Responsável pelos arquivos reais | Arquivos reais ou anonimizados | Testar os maiores CSV/XLSX representativos, incluindo um próximo ao limite de 50 MB. | Arquivo/tamanho anonimizados, tempo, resultado e decisão sobre o limite registrados. |
| EXT-09 | Diferida | Responsável pelo produto | EXT-04 | Decidir se o dashboard continuará interno ou se será público; criar Open Graph somente no segundo caso. | Decisão registrada; metadados continuam internos ou recebem conteúdo social aprovado. |

## Ordem mínima

1. Executar EXT-03 e EXT-06 no domínio publicado.
2. Iniciar a janela de EXT-07 e só então avaliar a limpeza legada.
3. Resolver EXT-01, EXT-04, EXT-05, EXT-08 e EXT-09 com os responsáveis indicados.

Nenhuma ação deste registro exige compartilhar senha, token, chave privada,
conteúdo de arquivo ou dado pessoal no repositório.
