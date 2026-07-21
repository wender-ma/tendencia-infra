const EVENT_ATTRIBUTES = Object.freeze({
  click: 'data-click-action',
  change: 'data-change-action',
  input: 'data-input-action',
});

function actionArguments(element, event) {
  const mode = element.dataset.actionMode || 'none';
  const argument = element.dataset.actionArg;

  if (mode === 'arg') return [argument];
  if (mode === 'arg-bool') return [argument, element.dataset.actionValue === 'true'];
  if (mode === 'bool') return [argument === 'true'];
  if (mode === 'event') return [event];
  if (mode === 'event-arg') return [event, argument];
  if (mode === 'self') return [element];
  if (mode === 'value') return [element.value];
  if (mode === 'arg-value') return [argument, element.value];
  return [];
}

function dispatchAction(element, event, attribute, target) {
  if (element.matches(':disabled,[aria-disabled="true"]')) return;
  if (element.dataset.backdropDismiss === 'true' && event.target !== element) return;
  if (element.tagName === 'A') event.preventDefault();

  const fileTarget = element.dataset.fileTarget;
  if (fileTarget) {
    target.document.getElementById(fileTarget)?.click();
    return;
  }

  const actionName = element.getAttribute(attribute);
  const action = target[actionName];
  if (typeof action !== 'function') {
    target.reportNonFatalError?.(
      `Interface/ação ausente/${actionName}`,
      new Error(`Ação não encontrada: ${actionName}`),
    );
    return;
  }

  try {
    const result = action(...actionArguments(element, event));
    if (result && typeof result.catch === 'function') {
      result.catch((error) => target.reportNonFatalError?.(`Interface/${actionName}`, error));
    }
  } catch (error) {
    target.reportNonFatalError?.(`Interface/${actionName}`, error);
  }
}

export function installActionDelegation({ root = document, target = window } = {}) {
  for (const [eventName, attribute] of Object.entries(EVENT_ATTRIBUTES)) {
    root.addEventListener(eventName, (event) => {
      const element = event.target.closest?.(`[${attribute}]`);
      if (!element) return;
      dispatchAction(element, event, attribute, target);
    });
  }

  root.addEventListener('focusin', (event) => {
    if (event.target.matches?.('[data-select-on-focus]')) event.target.select();
  });
}
