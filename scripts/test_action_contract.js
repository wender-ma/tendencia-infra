#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadProjectSources } = require('./load_project_sources');

const root = path.resolve(__dirname, '..');
const { html, javascript } = loadProjectSources();
const actions = fs.readFileSync(path.join(root, 'assets/js/ui/actions.mjs'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const inlineEventPattern = /<[^>\n]*\son[a-z]+\s*=/i;
assert(!inlineEventPattern.test(html), 'index.html contém handler de evento inline');
assert(
  !inlineEventPattern.test(javascript),
  'Templates JavaScript contêm handler de evento inline',
);
assert(actions.includes("click: 'data-click-action'"), 'Delegação de click ausente');
assert(actions.includes("change: 'data-change-action'"), 'Delegação de change ausente');
assert(actions.includes("input: 'data-input-action'"), 'Delegação de input ausente');
assert(actions.includes("submit: 'data-submit-action'"), 'Delegação de submit ausente');
assert(actions.includes('createActionRegistry'), 'Registro explícito de ações ausente');
assert(actions.includes('actions.resolve(actionName)'), 'Ações ainda são resolvidas no global');
assert(
  actions.includes("element.tagName === 'FORM'"),
  'Submit de formulário não previne navegação',
);
assert(actions.includes("root.addEventListener('focusin'"), 'Seleção por foco não foi delegada');

console.log('Contrato de ações: eventos inline removidos e delegação central ativa OK');
