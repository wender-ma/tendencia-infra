function resolveTarget(target, documentRef) {
  return typeof target === 'string' ? documentRef.getElementById(target) : target;
}

export function createViewStateService({ documentRef = document } = {}) {
  function render(target, options = {}) {
    const container = resolveTarget(target, documentRef);
    if (!container) return null;

    const {
      kind = 'empty',
      title = 'Sem dados para exibir',
      message = '',
      action = null,
      compact = false,
      tableColspan = null,
    } = options;

    const state = documentRef.createElement('div');
    state.className = `view-state view-state--${kind}${compact ? ' view-state--compact' : ''}`;
    state.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    state.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');

    const heading = documentRef.createElement('h3');
    heading.textContent = title;
    state.appendChild(heading);

    if (message) {
      const description = documentRef.createElement('p');
      description.textContent = message;
      state.appendChild(description);
    }

    if (action?.label && action?.tab) {
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.className = 'btn-sm primary';
      button.textContent = action.label;
      button.dataset.clickAction = 'irParaAba';
      button.dataset.actionMode = 'arg';
      button.dataset.actionArg = action.tab;
      state.appendChild(button);
    }

    container.replaceChildren();
    if (tableColspan && container.tagName === 'TBODY') {
      const row = documentRef.createElement('tr');
      row.className = 'view-state-row';
      const cell = documentRef.createElement('td');
      cell.colSpan = tableColspan;
      cell.appendChild(state);
      row.appendChild(cell);
      container.appendChild(row);
    } else {
      container.appendChild(state);
    }

    return state;
  }

  return Object.freeze({ render });
}
