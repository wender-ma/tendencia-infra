const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const URL_QUERY_PATTERN = /(https?:\/\/[^\s?#]+)[?#][^\s]*/gi;
const MAX_MESSAGE_LENGTH = 300;

function sanitizeText(value) {
  return String(value || '')
    .replace(JWT_PATTERN, '[token redacted]')
    .replace(EMAIL_PATTERN, '[email redacted]')
    .replace(URL_QUERY_PATTERN, '$1?[query redacted]')
    .slice(0, MAX_MESSAGE_LENGTH);
}

function sanitizeError(error) {
  const source = error && typeof error === 'object' ? error : { message: error };
  const safe = {
    name: sanitizeText(source.name || 'Error'),
    message: sanitizeText(source.message || source.error_description || source),
  };

  if (typeof source.code === 'string' || typeof source.code === 'number') {
    safe.code = sanitizeText(source.code);
  }
  if (typeof source.status === 'number') safe.status = source.status;
  return safe;
}

export function createLogger({
  consoleRef = console,
  now = () => new Date().toISOString(),
  limit = 100,
} = {}) {
  const entries = [];

  function write(level, context, error) {
    const entry = Object.freeze({
      timestamp: now(),
      level,
      context: sanitizeText(context || 'Aplicação'),
      error: Object.freeze(sanitizeError(error)),
    });
    entries.push(entry);
    if (entries.length > limit) entries.splice(0, entries.length - limit);

    const output = level === 'error' ? consoleRef.error : consoleRef.warn;
    output?.(`[${entry.context}]`, entry.error);
    return entry;
  }

  return Object.freeze({
    error: (context, error) => write('error', context, error),
    warn: (context, error) => write('warn', context, error),
    snapshot: () => entries.map((entry) => ({ ...entry, error: { ...entry.error } })),
    clear: () => entries.splice(0),
  });
}
