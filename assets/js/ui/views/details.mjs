/* eslint-disable no-undef */
import { replaceWithParsedMarkup } from '../dom.mjs';

// ============ DETALHAMENTO ============
let filtersBound = false;

function bindDetailFilters() {
  if (filtersBound) return;
  filtersBound = true;
  const debouncedFilters = debounce(() => {
    renderTable();
    salvarFiltros();
  }, 300);
  ['search', 'filterGrupo', 'filterStatus', 'filterAditivo', 'onlyFolhas'].forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener('input', debouncedFilters);
      element.addEventListener('change', debouncedFilters);
    }
  });
}

function updateSortHeaderState(selector, dataAttribute, activeKey, direction) {
  document.querySelectorAll(selector).forEach((header) => {
    const key = header.getAttribute(dataAttribute);
    const state = key === activeKey ? (direction > 0 ? 'ascending' : 'descending') : 'none';
    const label = header.textContent.trim();
    header.setAttribute('aria-sort', state);
    header.setAttribute(
      'aria-label',
      state === 'none'
        ? `${label}. Ativar ordenação`
        : `${label}. Ordenação ${state === 'ascending' ? 'crescente' : 'decrescente'}`,
    );
  });
}

function bindSortableHeaders(selector, dataAttribute, getState, activateSort) {
  document.querySelectorAll(selector).forEach((header) => {
    header.tabIndex = 0;
    const activate = () => activateSort(header.getAttribute(dataAttribute));
    header.addEventListener('click', activate);
    header.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activate();
    });
  });
  const state = getState();
  updateSortHeaderState(selector, dataAttribute, state.key, state.direction);
}

function isTableRowActivation(event) {
  return event.type === 'click' || event.key === 'Enter' || event.key === ' ';
}

function populateFilters() {
  const grupos = [...new Set(DATA_T.map((d) => d.grupo))].sort();
  const sel = document.getElementById('filterGrupo');
  const cur = sel.value;
  sel.replaceChildren(
    new Option('Todos os grupos', ''),
    ...grupos.map((g) => new Option(String(g || ''), String(g || ''))),
  );
  sel.value = cur;
}

// cor da célula de Evolução Financeira baseada no descolamento vs Teórica
function _evolClass(d) {
  if (d.evolucao_teorica == null || d.evolucao_financeira == null) return 'var(--sem-alerta)';
  if (d.evolucao_teorica === 0) return 'var(--sem-alerta)';
  // Ratio: quanto o financeiro adiantou/atrasou em relação ao teórico
  const ratio = d.evolucao_financeira / d.evolucao_teorica;
  if (ratio > 1.15) return 'var(--sem-erro)'; // gastando muito acima do executado
  if (ratio < 0.85) return 'var(--sem-ok)'; // executando bem mais do que gastando
  return 'var(--sem-alerta)'; // dentro da faixa
}

