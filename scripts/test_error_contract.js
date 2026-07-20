#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(!/catch\s*\([^)]*\)\s*{\s*}/m.test(html), 'Existe catch vazio no index.html');
assert(!/try\s*{\s*supa[A-Za-z]+\([^;]+;?\s*}\s*catch/m.test(html), 'Existe chamada assíncrona do Supabase protegida apenas por try/catch síncrono');
assert(html.includes('function reportNonFatalError('), 'Reporter contextual de erros ausente');
assert(html.includes('function runAsyncSafely('), 'Observador de operações assíncronas ausente');

const visibleFallbacks = [
  'A classificação foi salva apenas neste navegador.',
  'Os aditivos manuais foram salvos apenas neste navegador.',
  'As movimentações foram salvas apenas neste navegador.',
];
visibleFallbacks.forEach(message => {
  assert(html.includes(message), `Aviso visível ausente: ${message}`);
});

console.log('Contrato de erros: nenhum catch vazio e fallbacks visíveis OK');
