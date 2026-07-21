#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const legacy = fs.readFileSync(path.join(root, 'assets/js/dashboard-legacy.js'), 'utf8');
const actions = fs.readFileSync(path.join(root, 'assets/js/ui/actions.mjs'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const inlineEventPattern = /\bon(?:click|change|input|focus)\s*=/i;
assert(!inlineEventPattern.test(html), 'index.html contém handler de evento inline');
assert(!inlineEventPattern.test(legacy), 'Templates legados contêm handler de evento inline');
assert(actions.includes("click: 'data-click-action'"), 'Delegação de click ausente');
assert(actions.includes("change: 'data-change-action'"), 'Delegação de change ausente');
assert(actions.includes("input: 'data-input-action'"), 'Delegação de input ausente');
assert(actions.includes("root.addEventListener('focusin'"), 'Seleção por foco não foi delegada');

console.log('Contrato de ações: eventos inline removidos e delegação central ativa OK');