function renderTable() {
  bindDetailFilters();
  // atualizar header da coluna Gestão com o GESTAO_LABEL atual
  const thG = document.getElementById('thGestao');
  if (thG && GESTAO_LABEL) {
    // Encurta 'GESTÃO 07-2026' pra 'Gestão 07/26' pra caber
    const m = GESTAO_LABEL.match(/GEST[ÃA]O\s+(\d{2})-(\d{4})/i);
    thG.textContent = m ? `Gestão ${m[1]}/${m[2].slice(-2)}` : GESTAO_LABEL;
  }
  // guard sem dados
  if (!obraTemTendencia()) {
    const tbody = document.getElementById('tbody');
    if (tbody)
      renderDashboardState(tbody, {
        title: 'Detalhamento sem dados',
        message: 'Envie a planilha de Tendência desta obra para consultar os itens.',
        action: { label: 'Ir para Uploads', tab: 'uploads' },
        tableColspan: 11,
      });
    const count = document.getElementById('count');
    if (count) count.textContent = '0 itens';
    const emptyPage = paginateRows('detail', [], 'empty');
    renderPaginationControls('detailPagination', 'detail', emptyPage, renderTable);
    return;
  }
  const q = document.getElementById('search').value.toLowerCase();
  const fg = document.getElementById('filterGrupo').value;
  const fs = document.getElementById('filterStatus').value;
  const fa = document.getElementById('filterAditivo').value;
  const onlyFolhas = document.getElementById('onlyFolhas').checked;

  const rows = DATA_T.filter((d) => {
    if (onlyFolhas && !d.is_folha) return false;
    if (
      q &&
      !(
        d.item.toLowerCase().includes(q) ||
        (d.cod_insumo || '').toLowerCase().includes(q) ||
        (d.cod || '').toLowerCase().includes(q)
      )
    )
      return false;
    if (fg && d.grupo !== fg) return false;
    if (fs) {
      const st = statusOf(d.licitacao, d.gestao);
      if (st !== fs) return false;
    }
    if (
      fa === 'com' &&
      (!d.flows_destino || d.flows_destino.length === 0) &&
      (!d.flows_origem || d.flows_origem.length === 0)
    )
      return false;
    if (
      fa === 'sem' &&
      ((d.flows_destino && d.flows_destino.length > 0) ||
        (d.flows_origem && d.flows_origem.length > 0))
    )
      return false;
    return true;
  });

  rows.sort((a, b) => {
    let va, vb;
    if (sortKey === 'pct') {
      va = a.licitacao ? (a.gestao - a.licitacao) / a.licitacao : -Infinity;
      vb = b.licitacao ? (b.gestao - b.licitacao) / b.licitacao : -Infinity;
    } else if (sortKey === 'diferenca') {
      va = a.licitacao != null && a.gestao != null ? a.gestao - a.licitacao : -Infinity;
      vb = b.licitacao != null && b.gestao != null ? b.gestao - b.licitacao : -Infinity;
    } else if (sortKey === 'aditivo_total') {
      va = Math.abs(a.aditivo_total || 0);
      vb = Math.abs(b.aditivo_total || 0);
    } else {
      va = a[sortKey];
      vb = b[sortKey];
    }
    if (va == null) va = -Infinity;
    if (vb == null) vb = -Infinity;
    if (typeof va === 'string') return sortDir * va.localeCompare(vb);
    return sortDir * (va - vb);
  });

  // Marca cada item com seu índice original em DATA_T (evita indexOf O(n²) no render)
  const idxMap = new Map();
  DATA_T.forEach((d, i) => idxMap.set(d, i));
  const detailPage = paginateRows(
    'detail',
    rows,
    JSON.stringify([q, fg, fs, fa, onlyFolhas, sortKey, sortDir, OBRA_ATIVA]),
  );

  replaceWithParsedMarkup(
    document.getElementById('tbody'),
    detailPage.items
      .map((d) => {
        const st = statusOf(d.licitacao, d.gestao);
        const diff = d.licitacao != null && d.gestao != null ? d.gestao - d.licitacao : null;
        const pct = d.licitacao && d.gestao != null ? (diff / d.licitacao) * 100 : null;
        const badge = st
          ? `<span class="badge ${st}">${st === 'red' ? '🔴 Estouro' : st === 'amber' ? '🟡 Atenção' : '🟢 OK'}</span>`
          : '';
        if (!d.is_folha) {
          const cls = d.nivel <= 2 ? 'row-grupo' : 'row-sub';
          return `<tr class="${cls}"><td colspan="11">${escHtml(d.cod)} · ${escHtml(d.item)}</td></tr>`;
        }
        const hasAdt =
          (d.flows_destino && d.flows_destino.length > 0) ||
          (d.flows_origem && d.flows_origem.length > 0);
        const adt = d.aditivo_total || 0;
        const adtTxt = hasAdt
          ? `<span class="${adt < 0 ? 'pos' : 'neg'}">${adt >= 0 ? '+' : ''}${fmt(adt)}</span> <span style="color:var(--text-lighter);font-size:10px;">(${(d.flows_destino?.length || 0) + (d.flows_origem?.length || 0)})</span>`
          : '<span style="color:var(--text-lighter);">-</span>';
        const origIdx = idxMap.get(d);
        return `<tr class="folha ${hasAdt ? 'has-aditivo' : ''}" data-idx="${origIdx}" tabindex="0" aria-label="Abrir detalhes de ${escAttr(d.item || d.cod_insumo || 'item')}">
      <td>${escHtml(d.grupo)}</td>
      <td>${escHtml(d.item)}</td>
      <td style="color:var(--text-soft);font-size:11px;">${escHtml(d.cod_insumo || '')}</td>
      <td class="num">${fmtR$(d.licitacao)}</td>
      <td class="num">${fmtR$(d.gestao)}</td>
      <td class="num ${diff <= 0 ? 'pos' : 'neg'}">${diff != null ? (diff >= 0 ? '+' : '') + fmt(diff) : '-'}</td>
      <td class="num ${pct <= 0 ? 'pos' : 'neg'}">${pct != null ? fmtPct(pct) : '-'}</td>
      <td class="num">${adtTxt}</td>
      <td class="num" style="color:var(--fgr-red);">${d.evolucao_teorica != null ? fmt(d.evolucao_teorica, 0) : '<span style="color:var(--border-strong);">-</span>'}</td>
      <td class="num" style="color:${_evolClass(d)}">${d.evolucao_financeira != null ? fmt(d.evolucao_financeira, 0) : '<span style="color:var(--border-strong);">-</span>'}</td>
      <td>${badge}</td>
    </tr>`;
      })
      .join(''),
  );
  document.getElementById('count').textContent =
    `${rows.filter((r) => r.is_folha).length} itens · exibindo ${detailPage.start}–${detailPage.end}`;
  renderPaginationControls('detailPagination', 'detail', detailPage, renderTable);
  updateSortHeaderState('th[data-sort]', 'data-sort', sortKey, sortDir);
}

