#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadProjectSources } = require('./load_project_sources');

const root = path.resolve(__dirname, '..');
const { html } = loadProjectSources();
const overview = fs.readFileSync(path.join(root, 'assets/js/ui/views/overview.mjs'), 'utf8');
const css = ['assets/css/base.css', 'assets/css/components.css', 'assets/css/dashboard.css']
  .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
  .join('\n');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const className of [
  'field-label',
  'field-control',
  'field-help',
  'toolbar-count',
  'panel-actions',
  'standalone-modal',
  'dialog-actions',
]) {
  assert(
    html.includes(`class="${className}`) || html.includes(` ${className}`),
    `Classe ${className} não aplicada`,
  );
  assert(css.includes(`.${className}`), `Classe ${className} não definida`);
}

const inlineStyleCount = (html.match(/\bstyle="/g) || []).length;
const importantCount = (css.match(/!important/g) || []).length;
assert(inlineStyleCount === 0, `Estilo inline reintroduzido no HTML estático: ${inlineStyleCount}`);
assert(importantCount <= 15, `Orçamento de !important excedido: ${importantCount}`);
assert(!html.includes('Tendência Orçamentária'), 'Título antigo não deve aparecer no cabeçalho');
assert(
  !html.includes('Orçamento × Gestão × Aditivos'),
  'Subtítulo antigo não deve aparecer no cabeçalho',
);
assert(
  html.indexOf('class="header-action-row"') < html.indexOf('class="header-status-row"'),
  'Comandos devem aparecer acima do status e da identidade',
);
assert(
  html.includes('id="srcHeader_global" data-sources="tendencia,flows"'),
  'Resumo global de Tendência e Flows deve ficar no cabeçalho',
);
assert(
  !html.includes('id="srcHeader_visao"'),
  'Visão Geral não deve duplicar o resumo de fontes exibido no cabeçalho',
);
assert(
  !overview.includes('itens · base original do contrato') &&
    !overview.includes('de inflação (${inflacaoPct.toFixed(1)}%)'),
  'Card de licitação não deve exibir os detalhes removidos',
);
assert(
  overview.indexOf('overview-kpi-adjustment') <
    overview.indexOf('overview-kpi-corrected-total'),
  'Card de licitação deve mostrar o acréscimo antes do total corrigido',
);
assert(
  css.includes('.header-action-row') && css.includes('.header-status-row'),
  'Linhas de comandos e status precisam de estilos próprios',
);
assert(css.includes('.alert-banner.is-critical'), 'Alerta crítico precisa usar classe CSS');
assert(
  css.includes('.sync-badge[data-sync-state="saving"]'),
  'Badge de sincronização precisa usar estado CSS',
);
assert(
  (html.match(/class="standalone-modal-bg/g) || []).length === 3,
  'Três diálogos estáticos devem usar o mesmo backdrop',
);
assert(!/<form\b[^>]*\sonsubmit=/i.test(html), 'Formulário com submit inline voltou ao HTML');

console.log(
  `Contrato de UI: HTML estático sem estilos inline; ${importantCount} !important controlados`,
);
