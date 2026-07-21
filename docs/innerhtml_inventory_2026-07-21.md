# Inventário de `innerHTML` — 21/07/2026

## Escopo

Foram revisadas todas as atribuições de `innerHTML` em `assets/js/`. O inventário inicial tinha 105 ocorrências no script legado. Nesta revisão:

- 24 limpezas de conteúdo foram substituídas por `replaceChildren()`;
- 5 atribuições de texto simples foram substituídas por `textContent`;
- os módulos extraídos ficaram com zero atribuições de `innerHTML`;
- 80 atribuições permanecem no legado por gerarem estrutura HTML.

## Classificação

| Classe | Exemplos | Origem dos valores | Regra atual |
| --- | --- | --- | --- |
| Templates constantes | estados vazios, cabeçalhos, badges e controles fixos | código interno | permitido temporariamente no legado |
| Renderização de dados | obras, editores, Tendência, Flows, Gestões, projeção e uploads | Supabase ou arquivos importados | todo texto passa por `escHtml`; atributos passam por `escAttr` |
| Composição controlada | cards, gráficos, tooltips e formulários dinâmicos | helpers internos que já escapam campos externos | permitido temporariamente, com teste de contrato |

## Superfícies revisadas

- Administração: código, nome, email, observação e mensagens de erro são escapados.
- Tendência e histórico: item, serviço, insumo, gestão e títulos são escapados.
- Flows e movimentações: descrição, motivo, justificativa, responsáveis e atributos `data-*` são escapados.
- Uploads: nome, autor e caminho são escapados; caminhos passam também por `sanitizeStoragePath`.
- Modais compartilhados: confirmação usa apenas APIs DOM e `textContent`.
- Feedback: toast usa apenas `textContent`.

## Restrições

Novos módulos não podem usar `innerHTML`. As ocorrências remanescentes pertencem ao arquivo legado e devem desaparecer conforme tabelas e abas forem extraídas. Trusted Types só será habilitado depois da remoção dos handlers e estilos inline, para evitar uma política permissiva que apenas esconda o risco.

