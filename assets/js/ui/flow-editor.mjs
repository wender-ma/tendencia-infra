/* eslint-disable no-undef */
import { replaceWithParsedMarkup } from './dom.mjs';

function showManualText(key) {
  const text = MANUAL_TEXT[key];
  if (!text) return;
  replaceWithParsedMarkup(
    document.getElementById('modalContent'),
    `
    <h2>ℹ️ Como exportar</h2>
    <div style="white-space: pre-wrap; font-size: 13px; line-height: 1.6; color: var(--text-medium); margin-top: 12px;">${escHtml(text)}</div>
    <div style="margin-top: 16px; text-align: right;">
      <button class="btn-sm" data-click-action="closeModal">Fechar</button>
    </div>
  `,
  );
  openModal();
}

// ============ EDIÇÃO DE CLASSIFICAÇÃO ============
// (declarado em CONFIG no topo)

// Opções especiais (aparecem no topo do dropdown)
const SPECIAL_OPTIONS = [
  { value: '', label: '— (em branco)' },
  { value: '-', label: '— Não se aplica (-)' },
  { value: 'Aumento de obra', label: '🆕 Aumento de obra' },
  { value: 'Cancelado', label: '🚫 Cancelado' },
  { value: 'Não encontrado!', label: '❓ Não encontrado!' },
  { value: 'VERIFICAR QUANDO SERVIÇO FOR CONTRATADO', label: '⏳ Verificar quando contratar' },
];
const SPECIAL_VALUES_SET = new Set(SPECIAL_OPTIONS.map((o) => o.value));

// Carrega edições salvas (se houver) e aplica em DATA_F
function loadClassifications() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const map = JSON.parse(raw);
    let n = 0;
    // aplica em TODO DATA_F (não só obra ativa). Chave é "codigo_obra:n_alteracao"
    // Compat: aceita também chave só com n_alteracao (legado)
    const _DATA_F_ALL = Array.isArray(DATA_F) ? DATA_F : [];
    _DATA_F_ALL.forEach((f) => {
      const keyComObra = (f.codigo_obra || '') + ':' + f.n_alteracao;
      const keyLegacy = f.n_alteracao;
      const entry = map[keyComObra] || map[keyLegacy];
      if (entry) {
        if (entry.insumo_planejamento !== undefined) {
          f.insumo_planejamento = entry.insumo_planejamento;
          f._edited_p = true;
        }
        if (entry.insumo_remanejamento !== undefined) {
          f.insumo_remanejamento = entry.insumo_remanejamento;
          f._edited_r = true;
        }
        if (entry.custo_flowmaster !== undefined) {
          f.custo_flowmaster = entry.custo_flowmaster;
          f._edited_v = true;
        }
        if (entry.refletido_status !== undefined) {
          f.refletido_status = entry.refletido_status;
          f.refletido = entry.refletido_status === 'sim';
        } else if (entry.refletido !== undefined) {
          // compat com versões antigas (só checkbox)
          f.refletido = entry.refletido;
          f.refletido_status = entry.refletido ? 'sim' : 'pendente';
        }
        f.tipo = classifyFlow(f.insumo_planejamento, f.insumo_remanejamento);
        n++;
      }
    });
    return n;
  } catch (e) {
    console.warn('Erro ao carregar classificações:', e);
    return 0;
  }
}

