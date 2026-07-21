#!/usr/bin/env node

const path = require('path');
const { pathToFileURL } = require('url');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/services/logger.mjs'),
  ).href;
  const { createLogger } = await import(moduleUrl);
  const output = [];
  const logger = createLogger({
    consoleRef: {
      warn: (...args) => output.push(args),
      error: (...args) => output.push(args),
    },
    now: () => '2026-07-21T00:00:00.000Z',
    limit: 2,
  });

  logger.warn(
    'Auth/teste@example.com',
    new Error('Falha para teste@example.com com eyJabc.def.ghi em https://x.test/path?token=abc'),
  );
  logger.error('Upload', { message: 'segundo', code: 'PGRST001', status: 409, payload: 'segredo' });
  logger.warn('Supabase', new Error('terceiro'));

  const snapshot = logger.snapshot();
  const serialized = JSON.stringify({ snapshot, output });
  assert(snapshot.length === 2, 'Logger não respeita o limite circular');
  assert(snapshot[0].error.code === 'PGRST001' && snapshot[0].error.status === 409, 'Campos técnicos úteis foram removidos');
  assert(!serialized.includes('teste@example.com'), 'Email não foi removido dos logs');
  assert(!serialized.includes('eyJabc.def.ghi'), 'Token não foi removido dos logs');
  assert(!serialized.includes('token=abc'), 'Query string não foi removida dos logs');
  assert(!serialized.includes('payload'), 'Objeto bruto foi incluído nos logs');

  console.log('Contrato de logs: contexto limitado e dados sensíveis redigidos OK');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
