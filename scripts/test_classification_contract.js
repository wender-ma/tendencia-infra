#!/usr/bin/env node

const { loadProjectSources, readProjectFile } = require('./load_project_sources');

const { javascript } = loadProjectSources();
const repository = readProjectFile('assets/js/services/dashboard-repository.mjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const helper = repository.match(
  /async function patchClassification\([\s\S]*?\n  }\n\n  async function loadManuals\(/,
);
assert(helper, 'Helper de patch de classificações ausente');

const source = helper[0];
assert(!source.includes(".select('*')"), 'O patch não pode ler a linha inteira antes de salvar');
assert(
  source.includes('.update(updatePatch)'),
  'O patch deve atualizar somente os campos recebidos',
);
assert(
  source.includes("result.error?.code === '23505'"),
  'Conflito de criação simultânea precisa de retry',
);
assert(source.includes('await updateExisting()'), 'Retry do update ausente');
assert(
  /supaBulkUpsertClassifications[\s\S]*?supaPatchClassification\(/.test(javascript),
  'Edições em massa precisam usar o mesmo contrato atômico',
);
assert(
  !javascript.includes('supaUpsertClassification('),
  'Helper read-merge-write antigo ainda está em uso',
);

console.log('Contrato de classificações: patches sem read-merge-write OK');
