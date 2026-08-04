export const FLOW_REFLECTION_STATUSES = Object.freeze(['pendente', 'sim', 'nao', 'ipca', 'incc']);

export const REFLECTED_FLOW_STATUSES = Object.freeze(['sim', 'ipca', 'incc']);

export function normalizeReflectionStatus(value) {
  return FLOW_REFLECTION_STATUSES.includes(value) ? value : 'pendente';
}

export function isReflectedStatus(value) {
  return REFLECTED_FLOW_STATUSES.includes(normalizeReflectionStatus(value));
}

export function inflationIndexFromReflectionStatus(value) {
  const status = normalizeReflectionStatus(value);
  return status === 'ipca' || status === 'incc' ? status : null;
}

export function normalizeReflectionMonth(value) {
  const match = String(value || '')
    .trim()
    .match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}-01`;
}

export function currentReflectionMonth(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export function resolveReflectionMonth(status, currentValue, now = new Date()) {
  if (!isReflectedStatus(status)) return null;
  return normalizeReflectionMonth(currentValue) || currentReflectionMonth(now);
}

export function reflectionMonthInputValue(value) {
  return normalizeReflectionMonth(value)?.slice(0, 7) || '';
}

export function formatReflectionMonth(value) {
  const normalized = normalizeReflectionMonth(value);
  return normalized ? `${normalized.slice(5, 7)}/${normalized.slice(0, 4)}` : '—';
}
