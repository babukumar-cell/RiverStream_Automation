// Renders one HTML document to a PDF (or PNG) file. Usage: node render-worker.cjs <job.json>
// job = { html, out, kind: 'pdf' | 'png', viewport?: { width, height } }
//
// Runs in its own process on purpose: a browser launched inside a Playwright test worker is tracked by the
// test runner, which then attaches a screenshot of every page it opens to the test report.
const fs = require('fs');
const { chromium } = require('playwright-core');

(async () => {
  const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const browser = await chromium.launch({ headless: true }); // page.pdf() only works headless
  try {
    const page = await browser.newPage(job.viewport ? { viewport: job.viewport } : {});
    await page.setContent(job.html);
    if (job.kind === 'pdf') {
      await page.pdf({ path: job.out, format: 'A4', margin: { top: '20px', bottom: '20px' } });
    } else {
      // Written directly: page.screenshot({ path }) refuses a non-image extension (TC_015 needs PNG bytes in a .pdf)
      fs.writeFileSync(job.out, await page.screenshot({ type: 'png' }));
    }
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
