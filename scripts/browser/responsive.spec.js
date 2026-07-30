const { expect, test } = require('@playwright/test');

const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'desktop', width: 1440, height: 900 },
];

for (const viewport of viewports) {
  test(`layout ${viewport.name} sem overflow ou sobreposição estrutural`, async ({
    browser,
  }, testInfo) => {
    const page = await browser.newPage({ viewport });
    await page.route('https://*.supabase.co/**', (route) => route.abort());
    await page.goto('/');
    await page.waitForFunction(
      () => window.dashboardServices?.performance.snapshot().boot.completed === true,
    );

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
    const dialogLayout = await page
      .locator('#loginModalBackdrop [role="dialog"]')
      .evaluate((dialog) => {
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
    await page.evaluate(() => {
      Object.assign(window.dashboardServices.auth.state, {
        user: { email: 'viewer@example.com' },
        isAdminGeral: false,
        isEditor: false,
        isPending: false,
        editaObras: [],
      });
      window.dashboardServices.authUi.updateAuthUI();
    });

    for (const tabName of [
      'visao',
      'flows',
      'projecao',
      'projecao_ctrl',
      'uploads',
      'manual',
    ]) {
      await page.locator(`.tab[data-tab="${tabName}"]`).click();
      await expect(page.locator(`#tab-${tabName}`)).toHaveClass(/active/);
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(viewport.width + 1);
    }

    await testInfo.attach(`dashboard-${viewport.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    await page.close();
  });

  test(`tabelas ${viewport.name} contêm textos longos sem alargar a página`, async ({
    browser,
  }, testInfo) => {
    const page = await browser.newPage({ viewport });
    await page.route('https://*.supabase.co/**', (route) => route.abort());
    await page.goto('/');
    await page.waitForFunction(
      () => window.dashboardServices?.performance.snapshot().boot.completed === true,
    );

    const layout = await page.evaluate(() => {
      const longText = `arquivo_sem_espacos_${'muito_longo_'.repeat(45)}.xlsx`;
      const host = document.createElement('section');
      host.id = 'table-format-regression';
      host.innerHTML = `
        <div class="card">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Arquivo</th><th>Responsavel</th><th>Acoes</th></tr></thead>
              <tbody><tr>
                <td class="uploads-history-file">${longText}</td>
                <td>${longText}</td>
                <td class="admin-actions-cell"><button class="btn-sm">Editar registro</button></td>
              </tr></tbody>
            </table>
          </div>
          <div class="uploads-history-list">
            <table class="uploads-history-table">
              <tbody><tr>
                <td class="uploads-history-file">${longText}</td>
                <td class="uploads-history-sender">${longText}</td>
                <td class="uploads-history-actions-cell">
                  <button class="btn-sm">Baixar arquivo</button>
                </td>
              </tr></tbody>
            </table>
          </div>
        </div>`;
      document.querySelector('main').append(host);

      const genericWrap = host.querySelector('.table-wrap');
      const genericTable = genericWrap.querySelector('table');
      const genericTextCell = genericTable.querySelector('td');
      const uploadWrap = host.querySelector('.uploads-history-list');
      const uploadTable = uploadWrap.querySelector('table');
      const uploadTextCell = uploadTable.querySelector('.uploads-history-file');

      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        generic: {
          clientWidth: genericWrap.clientWidth,
          scrollWidth: genericWrap.scrollWidth,
          tableWidth: genericTable.getBoundingClientRect().width,
          cellClientWidth: genericTextCell.clientWidth,
          cellScrollWidth: genericTextCell.scrollWidth,
        },
        uploads: {
          clientWidth: uploadWrap.clientWidth,
          scrollWidth: uploadWrap.scrollWidth,
          tableWidth: uploadTable.getBoundingClientRect().width,
          cellClientWidth: uploadTextCell.clientWidth,
          cellScrollWidth: uploadTextCell.scrollWidth,
        },
      };
    });

    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.generic.tableWidth).toBeLessThanOrEqual(
      Math.max(layout.generic.clientWidth, 720) + 2,
    );
    expect(layout.uploads.tableWidth).toBeLessThanOrEqual(
      Math.max(layout.uploads.clientWidth, 720) + 2,
    );
    expect(layout.generic.cellScrollWidth).toBeLessThanOrEqual(layout.generic.cellClientWidth + 1);
    expect(layout.uploads.cellScrollWidth).toBeLessThanOrEqual(layout.uploads.cellClientWidth + 1);
    if (viewport.width < 720) {
      expect(layout.generic.scrollWidth).toBeGreaterThan(layout.generic.clientWidth);
      expect(layout.uploads.scrollWidth).toBeGreaterThan(layout.uploads.clientWidth);
      const actionVisible = await page.locator('.uploads-history-list').evaluate((container) => {
        container.scrollLeft = container.scrollWidth;
        const containerRect = container.getBoundingClientRect();
        const actionRect = container.querySelector('button').getBoundingClientRect();
        return {
          scrolled: container.scrollLeft > 0,
          fullyVisible:
            actionRect.left >= containerRect.left - 1 &&
            actionRect.right <= containerRect.right + 1,
        };
      });
      expect(actionVisible.scrolled).toBe(true);
      expect(actionVisible.fullyVisible).toBe(true);
    }

    await testInfo.attach(`tables-long-content-${viewport.name}`, {
      body: await page.locator('#table-format-regression').screenshot(),
      contentType: 'image/png',
    });
    await page.close();
  });
}
