#!/usr/bin/env node

const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/parsers/shared.mjs'),
  ).href;
  const { isoDateToBr, toIsoDate } = await import(moduleUrl);
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

  for (const [input, order, expected] of cases) {
    const actual = toIsoDate(input, order);
    if (actual !== expected) {
      throw new Error(`${input} (${order}): esperado ${expected}, recebido ${actual}`);
    }
  }
  if (isoDateToBr('2026-07-20') !== '20/07/2026') {
    throw new Error('Conversão ISO para exibição BR falhou');
  }
  console.log(`Normalização de datas: ${cases.length + 1} cenários OK`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
