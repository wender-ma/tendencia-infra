/* eslint-disable no-undef */
import { replaceWithParsedMarkup } from '../dom.mjs';

// ============================================================================
// v0.62 — UI ADMIN v2 (roles + pendentes + hard delete)
// SUBSTITUI as funções v0.61: renderObrasAdmin, renderEditoresAdmin,
// openEditorForm, salvarEditorForm, removerEditor, toggleObraAtiva
// ADICIONA: renderPendentesAdmin, aprovarPendente, rejeitarPendente,
//           mudarRoleEditor, deletarObra (hard delete)
// ============================================================================

// -------------- OBRAS (v0.62) --------------

async function renderObrasAdmin() {
  const tbody = document.getElementById('obrasAdminTbody');
  if (!tbody) return;
  if (!isAdminGeral()) {
    replaceWithParsedMarkup(
      tbody,
      '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-soft);">Acesso restrito a administradores.</td></tr>',
    );
    return;
  }
  replaceWithParsedMarkup(
    tbody,
    '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-lighter);">carregando…</td></tr>',
  );
  if (!SUPA) {
    replaceWithParsedMarkup(
      tbody,
      '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--sem-erro);">Sem conexão com o Supabase.</td></tr>',
    );
    return;
  }
  try {
    const { data, error } = await SUPA.from('obras').select('*').order('nome', { ascending: true });
    if (error) throw error;
    if (!data || !data.length) {
      replaceWithParsedMarkup(
        tbody,
        '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-lighter);">Nenhuma obra cadastrada.</td></tr>',
      );
      return;
    }
    replaceWithParsedMarkup(
      tbody,
      data
        .map((o) => {
          const ativa = !!o.ativa;
          const badge = ativa
            ? '<span class="badge green">✅ Ativa</span>'
            : '<span class="badge gray">⏸️ Inativa</span>';
          const origem = o.origem || 'manual';
          const origemBadge =
            origem === 'manual'
              ? '<span class="badge purple" title="Criada pela UI Admin — pode ser deletada">✍️ Manual</span>'
              : '<span class="badge gray" title="Detectada de upload de Gestões — só pode desativar">📥 Upload</span>';
          const dt = o.criada_em ? new Date(o.criada_em).toLocaleString('pt-BR') : '—';
          const toggleLbl = ativa ? '⏸️ Desativar' : '▶️ Ativar';
          const toggleStyle = ativa
            ? 'background:var(--sem-alerta-bg); border:1px solid var(--sem-alerta); color:var(--sem-alerta);'
            : 'background:var(--sem-ok-bg); border:1px solid var(--sem-ok-border); color:var(--sem-ok-text);';
          const podeDeletar = origem === 'manual';
          const btnDeletar = podeDeletar
            ? `<button class="btn-sm" data-action="deletar-obra" data-codigo="${escAttr(o.codigo_obra)}" data-nome="${escAttr(o.nome)}" style="padding:3px 8px; font-size:11px; background:var(--fgr-red-light); border:1px solid var(--sem-erro); color:var(--sem-erro);" title="Deletar permanentemente (obra manual)" aria-label="Deletar obra ${escAttr(o.nome)} permanentemente">🗑️</button>`
            : `<button class="btn-sm" disabled style="padding:3px 8px; font-size:11px; opacity:0.4; cursor:not-allowed;" title="Obras de upload não podem ser deletadas — só desative" aria-label="Esta obra não pode ser deletada">🗑️</button>`;
          return `<tr data-codigo="${escAttr(o.codigo_obra)}" data-ativa="${ativa}">
        <td style="font-family:monospace; font-size:12px;">${escHtml(o.codigo_obra)}</td>
        <td><strong>${escHtml(o.nome)}</strong></td>
        <td style="font-family:monospace; font-size:11px; color:var(--text-soft);">${escHtml(o.key_empobratd || '—')}</td>
        <td>${origemBadge}</td>
        <td>${badge}</td>
        <td style="font-size:11px; color:var(--text-soft);">${dt}</td>
        <td>
          <button class="btn-sm" data-action="editar-obra" data-codigo="${escAttr(o.codigo_obra)}" title="Editar nome/key" aria-label="Editar obra ${escAttr(o.nome)}" style="padding:3px 8px; font-size:11px;">✏️</button>
          <button class="btn-sm" data-action="toggle-obra" data-codigo="${escAttr(o.codigo_obra)}" style="padding:3px 8px; font-size:11px; ${toggleStyle}">${toggleLbl}</button>
          ${btnDeletar}
        </td>
      </tr>`;
        })
        .join(''),
    );
  } catch (e) {
    console.warn('[ADMIN] renderObrasAdmin erro:', e);
    replaceWithParsedMarkup(
      tbody,
      `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--sem-erro);">Erro ao carregar: ${escHtml(e.message || String(e))}</td></tr>`,
    );
  }
}

function handleObrasAdminClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const codigo = button.dataset.codigo;
  if (action === 'editar-obra') editarObraAdmin(codigo);
  else if (action === 'toggle-obra') {
    const row = button.closest('tr');
    toggleObraAtiva(codigo, row?.dataset?.ativa !== 'true');
  } else if (action === 'deletar-obra') deletarObra(codigo, button.dataset.nome);
}

// Obra form state encapsulado em closure (não exposto ao escopo global)
const ObraForm = (function () {
  let editingCodigo = null;

  function open() {
    if (!requireAdmin('criar obras')) return;
    editingCodigo = null;
    document.getElementById('obraFormTitle').textContent = 'Nova obra';
    document.getElementById('obraFormCodigo').value = '';
    document.getElementById('obraFormCodigo').readOnly = false;
    document.getElementById('obraFormCodigo').style.background = '';
    document.getElementById('obraFormNome').value = '';
    document.getElementById('obraFormKey').value = '';
    document.getElementById('obraFormObs').value = '';
    openModalLayer(document.getElementById('obraFormBackdrop'), {
      initialFocus: '#obraFormCodigo',
    });
  }

  function close() {
    closeModalLayer(document.getElementById('obraFormBackdrop'), false);
    editingCodigo = null;
  }

  async function editar(codigo) {
    if (!requireAdmin('editar obras')) return;
    if (!SUPA) return;
    try {
      const { data, error } = await SUPA.from('obras')
        .select('*')
        .eq('codigo_obra', codigo)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        authToast('❌ Obra não encontrada.', 'err', 3000);
        return;
      }
      editingCodigo = codigo;
      document.getElementById('obraFormTitle').textContent = 'Editar obra: ' + codigo;
      document.getElementById('obraFormCodigo').value = data.codigo_obra;
      document.getElementById('obraFormCodigo').readOnly = true;
      document.getElementById('obraFormCodigo').style.background = 'var(--bg-soft)';
      document.getElementById('obraFormNome').value = data.nome || '';
      document.getElementById('obraFormKey').value = data.key_empobratd || '';
      document.getElementById('obraFormObs').value = data.observacao || '';
      openModalLayer(document.getElementById('obraFormBackdrop'), {
        initialFocus: '#obraFormNome',
      });
    } catch (e) {
      console.warn('[ADMIN] editarObraAdmin erro:', e);
      authToast('❌ Erro ao carregar obra: ' + (e.message || e), 'err', 5000);
    }
  }

  async function salvar() {
    if (!requireAdmin('salvar obras')) return;
    const codigo = document.getElementById('obraFormCodigo').value.trim();
    const nome = document.getElementById('obraFormNome').value.trim();
    const key = document.getElementById('obraFormKey').value.trim();
    const obs = document.getElementById('obraFormObs').value.trim();
    if (!codigo || !nome) {
      authToast('⚠️ Código e Nome são obrigatórios.', 'warn', 3000);
      return;
    }
    if (!SUPA) {
      authToast('❌ Sem conexão com Supabase.', 'err', 3000);
      return;
    }
    try {
      if (editingCodigo) {
        const { error } = await SUPA.from('obras')
          .update({ nome, key_empobratd: key || null, observacao: obs || null })
          .eq('codigo_obra', editingCodigo);
        if (error) throw error;
        authToast('✅ Obra atualizada', 'ok', 2500);
      } else {
        const { error } = await SUPA.from('obras').insert({
          codigo_obra: codigo,
          nome,
          key_empobratd: key || null,
          observacao: obs || null,
          ativa: true,
          origem: 'manual',
        });
        if (error) throw error;
        authToast('✅ Obra criada', 'ok', 2500);
      }
      close();
      await renderObrasAdmin();
      await carregarObras();
      renderObrasDropdown();
    } catch (e) {
      console.warn('[ADMIN] salvarObraForm erro:', e);
      authToast('❌ Erro ao salvar: ' + (e.message || e), 'err', 5000);
    }
  }

  return { open, close, editar, salvar };
})();

