const MONEY_FORMAT = '#,##0.00;-#,##0.00;"-"';
const DASHBOARD_VERSION = 'v0.63.3';

function roundCurrency(value) {
  return value == null ? null : Math.round(value * 100) / 100;
}

export function normalizeFileSegment(value, fallback = 'obra') {
  const normalized = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

export function buildDetailsExportRows(items = []) {
  return items.map((item) => ({
    Grupo: item.grupo || '',
    Código: item.cod || '',
    Item: item.item || '',
    'Cód. Serviço': item.cod_servico || '',
    'Cód. Insumo': item.cod_insumo || '',
    Nível: item.nivel || '',
    Tipo: item.tipo || '',
    'É folha': item.is_folha ? 'Sim' : 'Não',
    'Licitação (R$)': roundCurrency(item.licitacao),
    'Corrigido IPCA (R$)': roundCurrency(item.corrigido_ipca),
    'Corrigido INCC (R$)': roundCurrency(item.corrigido_incc),
    'Gestão (R$)': roundCurrency(item.gestao),
    'Δ R$ (Licitação - Gestão)': roundCurrency(item.diferenca),
    'Δ % (vs Licitação)':
      item.licitacao && item.gestao != null
        ? Math.round(((item.gestao - item.licitacao) / item.licitacao) * 10000) / 100
        : null,
    'Aditivos Total (R$)': roundCurrency(item.aditivo_total),
    'Evolução Teórica (%)': roundCurrency(item.evolucao_teorica),
    'Evolução Financeira (%)': roundCurrency(item.evolucao_financeira),
  }));
}

export function buildFlowsExportRows(flows = []) {
  const reflectedLabels = { sim: 'Sim', nao: 'Não', pendente: 'Pendente' };
  const typeLabels = {
    aumento_real: 'Aumento real',
    remanejamento: 'Remanejamento',
    economia: 'Economia',
    pendente: 'Pendente',
    cancelado: 'Cancelado',
    sem_classificacao: 'Sem classificação',
    misto: 'Misto',
  };

  return flows.map((flow) => ({
    'N° Alteração': flow.n_alteracao || '',
    Data: flow.data_br || '',
    Departamento: flow.dep || '',
    Descrição: flow.descricao || '',
    Motivo: flow.motivo || '',
    Justificativa: flow.justificativa || '',
    'Custo Flowmaster (R$)': roundCurrency(flow.custo_flowmaster),
    'Custo Planejamento (R$)': roundCurrency(flow.custo_planejamento),
    'Insumo Planejamento (destino)': flow.insumo_planejamento || '',
    'Insumo Remanejamento (origem)': flow.insumo_remanejamento || '',
    'Tipo classificação': typeLabels[flow.tipo] || flow.tipo || '',
    'Refletido?': reflectedLabels[flow.refletido_status] || flow.refletido_status || 'Pendente',
    'Solicitante Dep.': flow.solicitante_dep || '',
    'É manual': flow.is_manual ? 'Sim' : 'Não',
  }));
}

export function buildProjectionExportRows(projectionControl = {}) {
  const movements = projectionControl.movimentacoes || [];
  const orderedMovements = [...movements].sort((left, right) =>
    (left.data || '').localeCompare(right.data || ''),
  );
  const typeLabels = {
    aporte: 'Aporte',
    devolucao: 'Devolução',
    aditivo: 'Aditivo',
    remanejamento: 'Remanejamento',
  };
  let balance = projectionControl.saldo_inicial || 0;
  const rows = [];

  if (projectionControl.saldo_inicial != null) {
    rows.push({
      ID: '(inicial)',
      Tipo: 'Saldo inicial',
      Data: projectionControl.data_ref || '',
      'Data (BR)': '',
      'Origem/Descrição': 'Saldo inicial configurado',
      Destino: '',
      'Valor (R$)': projectionControl.saldo_inicial,
      'Saldo acumulado (R$)': balance,
      Responsável: '',
      Justificativa: '',
      'Criado em': '',
      'Criado por': '',
    });
  }

  for (const movement of orderedMovements) {
    const value = movement.valor || 0;
    const isEntry = ['aporte', 'devolucao'].includes(movement.tipo);
    balance += isEntry ? value : -value;
    rows.push({
      ID: movement.id || '',
      Tipo: typeLabels[movement.tipo] || movement.tipo || '',
      Data: movement.data || '',
      'Data (BR)': movement.data_br || '',
      'Origem/Descrição': movement.origem || movement.descricao || '',
      Destino: movement.destino || '',
      'Valor (R$)': isEntry ? value : -value,
      'Saldo acumulado (R$)': balance,
      Responsável: movement.responsavel || '',
      Justificativa: movement.justificativa || '',
      'Criado em': movement.created_at ? new Date(movement.created_at).toLocaleString('pt-BR') : '',
      'Criado por': movement.created_by || '',
    });
  }

  return { rows, finalBalance: roundCurrency(balance) };
}

function createWorkbook(xlsx, sheetName, rows, widths, metadata, monetaryColumns) {
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.json_to_sheet(rows);
  if (widths?.length) worksheet['!cols'] = widths;

  if (monetaryColumns?.length && worksheet['!ref']) {
    const range = xlsx.utils.decode_range(worksheet['!ref']);
    for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
      for (const column of monetaryColumns) {
        const cell = worksheet[xlsx.utils.encode_cell({ r: row, c: column })];
        if (cell && typeof cell.v === 'number') {
          cell.t = 'n';
          cell.z = MONEY_FORMAT;
        }
      }
    }
  }
  xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);

  if (metadata?.length) {
    const metadataSheet = xlsx.utils.json_to_sheet(metadata);
    metadataSheet['!cols'] = [{ wch: 32 }, { wch: 60 }];
    xlsx.utils.book_append_sheet(workbook, metadataSheet, 'Metadados');
  }

  return workbook;
}

