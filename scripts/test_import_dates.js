#!/usr/bin/env node

const vm = require('vm');
const { loadProjectSources } = require('./load_project_sources');

const { javascript } = loadProjectSources();
const start = javascript.indexOf('function normalizeDateYear');
const end = javascript.indexOf('// v0.58b: parseGestoes', start);
if (start < 0 || end < 0) throw new Error('Bloco de datas não encontrado no JavaScript principal');

const context = { Date };
vm.runInNewContext(javascript.slice(start, end), context);

const cases = [
  ['2026-07-20', 'br', '2026-07-20'],
  ['20/07/2026', 'br', '2026-07-20'],
  ['7/20/2026', 'br', '2026-07-20'],
  ['02/06/2025', 'br', '2025-06-02'],
  ['02/06/2025', 'us', '2025-02-06'],
  ['6/2/25', 'us', '2025-06-02'],
  ['31/02/2026', 'br', null],
  ['2025-02-29', 'br', null],
  ['29/02/2024', 'br', '2024-02-29'],
  ['texto', 'br', null],
];

cases.forEach(([input, order, expected]) => {
  const actual = context.toIsoDate(input, order);
  if (actual !== expected) {
    throw new Error(`${input} (${order}): esperado ${expected}, recebido ${actual}`);
  }
});

if (context.isoDateToBr('2026-07-20') !== '20/07/2026') {
  throw new Error('Conversão ISO para exibição BR falhou');
}

console.log(`Normalização de datas: ${cases.length + 1} cenários OK`);
