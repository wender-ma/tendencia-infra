#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const roadmap = fs.readFileSync(path.join(root, 'ROADMAP.md'), 'utf8');
const register = fs.readFileSync(path.join(root, 'docs', 'external_actions.md'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pendingLines = roadmap.split('\n').filter((line) => /^- \[ \]/.test(line));
const classifiedPattern =
  /\*\*(?:AÇÃO EXTERNA|BLOQUEADO|EM ANDAMENTO|DECISÃO EXTERNA) (EXT-\d{2})\*\*/;
const roadmapIds = pendingLines.map((line) => {
  const match = line.match(classifiedPattern);
  assert(match, `Item pendente sem classificacao externa: ${line}`);
  return match[1];
});

assert(
  new Set(roadmapIds).size === roadmapIds.length,
  'Cada acao externa deve aparecer uma unica vez entre os itens pendentes',
);

const registerRows = register
  .split('\n')
  .filter((line) => /^\|\s*EXT-\d{2}\s*\|/.test(line))
  .map((line) =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );
const registerIds = registerRows.map(([id]) => id);
const allowedStatuses = new Set(['Aberta', 'Bloqueada', 'Aguardando decisão', 'Diferida']);

assert(register.includes('Última atualização:'), 'Registro externo sem data de atualizacao');
assert(registerRows.length === roadmapIds.length, 'Roadmap e registro externo divergem');
assert(
  new Set(registerIds).size === registerIds.length,
  'Registro externo possui identificadores duplicados',
);

for (const id of roadmapIds) {
  assert(registerIds.includes(id), `Acao ${id} ausente do registro externo`);
}

for (const [id, status, owner, dependency, action, evidence] of registerRows) {
  assert(allowedStatuses.has(status), `Status invalido em ${id}: ${status}`);
  assert(owner && dependency && action && evidence, `Acao ${id} possui campo obrigatorio vazio`);
}

assert(
  !/(?:service_role|sb_secret_|eyJ[A-Za-z0-9_-]{20,})/i.test(register),
  'Registro externo nao pode conter chaves ou tokens',
);

console.log(
  `Contrato do roadmap: ${roadmapIds.length} acoes externas classificadas e rastreaveis OK`,
);