function activateDetailRow(event) {
  if (!isTableRowActivation(event)) return;
  const tr = event.target.closest('tr[data-idx]');
  if (!tr) return;
  if (event.type === 'keydown') event.preventDefault();
  const idx = parseInt(tr.dataset.idx, 10);
  if (!isNaN(idx)) openItem(idx);
}

// Salvar filtros no localStorage
function salvarFiltros() {
  try {
    const filtros = {
      search: document.getElementById('search')?.value || '',
      filterGrupo: document.getElementById('filterGrupo')?.value || '',
      filterStatus: document.getElementById('filterStatus')?.value || '',
      filterAditivo: document.getElementById('filterAditivo')?.value || '',
      onlyFolhas: document.getElementById('onlyFolhas')?.checked ?? true,
    };
    localStorage.setItem('jzurique_filters_' + (OBRA_ATIVA || 'default'), JSON.stringify(filtros));
  } catch (e) {
    reportNonFatalError('Filtros/salvar', e);
  }
}

// Restaurar filtros do localStorage
function restaurarFiltros() {
  try {
    const raw = localStorage.getItem('jzurique_filters_' + (OBRA_ATIVA || 'default'));
    if (!raw) return;
    const filtros = JSON.parse(raw);
    const el = (id) => document.getElementById(id);
    if (el('search')) el('search').value = filtros.search || '';
    if (el('filterGrupo')) el('filterGrupo').value = filtros.filterGrupo || '';
    if (el('filterStatus')) el('filterStatus').value = filtros.filterStatus || '';
    if (el('filterAditivo')) el('filterAditivo').value = filtros.filterAditivo || '';
    if (el('onlyFolhas')) el('onlyFolhas').checked = filtros.onlyFolhas !== false;
  } catch (e) {
    reportNonFatalError('Filtros/restaurar', e);
  }
}

// ============ MODAL DE ITEM ============
function openItem(idx) {
  const d = DATA_T[idx];
  if (!d.is_folha) return;
  const diff = d.licitacao != null && d.gestao != null ? d.gestao - d.licitacao : null;
  const pct = d.licitacao && d.gestao != null ? (diff / d.licitacao) * 100 : null;
  const dest = d.flows_destino || [];
  const orig = d.flows_origem || [];
  const totDest = dest.reduce((s, f) => s + (f.custo_flowmaster || 0), 0);
  const totOrig = orig.reduce((s, f) => s + (f.custo_flowmaster || 0), 0);

  replaceWithParsedMarkup(
    document.getElementById('modalContent'),
    `
    <h2>${escHtml(d.item)}</h2>
    <div class="meta">${escHtml(d.grupo)} · Código ${escHtml(d.cod)} · Insumo ${escHtml(d.cod_insumo)}</div>
    <div class="kpis" style="margin-bottom: 16px;">
      <div class="kpi"><div class="label">Licitação</div><div class="value">${fmtR$(d.licitacao)}</div></div>
      <div class="kpi"><div class="label">Gestão atual</div><div class="value">${fmtR$(d.gestao)}</div></div>
      <div class="kpi ${diff > 0 ? 'red' : 'green'}"><div class="label">Desvio</div><div class="value">${diff != null ? (diff >= 0 ? '+' : '') + fmtR$(diff) : '-'}</div><div class="sub">${pct != null ? fmtPct(pct) : ''}</div></div>
      <div class="kpi purple"><div class="label">Coberto por aditivo</div><div class="value">${fmtR$(totDest - totOrig)}</div><div class="sub">${dest.length} entrada / ${orig.length} saída</div></div>
    </div>

    ${dest.length > 0 ? `<h3 style="font-size:13px; margin-bottom:8px; color:var(--accent-purple-strong);">➡️ Aditivos que ENTRARAM neste item (${fmt(totDest)})</h3>` : ''}
    ${dest.map((f) => renderFlowMini(f)).join('')}

    ${orig.length > 0 ? `<h3 style="font-size:13px; margin: 14px 0 8px; color:var(--text-medium);">⬅️ Aditivos que SAÍRAM deste item para outros (${fmt(totOrig)})</h3>` : ''}
    ${orig.map((f) => renderFlowMini(f, true)).join('')}

    ${dest.length === 0 && orig.length === 0 ? '<div style="text-align:center; color:var(--text-lighter); padding:20px;">Nenhum aditivo vinculado a este item.</div>' : ''}

    ${
      diff > 0 && totDest < diff
        ? `<div class="alert-banner" style="margin-top:14px;">
      ⚠️ <strong>Atenção:</strong> o desvio deste item é de ${fmtR$(diff)} mas só ${fmtR$(totDest)} estão formalizados em aditivo. <strong>${fmtR$(diff - totDest)}</strong> ainda são tendência sem aditivo.
    </div>`
        : ''
    }
  `,
  );
  openModal();
}

