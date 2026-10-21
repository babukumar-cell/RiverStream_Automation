import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';

/**
 * Generates an executive PDF report from the HTML dashboard
 * using Playwright's headless browser and @media print styling.
 */
export async function generatePdfReport(
  htmlPath: string = path.resolve(process.cwd(), 'playwright-report/index.html'),
  outputPdfPath: string = path.resolve(process.cwd(), 'test-results/RiverStream_QA_Execution_Report.pdf')
): Promise<string | null> {
  if (!fs.existsSync(htmlPath)) {
    console.warn(`[PdfGenerator] HTML report not found at: ${htmlPath}. Skipping PDF export.`);
    return null;
  }

  const outDir = path.dirname(outputPdfPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log('[PdfGenerator] Launching headless browser for PDF generation...');
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1080 }
    });

    // Navigate to local HTML report
    const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
    await page.goto(fileUrl, { waitUntil: 'load', timeout: 30000 });

    // Expand all test cards so all plain English expected and actual results are visible
    await page.evaluate(() => {
      document.querySelectorAll('.test-card').forEach(card => {
        card.classList.add('open');
      });
    });

    // Short wait to ensure DOM reflects expanded state
    await page.waitForTimeout(600);

    // Generate PDF with executive styling
    await page.pdf({
      path: outputPdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '12mm',
        bottom: '12mm',
        left: '12mm',
        right: '12mm'
      },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 8px; width: 100%; display: flex; justify-content: space-between; padding: 0 15mm; color: #64748b;">
          <span>RiverStream QA Automation — Executive Test Execution Report</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>
      `
    });

    const stat = fs.statSync(outputPdfPath);
    console.log(`[PdfGenerator] Executive PDF report successfully generated at: ${outputPdfPath} (${(stat.size / 1024).toFixed(1)} KB)`);
    return outputPdfPath;
  } catch (err: any) {
    console.error('[PdfGenerator] Error during PDF generation:', err.message);
    return null;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// Auto-run if executed directly
if (require.main === module) {
  generatePdfReport().catch((err) => {
    console.error('[PdfGenerator Fatal]', err);
  });
}
