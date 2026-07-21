#!/usr/bin/env node

const { loadProjectSources } = require('./load_project_sources');

const { javascript } = loadProjectSources();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(!/catch\s*\([^)]*\)\s*{\s*}/m.test(javascript), 'Existe catch vazio no JavaScript principal');
assert(!/try\s*{\s*supa[A-Za-z]+\([^;]+;?\s*}\s*catch/m.test(javascript), 'Existe chamada assíncrona do Supabase protegida apenas por try/catch síncrono');
assert(javascript.includes('function reportNonFatalError('), 'Reporter contextual de erros ausente');
assert(javascript.includes('function runAsyncSafely('), 'Observador de operações assíncronas ausente');
assert(
  /async function supaSaveDashboardKey[\s\S]*?if \(error\) \{[\s\S]*?throw error;[\s\S]*?\n\}/.test(javascript),
  'supaSaveDashboardKey precisa propagar erros de persistência'
);

const visibleFallbacks = [
  'A classificação foi salva apenas neste navegador.',
  'Os aditivos manuais foram salvos apenas neste navegador.',
  'As movimentações foram salvas apenas neste navegador.',
];
visibleFallbacks.forEach(message => {
  assert(javascript.includes(message), `Aviso visível ausente: ${message}`);
});

console.log('Contrato de erros: nenhum catch vazio e fallbacks visíveis OK');
