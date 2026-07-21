/* eslint-disable no-undef */
import { replaceWithParsedMarkup } from './dom.mjs';

let reportNonFatalError;
let runAsyncSafely;
let debouncedRender;
let readExcelBuffer;
let readExcelFile;
let validateUploadFile;

const MANUAL_TEXT = {
  tendencia:
    '📈 ABA TENDÊNCIA (formato v0.55+)\n\nExporte da planilha:\n1. Abra o arquivo .xlsm\n2. Vá na aba TENDÊNCIA\n3. Arquivo → Salvar Como → CSV UTF-8 (.csv)\n4. Carregue aqui usando o botão "📤 Carregar CSV"\n\nO arquivo deve manter as colunas de Código, Serviço, Insumo, Item, Licitação, IPCA, INCC, Gestão, Diferença e Evoluções nas posições documentadas.\n\n⚠️ O formato antigo de 17 colunas não é mais aceito.\nVeja a aba "ℹ️ Manual" para detalhes completos.',
  flows:
    '🔗 ABA FlowsValor\n\nExporte da planilha:\n1. Abra o arquivo .xlsm\n2. Vá na aba FlowsValor (layout Fabric v0.63)\n3. Arquivo → Salvar Como → CSV UTF-8 (.csv)\n4. Carregue aqui\n\nO arquivo deve manter as 15 colunas na ordem oficial, de Cod_aditivo até Refletido.\n\n⚠️ As edições e aditivos manuais NÃO são apagados ao recarregar.\n\nVeja a aba "ℹ️ Manual" para detalhes completos.',
  gestoes:
    '📅 ABA Gestões\n\nExporte da planilha:\n1. Abra o arquivo .xlsm\n2. Vá na aba Gestões\n3. Arquivo → Salvar Como → CSV UTF-8 (.csv)\n4. Carregue aqui\n\nCabeçalhos obrigatórios: Descr_gestao, Descr_classificacaofinanceira, Key_planejamento, Val_totalliquido e Mes_pagamento.\n\nVeja a aba "ℹ️ Manual" para detalhes completos.',
};

// ============================================================
// v0.52 — Upload handler (refatorado pra usar Central de Uploads)
// ============================================================
function handleUpload(ev, kind /* 'tendencia' | 'flows' | 'gestoes' */) {
  if (!requireUploadPermission(kind, 'enviar este arquivo')) {
    ev.target.value = '';
    return;
  }
  // v0.58a: guard obra ativa (upload sem obra selecionada não faz sentido)
  if (!OBRA_ATIVA) {
    authToast(
      '❌ Nenhuma obra selecionada. Escolha uma obra no header antes de fazer upload.',
      'err',
      5000,
    );
    ev.target.value = '';
    return;
  }
  const file = ev.target.files[0];
  if (!file) return;

  const validation = validateUploadFile(file, 'csv');
  if (!validation.valid) {
    authToast('❌ ' + validation.message, 'err', 5000);
    ev.target.value = '';
    return;
  }

  const cardMeta = document.querySelector(`.upload-card[data-kind="${kind}"] .upload-card-meta`);
  if (cardMeta) cardMeta.textContent = '⏳ Lendo arquivo: 0%';
  setUploadRuntimeState(kind, 'processing', 'Lendo e validando o arquivo');

  const reader = new FileReader();
  reader.onprogress = (e) => {
    if (cardMeta && e.lengthComputable) {
      cardMeta.textContent = `⏳ Lendo arquivo: ${Math.round((e.loaded / e.total) * 100)}%`;
    }
  };
  reader.onload = async (e) => {
    const memorySnapshot = captureInMemoryUploadState();
    try {
      const txt = e.target.result;
      let result = '';
      let linhas = 0;

      if (kind === 'tendencia') {
        const parsed = parseTendencia(txt);
        if (!parsed.length)
          throw new Error(
            'TENDÊNCIA: nenhuma linha válida encontrada. Os dados atuais foram mantidos.',
          );
        DATA_T = parsed;
        // fallback pra coluna Gestão vazia (virada de mês)
        aplicarFallbackGestaoDoHistorico();
        // rebuildar datalist de insumos após upload novo
        try {
          INSUMOS_OPTIONS = buildInsumosList();
          buildDatalist();
        } catch (e) {
          reportNonFatalError('Upload/reconstruir lista de insumos', e);
        }
        linhas = DATA_T.length;
        result = `TENDÊNCIA: ${linhas} linhas`;
      } else if (kind === 'flows') {
        const parsed = parseFlowsValor(txt);
        if (!parsed.length)
          throw new Error(
            'FLOWS: nenhum aditivo válido encontrado. Os dados atuais foram mantidos.',
          );
        DATA_F = parsed;
        applyManuals();
        loadClassifications();
        linhas = DATA_F.length;
        result = `FLOWS: ${linhas} aditivos`;
      } else if (kind === 'gestoes') {
        const parsed = parseGestoes(txt);
        // v0.57.1 FIX: só sobrescrever se realmente veio conteúdo (evita zerar HISTORICO com CSV/aba vazia)
        if (parsed && parsed.items && parsed.items.length > 0) {
          HISTORICO = parsed;
          // sobrescreve GESTAO_LABEL com última gestão cronológica
          atualizarGestaoLabelPelaHistoria();
          // se coluna Gestão da Tendência estiver vazia, usa HISTORICO como fallback
          aplicarFallbackGestaoDoHistorico();
        } else {
          console.warn('[GESTÕES] arquivo/aba veio vazio — mantendo dados anteriores');
          throw new Error(
            'Aba Gestões não retornou linhas válidas. Filtro esperado: empreendimento=Jardins Zurique, classificação financeira=Obra, chave contendo -21O-. Verifique se está no formato correto.',
          );
        }
        linhas = parsed.items ? parsed.items.length : 0;
        result = `GESTÕES: ${linhas} itens · ${parsed.gestoes.length} gestões`;
      }

      setUploadRuntimeState(kind, 'processing', 'Sincronizando arquivo e dados');
      await commitPreparedUpload({
        file,
        storageType: kind,
        items: [{ kind, linhas }],
        memorySnapshot,
      });

      // Limpeza do backup ocorre depois do commit e não invalida o novo dataset.
      await runAsyncSafely(
        supaEnforceRollingBackup(kind),
        'Upload/limpeza de backups',
        'O upload foi concluído, mas os backups antigos não puderam ser limpos.',
      );

      // Usar debounce para evitar múltiplas renderizações
      debouncedRender();
      renderUploadsCentral();
      renderSourcesHeaders();
      updateEditCount();
      authToast('✅ ' + result + ' · 📦 arquivado e sincronizado', 'ok', 3500);
    } catch (err) {
      console.error(err);
      restoreInMemoryUploadState(memorySnapshot);
      setUploadRuntimeState(kind, 'failed', err.message || String(err));
      authToast('❌ Upload não concluído: ' + err.message, 'err', 7000);
      if (cardMeta) renderUploadsCentral();
    }
    ev.target.value = ''; // permite recarregar mesmo arquivo
  };
  reader.onerror = () => {
    setUploadRuntimeState(kind, 'failed', 'Falha ao ler o arquivo local');
    authToast('❌ Não foi possível ler o arquivo selecionado.', 'err', 5000);
    renderUploadsCentral();
    ev.target.value = '';
  };
  reader.readAsText(file, 'UTF-8');
}