// Aliases para compatibilidade com onclick/data-action
function openObraForm() {
  ObraForm.open();
}
function closeObraForm() {
  ObraForm.close();
}
function editarObraAdmin(codigo) {
  ObraForm.editar(codigo);
}
function salvarObraForm() {
  ObraForm.salvar();
}

async function toggleObraAtiva(codigo, novoValor) {
  if (!requireAdmin('alterar obras')) return;
  if (!SUPA) return;
  const acao = novoValor ? 'ativar' : 'desativar';
  const confirmed = await confirmModal(
    `${novoValor ? 'Ativar' : 'Desativar'} obra`,
    `Deseja ${acao} a obra ${codigo}?\n\n${novoValor ? 'Ela voltará a aparecer no dropdown.' : 'Ela desaparece do dropdown mas os dados históricos ficam preservados no banco.'}`,
    { confirmText: novoValor ? 'Ativar' : 'Desativar', destructive: !novoValor },
  );
  if (!confirmed) return;
  try {
    const { error } = await SUPA.from('obras')
      .update({ ativa: novoValor })
      .eq('codigo_obra', codigo);
    if (error) throw error;
    authToast(novoValor ? '✅ Obra ativada' : '⏸️ Obra desativada', 'ok', 2500);
    await renderObrasAdmin();
    await carregarObras();
    renderObrasDropdown();
    if (!novoValor && codigo === OBRA_ATIVA) {
      authToast('⚠️ Você está vendo uma obra desativada. Troque no dropdown.', 'warn', 5000);
    }
  } catch (e) {
    console.warn('[ADMIN] toggleObraAtiva erro:', e);
    authToast('❌ Erro ao alterar: ' + (e.message || e), 'err', 5000);
  }
}

function getAdminRpcErrorMessage(error) {
  const message = error?.message || String(error || 'Erro desconhecido');
  if (/PGRST202|schema cache|function .* does not exist/i.test(`${error?.code || ''} ${message}`)) {
    return 'A migration de operações administrativas ainda não foi aplicada no Supabase.';
  }
  return message;
}

async function cleanupDeletedObraStorage(codigo, rawPaths) {
  const safePrefix = codigo.replace(/[^\w.\-]/g, '_') + '/';
  const paths = [
    ...new Set(
      (Array.isArray(rawPaths) ? rawPaths : [])
        .map(sanitizeStoragePath)
        .filter((path) => path && path.startsWith(safePrefix)),
    ),
  ];
  const failedBatches = [];

  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    try {
      const { error } = await SUPA.storage.from(UPLOADS_BUCKET).remove(batch);
      if (error) failedBatches.push({ paths: batch, error });
    } catch (error) {
      failedBatches.push({ paths: batch, error });
    }
  }

  return { total: paths.length, failedBatches };
}

function clearDeletedActiveObra() {
  OBRA_ATIVA = null;
  SafeStorage.remove('jzurique_obra_ativa');
  resetDadosObra();
  HISTORICO = { gestoes: [], items: [], totals: {} };
  PROJ_RAW = [];
  Object.keys(LAST_UPLOADS).forEach((key) => {
    LAST_UPLOADS[key] = null;
  });
  try {
    const url = new URL(window.location);
    url.searchParams.delete('obra');
    window.history.replaceState({}, '', url);
  } catch (e) {
    reportNonFatalError('Obras/limpar URL', e);
  }
}

