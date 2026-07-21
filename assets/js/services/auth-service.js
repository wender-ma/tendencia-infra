const FRESH_LOGIN_KEY = 'jz_fresh_login';
const FRESH_LOGIN_WINDOW_MS = 60_000;

function emptyPermissions() {
  return {
    isEditor: false,
    isAdminGeral: false,
    editaObras: [],
    isPending: false,
    role: null,
  };
}

export function resolvePermissions(rows) {
  const none = emptyPermissions();
  if (!Array.isArray(rows) || rows.length === 0) return none;

  const activeRows = rows.filter((row) => (row.status || 'active') === 'active');
  if (activeRows.length === 0) return none;

  const isPending = activeRows.every((row) => row.role === 'pending');
  if (isPending) return { ...none, isPending: true, role: 'pending' };

  const isAdminGeral = activeRows.some((row) => row.role === 'admin');
  const editaObras = activeRows
    .filter((row) => row.role === 'editor' && row.codigo_obra != null)
    .map((row) => row.codigo_obra);
  const isEditor = isAdminGeral || editaObras.length > 0;

  if (!isEditor) return none;
  return {
    isEditor: true,
    isAdminGeral,
    editaObras,
    isPending: false,
    role: isAdminGeral ? 'admin' : 'editor',
  };
}

export function createAuthService({
  supabaseClient,
  getActiveProject = () => null,
  onStateChange = () => {},
  reportError = (context, error) => console.warn(`[${context}]`, error),
}) {
  const state = Object.seal({
    user: null,
    session: null,
    isEditor: false,
    isAdminGeral: false,
    editaObras: [],
    isPending: false,
    role: null,
    whitelistChecked: false,
    ready: false,
  });

  let initialized = false;
  let subscription = null;

  function isAvailable() {
    return !!supabaseClient?.auth;
  }

  function canEditActiveProject() {
    if (!state.isEditor) return false;
    if (state.isAdminGeral) return true;
    const activeProject = getActiveProject();
    return !!activeProject && state.editaObras.includes(activeProject);
  }

  function isAdmin() {
    return !!(state.ready && state.user && state.isAdminGeral);
  }

  async function notifyStateChange(details = {}) {
    try {
      await onStateChange({ state, ...details });
    } catch (error) {
      reportError('Auth/atualizar interface', error);
    }
  }

  async function checkEditorPermission(email) {
    if (!supabaseClient || !email) return emptyPermissions();
    try {
      const { data, error } = await supabaseClient
        .from('editores_permitidos')
        .select('email, codigo_obra, role, status')
        .eq('email', email.toLowerCase());
      if (error) {
        reportError('Auth/consultar permissões', error);
        return emptyPermissions();
      }
      return resolvePermissions(data);
    } catch (error) {
      reportError('Auth/consultar permissões', error);
      return emptyPermissions();
    }
  }

  async function applySession(session, { isFreshLogin = false } = {}) {
    state.session = session || null;
    state.user = session?.user || null;

    if (state.user) {
      const permissions = await checkEditorPermission(state.user.email);
      state.isEditor = !!permissions.isEditor;
      state.isAdminGeral = !!permissions.isAdminGeral;
      state.editaObras = Array.isArray(permissions.editaObras) ? permissions.editaObras : [];
      state.isPending = !!permissions.isPending;
      state.role = permissions.role || null;
      state.whitelistChecked = true;
    } else {
      state.isEditor = false;
      state.isAdminGeral = false;
      state.editaObras = [];
      state.isPending = false;
      state.role = null;
      state.whitelistChecked = false;
    }

    state.ready = true;
    await notifyStateChange({ isFreshLogin });
  }

  function consumeFreshLogin(event, session) {
    if (!session || (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION')) return false;
    try {
      const raw = sessionStorage.getItem(FRESH_LOGIN_KEY);
      sessionStorage.removeItem(FRESH_LOGIN_KEY);
      if (!raw) return false;
      const timestamp = Number.parseInt(raw, 10);
      return Number.isFinite(timestamp) && Date.now() - timestamp < FRESH_LOGIN_WINDOW_MS;
    } catch (error) {
      reportError('Auth/sessao de login recente', error);
      return false;
    }
  }

  function cleanAuthUrl(event, session) {
    if (!session || (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION')) return;
    if (!window.history.replaceState) return;
    if (
      !window.location.search.includes('code=') &&
      !window.location.hash.includes('access_token=')
    )
      return;
    window.history.replaceState({}, '', window.location.origin + window.location.pathname);
  }

  async function handleAuthEvent(event, session) {
    console.log('[AUTH] evento:', event);
    const isFreshLogin = consumeFreshLogin(event, session);
    await applySession(session, { isFreshLogin });
    cleanAuthUrl(event, session);
  }

  async function init() {
    if (initialized) return;
    initialized = true;

    if (!isAvailable()) {
      state.ready = true;
      await notifyStateChange();
      return;
    }

    try {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();
      await applySession(session);
    } catch (error) {
      reportError('Auth/restaurar sessão', error);
      state.ready = true;
      await notifyStateChange();
    }

    const { data } = supabaseClient.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        void handleAuthEvent(event, session);
      }, 0);
    });
    subscription = data?.subscription || null;
  }

  function markFreshLogin() {
    try {
      sessionStorage.setItem(FRESH_LOGIN_KEY, String(Date.now()));
    } catch (error) {
      reportError('Auth/marcar login recente', error);
    }
  }

  function clearFreshLogin() {
    try {
      sessionStorage.removeItem(FRESH_LOGIN_KEY);
    } catch (error) {
      reportError('Auth/limpar login recente', error);
    }
  }

  async function signInWithGoogle({ redirectTo }) {
    if (!isAvailable()) return { error: new Error('Supabase nao conectado') };
    markFreshLogin();
    const result = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, queryParams: { prompt: 'select_account' } },
    });
    if (result.error) clearFreshLogin();
    return result;
  }

  async function signInWithPassword({ email, password }) {
    if (!isAvailable()) return { error: new Error('Supabase nao conectado') };
    markFreshLogin();
    const result = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });
    if (result.error) clearFreshLogin();
    return result;
  }

  async function signUp({ email, password, name, emailRedirectTo }) {
    if (!isAvailable()) return { error: new Error('Supabase nao conectado') };
    return supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { name: name || undefined }, emailRedirectTo },
    });
  }

  async function signOut() {
    if (!isAvailable()) return { error: new Error('Supabase nao conectado') };
    return supabaseClient.auth.signOut();
  }

  function dispose() {
    subscription?.unsubscribe();
    subscription = null;
    initialized = false;
  }

  return Object.freeze({
    state,
    applySession,
    canEditActiveProject,
    checkEditorPermission,
    dispose,
    init,
    isAdmin,
    isAvailable,
    resolvePermissions,
    signInWithGoogle,
    signInWithPassword,
    signOut,
    signUp,
  });
}

export function installLegacyAuthGlobals(service, target = window) {
  target.AUTH = service.state;
  target.isEditorDaObraAtiva = service.canEditActiveProject;
  target.isAdminGeral = service.isAdmin;
}
