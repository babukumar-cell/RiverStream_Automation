import fs from 'fs';
import path from 'path';
import { chromium, type Browser } from '@playwright/test';
import { errorMessage } from '../reporters/report-data';

/**
 * Prints the elegant HTML report (playwright-report/index.html) to an executive PDF using its
 * @media print styles. Throws on any problem; when run directly (npm run report:pdf) it exits 1.
 */
export async function generatePdfReport(
  htmlPath: string = path.resolve(process.cwd(), 'playwright-report/index.html'),
  outputPdfPath: string = path.resolve(process.cwd(), 'test-results/RiverStream_QA_Execution_Report.pdf'),
): Promise<string> {
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`HTML report not found at ${htmlPath}. Run the tests or npm run report:build first.`);
  }
  fs.mkdirSync(path.dirname(outputPdfPath), { recursive: true });

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'load', timeout: 30000 });
    await page.emulateMedia({ media: 'print' });

    // Ensure all test cards are visible and open so expected/actual results print, hide empty state, then wait for images and fonts.
    await page.evaluate(async () => {
      document.querySelectorAll('.test-card').forEach((card) => {
        (card as HTMLElement).style.display = 'block';
        card.classList.add('open');
      });
      const emptyState = document.getElementById('emptyState');
      if (emptyState) (emptyState as HTMLElement).style.display = 'none';

      const images = Array.from(document.images);
      images.forEach((img) => (img.loading = 'eager'));
      const pending = images
        .filter((img) => !img.complete)
        .map(
          (img) =>
            new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            }),
        );
      await Promise.all([document.fonts.ready, ...pending]);
    });

    await page.pdf({
      path: outputPdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 8px; width: 100%; display: flex; justify-content: space-between; padding: 0 15mm; color: #64748b;">
          <span>${process.env.SUITE_NAME || 'RiverStream QA Automation'} — Executive Test Execution Report</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>
      `,
    });

    const sizeKb = (fs.statSync(outputPdfPath).size / 1024).toFixed(1);
    console.log(`[PdfGenerator] PDF report written to ${outputPdfPath} (${sizeKb} KB)`);
    return outputPdfPath;
  } finally {
    await browser?.close();
  }
}

if (require.main === module) {
  generatePdfReport().catch((err) => {
    console.error(`[PdfGenerator] ${errorMessage(err)}`);
    process.exit(1);
  });
}
