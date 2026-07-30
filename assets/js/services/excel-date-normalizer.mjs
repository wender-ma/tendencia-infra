function isoDateFromExcelCell(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function normalizeWorksheetDateCells(worksheet) {
  if (!worksheet || typeof worksheet !== 'object') return 0;
  let normalized = 0;
  for (const [address, cell] of Object.entries(worksheet)) {
    if (address.startsWith('!') || cell?.t !== 'd') continue;
    const isoDate = isoDateFromExcelCell(cell.v);
    if (!isoDate) continue;
    cell.w = isoDate;
    cell.z = 'yyyy-mm-dd';
    normalized += 1;
  }
  return normalized;
}
