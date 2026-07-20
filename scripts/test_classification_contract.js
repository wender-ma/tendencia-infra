#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const helper = html.match(
  /async function supaPatchClassification\([\s\S]*?\n}\n\n\/\/ ---------- FLOW MANUALS ----------/
);
assert(helper, 'Helper de patch de classificações ausente');

const source = helper[0];
assert(!source.includes(".select('*')"), 'O patch não pode ler a linha inteira antes de salvar');
assert(source.includes('.update(updatePatch)'), 'O patch deve atualizar somente os campos recebidos');
assert(source.includes("error?.code === '23505'"), 'Conflito de criação simultânea precisa de retry');
assert(source.includes('await updateExisting()'), 'Retry do update ausente');
assert(
  /supaBulkUpsertClassifications[\s\S]*?supaPatchClassification\(/.test(html),
  'Edições em massa precisam usar o mesmo contrato atômico'
);
assert(!html.includes('supaUpsertClassification('), 'Helper read-merge-write antigo ainda está em uso');

console.log('Contrato de classificações: patches sem read-merge-write OK');
