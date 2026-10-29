import { defineConfig, devices } from '@playwright/test';
import { Config } from './src/config/environment';

const workers = process.env.WORKERS ? parseInt(process.env.WORKERS, 10) : 1;
const isSettingsRun = process.argv.some((arg) => arg.includes('settings')) || process.env.RUN_SETTINGS === 'true';

export default defineConfig({
  testDir: './tests',
  testIgnore: isSettingsRun ? [] : ['**/settings/**'],
  // Specs that mutate shared QA data opt into serial mode via test.describe.configure.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers,
  timeout: 90000,
  expect: {
    timeout: 15000,
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
    actionTimeout: 20000,
    navigationTimeout: 45000,
    trace: 'retain-on-failure',
    screenshot: 'on',
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
      name: 'po-quote',
      dependencies: ['setup'],
      testMatch: [
        /(auth|left-side|upload|documents|review|email)[/\\][^/\\]+\.spec\.ts/,
      ],
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.BROWSER_CHANNEL || undefined,
        storageState: Config.adminStorageState,
      },
    },
    {
      name: 'po-ack',
      dependencies: ['setup'],
      testMatch: [
        /po-ack-recon[/\\][^/\\]+\.spec\.ts/,
        /po-ack-smoke\.spec\.ts/,
      ],
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.BROWSER_CHANNEL || undefined,
        storageState: Config.adminStorageState,
      },
    },
  ],
});