// ============================================================
// v0.52 — Central de Uploads: renderização + drag-and-drop
// ============================================================
// ============================================================
// v0.54 — EXCEL UPLOAD MODULE
// Aceita 1 arquivo .xlsx/.xlsm com 3 abas (Tendência, Flows, Gestões)
// e processa cada aba usando os parsers CSV existentes.
// ============================================================

// Padrões de nome de aba (case-insensitive, sem acentos)
const EXCEL_SHEET_PATTERNS = {
  tendencia: [/^tend[eê]ncia$/i, /^tendencia$/i, /tend/i],
  flows: [/^flows?\s*valor$/i, /^flows_valor$/i, /flows.*valor/i, /flowsvalor/i],
  gestoes: [/^gest[oõ]es$/i, /^gestoes$/i, /^gest[aã]o$/i, /gest/i],
};

function _normalizeSheetName(name) {
  return String(name || '').trim();
}

// Tenta identificar automaticamente cada tipo pelo nome da aba.
// Retorna { tendencia: 'nomeAba' | null, flows: ..., gestoes: ... }
function _autoDetectSheets(sheetNames) {
  const result = { tendencia: null, flows: null, gestoes: null };
  for (const kind of Object.keys(EXCEL_SHEET_PATTERNS)) {
    for (const pattern of EXCEL_SHEET_PATTERNS[kind]) {
      const match = sheetNames.find((n) => pattern.test(_normalizeSheetName(n)));
      if (match) {
        result[kind] = match;
        break;
      }
    }
  }
  return result;
}

// Obtém o CSV preparado pelo Worker (os parsers existentes continuam independentes do Excel).
function _sheetToCSV(workbook, sheetName) {
  return workbook?.csvBySheet?.[sheetName] || '';
}

function _preflightExcelHeaders(workbook, mapping) {
  const errors = [];
  for (const kind of ['tendencia', 'flows', 'gestoes']) {
    const sheetName = mapping[kind];
    if (!sheetName) continue;
    try {
      const csv = _sheetToCSV(workbook, sheetName);
      validateImportHeaders(kind, parseCSVRows(csv));
    } catch (error) {
      errors.push({ kind, sheetName, message: error.message });
    }
  }
  return errors;
}

// ============================================================
// Handler principal do upload Excel
// ============================================================
async function handleExcelUpload(ev) {
  if (!requireAdmin('enviar a planilha Excel completa')) {
    ev.target.value = '';
    return;
  }
  // v0.58a: guard obra ativa
  if (!OBRA_ATIVA) {
    authToast(
      '❌ Nenhuma obra selecionada. Escolha uma obra no header antes de fazer upload.',
      'err',
      5000,
    );
    ev.target.value = '';
    return;
  }
  const file = ev.target.files[0];
  if (!file) return;
  ev.target.value = '';

  const validation = validateUploadFile(file, 'excel');
  if (!validation.valid) {
    authToast('❌ ' + validation.message, 'err', 5000);
    return;
  }

  const excelKinds = ['tendencia', 'flows', 'gestoes'];
  setUploadRuntimeState(excelKinds, 'processing', 'Lendo a planilha Excel');
  _renderExcelProgress('⏳ Lendo arquivo: 0%');
  let workbook;
  try {
    workbook = await readExcelFile(file, {
      onProgress: (percent) => _renderExcelProgress(`⏳ Lendo arquivo: ${percent}%`),
      onReadComplete: () => _renderExcelProgress('⚙️ Processando planilha...'),
    });
  } catch (e) {
    setUploadRuntimeState(excelKinds, 'failed', e.message || String(e));
    authToast('❌ Erro ao ler o arquivo: ' + e.message, 'err', 5000);
    _renderExcelProgress(null);
    renderUploadsCentral();
    return;
  }

  const sheetNames = workbook.sheetNames || [];
  _renderExcelProgress(`📋 ${sheetNames.length} aba(s) encontrada(s): ${sheetNames.join(', ')}`);

  // Tentar auto-detectar
  let mapping = _autoDetectSheets(sheetNames);
  const missing = Object.entries(mapping)
    .filter(([_key, value]) => !value)
    .map(([k]) => k);

  if (missing.length > 0) {
    // Abrir modal pro usuário mapear manualmente
    _renderExcelProgress(null);
    const userMapping = await _promptSheetMapping(sheetNames, mapping);
    if (!userMapping) {
      setUploadRuntimeState(excelKinds, 'idle');
      authToast('❌ Upload cancelado', 'warn', 2500);
      return;
    }
    mapping = userMapping;
  } else {
    _renderExcelProgress(
      `✅ Auto-detectadas: 📈 ${mapping.tendencia} · 🔗 ${mapping.flows} · 📅 ${mapping.gestoes}`,
    );
  }

  const headerErrors = _preflightExcelHeaders(workbook, mapping);
  if (headerErrors.length) {
    setUploadRuntimeState(
      excelKinds,
      'failed',
      headerErrors.map((error) => error.message).join(' · '),
    );
    _renderExcelProgress(null);
    renderUploadsCentral();
    headerErrors.forEach((error) => {
      authToast(`❌ Aba "${error.sheetName}": ${error.message}`, 'err', 8000);
    });
    return;
  }

  // Processar as 3 abas
  await _processExcelSheets(workbook, mapping, file);
}

