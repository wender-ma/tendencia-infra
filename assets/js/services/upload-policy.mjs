const MEBIBYTE = 1024 * 1024;

export const MAX_UPLOAD_SIZE_BYTES = 50 * MEBIBYTE;

export const UPLOAD_POLICIES = Object.freeze({
  csv: Object.freeze({ extensions: Object.freeze(['.csv']), label: 'CSV (.csv)' }),
  excel: Object.freeze({
    extensions: Object.freeze(['.xlsx', '.xlsm', '.xls']),
    label: 'Excel (.xlsx, .xlsm ou .xls)',
  }),
});

function extensionOf(filename) {
  const normalized = String(filename || '')
    .trim()
    .toLowerCase();
  const dotIndex = normalized.lastIndexOf('.');
  return dotIndex >= 0 ? normalized.slice(dotIndex) : '';
}

export function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < MEBIBYTE) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / MEBIBYTE).toFixed(1)} MB`;
}

export function validateUploadFile(file, policyName) {
  const policy = UPLOAD_POLICIES[policyName];
  if (!file || !policy) {
    return { valid: false, code: 'invalid-policy', message: 'Arquivo ou política inválida.' };
  }
  if (!file.size) {
    return { valid: false, code: 'empty', message: 'O arquivo está vazio.' };
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return {
      valid: false,
      code: 'too-large',
      message: `Arquivo muito grande. Limite: 50 MB; recebido: ${formatFileSize(file.size)}.`,
    };
  }
  if (!policy.extensions.includes(extensionOf(file.name))) {
    return {
      valid: false,
      code: 'extension',
      message: `Formato inválido. Envie um arquivo ${policy.label}.`,
    };
  }
  return { valid: true, code: 'ok', message: '', sizeLabel: formatFileSize(file.size) };
}

export function installLegacyUploadPolicy(target = window) {
  target.validateUploadFile = validateUploadFile;
}
