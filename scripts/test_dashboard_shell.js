#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../assets/js/ui/shell.mjs'));
  const { calculateManagementAge } = await import(moduleUrl.href);
  const reference = new Date('2026-07-21T12:00:00Z');

  assert.deepStrictEqual(calculateManagementAge('GESTÃO 04-2026', reference), {
    month: '04',
    year: '2026',
    monthsAgo: 3,
  });
  assert.strictEqual(calculateManagementAge('GESTÃO 13-2026', reference), null);
  assert.strictEqual(calculateManagementAge('Gestão Atual', reference), null);

  console.log('Shell do dashboard: cálculo de defasagem mensal OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
