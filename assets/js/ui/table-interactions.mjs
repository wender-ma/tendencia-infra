export function updateSortHeaderState(selector, dataAttribute, activeKey, direction) {
  document.querySelectorAll(selector).forEach((header) => {
    const key = header.getAttribute(dataAttribute);
    const state = key === activeKey ? (direction > 0 ? 'ascending' : 'descending') : 'none';
    const label = header.textContent.trim();
    header.setAttribute('aria-sort', state);
    header.setAttribute(
      'aria-label',
      state === 'none'
        ? `${label}. Ativar ordenação`
        : `${label}. Ordenação ${state === 'ascending' ? 'crescente' : 'decrescente'}`,
    );
  });
}

export function bindSortableHeaders(selector, dataAttribute, getState, activateSort) {
  document.querySelectorAll(selector).forEach((header) => {
    header.tabIndex = 0;
    const activate = () => activateSort(header.getAttribute(dataAttribute));
    header.addEventListener('click', activate);
    header.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activate();
    });
  });
  const state = getState();
  updateSortHeaderState(selector, dataAttribute, state.key, state.direction);
}

export function isTableRowActivation(event) {
  return event.type === 'click' || event.key === 'Enter' || event.key === ' ';
}
