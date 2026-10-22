import { defineConfig, devices } from '@playwright/test';
import { Config } from './src/config/environment';

const workers = process.env.WORKERS ? parseInt(process.env.WORKERS, 10) : 1;

export default defineConfig({
  testDir: './tests',
  // Specs that mutate shared QA data opt into serial mode via test.describe.configure.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers,
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  // Order matters: Playwright calls reporter onEnd hooks sequentially, so the JSON summary
  // must be written before the custom HTML reporter reads it.
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/summary.json' }],
    ['allure-playwright', { outputFolder: 'allure-results' }],
    ['html', { open: 'never', outputFolder: 'reports/playwright-html' }],
    ['./src/reporters/elegant-dark-reporter.ts'],
  ],
  use: {
    baseURL: Config.baseUrl,
    headless: process.env.HEADLESS ? process.env.HEADLESS === 'true' : undefined,
    actionTimeout: 15000,
    navigationTimeout: 30000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      slowMo: process.env.SLOWMO ? parseInt(process.env.SLOWMO, 10) : 0,
    },
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.BROWSER_CHANNEL || undefined,
        storageState: Config.adminStorageState,
      },
    },
  ],
});
