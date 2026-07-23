const fs = require('fs');
const path = require('path');
const { expect, test } = require('@playwright/test');

const root = path.resolve(__dirname, '../..');
const headers = fs.readFileSync(path.join(root, 'public/_headers'), 'utf8');
const cspHeader = headers
  .split('\n')
  .find((line) => line.includes('Content-Security-Policy:'))
  ?.replace(/^\s*Content-Security-Policy:\s*/, '')
  .trim();

function assertCspHeader() {
  if (!cspHeader) throw new Error('CSP ausente em public/_headers');
  if (cspHeader.includes('unsafe-inline')) throw new Error('CSP não pode liberar unsafe-inline');
  if (!cspHeader.includes("style-src-attr 'none'")) {
    throw new Error('CSP deve bloquear atributos de estilo');
  }
}

test('CSP estrita permite os estilos auditados do ApexCharts', async ({ page }) => {
  assertCspHeader();
  const cspViolations = [];
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push({
        blockedURI: event.blockedURI,
        effectiveDirective: event.effectiveDirective,
        violatedDirective: event.violatedDirective,
      });
    });
  });
  await page.route('http://127.0.0.1:4174/', async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({
      response,
      body: html.replace(
        '<head>',
        `<head><meta http-equiv="Content-Security-Policy" content="${cspHeader}">`,
      ),
    });
  });
  await page.route('https://*.supabase.co/**', (route) => route.abort());
  await page.goto('/');
  await page.waitForFunction(
    () => window.dashboardServices?.performance.snapshot().boot.completed === true,
  );

  const chart = await page.evaluate(async () => {
    const host = document.createElement('div');
    host.id = 'strictCspApexProbe';
    document.body.append(host);
    const instance = await window.dashboardServices.runtime.renderApexChart('strictCspApexProbe', {
      series: [{ name: 'Teste', data: [1, 3, 2] }],
      chart: { type: 'line', height: 260, animations: { enabled: false } },
      xaxis: { categories: ['A', 'B', 'C'] },
      legend: { show: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const canvas = host.querySelector('.apexcharts-canvas');
    return {
      rendered: Boolean(instance && host.querySelector('svg')),
      canvasPosition: canvas ? getComputedStyle(canvas).position : null,
    };
  });
  cspViolations.push(...(await page.evaluate(() => window.__cspViolations)));

  expect(chart).toEqual({ rendered: true, canvasPosition: 'relative' });
  expect(cspViolations).toEqual([]);
});
