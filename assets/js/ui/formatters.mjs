export function formatDate(value) {
  if (!value) return '';
  const normalized = String(value).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(normalized)) return normalized.split(' ')[0];

  if (/^\d{4,6}$/.test(normalized)) {
    const serial = Number.parseInt(normalized, 10);
    if (serial > 20000 && serial < 80000) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const date = new Date(epoch.getTime() + serial * 86400000);
      const day = String(date.getUTCDate()).padStart(2, '0');
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      return `${day}/${month}/${date.getUTCFullYear()}`;
    }
  }

  const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const month = Number.parseInt(iso[2], 10);
    const day = Number.parseInt(iso[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${iso[3]}/${iso[2]}/${iso[1]}`;
    }
  }
  return normalized;
}

export function escHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

export function escAttr(value) {
  return escHtml(value);
}
