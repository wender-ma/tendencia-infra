import { replaceWithParsedMarkup } from './dom.mjs';
import { escAttr, escHtml } from './formatters.mjs';

let reportNonFatalError;
let runAsyncSafely;
let debouncedRender;
let readExcelBuffer;
let readExcelFile;
let validateUploadFile;
let authToast;
let openModal;
let closeModal;
let confirmModal;
let UPLOADS_BUCKET;
let UPLOADS_MAX_PER_TYPE;
let UPLOAD_RUNTIME_STATE;
let sanitizeStoragePath;
let supaActivateUploadRecord;
let supaRollbackUploadActivation;
let supaListUploadsByType;
let supaListExcelGroups;
let supaGetDownloadURL;
let supaEnforceRollingBackup;
let supaEnforceDatasetRetention;
let supaCaptureDashboardRows;
let supaSaveAllData;
let restoreSavedData;
let setUploadRuntimeState;
let captureInMemoryUploadState;
let restoreInMemoryUploadState;
let commitPreparedUpload;
let SUPA;
let AUTH;
let isAdminGeral;
let authServiceCanEditProject;
let requireUploadPermission;
let requireProjectPermission;
let APP_STATE;
let parseTendencia;
let parseTendenciaFile;
let parseFlowsValor;
let parseGestoes;
let parseCSVRows;
let validateImportHeaders;
let discoverFlowProjectReferences;
let discoverGestoesProjectCodes;
let IMPORT_REPORTS;
let aplicarFallbackGestaoDoHistorico;
let atualizarGestaoLabelPelaHistoria;
let getProjectInfo;
let carregarObras;
let renderObrasDropdown;
let buildInsumosList;
let setInputOptions;
let buildDatalist;
let applyManuals;
let loadClassifications;
let requireAdmin;
let loadLatestTendencies;
const PROJECT_TENDENCY_UPLOADS = Object.create(null);
let projectUploadsLoadKey = '';
let projectUploadsLoading = false;
let projectUploadBusy = '';