function readClassificationMap() {
  try {
    const parsed = JSON.parse(SafeStorage.get(STORAGE_KEY, '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    reportNonFatalError(
      'Classificações/estado local inválido',
      error,
      'As classificações locais não puderam ser lidas.',
    );
    return {};
  }
}

function saveClassification(nAlt, field, value) {
  if (!requireEditor('classificar aditivos')) return false;
  // acha o aditivo no DATA_F pra pegar codigo_obra e montar chave composta
  const f = (Array.isArray(DATA_F) ? DATA_F : []).find((x) => x.n_alteracao === nAlt);
  const codigoObra = f?.codigo_obra || OBRA_ATIVA || '';
  const key = codigoObra + ':' + nAlt;
  const map = readClassificationMap();
  if (!map[key]) map[key] = { codigo_obra: codigoObra };
  map[key][field] = value;
  SafeStorage.set(STORAGE_KEY, JSON.stringify(map));
  // Espelhar no Supabase
  void runAsyncSafely(
    supaPatchClassification(nAlt, { [field]: value }, codigoObra),
    'Classificações/salvar no Supabase',
    'A classificação foi salva apenas neste navegador.',
  );
  return true;
}

async function clearClassifications() {
  const confirmed = await confirmModal(
    'Limpar alterações?',
    'Deseja apagar todas as alterações de classificação salvas neste navegador?\nOs aditivos manuais NÃO serão afetados.\nAs alterações exportadas em CSV também não serão afetadas.',
    { confirmText: 'Limpar', destructive: true },
  );
  if (!confirmed) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}

function reloadClassifications() {
  const n = loadClassifications();
  buildLinks();
  // Usar debounce para evitar múltiplas renderizações
  debouncedRender();
  authToast(`✅ ${n} aditivo(s) com classificação salva foram recarregados.`, 'ok', 3000);
}

function exportClassifications() {
  const map = readClassificationMap();
  const keys = Object.keys(map);
  if (keys.length === 0) {
    authToast('⚠️ Nenhuma alteração para exportar.', 'warn', 3000);
    return;
  }
  // CSV: Nº Alteração; Nº ADT; Insumo Planejamento (novo); Insumo Remanejamento (novo); Tipo classificado
  // Inclui edições + manuais
  const manuals = loadManuals();
  const allKeys = new Set([...keys, ...manuals.map((m) => m.n_alteracao)]);
  if (allKeys.size === 0) {
    authToast('⚠️ Nenhuma alteração ou aditivo manual para exportar.', 'warn', 3000);
    return;
  }
  const lines = [
    'Origem;Nº Alteração;Departamento;Data;Descrição;Motivo;INSUMO PLANEJAMENTO;INSUMO DE REMANEJAMENTO;Fluxo Planejamento (R$);Tipo (calculado);Refletido (PENDENTE/SIM/NAO);Justificativa;Data exportação',
  ];
  const now = new Date().toLocaleString('pt-BR');
  allKeys.forEach((k) => {
    const f = getFlowsObraAtiva().find((x) => x.n_alteracao === k);
    if (!f) return;
    const edit = map[k] || {};
    const ip =
      edit.insumo_planejamento !== undefined ? edit.insumo_planejamento : f.insumo_planejamento;
    const ir =
      edit.insumo_remanejamento !== undefined ? edit.insumo_remanejamento : f.insumo_remanejamento;
    const val = edit.custo_flowmaster !== undefined ? edit.custo_flowmaster : f.custo_flowmaster;
    const tipo = classifyFlow(ip, ir);
    const csvEsc = (s) =>
      `"${String(s == null ? '' : s)
        .replace(/"/g, '""')
        .replace(/\r?\n/g, ' ')}"`;
    const fmtVal = val == null ? '' : String(val).replace('.', ',');
    const refStatus =
      edit.refletido_status !== undefined
        ? edit.refletido_status
        : f.refletido_status || 'pendente';
    const refLabel = refStatus === 'sim' ? 'SIM' : refStatus === 'nao' ? 'NAO' : 'PENDENTE';
    lines.push(
      [
        f.is_manual ? 'Manual' : 'Sistema',
        f.n_alteracao,
        csvEsc(f.dep),
        csvEsc(f.data_br),
        csvEsc(f.descricao),
        csvEsc(f.motivo),
        csvEsc(ip),
        csvEsc(ir),
        fmtVal,
        tipo,
        refLabel,
        csvEsc(f.justificativa),
        now,
      ].join(';'),
    );
  });
  const csv = '\ufeff' + lines.join('\n'); // BOM p/ Excel abrir certo
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `classificacoes_flows_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Lista ordenada de insumos da tendência (Ixxx — Nome)
function buildInsumosList() {
  const map = new Map();
  DATA_T.forEach((t) => {
    if (t.is_folha && t.cod_insumo && !SPECIAL_VALUES_SET.has(t.cod_insumo)) {
      if (!map.has(t.cod_insumo)) map.set(t.cod_insumo, t.item);
    }
  });
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
let INSUMOS_OPTIONS = [];

// Renderiza um <input> com autocomplete (datalist) — leve e rápido
function renderInsumoSelect(f, field) {
  const value = f[field] || '';
  const edited = field === 'insumo_planejamento' ? f._edited_p : f._edited_r;
  const isSpecial = SPECIAL_VALUES_SET.has(value);
  // valor "amigável" para exibição: se for insumo da tendência, mostra "Ixxx — Nome"
  const displayValue = displayForValue(value);
  const cls = 'classif-select' + (edited ? ' edited' : '') + (isSpecial ? ' special' : '');
  const disabled = isEditorDaObraAtiva() ? '' : ' disabled';
  // removido marker ✏️ — fundo amarelo já sinaliza edição
  return `<input type="text" list="insumosDatalist" class="${cls}" data-edit-control${disabled}
    value="${escAttr(displayValue)}"
    data-n="${escAttr(f.n_alteracao)}" data-field="${field}"
    data-rawvalue="${escAttr(value)}"
    data-change-action="onClassifChange" data-action-mode="self"
    data-select-on-focus
    title="${escAttr(value)}"
    placeholder="digite p/ buscar...">`;
}

// Converte um value "puro" no rótulo bonito (Ixxx — Nome) usado no input
function displayForValue(value) {
  if (!value) return '';
  if (SPECIAL_VALUES_SET.has(value)) {
    const o = SPECIAL_OPTIONS.find((x) => x.value === value);
    return o ? o.label : value;
  }
  const ins = INSUMOS_OPTIONS.find(([cod]) => cod === value);
  if (ins) return `${ins[0]} — ${ins[1]}`;
  return value;
}

// Converte o que o usuário DIGITOU no datalist de volta para o "value puro"
function valueFromDisplay(text) {
  text = (text || '').trim();
  if (!text) return '';
  // Match exato de label de especial
  const sp = SPECIAL_OPTIONS.find((o) => o.label === text || o.value === text);
  if (sp) return sp.value;
  // Match "Ixxx — Nome" → pega só o código
  const m = text.match(/^([A-Z]+\d+)\s*(?:—|-).*/);
  if (m) {
    const cod = m[1];
    if (INSUMOS_OPTIONS.some(([c]) => c === cod)) return cod;
  }
  // Talvez digitou só o código
  if (INSUMOS_OPTIONS.some(([c]) => c === text)) return text;
  // Talvez digitou só o NOME do item — tenta achar
  const byName = INSUMOS_OPTIONS.find(([, n]) => n.toLowerCase() === text.toLowerCase());
  if (byName) return byName[0];
  // Caso contrário, devolve o texto livre (vai aparecer com ⚠️ depois)
  return text;
}

// Cria/atualiza o datalist global UMA vez (compartilhado por todos os inputs)
function buildDatalist() {
  let dl = document.getElementById('insumosDatalist');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'insumosDatalist';
    document.body.appendChild(dl);
  }
  const specials = SPECIAL_OPTIONS.map((o) => `<option value="${escAttr(o.label)}">`).join('');
  const insumos = INSUMOS_OPTIONS.map(
    ([cod, nome]) => `<option value="${escAttr(cod + ' — ' + nome)}">`,
  ).join('');
  replaceWithParsedMarkup(dl, specials + insumos);
  // log discreto
  if (INSUMOS_OPTIONS.length > 0) {
    console.log(
      `[DATALIST] ${INSUMOS_OPTIONS.length} insumos disponíveis no dropdown de classificação (${OBRA_ATIVA || '—'})`,
    );
  }
}

// Converte data — aceita 'dd/mm/yyyy' OU número serial Excel (ex: 46147 = 26/05/2026)
function formatDate(s) {
  if (!s) return '';
  s = String(s).trim();
  // Já está em formato dd/mm/yyyy → retorna
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) return s.split(' ')[0];
  // Número serial Excel (data: 30/12/1899 + N dias)
  if (/^\d{4,6}$/.test(s)) {
    const n = parseInt(s, 10);
    // Sanidade: 25569 = 1970-01-01; 60000 ~ 2064. Aceitar 20000-60000
    if (n > 20000 && n < 80000) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + n * 86400000);
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const yy = d.getUTCFullYear();
      return `${dd}/${mm}/${yy}`;
    }
  }
  // Formato ISO yyyy-mm-dd — valida mês (1-12) e dia (1-31)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const mes = parseInt(iso[2], 10);
    const dia = parseInt(iso[3], 10);
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      return `${iso[3]}/${iso[2]}/${iso[1]}`;
    }
  }
  return s;
}

function escHtml(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
function escAttr(s) {
  return escHtml(s);
}

// ============ TOOLTIP SYSTEM (gráficos) ============
function showTooltip(evt, html) {
  const tt = document.getElementById('chartTooltip');
  if (!tt) return;
  replaceWithParsedMarkup(tt, html);
  tt.setAttribute('aria-hidden', 'false');
  tt.classList.add('show');
  positionTooltip(evt, tt);
}
function hideTooltip() {
  const tt = document.getElementById('chartTooltip');
  if (tt) {
    tt.classList.remove('show');
    tt.setAttribute('aria-hidden', 'true');
  }
}
function positionTooltip(evt, tt) {
  if (!tt) tt = document.getElementById('chartTooltip');
  const pad = 14;
  let x = evt.clientX + pad,
    y = evt.clientY + pad;
  // Forçar render para medir
  tt.style.left = '-9999px';
  tt.style.top = '-9999px';
  const rect = tt.getBoundingClientRect();
  if (x + rect.width > window.innerWidth - pad) x = evt.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - pad) y = evt.clientY - rect.height - pad;
  if (x < pad) x = pad;
  if (y < pad) y = pad;
  tt.style.left = x + 'px';
  tt.style.top = y + 'px';
}
// Helper para linha de tooltip formatada
function ttRow(label, val) {
  return `<div class="tt-row"><span class="tt-label">${label}</span><span class="tt-val">${val}</span></div>`;
}
function ttDiv() {
  return '<div class="tt-divider"></div>';
}

// Helper: re-renderizar TODAS as visões que dependem de DATA_F (refletido, classificação, valor, manuais)
// Chamado sempre que algo nos Flows muda, para garantir que Visão Geral, Tendência de Obra e Controle Projeção atualizem
// OTIMIZADO: usa debounce para evitar múltiplas renderizações em sequência
function syncAllViewsFromFlows() {
  try {
    if (typeof buildLinks === 'function') buildLinks();
  } catch (e) {
    reportNonFatalError('Flows/recalcular vínculos', e);
  }
  // Usa debounce para as renderizações mais pesadas
  debouncedRender('visao');
  try {
    if (typeof renderFlowsAggregates === 'function') renderFlowsAggregates();
  } catch (e) {
    reportNonFatalError('Flows/renderizar agregados', e);
  }
  try {
    if (typeof updateEditCount === 'function') updateEditCount();
  } catch (e) {
    reportNonFatalError('Flows/atualizar contador', e);
  }
}

function onClassifChange(sel) {
  if (!requireEditorForActiveProject('classificar aditivos')) {
    renderFlowTable();
    return;
  }
  const nAlt = sel.dataset.n;
  const field = sel.dataset.field;
  const value = valueFromDisplay(sel.value);
  const f = getFlowsObraAtiva().find((x) => x.n_alteracao === nAlt);
  if (!f) return;
  // Atualiza o input para o display canônico (caso usuário tenha digitado parcial)
  sel.value = displayForValue(value);
  sel.dataset.rawvalue = value;
  f[field] = value;
  if (field === 'insumo_planejamento') f._edited_p = true;
  else f._edited_r = true;
  f.tipo = classifyFlow(f.insumo_planejamento, f.insumo_remanejamento);
  saveClassification(nAlt, field, value);
  // Recalcular ligações + atualizar TODAS as telas dependentes
  syncAllViewsFromFlows();
  // Atualiza apenas a linha desta tr (badge de tipo + estilo do select)
  const tr = sel.closest('tr');
  if (tr) {
    // Atualiza o badge de tipo (6ª <td> = índice 5)
    // Ordem: 0=checkbox 1=refletido 2=Nº 3=Data 4=Departamento 5=Tipo 6=Destino ...
    const tipoLabel = {
      aumento_real: '<span class="badge red">🔴 Aum.real</span>',
      remanejamento: '<span class="badge cyan">🔵 Remanej.</span>',
      economia: '<span class="badge green">🟢 Economia</span>',
      pendente: '<span class="badge amber">🟡 Pendente</span>',
      cancelado: '<span class="badge gray">🚫 Cancelado</span>',
      sem_classificacao: '<span class="badge gray">⚪ Sem class.</span>',
      misto: '<span class="badge gray">⚪ Misto</span>',
    };
    const tipoTd = tr.children[5];
    if (tipoTd) tipoTd.textContent = tipoLabel[f.tipo] || '';
    // marca só o input (fundo amarelo do CSS já sinaliza)
    sel.classList.add('edited');
  }
}

function updateEditCount() {
  const map = readClassificationMap();
  const n = Object.keys(map).length;
  const m = loadManuals().length;
  const el = document.getElementById('editCount');
  if (!el) return;
  const parts = [];
  if (n > 0) parts.push(`<span class="badge purple">✏️ ${n} editado(s)</span>`);
  if (m > 0) parts.push(`<span class="badge-manual">✋ ${m} manual(is)</span>`);
  replaceWithParsedMarkup(
    el,
    parts.length
      ? parts.join(' ') + ' <span style="color:var(--text-soft);">— não esqueça de exportar</span>'
      : '',
  );
}

// Helper: re-renderiza só os agregados da aba flows (cards e gráficos), preservando a tabela
function renderFlowsAggregates() {
  const total = getFlowsObraAtiva().length;
  const byDep = {};
  getFlowsObraAtiva().forEach((f) => {
    byDep[f.dep] = (byDep[f.dep] || 0) + 1;
  });
  const sumFm = (arr) => arr.reduce((s, f) => s + (f.custo_flowmaster || 0), 0);
  // "Vivos" = não cancelados E não marcados como ❌ Não refletir
  // Cancelado agora é uma classificação própria (some pelo dep OU pelo tipo)
  const isCancelado = (f) => f.dep === 'Cancelado' || f.tipo === 'cancelado';
  const isNaoRefletir = (f) => !isCancelado(f) && f.refletido_status === 'nao';
  // Vivos = os que impactam a obra (não cancelados, não marcados como não refletir)
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
  // Cancelado vira LINHA da lista (com contador e valor), não caixa separada
  const cancelados = getFlowsObraAtiva().filter(isCancelado);
  if (cancelados.length) {
    tipoSums['cancelado'] = { n: cancelados.length, v: sumFm(cancelados) };
  }
  // Ainda mantemos "não refletir" à parte (é decisão separada, não é cancelamento)
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
}

// ============ MULTI-SELECT (filtros estilo Excel) ============
// Estado: por chave, conjunto de valores EXCLUÍDOS (vazio = todos selecionados)
const MS_EXCLUDED = {
  dep: new Set(),
  tipo: new Set(),
  motivo: new Set(),
  solicitante: new Set(),
  refletido: new Set(),
  destino: new Set(),
};
const MS_TIPO_OPTS = [
  { v: 'aumento_real', l: '🔴 Aumento real' },
  { v: 'remanejamento', l: '🔵 Remanejamento' },
  { v: 'economia', l: '🟢 Economia' },
  { v: 'pendente', l: '🟡 Pendente' },
  { v: 'sem_classificacao', l: '⚪ Sem classificação' },
  { v: 'misto', l: '⚪ Misto' },
];
const MS_REFLETIDO_OPTS = [
  { v: 'pendente', l: '⏳ Pendente' },
  { v: 'sim', l: '✅ Sim - refletido' },
  { v: 'nao', l: '❌ Não - não refletir' },
];
const MS_DESTINO_OPTS = [
  { v: 'com_destino', l: '✓ Com destino' },
  { v: 'sem_destino', l: '✗ Sem destino' },
  { v: 'com_origem', l: '✓ Com origem' },
  { v: 'sem_origem', l: '✗ Sem origem' },
];

// Pega todos os valores possíveis para uma chave a partir dos dados
function msGetAllValues(key) {
  if (key === 'tipo') return MS_TIPO_OPTS.map((o) => o.v);
  if (key === 'refletido') return MS_REFLETIDO_OPTS.map((o) => o.v);
  if (key === 'destino') return MS_DESTINO_OPTS.map((o) => o.v);
  if (!getFlowsObraAtiva() || !getFlowsObraAtiva().length) return [];
  const field = key === 'solicitante' ? 'solicitante' : key;
  return [
    ...new Set(
      getFlowsObraAtiva()
        .map((f) => f[field])
        .filter((v) => v != null && v !== ''),
    ),
  ].sort();
}

function msLabelFor(key, value) {
  if (key === 'tipo') {
    const o = MS_TIPO_OPTS.find((x) => x.v === value);
    return o ? o.l : value;
  }
  if (key === 'refletido') {
    const o = MS_REFLETIDO_OPTS.find((x) => x.v === value);
    return o ? o.l : value;
  }
  if (key === 'destino') {
    const o = MS_DESTINO_OPTS.find((x) => x.v === value);
    return o ? o.l : value;
  }
  return value;
}

function msToggle(key) {
  const all = document.querySelectorAll('.ms-panel.open');
  all.forEach((p) => {
    if (p.id !== `ms_${key}_panel`) p.classList.remove('open');
  });
  const panel = document.getElementById(`ms_${key}_panel`);
  if (!panel) return;
  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    return;
  }
  msRenderPanel(key);
  panel.classList.add('open');
}

function closeMultiSelectOnOutsideClick(event) {
  if (!event.target.closest('.ms-wrap')) {
    document.querySelectorAll('.ms-panel.open').forEach((p) => p.classList.remove('open'));
  }
}

function msRenderPanel(key) {
  const panel = document.getElementById(`ms_${key}_panel`);
  if (!panel) return;
  const allValues = msGetAllValues(key);
  // contagem por valor nos dados
  const counts = {};
  if (key === 'refletido') {
    getFlowsObraAtiva().forEach((f) => {
      const v = f.refletido_status || 'pendente';
      counts[v] = (counts[v] || 0) + 1;
    });
  } else if (key === 'destino') {
    const isReal = (v) =>
      v &&
      !['', '-', 'Não encontrado!', 'VERIFICAR'].includes(v) &&
      !String(v).toUpperCase().includes('VERIFICAR');
    getFlowsObraAtiva().forEach((f) => {
      if (isReal(f.insumo_planejamento)) counts['com_destino'] = (counts['com_destino'] || 0) + 1;
      else counts['sem_destino'] = (counts['sem_destino'] || 0) + 1;
      if (isReal(f.insumo_remanejamento)) counts['com_origem'] = (counts['com_origem'] || 0) + 1;
      else counts['sem_origem'] = (counts['sem_origem'] || 0) + 1;
    });
  } else {
    const field = key === 'solicitante' ? 'solicitante' : key;
    getFlowsObraAtiva().forEach((f) => {
      const v = f[field];
      if (v != null && v !== '') counts[v] = (counts[v] || 0) + 1;
    });
  }

  const html = `
    <input type="text" class="ms-search" placeholder="🔍 buscar..." data-input-action="msFilterOpts" data-action-mode="arg-value" data-action-arg="${key}">
    <div class="ms-actions">
      <button type="button" data-click-action="msSelectAll" data-action-mode="arg-bool" data-action-arg="${key}" data-action-value="true">Marcar todos</button>
      <button type="button" data-click-action="msSelectAll" data-action-mode="arg-bool" data-action-arg="${key}" data-action-value="false">Desmarcar todos</button>
      <button type="button" data-click-action="msInvert" data-action-mode="arg" data-action-arg="${key}">Inverter</button>
    </div>
    <div class="ms-list" id="ms_${key}_list">
      ${allValues
        .map((v) => {
          const checked = !MS_EXCLUDED[key].has(v);
          const label = msLabelFor(key, v);
          const c = counts[v] || 0;
          return `<label class="ms-opt" data-search="${escAttr(String(label).toLowerCase())}">
          <input type="checkbox" ${checked ? 'checked' : ''} data-ms-value="${escAttr(String(v))}">
          <span>${escHtml(label)}</span>
          <span class="ms-count">${c}</span>
        </label>`;
        })
        .join('')}
    </div>
    <div class="ms-footer">
      <span><span id="ms_${key}_status"></span></span>
      <button type="button" data-click-action="msClose" data-action-mode="arg" data-action-arg="${key}">Aplicar ✓</button>
    </div>
  `;
  replaceWithParsedMarkup(panel, html);
  panel.querySelectorAll('input[data-ms-value]').forEach((input) => {
    input.addEventListener('change', () => {
      msOnCheck(key, input.dataset.msValue, input.checked);
    });
  });
  msUpdateStatus(key);
}

function msFilterOpts(key, term) {
  const t = (term || '').toLowerCase();
  const opts = document.querySelectorAll(`#ms_${key}_list .ms-opt`);
  opts.forEach((o) => {
    const txt = o.dataset.search || '';
    o.style.display = txt.includes(t) ? '' : 'none';
  });
}

function msSelectAll(key, marcar) {
  const allValues = msGetAllValues(key);
  if (marcar) MS_EXCLUDED[key].clear();
  else allValues.forEach((v) => MS_EXCLUDED[key].add(v));
  // atualizar checkboxes
  document
    .querySelectorAll(`#ms_${key}_list input[type=checkbox]`)
    .forEach((cb) => (cb.checked = marcar));
  msUpdateStatus(key);
  msUpdateBtn(key);
  renderFlowTable();
}

function msInvert(key) {
  const allValues = msGetAllValues(key);
  const newSet = new Set(allValues.filter((v) => !MS_EXCLUDED[key].has(v)));
  MS_EXCLUDED[key] = newSet;
  msRenderPanel(key);
  msUpdateBtn(key);
  renderFlowTable();
}

function msOnCheck(key, value, checked) {
  if (checked) MS_EXCLUDED[key].delete(value);
  else MS_EXCLUDED[key].add(value);
  msUpdateStatus(key);
  msUpdateBtn(key);
  renderFlowTable();
}

function msUpdateStatus(key) {
  const allValues = msGetAllValues(key);
  const excluded = MS_EXCLUDED[key].size;
  const selected = allValues.length - excluded;
  const el = document.getElementById(`ms_${key}_status`);
  if (el) el.textContent = `${selected} de ${allValues.length} marcados`;
}

function msClose(key) {
  const p = document.getElementById(`ms_${key}_panel`);
  if (p) p.classList.remove('open');
}

function msUpdateBtn(key) {
  const btn = document.getElementById(`ms_${key}_btn`);
  if (!btn) return;
  const allValues = msGetAllValues(key);
  const excluded = MS_EXCLUDED[key].size;
  const totalSelected = allValues.length - excluded;
  const baseLabels = {
    dep: 'departamentos',
    tipo: 'tipos',
    motivo: 'motivos',
    solicitante: 'solicitantes',
    refletido: 'status',
    destino: 'tipos destino/origem',
  };
  if (excluded === 0) {
    btn.textContent = `Todos ${baseLabels[key]}`;
    btn.classList.remove('has-filter');
  } else if (totalSelected === 0) {
    btn.textContent = `Nenhum ${baseLabels[key].slice(0, -1)}`;
    btn.classList.add('has-filter');
  } else if (totalSelected === 1) {
    // Mostra o único valor selecionado
    const onlySel = allValues.find((v) => !MS_EXCLUDED[key].has(v));
    btn.textContent = msLabelFor(key, onlySel);
    btn.classList.add('has-filter');
  } else {
    btn.textContent = `${totalSelected} de ${allValues.length} ${baseLabels[key]}`;
    btn.classList.add('has-filter');
  }
}

function msMatches(key, value) {
  // valor passa pelo filtro se NÃO estiver no conjunto de excluídos
  if (value == null || value === '') {
    // valores vazios: passam apenas se não houver exclusões
    return MS_EXCLUDED[key].size === 0;
  }
  return !MS_EXCLUDED[key].has(value);
}

function msResetAll() {
  Object.keys(MS_EXCLUDED).forEach((k) => MS_EXCLUDED[k].clear());
  Object.keys(MS_EXCLUDED).forEach((k) => msUpdateBtn(k));
}

// ============ SELEÇÃO E AÇÕES EM MASSA ============
const MASS_SELECTED = new Set();

function toggleMassSelect(cb) {
  const n = cb.dataset.n;
  if (cb.checked) MASS_SELECTED.add(n);
  else MASS_SELECTED.delete(n);
  // Visual: marcar linha
  const tr = cb.closest('tr');
  if (tr) tr.classList.toggle('row-selected', cb.checked);
  updateMassBar();
  // Sincronizar checkbox header
  syncSelectAllHeader();
}

function toggleSelectAllVisible(cb) {
  const checkboxes = document.querySelectorAll('#flowTbody input[type="checkbox"][data-n]');
  checkboxes.forEach((c) => {
    c.checked = cb.checked;
    const n = c.dataset.n;
    if (cb.checked) MASS_SELECTED.add(n);
    else MASS_SELECTED.delete(n);
    const tr = c.closest('tr');
    if (tr) tr.classList.toggle('row-selected', cb.checked);
  });
  updateMassBar();
}

function syncSelectAllHeader() {
  const head = document.getElementById('flowSelectAll');
  if (!head) return;
  const checkboxes = document.querySelectorAll('#flowTbody input[type="checkbox"][data-n]');
  const total = checkboxes.length;
  const checked = [...checkboxes].filter((c) => c.checked).length;
  head.checked = total > 0 && checked === total;
  head.indeterminate = checked > 0 && checked < total;
}

function clearMassSelection() {
  MASS_SELECTED.clear();
  document
    .querySelectorAll('#flowTbody input[type="checkbox"][data-n]')
    .forEach((c) => (c.checked = false));
  document.querySelectorAll('#flowTbody tr').forEach((tr) => tr.classList.remove('row-selected'));
  const head = document.getElementById('flowSelectAll');
  if (head) {
    head.checked = false;
    head.indeterminate = false;
  }
  updateMassBar();
}

function updateMassBar() {
  const bar = document.getElementById('massBar');
  if (!bar) return;
  if (!isEditorDaObraAtiva()) {
    MASS_SELECTED.clear();
    bar.style.display = 'none';
    bar.replaceChildren();
    return;
  }
  const n = MASS_SELECTED.size;
  if (n === 0) {
    bar.style.display = 'none';
    bar.replaceChildren();
    return;
  }
  // Soma dos valores selecionados
  const selFlows = [...MASS_SELECTED]
    .map((nAlt) => getFlowsObraAtiva().find((f) => f.n_alteracao === nAlt))
    .filter(Boolean);
  const totVal = selFlows.reduce((s, f) => s + (f.custo_flowmaster || 0), 0);
  bar.style.display = 'flex';
  bar.className = 'mass-bar';
  replaceWithParsedMarkup(
    bar,
    `
    <strong>☑️ ${n} aditivo${n > 1 ? 's' : ''} selecionado${n > 1 ? 's' : ''}</strong>
    <span style="opacity:0.85; font-size:12px;">· Σ ${fmtR$(totVal)}</span>
    <span style="margin-left:auto;"></span>
    <button class="btn-mass" data-click-action="massAplicarDestino" title="Aplica o mesmo INSUMO PLANEJAMENTO em todos os selecionados">🎯 Aplicar Destino</button>
    <button class="btn-mass" data-click-action="massAplicarOrigem" title="Aplica o mesmo INSUMO REMANEJAMENTO em todos os selecionados">🔄 Aplicar Origem</button>
    <button class="btn-mass" data-click-action="massAplicarRefletido" title="Marca todos com o mesmo status de reflexo">✅ Marcar Refletido</button>
    <button class="btn-mass danger" data-click-action="clearMassSelection">🗑️ Limpar seleção</button>
  `,
  );
}

// Modal genérico de aplicação em massa
function massPrompt(titulo, descricao, opcoesHtml, callback) {
  const html = `
    <form data-modal-form="mass">
    <h2>${titulo}</h2>
    <div class="meta" style="margin-bottom: 14px;">${descricao}</div>
    <div class="form-grid">
      ${opcoesHtml}
    </div>
    <div class="form-actions">
      <button type="button" class="btn-sm" data-click-action="closeModal">Cancelar</button>
      <button type="submit" class="btn-sm primary" data-action="mass-confirm">✓ Aplicar a ${MASS_SELECTED.size} aditivo(s)</button>
    </div>
    </form>
  `;
  window._massCallback = callback;
  window.massConfirmCallback = () => {
    try {
      window._massCallback();
      closeModal();
      renderFlowTable();
      renderFlows();
      // Sincronizar TODAS as telas (Visão Geral, Tendência de Obra, Controle Projeção)
      syncAllViewsFromFlows();
    } catch (e) {
      authToast('❌ Erro: ' + e.message, 'err', 5000);
    }
  };
  replaceWithParsedMarkup(document.getElementById('modalContent'), html);
  openModal({ initialFocus: 'input, select, textarea' });
}

// Limita a concorrência para não saturar a API durante edições em massa.
async function supaBulkUpsertClassifications(payloads) {
  if (!isEditorDaObraAtiva() || !SUPA || !payloads.length) return;
  if (payloads.some((item) => item.codigo_obra !== OBRA_ATIVA)) return;
  const batchSize = 12;
  for (let i = 0; i < payloads.length; i += batchSize) {
    const batch = payloads.slice(i, i + batchSize);
    await Promise.all(
      batch.map(({ codigo_obra, n_alteracao, updated_at: _updated_at, ...patch }) =>
        supaPatchClassification(n_alteracao, patch, codigo_obra),
      ),
    );
  }
}

function massAplicarDestino() {
  if (!requireEditorForActiveProject('classificar aditivos em massa')) return;
  const opt = `
    <div class="full">
      <label for="massDestInput">INSUMO PLANEJAMENTO (destino) a aplicar em ${MASS_SELECTED.size} aditivo(s):</label>
      <input type="text" id="massDestInput" list="insumosDatalist" placeholder="digite p/ buscar..." style="width:100%; padding:8px 10px; border:1px solid var(--border-strong); border-radius:6px; font-size:13px;">
      <div style="font-size:11px; color:var(--text-soft); margin-top:4px;">Aceita opções especiais (Aumento de obra, Não encontrado!, etc.) e os 125 insumos da tendência</div>
    </div>
  `;
  massPrompt(
    '🎯 Aplicar Destino em massa',
    `Substitui o campo INSUMO PLANEJAMENTO em <strong>${MASS_SELECTED.size}</strong> aditivo(s) selecionado(s).`,
    opt,
    () => {
      const novo = valueFromDisplay(document.getElementById('massDestInput').value);
      if (novo === null || novo === undefined) throw new Error('Valor inválido');
      // localStorage lido UMA vez antes do loop
      const map = readClassificationMap();
      const bulkPayloads = [];
      MASS_SELECTED.forEach((nAlt) => {
        const f = getFlowsObraAtiva().find((x) => x.n_alteracao === nAlt);
        if (!f) return;
        f.insumo_planejamento = novo;
        f._edited_p = true;
        f.tipo = classifyFlow(f.insumo_planejamento, f.insumo_remanejamento);
        const codigoObra = f.codigo_obra || OBRA_ATIVA || '';
        const key = codigoObra + ':' + nAlt;
        if (!map[key]) map[key] = { codigo_obra: codigoObra };
        map[key].insumo_planejamento = novo;
        bulkPayloads.push({
          codigo_obra: codigoObra,
          n_alteracao: nAlt,
          insumo_planejamento: novo,
          updated_at: new Date().toISOString(),
        });
      });
      // Escrita no localStorage UMA vez após o loop
      SafeStorage.set(STORAGE_KEY, JSON.stringify(map));
      // Supabase bulk (1 requisição em vez de N)
      void runAsyncSafely(
        supaBulkUpsertClassifications(bulkPayloads),
        'Classificações/destino em massa',
        'As alterações em massa foram salvas apenas neste navegador.',
      );
      buildLinks();
    },
  );
}

function massAplicarOrigem() {
  if (!requireEditorForActiveProject('classificar aditivos em massa')) return;
  const opt = `
    <div class="full">
      <label for="massOrigInput">INSUMO DE REMANEJAMENTO (origem) a aplicar em ${MASS_SELECTED.size} aditivo(s):</label>
      <input type="text" id="massOrigInput" list="insumosDatalist" placeholder="digite p/ buscar..." style="width:100%; padding:8px 10px; border:1px solid var(--border-strong); border-radius:6px; font-size:13px;">
    </div>
  `;
  massPrompt(
    '🔄 Aplicar Origem em massa',
    `Substitui o campo INSUMO DE REMANEJAMENTO em <strong>${MASS_SELECTED.size}</strong> aditivo(s) selecionado(s).`,
    opt,
    () => {
      const novo = valueFromDisplay(document.getElementById('massOrigInput').value);
      if (novo === null || novo === undefined) throw new Error('Valor inválido');
      const map = readClassificationMap();
      const bulkPayloads = [];
      MASS_SELECTED.forEach((nAlt) => {
        const f = getFlowsObraAtiva().find((x) => x.n_alteracao === nAlt);
        if (!f) return;
        f.insumo_remanejamento = novo;
        f._edited_r = true;
        f.tipo = classifyFlow(f.insumo_planejamento, f.insumo_remanejamento);
        const codigoObra = f.codigo_obra || OBRA_ATIVA || '';
        const key = codigoObra + ':' + nAlt;
        if (!map[key]) map[key] = { codigo_obra: codigoObra };
        map[key].insumo_remanejamento = novo;
        bulkPayloads.push({
          codigo_obra: codigoObra,
          n_alteracao: nAlt,
          insumo_remanejamento: novo,
          updated_at: new Date().toISOString(),
        });
      });
      SafeStorage.set(STORAGE_KEY, JSON.stringify(map));
      void runAsyncSafely(
        supaBulkUpsertClassifications(bulkPayloads),
        'Classificações/origem em massa',
        'As alterações em massa foram salvas apenas neste navegador.',
      );
      buildLinks();
    },
  );
}

function massAplicarRefletido() {
  if (!requireEditorForActiveProject('classificar aditivos em massa')) return;
  const opt = `
    <div class="full">
      <label for="massReflInput">Status de reflexo a aplicar em ${MASS_SELECTED.size} aditivo(s):</label>
      <select id="massReflInput" style="width:100%; padding:8px 10px; border:1px solid var(--border-strong); border-radius:6px; font-size:13px;">
        <option value="sim">✅ Sim — refletir no planejamento</option>
        <option value="nao">❌ Não — não refletir (ex: cancelado)</option>
        <option value="pendente">⏳ Pendente — ainda não decidido</option>
      </select>
    </div>
  `;
  massPrompt(
    '✅ Marcar status de reflexo em massa',
    `Aplica o status em <strong>${MASS_SELECTED.size}</strong> aditivo(s) selecionado(s).`,
    opt,
    () => {
      const status = document.getElementById('massReflInput').value;
      const map = readClassificationMap();
      const bulkPayloads = [];
      MASS_SELECTED.forEach((nAlt) => {
        const f = getFlowsObraAtiva().find((x) => x.n_alteracao === nAlt);
        if (!f) return;
        f.refletido_status = status;
        f.refletido = status === 'sim';
        const codigoObra = f.codigo_obra || OBRA_ATIVA || '';
        const key = codigoObra + ':' + nAlt;
        if (!map[key]) map[key] = { codigo_obra: codigoObra };
        map[key].refletido_status = status;
        map[key].refletido = status === 'sim';
        bulkPayloads.push({
          codigo_obra: codigoObra,
          n_alteracao: nAlt,
          refletido_status: status,
          updated_at: new Date().toISOString(),
        });
      });
      SafeStorage.set(STORAGE_KEY, JSON.stringify(map));
      void runAsyncSafely(
        supaBulkUpsertClassifications(bulkPayloads),
        'Classificações/reflexo em massa',
        'As alterações em massa foram salvas apenas neste navegador.',
      );
    },
  );
}

// ============ EDIÇÃO DE VALOR (Fluxo Planejamento) ============
// parseNumBR agora é um alias para parseNumero (definido no início do script)

function onValorChange(input) {
  if (!requireEditorForActiveProject('alterar valores de aditivos')) {
    renderFlowTable();
    return;
  }
  const nAlt = input.dataset.n;
  const novo = parseNumero(input.value);
  const f = getFlowsObraAtiva().find((x) => x.n_alteracao === nAlt);
  if (!f) return;
  f.custo_flowmaster = novo;
  f._edited_v = true;
  // usar chave composta (codigo_obra:n_alteracao) + sync com Supabase
  const codigoObra = f.codigo_obra || OBRA_ATIVA || '';
  const key = codigoObra + ':' + nAlt;
  const map = readClassificationMap();
  if (!map[key]) map[key] = { codigo_obra: codigoObra };
  map[key].custo_flowmaster = novo;
  SafeStorage.set(STORAGE_KEY, JSON.stringify(map));
  // Sync com Supabase (persiste entre uploads/dispositivos)
  void runAsyncSafely(
    supaPatchClassification(nAlt, { custo_flowmaster: novo }, codigoObra),
    'Classificações/salvar valor no Supabase',
    'O valor foi salvo apenas neste navegador.',
  );
  // Atualizar display canônico
  input.value = novo != null ? fmt(novo) : '';
  input.classList.add('edited');
  input.classList.remove('pos', 'neg');
  if (novo != null) input.classList.add(novo < 0 ? 'neg' : 'pos');
  // Recalcular agregados em todas as telas
  syncAllViewsFromFlows();
}

// Lista oficial de motivos (usada no formulário de aditivo manual)
const MOTIVOS_OFICIAIS = [
  'ACRÉSCIMO ESCOPO COMERCIAL',
  'ALTERAÇÃO DE VENDA',
  'BAIXA PRODUTIVIDADE',
  'COMPRA / CONTRATAÇÃO EMERGENCIAL',
  'CONSUMO SUBESTIMADO',
  'DESPERDÍCIO / PERDAS INCORPORADAS',
  'DETALHAMENTO DE INSUMOS NA COMPOSIÇÃO PARA COMPRA',
  'DIRETRIZES DE CONCESSIONÁRIAS E ORGÃOS PÚBLICOS',
  'DIVERGENCIA DE QUANTITATIVOS COM PROJETO',
  'EMISSÃO DE PROJETO EXECUTIVO',
  'EXECUÇÃO DIVERGENTE DE PROJETO',
  'FALTA DE ESPECIFICAÇÃO TÉCNICA',
  'FURTO/ROUBO',
  'INDENIZAÇÕES',
  'INTERFERENCIA ENTRE PROJETOS',
  'INTERPÉRIES / PERIODO CHUVOSO',
  'MATERIAL COM MÁ QUALIDADE',
  'MODELO/ESTRATÉGIA DE CONTRATAÇÃO',
  'MUDANÇA DE ESTRATÉGIA COORPORATIVA',
  'MUDANÇA DE ESTRATÉGIA/METODOLOGIA EXECUTIVA',
  'OMISSÃO EM ESPOCO PARA CONTRATAÇÃO',
  'OMISSÃO EM LINHA DE BALANÇO',
  'OMISSÃO EM ORÇAMENTO',
  'OMISSÃO EM PROJETO',
  'PRODUÇÃO SUPERESTIMADA / SUBESTIMADA',
  'QUALIFICAÇÃO DA MÃO DE OBRA / EMPREITEIROS',
  'REVISÃO DE PROJETO EXECUTIVO',
  'SEQUENCIAMENTO PLANEJADO INADEQUADO',
  'VARIAÇÃO DE PREÇO UNITÁRIO',
];

// ============ MANUAIS ============
// (declarado em CONFIG no topo)

function loadManuals() {
  try {
    const raw = localStorage.getItem(MANUAL_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch (e) {
    reportNonFatalError(
      'Manuais/estado local inválido',
      e,
      'Os aditivos manuais locais não puderam ser lidos.',
    );
    return [];
  }
}

function saveManuals(arr) {
  if (!isEditorDaObraAtiva()) return false;
  SafeStorage.set(MANUAL_KEY, JSON.stringify(arr));
  // Sync com Supabase: identifica quais mudaram desde a última chamada é caro,
  // então faz upsert de todos (idempotente). Para excluídos, chamamos supaDeleteManual quando o botão é clicado.
  if (SUPA) {
    void runAsyncSafely(
      Promise.all(arr.map((m) => supaUpsertManual(m))),
      'Manuais/sincronizar no Supabase',
      'Os aditivos manuais foram salvos apenas neste navegador.',
    );
  }
}

function applyManuals() {
  // Remove anteriores e adiciona novamente (idempotente)
  DATA_F = DATA_F.filter((f) => !f.is_manual);
  const manuals = loadManuals();
  manuals.forEach((m) => {
    DATA_F.push({
      ...m,
      is_manual: true,
      tipo: classifyFlow(m.insumo_planejamento, m.insumo_remanejamento),
    });
  });
}

function nextManualId() {
  const manuals = loadManuals();
  let max = 0;
  manuals.forEach((m) => {
    const m1 = String(m.n_alteracao || '').match(/^M(\d+)$/);
    if (m1) max = Math.max(max, parseInt(m1[1]));
  });
  return 'M' + String(max + 1).padStart(3, '0');
}

function openManualForm(editing) {
  if (!requireEditorForActiveProject('adicionar ou editar aditivos manuais')) return;
  const f = editing || {};
  const today = new Date().toLocaleDateString('pt-BR');
  const tpl = document.getElementById('tpl-manual-form').content.cloneNode(true);

  // Preencher ID
  tpl.querySelector('.id-placeholder').textContent = f.n_alteracao || nextManualId();

  // Preencher select de departamentos
  const depSelect = tpl.querySelector('#m_dep');
  [
    'Obra',
    'Projeto',
    'Orçamento',
    'Planejamento',
    'Suprimentos',
    'Finalizado',
    'Cancelado',
  ].forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    if (f.dep === d) opt.selected = true;
    depSelect.appendChild(opt);
  });

  // Preencher data
  const dataInput = tpl.querySelector('#m_data');
  dataInput.value = f.data_br || today;
  dataInput.placeholder = today;

  // Preencher descrição
  tpl.querySelector('#m_desc').value = f.descricao || '';

  // Preencher motivos
  const motivoSelect = tpl.querySelector('#m_motivo');
  MOTIVOS_OFICIAIS.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    if (f.motivo === m) opt.selected = true;
    motivoSelect.appendChild(opt);
  });

  // Preencher valor
  tpl.querySelector('#m_valor').value = f.custo_flowmaster != null ? fmt(f.custo_flowmaster) : '';

  // Preencher destino e origem
  tpl.querySelector('#m_dest').value = displayForValue(f.insumo_planejamento || '');
  tpl.querySelector('#m_orig').value = displayForValue(f.insumo_remanejamento || '');

  // Preencher justificativa
  tpl.querySelector('#m_just').value = f.justificativa || '';

  // Preencher data-n no botão salvar
  tpl.querySelector('[data-action="save-manual"]').dataset.n = f.n_alteracao || '';

  // Renderizar
  const content = document.getElementById('modalContent');
  content.replaceChildren();
  content.appendChild(tpl);
  openModal({ initialFocus: '#m_desc' });
}

