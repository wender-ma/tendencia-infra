const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function appendTextElement(documentRef, parent, tagName, text, attributes = {}) {
  const element = documentRef.createElement(tagName);
  element.textContent = String(text ?? '');
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  parent.appendChild(element);
  return element;
}

export function createModalService({ documentRef = document, windowRef = window } = {}) {
  const stack = [];
  let activeModal = null;

  const getDialog = backdrop => backdrop?.querySelector('[role="dialog"]') || null;
  const getFocusableElements = dialog => (
    dialog
      ? Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter(element => element.offsetParent !== null)
      : []
  );

  function closeLayer(backdrop, result = false) {
    if (!backdrop) return;
    const index = stack.findIndex(entry => entry.backdrop === backdrop);
    if (index < 0) {
      backdrop.classList.remove('show');
      backdrop.setAttribute('aria-hidden', 'true');
      return;
    }

    const wasActive = index === stack.length - 1;
    const [{ previousFocus, onClose }] = stack.splice(index, 1);
    backdrop.classList.remove('show');
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.style.removeProperty('z-index');
    activeModal = stack[stack.length - 1] || null;
    if (activeModal) activeModal.backdrop.setAttribute('aria-hidden', 'false');
    else documentRef.body.classList.remove('modal-open');
    onClose?.(result);
    if (wasActive && previousFocus?.isConnected) previousFocus.focus();
  }

  function openLayer(backdrop, options = {}) {
    if (!backdrop) return false;
    if (stack.some(entry => entry.backdrop === backdrop)) closeLayer(backdrop, false);

    const dialog = getDialog(backdrop);
    const previousFocus = documentRef.activeElement instanceof windowRef.HTMLElement
      ? documentRef.activeElement
      : null;
    if (activeModal) activeModal.backdrop.setAttribute('aria-hidden', 'true');
    const entry = {
      backdrop,
      dialog,
      previousFocus,
      onClose: typeof options.onClose === 'function' ? options.onClose : null,
    };
    stack.push(entry);
    activeModal = entry;
    backdrop.classList.add('show');
    backdrop.setAttribute('aria-hidden', 'false');
    backdrop.style.zIndex = String(2000 + stack.length * 10);
    documentRef.body.classList.add('modal-open');

    windowRef.requestAnimationFrame(() => {
      if (activeModal?.backdrop !== backdrop) return;
      const requested = typeof options.initialFocus === 'string'
        ? backdrop.querySelector(options.initialFocus)
        : options.initialFocus;
      (requested || getFocusableElements(dialog)[0] || dialog)?.focus();
    });
    return true;
  }

  function open(options = {}) {
    const backdrop = documentRef.getElementById('modalBg');
    const dialog = documentRef.getElementById('modal');
    const title = documentRef.querySelector('#modalContent h1, #modalContent h2, #modalContent h3');
    dialog?.setAttribute('aria-label', title?.textContent?.trim() || 'Janela do dashboard');
    return openLayer(backdrop, options);
  }

  const close = result => closeLayer(documentRef.getElementById('modalBg'), result);
  const closeConfirm = result => closeLayer(documentRef.getElementById('confirmModalBg'), result);

  function confirm(title, message, options = {}) {
    const confirmText = options.confirmText || 'Confirmar';
    const cancelText = options.cancelText || 'Cancelar';
    const destructive = options.destructive !== false;
    const requiredText = options.requireText || null;

    return new Promise(resolve => {
      const content = documentRef.getElementById('confirmModalContent');
      content.replaceChildren();
      const form = documentRef.createElement('form');
      form.id = 'confirmModalForm';
      appendTextElement(documentRef, form, 'h2', title);
      const messageElement = appendTextElement(documentRef, form, 'div', message);
      messageElement.className = 'confirm-modal-message';

      let requiredInput = null;
      if (requiredText) {
        const field = documentRef.createElement('div');
        field.className = 'confirm-modal-require';
        const label = documentRef.createElement('label');
        label.htmlFor = 'confirmModalRequire';
        label.append('Digite ');
        appendTextElement(documentRef, label, 'code', requiredText);
        label.append(' para confirmar:');
        field.appendChild(label);
        requiredInput = documentRef.createElement('input');
        requiredInput.type = 'text';
        requiredInput.id = 'confirmModalRequire';
        requiredInput.autocomplete = 'off';
        field.appendChild(requiredInput);
        form.appendChild(field);
      }

      const actions = documentRef.createElement('div');
      actions.className = 'confirm-modal-actions';
      const cancelButton = appendTextElement(documentRef, actions, 'button', cancelText, { type: 'button' });
      cancelButton.className = 'btn-sm';
      cancelButton.id = 'confirmModalCancel';
      const confirmButton = appendTextElement(documentRef, actions, 'button', confirmText, { type: 'submit' });
      confirmButton.className = destructive ? 'btn-sm danger' : 'btn-sm primary';
      confirmButton.id = 'confirmModalOk';
      confirmButton.disabled = Boolean(requiredText);
      form.appendChild(actions);
      content.appendChild(form);

      requiredInput?.addEventListener('input', () => {
        confirmButton.disabled = requiredInput.value.trim() !== requiredText;
      });
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (requiredInput && requiredInput.value.trim() !== requiredText) return;
        closeConfirm(true);
      });
      cancelButton.addEventListener('click', () => closeConfirm(false));
      openLayer(documentRef.getElementById('confirmModalBg'), {
        onClose: resolve,
        initialFocus: requiredText ? '#confirmModalRequire' : '#confirmModalCancel',
      });
    });
  }

  documentRef.addEventListener('keydown', event => {
    if (!activeModal) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLayer(activeModal.backdrop, false);
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = getFocusableElements(activeModal.dialog);
    if (!focusable.length) {
      event.preventDefault();
      activeModal.dialog?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!activeModal.dialog?.contains(documentRef.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && documentRef.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && documentRef.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  documentRef.getElementById('modalContent')?.addEventListener('submit', event => {
    const form = event.target.closest('form[data-modal-form]');
    if (!form) return;
    event.preventDefault();
    const submitter = event.submitter || form.querySelector('[type="submit"]');
    const action = submitter?.dataset.action;
    if (action === 'save-manual') windowRef.saveManualForm?.(submitter.dataset.n);
    else if (action === 'save-mov') windowRef.saveMovForm?.(submitter.dataset.id || '');
    else if (action === 'mass-confirm') windowRef.massConfirmCallback?.();
  });

  return Object.freeze({ openLayer, closeLayer, open, close, closeConfirm, confirm });
}

export function installLegacyModalGlobals(service, target = window) {
  Object.assign(target, {
    openModalLayer: service.openLayer,
    closeModalLayer: service.closeLayer,
    openModal: service.open,
    closeModal: service.close,
    closeConfirmModal: service.closeConfirm,
    confirmModal: service.confirm,
  });
}

