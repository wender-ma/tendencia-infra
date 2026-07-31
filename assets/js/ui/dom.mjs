export function parseLocalMarkup(markup, ownerDocument = document) {
  const parsed = new DOMParser().parseFromString(String(markup), 'text/html');
  const relocatedTemplates = [...parsed.head.childNodes].filter(
    (node) => node.nodeName === 'TEMPLATE',
  );
  return [...relocatedTemplates, ...parsed.body.childNodes].map((node) =>
    ownerDocument.importNode(node, true),
  );
}

export function replaceWithParsedMarkup(element, markup) {
  if (!element) return;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  const fragment = range.createContextualFragment(String(markup));
  element.replaceChildren(fragment);
}
