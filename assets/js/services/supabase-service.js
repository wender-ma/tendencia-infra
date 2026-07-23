import { createClient } from '@supabase/supabase-js';

const DEFAULT_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1000;

export function createSupabaseService(
  {
    url,
    anonKey,
    configurationStatus = 'ready',
    environment = 'unconfigured',
    buildMode = 'unconfigured',
  },
  { reportError = (context, error) => console.warn(`[${context}]`, error) } = {},
) {
  let client = null;
  let initializationError = null;

  if (!url || !anonKey) {
    if (configurationStatus === 'environment-mismatch') {
      initializationError = new Error(
        `Configuracao Supabase declarada para ${environment}, mas o build usa ${buildMode}`,
      );
      reportError('Supabase/validar ambiente', initializationError);
    }
  } else {
    try {
      client = createClient(url, anonKey);
      console.log('[SUPA] cliente inicializado');
    } catch (error) {
      initializationError = error;
      reportError('Supabase/inicializar cliente', error);
    }
  }

  async function retry(operation, maxAttempts = DEFAULT_RETRY_ATTEMPTS) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxAttempts - 1) throw error;
        await new Promise((resolve) => {
          setTimeout(resolve, BASE_RETRY_DELAY_MS * 2 ** attempt);
        });
        reportError(`Supabase/retry ${attempt + 1} de ${maxAttempts}`, error);
      }
    }

    return undefined;
  }

  return Object.freeze({
    client,
    initializationError,
    configurationStatus,
    environment,
    buildMode,
    retry,
    url,
  });
}
