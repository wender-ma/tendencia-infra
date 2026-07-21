export function parseLocalMarkup(markup, ownerDocument = document) {
  const parsed = new DOMParser().parseFromString(String(markup), 'text/html');
  return [...parsed.body.childNodes].map((node) => ownerDocument.importNode(node, true));
}

export function replaceWithParsedMarkup(element, markup) {
  if (!element) return;
  element.replaceChildren(...parseLocalMarkup(markup, element.ownerDocument));
}

export function installLegacyDomGlobals(target = window) {
  target.replaceWithParsedMarkup = replaceWithParsedMarkup;
}
