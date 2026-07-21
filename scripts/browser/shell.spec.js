const { expect, test } = require('@playwright/test');

test('tema, navegação por teclado e alerta de defasagem funcionam', async ({ page }) => {
  await page.route('https://*.supabase.co/**', (route) => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => window.dashboardPerformance?.snapshot().boot.completed === true);

  await page.locator('#themeToggle').click();
  await expect(page.locator('body')).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem('jzurique_theme'))).toBe('dark');

  await page.locator('[data-tab="visao"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-tab="flows"]')).toBeFocused();
  await expect(page.locator('#tab-flows')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#tab-visao')).toHaveAttribute('aria-hidden', 'true');

  await page.evaluate(() => {
    window.GESTAO_LABEL = 'GESTÃO 01-2026';
    window.verificarDadosDesatualizados();
  });
  await expect(page.locator('#alertBanner .alert-banner')).toHaveClass(/is-critical/);
  await expect(page.locator('#alertBanner')).not.toContainText('[object Object]');
  expect(await page.locator('#alertBanner [style]').count()).toBe(0);

  await page.reload();
  await page.waitForFunction(() => window.dashboardPerformance?.snapshot().boot.completed === true);
  await expect(page.locator('body')).toHaveClass(/dark/);
  await expect(page.locator('[data-tab="flows"]')).toHaveClass(/active/);
});
