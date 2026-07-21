#!/usr/bin/env node

const path = require('path');
const { pathToFileURL } = require('url');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/ui/pagination.mjs'),
  ).href;
  const { createPaginationService } = await import(moduleUrl);
  const service = createPaginationService({ pageSize: 100, documentRef: {} });
  const rows = Array.from({ length: 250 }, (_, index) => index + 1);

  const first = service.paginate('table', rows, 'filter-a');
  assert(first.page === 1 && first.totalPages === 3, 'Primeira página incorreta');
  assert(first.items.length === 100 && first.start === 1 && first.end === 100, 'Fatia inicial incorreta');

  service.setPage('table', 2);
  const second = service.paginate('table', rows, 'filter-a');
  assert(second.page === 2 && second.items[0] === 101, 'Navegação para a segunda página falhou');

  const clamped = service.paginate('table', rows.slice(0, 20), 'filter-b');
  assert(clamped.page === 1 && clamped.totalPages === 1, 'Filtro novo não reiniciou a página');
  assert(clamped.end === 20, 'Resultado filtrado não foi limitado corretamente');
  assert(Object.isFrozen(clamped), 'Resultado da paginação deve ser imutável');

  console.log('Contrato de paginação: fatias, limites e reset por filtros OK');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