function buildBaseMetadata(source, state, exportedAt) {
  const auth = state.auth || {};
  return [
    { Campo: 'Aba de origem', Valor: source },
    { Campo: 'Obra ativa', Valor: state.activeProject || '(não selecionada)' },
    { Campo: 'Nome da obra', Valor: state.project?.nome || '' },
    { Campo: 'Usuário logado', Valor: auth.user?.email || '(anônimo)' },
    {
      Campo: 'Papel do usuário',
      Valor: auth.role || (auth.isAdminGeral ? 'admin' : auth.isEditor ? 'editor' : 'anônimo'),
    },
    { Campo: 'Versão do dashboard', Valor: DASHBOARD_VERSION },
    { Campo: 'Exportado em', Valor: exportedAt.toLocaleString('pt-BR') },
  ];
}

export function createDashboardExportService({
  ensureXlsx,
  getState,
  toast = () => {},
  reportError = () => {},
  now = () => new Date(),
}) {
  async function writeExport({
    source,
    sheetName,
    rows,
    widths,
    monetaryColumns,
    filePrefix,
    state,
    metadata = [],
  }) {
    const xlsx = await ensureXlsx();
    const exportedAt = now();
    const workbook = createWorkbook(
      xlsx,
      sheetName,
      rows,
      widths,
      [...buildBaseMetadata(source, state, exportedAt), ...metadata],
      monetaryColumns,
    );
    const projectCode = normalizeFileSegment(state.activeProject);
    const filename = `${filePrefix}_${projectCode}_${exportedAt.toISOString().slice(0, 10)}.xlsx`;
    xlsx.writeFile(workbook, filename);
    return { filename, rowCount: rows.length };
  }

  async function runExport(context, operation) {
    try {
      return await operation();
    } catch (error) {
      reportError(`Exportação/${context}`, error);
      toast(`❌ Erro ao exportar: ${error.message || error}`, 'err', 5000);
      return null;
    }
  }

  async function exportDetails() {
    return runExport('Detalhamento', async () => {
      const state = getState();
      if (!state.tendency?.length) {
        toast(
          '⚠️ Sem dados de Tendência carregados para esta obra. Suba o arquivo primeiro.',
          'warn',
          5000,
        );
        return null;
      }
      return writeExport({
        source: 'Detalhamento por Item',
        sheetName: 'Detalhamento',
        rows: buildDetailsExportRows(state.tendency),
        widths: [
          { wch: 32 },
          { wch: 14 },
          { wch: 40 },
          { wch: 14 },
          { wch: 14 },
          { wch: 8 },
          { wch: 12 },
          { wch: 8 },
          { wch: 16 },
          { wch: 16 },
          { wch: 16 },
          { wch: 16 },
          { wch: 18 },
          { wch: 16 },
          { wch: 16 },
          { wch: 18 },
          { wch: 18 },
        ],
        monetaryColumns: [8, 9, 10, 11, 12, 14],
        filePrefix: 'detalhamento',
        state,
      });
    });
  }

  async function exportFlows() {
    return runExport('Flows', async () => {
      const state = getState();
      if (!state.flows?.length) {
        toast(
          '⚠️ Sem aditivos carregados para esta obra. Suba o CSV do Flows primeiro.',
          'warn',
          5000,
        );
        return null;
      }
      return writeExport({
        source: 'Flows / Aditivos',
        sheetName: 'Aditivos',
        rows: buildFlowsExportRows(state.flows),
        widths: [
          { wch: 14 },
          { wch: 12 },
          { wch: 16 },
          { wch: 50 },
          { wch: 28 },
          { wch: 50 },
          { wch: 18 },
          { wch: 18 },
          { wch: 28 },
          { wch: 28 },
          { wch: 18 },
          { wch: 12 },
          { wch: 16 },
          { wch: 8 },
        ],
        monetaryColumns: [6, 7],
        filePrefix: 'flows',
        state,
      });
    });
  }

  async function exportProjectionControl() {
    return runExport('Controle de projeção', async () => {
      const state = getState();
      const projectionControl = state.projectionControl || {};
      const movements = projectionControl.movimentacoes || [];
      if (!movements.length) {
        toast('⚠️ Sem movimentações cadastradas para esta obra.', 'warn', 5000);
        return null;
      }
      const { rows, finalBalance } = buildProjectionExportRows(projectionControl);
      return writeExport({
        source: 'Controle Projeção',
        sheetName: 'Movimentações',
        rows,
        widths: [
          { wch: 12 },
          { wch: 14 },
          { wch: 12 },
          { wch: 12 },
          { wch: 40 },
          { wch: 24 },
          { wch: 18 },
          { wch: 20 },
          { wch: 18 },
          { wch: 40 },
          { wch: 18 },
          { wch: 22 },
        ],
        monetaryColumns: [6, 7],
        filePrefix: 'controle-projecao',
        state,
        metadata: [
          { Campo: 'Insumo controlado', Valor: projectionControl.insumo || '' },
          { Campo: 'Saldo inicial (R$)', Valor: projectionControl.saldo_inicial ?? '' },
          { Campo: 'Data de referência', Valor: projectionControl.data_ref || '' },
          { Campo: 'Total de movimentações', Valor: movements.length },
          { Campo: 'Saldo final calculado (R$)', Valor: finalBalance },
        ],
      });
    });
  }

  return Object.freeze({ exportDetails, exportFlows, exportProjectionControl });
}

export function installLegacyDashboardExports(service, target = window) {
  Object.assign(target, {
    exportarDetalhamentoXLSX: service.exportDetails,
    exportarFlowsXLSX: service.exportFlows,
    exportarControleProjXLSX: service.exportProjectionControl,
    exportMovs: service.exportProjectionControl,
  });
}