// ============================================================
// Modal pra usuário mapear abas manualmente
// ============================================================
function _promptSheetMapping(sheetNames, autoDetected) {
  return new Promise((resolve) => {
    const modalContent = document.getElementById('modalContent');
    const modalBg = document.getElementById('modalBg');
    if (!modalContent || !modalBg) {
      resolve(null);
      return;
    }

    const opt = (name, selected) =>
      `<option value="${escAttr(name)}" ${name === selected ? 'selected' : ''}>${escHtml(name)}</option>`;

    replaceWithParsedMarkup(
      modalContent,
      `
      <h2>🗂️ Mapeamento de abas</h2>
      <div class="meta">Não consegui identificar automaticamente todas as abas. Selecione manualmente qual é cada uma:</div>
      <div style="margin: 18px 0;">
        <div class="sheet-mapping-row">
          <label for="mapSheet_tendencia">📈 Tendência:</label>
          <select id="mapSheet_tendencia">${['<option value="">— nenhuma —</option>', ...sheetNames.map((n) => opt(n, autoDetected.tendencia))].join('')}</select>
        </div>
        <div class="sheet-mapping-row">
          <label for="mapSheet_flows">🔗 Flows:</label>
          <select id="mapSheet_flows">${['<option value="">— nenhuma —</option>', ...sheetNames.map((n) => opt(n, autoDetected.flows))].join('')}</select>
        </div>
        <div class="sheet-mapping-row">
          <label for="mapSheet_gestoes">📅 Gestões:</label>
          <select id="mapSheet_gestoes">${['<option value="">— nenhuma —</option>', ...sheetNames.map((n) => opt(n, autoDetected.gestoes))].join('')}</select>
        </div>
        <p style="font-size:11.5px; color:var(--text-soft); margin-top:10px;">
          💡 Se uma aba não existir na planilha, deixe em "— nenhuma —" e ela não será processada.
        </p>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
        <button class="btn-sm" id="mapSheetsCancel">Cancelar</button>
        <button class="btn-sm primary" id="mapSheetsOk">✅ Processar</button>
      </div>
    `,
    );
    const finish = (result) => closeModal(result);
    document.getElementById('mapSheetsCancel').addEventListener('click', () => finish(null));
    document.getElementById('mapSheetsOk').addEventListener('click', () => {
      const r = {
        tendencia: document.getElementById('mapSheet_tendencia').value || null,
        flows: document.getElementById('mapSheet_flows').value || null,
        gestoes: document.getElementById('mapSheet_gestoes').value || null,
      };
      if (!r.tendencia && !r.flows && !r.gestoes) {
        authToast('⚠️ Selecione ao menos uma aba pra processar', 'warn', 3000);
        return;
      }
      finish(r);
    });
    openModal({
      onClose: (result) => resolve(result || null),
      initialFocus: '#mapSheet_tendencia',
    });
  });
}

// ============================================================
// Processar as abas selecionadas do Excel
// ============================================================
async function _processExcelSheets(workbook, mapping, file) {
  if (!requireAdmin('processar a planilha Excel completa')) return;
  // upload_group_id = todos os 3 registros do mesmo Excel compartilham este UUID
  const groupId = _uuid4();
  const results = {};
  const memorySnapshot = captureInMemoryUploadState();

  // 1) Processar todas as abas antes de iniciar qualquer escrita remota.
  const steps = [
    { kind: 'tendencia', label: 'Tendência', icon: '📈', parser: 'tendencia' },
    { kind: 'flows', label: 'Flows', icon: '🔗', parser: 'flows' },
    { kind: 'gestoes', label: 'Gestões', icon: '📅', parser: 'gestoes' },
  ];
  const selectedKinds = steps.filter((step) => mapping[step.kind]).map((step) => step.kind);
  setUploadRuntimeState(['tendencia', 'flows', 'gestoes'], 'idle');
  setUploadRuntimeState(selectedKinds, 'processing', 'Validando todas as abas da planilha');

  for (const step of steps) {
    const sheetName = mapping[step.kind];
    if (!sheetName) {
      results[step.kind] = { skipped: true };
      continue;
    }

    _renderExcelProgress(`⚙️ Processando aba "${sheetName}" (${step.icon} ${step.label})...`);
    let csv;
    try {
      csv = _sheetToCSV(workbook, sheetName);
    } catch (e) {
      results[step.kind] = { error: 'Falha ao ler aba: ' + e.message };
      continue;
    }

    // Os parsers repetem a validação do preflight como defesa contra chamadas diretas.
    let linhas = 0;
    try {
      if (step.parser === 'tendencia') {
        const parsed = parseTendencia(csv);
        if (!parsed.length) throw new Error('TENDÊNCIA: nenhuma linha válida encontrada.');
        DATA_T = parsed;
        // rebuildar datalist de insumos após upload novo
        try {
          INSUMOS_OPTIONS = buildInsumosList();
          buildDatalist();
        } catch (e) {
          reportNonFatalError('Excel/reconstruir lista de insumos', e);
        }
        // fallback pra coluna Gestão vazia (virada de mês)
        aplicarFallbackGestaoDoHistorico();
        linhas = DATA_T.length;
      } else if (step.parser === 'flows') {
        const parsed = parseFlowsValor(csv);
        if (!parsed.length) throw new Error('FLOWS: nenhum aditivo válido encontrado.');
        DATA_F = parsed;
        applyManuals();
        loadClassifications();
        linhas = DATA_F.length;
      } else if (step.parser === 'gestoes') {
        const parsed = parseGestoes(csv);
        // v0.57.1 FIX: só sobrescrever se realmente veio conteúdo (evita zerar HISTORICO com CSV/aba vazia)
        if (parsed && parsed.items && parsed.items.length > 0) {
          HISTORICO = parsed;
          // sobrescreve GESTAO_LABEL com última gestão cronológica
          atualizarGestaoLabelPelaHistoria();
          // se coluna Gestão da Tendência estiver vazia, usa HISTORICO como fallback
          aplicarFallbackGestaoDoHistorico();
        } else {
          console.warn('[GESTÕES] arquivo/aba veio vazio — mantendo dados anteriores');
          throw new Error(
            'Aba Gestões não retornou linhas válidas. Filtro esperado: empreendimento=Jardins Zurique, classificação financeira=Obra, chave contendo -21O-. Verifique se está no formato correto.',
          );
        }
        linhas = parsed.items ? parsed.items.length : 0;
      }
      results[step.kind] = { ok: true, linhas };
    } catch (e) {
      results[step.kind] = { error: e.message };
      continue;
    }
  }

  const parseErrors = Object.entries(results).filter(([, value]) => value.error);
  if (parseErrors.length) {
    restoreInMemoryUploadState(memorySnapshot);
    const summary = parseErrors.map(([kind, value]) => `${kind}: ${value.error}`).join(' · ');
    setUploadRuntimeState(selectedKinds, 'failed', summary);
    _renderExcelProgress(null);
    renderUploadsCentral();
    authToast(
      `❌ Planilha rejeitada: ${parseErrors.length} aba(s) com erro. Nenhum dado foi alterado.`,
      'err',
      7000,
    );
    parseErrors.forEach(([kind, value]) => {
      console.error(`[Excel] ${kind}:`, value.error);
      authToast(`❌ ${kind}: ${value.error}`, 'err', 7000);
    });
    return;
  }

  const processedItems = Object.entries(results)
    .filter(([, value]) => value.ok)
    .map(([kind, value]) => ({ kind, linhas: value.linhas }));
  if (!processedItems.length) {
    restoreInMemoryUploadState(memorySnapshot);
    setUploadRuntimeState(
      selectedKinds,
      'failed',
      'Nenhuma aba foi selecionada para processamento',
    );
    _renderExcelProgress(null);
    authToast('❌ Nenhuma aba válida foi processada.', 'err', 5000);
    return;
  }

  try {
    _renderExcelProgress('📤 Sincronizando arquivo, dados e histórico...');
    await commitPreparedUpload({
      file,
      storageType: 'excel',
      items: processedItems,
      groupId,
      memorySnapshot,
    });
  } catch (error) {
    restoreInMemoryUploadState(memorySnapshot);
    setUploadRuntimeState(selectedKinds, 'failed', error.message || String(error));
    _renderExcelProgress(null);
    renderUploadsCentral();
    authToast('❌ Upload da planilha não concluído: ' + error.message, 'err', 8000);
    return;
  }

  await Promise.all(
    processedItems.map((item) =>
      runAsyncSafely(
        supaEnforceRollingBackup(item.kind),
        `Excel/limpeza de backups/${item.kind}`,
        `A planilha foi concluída, mas os backups antigos de ${item.kind} não puderam ser limpos.`,
      ),
    ),
  );

  // 2) Re-render apenas depois do commit completo.
  debouncedRender();
  renderUploadsCentral();
  renderSourcesHeaders();
  updateEditCount();
  _renderExcelProgress(null);

  // 3) Toast de resumo
  const ok = Object.entries(results).filter(([_key, value]) => value.ok);
  const skipped = Object.entries(results).filter(([_key, value]) => value.skipped);
  const parts = [];
  if (ok.length) parts.push(`✅ ${ok.length} aba(s) processada(s)`);
  if (skipped.length) parts.push(`⏭️ ${skipped.length} pulada(s)`);
  authToast('📊 ' + parts.join(' · ') + ' · 📦 sincronizado', 'ok', 5000);
}