function renderFlowMini(f, isOrigem = false) {
  const tipoLabel = {
    aumento_real: '🔴 Aumento real',
    remanejamento: '🔵 Remanejamento',
    economia: '🟢 Economia',
    pendente: '🟡 Pendente',
    cancelado: '🚫 Cancelado',
    sem_classificacao: '⚪ Sem class.',
    misto: '⚪ Misto',
  };
  const depBadge = {
    Finalizado: 'green',
    Projeto: 'amber',
    Cancelado: 'gray',
    Planejamento: 'blue',
    Orçamento: 'blue',
    Obra: 'amber',
  };
  const linkTxt = isOrigem
    ? `→ destino: ${escHtml(f.insumo_planejamento || '-')}`
    : f.insumo_remanejamento &&
        !['', '-', 'Não encontrado!'].includes(f.insumo_remanejamento) &&
        !f.insumo_remanejamento.includes('VERIFICAR')
      ? `← origem: ${escHtml(f.insumo_remanejamento)}`
      : '';
  return `
    <div class="flow-mini-card ${escAttr(f.tipo)}">
      <div class="head">
        <strong>Nº ${escHtml(f.n_alteracao)} ${f.n_adt ? '· ' + escHtml(f.n_adt) : ''}</strong>
        <span class="${(f.custo_flowmaster || 0) < 0 ? 'pos' : 'neg'}" style="font-weight:700;">${fmtR$(f.custo_flowmaster)}</span>
      </div>
      <div style="font-size:11px;color:var(--text-soft);">
        ${escHtml(formatDate(f.data_br))} · <span class="badge ${depBadge[f.dep] || 'gray'}">${escHtml(f.dep)}</span>
        · ${tipoLabel[f.tipo] || escHtml(f.tipo)} · ${escHtml(f.motivo)} ${linkTxt ? '· ' + linkTxt : ''}
      </div>
      <div class="desc">${escHtml(f.descricao)}</div>
      ${f.justificativa ? `<div class="desc"><em>Justificativa:</em> ${escHtml(f.justificativa)}</div>` : ''}
    </div>`;
}

export function installLegacyDetailsView(target = window) {
  Object.assign(target, {
    updateSortHeaderState,
    bindSortableHeaders,
    isTableRowActivation,
    populateFilters,
    renderTable,
    restaurarFiltros,
    openItem,
  });
  bindSortableHeaders(
    'th[data-sort]',
    'data-sort',
    () => ({ key: sortKey, direction: sortDir }),
    (key) => {
      if (sortKey === key) sortDir = -sortDir;
      else {
        sortKey = key;
        sortDir = ['item', 'grupo', 'cod_insumo'].includes(key) ? 1 : -1;
      }
      updateSortHeaderState('th[data-sort]', 'data-sort', sortKey, sortDir);
      renderTable();
    },
  );
  document.getElementById('tbody')?.addEventListener('click', activateDetailRow);
  document.getElementById('tbody')?.addEventListener('keydown', activateDetailRow);
}
