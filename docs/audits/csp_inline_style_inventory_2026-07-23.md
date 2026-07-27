# Inventário de estilos inline para CSP estrita

Data: 23/07/2026

## Resultado

- Os módulos JavaScript da aplicação têm `0` atributos `style=` e `0`
  mutações diretas de `element.style`.
- O HTML estático também tem `0` atributos `style=`.
- A política final usa `style-src 'self'` e `style-src-attr 'none'`, sem
  `unsafe-inline`.
- O ApexCharts 4.7.0 injeta dois blocos de CSS estáticos. Eles são liberados
  exclusivamente pelos hashes `sha256-TBymqJXQvXKxe+z+3ydUYBErlkFFu110c5FjiVB8p+M=`
  e `sha256-aSysLrDECVdJ6L+jLf8CC5QKLmwRuk/OZiZk9mYky8A=` no `style-src`.
- `scripts/browser/csp.spec.js` injeta a política final antes do carregamento,
  renderiza um gráfico com legenda e falha caso o navegador reporte violação
  de CSP.

## Linha de base da extração

- Mutações diretas de `element.style`: 0.
- Atributos `style=` em módulos JavaScript: 282.
- HTML estático: 0 atributos `style=`; isso já é verificado por
  `scripts/test_ui_contract.js`.
- O contrato `scripts/test_csp_style_contract.js` passou a exigir zero para os
  dois tipos de estilo inline.

| Módulo | Ocorrências |
| --- | ---: |
| `assets/js/ui/views/projection.mjs` | 59 |
| `assets/js/ui/views/overview.mjs` | 59 |
| `assets/js/ui/views/admin.mjs` | 39 |
| `assets/js/ui/views/projection-control.mjs` | 36 |
| `assets/js/ui/uploads.mjs` | 36 |
| `assets/js/ui/views/details.mjs` | 14 |
| `assets/js/ui/flow-editor.mjs` | 14 |
| `assets/js/ui/views/history.mjs` | 13 |
| `assets/js/ui/views/flows.mjs` | 12 |

## Manutenção

1. Criar classes semânticas para qualquer novo estado visual, em vez de gerar
   atributos `style` em templates.
2. Usar modificadores de classe ou atributos `data-*` para variações finitas
   de cor, estado e alinhamento.
3. Usar elementos nativos, como `<progress>`, para valores percentuais
   dinâmicos que não precisem de CSS inline.
4. Ao atualizar o ApexCharts, executar `npm run test:browser` e atualizar os
   hashes somente após o teste sob CSP estrita confirmar que os blocos de CSS
   continuam estáticos e necessários.

Não usar nonce estático nem reintroduzir `unsafe-inline`: ambos ampliariam a
política sem necessidade.