// Renderiza mensagem de progresso dentro do card Excel
function _renderExcelProgress(msg) {
  const card = document.querySelector('.upload-excel-card .upload-progress');
  if (!card) return;
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  card.setAttribute('aria-atomic', 'true');
  if (!msg) {
    card.replaceChildren();
    card.style.display = 'none';
    card.setAttribute('aria-hidden', 'true');
    return;
  }
  card.setAttribute('aria-hidden', 'false');
  card.style.display = 'block';
  const step = document.createElement('div');
  step.className = 'prog-step';
  step.textContent = String(msg);
  card.replaceChildren(step);
}

// UUID v4 (não precisa de biblioteca)
function _uuid4() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Toggle do "modo avançado" (uploads individuais CSV)
function toggleAdvancedUploads() {
  const body = document.getElementById('uploadsAdvancedBody');
  const toggle = document.getElementById('uploadsAdvancedToggle');
  if (!body || !toggle) return;
  const open = body.classList.toggle('open');
  replaceWithParsedMarkup(
    toggle,
    (open ? '▼' : '▶') +
      ' <strong>Modo avançado</strong> — enviar cada CSV individualmente (uso legado)',
  );
}

const UPLOAD_META = {
  tendencia: {
    label: 'TENDÊNCIA',
    icon: '📈',
    color: 'var(--fgr-red-vivid)',
    desc: 'Alimenta: KPIs da Visão Geral, tabela de Detalhamento, curva S de Tendência de Obra e Controle de Projeção. Fonte: aba TENDÊNCIA da planilha.',
    manualKey: 'tendencia',
  },
  flows: {
    label: 'FLOWS / ADITIVOS',
    icon: '🔗',
    color: 'var(--text-medium)',
    desc: 'Alimenta: aba Flows/Aditivos, decomposição do desvio na Visão Geral e Controle de Projeção. Fonte: aba FlowsValor da planilha.',
    manualKey: 'flows',
    global: true,
  },
  gestoes: {
    label: 'GESTÕES 🌐',
    icon: '📅',
    color: 'var(--text-medium)',
    desc: 'Alimenta: Histórico Mensal e curva S da Tendência de Obra. Fonte: aba Gestões da planilha. ⚠️ ARQUIVO COMPARTILHADO: 1 upload afeta TODAS as obras (v0.58b).',
    manualKey: 'gestoes',
    global: true,
  },
};

function fmtUploadDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return (
    d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' às ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  );
}
function fmtUploadDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return (
    d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  );
}
function fmtBytes(b) {
  if (b == null) return '';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderUploadRuntimeBlock(kinds) {
  const states = (Array.isArray(kinds) ? kinds : [kinds])
    .map((kind) => UPLOAD_RUNTIME_STATE[kind])
    .filter(Boolean);
  const processing = states.find((state) => state.status === 'processing');
  if (processing) {
    return `<div role="status" class="upload-card-meta" style="background:var(--sem-alerta-bg); color:var(--sem-alerta);">⏳ ${escHtml(processing.message || 'Upload em processamento...')}</div>`;
  }
  const failed = states.find((state) => state.status === 'failed');
  if (failed) {
    return `<div role="alert" class="upload-card-meta" style="background:var(--fgr-red-light); color:var(--sem-erro);">❌ Última tentativa não foi aplicada: ${escHtml(failed.message || 'falha desconhecida')}</div>`;
  }
  return '';
}

function renderUploadsCentral() {
  const root = document.getElementById('uploadsCentral');
  if (!root) return;
  const kinds = ['tendencia', 'flows', 'gestoes'];

  // ============================================================
  // Bloco Excel destacado no topo
  // ============================================================
  // "Última planilha Excel" = pegar o registro mais recente com upload_group_id
  // que existe em pelo menos um dos LAST_UPLOADS.
  const groupCandidates = kinds.map((k) => LAST_UPLOADS[k]).filter((u) => u && u.upload_group_id);
  const excelRuntimeBlock = renderUploadRuntimeBlock(kinds);
  const excelProcessing = kinds.some((kind) => UPLOAD_RUNTIME_STATE[kind]?.status === 'processing');
  let lastExcel = null;
  if (groupCandidates.length) {
    // Ordenar por data e pegar o mais recente
    groupCandidates.sort((a, b) => new Date(b.enviado_em) - new Date(a.enviado_em));
    const gid = groupCandidates[0].upload_group_id;
    const relatedKinds = kinds.filter(
      (k) => LAST_UPLOADS[k] && LAST_UPLOADS[k].upload_group_id === gid,
    );
    lastExcel = {
      ...groupCandidates[0],
      relatedKinds,
    };
  }

  const excelMeta = lastExcel
    ? `
    <div class="upload-card-meta filled">
      📁 <strong>${escHtml(lastExcel.nome_arquivo)}</strong>${lastExcel.tamanho_bytes ? ' <span style="color:var(--text-soft);">(' + fmtBytes(lastExcel.tamanho_bytes) + ')</span>' : ''}<br>
      📅 Enviado ${lastExcel.enviado_por ? 'por <code>' + escHtml(lastExcel.enviado_por) + '</code> ' : ''}em ${escHtml(fmtUploadDate(lastExcel.enviado_em))}<br>
      📊 Abas processadas: ${lastExcel.relatedKinds.map((k) => `${UPLOAD_META[k].icon} ${UPLOAD_META[k].label.split(' ')[0]}`).join(' · ')}
    </div>`
    : `
    <div class="upload-card-meta empty">📭 Nenhuma planilha Excel enviada ainda. Você pode enviar 1 arquivo <code>.xlsx</code>/<code>.xlsm</code> com as 3 abas ou usar o modo avançado abaixo.</div>`;

  const excelCard = `
    <div class="upload-excel-card" id="excelUploadCard">
      <h3>📊 Upload Completo (Excel) <span style="font-size:11px; color:var(--sem-ok-vivid); font-weight:600; margin-left:4px;">RECOMENDADO</span></h3>
      <p class="subtitle">Envie a planilha inteira (<code>.xlsx</code> ou <code>.xlsm</code>) e o dashboard extrai automaticamente as abas <strong>Tendência</strong>, <strong>FlowsValor</strong> e <strong>Gestões</strong>.</p>
      ${excelRuntimeBlock}
      ${excelMeta}
      <div class="upload-progress" role="status" aria-live="polite" aria-atomic="true" aria-hidden="true" style="display:none;"></div>
      <div class="upload-card-actions">
        <button class="btn-sm primary" data-editor-only data-admin-control ${isAdminGeral() && !excelProcessing ? '' : 'disabled'} data-click-action="" data-file-target="fileInput_excel">
          📊 ${lastExcel ? 'Substituir planilha' : 'Escolher planilha Excel'}
        </button>
        <button class="btn-sm" data-click-action="openUploadsHistory" data-action-mode="arg" data-action-arg="tendencia" title="Ver todos os uploads">📜 Histórico</button>
        <input type="file" id="fileInput_excel" accept=".xlsx,.xlsm,.xls" aria-label="Selecionar planilha Excel" style="display:none" data-change-action="handleExcelUpload" data-action-mode="event">
      </div>
    </div>`;

  // ============================================================
  // Accordion "modo avançado" — uploads individuais CSV
  // ============================================================
  const csvCardsHtml = kinds
    .map((k) => {
      const meta = UPLOAD_META[k];
      const last = LAST_UPLOADS[k];
      const runtimeBlock = renderUploadRuntimeBlock(k);
      const isProcessing = UPLOAD_RUNTIME_STATE[k]?.status === 'processing';
      const permissionAttr = meta.global
        ? `data-admin-control ${isAdminGeral() ? '' : 'disabled'}`
        : `data-edit-control ${isEditorDaObraAtiva() ? '' : 'disabled'}`;
      let metaBlock;
      if (last) {
        const detalhes = [
          last.tamanho_bytes ? fmtBytes(last.tamanho_bytes) : null,
          last.linhas ? last.linhas + ' linhas' : null,
        ]
          .filter(Boolean)
          .join(' · ');
        const sourceTag = last.upload_group_id
          ? ' <span style="font-size:10px; color:var(--sem-ok-vivid); background:var(--sem-ok-bg); padding:1px 6px; border-radius:8px; margin-left:4px;">via Excel</span>'
          : '';
        metaBlock = `
        <div class="upload-card-meta filled">
          📁 <strong>${escHtml(last.nome_arquivo)}</strong>${sourceTag}${detalhes ? ' <span style="color:var(--text-soft);">(' + detalhes + ')</span>' : ''}<br>
          📅 Enviado ${last.enviado_por ? 'por <code>' + escHtml(last.enviado_por) + '</code> ' : ''}em ${escHtml(fmtUploadDate(last.enviado_em))}
        </div>`;
      } else {
        metaBlock = `<div class="upload-card-meta empty">📭 Nenhum arquivo carregado ainda.</div>`;
      }
      return `
      <div class="upload-card" data-kind="${k}" style="border-top: 3px solid ${meta.color};">
        <div class="upload-card-header">
          <div>
            <h3 class="upload-card-title">${meta.icon} ${meta.label}</h3>
            <p class="upload-card-sub">${escHtml(meta.desc)}</p>
          </div>
        </div>
        ${runtimeBlock}
        ${metaBlock}
        <div class="upload-card-actions">
          <button class="btn-sm primary" data-editor-only ${permissionAttr} ${isProcessing ? 'disabled' : ''} data-click-action="" data-file-target="fileInput_${k}">
            📤 ${last ? 'Substituir arquivo' : 'Escolher arquivo'}
          </button>
          <button class="btn-sm" data-click-action="openUploadsHistory" data-action-mode="arg" data-action-arg="${k}" title="Ver arquivos enviados anteriormente (últimos ${UPLOADS_MAX_PER_TYPE})">📜 Histórico</button>
          <button class="btn-sm" data-click-action="showManualText" data-action-mode="arg" data-action-arg="${meta.manualKey}">ℹ️ Como exportar?</button>
          <input type="file" id="fileInput_${k}" accept=".csv" aria-label="Selecionar arquivo CSV de ${escAttr(meta.label)}" style="display:none" data-change-action="handleUpload" data-action-mode="event-arg" data-action-arg="${k}">
        </div>
      </div>`;
    })
    .join('');

  replaceWithParsedMarkup(
    root,
    `
    ${excelCard}
    <div id="uploadsAdvancedToggle" class="uploads-advanced-toggle" data-click-action="toggleAdvancedUploads">
      ▶ <strong>Modo avançado</strong> — enviar cada CSV individualmente (uso legado)
    </div>
    <div id="uploadsAdvancedBody" class="uploads-advanced-body">
      ${csvCardsHtml}
    </div>
  `,
  );

  // Drag-and-drop no card Excel
  const excelCardEl = document.getElementById('excelUploadCard');
  if (excelCardEl) {
    excelCardEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      excelCardEl.classList.add('dragover');
    });
    excelCardEl.addEventListener('dragleave', (e) => {
      e.preventDefault();
      excelCardEl.classList.remove('dragover');
    });
    excelCardEl.addEventListener('drop', (e) => {
      e.preventDefault();
      excelCardEl.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const fakeEvt = { target: { files: [file], value: '' } };
      handleExcelUpload(fakeEvt);
    });
  }

  // Drag-and-drop nos cards CSV individuais
  root.querySelectorAll('.upload-card').forEach((card) => {
    const kind = card.dataset.kind;
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('dragover');
    });
    card.addEventListener('dragleave', (e) => {
      e.preventDefault();
      card.classList.remove('dragover');
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const fakeEvt = { target: { files: [file], value: '' } };
      handleUpload(fakeEvt, kind);
    });
  });
}

