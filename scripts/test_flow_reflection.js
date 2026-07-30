#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/services/flow-reflection.mjs'),
  );
  const {
    currentReflectionMonth,
    formatReflectionMonth,
    normalizeReflectionMonth,
    reflectionMonthInputValue,
    resolveReflectionMonth,
  } = await import(moduleUrl.href);

  assert.strictEqual(normalizeReflectionMonth('2026-07'), '2026-07-01');
  assert.strictEqual(normalizeReflectionMonth('2026-07-19'), '2026-07-01');
  assert.strictEqual(normalizeReflectionMonth('2026-13'), null);
  assert.strictEqual(currentReflectionMonth(new Date(2026, 6, 19)), '2026-07-01');
  assert.strictEqual(resolveReflectionMonth('sim', null, new Date(2026, 6, 19)), '2026-07-01');
  assert.strictEqual(resolveReflectionMonth('sim', '2026-05'), '2026-05-01');
  assert.strictEqual(resolveReflectionMonth('pendente', '2026-05'), null);
  assert.strictEqual(resolveReflectionMonth('nao', '2026-05'), null);
  assert.strictEqual(reflectionMonthInputValue('2026-07-01'), '2026-07');
  assert.strictEqual(formatReflectionMonth('2026-07-01'), '07/2026');
  assert.strictEqual(formatReflectionMonth(null), '—');

  console.log('Mês de reflexo dos Flows: normalização, preenchimento e exibição OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
