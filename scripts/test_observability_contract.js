const fs = require('fs');

const bootstrap = fs.readFileSync('assets/js/bootstrap.js', 'utf8');
const smokeWorkflow = fs.readFileSync('.github/workflows/production-smoke.yml', 'utf8');
const smokeScript = fs.readFileSync('scripts/run_public_healthcheck.mjs', 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  bootstrap.includes("window.addEventListener('error'") &&
    bootstrap.includes("window.addEventListener('unhandledrejection'"),
  'bootstrap deve capturar erros globais e rejeicoes nao tratadas',
);
assert(
  smokeWorkflow.includes('schedule:') && smokeWorkflow.includes('workflow_dispatch:'),
  'healthcheck de producao deve ser agendado e executavel manualmente',
);
for (const header of [
  'content-security-policy',
  'strict-transport-security',
  'x-content-type-options',
]) {
  assert(smokeScript.includes(header), `healthcheck deve validar ${header}`);
}

console.log('observability contract: ok');