// ============================================================
// v0.52 — Upload handler (refatorado pra usar Central de Uploads)
// ============================================================
function handleUpload(ev, kind /* 'tendencia' | 'flows' | 'gestoes' */) {
  if (!requireUploadPermission(kind, 'enviar este arquivo')) {
    ev.target.value = '';
    return;
  }
  // v0.58a: guard obra ativa (upload sem obra selecionada não faz sentido)
  if (!APP_STATE.obra.ativa) {
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
        APP_STATE.dados.tendencia = parsed;
        // fallback pra coluna Gestão vazia (virada de mês)
        aplicarFallbackGestaoDoHistorico();
        // rebuildar datalist de insumos após upload novo
        try {
          setInputOptions(buildInsumosList());
          buildDatalist();
        } catch (e) {
          reportNonFatalError('Upload/reconstruir lista de insumos', e);
        }
        linhas = APP_STATE.dados.tendencia.length;
        result = `TENDÊNCIA: ${linhas} linhas`;
      } else if (kind === 'flows') {
        const parsed = parseFlowsValor(txt);
        if (!parsed.length)
          throw new Error(
            'FLOWS: nenhum aditivo válido encontrado. Os dados atuais foram mantidos.',
          );
        APP_STATE.dados.flows = parsed;
        applyManuals();
        loadClassifications();
        linhas = APP_STATE.dados.flows.length;
        result = `FLOWS: ${linhas} aditivos`;
      } else if (kind === 'gestoes') {
        const parsed = parseGestoes(txt);
        // v0.57.1 FIX: só sobrescrever se realmente veio conteúdo (evita zerar APP_STATE.dados.historico com CSV/aba vazia)
        if (parsed && parsed.items && parsed.items.length > 0) {
          APP_STATE.dados.historico = parsed;
          // sobrescreve APP_STATE.config.gestaoLabel com última gestão cronológica
          atualizarGestaoLabelPelaHistoria();
          // se coluna Gestão da Tendência estiver vazia, usa APP_STATE.dados.historico como fallback
          aplicarFallbackGestaoDoHistorico();
        } else {
          console.warn('[GESTÕES] arquivo/aba veio vazio — mantendo dados anteriores');
          throw new Error(
            'Aba Gestões não retornou linhas válidas. Verifique a classificação financeira, as chaves de planejamento e os códigos das obras.',
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
      await runAsyncSafely(
        supaEnforceDatasetRetention([kind], UPLOADS_MAX_PER_TYPE),
        'Upload/limpeza de snapshots',
        'O upload foi concluído, mas snapshots antigos ficaram pendentes para limpeza.',
      );

      // Usar debounce para evitar múltiplas renderizações
      debouncedRender();
      renderUploadsCentral();
      renderSourcesHeaders();
      authToast('✅ ' + result + ' · 📦 arquivado e sincronizado', 'ok', 3500);
      showImportReport([kind], file.name);
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

async function handleProjectTendencyUpload(ev, projectCode) {
  const project = String(projectCode || '').trim();
  const input = ev.target;
  const file = input?.files?.[0];
  if (!project || !file) return;
  input.value = '';
  if (!requireProjectPermission(project, 'enviar a Tendência')) return;

  const isExcel = /\.(xlsx|xlsm|xls)$/i.test(file.name);
  const validation = validateUploadFile(file, isExcel ? 'excel' : 'csv');
  if (!validation.valid) {
    authToast('❌ ' + validation.message, 'err', 5000);
    return;
  }

  projectUploadBusy = project;
  setUploadRuntimeState('tendencia', 'processing', `Processando Tendência de ${project}`);
  renderUploadsCentral();
  try {
    let csv;
    if (isExcel) {
      const workbook = await readExcelFile(file);
      const sheetNames = workbook.sheetNames || [];
      const detected = _resolveExcelSheetMapping(workbook, ['tendencia']);
      let sheetName = detected.tendencia || (sheetNames.length === 1 ? sheetNames[0] : null);

      if (sheetNames.length > 1) {
        const confirmed = await _promptSheetMapping(sheetNames, detected, ['tendencia']);
        if (!confirmed) {
          setUploadRuntimeState('tendencia', 'idle');
          authToast('Upload de Tendência cancelado.', 'warn', 2500);
          return;
        }
        sheetName = confirmed.tendencia;
      }

      if (!sheetName) {
        throw new Error('Selecione a aba que contém os dados de Tendência.');
      }
      csv = _sheetToImportCSV(workbook, sheetName, 'tendencia');
      validateImportHeaders('tendencia', parseCSVRows(csv));
    } else {
      csv = await file.text();
      validateImportHeaders('tendencia', parseCSVRows(csv));
    }

    const parsed = parseTendenciaFile(csv);
    const dashboardData = {
      tendency: parsed.items,
      flows: APP_STATE.dados.flows,
      history: APP_STATE.dados.historico,
      projectionRaw: APP_STATE.dados.projRaw,
      managementLabel: parsed.managementLabel || APP_STATE.config.gestaoLabel,
      evolution: parsed.evolution,
      latestUploads: project === APP_STATE.obra.ativa ? APP_STATE.uploads : Object.create(null),
    };
    const result = await commitPreparedUpload({
      file,
      storageType: 'tendencia',
      items: [{ kind: 'tendencia', linhas: parsed.items.length }],
      memorySnapshot: null,
      projectCode: project,
      dashboardData,
      applyToCurrentState: project === APP_STATE.obra.ativa,
    });
    const activeRecord = result.records?.[0] || null;
    if (activeRecord) PROJECT_TENDENCY_UPLOADS[project] = activeRecord;

    if (project === APP_STATE.obra.ativa) {
      APP_STATE.dados.tendencia = parsed.items;
      APP_STATE.config.gestaoLabel = parsed.managementLabel || APP_STATE.config.gestaoLabel;
      APP_STATE.config.evolGlobal = parsed.evolution;
      APP_STATE.uploads.tendencia = activeRecord;
      try {
        setInputOptions(buildInsumosList());
        buildDatalist();
      } catch (error) {
        reportNonFatalError('Upload/reconstruir lista de insumos', error);
      }
      aplicarFallbackGestaoDoHistorico();
      debouncedRender();
      renderSourcesHeaders();
    }

    await runAsyncSafely(
      supaEnforceRollingBackup('tendencia', project),
      `Upload/limpeza de backups/${project}`,
      'O upload foi concluído, mas os backups antigos não puderam ser limpos.',
    );
    await runAsyncSafely(
      supaEnforceDatasetRetention(['tendencia'], UPLOADS_MAX_PER_TYPE, project),
      `Upload/limpeza de snapshots/${project}`,
      'O upload foi concluído, mas snapshots antigos ficaram pendentes para limpeza.',
    );
    authToast(
      `✅ Tendência de ${getProjectInfo?.(project)?.nome || project}: ${parsed.items.length.toLocaleString('pt-BR')} linhas sincronizadas`,
      'ok',
      4500,
    );
    IMPORT_REPORTS.tendencia = parsed.report;
    showImportReport(['tendencia'], file.name);
  } catch (error) {
    console.error('[Uploads/Tendência por obra]', error);
    setUploadRuntimeState('tendencia', 'failed', error.message || String(error));
    authToast('❌ Upload não concluído: ' + error.message, 'err', 7000);
  } finally {
    projectUploadBusy = '';
    renderUploadsCentral();
  }
}

// ============================================================
// v0.52 — Central de Uploads: renderização + drag-and-drop
// ============================================================
// ============================================================
// v0.54 — EXCEL UPLOAD MODULE
// Aceita 1 arquivo .xlsx/.xlsm com as bases globais (Flows e Gestões)
// e processa cada aba usando os parsers CSV existentes.
// ============================================================

// Padrões aplicados depois de normalizar acentos e separadores.
const EXCEL_SHEET_PATTERNS = {
  tendencia: [/(?:^|\s)tendencia/, /(?:^|\s)tend(?:\s|$)/],
  flows: [
    /(?:^|\s)aditivos?\s+flow\s*master(?:\s|$)/,
    /(?:^|\s)flow\s*master(?:\s|$)/,
    /(?:^|\s)flows?\s*valor(?:\s|$)/,
    /(?:^|\s)flows?(?:\s|$)/,
    /(?:^|\s)fluxos?(?:\s|$)/,
    /(?:^|\s)aditivos?(?:\s|$)/,
  ],
  gestoes: [/(?:^|\s)gestao(?:\s|$)/, /(?:^|\s)gestoes(?:\s|$)/],
};

function _normalizeSheetName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Tenta identificar automaticamente cada tipo pelo nome da aba.
// Retorna { tendencia: 'nomeAba' | null, flows: ..., gestoes: ... }
export function autoDetectExcelSheets(sheetNames) {
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

function _sheetHasValidHeaders(workbook, sheetName, kind) {
  try {
    validateImportHeaders(kind, parseCSVRows(_sheetToImportCSV(workbook, sheetName, kind)));
    return true;
  } catch {
    return false;
  }
}

function _resolveExcelSheetMapping(workbook, kinds) {
  const sheetNames = workbook?.sheetNames || [];
  const mapping = autoDetectExcelSheets(sheetNames);
  const used = new Set();

  for (const kind of kinds) {
    const sheetName = mapping[kind];
    if (sheetName && _sheetHasValidHeaders(workbook, sheetName, kind)) used.add(sheetName);
    else mapping[kind] = null;
  }

  for (const kind of kinds) {
    if (mapping[kind]) continue;
    const matches = sheetNames.filter(
      (sheetName) => !used.has(sheetName) && _sheetHasValidHeaders(workbook, sheetName, kind),
    );
    if (matches.length === 1) {
      mapping[kind] = matches[0];
      used.add(matches[0]);
    }
  }
  return mapping;
}

// Obtém o CSV preparado pelo Worker (os parsers existentes continuam independentes do Excel).
function _sheetToCSV(workbook, sheetName) {
  return workbook?.csvBySheet?.[sheetName] || '';
}

function _serializeCSVRows(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value ?? '');
          return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(';'),
    )
    .join('\n');
}

export function prepareImportCSV(csv, kind) {
  const rows = parseCSVRows(csv);
  const normalizedRows = normalizeImportTableRows(rows, kind);
  if (normalizedRows === rows) return csv;
  return _serializeCSVRows(normalizedRows);
}

export function normalizeImportTableRows(rows, kind, headerValidator = validateImportHeaders) {
  const searchLimit = Math.min(rows.length, 50);

  const hasValidHeader = (row) => {
    try {
      headerValidator(kind, [row]);
      return true;
    } catch {
      return false;
    }
  };

  for (let index = 0; index < searchLimit; index += 1) {
    const currentRow = rows[index] || [];
    if (hasValidHeader(currentRow)) return rows.slice(index);

    const nextRow = rows[index + 1];
    if (!nextRow) continue;
    const columnCount = Math.max(currentRow.length, nextRow.length);
    const combinedHeader = Array.from({ length: columnCount }, (_, columnIndex) => {
      const currentValue = currentRow[columnIndex];
      return String(currentValue ?? '').trim() ? currentValue : nextRow[columnIndex];
    });

    if (hasValidHeader(combinedHeader)) {
      return [combinedHeader, nextRow, ...rows.slice(index + 2)];
    }
  }

  return rows;
}

function _sheetToImportCSV(workbook, sheetName, kind) {
  return prepareImportCSV(_sheetToCSV(workbook, sheetName), kind);
}

function _preflightExcelHeaders(workbook, mapping, kinds = ['tendencia', 'flows', 'gestoes']) {
  const errors = [];
  for (const kind of kinds) {
    const sheetName = mapping[kind];
    if (!sheetName) continue;
    try {
      const csv = _sheetToImportCSV(workbook, sheetName, kind);
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
  if (!APP_STATE.obra.ativa) {
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

  const excelKinds = ['flows', 'gestoes'];
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

  // Identifica primeiro pelo nome da aba e confirma a opção pelos cabeçalhos.
  let mapping = _resolveExcelSheetMapping(workbook, excelKinds);
  const missing = excelKinds.filter((kind) => !mapping[kind]);

  if (missing.length > 0) {
    // Abrir modal pro usuário mapear manualmente
    _renderExcelProgress(null);
    const userMapping = await _promptSheetMapping(sheetNames, mapping, excelKinds);
    if (!userMapping) {
      setUploadRuntimeState(excelKinds, 'idle');
      authToast('❌ Upload cancelado', 'warn', 2500);
      return;
    }
    mapping = userMapping;
  } else {
    _renderExcelProgress(`✅ Auto-detectadas: 🔗 ${mapping.flows} · 📅 ${mapping.gestoes}`);
  }

  if (excelKinds.some((kind) => !mapping[kind])) {
    setUploadRuntimeState(excelKinds, 'failed', 'A planilha global exige Gestões e Flows');
    renderUploadsCentral();
    authToast('❌ Selecione as abas de Gestões e Flows para continuar.', 'err', 5000);
    return;
  }

  const headerErrors = _preflightExcelHeaders(workbook, mapping, excelKinds);
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

  // Processar as duas bases globais
  await _processExcelSheets(workbook, mapping, file);
}

// ============================================================
// Modal pra usuário mapear abas manualmente
// ============================================================
function _promptSheetMapping(
  sheetNames,
  autoDetected,
  allowedKinds = ['tendencia', 'flows', 'gestoes'],
) {
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
      <div class="meta">Confirme qual aba corresponde a cada fonte. As opções identificadas pelo nome ou pelos cabeçalhos já aparecem selecionadas.</div>
      <div class="sheet-mapping-fields">
        ${
          allowedKinds.includes('tendencia')
            ? `<div class="sheet-mapping-row">
          <label for="mapSheet_tendencia">📈 Tendência:</label>
          <select id="mapSheet_tendencia">${['<option value="">— nenhuma —</option>', ...sheetNames.map((n) => opt(n, autoDetected.tendencia))].join('')}</select>
        </div>`
            : ''
        }
        ${
          allowedKinds.includes('flows')
            ? `<div class="sheet-mapping-row">
          <label for="mapSheet_flows">🔗 Flows:</label>
          <select id="mapSheet_flows">${['<option value="">— nenhuma —</option>', ...sheetNames.map((n) => opt(n, autoDetected.flows))].join('')}</select>
        </div>`
            : ''
        }
        ${
          allowedKinds.includes('gestoes')
            ? `<div class="sheet-mapping-row">
          <label for="mapSheet_gestoes">📅 Gestões:</label>
          <select id="mapSheet_gestoes">${['<option value="">— nenhuma —</option>', ...sheetNames.map((n) => opt(n, autoDetected.gestoes))].join('')}</select>
        </div>`
            : ''
        }
        <p class="sheet-mapping-hint">
          💡 Se uma aba não existir na planilha, deixe em "— nenhuma —" e ela não será processada.
        </p>
      </div>
      <div class="sheet-mapping-actions">
        <button class="btn-sm" id="mapSheetsCancel">Cancelar</button>
        <button class="btn-sm primary" id="mapSheetsOk">✅ Processar</button>
      </div>
    `,
    );
    const finish = (result) => closeModal(result);
    document.getElementById('mapSheetsCancel').addEventListener('click', () => finish(null));
    document.getElementById('mapSheetsOk').addEventListener('click', () => {
      const r = {
        tendencia: document.getElementById('mapSheet_tendencia')?.value || null,
        flows: document.getElementById('mapSheet_flows')?.value || null,
        gestoes: document.getElementById('mapSheet_gestoes')?.value || null,
      };
      if (!r.tendencia && !r.flows && !r.gestoes) {
        authToast('⚠️ Selecione ao menos uma aba pra processar', 'warn', 3000);
        return;
      }
      finish(r);
    });
    openModal({
      onClose: (result) => resolve(result || null),
      initialFocus: allowedKinds.includes('tendencia')
        ? '#mapSheet_tendencia'
        : allowedKinds.includes('flows')
          ? '#mapSheet_flows'
          : '#mapSheet_gestoes',
    });
  });
}

function isSafeDiscoveredProjectCode(value) {
  const code = String(value || '').trim();
  return code.length <= 64 && code.includes('-') && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(code);
}

function discoverNewProjects(csvByKind) {
  const existingProjects = APP_STATE.obra.obras || [];
  const existingCodes = new Set(
    existingProjects.map((project) =>
      String(project.codigo_obra || '')
        .trim()
        .toLowerCase(),
    ),
  );
  const knownAliases = new Set();
  for (const project of existingProjects) {
    const code = String(project.codigo_obra || '').trim();
    if (!code) continue;
    knownAliases.add(code.toLowerCase());
    const parts = code.split('-');
    if (parts.length >= 2) knownAliases.add(parts.slice(1).join('-').toLowerCase());
  }

  const candidates = new Map();
  const addCandidate = (rawCode) => {
    const code = String(rawCode || '').trim();
    if (!isSafeDiscoveredProjectCode(code) || existingCodes.has(code.toLowerCase())) return;
    candidates.set(code.toLowerCase(), code);
  };

  if (csvByKind.gestoes) {
    discoverGestoesProjectCodes(csvByKind.gestoes).forEach(addCandidate);
  }

  const candidateAliases = new Set();
  for (const code of candidates.values()) {
    candidateAliases.add(code.toLowerCase());
    const parts = code.split('-');
    if (parts.length >= 2) candidateAliases.add(parts.slice(1).join('-').toLowerCase());
  }
  if (csvByKind.flows) {
    for (const reference of discoverFlowProjectReferences(csvByKind.flows)) {
      const normalized = String(reference || '')
        .trim()
        .toLowerCase();
      if (knownAliases.has(normalized) || candidateAliases.has(normalized)) continue;
      addCandidate(reference);
    }
  }

  return [...candidates.values()]
    .sort((left, right) => left.localeCompare(right, 'pt-BR'))
    .map((codigo_obra) => ({ codigo_obra, nome: codigo_obra }));
}

function promptNewProjects(projects) {
  return new Promise((resolve) => {
    const modalContent = document.getElementById('modalContent');
    if (!modalContent) {
      resolve(null);
      return;
    }
    replaceWithParsedMarkup(
      modalContent,
      `
        <h2>🏗️ Novas obras encontradas</h2>
        <div class="meta">Marque individualmente as obras que deseja cadastrar. As não selecionadas serão ignoradas neste upload.</div>
        <form id="newProjectsUploadForm" class="upload-project-preview" data-modal-form>
          ${projects
            .map(
              (project, index) => `
                <div class="upload-project-preview-row" data-project-row="${index}">
                  <label class="upload-project-preview-choice">
                    <input type="checkbox" data-project-enabled="${index}" checked aria-label="Cadastrar obra ${escAttr(project.codigo_obra)}">
                    <span>Cadastrar</span>
                  </label>
                  <span class="upload-project-preview-code"><strong>${escHtml(project.codigo_obra)}</strong><small>Código detectado</small></span>
                  <input type="text" data-project-name="${index}" value="${escAttr(project.nome)}" maxlength="160" required aria-label="Nome da obra ${escAttr(project.codigo_obra)}">
                </div>`,
            )
            .join('')}
          <p id="newProjectsSelectionSummary" class="upload-project-preview-summary" role="status"></p>
          <p class="upload-project-preview-note">As obras serão cadastradas com origem “Upload”. Elas poderão ser desativadas, mas não excluídas permanentemente.</p>
          <div class="sheet-mapping-actions">
            <button type="button" class="btn-sm" id="newProjectsCancel">Cancelar upload</button>
            <button type="submit" class="btn-sm primary">Continuar com selecionadas</button>
          </div>
        </form>
      `,
    );

    const updateSelection = () => {
      let selected = 0;
      projects.forEach((project, index) => {
        const checkbox = document.querySelector(`[data-project-enabled="${index}"]`);
        const nameInput = document.querySelector(`[data-project-name="${index}"]`);
        const enabled = checkbox?.checked === true;
        if (nameInput) {
          nameInput.disabled = !enabled;
          nameInput.required = enabled;
        }
        document
          .querySelector(`[data-project-row="${index}"]`)
          ?.classList.toggle('is-skipped', !enabled);
        if (enabled) selected += 1;
      });
      const summary = document.getElementById('newProjectsSelectionSummary');
      if (summary) {
        summary.textContent = `${selected} de ${projects.length} obra(s) selecionada(s) para cadastro.`;
      }
    };
    const finish = (result) => closeModal(result);
    document.getElementById('newProjectsCancel')?.addEventListener('click', () => finish(null));
    document.getElementById('newProjectsUploadForm')?.addEventListener('change', (event) => {
      if (event.target.matches('[data-project-enabled]')) updateSelection();
    });
    document.getElementById('newProjectsUploadForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const confirmed = projects
        .map((project, index) => {
          if (!document.querySelector(`[data-project-enabled="${index}"]`)?.checked) return null;
          return {
            ...project,
            nome:
              document.querySelector(`[data-project-name="${index}"]`)?.value.trim() ||
              project.codigo_obra,
          };
        })
        .filter(Boolean);
      finish(confirmed);
    });
    updateSelection();
    openModal({
      onClose: (result) => resolve(Array.isArray(result) ? result : null),
      initialFocus: '[data-project-enabled="0"]',
    });
  });
}

async function registerDiscoveredProjects(projects) {
  if (!projects.length) return { requestedCodes: [], createdCodes: [] };
  const rows = projects.map((project) => ({
    codigo_obra: project.codigo_obra,
    nome: project.nome || project.codigo_obra,
  }));
  const { data, error } = await SUPA.rpc('admin_register_upload_projects', {
    p_projects: rows,
  });
  if (error) throw error;
  await carregarObras();
  renderObrasDropdown();
  projectUploadsLoadKey = '';
  return {
    requestedCodes: data?.requested_codes || rows.map((project) => project.codigo_obra),
    createdCodes: data?.created_codes || [],
  };
}

async function rollbackDiscoveredProjects(codes) {
  if (!codes.length) return { deletedCodes: [], skippedCodes: [] };
  const { data, error } = await SUPA.rpc('admin_rollback_upload_projects', {
    p_codes: codes,
  });
  if (error) throw error;
  await carregarObras();
  renderObrasDropdown();
  projectUploadsLoadKey = '';
  return {
    deletedCodes: data?.deleted_codes || [],
    skippedCodes: data?.skipped_codes || [],
  };
}

// ============================================================
// Processar as abas selecionadas do Excel
// ============================================================
async function _processExcelSheets(workbook, mapping, file) {
  if (!requireAdmin('processar a planilha Excel completa')) return;
  await carregarObras({ strict: true });
  renderObrasDropdown();
  // Os registros globais do mesmo Excel compartilham este UUID.
  const groupId = _uuid4();
  const results = {};
  const memorySnapshot = captureInMemoryUploadState();
  const projectCatalogSnapshot = APP_STATE.obra.obras;
  let confirmedProjects = [];
  let registeredProjectCodes = [];

  // 1) Processar todas as abas antes de iniciar qualquer escrita remota.
  const steps = [
    { kind: 'flows', label: 'Flows', icon: '🔗', parser: 'flows' },
    { kind: 'gestoes', label: 'Gestões', icon: '📅', parser: 'gestoes' },
  ];
  const selectedKinds = steps.filter((step) => mapping[step.kind]).map((step) => step.kind);
  setUploadRuntimeState(['flows', 'gestoes'], 'idle');
  setUploadRuntimeState(selectedKinds, 'processing', 'Validando todas as abas da planilha');
  const csvByKind = Object.fromEntries(
    steps
      .filter((step) => mapping[step.kind])
      .map((step) => [step.kind, _sheetToImportCSV(workbook, mapping[step.kind], step.kind)]),
  );

  const discoveredProjects = discoverNewProjects(csvByKind);
  if (discoveredProjects.length) {
    _renderExcelProgress(
      `🏗️ ${discoveredProjects.length} nova(s) obra(s) aguardando confirmação...`,
    );
    confirmedProjects = await promptNewProjects(discoveredProjects);
    if (confirmedProjects === null) {
      setUploadRuntimeState(selectedKinds, 'idle');
      _renderExcelProgress(null);
      renderUploadsCentral();
      authToast('Upload cancelado. Nenhuma alteração foi realizada.', 'warn', 3500);
      return;
    }

    // Os parsers precisam reconhecer os novos codigos, mas o banco so e
    // alterado depois que todas as abas passarem na validacao.
    APP_STATE.obra.obras = [
      ...projectCatalogSnapshot,
      ...confirmedProjects.map((project) => ({
        ...project,
        ativa: true,
        origem: 'upload',
        hasActiveTendency: false,
      })),
    ];
  }

  for (const step of steps) {
    const sheetName = mapping[step.kind];
    if (!sheetName) {
      results[step.kind] = { skipped: true };
      continue;
    }

    _renderExcelProgress(`⚙️ Processando aba "${sheetName}" (${step.icon} ${step.label})...`);
    let csv;
    try {
      csv = csvByKind[step.kind];
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
        APP_STATE.dados.tendencia = parsed;
        // rebuildar datalist de insumos após upload novo
        try {
          setInputOptions(buildInsumosList());
          buildDatalist();
        } catch (e) {
          reportNonFatalError('Excel/reconstruir lista de insumos', e);
        }
        // fallback pra coluna Gestão vazia (virada de mês)
        aplicarFallbackGestaoDoHistorico();
        linhas = APP_STATE.dados.tendencia.length;
      } else if (step.parser === 'flows') {
        const parsed = parseFlowsValor(csv);
        if (!parsed.length) throw new Error('FLOWS: nenhum aditivo válido encontrado.');
        APP_STATE.dados.flows = parsed;
        applyManuals();
        loadClassifications();
        linhas = APP_STATE.dados.flows.length;
      } else if (step.parser === 'gestoes') {
        const parsed = parseGestoes(csv);
        // v0.57.1 FIX: só sobrescrever se realmente veio conteúdo (evita zerar APP_STATE.dados.historico com CSV/aba vazia)
        if (parsed && parsed.items && parsed.items.length > 0) {
          APP_STATE.dados.historico = parsed;
          // sobrescreve APP_STATE.config.gestaoLabel com última gestão cronológica
          atualizarGestaoLabelPelaHistoria();
          // se coluna Gestão da Tendência estiver vazia, usa APP_STATE.dados.historico como fallback
          aplicarFallbackGestaoDoHistorico();
        } else {
          console.warn('[GESTÕES] arquivo/aba veio vazio — mantendo dados anteriores');
          throw new Error(
            'Aba Gestões não retornou linhas válidas. Verifique a classificação financeira, as chaves de planejamento e os códigos das obras.',
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
    APP_STATE.obra.obras = projectCatalogSnapshot;
    renderObrasDropdown();
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
    APP_STATE.obra.obras = projectCatalogSnapshot;
    renderObrasDropdown();
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
    if (confirmedProjects.length) {
      _renderExcelProgress('🏗️ Cadastrando novas obras validadas...');
      const registration = await registerDiscoveredProjects(confirmedProjects);
      registeredProjectCodes = registration.createdCodes;
    }
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
    if (registeredProjectCodes.length) {
      try {
        const rollback = await rollbackDiscoveredProjects(registeredProjectCodes);
        if (rollback.skippedCodes.length) {
          authToast(
            `⚠️ O upload falhou e ${rollback.skippedCodes.length} obra(s) não puderam ser desfeitas automaticamente.`,
            'warn',
            7000,
          );
        }
      } catch (rollbackError) {
        reportNonFatalError('Upload/desfazer cadastro de obras', rollbackError);
        authToast(
          '⚠️ O upload falhou e o cadastro das novas obras precisa ser revisado no Admin.',
          'warn',
          7000,
        );
      }
    } else if (confirmedProjects.length) {
      APP_STATE.obra.obras = projectCatalogSnapshot;
      renderObrasDropdown();
    }
    setUploadRuntimeState(selectedKinds, 'failed', error.message || String(error));
    _renderExcelProgress(null);
    renderUploadsCentral();
    authToast('❌ Upload da planilha não concluído: ' + error.message, 'err', 8000);
    return;
  }

  if (confirmedProjects.length) {
    authToast(`✅ ${confirmedProjects.length} obra(s) confirmada(s) no cadastro.`, 'ok', 3500);
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
  await runAsyncSafely(
    supaEnforceDatasetRetention(
      processedItems.map((item) => item.kind),
      UPLOADS_MAX_PER_TYPE,
    ),
    'Excel/limpeza de snapshots',
    'A planilha foi concluída, mas snapshots antigos ficaram pendentes para limpeza.',
  );

  // 2) Re-render apenas depois do commit completo.
  debouncedRender();
  renderUploadsCentral();
  renderSourcesHeaders();
  _renderExcelProgress(null);

  // 3) Toast de resumo
  const ok = Object.entries(results).filter(([_key, value]) => value.ok);
  const skipped = Object.entries(results).filter(([_key, value]) => value.skipped);
  const parts = [];
  if (ok.length) parts.push(`✅ ${ok.length} aba(s) processada(s)`);
  if (skipped.length) parts.push(`⏭️ ${skipped.length} pulada(s)`);
  authToast('📊 ' + parts.join(' · ') + ' · 📦 sincronizado', 'ok', 5000);
  showImportReport(
    processedItems.map((item) => item.kind),
    file.name,
  );
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
    card.hidden = true;
    card.setAttribute('aria-hidden', 'true');
    return;
  }
  card.setAttribute('aria-hidden', 'false');
  card.hidden = false;
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
    (open ? '▼' : '▶') + ' <strong>Uploads individuais</strong> — enviar cada base separadamente',
  );
}

const UPLOAD_META = {
  tendencia: {
    label: 'TENDÊNCIA',
    icon: '📈',
    desc: 'Alimenta: KPIs da Visão Geral, tabela de Detalhamento, curva S de Tendência de Obra e Controle de Projeção. Fonte: aba TENDÊNCIA da planilha.',
    manualKey: 'tendencia',
  },
  flows: {
    label: 'FLOWS / ADITIVOS',
    icon: '🔗',
    desc: 'Base consolidada compartilhada. Alimenta Flows/Aditivos, a decomposição do desvio e o Controle de Projeção de todas as obras.',
    manualKey: 'flows',
    global: true,
  },
  gestoes: {
    label: 'GESTÕES 🌐',
    icon: '📅',
    desc: 'Base consolidada compartilhada. Alimenta o Histórico Mensal e a Curva S de todas as obras.',
    manualKey: 'gestoes',
    global: true,
  },
};

function showImportReport(kinds, fileName) {
  const reports = (Array.isArray(kinds) ? kinds : [kinds])
    .map((kind) => ({ kind, report: IMPORT_REPORTS?.[kind] }))
    .filter(({ report }) => report);
  if (!reports.length) return;

  const rows = reports
    .map(({ kind, report }) => {
      const meta = UPLOAD_META[kind];
      const reasons = Object.entries(report.reasons || {})
        .sort((left, right) => right[1] - left[1])
        .map(
          ([reason, count]) =>
            `<li><span>${escHtml(reason)}</span><strong>${Number(count).toLocaleString('pt-BR')}</strong></li>`,
        )
        .join('');
      const unknownProjects = Array.isArray(report.unknownProjects)
        ? report.unknownProjects.filter(Boolean)
        : [];
      const reconciliation = [];
      if (report.preservedFlowValues) {
        reconciliation.push(
          `${Number(report.preservedFlowValues).toLocaleString('pt-BR')} valor(es) anterior(es) preservado(s)`,
        );
      }
      if (report.estimatedValueFallbacks) {
        reconciliation.push(
          `${Number(report.estimatedValueFallbacks).toLocaleString('pt-BR')} aditivo(s) novo(s) preenchido(s) pelo valor estimado`,
        );
      }
      return `
        <section class="upload-report-section">
          <h3>${meta.icon} ${escHtml(meta.label)}</h3>
          <div class="upload-report-metrics">
            <span><strong>${Number(report.total || 0).toLocaleString('pt-BR')}</strong>Total</span>
            <span class="is-success"><strong>${Number(report.accepted || 0).toLocaleString('pt-BR')}</strong>Aceitas</span>
            <span class="is-warning"><strong>${Number(report.ignored || 0).toLocaleString('pt-BR')}</strong>Ignoradas</span>
            <span class="is-danger"><strong>${Number(report.rejected || 0).toLocaleString('pt-BR')}</strong>Rejeitadas</span>
          </div>
          ${
            reasons
              ? `<div class="upload-report-details"><strong>Motivos</strong><ul>${reasons}</ul></div>`
              : ''
          }
          ${
            unknownProjects.length
              ? `<div class="upload-report-alert"><strong>Obras não reconhecidas:</strong> ${unknownProjects.map((value) => escHtml(value)).join(', ')}</div>`
              : ''
          }
          ${
            reconciliation.length
              ? `<div class="upload-report-alert"><strong>Reconciliação:</strong> ${escHtml(reconciliation.join(' · '))}</div>`
              : ''
          }
        </section>`;
    })
    .join('');

  replaceWithParsedMarkup(
    document.getElementById('modalContent'),
    `
      <h2>📋 Relatório da importação</h2>
      <div class="meta">Arquivo: <strong>${escHtml(fileName || 'arquivo importado')}</strong></div>
      <div class="upload-report">${rows}</div>
      <div class="sheet-mapping-actions">
        <button class="btn-sm primary" data-click-action="closeModal">Concluir</button>
      </div>
    `,
  );
  openModal({ initialFocus: '[data-click-action="closeModal"]' });
}

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
    return `<div role="status" class="upload-card-meta upload-card-meta--processing">⏳ ${escHtml(processing.message || 'Upload em processamento...')}</div>`;
  }
  const failed = states.find((state) => state.status === 'failed');
  if (failed) {
    return `<div role="alert" class="upload-card-meta upload-card-meta--failed">❌ Última tentativa não foi aplicada: ${escHtml(failed.message || 'falha desconhecida')}</div>`;
  }
  return '';
}

function renderUploadSummary(record, emptyText) {
  if (!record) {
    return `<div class="upload-card-meta empty">📭 ${escHtml(emptyText)}</div>`;
  }
  const details = [
    record.tamanho_bytes ? fmtBytes(record.tamanho_bytes) : null,
    record.linhas ? `${record.linhas.toLocaleString('pt-BR')} linhas` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `
    <div class="upload-card-meta filled">
      📁 <strong>${escHtml(record.nome_arquivo)}</strong>${details ? ` <span class="upload-meta-detail">(${details})</span>` : ''}<br>
      📅 ${escHtml(fmtUploadDate(record.enviado_em))}${record.enviado_por ? ` · ${escHtml(record.enviado_por)}` : ''}
    </div>`;
}

function refreshProjectTendencyUploadCards(projects) {
  const root = document.getElementById('uploadsCentral');
  if (!root) return;

  const cards = [...root.querySelectorAll('.project-tendency-card')];
  for (const project of projects) {
    const code = String(project.codigo_obra || '').trim();
    const card = cards.find((item) => item.dataset.project === code);
    if (!card) continue;

    const canEdit = authServiceCanEditProject(code);
    const latest =
      (canEdit && PROJECT_TENDENCY_UPLOADS[code]) ||
      (canEdit && code === APP_STATE.obra.ativa ? APP_STATE.uploads.tendencia : null);
    replaceWithParsedMarkup(
      card.querySelector('.project-tendency-upload-summary'),
      renderUploadSummary(latest, 'Nenhuma Tendência enviada para esta obra.'),
    );

    const uploadButton = card.querySelector('[data-file-target]');
    if (uploadButton) {
      uploadButton.textContent = `📤 ${latest ? 'Substituir Tendência' : 'Enviar Tendência'}`;
    }
  }
}

async function refreshProjectTendencyUploads(projects) {
  if (!AUTH?.user || projectUploadsLoading) return;
  const codes = projects.map((project) => project.codigo_obra).filter(Boolean);
  const key = `${AUTH.user.id || AUTH.user.email || 'user'}:${codes.join('|')}`;
  if (!codes.length || key === projectUploadsLoadKey) return;
  projectUploadsLoadKey = key;
  projectUploadsLoading = true;
  try {
    const latest = await loadLatestTendencies(codes);
    for (const code of codes) PROJECT_TENDENCY_UPLOADS[code] = latest[code] || null;
  } finally {
    projectUploadsLoading = false;
    refreshProjectTendencyUploadCards(projects);
  }
}

function renderUploadsCentral() {
  const root = document.getElementById('uploadsCentral');
  if (!root) return;
  const projects = (APP_STATE.obra.obras || [])
    .filter((project) => project.ativa)
    .sort((a, b) =>
      String(a.nome || a.codigo_obra).localeCompare(String(b.nome || b.codigo_obra), 'pt-BR'),
    );
  const globalKinds = ['flows', 'gestoes'];
  const globalRecords = globalKinds.map((kind) => APP_STATE.uploads[kind]).filter(Boolean);
  const lastGlobal = [...globalRecords].sort(
    (a, b) => new Date(b.enviado_em) - new Date(a.enviado_em),
  )[0];
  const globalProcessing = globalKinds.some(
    (kind) => UPLOAD_RUNTIME_STATE[kind]?.status === 'processing',
  );

  const projectCards = projects
    .map((project, index) => {
      const code = String(project.codigo_obra || '').trim();
      const name = project.nome || code;
      const canEdit = authServiceCanEditProject(code);
      const latest =
        (canEdit && PROJECT_TENDENCY_UPLOADS[code]) ||
        (canEdit && code === APP_STATE.obra.ativa ? APP_STATE.uploads.tendencia : null);
      const busy = projectUploadBusy === code;
      return `
        <article class="project-tendency-card upload-card" data-kind="tendencia" data-project="${escAttr(code)}">
          <div class="project-tendency-heading">
            <div>
              <h3 class="upload-card-title">🏗️ ${escHtml(name)}</h3>
              <code>${escHtml(code)}</code>
            </div>
            ${code === APP_STATE.obra.ativa ? '<span class="upload-active-project">SELECIONADA</span>' : ''}
          </div>
          ${busy ? renderUploadRuntimeBlock('tendencia') : ''}
          <div class="project-tendency-upload-summary">
            ${renderUploadSummary(latest, 'Nenhuma Tendência enviada para esta obra.')}
          </div>
          <div class="upload-card-actions">
            <button class="btn-sm primary" ${canEdit && !busy ? '' : 'disabled'} data-click-action="" data-file-target="fileInput_tendencia_${index}">
              📤 ${latest ? 'Substituir Tendência' : 'Enviar Tendência'}
            </button>
            <button class="btn-sm" ${canEdit ? '' : 'disabled'} data-click-action="openProjectTendencyHistory" data-action-mode="arg" data-action-arg="${escAttr(code)}">
              📜 Histórico da obra
            </button>
            <input type="file" id="fileInput_tendencia_${index}" class="upload-file-input" accept=".xlsx,.xlsm,.xls,.csv" aria-label="Selecionar Tendência de ${escAttr(name)}" data-change-action="handleProjectTendencyUpload" data-action-mode="event-arg" data-action-arg="${escAttr(code)}">
          </div>
        </article>`;
    })
    .join('');

  replaceWithParsedMarkup(
    root,
    `
      <section class="upload-global-section">
        <div class="upload-section-heading">
          <div>
            <span class="upload-scope-kicker">BASE COMPARTILHADA</span>
            <h3>🌐 Gestões + Flows</h3>
          </div>
          <span class="upload-global-badge">ADMIN</span>
        </div>
        <p>Uma única planilha atualiza as bases consolidadas usadas por todas as obras.</p>
        <div class="upload-excel-card" id="excelUploadCard">
          <div class="upload-impact-grid upload-impact-grid--global" aria-label="Escopo da base global">
            <span><strong>🔗 Flows</strong><small>Todas as obras</small></span>
            <span><strong>📅 Gestões</strong><small>Todas as obras</small></span>
          </div>
          ${renderUploadRuntimeBlock(globalKinds)}
          ${renderUploadSummary(lastGlobal, 'Nenhuma base global enviada ainda.')}
          <div class="upload-progress" role="status" aria-live="polite" aria-atomic="true" aria-hidden="true" hidden></div>
          <div class="upload-card-actions">
            <button class="btn-sm primary" data-admin-control ${isAdminGeral() && !globalProcessing ? '' : 'disabled'} data-click-action="" data-file-target="fileInput_excel">
              📊 ${lastGlobal ? 'Substituir base global' : 'Enviar Gestões + Flows'}
            </button>
            <button class="btn-sm" data-click-action="openExcelUploadsHistory">📜 Histórico global</button>
            <input type="file" id="fileInput_excel" class="upload-file-input" accept=".xlsx,.xlsm,.xls" aria-label="Selecionar planilha global com Gestões e Flows" data-change-action="handleExcelUpload" data-action-mode="event">
          </div>
        </div>
      </section>
      <section class="upload-projects-section">
        <div class="upload-section-heading">
          <div>
            <span class="upload-scope-kicker">TENDÊNCIAS INDIVIDUAIS</span>
            <h3>🏗️ Obras</h3>
          </div>
          <span class="upload-project-count">${projects.length} obra(s)</span>
        </div>
        <p>Cada arquivo de Tendência é salvo exclusivamente na obra indicada.</p>
        <div class="project-tendency-grid">
          ${projectCards || '<div class="uploads-history-empty">Nenhuma obra ativa cadastrada.</div>'}
        </div>
      </section>
    `,
  );

  const excelCard = root.querySelector('#excelUploadCard');
  if (excelCard) {
    excelCard.addEventListener('dragover', (event) => {
      event.preventDefault();
      excelCard.classList.add('dragover');
    });
    excelCard.addEventListener('dragleave', () => excelCard.classList.remove('dragover'));
    excelCard.addEventListener('drop', (event) => {
      event.preventDefault();
      excelCard.classList.remove('dragover');
      const file = event.dataTransfer.files[0];
      if (file) handleExcelUpload({ target: { files: [file], value: '' } });
    });
  }

  root.querySelectorAll('.project-tendency-card').forEach((card) => {
    card.addEventListener('dragover', (event) => {
      event.preventDefault();
      card.classList.add('dragover');
    });
    card.addEventListener('dragleave', () => card.classList.remove('dragover'));
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      card.classList.remove('dragover');
      const file = event.dataTransfer.files[0];
      if (file) {
        handleProjectTendencyUpload({ target: { files: [file], value: '' } }, card.dataset.project);
      }
    });
  });
  void refreshProjectTendencyUploads(projects);
}

// modal com histórico completo de uploads de um tipo
function openProjectTendencyHistory(projectCode) {
  if (!requireProjectPermission(projectCode, 'consultar o histórico desta obra')) return;
  return openUploadsHistory('tendencia', projectCode);
}

async function openUploadsHistory(kind, projectCode = null) {
  const meta = UPLOAD_META[kind];
  if (!meta) return;
  const project = String(projectCode || APP_STATE.obra.ativa || '').trim();
  const projectName = getProjectInfo?.(project)?.nome || project;
  const modalContent = document.getElementById('modalContent');
  if (!modalContent) return;
  replaceWithParsedMarkup(
    modalContent,
    `
    <h2>📜 Histórico de uploads — ${meta.icon} ${meta.label}</h2>
    <div class="meta">${meta.global ? 'Histórico global compartilhado entre todas as obras.' : `Histórico exclusivo de ${escHtml(projectName)}.`} Mantemos as últimas <strong>${UPLOADS_MAX_PER_TYPE}</strong> versões.</div>
    <div id="uploadsHistoryList" class="uploads-history-list">⏳ Carregando...</div>
  `,
  );
  openModal();
  await _renderUploadsHistoryList(kind, project);
}

async function openExcelUploadsHistory() {
  if (!requireAdmin('consultar o histórico de planilhas completas')) return;
  const modalContent = document.getElementById('modalContent');
  if (!modalContent) return;
  replaceWithParsedMarkup(
    modalContent,
    `
      <h2>📊 Histórico de planilhas completas</h2>
      <div class="meta">Cada envio aparece uma única vez, com todas as abas processadas e seus escopos.</div>
      <div id="excelUploadsHistoryList" class="uploads-history-list">⏳ Carregando...</div>
    `,
  );
  openModal();
  const groups = await supaListExcelGroups(UPLOADS_MAX_PER_TYPE);
  const box = document.getElementById('excelUploadsHistoryList');
  if (!box) return;
  if (!groups.length) {
    replaceWithParsedMarkup(
      box,
      '<div class="uploads-history-empty">Nenhuma planilha completa registrada ainda.</div>',
    );
    return;
  }
  replaceWithParsedMarkup(
    box,
    `
      <table class="uploads-history-table">
        <thead>
          <tr>
            <th>Data / Hora</th>
            <th>Arquivo</th>
            <th>Obra da Tendência</th>
            <th>Abas processadas</th>
            <th>Enviado por</th>
            <th>Ação</th>
          </tr>
        </thead>
        <tbody>
          ${groups
            .map((group) => {
              const tendencyRecord = group.records.find((record) => record.tipo === 'tendencia');
              const kinds = group.records.map((record) => {
                const meta = UPLOAD_META[record.tipo];
                const active = record.is_active ? ' · ativo' : '';
                return `${meta?.icon || ''} ${meta?.label || record.tipo}${active}`;
              });
              return `
                <tr>
                  <td>${escHtml(fmtUploadDate(group.enviado_em))}</td>
                  <td class="uploads-history-file">${escHtml(group.nome_arquivo)}<br><small>${fmtBytes(group.tamanho_bytes)}</small></td>
                  <td>${escHtml(tendencyRecord?.codigo_obra || 'Não incluída')}</td>
                  <td>${kinds.map((value) => `<span class="upload-kind-chip">${escHtml(value)}</span>`).join('')}</td>
                  <td>${escHtml(group.enviado_por || 'não informado')}</td>
                  <td><button class="btn-sm" data-action="download-upload" data-path="${escAttr(group.storage_path)}" data-filename="${escAttr(group.nome_arquivo)}">📥 Baixar</button></td>
                </tr>`;
            })
            .join('')}
        </tbody>
      </table>
      <div class="uploads-history-help">Para restaurar uma aba específica, abra o histórico de Tendência, Flows ou Gestões e ative a versão desejada.</div>
    `,
  );
  box.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="download-upload"]');
    if (button) downloadUploadFile(button.dataset.path, button.dataset.filename);
  });
}

// extraído em função separada pra poder re-renderizar após ações (ativar/excluir)
async function _renderUploadsHistoryList(kind, projectCode = null) {
  const meta = UPLOAD_META[kind];
  const project = String(projectCode || APP_STATE.obra.ativa || '').trim();
  const list = await supaListUploadsByType(kind, UPLOADS_MAX_PER_TYPE + 5, false, project);
  const box = document.getElementById('uploadsHistoryList');
  if (!box) return;
  if (!list.length) {
    replaceWithParsedMarkup(
      box,
      '<div class="uploads-history-empty">Nenhum upload registrado ainda.</div>',
    );
    return;
  }
  const isEditor = authServiceCanEditProject(project);
  const isGlobal = meta.global === true;
  const canManage = isGlobal ? isAdminGeral() : isEditor;
  replaceWithParsedMarkup(
    box,
    `
    <table class="uploads-history-table">
      <thead>
        <tr class="uploads-history-heading">
          <th>Data / Hora</th>
          <th>Arquivo</th>
          <th>Tamanho</th>
          <th>Linhas</th>
          <th>Enviado por</th>
          <th class="uploads-history-actions-heading">Ações</th>
        </tr>
      </thead>
      <tbody>
        ${list
          .map((r) => {
            const isAtivo = !!r.is_active;
            const cleanStoragePath = sanitizeStoragePath(r.storage_path);
            const pathParts = cleanStoragePath.split('/');
            const pathIsGlobal =
              pathParts[0] === '_global' || ['excel', 'flows', 'gestoes'].includes(pathParts[1]);
            const hasValidStoragePath = !!cleanStoragePath;
            const canDownload =
              hasValidStoragePath &&
              AUTH &&
              AUTH.user &&
              (pathIsGlobal || isGlobal ? isAdminGeral() : isEditor);
            const canReativar = canManage && !isAtivo && !!r.storage_path;
            const canExcluir = canManage && !isAtivo; // BLOQUEADO se ativo
            const btnDownload = canDownload
              ? `<button class="btn-sm" data-action="download-upload" data-project="${escAttr(project)}" data-path="${escAttr(cleanStoragePath)}" data-filename="${escAttr(r.nome_arquivo)}" title="Baixar arquivo" aria-label="Baixar ${escAttr(r.nome_arquivo)}">📥</button>`
              : cleanStoragePath
                ? `<span class="uploads-history-unavailable" title="Sem permissão para baixar este arquivo">🔒</span>`
                : `<span class="uploads-history-unavailable" title="Upload anterior à v0.53, arquivo não foi armazenado">—</span>`;
            const btnAtivar =
              canReativar && hasValidStoragePath
                ? `<button class="btn-sm primary" data-action="ativar-upload" data-project="${escAttr(project)}" data-id="${r.id}" data-kind="${escAttr(kind)}" title="Usar este arquivo como fonte de dados">⭐ Ativar</button>`
                : isAtivo
                  ? ''
                  : `<span class="uploads-history-unavailable" title="Arquivo sem storage_path — não pode ser reativado">—</span>`;
            const btnExcluir = canExcluir
              ? `<button class="btn-sm danger uploads-history-delete" data-action="excluir-upload" data-project="${escAttr(project)}" data-id="${r.id}" data-kind="${escAttr(kind)}" title="Excluir arquivo" aria-label="Excluir ${escAttr(r.nome_arquivo)}">🗑️</button>`
              : isAtivo && canManage
                ? `<span class="uploads-history-unavailable" title="Ative outro arquivo antes de excluir este">🔒</span>`
                : '';
            return `
            <tr class="uploads-history-row ${isAtivo ? 'is-active' : ''}">
              <td>${escHtml(fmtUploadDate(r.enviado_em))} ${isAtivo ? '<span class="uploads-history-active">📌 ATIVO</span>' : ''}</td>
              <td class="uploads-history-file">${escHtml(r.nome_arquivo)}</td>
              <td class="uploads-history-muted">${fmtBytes(r.tamanho_bytes)}</td>
              <td class="uploads-history-muted">${r.linhas != null ? r.linhas.toLocaleString('pt-BR') : '-'}</td>
              <td class="uploads-history-sender">${r.enviado_por ? escHtml(r.enviado_por) : '<em>anônimo</em>'}</td>
              <td class="uploads-history-actions-cell">
                <span class="uploads-history-actions">${btnDownload} ${btnAtivar} ${btnExcluir}</span>
              </td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
    <div class="uploads-history-help">
      💡 <strong>Ativar:</strong> marca esse arquivo como fonte de dados do dashboard (substitui o atual sem apagar).<br>
      🗑️ <strong>Excluir:</strong> apaga permanentemente do banco e Storage. Só permitido em arquivos não-ativos.<br>
      📌 <strong>Ativo:</strong> arquivo cujos dados estão sendo usados no dashboard agora.<br>
      🔄 <strong>Rolling backup:</strong> mantém apenas os últimos ${UPLOADS_MAX_PER_TYPE} arquivos. Ativo nunca é descartado automaticamente.
      ${isGlobal ? `<br>🌐 <strong>${escHtml(meta.label)} é compartilhado:</strong> trocar o ativo afeta TODAS as obras.` : ''}
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
      if (action === 'download-upload')
        downloadUploadFile(btn.dataset.path, btn.dataset.filename, btn.dataset.project);
      else if (action === 'ativar-upload')
        marcarUploadComoAtivo(parseInt(btn.dataset.id, 10), btn.dataset.kind, btn.dataset.project);
      else if (action === 'excluir-upload')
        excluirUpload(parseInt(btn.dataset.id, 10), btn.dataset.kind, btn.dataset.project);
    });
  }
}

async function downloadUploadFile(storagePath, filename, projectCode = null) {
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
  const url = await supaGetDownloadURL(cleanPath, projectCode);
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
async function marcarUploadComoAtivo(uploadId, kind, projectCode = null) {
  const meta = UPLOAD_META[kind];
  const isGlobal = meta && meta.global === true;
  const project = String(projectCode || APP_STATE.obra.ativa || '').trim();
  if (
    isGlobal
      ? !requireUploadPermission(kind, 'trocar este arquivo ativo')
      : !requireProjectPermission(project, 'trocar este arquivo ativo')
  )
    return;
  // Aviso especial pra Gestões (global)
  if (isGlobal) {
    const confirmed = await confirmModal(
      `Ativar base global de ${meta.label}`,
      `Trocar o arquivo ativo de ${meta.label} atualizará os dados de TODAS as obras cadastradas.`,
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
  let dashboardPersistence = null;
  let dashboardPersisted = false;
  let activation = null;
  let alvo = null;
  let parsedTendency = null;
  let scopedDashboardData = null;
  setUploadRuntimeState(kind, 'processing', 'Validando e ativando arquivo do histórico');
  try {
    // 1) Buscar o registro alvo
    const { data: targetRecord, error: readErr } = await SUPA.from('upload_history')
      .select('*')
      .eq('id', uploadId)
      .maybeSingle();
    alvo = targetRecord;
    if (readErr || !alvo) throw new Error('Arquivo não encontrado no banco');
    if (!isGlobal && alvo.codigo_obra !== project)
      throw new Error('Arquivo fora do escopo da obra informada');
    if (!alvo.storage_path)
      throw new Error(
        'Arquivo não tem cópia no Storage (upload muito antigo). Impossível reativar.',
      );
    // 2) Baixar o arquivo do Storage
    const url = await supaGetDownloadURL(alvo.storage_path, project);
    if (!url) throw new Error('Falha ao gerar link de download do arquivo');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Falha ao baixar arquivo: HTTP ' + resp.status);
    const isExcel = /\.xlsx?$|\.xlsm$/i.test(alvo.nome_arquivo);
    // 3) Re-parseia
    if (isExcel) {
      const buf = await resp.arrayBuffer();
      const wb = await readExcelBuffer(buf);
      const sheetNames = wb.sheetNames || [];
      const mapping = autoDetectExcelSheets(sheetNames);
      // Só processa a aba correspondente ao tipo
      const sheetName =
        mapping[kind] || (kind === 'tendencia' && sheetNames.length === 1 ? sheetNames[0] : null);
      if (!sheetName) throw new Error(`Aba correspondente a "${kind}" não encontrada no Excel`);
      const csv = _sheetToImportCSV(wb, sheetName, kind);
      if (kind === 'tendencia') {
        parsedTendency = parseTendenciaFile(csv);
      } else {
        _parsearECarregar(kind, csv);
      }
    } else {
      // CSV direto
      const csv = await resp.text();
      if (kind === 'tendencia') {
        parsedTendency = parseTendenciaFile(csv);
      } else {
        _parsearECarregar(kind, csv);
      }
    }
    if (parsedTendency) {
      scopedDashboardData = {
        tendency: parsedTendency.items,
        flows: APP_STATE.dados.flows,
        history: APP_STATE.dados.historico,
        projectionRaw: APP_STATE.dados.projRaw,
        managementLabel: parsedTendency.managementLabel || APP_STATE.config.gestaoLabel,
        evolution: parsedTendency.evolution,
        latestUploads: project === APP_STATE.obra.ativa ? APP_STATE.uploads : Object.create(null),
      };
    }
    // 4) Persistir antes de ativar; ambos possuem compensação em caso de falha.
    const scope = scopedDashboardData
      ? { projectCode: project, dashboardData: scopedDashboardData }
      : {};
    dashboardSnapshot = await supaCaptureDashboardRows([kind], scope);
    dashboardPersistence = await supaSaveAllData([kind], dashboardSnapshot, [alvo], scope);
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
        await restoreSavedData(dashboardSnapshot, dashboardPersistence);
      } catch (cleanupError) {
        cleanupErrors.push('dados anteriores: ' + cleanupError.message);
      }
    }
    if (!parsedTendency || project === APP_STATE.obra.ativa) {
      restoreInMemoryUploadState(memorySnapshot);
    }
    setUploadRuntimeState(kind, 'failed', e.message || String(e));
    renderUploadsCentral();
    authToast('❌ Erro ao ativar: ' + e.message, 'err', 5000);
    if (cleanupErrors.length) {
      authToast('⚠️ A recuperação ficou parcial: ' + cleanupErrors.join('; '), 'warn', 8000);
    }
    return;
  }

  if (kind === 'tendencia') {
    PROJECT_TENDENCY_UPLOADS[project] = activation.active;
    if (project === APP_STATE.obra.ativa && parsedTendency) {
      APP_STATE.dados.tendencia = parsedTendency.items;
      APP_STATE.config.gestaoLabel = parsedTendency.managementLabel || APP_STATE.config.gestaoLabel;
      APP_STATE.config.evolGlobal = parsedTendency.evolution;
      APP_STATE.uploads.tendencia = activation.active;
      try {
        setInputOptions(buildInsumosList());
        buildDatalist();
      } catch (error) {
        reportNonFatalError('Histórico/reconstruir lista de insumos', error);
      }
      aplicarFallbackGestaoDoHistorico();
    }
  } else {
    APP_STATE.uploads[kind] = activation.active;
  }
  setUploadRuntimeState(kind, 'active');
  debouncedRender();
  renderUploadsCentral();
  renderSourcesHeaders();
  await _renderUploadsHistoryList(kind, project);
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
    APP_STATE.dados.tendencia = parsed;
    // rebuildar datalist de insumos após upload novo
    try {
      setInputOptions(buildInsumosList());
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
    APP_STATE.dados.flows = parsed;
    applyManuals();
    loadClassifications();
  } else if (kind === 'gestoes') {
    if (!firstLines.includes('Descr_gestao') && !firstLines.includes('Key_planejamento')) {
      throw new Error('CSV Gestões em formato inesperado');
    }
    const parsed = parseGestoes(csv);
    if (parsed && parsed.items && parsed.items.length > 0) {
      APP_STATE.dados.historico = parsed;
      atualizarGestaoLabelPelaHistoria();
    } else {
      throw new Error('CSV Gestões não retornou linhas válidas');
    }
  }
}

// Exclui um upload específico (bloqueado se for o ativo — check no HTML)
async function excluirUpload(uploadId, kind, projectCode = null) {
  const isGlobal = UPLOAD_META[kind]?.global === true;
  const project = String(projectCode || APP_STATE.obra.ativa || '').trim();
  if (
    isGlobal
      ? !requireUploadPermission(kind, 'excluir este arquivo')
      : !requireProjectPermission(project, 'excluir este arquivo')
  )
    return;
  try {
    // Buscar pra confirmar que não é o ativo
    const { data: rec, error: readErr } = await SUPA.from('upload_history')
      .select('id, nome_arquivo, storage_path, is_active, codigo_obra')
      .eq('id', uploadId)
      .maybeSingle();
    if (readErr || !rec) throw new Error('Arquivo não encontrado');
    if (!isGlobal && rec.codigo_obra !== project)
      throw new Error('Arquivo fora do escopo da obra informada');
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
        .eq('storage_path', cleanStoragePath)
        .neq('id', uploadId)
        .limit(1);
      if (referenceError) throw referenceError;
      removeStoredFile = !otherReferences?.length;
    }
    // Remove primeiro o metadata para nunca deixar o histórico apontando para arquivo ausente.
    let deleteQuery = SUPA.from('upload_history').delete().eq('id', uploadId);
    if (!isGlobal) deleteQuery = deleteQuery.eq('codigo_obra', project);
    const { error: dbErr } = await deleteQuery;
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
    await _renderUploadsHistoryList(kind, project);
    authToast(`✅ Arquivo excluído`, 'ok', 3000);
  } catch (e) {
    console.error('[v0.60] excluirUpload:', e);
    authToast('❌ Erro ao excluir: ' + e.message, 'err', 5000);
  }
}

function renderSourcesHeaders() {
  document.querySelectorAll('.sources-header').forEach((el) => {
    const configuredKinds = (el.dataset.sources || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const headKinds = (el.dataset.headSources || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const kinds = [...headKinds, ...configuredKinds];
    const parts = kinds.map((k) => {
      const meta = UPLOAD_META[k];
      const last = APP_STATE.uploads[k];
      if (!last) {
        const hasPublishedData =
          (k === 'tendencia' && APP_STATE.dados.tendencia?.length) ||
          (k === 'flows' && APP_STATE.dados.flows?.length) ||
          (k === 'gestoes' && APP_STATE.dados.historico?.items?.length);
        if (!AUTH?.user && hasPublishedData) {
          return `<span class="src-item"><strong>${meta?.icon || ''} ${meta?.label || k}:</strong> dados publicados</span>`;
        }
        return `<span class="src-item src-empty" title="Nenhum arquivo enviado ainda para ${meta ? meta.label : k}">${meta ? meta.icon : ''} ${meta ? meta.label : k}: (sem dados)</span>`;
      }
      const tip = `${last.nome_arquivo} · ${fmtUploadDate(last.enviado_em)}${last.enviado_por ? ' · ' + last.enviado_por : ''}`;
      return `<span class="src-item" title="${escAttr(tip)}"><strong>${meta.icon} ${meta.label}:</strong> <code>${escHtml(last.nome_arquivo)}</code> <span class="src-date">(${escHtml(fmtUploadDateShort(last.enviado_em))})</span></span>`;
    });
    replaceWithParsedMarkup(el, '📎 ' + parts.join(' <span class="src-sep">·</span> '));
  });
}

export function createUploadView({
  runtime,
  excel,
  validateUpload,
  feedback,
  modals,
  uploadRepository,
  uploadCoordinator,
  authService,
  authUi,
  supabaseClient,
  state,
  parsers,
  projectController,
  flowEditor,
}) {
  reportNonFatalError = runtime.reportNonFatalError;
  runAsyncSafely = runtime.runAsyncSafely;
  debouncedRender = runtime.debouncedRender;
  readExcelBuffer = excel.parseBuffer;
  readExcelFile = excel.parseFile;
  validateUploadFile = validateUpload;
  authToast = feedback.toast;
  openModal = modals.open;
  closeModal = modals.close;
  confirmModal = modals.confirm;
  UPLOADS_BUCKET = uploadRepository.bucket;
  UPLOADS_MAX_PER_TYPE = uploadRepository.maxPerType;
  UPLOAD_RUNTIME_STATE = uploadCoordinator.runtimeState;
  sanitizeStoragePath = uploadRepository.sanitizeStoragePath;
  supaActivateUploadRecord = uploadRepository.activateRecord;
  supaRollbackUploadActivation = uploadRepository.rollbackActivation;
  supaListUploadsByType = uploadRepository.listByType;
  supaListExcelGroups = uploadRepository.listExcelGroups;
  loadLatestTendencies = uploadRepository.loadLatestTendencies;
  supaGetDownloadURL = uploadRepository.getDownloadUrl;
  supaEnforceRollingBackup = uploadRepository.enforceRollingBackup;
  supaEnforceDatasetRetention = uploadCoordinator.enforceDatasetRetention;
  supaCaptureDashboardRows = uploadCoordinator.captureDashboardRows;
  supaSaveAllData = uploadCoordinator.saveAllData;
  restoreSavedData = uploadCoordinator.restoreSavedData;
  setUploadRuntimeState = uploadCoordinator.setRuntimeState;
  captureInMemoryUploadState = uploadCoordinator.captureMemoryState;
  restoreInMemoryUploadState = uploadCoordinator.restoreMemoryState;
  commitPreparedUpload = uploadCoordinator.commitPreparedUpload;
  SUPA = supabaseClient;
  AUTH = authService.state;
  isAdminGeral = authService.isAdmin;
  authServiceCanEditProject = authService.canEditProject;
  requireUploadPermission = authUi.requireUploadPermission;
  requireProjectPermission = authUi.requireEditorForProject;
  requireAdmin = authUi.requireAdmin;
  APP_STATE = state;
  parseTendencia = parsers.applyTendency;
  parseTendenciaFile = parsers.parseTendencia;
  parseFlowsValor = parsers.applyFlows;
  parseGestoes = parsers.applyManagements;
  parseCSVRows = parsers.parseDelimitedRows;
  validateImportHeaders = parsers.validateImportHeaders;
  discoverFlowProjectReferences = parsers.discoverFlowProjectReferences;
  discoverGestoesProjectCodes = parsers.discoverGestoesProjectCodes;
  IMPORT_REPORTS = parsers.reports;
  aplicarFallbackGestaoDoHistorico = projectController.aplicarFallbackGestaoDoHistorico;
  atualizarGestaoLabelPelaHistoria = projectController.atualizarGestaoLabelPelaHistoria;
  getProjectInfo = projectController.getProjectInfo;
  carregarObras = projectController.carregarObras;
  renderObrasDropdown = projectController.renderObrasDropdown;
  buildInsumosList = flowEditor.buildInsumosList;
  setInputOptions = flowEditor.setInputOptions;
  buildDatalist = flowEditor.buildDatalist;
  applyManuals = flowEditor.applyManuals;
  loadClassifications = flowEditor.loadClassifications;
  return Object.freeze({
    renderUploadsCentral,
    renderSourcesHeaders,
    handleUpload,
    handleProjectTendencyUpload,
    handleExcelUpload,
    toggleAdvancedUploads,
    openUploadsHistory,
    openProjectTendencyHistory,
    openExcelUploadsHistory,
  });
}
