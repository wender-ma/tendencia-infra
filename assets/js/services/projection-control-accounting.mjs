export const PROJECTION_MOVEMENT_DIRECTIONS = Object.freeze({
  ENTRY: 'entrada',
  EXIT: 'saida',
  INVALID: 'invalida',
});

function normalizeText(value) {
  return String(value || '').trim();
}

export function getProjectionMovementAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

export function resolveProjectionMovementDirection(movement = {}, controlledInput = '') {
  const type = normalizeText(movement.tipo);
  if (type === 'aporte') return PROJECTION_MOVEMENT_DIRECTIONS.ENTRY;
  if (type === 'devolucao') return PROJECTION_MOVEMENT_DIRECTIONS.EXIT;

  const input = normalizeText(controlledInput);
  const origin = normalizeText(movement.origem);
  const destination = normalizeText(movement.destino);

  if (input && origin === input && destination === input) {
    return PROJECTION_MOVEMENT_DIRECTIONS.INVALID;
  }
  if (input && destination === input) return PROJECTION_MOVEMENT_DIRECTIONS.ENTRY;
  if (input && origin === input) return PROJECTION_MOVEMENT_DIRECTIONS.EXIT;

  if (
    movement.direcao === PROJECTION_MOVEMENT_DIRECTIONS.ENTRY ||
    movement.direcao === PROJECTION_MOVEMENT_DIRECTIONS.EXIT
  ) {
    return movement.direcao;
  }
  return PROJECTION_MOVEMENT_DIRECTIONS.INVALID;
}

export function getProjectionMovementSignedValue(movement = {}) {
  const amount = getProjectionMovementAmount(movement.valor);
  if (movement.direcao === PROJECTION_MOVEMENT_DIRECTIONS.ENTRY) return amount;
  if (movement.direcao === PROJECTION_MOVEMENT_DIRECTIONS.EXIT) return -amount;
  return 0;
}

export function calculateProjectionBalance(movements = []) {
  return movements.reduce(
    (balance, movement) => balance + getProjectionMovementSignedValue(movement),
    0,
  );
}
