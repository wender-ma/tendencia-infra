#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');
const stateModule = fs.readFileSync(path.join(root, 'assets/js/state.js'), 'utf8');
const configModule = fs.readFileSync(path.join(root, 'assets/js/config.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'assets/js/bootstrap.js'), 'utf8');
const legacy = fs.readFileSync(path.join(root, 'assets/js/dashboard-legacy.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(stateModule.includes('export function createAppState('), 'Factory do estado ausente');
assert(
  stateModule.includes('export function installLegacyStateGlobals('),
  'Adaptador de estado ausente',
);
assert(
  stateModule.includes("import { STORAGE_KEYS } from './config.js'"),
  'Estado não usa as chaves centralizadas',
);
assert(
  configModule.includes("evolution: 'jzurique_evol_global'"),
  'Persistencia da evolucao ausente',
);
assert(
  configModule.includes("cardMode: 'jzurique_card3_modo'"),
  'Persistencia do modo do card ausente',
);
assert(
  configModule.includes("correctionIndex: 'jzurique_indice_correcao'"),
  'Persistencia do indice ausente',
);

const aliases = [
  'DATA_T',
  'DATA_F',
  'HISTORICO',
  'PROJ_RAW',
  'sortKey',
  'sortDir',
  'sortKeyF',
  'sortDirF',
  'GESTAO_LABEL',
  'EVOL_GLOBAL',
  'CARD3_MODO',
  'CORRECAO_INDICE',
  '_headerEditable',
  'OBRAS',
  'OBRA_ATIVA',
  'MAP_DESTINO',
  'MAP_ORIGEM',
  'donutHidden',
  '_lastTipoSum',
];

for (const alias of aliases) {
  assert(new RegExp(`\\b${alias}: \\['`).test(stateModule), `Alias de estado ausente: ${alias}`);
}
assert(stateModule.includes('descriptors.LAST_UPLOADS'), 'Alias de uploads ausente');
assert(
  stateModule.includes('target.dashboardState = state'),
  'Referencia publica do estado ausente',
);

assert(bootstrap.includes("from './state.js'"), 'Bootstrap nao importa o modulo de estado');
assert(bootstrap.includes('const appState = createAppState();'), 'Bootstrap nao cria o estado');
assert(
  bootstrap.includes('installLegacyStateGlobals(appState);'),
  'Bootstrap nao instala os aliases',
);
assert(
  bootstrap.indexOf('installLegacyStateGlobals(appState);') <
    bootstrap.indexOf('Promise.resolve()'),
  'Estado deve existir antes do carregamento do legado',
);
assert(
  bootstrap.includes('getActiveProject: () => appState.obra.ativa'),
  'Auth nao consulta a obra no estado central',
);

for (const removedLegacyContract of [
  'const AppState =',
  'Object.defineProperties(window, {',
  'const LAST_UPLOADS =',
  'function getActiveProjectCode(',
]) {
  assert(
    !legacy.includes(removedLegacyContract),
    `Estado ainda declarado no legado: ${removedLegacyContract}`,
  );
}

async function verifyStateFactory() {
  const moduleUrl = pathToFileURL(path.join(root, 'assets/js/state.js'));
  const { createAppState } = await import(moduleUrl.href);
  const preferences = new Map([
    ['jzurique_card3_modo', 'liquido'],
    ['jzurique_indice_correcao', 'ipca'],
    ['jzurique_evol_global', JSON.stringify({ teorica: 12, financeira: 8 })],
  ]);
  const state = createAppState({
    storage: { getItem: (key) => preferences.get(key) ?? null },
  });

  assert(state.config.card3Modo === 'liquido', 'Modo do card nao foi restaurado');
  assert(state.config.correcaoIndice === 'ipca', 'Indice de correcao nao foi restaurado');
  assert(state.config.evolGlobal.teorica === 12, 'Evolucao teorica nao foi restaurada');
  assert(state.config.evolGlobal.financeira === 8, 'Evolucao financeira nao foi restaurada');
}

verifyStateFactory()
  .then(() => {
    console.log(
      `Contrato de estado: modulo externo e ${aliases.length + 1} aliases sincronizados OK`,
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
