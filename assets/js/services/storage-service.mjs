export function createSafeStorage({
  storage,
  warn = () => {},
  notifyQuotaExceeded = () => {},
} = {}) {
  function set(key, value) {
    try {
      storage?.setItem(key, value);
      return Boolean(storage);
    } catch (error) {
      warn(`Storage/salvar/${key}`, error);
      if (error?.name === 'QuotaExceededError' || error?.code === 22) notifyQuotaExceeded();
      return false;
    }
  }

  function get(key, fallback = null) {
    try {
      const value = storage?.getItem(key);
      return value !== null && value !== undefined ? value : fallback;
    } catch (error) {
      warn(`Storage/ler/${key}`, error);
      return fallback;
    }
  }

  function remove(key) {
    try {
      storage?.removeItem(key);
      return Boolean(storage);
    } catch (error) {
      warn(`Storage/remover/${key}`, error);
      return false;
    }
  }

  return Object.freeze({ set, get, remove });
}

export function installLegacySafeStorage(service, target = window) {
  target.SafeStorage = service;
}
