const fs = require('fs');

const source = fs.readFileSync('assets/js/ui/uploads.mjs', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260728235000_release_hardening.sql',
  'utf8',
);
const audit = fs.readFileSync(
  'supabase/audit/verify_release_hardening_deployment.sql',
  'utf8',
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const parseGuard = source.indexOf('const parseErrors');
const registration = source.indexOf("SUPA.rpc('admin_register_upload_projects'");
const registrationUse = source.indexOf('await registerDiscoveredProjects(confirmedProjects)');
const commit = source.indexOf('await commitPreparedUpload({', registrationUse);
const rollbackUse = source.indexOf('await rollbackDiscoveredProjects(registeredProjectCodes)');

assert(registration > 0, 'upload deve cadastrar obras por RPC administrativa');
assert(
  parseGuard > 0 && registrationUse > parseGuard,
  'cadastro remoto deve ocorrer somente depois da validacao de todas as abas',
);
assert(
  commit > registrationUse && rollbackUse > commit,
  'falha posterior ao cadastro deve executar rollback das obras novas',
);
assert(
  migration.includes('security definer') &&
    migration.includes('public.authz_is_admin()') &&
    migration.includes('admin_rollback_upload_projects'),
  'RPCs de cadastro devem ser administrativas e reversiveis',
);
assert(
  audit.includes("'complete'") &&
    audit.includes('anon_column_contract_valid') &&
    !/\binsert\b|\bupdate\b|\bdelete\b/i.test(audit.replaceAll('updated', '')),
  'auditoria de producao deve ser somente leitura e validar o contrato anonimo',
);

console.log('upload project registration contract: ok');
