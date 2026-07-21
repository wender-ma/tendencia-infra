#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const port = 4175;
const url = `http://127.0.0.1:${port}/`;
const thresholds = Object.freeze({
  performance: 0.65,
  accessibility: 0.9,
  'best-practices': 0.85,
  seo: 0.75,
});

async function waitForServer(attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // O preview ainda está subindo.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Preview não iniciou dentro do prazo');
}

async function main() {
  const preview = spawn(
    process.execPath,
    [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port)],
    { cwd: root, stdio: 'ignore' },
  );
  let chrome;

  try {
    await waitForServer();
    const [{ default: lighthouse }, chromeLauncher] = await Promise.all([
      import('lighthouse'),
      import('chrome-launcher'),
    ]);
    chrome = await chromeLauncher.launch({
      chromePath: chromium.executablePath(),
      chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'],
    });
    const result = await lighthouse(url, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: Object.keys(thresholds),
      skipAudits: ['is-crawlable'],
    });

    const reportDirectory = path.join(root, '.lighthouseci');
    fs.mkdirSync(reportDirectory, { recursive: true });
    fs.writeFileSync(path.join(reportDirectory, 'lhr.json'), result.report);

    const scores = Object.fromEntries(
      Object.entries(thresholds).map(([category, minimum]) => {
        const score = result.lhr.categories[category]?.score || 0;
        return [category, { score, minimum, passed: score >= minimum }];
      }),
    );
    console.log('Lighthouse:', JSON.stringify(scores));

    const failures = Object.entries(scores).filter(([, value]) => !value.passed);
    if (failures.length) {
      throw new Error(
        `Orçamentos Lighthouse não atendidos: ${failures
          .map(([name, value]) => `${name} ${Math.round(value.score * 100)} < ${Math.round(value.minimum * 100)}`)
          .join(', ')}`,
      );
    }
  } finally {
    if (chrome) await chrome.kill();
    preview.kill('SIGTERM');
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
