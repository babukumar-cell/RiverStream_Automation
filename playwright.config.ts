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
      // PO/Quote Request precondition: the automation user (riverstreamautomation@gmail.com) is a user of the
      // Riverstone organization (created there if missing) and Direct Estimate Creation is ON
      name: 'po-quote-user',
      dependencies: ['setup'],
      testMatch: /po-quote-request[/\\]automation-user\.setup\.ts/,
    },
    {
      name: 'po-quote',
      dependencies: ['setup', 'po-quote-user'],
      testMatch: [/(auth|left-side|upload|documents|review|po-quote-request)[/\\][^/\\]+\.spec\.ts/],
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.BROWSER_CHANNEL || undefined,
        storageState: Config.adminStorageState,
      },
    },
    {
      // The SIF Conversion suite's user (riverstreamautomation@gmail.com) and organization, prepared by the Super Admin;
      // the organization's SIF Conversion switched ON; the user's session saved (tests/sif-conversion/support/sif-user.ts)
      name: 'sif-setup',
      dependencies: ['setup'],
      testMatch: /sif-user\.setup\.ts/,
    },
    {
      // SIF Conversion as riverstreamautomation@gmail.com in its organization (uploads, reviews and deletes its own PDFs);
      // the Super Admin session (setup) is used to switch the organization's SIF Conversion setting
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
      // Smoke suite (TC_SMOKE_001-020, workbook 11_Smoke_Test.xlsx): one quick pass over every module as the Super Admin
      name: 'smoke',
      dependencies: ['setup'],
      testMatch: [/smoke[/\\][^/\\]+\.spec\.ts/],
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.BROWSER_CHANNEL || undefined,
        storageState: Config.adminStorageState,
      },
    },
    {
      // ERP fail (tests/po-quote-request/erp-fail), the last part of the PO/Quote Request suite. It is listed after
      // po-quote and has the same dependencies, so with one worker it runs after every po-quote test (retries
      // included: Playwright re-queues a retry at the front), and it still runs when po-quote tests fail.
      // The Super Admin uploads a SIF, submits it with a customer that is not in the ERP, checks the popup and the
      // alert email.
      name: 'erp-fail',
      dependencies: ['setup', 'po-quote-user'],
      testMatch: [/po-quote-request[/\\]erp-fail[/\\][^/\\]+\.spec\.ts/],
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.BROWSER_CHANNEL || undefined,
        storageState: Config.adminStorageState,
        viewport: { width: 1600, height: 900 },
        video: { mode: 'retain-on-failure', size: { width: 1600, height: 900 } },
      },
    },
    {
      name: 'po-ack',
      dependencies: ['setup'],
      testMatch: [/po-ack-recon[/\\][^/\\]+\.spec\.ts/],
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.BROWSER_CHANNEL || undefined,
        storageState: Config.adminStorageState,
      },
    },
  ],
});
