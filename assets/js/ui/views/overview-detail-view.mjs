import { STORAGE_KEYS } from '../../config.js';
import { replaceWithParsedMarkup } from '../dom.mjs';
import { escAttr, escHtml } from '../formatters.mjs';
import { updateSortHeaderState } from '../table-interactions.mjs';
import { formatNumber as fmtR$ } from '../dashboard-runtime.mjs';
import { buildOverviewInputDetailModel } from './overview-detail.mjs';

const COLUMNS = Object.freeze([
  { id: 'label', label: 'Grupo / Serviço / Insumo', width: 430, min: 260, max: 620 },
  { id: 'correctedBudget', label: 'Orçamento Licitação Corrigido', width: 210, min: 150, max: 300 },
  { id: 'finalTendency', label: 'Tendência Final', width: 180, min: 130, max: 260 },
  { id: 'difference', label: 'Diferença', width: 180, min: 130, max: 260 },
]);

function monthLabel(value) {
  if (!/^\d{4}-\d{2}$/.test(value || '')) return value || '—';
  const [year, month] = value.split('-');
  const names = [
    'jan',
    'fev',
    'mar',
    'abr',
    'mai',
    'jun',
    'jul',
    'ago',
    'set',
    'out',
    'nov',
    'dez',
  ];
  return `${names[Number(month) - 1]}/${year}`;
}

function signedValue(value) {
  const numeric = Number(value) || 0;
  if (Math.abs(numeric) < 0.005) return '—';
  return `${numeric > 0 ? '+' : ''}${fmtR$(numeric)}`;
}

function tone(value) {
  return value > 0 ? 'increase' : value < 0 ? 'reduction' : 'neutral';
}

function nodeCode(node) {
  return node.cod_insumo || node.cod_servico || node.cod || '';
}

