import fs from 'fs';
import path from 'path';
import type { FullConfig, FullResult, Reporter, Suite, TestError } from '@playwright/test/reporter';
import { DEFAULT_REPORT_PATH, renderElegantReport } from './generate-elegant-report';
import { DEFAULT_SUMMARY_PATH, errorMessage, runFromSuite, stripAnsi } from './report-data';

/**
 * Playwright reporter that writes the elegant dark HTML report to playwright-report/index.html.
 *
 * The report is built from the in-memory Suite / TestResult objects, so it never depends on
 * when the JSON reporter flushes test-results/summary.json. After rendering it still checks that
 * summary.json belongs to this run, because the email and `npm run report:build` read that file.
 */
export default class ElegantDarkReporter implements Reporter {
  private rootSuite?: Suite;
  private rootDir = process.cwd();
  private readonly globalErrors: string[] = [];

  constructor(private readonly options: { outputFile?: string; summaryFile?: string } = {}) {}

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.rootSuite = suite;
    this.rootDir = config.rootDir;
  }

  onError(error: TestError): void {
    this.globalErrors.push(stripAnsi(error.stack || error.message || String(error.value || '')).trim());
  }

  onEnd(result: FullResult): void {
    if (!this.rootSuite) return;
    const outputFile = this.options.outputFile ? path.resolve(this.options.outputFile) : DEFAULT_REPORT_PATH;
    try {
      const run = runFromSuite(this.rootSuite, {
        rootDir: this.rootDir,
        startTime: result.startTime,
        durationMs: result.duration,
        globalErrors: this.globalErrors,
      });
      renderElegantReport(run, outputFile);
    } catch (err) {
      console.error(`[ElegantDarkReporter] Could not generate the HTML report: ${errorMessage(err)}`);
    }
    this.checkSummaryFreshness(result.startTime);
  }

  /** Warns (does not fail) when summary.json is missing or left over from an earlier run. */
  private checkSummaryFreshness(runStart: Date): void {
    const summaryPath = this.options.summaryFile ? path.resolve(this.options.summaryFile) : DEFAULT_SUMMARY_PATH;
    const hint =
      'The email report (npm run report:email) and npm run report:build read this file; make sure the json ' +
      "reporter writing it is listed BEFORE this reporter in playwright.config.ts.";
    if (!fs.existsSync(summaryPath)) {
      console.warn(`[ElegantDarkReporter] WARNING: ${summaryPath} was not written by this run. ${hint}`);
      return;
    }
    try {
      const { stats } = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as { stats?: { startTime?: string } };
      const summaryStart = stats?.startTime ? new Date(stats.startTime).getTime() : NaN;
      // Allow a little clock slack between Playwright's own start time and onBegin.
      if (!Number.isFinite(summaryStart) || summaryStart < runStart.getTime() - 5000) {
        console.warn(
          `[ElegantDarkReporter] WARNING: ${summaryPath} is stale (started ${stats?.startTime ?? 'unknown'}, ` +
            `this run started ${runStart.toISOString()}). ${hint}`,
        );
      }
    } catch (err) {
      console.warn(`[ElegantDarkReporter] WARNING: could not read ${summaryPath}: ${errorMessage(err)}. ${hint}`);
    }
  }
}