function saveManualForm(editingId) {
  if (!requireEditorForActiveProject('salvar aditivos manuais')) return;
  const get = (id) => document.getElementById(id).value.trim();
  const dep = get('m_dep');
  const data = get('m_data');
  const desc = get('m_desc');
  const motivo = get('m_motivo');
  const valor = parseNumero(get('m_valor'));
  const dest = valueFromDisplay(get('m_dest'));
  const orig = valueFromDisplay(get('m_orig'));
  const just = get('m_just');

  if (!desc) {
    authToast('⚠️ Descrição é obrigatória.', 'warn', 3000);
    return;
  }
  if (!dep) {
    authToast('⚠️ Departamento é obrigatório.', 'warn', 3000);
    return;
  }

  const manuals = loadManuals();
  const id = editingId || nextManualId();

  const obj = {
    n_alteracao: id,
    n_adt: '',
    dep,
    descricao: desc,
    data: data,
    data_br: data,
    aprovador_dep: '',
    aprovador: '',
    solicitante_dep: '',
    solicitante: '',
    custo_flowmaster: valor,
    custo_planejamento: valor,
    motivo,
    justificativa: just,
    incl_orcamento: '',
    incl_planej: '',
    incl_tendencia: '',
    revisao_tendencia: '',
    insumo_planejamento: dest,
    insumo_remanejamento: orig,
    obs: '',
  };

  // se editando, substitui; senão adiciona
  const idx = manuals.findIndex((m) => m.n_alteracao === id);
  if (idx >= 0) manuals[idx] = obj;
  else manuals.push(obj);

  saveManuals(manuals);
  applyManuals();
  closeModal();
  // Sincronizar todas as telas com debounce (evita múltiplas renderizações)
  debouncedRender();
  authToast(`✅ Aditivo manual ${id} salvo.`, 'ok', 3000);
}

