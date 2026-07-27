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
  overview.indexOf('overview-kpi-adjustment') < overview.indexOf('overview-kpi-corrected-total'),
  'Card de licitação deve mostrar o acréscimo antes do total corrigido',
);
assert(
  overview.includes('overview-budget-bar-svg') &&
    !overview.includes('<div class="overview-budget-caption">Valor original</div>') &&
    overview.includes('Total corrigido'),
  'Card de licitação deve distinguir base, correção e total sem repetir o rótulo original',
);
assert(
  !overview.includes('<div class="sub">planejamento vigente</div>'),
  'Card de Gestão não deve exibir o subtítulo removido',
);
assert(
  !overview.includes('overview-projection-description') &&
    !overview.includes('reservaProj > 0\n            ?'),
  'Card de Tendência deve manter valor e toggle juntos e sempre mostrar a visão líquida',
);
assert(
  overview.includes('${escHtml(insumoControlado)} - Projeção de Gastos') &&
    overview.includes('<span class="overview-total-label">💧 Δ vs Licitação</span>'),
  'Card de Tendência deve identificar a reserva e a diferença líquida',
);
assert(
  overview.includes('overview-tone--${signedTone(-reservaProj)}'),
  'Projeção de gastos deve exibir economia em verde e estouro em vermelho',
);
assert(
  overview.includes('🎯 Evolução física') &&
    overview.includes('💰 Evolução financeira') &&
    overview.includes('overview-adherence-status') &&
    overview.includes('overview-adherence-bar-svg') &&
    overview.includes('overview-adherence-bar-progress') &&
    overview.includes('overview-adherence-bar-value') &&
    overview.includes("delta > 0 ? 'negative' : 'positive'") &&
    overview.includes('Math.abs(financialPosition - physicalPosition)'),
  'Card de Aderência deve preencher o progresso e colorir a diferença pela semântica financeira',
);
assert(
  !overview.includes('overview-adherence-interpretation') &&
    !overview.includes('Custos indiretos <strong>não</strong> entram'),
  'Card de Aderência não deve reintroduzir explicações removidas',
);
assert(
  css.includes('.overview-adherence-bar-gap--positive') &&
    css.includes('.overview-adherence-bar-gap--warning') &&
    css.includes('.overview-adherence-bar-gap--negative') &&
    css.includes('.overview-adherence-status > span'),
  'Barra de aderência precisa representar os níveis e manter o diagnóstico textual neutro',
);
assert(
  html.includes('class="overview-donut-layout"') &&
    html.includes('id="donutLegend"') &&
    html.includes('id="donutCenter"') &&
    overview.includes('overview-donut-legend-item') &&
    overview.includes('`R$ ${fmtR$k(value)}`') &&
    overview.includes('legend: {\n      show: false'),
  'Donut deve usar total central e legenda lateral detalhada',
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
