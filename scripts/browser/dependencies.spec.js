const { expect, test } = require('@playwright/test');

test('carrega dependencias locais e inicia o dashboard', async ({ page }) => {
  const pageErrors = [];
  const failedLocalAssets = [];

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.hostname === '127.0.0.1' && response.status() >= 400) {
      failedLocalAssets.push(`${response.status()} ${url.pathname}`);
    }
  });

  await page.route('https://*.supabase.co/**', route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => (
    typeof window.supabase?.createClient === 'function'
    && typeof window.XLSX?.read === 'function'
    && typeof window.ApexCharts === 'function'
    && typeof window.handleAuthClick === 'function'
  ));

  const runtime = await page.evaluate(() => ({
    sheetJsVersion: window.XLSX.version,
    hasSupabase: typeof window.supabase.createClient === 'function',
    hasSupabaseService: window.dashboardServices?.supabase?.client === window.SUPA,
    hasExternalConfig: window.dashboardConfig?.dashboard === window.CONFIG,
    hasApexCharts: typeof window.ApexCharts === 'function',
    hasDashboardHandler: typeof window.handleAuthClick === 'function',
    status: document.getElementById('supaBadge')?.textContent,
  }));

  expect(runtime).toMatchObject({
    sheetJsVersion: '0.20.3',
    hasSupabase: true,
    hasSupabaseService: true,
    hasExternalConfig: true,
    hasApexCharts: true,
    hasDashboardHandler: true,
  });
  expect(runtime.status).not.toBe('Falha ao iniciar');
  expect(pageErrors).toEqual([]);
  expect(failedLocalAssets).toEqual([]);
});
