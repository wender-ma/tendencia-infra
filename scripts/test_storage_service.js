#!/usr/bin/env node

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../assets/js/services/storage-service.mjs'),
  );
  const { createSafeStorage } = await import(moduleUrl.href);
  const data = new Map();
  const service = createSafeStorage({
    storage: {
      setItem: (key, value) => data.set(key, value),
      getItem: (key) => data.get(key) ?? null,
      removeItem: (key) => data.delete(key),
    },
  });
  assert.strictEqual(service.set('key', 'value'), true);
  assert.strictEqual(service.get('key', 'fallback'), 'value');
  assert.strictEqual(service.remove('key'), true);
  assert.strictEqual(service.get('key', 'fallback'), 'fallback');

  const warnings = [];
  let quotaNotifications = 0;
  const quotaService = createSafeStorage({
    storage: {
      setItem() {
        const error = new Error('full');
        error.name = 'QuotaExceededError';
        throw error;
      },
    },
    warn: (...args) => warnings.push(args),
    notifyQuotaExceeded: () => {
      quotaNotifications += 1;
    },
  });
  assert.strictEqual(quotaService.set('key', 'value'), false);
  assert.strictEqual(quotaNotifications, 1);
  assert.strictEqual(warnings.length, 1);

  console.log('Storage seguro: fallback, remoção e limite de quota OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
