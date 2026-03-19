import { defineConfig } from '@playwright/test';

const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 4100);
const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 4174);
const repoRoot = process.cwd();

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  globalSetup: './tests/e2e/global.setup.ts',
  webServer: [
    {
      command: `cd "${repoRoot}" && AUTH_DEV_BYPASS=false API_PORT=${apiPort} WEB_ORIGIN=http://127.0.0.1:${webPort} pnpm --filter @origin-draft/api dev`,
      url: `http://127.0.0.1:${apiPort}/api/session/config`,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
    },
    {
      command: `cd "${repoRoot}" && VITE_API_BASE_URL=http://127.0.0.1:${apiPort}/api pnpm --filter @origin-draft/web dev --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
    },
  ],
});
