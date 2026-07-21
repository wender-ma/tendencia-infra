#!/usr/bin/env node

const path = require('path');
const { pathToFileURL } = require('url');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/services/upload-repository.mjs'),
  );
  const { buildUploadStoragePath, sanitizeStoragePath, UPLOADS_BUCKET } = await import(
    moduleUrl.href
  );

  assert(
    sanitizeStoragePath('/OBRA/tendencia/file.csv') === 'OBRA/tendencia/file.csv',
    'Caminho válido não foi normalizado',
  );
  for (const unsafePath of [
    '',
    'https://host/file.csv',
    'OBRA/../file.csv',
    'OBRA//file.csv',
    'OBRA\\file.csv',
    'OBRA/file\u0000.csv',
  ]) {
    assert(sanitizeStoragePath(unsafePath) === '', `Caminho inseguro aceito: ${unsafePath}`);
  }

  const pathAtFixedDate = buildUploadStoragePath(
    'OBRA 01',
    'tendência',
    'arquivo final.csv',
    new Date(2026, 6, 21, 12, 34, 56),
  );
  assert(
    pathAtFixedDate === 'OBRA_01/tend_ncia/20260721_123456_arquivo_final.csv',
    `Caminho de upload inesperado: ${pathAtFixedDate}`,
  );

  assert(UPLOADS_BUCKET === 'uploads-history', 'Bucket do serviço está incorreto');

  console.log('Repositório de uploads: caminhos seguros e API encapsulada OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
