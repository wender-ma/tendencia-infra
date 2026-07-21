#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadProjectSources } = require('./load_project_sources');

const root = path.resolve(__dirname, '..');
const { html, javascript, source } = loadProjectSources();
const css = ['tokens.css', 'base.css', 'components.css', 'dashboard.css']
  .map(file => fs.readFileSync(path.join(root, 'assets', 'css', file), 'utf8'))
  .join('\n');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function lineAt(index) {
  return html.slice(0, index).split('\n').length;
}

const staticHtml = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '');
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const tagStack = [];
for (const tagMatch of staticHtml.matchAll(/<\/?([a-z][\w-]*)\b[^>]*>/gi)) {
  const raw = tagMatch[0];
  const tag = tagMatch[1].toLowerCase();
  if (voidTags.has(tag) || raw.endsWith('/>')) continue;
  if (!raw.startsWith('</')) {
    tagStack.push(tag);
    continue;
  }
  assert(tagStack.pop() === tag, `Estrutura HTML desbalanceada ao fechar <${tag}>`);
}
assert(tagStack.length === 0, `Tags HTML não fechadas: ${tagStack.join(', ')}`);

assert((html.match(/<h1\b/gi) || []).length === 1, 'O documento precisa ter exatamente um h1');
assert(/<h1\b[^>]*id="obraNomeGrande"/.test(html), 'O nome da obra deve ser o h1');
['header', 'nav', 'main', 'footer'].forEach(tag => {
  assert(new RegExp(`<${tag}\\b`, 'i').test(html), `Landmark <${tag}> ausente`);
});
assert((html.match(/<section\b[^>]*class="tab-content/gi) || []).length === 9, 'As nove abas devem ser sections');
assert(html.includes('class="skip-link" href="#mainContent"'), 'Link para pular ao conteúdo ausente');

const labels = [...html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)];
const labelTargets = new Set();
const nestedControls = new Set();
for (const label of labels) {
  const target = label[1].match(/\bfor="([^"]+)"/)?.[1];
  if (target) labelTargets.add(target);
  for (const control of label[2].matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/gi)) {
    nestedControls.add(control[1]);
  }
  assert(target || /<(?:input|select|textarea)\b/i.test(label[2]), `Label sem associação na linha ${lineAt(label.index)}`);
}

for (const control of html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
  const attrs = control[2];
  const id = attrs.match(/\bid="([^"]+)"/)?.[1];
  if (!id || /type="hidden"|display:\s*none/.test(attrs)) continue;
  const named = labelTargets.has(id) || nestedControls.has(id) || /\baria-label(?:ledby)?=/.test(attrs);
  assert(named, `Controle #${id} sem nome acessível na linha ${lineAt(control.index)}`);
}

for (const target of labelTargets) {
  assert(new RegExp(`\\bid="${target}"`).test(html), `Label aponta para #${target}, mas o controle não existe`);
}

assert(/:where\([^}]+\):focus-visible\s*{/.test(css), 'Estilo global de foco visível ausente');
assert(css.includes('--text-lighter:   #6B7280'), 'Contraste de texto secundário no tema claro não foi corrigido');
assert(css.includes('--text-lighter:   #94A3B8'), 'Contraste de texto secundário no tema escuro não foi corrigido');
assert(/id="loadingOverlay"[^>]*role="status"[^>]*aria-live="polite"/.test(html), 'Loading não é anunciado');
assert(/function authToast[\s\S]*?setAttribute\('aria-live'/.test(javascript), 'Toasts não configuram aria-live');
assert(/id="loginErro"[^>]*role="alert"/.test(html) && /id="signupErro"[^>]*role="alert"/.test(html), 'Erros de autenticação não são anunciados');

['obraForm', 'editorForm', 'loginEmailForm', 'signupEmailForm'].forEach(id => {
  assert(new RegExp(`<form\\b[^>]*id="${id}"[^>]*onsubmit=`).test(html), `Formulário #${id} sem evento submit`);
});
assert(source.includes('data-modal-form="manual"'), 'Aditivo manual precisa usar formulário semântico');
assert(source.includes('data-modal-form="movement"'), 'Movimentação precisa usar formulário semântico');
assert(!/id="(?:loginSenha|signupSenha2)"[^>]*onkeydown=/.test(html), 'Login não deve simular submit no keydown');

const sortableHeaders = [...html.matchAll(/<th\b[^>]*data-sort(?:-flow|-proj)?="[^"]+"[^>]*>/gi)];
assert(sortableHeaders.length >= 20, 'Cabeçalhos ordenáveis esperados não foram encontrados');
sortableHeaders.forEach(header => {
  assert(/aria-sort="none"/.test(header[0]), `Cabeçalho ordenável sem aria-sort na linha ${lineAt(header.index)}`);
});
assert(javascript.includes('function bindSortableHeaders('), 'Runtime de ordenação acessível ausente');
assert(javascript.includes("event.key !== 'Enter' && event.key !== ' '"), 'Ordenação por Enter/Espaço ausente');
assert(/data-idx="\$\{origIdx\}" tabindex="0"/.test(javascript), 'Linhas de detalhamento não entram na ordem de foco');
assert(javascript.includes("addEventListener('keydown', activateDetailRow)"), 'Detalhamento sem ativação por teclado');
assert(javascript.includes("addEventListener('keydown', activateProjectionRow)"), 'Projeção sem ativação por teclado');

console.log('Contrato de acessibilidade: landmarks, formulários, ordenação, foco e anúncios OK');
