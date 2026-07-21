export function createApplication({
  state,
  projectController,
  authService,
  uploadRepository,
  dashboardRuntime,
  dashboardShell,
  storage,
  storageKeys,
  syncStatus,
  performanceMonitor,
  documentRef = document,
  hasBackend = () => true,
  buildInputList = () => [],
  setInputOptions = () => {},
  buildDatalist = () => {},
  applyManuals = () => {},
  loadClassifications = () => 0,
  updateEditCount = () => {},
  restoreFilters = () => {},
  toast = () => {},
  reportError = () => {},
}) {
  let startPromise = null;

  async function run() {
    const now = documentRef.getElementById('now');
    if (now) now.textContent = new Date().toLocaleString('pt-BR');
    setInputOptions(buildInputList());
    buildDatalist();
    syncStatus.render();

    try {
      if (hasBackend()) {
        await projectController.carregarObras();
        state.obra.ativa = projectController.resolverObraInicial();
        projectController.renderObrasDropdown();
        await projectController.recarregarDadosDaObra();
        const header = documentRef.getElementById('headerTitle');
        const savedTitle = storage.get(storageKeys.header, '');
        if (header && savedTitle) header.textContent = savedTitle;
        syncStatus.markSynced();
      }
    } catch (error) {
      reportError('Boot/carregar dados iniciais', error);
      syncStatus.markError(error);
    }

    try {
      applyManuals();
      loadClassifications();
    } catch (error) {
      reportError('Boot/aplicar edições locais', error);
    }

    try {
      await authService.init();
    } catch (error) {
      reportError('Auth/inicializar', error);
    }

    try {
      const recoveredUploads = await uploadRepository.cleanupIncompleteUploads();
      if (recoveredUploads > 0) {
        toast(`${recoveredUploads} upload(s) incompleto(s) foram limpos.`, 'info', 4500);
      }
    } catch (error) {
      reportError(
        'Upload/recuperar tentativas incompletas',
        error,
        'Não foi possível limpar uploads incompletos antigos.',
      );
    }

    dashboardRuntime.renderAll();
    updateEditCount();
    dashboardShell.restaurarAbaAtiva();
    restoreFilters();
    performanceMonitor.completeBoot();
  }

  function start() {
    startPromise ||= run();
    return startPromise;
  }

  return Object.freeze({ start });
}