// hard delete de obra manual — pede pra digitar o código
async function deletarObra(codigo, nome) {
  if (!requireAdmin('excluir obras')) return;
  if (!SUPA) return;
  const confirmado = await confirmModal(
    'Deletar obra permanentemente?',
    `Obra: ${codigo} (${nome})\n\nIsso vai apagar:\n- A obra do catálogo\n- Todos os aditivos, classificações, movimentações vinculadas\n- Todo o histórico de uploads dessa obra`,
    { confirmText: 'Deletar', destructive: true, requireText: codigo },
  );
  if (!confirmado) return;
  try {
    const { data, error } = await SUPA.rpc('admin_delete_obra', { p_codigo_obra: codigo });
    if (error) throw new Error(getAdminRpcErrorMessage(error));

    // Storage não participa da transação PostgreSQL. A limpeza ocorre depois do
    // commit para nunca deixar metadados apontando para arquivos já removidos.
    const storageCleanup = await cleanupDeletedObraStorage(codigo, data?.storage_paths);
    await renderObrasAdmin();
    await renderEditoresAdmin();
    await carregarObras();

    if (codigo === OBRA_ATIVA) {
      const proximaObra = OBRAS.find((obra) => obra.ativa);
      if (proximaObra) await trocarObra(proximaObra.codigo_obra);
      else {
        clearDeletedActiveObra();
        renderObrasDropdown();
        renderAll();
      }
    } else {
      renderObrasDropdown();
    }

    if (storageCleanup.failedBatches.length) {
      console.warn('[ADMIN] arquivos órfãos após excluir obra:', storageCleanup.failedBatches);
      authToast(
        `⚠️ Obra excluída, mas ${storageCleanup.failedBatches.flatMap((item) => item.paths).length} arquivo(s) não puderam ser limpos do Storage.`,
        'warn',
        7000,
      );
    } else {
      authToast('🗑️ Obra deletada permanentemente', 'ok', 3000);
    }
  } catch (e) {
    console.warn('[ADMIN] deletarObra erro:', e);
    authToast('❌ Erro ao deletar: ' + (e.message || e), 'err', 5000);
  }
}

// -------------- EDITORES (v0.62 — com role + pending) --------------

// v0.62.2 — Editores com modal unificado (papel + obras + excluir tudo num só lugar)

// Estado do modal
let _editorFormEditandoEmail = null; // null = criando novo; string = editando

// ---------- render (agrupado por email, coluna ações com 1 botão só) ----------

