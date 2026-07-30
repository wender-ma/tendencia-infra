import * as XLSX from 'xlsx';
import { normalizeWorksheetDateCells } from '../services/excel-date-normalizer.mjs';

self.addEventListener('message', (event) => {
  const { buffer } = event.data || {};

  try {
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const csvBySheet = {};

    for (const sheetName of workbook.SheetNames || []) {
      const worksheet = workbook.Sheets[sheetName];
      normalizeWorksheetDateCells(worksheet);
      csvBySheet[sheetName] = XLSX.utils.sheet_to_csv(worksheet, {
        FS: ';',
        RS: '\n',
        blankrows: false,
        strip: false,
        dateNF: 'yyyy-mm-dd',
      });
    }

    self.postMessage({ sheetNames: workbook.SheetNames || [], csvBySheet });
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
});
