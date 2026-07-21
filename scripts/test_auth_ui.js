#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '../assets/js/ui/auth-ui.mjs'));
  const { friendlySignInError, friendlySignUpError, isGlobalUploadKind } = await import(
    moduleUrl.href
  );

  assert.strictEqual(
    friendlySignInError({ message: 'Invalid login credentials' }),
    'Email ou senha incorretos.',
  );
  assert.strictEqual(
    friendlySignInError({ message: 'Email not confirmed' }),
    'Email ainda não confirmado. Verifique sua caixa de entrada.',
  );
  assert.strictEqual(
    friendlySignUpError({ message: 'User already registered' }),
    'Este email já está cadastrado. Tente entrar em vez de criar conta.',
  );
  assert.strictEqual(isGlobalUploadKind('flows'), true);
  assert.strictEqual(isGlobalUploadKind('tendencia'), false);

  console.log('Interface de auth: mensagens e escopo global de uploads OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
