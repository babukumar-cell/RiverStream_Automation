import { Reporter, FullConfig, Suite, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
import { generateElegantReport } from './generate-elegant-report';
import path from 'path';

/**
 * Playwright Custom Reporter: ElegantDarkReporter
 * Automatically runs at the conclusion of every Playwright test run
 * and outputs the modern, dark & colorful HTML report to playwright-report/index.html.
 */
export default class ElegantDarkReporter implements Reporter {
  private summaryPath: string = '';
  private outputPath: string = '';

  onBegin(config: FullConfig, suite: Suite) {
    this.summaryPath = path.resolve(process.cwd(), 'test-results/summary.json');
    this.outputPath = path.resolve(process.cwd(), 'playwright-report/index.html');
  }

  async onEnd(result: FullResult) {
    // Allow Playwright's built-in JSON reporter 500ms to flush summary.json if running in parallel
    await new Promise(resolve => setTimeout(resolve, 800));

    try {
      generateElegantReport(this.summaryPath, this.outputPath);
    } catch (err: any) {
      console.error('[ElegantDarkReporter] Error generating elegant dark report:', err.message);
    }
  }
}