async function renderEditoresAdmin() {
  const tbody = document.getElementById('editoresAdminTbody');
  if (!tbody) return;
  if (!isAdminGeral()) {
    replaceWithParsedMarkup(
      tbody,
      '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-soft);">Acesso restrito a administradores.</td></tr>',
    );
    return;
  }
  replaceWithParsedMarkup(
    tbody,
    '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-lighter);">carregando…</td></tr>',
  );
  if (!SUPA) {
    replaceWithParsedMarkup(
      tbody,
      '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--sem-erro);">Sem conexão com o Supabase.</td></tr>',
    );
    return;
  }
  try {
    const { data, error } = await SUPA.from('editores_permitidos')
      .select('*')
      .neq('role', 'pending')
      .order('role', { ascending: true })
      .order('email', { ascending: true });
    if (error) throw error;
    if (!data || !data.length) {
      replaceWithParsedMarkup(
        tbody,
        '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-lighter);">Nenhum editor cadastrado.</td></tr>',
      );
      return;
    }
    // agrupa por email
    const obrasByCodigo = {};
    OBRAS.forEach((o) => {
      obrasByCodigo[o.codigo_obra] = o;
    });
    const grupos = {};
    data.forEach((e) => {
      const k = e.email;
      if (!grupos[k]) {
        grupos[k] = {
          email: e.email,
          nome: e.nome,
          observacao: e.observacao,
          adicionado_em: e.adicionado_em,
          role: e.role,
          obras: [],
        };
      }
      const g = grupos[k];
      if (e.role === 'admin') g.role = 'admin';
      if (e.role === 'editor' && e.codigo_obra) g.obras.push(e.codigo_obra);
      if (e.adicionado_em && (!g.adicionado_em || e.adicionado_em < g.adicionado_em))
        g.adicionado_em = e.adicionado_em;
      if (!g.nome && e.nome) g.nome = e.nome;
      if (!g.observacao && e.observacao) g.observacao = e.observacao;
    });
    const linhas = Object.values(grupos).sort((a, b) => {
      if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
      return a.email.localeCompare(b.email);
    });

    replaceWithParsedMarkup(
      tbody,
      linhas
        .map((g) => {
          const isAdmin = g.role === 'admin';
          const roleBadge = isAdmin
            ? '<span class="badge purple">👑 Admin</span>'
            : '<span class="badge green">✏️ Editor</span>';
          let obrasHtml;
          if (isAdmin) {
            obrasHtml = '<span style="color:var(--text-soft); font-size:11px;">— todas —</span>';
          } else if (g.obras.length === 0) {
            obrasHtml =
              '<span style="color:var(--sem-erro); font-size:11px;" title="Editor sem obra atribuída — não edita nada">⚠️ nenhuma obra</span>';
          } else {
            obrasHtml = g.obras
              .map((cod) => {
                const info = obrasByCodigo[cod];
                return `<span class="badge" style="background:var(--fgr-red-light); color:var(--fgr-red-deep); margin:2px; display:inline-block;" title="${escAttr(info?.nome || cod)}"><code style="font-size:10px;">${escHtml(cod)}</code></span>`;
              })
              .join('');
          }
          const dt = g.adicionado_em ? new Date(g.adicionado_em).toLocaleString('pt-BR') : '—';
          return `<tr>
        <td style="font-family:monospace; font-size:12px;">${escHtml(g.email)}</td>
        <td>${escHtml(g.nome || '—')}</td>
        <td>${roleBadge}</td>
        <td>${obrasHtml}</td>
        <td style="font-size:11px; color:var(--text-soft);">${escHtml(g.observacao || '')}</td>
        <td style="font-size:11px; color:var(--text-soft);">${dt}</td>
        <td>
          <button class="btn-sm" data-action="editar-editor" data-email="${escAttr(g.email)}" style="padding:4px 10px; font-size:11px; background:var(--fgr-red-light); border:1px solid var(--fgr-red-deep); color:var(--fgr-red-deep);" title="Editar papel, obras, ou excluir">✏️ Editar</button>
        </td>
      </tr>`;
        })
        .join(''),
    );
  } catch (err) {
    console.warn('[ADMIN] renderEditoresAdmin erro:', err);
    replaceWithParsedMarkup(
      tbody,
      `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--sem-erro);">Erro ao carregar: ${escHtml(err.message || String(err))}</td></tr>`,
    );
  }
}

function handleEditoresAdminClick(event) {
  const button = event.target.closest('[data-action="editar-editor"]');
  if (button) openEditorForm(button.dataset.email);
}

// ---------- MODAL UNIFICADO ----------

