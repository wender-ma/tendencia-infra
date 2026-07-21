export function createPaginationService({ pageSize = 100, documentRef = document } = {}) {
  const states = new Map();

  function paginate(key, items, signature = '') {
    const previous = states.get(key) || { page: 1, signature: null };
    const normalizedSignature = String(signature);
    const requestedPage = previous.signature === normalizedSignature ? previous.page : 1;
    const totalItems = items.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const page = Math.min(Math.max(1, requestedPage), totalPages);
    const startIndex = (page - 1) * pageSize;
    const state = { page, signature: normalizedSignature, totalItems, totalPages };
    states.set(key, state);

    return Object.freeze({
      items: items.slice(startIndex, startIndex + pageSize),
      page,
      pageSize,
      totalItems,
      totalPages,
      start: totalItems ? startIndex + 1 : 0,
      end: Math.min(startIndex + pageSize, totalItems),
    });
  }

  function setPage(key, page, onChange) {
    const state = states.get(key);
    if (!state) return;
    const nextPage = Math.min(Math.max(1, page), state.totalPages);
    if (nextPage === state.page) return;
    states.set(key, { ...state, page: nextPage });
    onChange?.();
  }

  function renderControls(containerId, key, result, onChange) {
    const container = documentRef.getElementById(containerId);
    if (!container) return;
    container.replaceChildren();
    container.hidden = result.totalPages <= 1;
    if (container.hidden) return;

    const previous = documentRef.createElement('button');
    previous.type = 'button';
    previous.className = 'pagination-button';
    previous.textContent = '‹';
    previous.title = 'Página anterior';
    previous.setAttribute('aria-label', 'Página anterior');
    previous.disabled = result.page === 1;
    previous.addEventListener('click', () => setPage(key, result.page - 1, onChange));

    const status = documentRef.createElement('span');
    status.className = 'pagination-status';
    status.textContent = `Página ${result.page} de ${result.totalPages}`;
    status.setAttribute('aria-live', 'polite');

    const next = documentRef.createElement('button');
    next.type = 'button';
    next.className = 'pagination-button';
    next.textContent = '›';
    next.title = 'Próxima página';
    next.setAttribute('aria-label', 'Próxima página');
    next.disabled = result.page === result.totalPages;
    next.addEventListener('click', () => setPage(key, result.page + 1, onChange));

    container.append(previous, status, next);
  }

  return Object.freeze({ paginate, setPage, renderControls });
}

export function installLegacyPaginationGlobals(service, target = window) {
  target.paginateRows = service.paginate;
  target.renderPaginationControls = service.renderControls;
}
