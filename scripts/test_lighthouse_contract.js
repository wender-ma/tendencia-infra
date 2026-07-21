#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runner = fs.readFileSync(path.join(root, 'scripts/run_lighthouse.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(packageJson.scripts['test:lighthouse'], 'Script Lighthouse ausente');
assert(packageJson.devDependencies.lighthouse === '13.4.1', 'Lighthouse deve permanecer fixado');
for (const [category, minimum] of [
  ['performance', '0.65'],
  ['accessibility', '0.9'],
  ["'best-practices'", '0.85'],
  ['seo', '0.75'],
]) {
  assert(runner.includes(`${category}: ${minimum}`), `Orçamento ausente: ${category}`);
}
assert(runner.includes("skipAudits: ['is-crawlable']"), 'Exceção do noindex interno não documentada no runner');
assert(workflow.includes('run: npm run test:lighthouse'), 'Lighthouse não é executado no CI');
assert(workflow.includes('name: lighthouse-report'), 'Relatório Lighthouse não é preservado no CI');

console.log('Contrato Lighthouse: orçamentos, noindex interno e artefato de CI OK');