// Abre o modal. Se email não informado → criando novo. Se informado → editando.
async function openEditorForm(email) {
  if (!requireAdmin('gerenciar usuários')) return;
  _editorFormEditandoEmail = email || null;
  const isEditando = !!email;

  document.getElementById('editorFormTitle').textContent = isEditando
    ? '✏️ Editar: ' + email
    : '➕ Adicionar usuário';
  document.getElementById('editorFormEmail').value = email || '';
  document.getElementById('editorFormEmail').readOnly = isEditando;
  document.getElementById('editorFormEmail').style.background = isEditando ? 'var(--bg-soft)' : '';
  document.getElementById('editorFormNome').value = '';
  document.getElementById('editorFormObs').value = '';

  // Botão excluir: só aparece se editando
  const delBtn = document.getElementById('editorFormDeleteBtn');
  if (delBtn) delBtn.style.display = isEditando ? '' : 'none';

  // Default: editor
  document.querySelector('input[name="editorFormRole"][value="editor"]').checked = true;
  document.querySelector('input[name="editorFormRole"][value="admin"]').checked = false;

  // Popular checkboxes de obras (vazias por padrão)
  await populaObrasCheckboxes(new Set());

  if (isEditando && SUPA) {
    // Buscar dados atuais do usuário
    try {
      const { data, error } = await SUPA.from('editores_permitidos').select('*').eq('email', email);
      if (!error && data && data.length) {
        // Nome/obs: pegar do primeiro registro que tenha
        const comNome = data.find((r) => r.nome);
        const comObs = data.find((r) => r.observacao);
        if (comNome) document.getElementById('editorFormNome').value = comNome.nome;
        if (comObs) document.getElementById('editorFormObs').value = comObs.observacao;
        // Papel: se qualquer linha for admin → admin
        const isAdminNow = data.some((r) => r.role === 'admin');
        document.querySelector(
          `input[name="editorFormRole"][value="${isAdminNow ? 'admin' : 'editor'}"]`,
        ).checked = true;
        // Obras: linhas com role=editor e codigo_obra
        const obrasAtuais = new Set(
          data.filter((r) => r.role === 'editor' && r.codigo_obra).map((r) => r.codigo_obra),
        );
        await populaObrasCheckboxes(obrasAtuais);
      }
    } catch (e) {
      console.warn('[ADMIN] openEditorForm carga erro:', e);
    }
  }

  editorFormOnRoleChange(); // esconde/mostra bloco de obras conforme papel
  openModalLayer(document.getElementById('editorFormBackdrop'), {
    initialFocus: '#editorFormEmail',
  });
}

function closeEditorForm() {
  closeModalLayer(document.getElementById('editorFormBackdrop'), false);
  _editorFormEditandoEmail = null;
}

// Popula os checkboxes de obras (marcando as que estão no Set)
async function populaObrasCheckboxes(marcadasSet) {
  const container = document.getElementById('editorObrasCheckboxes');
  if (!container) return;
  const obrasAtivas = OBRAS.filter((o) => o.ativa);
  if (obrasAtivas.length === 0) {
    replaceWithParsedMarkup(
      container,
      '<div style="padding:8px; color:var(--text-lighter); font-size:12px;">Nenhuma obra ativa cadastrada.</div>',
    );
    return;
  }
  replaceWithParsedMarkup(
    container,
    obrasAtivas
      .map((o) => {
        const checked = marcadasSet.has(o.codigo_obra) ? 'checked' : '';
        return `<label class="editor-project-option">
      <input type="checkbox" class="editor-obra-cb" value="${escAttr(o.codigo_obra)}" ${checked} style="width:16px; height:16px; cursor:pointer;">
      <code style="font-size:11px; color:var(--text-soft);">${escHtml(o.codigo_obra)}</code>
      <span style="font-size:13px;">${escHtml(o.nome)}</span>
    </label>`;
      })
      .join(''),
  );
}

function editorObrasMarcarTodas(marcar) {
  document.querySelectorAll('.editor-obra-cb').forEach((cb) => {
    cb.checked = marcar;
  });
}

// Chamado quando radio de papel muda: esconde bloco de obras se admin
function editorFormOnRoleChange() {
  const role = document.querySelector('input[name="editorFormRole"]:checked')?.value;
  const block = document.getElementById('editorFormObrasBlock');
  if (block) block.style.display = role === 'admin' ? 'none' : '';
}

