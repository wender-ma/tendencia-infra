#!/usr/bin/env node

const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/services/excel-date-normalizer.mjs'),
  );
  const { normalizeWorksheetDateCells } = await import(moduleUrl.href);
  const worksheet = {
    '!ref': 'A1:B2',
    A1: { t: 's', v: 'Mes_pagamento' },
    A2: {
      t: 'd',
      v: new Date(Date.UTC(2024, 8, 1)),
      w: '9/1/24',
      z: 'm/d/yy',
    },
    B2: { t: 'n', v: 123.45, w: '123.45' },
  };

  const count = normalizeWorksheetDateCells(worksheet);
  if (count !== 1) throw new Error(`Esperava normalizar 1 data, recebeu ${count}`);
  if (worksheet.A2.w !== '2024-09-01') {
    throw new Error(`Data Excel permaneceu ambígua: ${worksheet.A2.w}`);
  }
  if (worksheet.A2.z !== 'yyyy-mm-dd') {
    throw new Error(`Formato ISO não foi aplicado: ${worksheet.A2.z}`);
  }
  if (worksheet.B2.w !== '123.45') throw new Error('Célula numérica foi alterada indevidamente');

  console.log('Normalização de datas nativas do Excel: 4 contratos OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
