import { defineConfig, devices } from '@playwright/test';
import { Config } from './src/config/environment';

// One id per test run, inherited by the workers (the email suite shares one submission per run).
process.env.RS_RUN_ID ??= String(Date.now());

const workers = process.env.WORKERS ? parseInt(process.env.WORKERS, 10) : 1;
const isSettingsRun = process.argv.some((arg) => arg.includes('settings')) || process.env.RUN_SETTINGS === 'true';

export default defineConfig({
  testDir: './tests',
  testIgnore: isSettingsRun ? [] : ['**/settings/**'],
  // Specs that mutate shared QA data opt into serial mode via test.describe.configure.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.RETRIES ? parseInt(process.env.RETRIES, 10) : (process.env.CI ? 2 : 1),
  workers,
  timeout: 120000,
  expect: {
    timeout: 20000,
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
    actionTimeout: 25000,
    navigationTimeout: 60000,
    trace: 'retain-on-failure',
    screenshot: 'on',
    // Videos are recorded at the window size, so the whole page is in the video (a project with a
    // different viewport sets the same size for its video)
    video: { mode: 'retain-on-failure', size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      slowMo: process.env.SLOWMO ? parseInt(process.env.SLOWMO, 10) : 0,
      // Windows display scaling (e.g. 125%) would zoom and crop the recorded videos: render at scale 1
      args: ['--force-device-scale-factor=1'],
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
      // Session of the Testing organization user (the SIF Conversion suite runs as that user)
      name: 'sif-setup',
      testMatch: /sif-user\.setup\.ts/,
    },
    {
      // SIF Conversion in the organization Testing (uploads, reviews and deletes its own PDFs);
      // the Super Admin session (setup) is used to switch Testing's SIF Conversion setting
      name: 'sif-conversion',
      dependencies: ['setup', 'sif-setup'],
      testMatch: [/sif-conversion[/\\][^/\\]+\.spec\.ts/],
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.BROWSER_CHANNEL || undefined,
        storageState: '.auth/sif-user.json',
        // Wider window: the file table (9 columns + row button) fits without horizontal scrolling
        viewport: { width: 1600, height: 900 },
        // recorded for every case at the window size; the report shows it for the cases annotated 'video' (and for failures)
        video: { mode: 'on', size: { width: 1600, height: 900 } },
      },
    },
    {
      // Billing / Stripe auto-renewal lifecycle (creates and deletes its own organization)
      name: 'autorenewal',
      dependencies: ['setup'],
      testMatch: [/autorenewal[/\\][^/\\]+\.spec\.ts/],
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.BROWSER_CHANNEL || undefined,
        storageState: Config.adminStorageState,
        // Wider window: the Billing History table and the plan cards fit without horizontal scrolling
        viewport: { width: 1600, height: 900 },
        // recorded for every case at the window size; the report shows it for the cases annotated 'video' (and for failures)
        video: { mode: 'on', size: { width: 1600, height: 900 } },
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
