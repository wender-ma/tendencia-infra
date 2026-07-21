#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const authService = fs.readFileSync(path.join(root, 'assets/js/services/auth-service.js'), 'utf8');
const authUi = fs.readFileSync(path.join(root, 'assets/js/ui/auth-ui.mjs'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'assets/js/bootstrap.js'), 'utf8');
const legacy = fs.readFileSync(path.join(root, 'assets/js/dashboard-legacy.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const contract of [
  'export function resolvePermissions(',
  'export function createAuthService(',
  'export function installLegacyAuthGlobals(',
  ".from('editores_permitidos')",
  ".select('email, codigo_obra, role, status')",
  "row.status || 'active'",
  "row.role === 'admin'",
  "row.role === 'editor'",
  'supabaseClient.auth.getSession()',
  'supabaseClient.auth.onAuthStateChange(',
  'supabaseClient.auth.signInWithOAuth(',
  'supabaseClient.auth.signInWithPassword(',
  'supabaseClient.auth.signUp(',
  'supabaseClient.auth.signOut()',
  'resolvePermissions,',
]) {
  assert(authService.includes(contract), `Contrato de autenticacao ausente: ${contract}`);
}

assert(
  /onAuthStateChange\([\s\S]*?setTimeout\([\s\S]*?handleAuthEvent/.test(authService),
  'Callback de auth deve sair da trava interna do SDK antes de consultar a whitelist',
);
assert(
  authService.includes('state.editaObras.includes(activeProject)'),
  'Autorizacao por obra ativa ausente',
);
assert(
  authService.includes('state.ready && state.user && state.isAdminGeral'),
  'Guard administrativo ausente',
);
assert(
  !/document\.getElementById|\.innerHTML/.test(authService),
  'Servico de auth nao pode manipular a interface',
);

for (const removedLegacyContract of [
  'const AUTH =',
  'async function checkEditorPermission(',
  'SUPA.auth.getSession()',
  'SUPA.auth.onAuthStateChange(',
  'SUPA.auth.signInWithOAuth(',
  'SUPA.auth.signInWithPassword(',
  'SUPA.auth.signUp(',
  'SUPA.auth.signOut()',
  "sessionStorage.setItem('jz_fresh_login'",
]) {
  assert(
    !legacy.includes(removedLegacyContract),
    `Autenticacao ainda acoplada ao legado: ${removedLegacyContract}`,
  );
}

for (const delegatedAction of [
  'authService.signInWithGoogle(',
  'authService.signInWithPassword(',
  'authService.signUp(',
  'authService.signOut()',
]) {
  assert(authUi.includes(delegatedAction), `Handler nao delega ao servico: ${delegatedAction}`);
}
assert(!authUi.includes('.innerHTML'), 'Interface de auth não pode interpretar HTML dinâmico');
assert(
  authUi.includes('export function installLegacyAuthUi'),
  'Adaptador temporário da interface de auth ausente',
);

assert(bootstrap.includes('createAuthService({'), 'Bootstrap nao cria o servico de autenticacao');
assert(
  bootstrap.includes('installLegacyAuthGlobals(authService)'),
  'Bootstrap nao instala o adaptador temporario de auth',
);
assert(
  bootstrap.includes('installLegacyAuthUi(authUi)'),
  'Bootstrap não instala a interface de auth',
);
assert(bootstrap.includes('auth: authService'), 'Registro central de servicos nao expoe auth');

console.log('Contrato de auth: sessao, whitelist e autorizacao separadas do legado OK');
