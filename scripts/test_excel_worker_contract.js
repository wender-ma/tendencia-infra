#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(
  path.join(root, 'assets/js/services/excel-service.mjs'),
  'utf8',
);
const worker = fs.readFileSync(
  path.join(root, 'assets/js/workers/excel-reader.worker.mjs'),
  'utf8',
);
const legacy = fs.readFileSync(path.join(root, 'assets/js/dashboard-legacy.js'), 'utf8');
const uploadUi = fs.readFileSync(path.join(root, 'assets/js/ui/uploads.mjs'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(service.includes('new Worker('), 'Leitura de Excel não cria Web Worker');
assert(service.includes('reader.addEventListener(\'progress\''), 'Leitura não reporta progresso real');
assert(service.includes('worker.terminate()'), 'Worker não é encerrado após o processamento');
assert(worker.includes("from 'xlsx'"), 'Worker não usa o parser SheetJS local');
assert(worker.includes('sheet_to_csv'), 'Conversão das abas não ocorre no Worker');
assert(!`${legacy}\n${uploadUi}`.includes('XLSX.read('), 'Interface voltou a processar Excel na thread principal');
assert(uploadUi.includes('await readExcelFile(file,'), 'Upload não usa o serviço de Worker');
assert(uploadUi.includes('await readExcelBuffer(buf)'), 'Reativação não usa o serviço de Worker');

console.log('Contrato de Excel: leitura com progresso e parsing em Web Worker OK');
