const { expect, test } = require('@playwright/test');

test('modal de acesso valida formulários e monta identidade como texto', async ({ page }) => {
  await page.route('https://*.supabase.co/**', (route) => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => window.dashboardPerformance?.snapshot().boot.completed === true);

  await page.locator('#authBtn').click();
  await expect(page.locator('#loginTabLogin')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#loginTabSignup').click();
  await expect(page.locator('#loginTabSignup')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#loginPanelSignup')).toBeVisible();
  await expect(page.locator('#loginPanelLogin')).toBeHidden();

  await page.locator('#signupEmail').fill('email-invalido');
  await page.locator('#signupSenha').fill('123456');
  await page.locator('#signupSenha2').fill('123456');
  await page.locator('#signupEmailForm').dispatchEvent('submit');
  await expect(page.locator('#signupErro')).toHaveText('Email inválido.');

  const payload = '<img src=x onerror=window.__authXss=1>';
  await page.evaluate((email) => {
    Object.assign(window.AUTH, {
      ready: true,
      user: { email },
      isAdminGeral: false,
      isEditor: false,
      isPending: false,
      editaObras: [],
    });
    window.updateAuthUI();
  }, payload);
  await expect(page.locator('#authBadge')).toContainText(payload.slice(0, 24));
  expect(await page.locator('#authBadge img').count()).toBe(0);
  expect(await page.evaluate(() => window.__authXss)).toBeUndefined();
});