export function createOverviewDetailView({
  storage,
  feedback,
  modals,
  loadXlsx,
  state,
  reportNonFatalError,
}) {
  let model = null;
  let sortKey = null;
  let sortDirection = 1;
  let expansionSignature = null;
  const expanded = new Set();
  let activeWidths = {};
  let resizeState = null;

  function readWidthStore() {
    try {
      const parsed = JSON.parse(storage.get(STORAGE_KEYS.overviewInputColumnWidths, '{}') || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function clampWidth(column, value) {
    const numeric = Number(value);
    const candidate = Number.isFinite(numeric) ? numeric : column.width;
    return Math.round(Math.min(column.max, Math.max(column.min, candidate)) / 10) * 10;
  }

  function loadWidths() {
    const saved = readWidthStore()[model?.projectCode || '__global__'] || {};
    activeWidths = Object.fromEntries(
      COLUMNS.map((column) => [column.id, clampWidth(column, saved[column.id])]),
    );
    return activeWidths;
  }

  function saveWidths() {
    const store = readWidthStore();
    store[model?.projectCode || '__global__'] = { ...activeWidths };
    storage.set(STORAGE_KEYS.overviewInputColumnWidths, JSON.stringify(store));
  }

  function columnMarkup() {
    return COLUMNS.map(
      (column) =>
        `<col data-overview-input-col="${escAttr(column.id)}" width="${activeWidths[column.id]}">`,
    ).join('');
  }

  function resizeHandle(column) {
    return `<span
      class="projection-column-resizer"
      role="separator"
      aria-label="Redimensionar coluna ${escAttr(column.label)}"
      aria-orientation="vertical"
      aria-valuemin="${column.min}"
      aria-valuemax="${column.max}"
      aria-valuenow="${activeWidths[column.id]}"
      tabindex="0"
      data-overview-input-resize="${escAttr(column.id)}"
    ></span>`;
  }

  function renderHeader() {
    const indexLabel = String(model?.correctionIndex || 'ipca').toUpperCase();
    const labels = {
      label: 'Grupo / Serviço / Insumo',
      correctedBudget: `Orçamento Licitação Corrigido (${indexLabel})`,
      finalTendency: 'Tendência Final',
      difference: 'Diferença',
    };
    replaceWithParsedMarkup(
      document.getElementById('overviewInputThead'),
      `<tr>${COLUMNS.map(
        (column) => `<th
          class="${column.id === 'label' ? '' : 'num'}"
          data-sort-overview-input="${escAttr(column.id)}"
          aria-sort="none"
          scope="col"
        ><span>${escHtml(labels[column.id])}</span>${resizeHandle(column)}</th>`,
      ).join('')}</tr>`,
    );
    replaceWithParsedMarkup(document.getElementById('overviewInputColgroup'), columnMarkup());
    updateSortHeaderState(
      '#overviewInputThead th[data-sort-overview-input]',
      'data-sort-overview-input',
      sortKey,
      sortDirection,
    );
  }

  function populateGroupFilter() {
    const select = document.getElementById('overviewInputGroup');
    if (!select) return;
    const selected = select.value;
    const groups = [
      ...new Set(
        model.nodes
          .filter((node) => node.isLeaf)
          .map((node) => node.grupo)
          .filter(Boolean),
      ),
    ].sort((left, right) => left.localeCompare(right, 'pt-BR'));
    replaceWithParsedMarkup(
      select,
      `<option value="">Todos os grupos</option>${groups
        .map((group) => `<option value="${escAttr(group)}">${escHtml(group)}</option>`)
        .join('')}`,
    );
    if (groups.includes(selected)) select.value = selected;
  }

  function initializeExpansion() {
    const signature = `${model.projectCode}|${model.nodes.map((node) => node.key).join('|')}`;
    if (expansionSignature === signature) return;
    expansionSignature = signature;
    expanded.clear();
    for (const node of model.nodes) {
      if (node.children.length && ['raiz', 'grupo', 'subgrupo'].includes(node.tipo)) {
        expanded.add(node.key);
      }
    }
  }

  function matches(node, query, group) {
    if (group) {
      if (!node.isLeaf) return false;
      if (node.grupo !== group) return false;
    }
    if (!query) return true;
    return [node.cod, node.cod_servico, node.cod_insumo, node.item]
      .join(' ')
      .toLowerCase()
      .includes(query);
  }

  function renderBody() {
    if (!model?.nodes?.length) {
      replaceWithParsedMarkup(
        document.getElementById('overviewInputTbody'),
        '<tr><td colspan="4" class="overview-input-empty">Sem insumos para detalhar.</td></tr>',
      );
      return;
    }
    const query = String(document.getElementById('overviewInputSearch')?.value || '')
      .trim()
      .toLowerCase();
    const group = document.getElementById('overviewInputGroup')?.value || '';
    const visible = new Set();
    function collect(index) {
      const node = model.nodes[index];
      let childMatch = false;
      for (const child of node.children) if (collect(child)) childMatch = true;
      const ownMatch = matches(node, query, group);
      if (ownMatch || childMatch) visible.add(index);
      return ownMatch || childMatch;
    }
    model.roots.forEach(collect);

    function sorted(indexes) {
      const withUnlinkedFirst = (leftIndex, rightIndex) => {
        const leftUnlinked = model.nodes[leftIndex].key === 'synthetic:unlinked-group';
        const rightUnlinked = model.nodes[rightIndex].key === 'synthetic:unlinked-group';
        if (leftUnlinked !== rightUnlinked) return leftUnlinked ? -1 : 1;
        return 0;
      };
      if (!sortKey) return [...indexes].sort(withUnlinkedFirst);
      return [...indexes].sort((leftIndex, rightIndex) => {
        const unlinkedOrder = withUnlinkedFirst(leftIndex, rightIndex);
        if (unlinkedOrder) return unlinkedOrder;
        const left = model.nodes[leftIndex];
        const right = model.nodes[rightIndex];
        const leftValue =
          sortKey === 'label' ? left.item || nodeCode(left) : left.metrics[sortKey] || 0;
        const rightValue =
          sortKey === 'label' ? right.item || nodeCode(right) : right.metrics[sortKey] || 0;
        return typeof leftValue === 'string'
          ? sortDirection * leftValue.localeCompare(rightValue, 'pt-BR', { numeric: true })
          : sortDirection * (leftValue - rightValue);
      });
    }

    let html = '';
    let visibleCount = 0;
    function renderNode(index, depth) {
      if (!visible.has(index)) return;
      const node = model.nodes[index];
      const children = node.children.filter((child) => visible.has(child));
      const hasChildren = children.length > 0;
      const isExpanded = query ? true : expanded.has(node.key);
      const code = nodeCode(node);
      const icon = hasChildren ? (isExpanded ? '▼' : '▶') : node.isSynthetic ? '📎' : '•';
      const label = `${code ? `<strong>${escHtml(code)}</strong> · ` : ''}${escHtml(node.item)}`;
      const corrected = node.correctedAvailable
        ? fmtR$(node.metrics.correctedBudget)
        : '<span class="projection-empty-value" title="Sem orçamento corrigido nesta fonte">—</span>';
      const difference = Math.abs(node.metrics.difference) >= 0.005;
      html += `<tr
        class="projection-tree-row projection-tree-row--${escAttr(node.tipo)}${node.isSynthetic ? ' projection-tree-row--flow-only' : ''}"
        ${hasChildren ? `data-overview-input-expand="${escAttr(node.key)}" tabindex="0" aria-expanded="${isExpanded}"` : ''}
      >
        <td class="overview-input-label projection-tree-depth-${Math.min(depth, 6)}"><span class="projection-tree-inline-icon" aria-hidden="true">${icon}</span>${label}</td>
        <td class="num">${corrected}</td>
        <td class="num"><strong>${fmtR$(node.metrics.finalTendency)}</strong></td>
        <td class="num overview-input-difference overview-input-difference--${tone(node.metrics.difference)}">${
          difference
            ? `<button type="button" class="overview-input-difference-button" data-click-action="openOverviewInputDifference" data-action-mode="arg" data-action-arg="${index}" aria-label="Ver composição da diferença de ${escAttr(node.item || code)}">${signedValue(node.metrics.difference)}</button>`
            : '—'
        }</td>
      </tr>`;
      visibleCount += 1;
      if (hasChildren && isExpanded)
        sorted(children).forEach((child) => renderNode(child, depth + 1));
    }
    sorted(model.roots).forEach((index) => renderNode(index, 0));
    replaceWithParsedMarkup(document.getElementById('overviewInputTbody'), html);
    const inputCount = model.nodes.filter((node) => node.isLeaf).length;
    document.getElementById('overviewInputCount').textContent =
      `${visibleCount} linhas visíveis · ${inputCount} insumos`;
    updateSortHeaderState(
      '#overviewInputThead th[data-sort-overview-input]',
      'data-sort-overview-input',
      sortKey,
      sortDirection,
    );
  }

  function render({ snapshot, correctedBudget, finalTendency }) {
    model = buildOverviewInputDetailModel({
      tendencyRows: state.dados.tendencia,
      inputProjections: snapshot.inputProjections,
      flows: snapshot.flows,
      correctionIndex: state.config.correcaoIndice,
      dataFim: snapshot.dataFim,
      projectCode: state.obra.ativa,
      managementLabel:
        state.dados.historico?.projectionManagementByProject?.[state.obra.ativa] || 'Atual',
    });
    const correctedDelta = Math.abs((model.root?.metrics.correctedBudget || 0) - correctedBudget);
    const tendencyDelta = Math.abs((model.root?.metrics.finalTendency || 0) - finalTendency);
    if (correctedDelta >= 0.01 || tendencyDelta >= 0.01) {
      reportNonFatalError(
        'Visão geral/conciliar detalhamento',
        new Error(
          `Totais divergentes: corrigido=${correctedDelta.toFixed(2)}; tendência=${tendencyDelta.toFixed(2)}`,
        ),
      );
    }
    initializeExpansion();
    loadWidths();
    populateGroupFilter();
    renderHeader();
    renderBody();
    const source = document.getElementById('overviewInputSource');
    if (source) {
      source.textContent = `Base: ${model.managementLabel} · término previsto: ${monthLabel(model.dataFim)}`;
    }
    return model;
  }

  function toggleFromRow(event) {
    if (event.target.closest('button, input, select, a')) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    const row = event.target.closest('[data-overview-input-expand]');
    if (!row) return;
    if (event.type === 'keydown') event.preventDefault();
    const key = row.dataset.overviewInputExpand;
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    renderBody();
  }

  function expandAll() {
    for (const node of model?.nodes || []) if (node.children.length) expanded.add(node.key);
    renderBody();
  }

  function collapseAll() {
    expanded.clear();
    renderBody();
  }

  function restoreOriginalOrder() {
    sortKey = null;
    sortDirection = 1;
    renderBody();
  }

  function resetWidths() {
    const store = readWidthStore();
    delete store[model?.projectCode || '__global__'];
    storage.set(STORAGE_KEYS.overviewInputColumnWidths, JSON.stringify(store));
    loadWidths();
    renderHeader();
  }

  function syncWidths() {
    for (const column of COLUMNS) {
      document
        .querySelector(`#overviewInputColgroup col[data-overview-input-col="${column.id}"]`)
        ?.setAttribute('width', String(activeWidths[column.id]));
      document
        .querySelector(`#overviewInputThead [data-overview-input-resize="${column.id}"]`)
        ?.setAttribute('aria-valuenow', String(activeWidths[column.id]));
    }
  }

  function updateWidth(columnId, width, persist = false) {
    const column = COLUMNS.find((item) => item.id === columnId);
    if (!column) return;
    activeWidths[columnId] = clampWidth(column, width);
    syncWidths();
    if (persist) saveWidths();
  }

  function resizePointerDown(event) {
    const handle = event.target.closest('[data-overview-input-resize]');
    if (!handle || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeState = {
      columnId: handle.dataset.overviewInputResize,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: activeWidths[handle.dataset.overviewInputResize],
    };
    handle.setPointerCapture?.(event.pointerId);
  }

  function resizePointerMove(event) {
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    updateWidth(resizeState.columnId, resizeState.startWidth + event.clientX - resizeState.startX);
  }

  function resizePointerEnd(event) {
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    resizeState = null;
    saveWidths();
  }

  function headerKeydown(event) {
    const handle = event.target.closest('[data-overview-input-resize]');
    if (!handle || !['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const column = COLUMNS.find((item) => item.id === handle.dataset.overviewInputResize);
    const value =
      event.key === 'Home'
        ? column.width
        : activeWidths[column.id] + (event.key === 'ArrowRight' ? 10 : -10);
    updateWidth(column.id, value, true);
  }

  function sort(event) {
    if (event.target.closest('[data-overview-input-resize]')) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    const header = event.target.closest('[data-sort-overview-input]');
    if (!header) return;
    if (event.type === 'keydown') event.preventDefault();
    const next = header.dataset.sortOverviewInput;
    if (sortKey === next) sortDirection *= -1;
    else {
      sortKey = next;
      sortDirection = next === 'label' ? 1 : -1;
    }
    renderBody();
  }

  function flowRows(items) {
    return items
      .map(
        (flow) => `<tr>
          <td><strong>${escHtml(flow.numero)}</strong></td>
          <td>${escHtml(flow.descricao)}</td>
          <td>${escHtml(flow.insumo || 'Sem insumo classificado')}</td>
          <td class="num overview-input-difference--${tone(flow.valor)}">${signedValue(flow.valor)}</td>
        </tr>`,
      )
      .join('');
  }

  function openDifference(rawIndex) {
    const node = model?.nodes?.[Number(rawIndex)];
    if (!node || Math.abs(node.metrics.difference) < 0.005) return;
    const projectionItems = node.projectionItems.filter(
      (item) => Math.abs(item.valorProjetado) >= 0.005,
    );
    const projectionRows = projectionItems
      .map(
        (item) => `<tr>
          <td class="overview-input-projection-item">
            <strong>${escHtml(item.insumo || 'Sem insumo')}</strong>
            <span>${item.servico ? `Serviço ${escHtml(item.servico)}` : 'Sem serviço vinculado'}</span>
          </td>
          <td>${escHtml(monthLabel(item.ultimoMesPlanejado))}</td>
          <td>${escHtml(monthLabel(item.dataFim))}</td>
          <td class="num">${item.mesesGap}</td>
          <td class="num">${fmtR$(item.ritmoHistorico)}/mês</td>
          <td class="num overview-input-difference--${tone(item.valorProjetado)}">${signedValue(item.valorProjetado)}</td>
        </tr>`,
      )
      .join('');
    const pendingTotal = node.pendingFlowItems.reduce((sum, flow) => sum + flow.valor, 0);
    const reflectedTotal = node.reflectedFlowItems.reduce((sum, flow) => sum + flow.valor, 0);
    replaceWithParsedMarkup(
      document.getElementById('modalContent'),
      `<h2>Δ Composição da diferença · ${escHtml(node.item || nodeCode(node))}</h2>
      <div class="meta">Obra: <strong>${escHtml(model.projectCode)}</strong> · Base: <strong>${escHtml(model.managementLabel)}</strong> · Licitação corrigida: <strong>${escHtml(model.correctionIndex.toUpperCase())}</strong></div>
      <div class="overview-input-difference-lines">
        <div><span>Licitação Corrigida</span><strong>${node.correctedAvailable ? fmtR$(node.metrics.correctedBudget) : '—'}</strong></div>
        <div><span>Gestão atual</span><strong>${fmtR$(node.metrics.management)}</strong></div>
        <div><span>Variação de Inflação</span><strong class="overview-input-difference--${tone(node.metrics.inflationVariation)}">${signedValue(node.metrics.inflationVariation)}</strong></div>
        <div><span>Projeção automática</span><strong class="overview-input-difference--${tone(node.metrics.automaticProjection)}">${signedValue(node.metrics.automaticProjection)}</strong></div>
        <div><span>Flows pendentes</span><strong class="overview-input-difference--${tone(node.metrics.pendingFlows)}">${signedValue(node.metrics.pendingFlows)}</strong></div>
        <div class="overview-input-difference-line--total"><span>Diferença total</span><strong class="overview-input-difference--${tone(node.metrics.difference)}">${signedValue(node.metrics.difference)}</strong></div>
        <div class="overview-input-difference-line--final"><span>Valor final</span><strong class="overview-input-difference--${tone(node.metrics.difference)}">${fmtR$(node.metrics.finalTendency)}</strong></div>
      </div>
      <div class="overview-input-reconciliation">${fmtR$(node.metrics.correctedBudget)} ${node.metrics.difference >= 0 ? '+' : '−'} ${fmtR$(Math.abs(node.metrics.difference))} = <strong>${fmtR$(node.metrics.finalTendency)}</strong></div>
      ${
        projectionRows
          ? `<section class="projection-difference-flows">
          <div class="projection-difference-section-heading"><h3>🔮 Projeção automática até o fim da obra</h3><span>${projectionItems.length} item(ns)</span></div>
          <div class="table-wrap projection-difference-flows-table-wrap"><table class="projection-difference-flows-table overview-input-projection-table">
            <thead><tr><th>Insumo / serviço</th><th>Último mês planejado</th><th>Término da obra</th><th class="num">Meses</th><th class="num">Ritmo histórico</th><th class="num">Valor projetado</th></tr></thead>
            <tbody>${projectionRows}</tbody>
            <tfoot><tr><th colspan="5">Projeção automática total</th><th class="num">${signedValue(node.metrics.automaticProjection)}</th></tr></tfoot>
          </table></div>
          <div class="overview-input-projection-result">Tendência final resultante: <strong>${fmtR$(node.metrics.finalTendency)}</strong></div>
        </section>`
          : ''
      }
      ${
        node.pendingFlowItems.length
          ? `<section class="projection-difference-flows">
          <div class="projection-difference-section-heading"><h3>📎 Flows pendentes incluídos</h3><span>${node.pendingFlowItems.length} Flow(s)</span></div>
          <div class="table-wrap projection-difference-flows-table-wrap"><table class="projection-difference-flows-table">
            <thead><tr><th>Flow</th><th>Descrição</th><th>Insumo destino</th><th class="num">Valor</th></tr></thead>
            <tbody>${flowRows(node.pendingFlowItems)}</tbody>
            <tfoot><tr><th colspan="3">Total incluído</th><th class="num">${signedValue(pendingTotal)}</th></tr></tfoot>
          </table></div>
        </section>`
          : ''
      }
      ${
        node.reflectedFlowItems.length
          ? `<section class="projection-difference-flows projection-month-reflected-section">
          <div class="projection-difference-section-heading"><h3>✅ Flows já refletidos</h3><span>Informativos · não somados novamente</span></div>
          <div class="table-wrap projection-difference-flows-table-wrap"><table class="projection-difference-flows-table">
            <thead><tr><th>Flow</th><th>Descrição</th><th>Insumo destino</th><th class="num">Valor informado</th></tr></thead>
            <tbody>${flowRows(node.reflectedFlowItems)}</tbody>
            <tfoot><tr><th colspan="3">Total informado</th><th class="num">${signedValue(reflectedTotal)}</th></tr></tfoot>
          </table></div>
        </section>`
          : ''
      }`,
    );
    modals.open({ initialFocus: '[data-click-action="closeModal"]' });
  }

  async function exportExcel() {
    try {
      if (!model?.nodes?.length) {
        feedback.toast('⚠️ Não há insumos para exportar.', 'warn', 4000);
        return;
      }
      const XLSX = await loadXlsx();
      const rows = [];
      function walk(index, depth) {
        const node = model.nodes[index];
        rows.push({
          'Grupo / Serviço / Insumo': `${'  '.repeat(depth)}${nodeCode(node) ? `${nodeCode(node)} · ` : ''}${node.item}`,
          [`Orçamento Licitação Corrigido (${model.correctionIndex.toUpperCase()})`]:
            node.correctedAvailable ? node.metrics.correctedBudget : null,
          'Tendência Final': node.metrics.finalTendency,
          Diferença: node.metrics.difference,
        });
        node.children.forEach((child) => walk(child, depth + 1));
      }
      model.roots.forEach((index) => walk(index, 0));
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet['!cols'] = COLUMNS.map((column) => ({
        wch: Math.max(16, Math.round(activeWidths[column.id] / 7)),
      }));
      const numberFormat = '#,##0.00;-#,##0.00;"-"';
      const range = XLSX.utils.decode_range(sheet['!ref']);
      for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
        for (let column = 1; column <= 3; column += 1) {
          const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
          if (cell && typeof cell.v === 'number') cell.z = numberFormat;
        }
      }
      XLSX.utils.book_append_sheet(workbook, sheet, 'Detalhamento');
      const metadata = XLSX.utils.json_to_sheet([
        { Campo: 'Obra', Valor: model.projectCode },
        { Campo: 'Gestão-base', Valor: model.managementLabel },
        { Campo: 'Índice de correção', Valor: model.correctionIndex.toUpperCase() },
        { Campo: 'Data prevista de término', Valor: model.dataFim },
        {
          Campo: 'Regra',
          Valor: 'Tendência Final = Gestão-base + projeção automática + Flows pendentes',
        },
      ]);
      metadata['!cols'] = [{ wch: 30 }, { wch: 78 }];
      XLSX.utils.book_append_sheet(workbook, metadata, 'Metadados');
      const filename = `visao-geral-insumos_${model.projectCode}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(workbook, filename);
      feedback.toast(`✅ Detalhamento exportado: ${filename}`, 'ok', 3500);
    } catch (error) {
      reportNonFatalError('Visão geral/exportar detalhamento', error);
      feedback.toast(`❌ Erro ao exportar: ${error.message || error}`, 'err', 5000);
    }
  }

  const tbody = document.getElementById('overviewInputTbody');
  tbody?.addEventListener('click', toggleFromRow);
  tbody?.addEventListener('keydown', toggleFromRow);
  document.getElementById('overviewInputSearch')?.addEventListener('input', renderBody);
  document.getElementById('overviewInputGroup')?.addEventListener('change', renderBody);
  const thead = document.getElementById('overviewInputThead');
  thead?.addEventListener('click', sort);
  thead?.addEventListener('keydown', (event) => {
    headerKeydown(event);
    if (!event.defaultPrevented) sort(event);
  });
  thead?.addEventListener('pointerdown', resizePointerDown);
  document.addEventListener('pointermove', resizePointerMove);
  document.addEventListener('pointerup', resizePointerEnd);
  document.addEventListener('pointercancel', resizePointerEnd);

  return Object.freeze({
    render,
    expandAll,
    collapseAll,
    restoreOriginalOrder,
    resetWidths,
    openDifference,
    exportExcel,
    getModel: () => model,
  });
}