// Salvar todas as permissões em uma única transação no banco.
async function salvarEditorForm() {
  if (!requireAdmin('salvar usuários')) return;
  const email = document.getElementById('editorFormEmail').value.trim().toLowerCase();
  const nome = document.getElementById('editorFormNome').value.trim();
  const obs = document.getElementById('editorFormObs').value.trim();
  const role = document.querySelector('input[name="editorFormRole"]:checked')?.value || 'editor';
  const marcadas = [...document.querySelectorAll('.editor-obra-cb:checked')].map((cb) => cb.value);

  if (!email) {
    authToast('⚠️ Email é obrigatório.', 'warn', 3000);
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    authToast('⚠️ Email inválido.', 'warn', 3000);
    return;
  }
  if (!SUPA) {
    authToast('❌ Sem conexão com Supabase.', 'err', 3000);
    return;
  }

  try {
    const { error } = await SUPA.rpc('admin_replace_user_permissions', {
      p_email: email,
      p_nome: nome || null,
      p_observacao: obs || null,
      p_role: role,
      p_codigos_obra: role === 'editor' ? marcadas : [],
    });
    if (error) throw new Error(getAdminRpcErrorMessage(error));

    const resumo =
      role === 'admin'
        ? 'Salvo como 👑 Admin'
        : marcadas.length === 0
          ? 'Salvo como ✏️ Editor sem obras'
          : `Salvo como ✏️ Editor de ${marcadas.length} obra(s)`;
    authToast('✅ ' + resumo, 'ok', 3000);
    closeEditorForm();
    await renderEditoresAdmin();
  } catch (e) {
    console.warn('[ADMIN] salvarEditorForm erro:', e);
    authToast('❌ Erro ao salvar: ' + (e.message || e), 'err', 5000);
  }
}

// Excluir usuário direto do modal (com confirmação)
async function excluirUsuarioDoModal() {
  if (!requireAdmin('excluir usuários')) return;
  const email = _editorFormEditandoEmail;
  if (!email || !SUPA) return;
  const confirmed = await confirmModal(
    'Excluir permissões do usuário',
    `Excluir TODAS as permissões de ${email}?\n\nO usuário some da whitelist. A conta em auth.users continua existindo e poderá voltar como pendente.\n\nEsta ação é irreversível.`,
    { confirmText: 'Excluir usuário', requireText: email },
  );
  if (!confirmed) return;
  try {
    const { error } = await SUPA.rpc('admin_delete_user_permissions', { p_email: email });
    if (error) throw new Error(getAdminRpcErrorMessage(error));
    authToast('🗑️ Usuário removido da whitelist', 'ok', 3000);
    closeEditorForm();
    await renderEditoresAdmin();
  } catch (e) {
    console.warn('[ADMIN] excluirUsuarioDoModal erro:', e);
    authToast('❌ Erro ao excluir: ' + (e.message || e), 'err', 5000);
  }
}

// -------------- PENDENTES (v0.62) --------------

async function renderPendentesAdmin() {
  const tbody = document.getElementById('pendentesAdminTbody');
  const badge = document.getElementById('pendentesCount');
  if (!tbody) return;
  if (!isAdminGeral()) {
    if (badge) badge.textContent = '';
    replaceWithParsedMarkup(
      tbody,
      '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-soft);">Acesso restrito a administradores.</td></tr>',
    );
    return;
  }
  replaceWithParsedMarkup(
    tbody,
    '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-lighter);">carregando…</td></tr>',
  );
  if (!SUPA) {
    replaceWithParsedMarkup(
      tbody,
      '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--sem-erro);">Sem conexão com o Supabase.</td></tr>',
    );
    return;
  }
  try {
    const { data, error } = await SUPA.from('editores_permitidos')
      .select('*')
      .eq('role', 'pending')
      .eq('status', 'active')
      .order('adicionado_em', { ascending: true });
    if (error) throw error;
    if (badge) badge.textContent = data?.length ? `(${data.length})` : '';
    if (!data || !data.length) {
      replaceWithParsedMarkup(
        tbody,
        '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-lighter);">Nenhum cadastro aguardando aprovação. 🎉</td></tr>',
      );
      return;
    }
    replaceWithParsedMarkup(
      tbody,
      data
        .map((e) => {
          const dt = e.adicionado_em ? new Date(e.adicionado_em).toLocaleString('pt-BR') : '—';
          return `<tr>
        <td style="font-family:monospace; font-size:12px;">${escHtml(e.email)}</td>
        <td>${escHtml(e.nome || '—')}</td>
        <td style="font-size:11px; color:var(--text-soft);">${escHtml(e.observacao || '')}</td>
        <td style="font-size:11px; color:var(--text-soft);">${dt}</td>
        <td>
          <button class="btn-sm" data-action="aprovar-pendente" data-email="${escAttr(e.email)}" style="padding:3px 8px; font-size:11px; background:var(--sem-ok-bg); border:1px solid var(--sem-ok-border); color:var(--sem-ok-text);" title="Definir papel e aprovar">✅ Aprovar</button>
          <button class="btn-sm" data-action="rejeitar-pendente" data-email="${escAttr(e.email)}" style="padding:3px 8px; font-size:11px; background:var(--fgr-red-light); border:1px solid var(--sem-erro); color:var(--sem-erro);" title="Negar acesso">❌ Rejeitar</button>
        </td>
      </tr>`;
        })
        .join(''),
    );
  } catch (err) {
    console.warn('[ADMIN] renderPendentesAdmin erro:', err);
    replaceWithParsedMarkup(
      tbody,
      `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--sem-erro);">Erro: ${escHtml(err.message || String(err))}</td></tr>`,
    );
  }
}

function handlePendentesAdminClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const email = button.dataset.email;
  if (action === 'aprovar-pendente') aprovarPendente(email);
  else if (action === 'rejeitar-pendente') rejeitarPendente(email);
}

async function aprovarPendente(email) {
  if (!requireAdmin('aprovar cadastros')) return;
  // aprova como editor SEM obra (admin define depois via botão 🏗️)
  if (!SUPA) return;
  const confirmed = await confirmModal(
    'Aprovar cadastro',
    `Aprovar ${email} como editor?\n\nEle entra sem acesso a nenhuma obra. Depois, escolha quais obras ele pode editar.`,
    { confirmText: 'Aprovar', destructive: false },
  );
  if (!confirmed) return;
  try {
    const { error } = await SUPA.from('editores_permitidos')
      .update({
        role: 'editor',
        codigo_obra: null,
        aprovado_em: new Date().toISOString(),
        aprovado_por: AUTH?.user?.email || null,
      })
      .eq('email', email)
      .eq('role', 'pending');
    if (error) throw error;
    authToast('✅ Aprovado como editor sem escopo. Defina as obras dele em Editores.', 'ok', 4000);
    await renderPendentesAdmin();
    await renderEditoresAdmin();
  } catch (e) {
    console.warn('[ADMIN] aprovarPendente erro:', e);
    authToast('❌ Erro ao aprovar: ' + (e.message || e), 'err', 5000);
  }
}

async function rejeitarPendente(email) {
  if (!requireAdmin('rejeitar cadastros')) return;
  if (!SUPA) return;
  const confirmed = await confirmModal(
    'Rejeitar cadastro',
    `Rejeitar o cadastro de ${email}?\n\nO usuário continua com conta no sistema, mas não receberá permissão de edição.`,
    { confirmText: 'Rejeitar' },
  );
  if (!confirmed) return;
  try {
    const { error } = await SUPA.from('editores_permitidos')
      .update({
        status: 'rejected',
        aprovado_em: new Date().toISOString(),
        aprovado_por: AUTH?.user?.email || null,
      })
      .eq('email', email)
      .eq('role', 'pending');
    if (error) throw error;
    authToast('❌ Cadastro rejeitado', 'warn', 2500);
    await renderPendentesAdmin();
  } catch (e) {
    console.warn('[ADMIN] rejeitarPendente erro:', e);
    authToast('❌ Erro ao rejeitar: ' + (e.message || e), 'err', 5000);
  }
}

export function installLegacyAdminView(target = window) {
  Object.assign(target, {
    renderObrasAdmin,
    openObraForm,
    closeObraForm,
    editarObraAdmin,
    salvarObraForm,
    renderEditoresAdmin,
    openEditorForm,
    closeEditorForm,
    editorObrasMarcarTodas,
    editorFormOnRoleChange,
    salvarEditorForm,
    excluirUsuarioDoModal,
    renderPendentesAdmin,
  });

  document.getElementById('obrasAdminTbody')?.addEventListener('click', handleObrasAdminClick);
  document
    .getElementById('editoresAdminTbody')
    ?.addEventListener('click', handleEditoresAdminClick);
  document
    .getElementById('pendentesAdminTbody')
    ?.addEventListener('click', handlePendentesAdminClick);
}
