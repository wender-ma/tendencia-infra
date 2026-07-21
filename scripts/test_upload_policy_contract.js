#!/usr/bin/env node

const path = require('path');
const { pathToFileURL } = require('url');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/services/upload-policy.mjs'),
  ).href;
  const { MAX_UPLOAD_SIZE_BYTES, validateUploadFile } = await import(moduleUrl);

  assert(validateUploadFile({ name: 'dados.CSV', size: 10 }, 'csv').valid, 'CSV válido rejeitado');
  assert(validateUploadFile({ name: 'dados.xlsm', size: 10 }, 'excel').valid, 'XLSM válido rejeitado');
  assert(validateUploadFile({ name: 'dados.xls', size: 10 }, 'excel').valid, 'XLS válido rejeitado');
  assert(validateUploadFile({ name: 'dados.xlsx', size: MAX_UPLOAD_SIZE_BYTES }, 'excel').valid, 'Arquivo no limite rejeitado');
  assert(validateUploadFile({ name: 'dados.xlsx', size: MAX_UPLOAD_SIZE_BYTES + 1 }, 'excel').code === 'too-large', 'Arquivo acima do limite aceito');
  assert(validateUploadFile({ name: 'dados.exe', size: 10 }, 'excel').code === 'extension', 'Extensão inválida aceita');
  assert(validateUploadFile({ name: 'dados.csv', size: 0 }, 'csv').code === 'empty', 'Arquivo vazio aceito');

  console.log('Contrato de uploads: política única de tamanho, vazio e extensões OK');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