async function deleteManual(id) {
  if (!requireEditor('excluir aditivo manual')) return;
  const confirmed = await confirmModal(
    'Excluir aditivo manual?',
    'Excluir o aditivo manual ' + id + '?\nEssa ação não pode ser desfeita.',
    { confirmText: 'Excluir', destructive: true },
  );
  if (!confirmed) return;
  const manuals = loadManuals().filter((m) => m.n_alteracao !== id);
  saveManuals(manuals);
  void runAsyncSafely(
    supaDeleteManual(id),
    'Manuais/excluir no Supabase',
    'O aditivo foi removido apenas neste navegador.',
  );
  applyManuals();
  // Sincronizar todas as telas com debounce (evita múltiplas renderizações)
  debouncedRender();
}

// Visualização de Flows fornecida por ui/views/flows.mjs.

export function installLegacyFlowEditor(target = window) {
  Object.assign(target, {
    showManualText,
    loadClassifications,
    readClassificationMap,
    saveClassification,
    clearClassifications,
    reloadClassifications,
    exportClassifications,
    buildInsumosList,
    renderInsumoSelect,
    displayForValue,
    valueFromDisplay,
    buildDatalist,
    formatDate,
    escHtml,
    escAttr,
    showTooltip,
    hideTooltip,
    positionTooltip,
    ttRow,
    ttDiv,
    syncAllViewsFromFlows,
    onClassifChange,
    updateEditCount,
    renderFlowsAggregates,
    msToggle,
    msFilterOpts,
    msSelectAll,
    msInvert,
    msClose,
    msMatches,
    msResetAll,
    toggleMassSelect,
    toggleSelectAllVisible,
    syncSelectAllHeader,
    clearMassSelection,
    updateMassBar,
    massAplicarDestino,
    massAplicarOrigem,
    massAplicarRefletido,
    onValorChange,
    loadManuals,
    saveManuals,
    applyManuals,
    openManualForm,
    saveManualForm,
    deleteManual,
  });

  Object.defineProperties(target, {
    INSUMOS_OPTIONS: {
      configurable: true,
      get: () => INSUMOS_OPTIONS,
      set: (value) => {
        INSUMOS_OPTIONS = Array.isArray(value) ? value : [];
      },
    },
    MS_EXCLUDED: { configurable: true, get: () => MS_EXCLUDED },
    MS_DESTINO_OPTS: { configurable: true, get: () => MS_DESTINO_OPTS },
    MASS_SELECTED: { configurable: true, get: () => MASS_SELECTED },
  });

  document.addEventListener('click', closeMultiSelectOnOutsideClick);
}
