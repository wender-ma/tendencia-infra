#!/usr/bin/env node

const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/parsers/shared.mjs'),
  ).href;
  const { parseNumber } = await import(moduleUrl);
  const cases = [
    ['1.614.494,59', {}, 1614494.59],
    ['1,614,494.59', {}, 1614494.59],
    ['R$ 12.345,67', {}, 12345.67],
    ['-250,50', {}, -250.5],
    ['31,5%', { isPercentage: true }, 31.5],
    ['0.31', { isPercentage: true }, 31],
    ['1e10', {}, null],
    ['Infinity', {}, null],
    ['-', {}, null],
  ];

  for (const [input, options, expected] of cases) {
    const actual = parseNumber(input, options);
    if (actual !== expected) {
      throw new Error(`${input}: esperado ${expected}, recebido ${actual}`);
    }
  }
  console.log(`Normalização de números: ${cases.length} cenários OK`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

