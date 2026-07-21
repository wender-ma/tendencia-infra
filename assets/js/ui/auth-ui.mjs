export function isGlobalUploadKind(kind) {
  return kind === 'excel' || kind === 'flows' || kind === 'gestoes';
}

export function friendlySignInError(error) {
  const message = error?.message || 'Não foi possível entrar.';
  if (message.includes('Invalid login credentials')) return 'Email ou senha incorretos.';
  if (message.includes('Email not confirmed')) {
    return 'Email ainda não confirmado. Verifique sua caixa de entrada.';
  }
  return message;
}

export function friendlySignUpError(error) {
  const message = error?.message || 'Não foi possível criar a conta.';
  if (message.includes('already registered') || message.includes('User already')) {
    return 'Este email já está cadastrado. Tente entrar em vez de criar conta.';
  }
  return message;
}

export function createAuthUi({
  authService,
  root = document,
  locationRef = window.location,
  modalService,
  toast = () => {},
  requestConfirmation = async () => false,
  getActiveProject = () => '',
  renderProtectedViews = () => {},
  clearMassSelection = () => {},
  applyProjectionLocks = () => {},
  reportError = () => {},
} = {}) {
  const state = authService.state;

  function appendBadgeContent(badge, icon, email, role) {
    const emailElement = root.createElement('span');
    emailElement.className = 'auth-email';
    emailElement.textContent = `${icon} ${email}`;
    const roleElement = root.createElement('span');
    roleElement.className = 'auth-role';
    roleElement.textContent = role;
    badge.replaceChildren(emailElement, roleElement);
  }

  function syncEditingControls() {
    const canEdit = authService.canEditActiveProject();
    root.querySelectorAll('[data-edit-control]').forEach((element) => {
      element.disabled = !canEdit;
    });
    root.querySelectorAll('[data-admin-control]').forEach((element) => {
      element.disabled = !authService.isAdmin();
    });
    if (!canEdit) clearMassSelection();
    applyProjectionLocks();
  }

  function updateAuthUI() {
    const badge = root.getElementById('authBadge');
    const button = root.getElementById('authBtn');
    if (!badge || !button) return;

    root.body.classList.toggle('is-editor', authService.canEditActiveProject());
    root.body.classList.toggle('is-admin-geral', !!state.isAdminGeral);
    syncEditingControls();

    if (!state.ready) {
      badge.className = 'auth-badge pending';
      badge.textContent = '⏳ Verificando...';
      badge.title = 'Verificando sessão de login';
      button.hidden = true;
      return;
    }

    button.hidden = false;
    if (!state.user) {
      badge.className = 'auth-badge viewer';
      badge.textContent = '👁️ Visualização';
      badge.title =
        'Você está vendo o dashboard sem estar logado.\nFaça login para editar (se tiver permissão).';
      button.textContent = '🔑 Entrar';
      button.title = 'Entrar para editar';
      return;
    }

    const email = state.user.email || 'usuário';
    const shortEmail = email.length > 26 ? `${email.slice(0, 24)}…` : email;
    badge.className = 'auth-badge two-line';
    if (state.isAdminGeral) {
      badge.classList.add('editor');
      appendBadgeContent(badge, '👑', shortEmail, 'Admin');
      badge.title = `Logado como ${email}\nModo: Admin (edita tudo + gerencia obras/usuários)`;
    } else if (state.isEditor && authService.canEditActiveProject()) {
      badge.classList.add('editor');
      appendBadgeContent(badge, '✏️', shortEmail, 'Editor');
      badge.title = `Logado como ${email}\nModo: Editor (pode alterar esta obra)\nObras que edita: ${state.editaObras.join(', ') || '—'}`;
    } else if (state.isEditor) {
      badge.classList.add('viewer');
      appendBadgeContent(badge, '👁️', shortEmail, 'Só leitura aqui');
      const projects = state.editaObras.length ? state.editaObras.join(', ') : 'nenhuma';
      badge.title = `Logado como ${email}\nVocê é editor de: ${projects}\nMas NÃO desta obra (${getActiveProject() || '—'})\nTroque no dropdown para editar suas obras`;
    } else if (state.isPending) {
      badge.classList.add('viewer');
      appendBadgeContent(badge, '⏳', shortEmail, 'Aguardando');
      badge.title = `Logado como ${email}\nAguardando aprovação do admin`;
    } else {
      badge.classList.add('viewer');
      appendBadgeContent(badge, '👁️', shortEmail, 'Sem permissão');
      badge.title = `Logado como ${email}\nModo: Somente leitura`;
    }
    button.textContent = '🚪 Sair';
    button.title = 'Sair da conta';
  }

  function handleAuthServiceStateChanged({ isFreshLogin = false } = {}) {
    if (isFreshLogin && state.user) {
      if (!state.isEditor) {
        toast(
          `👁️ Logado como ${state.user.email}, mas sem permissão para editar. Fale com o admin para adicionar seu email.`,
          'warn',
          6000,
        );
      } else {
        toast(`✏️ Bem-vindo, ${state.user.email}! Você pode editar.`, 'ok', 3000);
      }
    }

    updateAuthUI();
    try {
      renderProtectedViews();
    } catch (error) {
      reportError('Auth/atualizar interface', error);
    }
  }

  function requireEditorForActiveProject(actionDescription) {
    if (authService.canEditActiveProject()) return true;
    if (!state.ready) {
      toast('⏳ Aguarde a verificação da sua sessão.', 'warn', 2500);
    } else if (!state.user) {
      toast(`🔑 Faça login para ${actionDescription || 'editar'}`, 'warn', 3500);
    } else if (state.isEditor) {
      toast(`🚫 Sua conta não pode ${actionDescription || 'editar'} nesta obra.`, 'err', 4500);
    } else {
      toast('🚫 Sua conta não tem permissão para editar. Fale com o admin.', 'err', 4500);
    }
    return false;
  }

  function requireAdmin(actionDescription) {
    if (authService.isAdmin()) return true;
    if (!state.ready) {
      toast('⏳ Aguarde a verificação da sua sessão.', 'warn', 2500);
    } else if (!state.user) {
      toast(
        `🔑 Faça login como administrador para ${actionDescription || 'continuar'}`,
        'warn',
        3500,
      );
    } else {
      toast(
        `🚫 Apenas administradores podem ${actionDescription || 'realizar esta ação'}.`,
        'err',
        4500,
      );
    }
    return false;
  }

  function requireUploadPermission(kind, actionDescription) {
    return isGlobalUploadKind(kind)
      ? requireAdmin(actionDescription)
      : requireEditorForActiveProject(actionDescription);
  }

  function switchLoginTab(mode) {
    const login = mode === 'login';
    const loginTab = root.getElementById('loginTabLogin');
    const signupTab = root.getElementById('loginTabSignup');
    loginTab.classList.toggle('active', login);
    signupTab.classList.toggle('active', !login);
    loginTab.setAttribute('aria-selected', String(login));
    signupTab.setAttribute('aria-selected', String(!login));
    loginTab.tabIndex = login ? 0 : -1;
    signupTab.tabIndex = login ? -1 : 0;
    root.getElementById('loginPanelLogin').hidden = !login;
    root.getElementById('loginPanelSignup').hidden = login;
  }

  function openLoginModal(mode = 'login') {
    switchLoginTab(mode);
    root.getElementById('loginEmailForm')?.reset();
    root.getElementById('signupEmailForm')?.reset();
    root.getElementById('loginErro').textContent = '';
    root.getElementById('signupErro').textContent = '';
    modalService.openLayer(root.getElementById('loginModalBackdrop'), {
      initialFocus: mode === 'signup' ? '#signupNome' : '#loginEmail',
    });
  }

  function closeLoginModal() {
    modalService.closeLayer(root.getElementById('loginModalBackdrop'), false);
  }

  async function submitForm(form, operation) {
    const submitButton = form.querySelector('[type="submit"]');
    form.setAttribute('aria-busy', 'true');
    if (submitButton) submitButton.disabled = true;
    try {
      return await operation();
    } finally {
      form.removeAttribute('aria-busy');
      if (submitButton) submitButton.disabled = false;
    }
  }

  async function doSignInGoogle() {
    if (!authService.isAvailable()) {
      toast('Supabase não conectado', 'err');
      return;
    }
    closeLoginModal();
    const { error } = await authService.signInWithGoogle({
      redirectTo: locationRef.origin + locationRef.pathname,
    });
    if (error) toast(`Erro no login Google: ${error.message}`, 'err');
  }

  async function doSignInEmail() {
    const form = root.getElementById('loginEmailForm');
    const email = root.getElementById('loginEmail').value.trim().toLowerCase();
    const password = root.getElementById('loginSenha').value;
    const errorElement = root.getElementById('loginErro');
    errorElement.textContent = '';
    if (!email || !password) {
      errorElement.textContent = 'Preencha email e senha.';
      return;
    }
    if (!authService.isAvailable()) {
      errorElement.textContent = 'Supabase não conectado.';
      return;
    }
    const { error } = await submitForm(form, () =>
      authService.signInWithPassword({ email, password }),
    );
    if (error) {
      errorElement.textContent = friendlySignInError(error);
      return;
    }
    closeLoginModal();
  }

  async function doSignUpEmail() {
    const form = root.getElementById('signupEmailForm');
    const email = root.getElementById('signupEmail').value.trim().toLowerCase();
    const password = root.getElementById('signupSenha').value;
    const confirmation = root.getElementById('signupSenha2').value;
    const name = root.getElementById('signupNome').value.trim();
    const errorElement = root.getElementById('signupErro');
    errorElement.textContent = '';
    if (!email || !password) {
      errorElement.textContent = 'Preencha email e senha.';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorElement.textContent = 'Email inválido.';
      return;
    }
    if (password.length < 6) {
      errorElement.textContent = 'Senha precisa ter no mínimo 6 caracteres.';
      return;
    }
    if (password !== confirmation) {
      errorElement.textContent = 'As senhas não conferem.';
      return;
    }
    if (!authService.isAvailable()) {
      errorElement.textContent = 'Supabase não conectado.';
      return;
    }
    const { error } = await submitForm(form, () =>
      authService.signUp({
        email,
        password,
        name,
        emailRedirectTo: locationRef.origin + locationRef.pathname,
      }),
    );
    if (error) {
      errorElement.textContent = friendlySignUpError(error);
      return;
    }
    toast(
      '✅ Cadastro realizado! Você entrou como "aguardando aprovação". Peça ao admin para liberar seu acesso.',
      'ok',
      6000,
    );
    closeLoginModal();
  }

  async function handleAuthClick() {
    if (!authService.isAvailable()) {
      toast('Supabase não conectado', 'err');
      return;
    }
    if (!state.user) {
      openLoginModal('login');
      return;
    }
    const confirmed = await requestConfirmation(
      'Sair da conta?',
      'Você continuará vendo o dashboard, mas não conseguirá editar.',
      { confirmText: 'Sair', destructive: false },
    );
    if (!confirmed) return;
    const { error } = await authService.signOut();
    if (error) toast(`Erro ao sair: ${error.message}`, 'err');
  }

  return Object.freeze({
    closeLoginModal,
    doSignInEmail,
    doSignInGoogle,
    doSignUpEmail,
    handleAuthClick,
    handleAuthServiceStateChanged,
    openLoginModal,
    requireAdmin,
    requireEditor: requireEditorForActiveProject,
    requireEditorForActiveProject,
    requireUploadPermission,
    switchLoginTab,
    syncEditingControls,
    updateAuthUI,
  });
}

export function installLegacyAuthUi(service, target = window) {
  Object.assign(target, {
    handleAuthServiceStateChanged: service.handleAuthServiceStateChanged,
    isGlobalUploadKind,
    openLoginModal: service.openLoginModal,
    requireAdmin: service.requireAdmin,
    requireEditor: service.requireEditor,
    requireEditorForActiveProject: service.requireEditorForActiveProject,
    requireUploadPermission: service.requireUploadPermission,
    syncEditingControls: service.syncEditingControls,
    updateAuthUI: service.updateAuthUI,
  });
  return Object.freeze({
    closeLoginModal: service.closeLoginModal,
    doSignInEmail: service.doSignInEmail,
    doSignInGoogle: service.doSignInGoogle,
    doSignUpEmail: service.doSignUpEmail,
    handleAuthClick: service.handleAuthClick,
    switchLoginTab: service.switchLoginTab,
  });
}
