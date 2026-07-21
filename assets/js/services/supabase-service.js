import { createClient } from '@supabase/supabase-js';

const DEFAULT_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1000;

export function createSupabaseService({ url, anonKey }) {
  let client = null;
  let initializationError = null;

  try {
    if (!url || !anonKey) throw new Error('Configuracao do Supabase incompleta');
    client = createClient(url, anonKey);
    console.log('[SUPA] cliente inicializado');
  } catch (error) {
    initializationError = error;
    console.warn('[SUPA] falha ao inicializar:', error);
  }

  async function retry(operation, maxAttempts = DEFAULT_RETRY_ATTEMPTS) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxAttempts - 1) throw error;
        await new Promise(resolve => {
          setTimeout(resolve, BASE_RETRY_DELAY_MS * (2 ** attempt));
        });
        console.warn(`[SUPA] retry ${attempt + 1}/${maxAttempts} apos erro:`, error.message || error);
      }
    }

    return undefined;
  }

  return Object.freeze({
    client,
    initializationError,
    retry,
    url,
  });
}

export function installLegacySupabaseGlobals(service, target = window) {
  target.supabase = Object.freeze({ createClient });
  target.SUPA = service.client;
  target.supaRetry = service.retry;
  target.dashboardServices = Object.freeze({ supabase: service });
}
