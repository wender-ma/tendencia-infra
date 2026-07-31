#!/usr/bin/env node

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/ui/views/overview-detail.mjs'),
  );
  const { buildOverviewInputDetailModel } = await import(moduleUrl.href);
  const tendencyRows = [
    { cod: '1', item: 'OBRA', nivel: 1, is_folha: false },
    { cod: '01.01', item: 'CUSTOS INDIRETOS', nivel: 2, is_folha: false },
    {
      cod: '01.01.01',
      cod_servico: 'S001',
      item: 'SERVIÇO',
      nivel: 3,
      is_folha: false,
      grupo: 'Custos Indiretos',
    },
    {
      cod: '01.01.01',
      cod_servico: 'S001',
      cod_insumo: 'I001',
      item: 'INSUMO DUPLICADO A',
      nivel: 3,
      is_folha: true,
      grupo: 'Custos Indiretos',
      corrigido_ipca: 100,
      corrigido_incc: 90,
      gestao: 120,
    },
    {
      cod: '01.01.01',
      cod_servico: 'S001',
      cod_insumo: 'I001',
      item: 'INSUMO DUPLICADO B',
      nivel: 3,
      is_folha: true,
      grupo: 'Custos Indiretos',
      corrigido_ipca: 50,
      corrigido_incc: 45,
      gestao: 60,
    },
    {
      cod: '01.01.01',
      cod_servico: 'S001',
      cod_insumo: 'I002',
      item: 'SEM ORÇAMENTO',
      nivel: 3,
      is_folha: true,
      grupo: 'Custos Indiretos',
      corrigido_ipca: null,
      corrigido_incc: null,
      gestao: 0,
    },
  ];
  const inputProjections = [
    {
      servico: 'S001',
      insumo: 'I001',
      grupo: 'Custos Indiretos',
      extrapolacao: 30,
      ultimo_mes_planejado: '2026-07',
      meses_gap: 3,
    },
    {
      servico: 'S002',
      insumo: 'I003',
      grupo: 'Custos Indiretos',
      extrapolacao: 15,
      ultimo_mes_planejado: '2026-08',
      meses_gap: 2,
    },
  ];
  const flows = [
    {
      n_alteracao: 'F-AMB',
      insumo_planejamento: 'I001',
      custo_flowmaster: 5,
      refletido_status: 'pendente',
    },
    {
      n_alteracao: 'F-NEG',
      insumo_planejamento: 'I002',
      custo_flowmaster: -2,
      refletido_status: 'pendente',
    },
    {
      n_alteracao: 'F-SEM',
      insumo_planejamento: 'Aumento de obra',
      custo_flowmaster: 7,
      refletido_status: 'pendente',
    },
    {
      n_alteracao: 'F-REF',
      insumo_planejamento: 'I002',
      custo_flowmaster: 10,
      refletido_status: 'sim',
      refletido_mes: '2026-06',
    },
    {
      n_alteracao: 'F-CAN',
      insumo_planejamento: 'I002',
      custo_flowmaster: 999,
      refletido_status: 'pendente',
      dep: 'Cancelado',
    },
  ];

  const model = buildOverviewInputDetailModel({
    tendencyRows,
    inputProjections,
    flows,
    correctionIndex: 'ipca',
    dataFim: '2026-10',
    projectCode: 'OBRA-TESTE',
    managementLabel: 'GESTÃO 07-2026',
  });
  assert.equal(model.root.metrics.correctedBudget, 150);
  assert.equal(model.root.metrics.management, 180);
  assert.equal(model.root.metrics.automaticProjection, 45);
  assert.equal(model.root.metrics.pendingFlows, 10);
  assert.equal(model.root.metrics.finalTendency, 235);
  assert.equal(model.root.metrics.difference, 85);
  assert.equal(
    model.root.metrics.correctedBudget + model.root.metrics.difference,
    model.root.metrics.finalTendency,
  );

  const duplicated = model.nodes.filter((node) => !node.isSynthetic && node.cod_insumo === 'I001');
  assert.deepEqual(
    duplicated.map((node) => node.metrics.automaticProjection),
    [20, 10],
    'Projeção duplicada deve seguir o peso da Gestão-base',
  );
  const ambiguous = model.nodes.find((node) => node.item.includes('I001 · vínculo ambíguo'));
  assert.equal(ambiguous.metrics.pendingFlows, 5);
  const noBudget = model.nodes.find((node) => node.cod_insumo === 'I002' && !node.isSynthetic);
  assert.equal(noBudget.correctedAvailable, false);
  assert.equal(noBudget.metrics.pendingFlows, -2);
  assert.equal(noBudget.reflectedFlowItems.length, 1);
  assert.equal(noBudget.metrics.finalTendency, -2, 'Flow refletido não deve ser somado novamente');
  assert.equal(
    model.nodes.some((node) => node.pendingFlowItems.some((flow) => flow.numero === 'F-CAN')),
    false,
  );
  assert(model.nodes.some((node) => node.isSynthetic && node.cod_insumo === 'I003'));
  assert(model.nodes.some((node) => node.item === 'Sem insumo classificado'));

  const incc = buildOverviewInputDetailModel({
    tendencyRows,
    inputProjections,
    flows,
    correctionIndex: 'incc',
    dataFim: '2026-10',
  });
  assert.equal(incc.root.metrics.correctedBudget, 135);
  assert.equal(incc.root.metrics.finalTendency, 235);
  assert.equal(incc.root.metrics.difference, 100);

  console.log('Detalhamento da Visão Geral: hierarquia, projeções e Flows reconciliados OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
