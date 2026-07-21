/* eslint-disable no-undef */
import { replaceWithParsedMarkup } from '../dom.mjs';

// ============ FLOWS TAB ============
let interactionsBound = false;

function bindFlowInteractions() {
  if (interactionsBound) return;
  interactionsBound = true;

  bindSortableHeaders(
    'th[data-sort-flow]',
    'data-sort-flow',
    () => ({ key: sortKeyF, direction: sortDirF }),
    (key) => {
      if (sortKeyF === key) sortDirF = -sortDirF;
      else {
        sortKeyF = key;
        sortDirF = -1;
      }
      updateSortHeaderState('th[data-sort-flow]', 'data-sort-flow', sortKeyF, sortDirF);
      renderFlowTable();
    },
  );

  document.getElementById('flowTbody')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="delete-manual"]');
    if (button) deleteManual(button.dataset.n);
  });

  const debouncedFlowTable = debounce(renderFlowTable, 300);
  [
    'flowSearch',
    'flowFilterDataIni',
    'flowFilterDataFim',
    'flowFilterValMin',
    'flowFilterValMax',
  ].forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener('input', debouncedFlowTable);
      element.addEventListener('change', debouncedFlowTable);
    }
  });
}

function renderFlows() {
  bindFlowInteractions();
  // guard sem dados de Flows
  if (!Array.isArray(getFlowsObraAtiva()) || getFlowsObraAtiva().length === 0) {
    const flowSummary = document.getElementById('flowSummary');
    const flowsByTipo = document.getElementById('flowsByTipo');
    const flowsTbody = document.getElementById('flowTbody');
    if (flowSummary)
      renderDashboardState(flowSummary, {
        title: 'Sem aditivos carregados',
        message: 'Envie a planilha de Flows para consultar os aditivos desta obra.',
        action: { label: 'Ir para Uploads', tab: 'uploads' },
      });
    if (flowsByTipo) flowsByTipo.replaceChildren();
    if (flowsTbody)
      renderDashboardState(flowsTbody, {
        title: 'Sem aditivos para listar',
        compact: true,
        tableColspan: 10,
      });
    document.getElementById('flowsByMotivo')?.replaceChildren();
    document.getElementById('flowsDescartados')?.replaceChildren();
    const flowCount = document.getElementById('flowCount');
    if (flowCount) flowCount.textContent = '0 aditivos';
    const emptyPage = paginateRows('flows', [], 'empty');
    renderPaginationControls('flowPagination', 'flows', emptyPage, renderFlowTable);
    return;
  }
  const total = getFlowsObraAtiva().length;
  const byDep = {};
  getFlowsObraAtiva().forEach((f) => {
    byDep[f.dep] = (byDep[f.dep] || 0) + 1;
  });
  const sumFm = (arr) => arr.reduce((s, f) => s + (f.custo_flowmaster || 0), 0);
  // Cancelado agora é uma classificação própria (some pelo dep OU pelo tipo)
  const isCancelado = (f) => f.dep === 'Cancelado' || f.tipo === 'cancelado';
  const isNaoRefletir = (f) => !isCancelado(f) && f.refletido_status === 'nao';
  const active = getFlowsObraAtiva().filter((f) => !isCancelado(f) && !isNaoRefletir(f));
  const tipoSums = {};
  ['aumento_real', 'remanejamento', 'economia', 'pendente'].forEach((t) => {
    const arr = active.filter((f) => f.tipo === t);
    tipoSums[t] = { n: arr.length, v: sumFm(arr) };
  });
  const semClassVivos = active.filter((f) => f.tipo === 'sem_classificacao');
  if (semClassVivos.length) {
    tipoSums['sem_classificacao'] = { n: semClassVivos.length, v: sumFm(semClassVivos) };
  }
  const cancelados = getFlowsObraAtiva().filter(isCancelado);
  if (cancelados.length) {
    tipoSums['cancelado'] = { n: cancelados.length, v: sumFm(cancelados) };
  }
  const descartados = getFlowsObraAtiva().filter(isNaoRefletir);

  replaceWithParsedMarkup(
    document.getElementById('flowSummary'),
    `
    <div class="flow-card"><div class="lbl">Total Aditivos</div><div class="v">${total}</div><div class="sub">${fmtR$(sumFm(getFlowsObraAtiva()))} flowmaster total</div></div>
    <div class="flow-card green"><div class="lbl">Finalizados</div><div class="v">${byDep.Finalizado || 0}</div><div class="sub">${fmtR$(sumFm(getFlowsObraAtiva().filter((f) => f.dep === 'Finalizado')))}</div></div>
    <div class="flow-card amber"><div class="lbl">Em andamento</div><div class="v">${(byDep.Projeto || 0) + (byDep.Planejamento || 0) + (byDep.Orçamento || 0) + (byDep.Obra || 0)}</div><div class="sub">${fmtR$(sumFm(getFlowsObraAtiva().filter((f) => !['Cancelado', 'Finalizado'].includes(f.dep))))}</div></div>
    <div class="flow-card gray"><div class="lbl">Cancelados</div><div class="v">${byDep.Cancelado || 0}</div><div class="sub">${fmtR$(sumFm(getFlowsObraAtiva().filter((f) => f.dep === 'Cancelado')))} (descartado)</div></div>
    <div class="flow-card purple"><div class="lbl">Aumento Real</div><div class="v">${fmtR$(tipoSums.aumento_real.v)}</div><div class="sub">${tipoSums.aumento_real.n} aditivos</div></div>
  `,
  );

  // Tipos com barras
  const colors = {
    aumento_real: 'var(--fgr-red-vivid)',
    remanejamento: 'var(--text-medium)',
    economia: 'var(--sem-ok)',
    pendente: 'var(--sem-alerta)',
    cancelado: 'var(--text-medium)',
    sem_classificacao: 'var(--text-lighter)',
  };
  const labels = {
    aumento_real: '🔴 Aumento real',
    remanejamento: '🔵 Remanejamento',
    economia: '🟢 Economia',
    pendente: '🟡 Pendente',
    cancelado: '🚫 Cancelado',
    sem_classificacao: '⚪ Sem classificação',
  };
  const maxV = Math.max(...Object.values(tipoSums).map((t) => Math.abs(t.v)), 1);
  replaceWithParsedMarkup(
    document.getElementById('flowsByTipo'),
    Object.entries(tipoSums)
      .map(
        ([t, v]) => `
    <div class="top-item">
      <div class="name">${labels[t]} <span style="color:var(--text-soft);font-size:11px;">(${v.n})</span></div>
      <div class="val">${fmtR$(v.v)}</div>
      <div class="top-bar"><div class="top-bar-fill" style="width:${(Math.abs(v.v) / maxV) * 100}%;background:${colors[t]};"></div></div>
    </div>`,
      )
      .join(''),
  );
  // caixinha só aparece se houver "não refletir" (cancelados já viraram linha na lista)
  const elDesc = document.getElementById('flowsDescartados');
  if (elDesc) {
    if (descartados.length) {
      const valDesc = sumFm(descartados);
      replaceWithParsedMarkup(
        elDesc,
        `
        <div style="background:var(--bg-soft); border-left:3px solid var(--text-lighter); border-radius:6px; padding:8px 12px; display:flex; justify-content:space-between; align-items:center; font-size:11.5px; color:var(--text-medium);">
          <span>❌ <strong>Marcados como "Não refletir":</strong> ${descartados.length} aditivo(s)</span>
          <strong style="color:var(--text-soft);">${fmtR$(valDesc)}</strong>
        </div>
      `,
      );
    } else {
      elDesc.replaceChildren();
    }
  }

  // Motivos (só não cancelados)
  const byMot = {};
  active.forEach((f) => {
    const m = f.motivo || 'Não informado';
    if (!byMot[m]) byMot[m] = { n: 0, v: 0 };
    byMot[m].n += 1;
    byMot[m].v += f.custo_flowmaster || 0;
  });
  const motArr = Object.entries(byMot)
    .sort((a, b) => Math.abs(b[1].v) - Math.abs(a[1].v))
    .slice(0, 8);
  const maxM = Math.max(...motArr.map((m) => Math.abs(m[1].v)), 1);
  replaceWithParsedMarkup(
    document.getElementById('flowsByMotivo'),
    motArr
      .map(
        ([m, v]) => `
    <div class="top-item">
      <div class="name">${escHtml(m)} <span style="color:var(--text-soft);font-size:11px;">(${v.n})</span></div>
      <div class="val ${v.v < 0 ? 'pos' : 'neg'}">${v.v >= 0 ? '+' : ''}${fmtR$(v.v)}</div>
      <div class="top-bar"><div class="top-bar-fill ${v.v < 0 ? 'green' : ''}" style="width:${(Math.abs(v.v) / maxM) * 100}%;"></div></div>
    </div>`,
      )
      .join(''),
  );

  // Filtros multi-select: apenas atualizar labels dos botões (panel é renderizado on-demand)
  ['dep', 'tipo', 'motivo', 'solicitante', 'refletido', 'destino'].forEach((k) => msUpdateBtn(k));

  renderFlowTable();
}

