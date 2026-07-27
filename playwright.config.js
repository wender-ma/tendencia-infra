const { defineConfig, devices } = require('@playwright/test');

const previewPort = Number(process.env.PLAYWRIGHT_PORT || 4174);

module.exports = defineConfig({
  testDir: './scripts/browser',
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${previewPort}`,
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox-compat',
      testMatch: /compatibility\.spec\.js/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit-compat',
      testMatch: /compatibility\.spec\.js/,
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: `npm run build:test && npm run preview -- --host 127.0.0.1 --port ${previewPort}`,
    env: {
      ...process.env,
      VITE_APP_ENV: 'test',
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-public-key',
      VITE_DATASET_PERSISTENCE_MODE: 'dual',
    },
    url: `http://127.0.0.1:${previewPort}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
