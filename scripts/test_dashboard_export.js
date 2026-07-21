#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/services/dashboard-export.mjs'),
  );
  const {
    buildDetailsExportRows,
    buildFlowsExportRows,
    buildProjectionExportRows,
    createDashboardExportService,
    normalizeFileSegment,
  } = await import(moduleUrl.href);

  assert.strictEqual(normalizeFileSegment(' OBRA / 42 '), 'OBRA_42');
  assert.strictEqual(normalizeFileSegment(''), 'obra');

  const [detail] = buildDetailsExportRows([
    { licitacao: 100, gestao: 112.345, diferenca: -12.345, is_folha: true },
  ]);
  assert.strictEqual(detail['É folha'], 'Sim');
  assert.strictEqual(detail['Gestão (R$)'], 112.35);
  assert.strictEqual(detail['Δ % (vs Licitação)'], 12.35);

  const [flow] = buildFlowsExportRows([
    { tipo: 'remanejamento', refletido_status: 'nao', custo_flowmaster: 10.126 },
  ]);
  assert.strictEqual(flow['Tipo classificação'], 'Remanejamento');
  assert.strictEqual(flow['Refletido?'], 'Não');
  assert.strictEqual(flow['Custo Flowmaster (R$)'], 10.13);

  const projection = buildProjectionExportRows({
    saldo_inicial: 100,
    data_ref: '2026-07-01',
    movimentacoes: [
      { id: 'saida', tipo: 'aditivo', data: '2026-07-03', valor: 30 },
      { id: 'entrada', tipo: 'aporte', data: '2026-07-02', valor: 20 },
    ],
  });
  assert.deepStrictEqual(
    projection.rows.map((row) => row.ID),
    ['(inicial)', 'entrada', 'saida'],
  );
  assert.strictEqual(projection.finalBalance, 90);

  let downloadedFilename = '';
  const fakeXlsx = {
    utils: {
      book_new: () => ({}),
      json_to_sheet: () => ({}),
      book_append_sheet: () => {},
      decode_range: () => ({ s: { r: 0 }, e: { r: 0 } }),
      encode_cell: () => 'A1',
    },
    writeFile: (_workbook, filename) => {
      downloadedFilename = filename;
    },
  };
  const service = createDashboardExportService({
    ensureXlsx: async () => fakeXlsx,
    getState: () => ({
      tendency: [{ licitacao: 1 }],
      activeProject: 'OBRA / TESTE',
      auth: {},
    }),
    now: () => new Date('2026-07-21T12:00:00.000Z'),
  });
  const result = await service.exportDetails();
  assert.strictEqual(result.filename, 'detalhamento_OBRA_TESTE_2026-07-21.xlsx');
  assert.strictEqual(downloadedFilename, result.filename);

  console.log('Exportação XLSX: linhas, saldos e nomes de arquivo OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
