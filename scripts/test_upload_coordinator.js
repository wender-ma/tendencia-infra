#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/services/upload-coordinator.mjs'),
  );
  const { buildUploadDashboardRows } = await import(moduleUrl.href);
  const keys = {
    DATA_T: 'dados_tendencia',
    DATA_F: 'dados_flows',
    HISTORICO: 'dados_historico',
    PROJ_RAW: 'dados_projraw',
    GESTAO_LABEL: 'gestao_label',
  };
  const state = {
    tendency: [{ codigo_obra: 'OBRA-A', valor: 1 }],
    flows: [{ n_alteracao: 'ADT-1' }],
    history: { items: [{ insumo: 'I001' }] },
    projectionRaw: [{ mes: '01-2026' }],
    managementLabel: 'GESTÃO 01-2026',
  };
  const rows = buildUploadDashboardRows(
    state,
    ['tendencia', 'tendencia', 'flows', 'gestoes'],
    'OBRA-A',
    new Date('2026-07-21T12:00:00Z'),
    keys,
  );

  assert.deepStrictEqual(
    rows.map((row) => row.chave),
    [
      'OBRA-A:dados_tendencia',
      'OBRA-A:gestao_label',
      'dados_flows',
      'dados_historico',
      'dados_projraw',
    ],
  );
  assert(rows.every((row) => row.updated_at === '2026-07-21T12:00:00.000Z'));
  assert.throws(
    () =>
      buildUploadDashboardRows(
        { ...state, tendency: [] },
        ['tendencia'],
        'OBRA-A',
        new Date(),
        keys,
      ),
    /Tendência sem dados válidos/,
  );

  console.log('Coordenador de uploads: datasets, escopo e validação prévia OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