function flowMatchesDate(f, ini, fim) {
  if (!ini && !fim) return true;
  // f.data_br pode ser dd/mm/yyyy ou serial Excel já convertido em data formatada
  const formatted = formatDate(f.data_br); // dd/mm/yyyy
  const m = formatted.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return true; // se não conseguir parsear, não filtra
  const yyyy_mm = `${m[3]}-${m[2]}`;
  if (ini && yyyy_mm < ini) return false;
  if (fim && yyyy_mm > fim) return false;
  return true;
}

function clearFlowFilters() {
  [
    'flowSearch',
    'flowFilterDataIni',
    'flowFilterDataFim',
    'flowFilterValMin',
    'flowFilterValMax',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  msResetAll();
  renderFlowTable();
}

function renderFlowTable() {
  bindFlowInteractions();
  const q = document.getElementById('flowSearch').value.toLowerCase();
  const fdi = document.getElementById('flowFilterDataIni')?.value || '';
  const fdf = document.getElementById('flowFilterDataFim')?.value || '';
  const fvmin = parseFloat(document.getElementById('flowFilterValMin')?.value);
  const fvmax = parseFloat(document.getElementById('flowFilterValMax')?.value);
  const editDisabled = isEditorDaObraAtiva() ? '' : ' disabled';

  const isRealVal = (v) =>
    v &&
    !['', '-', 'Não encontrado!', 'VERIFICAR'].includes(v) &&
    !String(v).toUpperCase().includes('VERIFICAR');

  const rows = getFlowsObraAtiva().filter((f) => {
    if (q) {
      const txt =
        `${f.descricao} ${f.justificativa} ${f.motivo} ${f.insumo_planejamento} ${f.insumo_remanejamento} ${f.solicitante || ''}`.toLowerCase();
      if (!txt.includes(q)) return false;
    }
    if (!msMatches('dep', f.dep)) return false;
    if (!msMatches('tipo', f.tipo)) return false;
    if (!msMatches('motivo', f.motivo)) return false;
    if (!msMatches('solicitante', f.solicitante)) return false;
    // Refletido: status do aditivo (precisa default 'pendente')
    const fStat = f.refletido_status || 'pendente';
    if (!msMatches('refletido', fStat)) return false;
    // Destino/Origem: precisa testar SE pelo menos uma das categorias marcadas bate
    // Esquema: para cada valor MS_DESTINO_OPTS, vejo se está selecionado E se este flow se enquadra.
    // Se não há nada excluído, passa. Se algum value tipo "com_destino" está EXCLUÍDO, e o flow tem destino, falha.
    const excludedDest = MS_EXCLUDED['destino'];
    if (excludedDest.size > 0) {
      const tags = {
        com_destino: isRealVal(f.insumo_planejamento),
        sem_destino: !isRealVal(f.insumo_planejamento),
        com_origem: isRealVal(f.insumo_remanejamento),
        sem_origem: !isRealVal(f.insumo_remanejamento),
      };
      // Se TODAS as tags ativas do flow estão excluídas, ele cai fora
      // Mais simples: se há qualquer tag ativa NÃO excluída → passa
      const algumPassa = Object.keys(tags).some((k) => tags[k] && !excludedDest.has(k));
      if (!algumPassa) return false;
    }
    if (!flowMatchesDate(f, fdi, fdf)) return false;
    const v = f.custo_flowmaster || 0;
    if (!isNaN(fvmin) && v < fvmin) return false;
    if (!isNaN(fvmax) && v > fvmax) return false;
    return true;
  });

  rows.sort((a, b) => {
    let va = a[sortKeyF],
      vb = b[sortKeyF];
    if (va == null) va = '';
    if (vb == null) vb = '';
    if (typeof va === 'string' && typeof vb === 'string') {
      if (sortKeyF === 'n_alteracao') return sortDirF * (parseInt(va) - parseInt(vb));
      return sortDirF * va.localeCompare(vb);
    }
    return sortDirF * (va - vb);
  });

  const tipoLabel = {
    aumento_real: '<span class="badge red">🔴 Aum.real</span>',
    remanejamento: '<span class="badge cyan">🔵 Remanej.</span>',
    economia: '<span class="badge green">🟢 Economia</span>',
    pendente: '<span class="badge amber">🟡 Pendente</span>',
    cancelado: '<span class="badge gray">🚫 Cancelado</span>',
    sem_classificacao: '<span class="badge gray">⚪ Sem class.</span>',
    misto: '<span class="badge gray">⚪ Misto</span>',
  };
  const depBadge = {
    Finalizado: 'green',
    Projeto: 'amber',
    Cancelado: 'gray',
    Planejamento: 'blue',
    Orçamento: 'blue',
    Obra: 'amber',
  };
  const flowPage = paginateRows(
    'flows',
    rows,
    JSON.stringify([
      q,
      fdi,
      fdf,
      Number.isNaN(fvmin) ? '' : fvmin,
      Number.isNaN(fvmax) ? '' : fvmax,
      sortKeyF,
      sortDirF,
      OBRA_ATIVA,
      ...Object.keys(MS_EXCLUDED)
        .sort()
        .map((key) => `${key}:${[...MS_EXCLUDED[key]].sort().join(',')}`),
    ]),
  );

  replaceWithParsedMarkup(
    document.getElementById('flowTbody'),
    flowPage.items
      .map((f) => {
        const valEdited = f._edited_v ? ' edited' : '';
        const valCls =
          (f.custo_flowmaster || 0) < 0 ? 'neg' : (f.custo_flowmaster || 0) > 0 ? 'pos' : '';
        const valStr = f.custo_flowmaster != null ? fmt(f.custo_flowmaster) : '';
        const manualBadge = f.is_manual ? '<span class="badge-manual">✋ Manual</span>' : '';
        const delBtn = f.is_manual
          ? `<button class="btn-del-manual" data-editor-only data-action="delete-manual" data-n="${escAttr(f.n_alteracao)}" title="Excluir este aditivo manual" aria-label="Excluir aditivo manual ${escAttr(f.n_alteracao)}">🗑️</button>`
          : '';
        const status = f.refletido_status || 'pendente';
        const trStyle =
          status === 'sim'
            ? 'background:var(--sem-ok-soft);'
            : status === 'nao'
              ? 'background:var(--sem-erro-soft);'
              : '';
        const isSelected = MASS_SELECTED.has(f.n_alteracao);
        return `
    <tr style="${trStyle}" class="${isSelected ? 'row-selected' : ''}" data-n="${escAttr(f.n_alteracao)}">
      <td style="text-align:center; vertical-align:middle;">
        <input type="checkbox" ${isSelected ? 'checked' : ''} data-edit-control${editDisabled} data-n="${escAttr(f.n_alteracao)}" data-change-action="toggleMassSelect" data-action-mode="self" style="cursor:pointer; transform:scale(1.15);">
      </td>
      <td style="vertical-align:middle; padding:6px;">
        <select class="refletido-select status-${escAttr(f.refletido_status || 'pendente')}" data-edit-control${editDisabled} data-n="${escAttr(f.n_alteracao)}" data-change-action="onRefletidoChange" data-action-mode="self" title="Status de reflexo no planejamento">
          <option value="pendente" ${(f.refletido_status || 'pendente') === 'pendente' ? 'selected' : ''}>⏳ Pendente</option>
          <option value="sim" ${f.refletido_status === 'sim' ? 'selected' : ''}>✅ Sim</option>
          <option value="nao" ${f.refletido_status === 'nao' ? 'selected' : ''}>❌ Não</option>
        </select>
      </td>
      <td>${escHtml(f.n_alteracao)}${manualBadge}${delBtn}</td>
      <td style="font-size:11px;color:var(--text-soft);">${escHtml(formatDate(f.data_br))}</td>
      <td><span class="badge ${depBadge[f.dep] || 'gray'}">${escHtml(f.dep || '')}</span></td>
      <td>${tipoLabel[f.tipo] || ''}</td>
      <td class="classif-cell">${renderInsumoSelect(f, 'insumo_planejamento')}</td>
      <td class="classif-cell">${renderInsumoSelect(f, 'insumo_remanejamento')}</td>
      <td class="classif-cell"><input type="text" class="valor-input ${valCls}${valEdited}" data-edit-control${editDisabled}
        value="${escAttr(valStr)}" data-n="${escAttr(f.n_alteracao)}"
        data-change-action="onValorChange" data-action-mode="self" data-select-on-focus
        title="Aceita valores como 1234,56 ou -1.234,56" placeholder="0,00"></td>
      <td style="font-size:11px;"><strong>${escHtml(f.motivo || '')}</strong><br><span style="color:var(--text-soft);">${escHtml((f.descricao || '').length > 110 ? (f.descricao || '').slice(0, 107) + '...' : f.descricao || '')}</span></td>
    </tr>`;
      })
      .join(''),
  );
  const refletidos = rows.filter((r) => (r.refletido_status || '') === 'sim').length;
  const naorefl = rows.filter((r) => (r.refletido_status || '') === 'nao').length;
  document.getElementById('flowCount').textContent =
    `${rows.length} aditivos · exibindo ${flowPage.start}–${flowPage.end} · ✅ ${refletidos} · ❌ ${naorefl} · Σ ${fmtR$(rows.reduce((s, f) => s + (f.custo_flowmaster || 0), 0))}`;
  renderPaginationControls('flowPagination', 'flows', flowPage, renderFlowTable);
  updateSortHeaderState('th[data-sort-flow]', 'data-sort-flow', sortKeyF, sortDirF);
  // Sincronizar checkbox header e barra de massa
  syncSelectAllHeader();
  updateMassBar();
}

// Handler do select de "refletido" (3 estados: pendente / sim / nao)
function onRefletidoChange(sel) {
  if (!requireEditorForActiveProject('alterar o status de reflexo')) {
    renderFlowTable();
    return;
  }
  const nAlt = sel.dataset.n;
  const status = sel.value; // 'pendente' | 'sim' | 'nao'
  const f = getFlowsObraAtiva().find((x) => x.n_alteracao === nAlt);
  if (!f) return;
  f.refletido_status = status;
  // manter campo legado 'refletido' = (status === 'sim') por compatibilidade
  f.refletido = status === 'sim';
  // chave composta + sync Supabase
  const codigoObra = f.codigo_obra || OBRA_ATIVA || '';
  const key = codigoObra + ':' + nAlt;
  const map = readClassificationMap();
  if (!map[key]) map[key] = { codigo_obra: codigoObra };
  map[key].refletido_status = status;
  map[key].refletido = status === 'sim'; // compat
  SafeStorage.set(STORAGE_KEY, JSON.stringify(map));
  void runAsyncSafely(
    supaPatchClassification(nAlt, { refletido_status: status }, codigoObra),
    'Classificações/salvar reflexo no Supabase',
    'O status foi salvo apenas neste navegador.',
  );
  // Atualizar visual: cor da linha e classe do select
  const tr = sel.closest('tr');
  if (tr)
    tr.style.background =
      status === 'sim' ? 'var(--sem-ok-soft)' : status === 'nao' ? 'var(--sem-erro-soft)' : '';
  sel.className = 'refletido-select status-' + status;
  renderFlowTable();
  // Sincronizar TODAS as telas (Visão Geral, Tendência de Obra, Controle Projeção)
  syncAllViewsFromFlows();
}

export function installLegacyFlowsView(target = window) {
  Object.assign(target, {
    renderFlows,
    clearFlowFilters,
    renderFlowTable,
    onRefletidoChange,
  });
}
