const { expect, test } = require('@playwright/test');

const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'desktop', width: 1440, height: 900 },
];

for (const viewport of viewports) {
  test(`layout ${viewport.name} sem overflow ou sobreposição estrutural`, async ({ browser }, testInfo) => {
    const page = await browser.newPage({ viewport });
    await page.route('https://*.supabase.co/**', route => route.abort());
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardPerformance?.snapshot().boot.completed === true);

    const layout = await page.evaluate(() => {
      const header = document.querySelector('.page-header').getBoundingClientRect();
      const main = document.querySelector('main').getBoundingClientRect();
      const activePanel = document.querySelector('.tab-content.active').getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        headerOverlapsMain: header.bottom > main.top + 1,
        activePanelVisible: activePanel.width > 0 && activePanel.height > 0,
      };
    });

    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.headerOverlapsMain).toBe(false);
    expect(layout.activePanelVisible).toBe(true);

    await page.locator('#authBtn').click();
    await expect(page.locator('#loginModalBackdrop')).toHaveClass(/show/);
    const dialogLayout = await page.locator('#loginModalBackdrop [role="dialog"]').evaluate(dialog => {
      const rect = dialog.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    expect(dialogLayout.left).toBeGreaterThanOrEqual(0);
    expect(dialogLayout.right).toBeLessThanOrEqual(dialogLayout.viewportWidth);
    expect(dialogLayout.top).toBeGreaterThanOrEqual(0);
    expect(dialogLayout.bottom).toBeLessThanOrEqual(dialogLayout.viewportHeight);
    await page.getByRole('button', { name: 'Fechar acesso ao dashboard' }).click();

    await testInfo.attach(`dashboard-${viewport.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    await page.close();
  });
}
