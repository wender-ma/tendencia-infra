# Inventário de `innerHTML` — 21/07/2026

## Escopo

Foram revisadas todas as atribuições de `innerHTML` em `assets/js/`. O inventário inicial tinha 105 ocorrências no script legado. Após a modularização das views:

- 24 limpezas de conteúdo foram substituídas por `replaceChildren()`;
- 5 atribuições de texto simples foram substituídas por `textContent`;
- todas as views extraídas ficaram com zero atribuições de `innerHTML`;
- as 17 ocorrências finais do legado foram migradas para `replaceWithParsedMarkup()`;
- não restam atribuições de `innerHTML` no JavaScript do projeto.

## Classificação

| Classe | Exemplos | Origem dos valores | Regra atual |
| --- | --- | --- | --- |
| Templates constantes | estados vazios, cabeçalhos, badges e controles fixos | código interno | montados pelo parser central |
| Renderização de dados | obras, editores, Tendência, Flows, Gestões, projeção e uploads | Supabase ou arquivos importados | texto passa por `escHtml`; atributos passam por `escAttr`; montagem usa o parser central |
| Composição controlada | cards, gráficos, tooltips e formulários dinâmicos | helpers internos que escapam campos externos | montada pelo parser central e protegida por contrato |

## Superfícies revisadas

- Administração: código, nome, email, observação e mensagens de erro são escapados.
- Tendência e histórico: item, serviço, insumo, gestão e títulos são escapados.
- Flows e movimentações: descrição, motivo, justificativa, responsáveis e atributos `data-*` são escapados.
- Uploads: nome, autor e caminho são escapados; caminhos passam também por `sanitizeStoragePath`.
- Modais compartilhados: confirmação usa apenas APIs DOM e `textContent`.
- Feedback: toast usa apenas `textContent`.

## Restrições e Trusted Types

Nenhum módulo pode usar `innerHTML` ou `insertAdjacentHTML`; o contrato XSS falha se uma atribuição reaparecer em qualquer arquivo JavaScript. Markup necessário passa por `replaceWithParsedMarkup()`, enquanto os valores externos continuam escapados antes da composição.

Trusted Types foi avaliado e não será habilitado com uma política permissiva que apenas transforme strings em `TrustedHTML`. A proteção atual elimina os sinks diretos e cobre todos os navegadores suportados. Uma política obrigatória poderá ser adicionada quando houver sanitização estrita compatível com os templates interativos do dashboard.
