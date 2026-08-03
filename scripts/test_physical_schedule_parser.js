#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

(async () => {
  const { parsePhysicalScheduleFile, normalizePhysicalScheduleCurve } = await import(
    '../assets/js/parsers/physical-schedule-parser.mjs'
  );
  const csv = [
    'Cronograma físico financeiro exportado em 03/08/2026;;;;;;;;;;;;;;',
    ';;;;;;;;;30/06/2026;;;31/07/2026;;;31/08/2026;;',
    'Nível;Código EAP;Descrição;Início;Fim;Material (R$);Mão de obra (R$);Total (R$);Base;Previsto;Realizado;Base;Previsto;Realizado;Base;Previsto;Realizado',
    '1;01;ITEM A;01/06/2026;31/08/2026;600;0;600;10;20;10;30;40;30;100;100;30',
    '1;02;ITEM A;01/06/2026;31/08/2026;400;0;400;20;30;20;40;50;40;100,05;100,05;40',
  ].join('\n');
  const parsed = parsePhysicalScheduleFile(csv);
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].weight, 0.6);
  assert.equal(parsed.items[1].weight, 0.4);
  assert.equal(parsed.suggestedCutoff, '2026-07');
  assert.equal(parsed.curve[1].actual, 34);
  assert.equal(parsed.curve[1].planned, 44);
  assert.equal(parsed.report.clippedPercentages, 2);
  assert.equal(parsed.exportDate, '2026-08-03');

  const normalized = normalizePhysicalScheduleCurve(parsed.curve, 31, '2026-07');
  assert.equal(normalized[1].actual, 31);
  assert.equal(normalized.at(-1).planned, 100);

  assert.throws(
    () => parsePhysicalScheduleFile(csv.replace('1;02;', '1;01;')),
    /Código EAP duplicado/,
  );
  assert.throws(
    () => parsePhysicalScheduleFile(csv.replace(';400;0;400;', ';400;0;;')),
    /Total \(R\$\) inválido/,
  );

  const fixture = path.join(
    process.cwd(),
    'tmp/uploads/cronograma_fisico_financeiro_-_Jardins_Zurique_Infra (7).xlsx',
  );
  if (fs.existsSync(fixture)) {
    const workbook = XLSX.readFile(fixture, { cellDates: true });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const fixtureCsv = XLSX.utils.sheet_to_csv(worksheet, {
      FS: ';',
      RS: '\n',
      dateNF: 'yyyy-mm-dd',
    });
    const real = parsePhysicalScheduleFile(fixtureCsv);
    assert.equal(real.items.length, 105);
    assert.equal(real.months.length, 35);
    assert.equal(real.suggestedCutoff, '2026-07');
    assert.ok(Math.abs(real.totalWeightValue - 50_580_902.8055) < 0.01);
    assert.ok(Math.abs(real.curve.find((point) => point.month === '2026-07').actual - 35.5266) < 0.001);
  }

  console.log('Physical schedule parser contract: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
