const THEME_STORAGE_KEY = 'jzurique_theme';
const ACTIVE_TAB_STORAGE_KEY = 'jzurique_active_tab';

export function calculateManagementAge(label, referenceDate = new Date()) {
  if (typeof label !== 'string') return null;
  const match = label.match(/GEST[ÃA]O\s+(\d{2})-(\d{4})/i);
  if (!match) return null;
  const month = Number.parseInt(match[1], 10);
  const year = Number.parseInt(match[2], 10);
  if (month < 1 || month > 12) return null;
  return {
    month: match[1],
    year: match[2],
    monthsAgo: (referenceDate.getFullYear() - year) * 12 + (referenceDate.getMonth() + 1 - month),
  };
}

export function createDashboardShell({
  root = document,
  body = document.body,
  getStorage = () => window.localStorage,
  getManagementLabel = () => '',
  getHeaderEditable = () => false,
  setHeaderEditable = () => {},
  authorizeAdmin = () => false,
  isAdmin = () => false,
  renderTab = () => {},
  renderAdmin = () => {},
  saveHeaderTitle = () => {},
  reportError = () => {},
  now = () => new Date(),
} = {}) {
  function readPreference(key) {
    try {
      return getStorage()?.getItem(key) || null;
    } catch (error) {
      reportError(`Preferências/ler/${key}`, error);
      return null;
    }
  }

  function writePreference(key, value) {
    try {
      getStorage()?.setItem(key, value);
      return true;
    } catch (error) {
      reportError(`Preferências/salvar/${key}`, error);
      return false;
    }
  }

  function removePreference(key) {
    try {
      getStorage()?.removeItem(key);
    } catch (error) {
      reportError(`Preferências/remover/${key}`, error);
    }
  }

  function updateThemeButton(isDark) {
    const button = root.getElementById('themeToggle');
    if (!button) return;
    button.textContent = isDark ? '☀️' : '🌙';
    button.setAttribute('aria-label', isDark ? 'Ativar modo claro' : 'Ativar modo escuro');
  }

  function restorePreferences() {
    const savedTitle = readPreference('jzurique_header_title');
    const title = root.getElementById('headerTitle');
    if (savedTitle && title) title.textContent = savedTitle;

    const isDark = readPreference(THEME_STORAGE_KEY) === 'dark';
    body.classList.toggle('dark', isDark);
    updateThemeButton(isDark);
  }

  function toggleTheme() {
    const isDark = body.classList.toggle('dark');
    updateThemeButton(isDark);
    writePreference(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
  }

  function toggleHeaderEdit() {
    const title = root.getElementById('headerTitle');
    const button = root.getElementById('headerLockBtn');
    if (!title || !button) return;
    if (!getHeaderEditable() && !authorizeAdmin()) return;

    const isEditing = !getHeaderEditable();
    setHeaderEditable(isEditing);
    title.contentEditable = String(isEditing);
    title.classList.toggle('is-editing', isEditing);
    button.setAttribute('aria-pressed', String(isEditing));

    if (isEditing) {
      title.focus();
      const range = root.createRange();
      range.selectNodeContents(title);
      const selection = root.defaultView?.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      button.textContent = '💾 Salvar';
      button.title = 'Salvar e travar edição';
      return;
    }

    const value = title.textContent.trim() || 'Tendência Orçamentária';
    title.textContent = value;
    writePreference('jzurique_header_title', value);
    saveHeaderTitle(value);
    button.textContent = '🔒 Editar';
    button.title = 'Editar título';
  }

  function refreshHeaderSubtitle() {
    const subtitle = root.getElementById('dataRef');
    const label = getManagementLabel();
    if (subtitle && typeof label === 'string') subtitle.textContent = label;
  }

  function appendFreshnessBanner(container, age) {
    const critical = age.monthsAgo > 3;
    const banner = root.createElement('div');
    banner.className = `alert-banner${critical ? ' is-critical' : ''}`;
    banner.append(`${critical ? '🔴' : '⚠️'} `);

    const lead = root.createElement('strong');
    lead.textContent = critical ? 'Dados muito desatualizados:' : 'Dados desatualizados:';
    banner.append(lead, ' último mês de gestão é ');

    const period = root.createElement('strong');
    period.textContent = `${age.month}/${age.year}`;
    banner.append(period, ` (${age.monthsAgo} meses atrás). `);
    banner.append(critical ? 'Atualize os dados na aba ' : 'Considere atualizar na aba ');

    const link = root.createElement('a');
    link.href = '#';
    link.className = 'alert-banner-link';
    link.dataset.clickAction = 'irParaAba';
    link.dataset.actionMode = 'arg';
    link.dataset.actionArg = 'uploads';
    link.textContent = '📤 Uploads';
    banner.append(link, '.');
    container.append(banner);
  }

  function verificarDadosDesatualizados() {
    const container = root.getElementById('alertBanner');
    if (!container) return;
    container.replaceChildren();
    const age = calculateManagementAge(getManagementLabel(), now());
    if (age?.monthsAgo > 2) appendFreshnessBanner(container, age);
  }

  function salvarAbaAtiva(tabName) {
    writePreference(ACTIVE_TAB_STORAGE_KEY, tabName);
  }

  function activateTab(tab) {
    if (!tab?.dataset.tab) return false;
    if (tab.dataset.tab === 'admin' && !authorizeAdmin()) return false;

    root.querySelectorAll('.tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    });
    root.querySelectorAll('.tab-content').forEach((panel) => {
      const active = panel.id === `tab-${tab.dataset.tab}`;
      panel.classList.toggle('active', active);
      panel.setAttribute('aria-hidden', String(!active));
    });

    salvarAbaAtiva(tab.dataset.tab);
    renderTab(tab.dataset.tab);
    if (tab.dataset.tab === 'admin') renderAdmin();
    return true;
  }

  function restaurarAbaAtiva() {
    const saved = readPreference(ACTIVE_TAB_STORAGE_KEY);
    if (!saved) return;
    if (saved === 'admin' && !isAdmin()) {
      removePreference(ACTIVE_TAB_STORAGE_KEY);
      return;
    }
    const tab = root.querySelector(`.tab[data-tab="${CSS.escape(saved)}"]`);
    if (tab) activateTab(tab);
  }

  function getVisibleTabs() {
    return Array.from(root.querySelectorAll('.tab')).filter((tab) => tab.offsetParent !== null);
  }

  function handleTabKeydown(event, tab) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = getVisibleTabs();
    const currentIndex = tabs.indexOf(tab);
    if (currentIndex < 0) return;
    event.preventDefault();

    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;

    const nextTab = tabs[nextIndex];
    if (activateTab(nextTab)) {
      nextTab.focus();
      nextTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function install() {
    restorePreferences();
    root.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => activateTab(tab));
      tab.addEventListener('keydown', (event) => handleTabKeydown(event, tab));
    });
    root.addEventListener('keydown', (event) => {
      if (
        event.key === 'Enter' &&
        getHeaderEditable() &&
        root.activeElement?.id === 'headerTitle'
      ) {
        event.preventDefault();
        toggleHeaderEdit();
      }
    });
  }

  return Object.freeze({
    activateTab,
    getVisibleTabs,
    refreshHeaderSubtitle,
    restaurarAbaAtiva,
    salvarAbaAtiva,
    toggleHeaderEdit,
    toggleTheme,
    verificarDadosDesatualizados,
    install,
  });
}

export function installLegacyDashboardShell(shell, target = window) {
  Object.assign(target, {
    activateTab: shell.activateTab,
    getVisibleTabs: shell.getVisibleTabs,
    refreshHeaderSubtitle: shell.refreshHeaderSubtitle,
    restaurarAbaAtiva: shell.restaurarAbaAtiva,
    salvarAbaAtiva: shell.salvarAbaAtiva,
    toggleHeaderEdit: shell.toggleHeaderEdit,
    toggleTheme: shell.toggleTheme,
    verificarDadosDesatualizados: shell.verificarDadosDesatualizados,
  });
  shell.install();
}
