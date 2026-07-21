#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadProjectSources } = require('./load_project_sources');

const root = path.resolve(__dirname, '..');
const { javascript } = loadProjectSources();
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260720203000_admin_transactions.sql'),
  'utf8'
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extract(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Bloco ausente: ${start}`);
  return source.slice(from, to);
}

const deleteObra = extract(javascript, 'async function deletarObra(', '// -------------- EDITORES');
assert(deleteObra.includes("SUPA.rpc('admin_delete_obra'"), 'Exclusão de obra precisa usar a RPC transacional');
[
  "from('projecao_movimentacoes').delete()",
  "from('flow_classifications').delete()",
  "from('upload_history').delete()",
  "from('obras').delete()",
].forEach(call => assert(!deleteObra.includes(call), `Exclusão parcial ainda presente: ${call}`));
assert(deleteObra.includes('cleanupDeletedObraStorage('), 'Arquivos da obra precisam ser limpos após o commit');

const saveUser = extract(javascript, 'async function salvarEditorForm(', '// Excluir usuário direto do modal');
assert(saveUser.includes("SUPA.rpc('admin_replace_user_permissions'"), 'Permissões precisam ser substituídas via RPC');
assert(!saveUser.includes("from('editores_permitidos').delete()"), 'Permissões não podem ser apagadas antes do novo escopo');
assert(!saveUser.includes("from('editores_permitidos').insert("), 'Permissões não podem ser inseridas em chamada separada');

const deleteUser = extract(javascript, 'async function excluirUsuarioDoModal(', '// -------------- PENDENTES');
assert(deleteUser.includes("SUPA.rpc('admin_delete_user_permissions'"), 'Exclusão de usuário precisa usar a RPC protegida');

[
  'admin_replace_user_permissions',
  'admin_delete_user_permissions',
  'admin_delete_obra',
  'security definer',
  'pg_advisory_xact_lock',
  'Nao e permitido remover o ultimo administrador ativo',
].forEach(contract => assert(migration.toLowerCase().includes(contract.toLowerCase()), `Contrato SQL ausente: ${contract}`));

const cascadeCount = (migration.match(/on delete cascade/gi) || []).length;
assert(cascadeCount === 6, 'A migration deve configurar exatamente seis cascatas controladas');

console.log('Contrato administrativo: RPCs atômicas e cascatas controladas OK');
