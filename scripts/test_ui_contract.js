#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadProjectSources } = require('./load_project_sources');

const root = path.resolve(__dirname, '..');
const { html } = loadProjectSources();
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
assert(css.includes('.header-title-text.is-editing'), 'Edição do título precisa usar classe CSS');
assert(css.includes('.alert-banner.is-critical'), 'Alerta crítico precisa usar classe CSS');
assert(
  (html.match(/class="standalone-modal-bg/g) || []).length === 3,
  'Três diálogos estáticos devem usar o mesmo backdrop',
);
assert(!/<form\b[^>]*\sonsubmit=/i.test(html), 'Formulário com submit inline voltou ao HTML');

console.log(
  `Contrato de UI: HTML estático sem estilos inline; ${importantCount} !important controlados`,
);