// modal com histórico completo de uploads de um tipo
async function openUploadsHistory(kind) {
  const meta = UPLOAD_META[kind];
  if (!meta) return;
  const modalContent = document.getElementById('modalContent');
  if (!modalContent) return;
  replaceWithParsedMarkup(
    modalContent,
    `
    <h2>📜 Histórico de uploads — ${meta.icon} ${meta.label}</h2>
    <div class="meta">Mantemos os últimos <strong>${UPLOADS_MAX_PER_TYPE}</strong> arquivos por tipo (mais antigos são descartados automaticamente).</div>
    <div id="uploadsHistoryList" style="margin-top:14px;">⏳ Carregando...</div>
  `,
  );
  openModal();
  await _renderUploadsHistoryList(kind);
}

// extraído em função separada pra poder re-renderizar após ações (ativar/excluir)
async function _renderUploadsHistoryList(kind) {
  const meta = UPLOAD_META[kind];
  const list = await supaListUploadsByType(kind, UPLOADS_MAX_PER_TYPE + 5);
  const box = document.getElementById('uploadsHistoryList');
  if (!box) return;
  if (!list.length) {
    replaceWithParsedMarkup(
      box,
      '<div style="text-align:center; color:var(--text-lighter); padding:30px;">Nenhum upload registrado ainda.</div>',
    );
    return;
  }
  const isEditor = isEditorDaObraAtiva();
  const isGlobal = meta.global === true; // Gestões é compartilhado entre obras
  const canManage = isGlobal ? isAdminGeral() : isEditor;
  replaceWithParsedMarkup(
    box,
    `
    <table style="width:100%; font-size:12.5px; border-collapse:collapse;">
      <thead>
        <tr style="background:var(--bg-page); text-align:left;">
          <th style="padding:8px; border-bottom:2px solid var(--border);">Data / Hora</th>
          <th style="padding:8px; border-bottom:2px solid var(--border);">Arquivo</th>
          <th style="padding:8px; border-bottom:2px solid var(--border);">Tamanho</th>
          <th style="padding:8px; border-bottom:2px solid var(--border);">Linhas</th>
          <th style="padding:8px; border-bottom:2px solid var(--border);">Enviado por</th>
          <th style="padding:8px; border-bottom:2px solid var(--border); text-align:right;">Ações</th>
        </tr>
      </thead>
      <tbody>
        ${list
          .map((r) => {
            const isAtivo = !!r.is_active;
            const cleanStoragePath = sanitizeStoragePath(r.storage_path);
            const safeObra = OBRA_ATIVA ? OBRA_ATIVA.replace(/[^\w.\-]/g, '_') : '';
            const hasValidStoragePath =
              !!cleanStoragePath && !!safeObra && cleanStoragePath.startsWith(safeObra + '/');
            const canDownload =
              hasValidStoragePath && AUTH && AUTH.user && (isGlobal ? isAdminGeral() : isEditor);
            const canReativar = canManage && !isAtivo && !!r.storage_path;
            const canExcluir = canManage && !isAtivo; // BLOQUEADO se ativo
            const btnDownload = canDownload
              ? `<button class="btn-sm" data-action="download-upload" data-path="${escAttr(cleanStoragePath)}" data-filename="${escAttr(r.nome_arquivo)}" title="Baixar arquivo" aria-label="Baixar ${escAttr(r.nome_arquivo)}">📥</button>`
              : cleanStoragePath
                ? `<span style="color:var(--text-lighter); font-size:11px;" title="${hasValidStoragePath ? 'Faça login para baixar' : 'Arquivo indisponível para a obra ativa'}">🔒</span>`
                : `<span style="color:var(--text-lighter); font-size:11px;" title="Upload anterior à v0.53, arquivo não foi armazenado">—</span>`;
            const btnAtivar =
              canReativar && hasValidStoragePath
                ? `<button class="btn-sm primary" data-action="ativar-upload" data-id="${r.id}" data-kind="${escAttr(kind)}" title="Usar este arquivo como fonte de dados">⭐ Ativar</button>`
                : isAtivo
                  ? ''
                  : `<span style="color:var(--text-lighter); font-size:11px;" title="Arquivo sem storage_path — não pode ser reativado">—</span>`;
            const btnExcluir = canExcluir
              ? `<button class="btn-sm danger" data-action="excluir-upload" data-id="${r.id}" data-kind="${escAttr(kind)}" title="Excluir arquivo" aria-label="Excluir ${escAttr(r.nome_arquivo)}" style="background:var(--fgr-red-light); border:1px solid var(--sem-erro-border); color:var(--sem-erro);">🗑️</button>`
              : isAtivo && canManage
                ? `<span style="color:var(--text-lighter); font-size:11px;" title="Ative outro arquivo antes de excluir este">🔒</span>`
                : '';
            return `
            <tr style="border-bottom:1px solid var(--bg-soft); ${isAtivo ? 'background:var(--sem-ok-subtle);' : ''}">
              <td style="padding:8px;">${escHtml(fmtUploadDate(r.enviado_em))} ${isAtivo ? '<span style="display:inline-block; margin-left:4px; padding:2px 8px; background:var(--sem-ok-vivid); color:var(--text-on-dark); font-size:9px; font-weight:700; border-radius:10px; letter-spacing:0.3px;">📌 ATIVO</span>' : ''}</td>
              <td style="padding:8px; font-family:monospace; font-size:11.5px;">${escHtml(r.nome_arquivo)}</td>
              <td style="padding:8px; color:var(--text-soft);">${fmtBytes(r.tamanho_bytes)}</td>
              <td style="padding:8px; color:var(--text-soft);">${r.linhas != null ? r.linhas.toLocaleString('pt-BR') : '-'}</td>
              <td style="padding:8px; font-size:11.5px; color:var(--text-soft);">${r.enviado_por ? escHtml(r.enviado_por) : '<em>anônimo</em>'}</td>
              <td style="padding:8px; text-align:right; white-space:nowrap;">
                <span style="display:inline-flex; gap:4px; align-items:center;">${btnDownload} ${btnAtivar} ${btnExcluir}</span>
              </td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
    <div style="margin-top:12px; padding:10px 14px; background:var(--bg-page); border-radius:4px; font-size:11.5px; color:var(--text-soft); line-height:1.5;">
      💡 <strong>Ativar:</strong> marca esse arquivo como fonte de dados do dashboard (substitui o atual sem apagar).<br>
      🗑️ <strong>Excluir:</strong> apaga permanentemente do banco e Storage. Só permitido em arquivos não-ativos.<br>
      📌 <strong>Ativo:</strong> arquivo cujos dados estão sendo usados no dashboard agora.<br>
      🔄 <strong>Rolling backup:</strong> mantém apenas os últimos ${UPLOADS_MAX_PER_TYPE} arquivos. Ativo nunca é descartado automaticamente.
      ${isGlobal ? '<br>🌐 <strong>Gestões é compartilhado:</strong> trocar o ativo afeta TODAS as obras.' : ''}
    </div>
  `,
  );
  // Event delegation para botões do histórico de uploads (renderizado dinamicamente)
  const uploadsBox = document.getElementById('uploadsHistoryList');
  if (uploadsBox && !uploadsBox._delegationSet) {
    uploadsBox._delegationSet = true;
    uploadsBox.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'download-upload') downloadUploadFile(btn.dataset.path, btn.dataset.filename);
      else if (action === 'ativar-upload')
        marcarUploadComoAtivo(parseInt(btn.dataset.id, 10), btn.dataset.kind);
      else if (action === 'excluir-upload')
        excluirUpload(parseInt(btn.dataset.id, 10), btn.dataset.kind);
    });
  }
}

async function downloadUploadFile(storagePath, filename) {
  if (!AUTH || !AUTH.user) {
    authToast('🔑 Faça login para baixar arquivos', 'warn', 3500);
    return;
  }
  const cleanPath = sanitizeStoragePath(storagePath);
  if (!cleanPath) {
    authToast('❌ Arquivo indisponível no histórico', 'err', 4000);
    return;
  }
  authToast('⏳ Gerando link de download...', 'info', 2000);
  const url = await supaGetDownloadURL(cleanPath);
  if (!url) {
    authToast('❌ Arquivo indisponível ou fora da obra ativa', 'err', 4500);
    return;
  }
  // Trigger download
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download.csv';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ============================================================
// v0.60 — Controle manual de arquivo ativo
// ============================================================

// Marca um upload específico como ativo (desativa os anteriores do mesmo obra+tipo)
// Depois: baixa o arquivo do Storage, re-parseia e substitui os dados no Supabase.
async function marcarUploadComoAtivo(uploadId, kind) {
  if (!requireUploadPermission(kind, 'trocar este arquivo ativo')) return;
  const meta = UPLOAD_META[kind];
  const isGlobal = meta && meta.global === true;
  // Aviso especial pra Gestões (global)
  if (isGlobal) {
    const confirmed = await confirmModal(
      'Ativar arquivo global de Gestões',
      'Trocar o arquivo ativo atualizará o Histórico Mensal e a Curva S de TODAS as obras.',
      { confirmText: 'Ativar arquivo', destructive: false },
    );
    if (!confirmed) return;
  } else {
    const confirmed = await confirmModal(
      'Trocar arquivo ativo',
      `Trocar o arquivo ativo de ${meta ? meta.label : kind} para esta versão?\n\nO dashboard substituirá os dados atuais pelos deste arquivo.`,
      { confirmText: 'Ativar arquivo', destructive: false },
    );
    if (!confirmed) return;
  }
  authToast('⏳ Ativando arquivo...', 'info', 2500);
  const memorySnapshot = captureInMemoryUploadState();
  let dashboardSnapshot = null;
  let dashboardPersisted = false;
  let activation = null;
  let alvo = null;
  setUploadRuntimeState(kind, 'processing', 'Validando e ativando arquivo do histórico');
  try {
    // 1) Buscar o registro alvo
    const { data: targetRecord, error: readErr } = await SUPA.from('upload_history')
      .select('*')
      .eq('id', uploadId)
      .maybeSingle();
    alvo = targetRecord;
    if (readErr || !alvo) throw new Error('Arquivo não encontrado no banco');
    if (alvo.codigo_obra !== OBRA_ATIVA) throw new Error('Arquivo fora do escopo da obra ativa');
    if (!alvo.storage_path)
      throw new Error(
        'Arquivo não tem cópia no Storage (upload muito antigo). Impossível reativar.',
      );
    // 2) Baixar o arquivo do Storage
    const url = await supaGetDownloadURL(alvo.storage_path);
    if (!url) throw new Error('Falha ao gerar link de download do arquivo');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Falha ao baixar arquivo: HTTP ' + resp.status);
    const isExcel = /\.xlsx?$|\.xlsm$/i.test(alvo.nome_arquivo);
    // 3) Re-parseia
    if (isExcel) {
      const buf = await resp.arrayBuffer();
      const wb = await readExcelBuffer(buf);
      const sheetNames = wb.sheetNames || [];
      const mapping = _autoDetectSheets(sheetNames);
      // Só processa a aba correspondente ao tipo
      const sheetName = mapping[kind];
      if (!sheetName) throw new Error(`Aba correspondente a "${kind}" não encontrada no Excel`);
      const csv = _sheetToCSV(wb, sheetName);
      _parsearECarregar(kind, csv);
    } else {
      // CSV direto
      const csv = await resp.text();
      _parsearECarregar(kind, csv);
    }
    // 4) Persistir antes de ativar; ambos possuem compensação em caso de falha.
    dashboardSnapshot = await supaCaptureDashboardRows([kind]);
    await supaSaveAllData([kind]);
    dashboardPersisted = true;
    activation = await supaActivateUploadRecord(alvo);
  } catch (e) {
    console.error('[v0.60] marcarUploadComoAtivo:', e);
    const cleanupErrors = [];
    if (activation) {
      try {
        await supaRollbackUploadActivation(activation);
      } catch (cleanupError) {
        cleanupErrors.push('arquivo ativo: ' + cleanupError.message);
      }
    }
    if (dashboardPersisted) {
      try {
        await supaRestoreDashboardRows(dashboardSnapshot);
      } catch (cleanupError) {
        cleanupErrors.push('dados anteriores: ' + cleanupError.message);
      }
    }
    restoreInMemoryUploadState(memorySnapshot);
    setUploadRuntimeState(kind, 'failed', e.message || String(e));
    renderUploadsCentral();
    authToast('❌ Erro ao ativar: ' + e.message, 'err', 5000);
    if (cleanupErrors.length) {
      authToast('⚠️ A recuperação ficou parcial: ' + cleanupErrors.join('; '), 'warn', 8000);
    }
    return;
  }

  LAST_UPLOADS[kind] = activation.active;
  setUploadRuntimeState(kind, 'active');
  debouncedRender();
  renderUploadsCentral();
  renderSourcesHeaders();
  await _renderUploadsHistoryList(kind);
  authToast(`✅ Arquivo ativado: ${alvo.nome_arquivo}`, 'ok', 3500);
}

// Helper interno: parseia CSV do tipo correspondente e atualiza estruturas em memória
function _parsearECarregar(kind, csv) {
  const firstLines = csv.split(/\r?\n/).slice(0, 3).join(' ');
  const fu = firstLines.toUpperCase();
  if (kind === 'tendencia') {
    if (
      !fu.includes('LICITAÇÃO') ||
      !fu.includes('IPCA') ||
      !fu.includes('INCC') ||
      !fu.includes('EVOLUÇÃO')
    ) {
      throw new Error('CSV Tendência em formato inesperado');
    }
    const parsed = parseTendencia(csv);
    if (!parsed.length) throw new Error('CSV Tendência não retornou linhas válidas');
    DATA_T = parsed;
    // rebuildar datalist de insumos após upload novo
    try {
      INSUMOS_OPTIONS = buildInsumosList();
      buildDatalist();
    } catch (e) {
      reportNonFatalError('Histórico/reconstruir lista de insumos', e);
    }
    // fallback pra coluna Gestão vazia (virada de mês)
    aplicarFallbackGestaoDoHistorico();
  } else if (kind === 'flows') {
    if (
      !firstLines.includes('Cod_aditivo') &&
      !firstLines.includes('INSUMO PLANEJAMENTO') &&
      !firstLines.includes('CONTROLE DE ALTERAÇÕES')
    ) {
      throw new Error('CSV Flows em formato inesperado');
    }
    const parsed = parseFlowsValor(csv);
    if (!parsed.length) throw new Error('CSV Flows não retornou aditivos válidos');
    DATA_F = parsed;
    applyManuals();
    loadClassifications();
  } else if (kind === 'gestoes') {
    if (!firstLines.includes('Descr_gestao') && !firstLines.includes('Key_planejamento')) {
      throw new Error('CSV Gestões em formato inesperado');
    }
    const parsed = parseGestoes(csv);
    if (parsed && parsed.items && parsed.items.length > 0) {
      HISTORICO = parsed;
      atualizarGestaoLabelPelaHistoria();
    } else {
      throw new Error('CSV Gestões não retornou linhas válidas');
    }
  }
}

// Exclui um upload específico (bloqueado se for o ativo — check no HTML)
async function excluirUpload(uploadId, kind) {
  if (!requireUploadPermission(kind, 'excluir este arquivo')) return;
  try {
    // Buscar pra confirmar que não é o ativo
    const { data: rec, error: readErr } = await SUPA.from('upload_history')
      .select('id, nome_arquivo, storage_path, is_active, codigo_obra')
      .eq('id', uploadId)
      .maybeSingle();
    if (readErr || !rec) throw new Error('Arquivo não encontrado');
    if (rec.codigo_obra !== OBRA_ATIVA) throw new Error('Arquivo fora do escopo da obra ativa');
    if (rec.is_active) {
      authToast('🔒 Não é possível excluir o arquivo ativo. Ative outro primeiro.', 'warn', 4500);
      return;
    }
    const confirmed = await confirmModal(
      'Excluir arquivo do histórico',
      `Excluir permanentemente o arquivo "${rec.nome_arquivo}"?\n\nOs dados do dashboard não serão afetados; somente este arquivo e seu registro serão removidos.`,
      { confirmText: 'Excluir arquivo' },
    );
    if (!confirmed) return;
    authToast('🗑️ Excluindo...', 'info', 2000);
    // Verifica antes se o arquivo é compartilhado por outros registros do Excel.
    const cleanStoragePath = sanitizeStoragePath(rec.storage_path);
    let removeStoredFile = false;
    if (cleanStoragePath) {
      const { data: otherReferences, error: referenceError } = await SUPA.from('upload_history')
        .select('id')
        .eq('codigo_obra', OBRA_ATIVA)
        .eq('storage_path', cleanStoragePath)
        .neq('id', uploadId)
        .limit(1);
      if (referenceError) throw referenceError;
      removeStoredFile = !otherReferences?.length;
    }
    // Remove primeiro o metadata para nunca deixar o histórico apontando para arquivo ausente.
    const { error: dbErr } = await SUPA.from('upload_history')
      .delete()
      .eq('codigo_obra', OBRA_ATIVA)
      .eq('id', uploadId);
    if (dbErr) throw dbErr;
    if (removeStoredFile) {
      const { error: sErr } = await SUPA.storage.from(UPLOADS_BUCKET).remove([cleanStoragePath]);
      if (sErr) {
        reportNonFatalError(
          'Uploads/remover arquivo sem referências',
          sErr,
          'O registro foi excluído, mas o arquivo órfão não pôde ser removido do Storage.',
        );
      }
    }
    // Re-render do modal
    await _renderUploadsHistoryList(kind);
    authToast(`✅ Arquivo excluído`, 'ok', 3000);
  } catch (e) {
    console.error('[v0.60] excluirUpload:', e);
    authToast('❌ Erro ao excluir: ' + e.message, 'err', 5000);
  }
}

function renderSourcesHeaders() {
  document.querySelectorAll('.sources-header').forEach((el) => {
    const kinds = (el.dataset.sources || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const parts = kinds.map((k) => {
      const meta = UPLOAD_META[k];
      const last = LAST_UPLOADS[k];
      if (!last) {
        return `<span class="src-item src-empty" title="Nenhum arquivo enviado ainda para ${meta ? meta.label : k}">${meta ? meta.icon : ''} ${meta ? meta.label : k}: (sem dados)</span>`;
      }
      const tip = `${last.nome_arquivo} · ${fmtUploadDate(last.enviado_em)}${last.enviado_por ? ' · ' + last.enviado_por : ''}`;
      return `<span class="src-item" title="${escAttr(tip)}"><strong>${meta.icon} ${meta.label}:</strong> <code>${escHtml(last.nome_arquivo)}</code> <span style="color:var(--text-soft);">(${escHtml(fmtUploadDateShort(last.enviado_em))})</span></span>`;
    });
    replaceWithParsedMarkup(el, '📎 ' + parts.join(' <span class="src-sep">·</span> '));
  });
}

export function installLegacyUploadUI({ runtime, excel, validateUpload }, target = window) {
  reportNonFatalError = runtime.reportNonFatalError;
  runAsyncSafely = runtime.runAsyncSafely;
  debouncedRender = runtime.debouncedRender;
  readExcelBuffer = excel.parseBuffer;
  readExcelFile = excel.parseFile;
  validateUploadFile = validateUpload;
  Object.assign(target, {
    MANUAL_TEXT,
    handleUpload,
    handleExcelUpload,
    toggleAdvancedUploads,
    renderUploadsCentral,
    openUploadsHistory,
    downloadUploadFile,
    marcarUploadComoAtivo,
    excluirUpload,
    renderSourcesHeaders,
  });
}
