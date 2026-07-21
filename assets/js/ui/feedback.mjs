export function createFeedbackService({ documentRef = document, windowRef = window } = {}) {
  function toast(message, kind = 'info', duration = 3500) {
    let element = documentRef.getElementById('authToast');
    if (!element) {
      element = documentRef.createElement('div');
      element.id = 'authToast';
      documentRef.body.appendChild(element);
    }

    const isAssertive = kind === 'err' || kind === 'warn';
    element.setAttribute('role', isAssertive ? 'alert' : 'status');
    element.setAttribute('aria-live', isAssertive ? 'assertive' : 'polite');
    element.setAttribute('aria-atomic', 'true');
    element.className =
      kind === 'err' ? 'err' : kind === 'warn' ? 'warn' : kind === 'ok' ? 'ok' : '';
    element.textContent = String(message ?? '');
    windowRef.requestAnimationFrame(() => element.classList.add('show'));
    windowRef.clearTimeout(element._hideTimeout);
    element._hideTimeout = windowRef.setTimeout(() => element.classList.remove('show'), duration);
  }

  function setLoading(visible) {
    const overlay = documentRef.getElementById('loadingOverlay');
    if (!overlay) return;
    overlay.classList.toggle('show', visible);
    overlay.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  return Object.freeze({
    toast,
    showLoading: () => setLoading(true),
    hideLoading: () => setLoading(false),
  });
}
