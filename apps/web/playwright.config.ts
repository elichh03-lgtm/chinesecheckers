import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false, // tests share server state (in-memory store)
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx --yes pnpm@9 --filter server dev',
      port: 3001,
      cwd: '../..',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npx --yes pnpm@9 --filter web dev',
      port: 5173,
      cwd: '../..',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
