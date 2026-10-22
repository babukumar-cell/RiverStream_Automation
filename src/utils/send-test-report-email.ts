import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { generatePdfReport } from './generate-pdf-report';
import { DEFAULT_REPORT_PATH, renderElegantReport } from '../reporters/generate-elegant-report';
import {
  DEFAULT_SUMMARY_PATH,
  ReportCase,
  ReportRun,
  StatusCounts,
  countStatuses,
  errorMessage,
  escapeHtml,
  formatDuration,
  formatRunTime,
  knownDefects,
  loadRunFromSummary,
  passRate,
  summariseModules,
} from '../reporters/report-data';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Builds the execution summary email from test-results/summary.json and sends it with the
 * executive PDF attached.
 *
 *   npm run report:email                     send to REPORT_RECIPIENTS
 *   npm run report:email -- --recipients=a@x,b@y
 *   npm run report:email:preview             (--dry-run) write test-results/email-report.html only
 *
 * Exits non-zero when recipients or SMTP credentials are missing or sending fails (not in --dry-run).
 */

const MAX_SKIPPED_ROWS = 40;
const PDF_PATH = path.resolve(process.cwd(), 'test-results/RiverStream_QA_Execution_Report.pdf');

interface CliOptions {
  dryRun: boolean;
  noPdf: boolean;
  recipients?: string;
  summaryPath: string;
}

function parseArgs(argv: string[]): CliOptions {
  const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  return {
    dryRun: argv.includes('--dry-run'),
    noPdf: argv.includes('--no-pdf'),
    recipients: value('recipients'),
    summaryPath: value('summary') ? path.resolve(value('summary') as string) : DEFAULT_SUMMARY_PATH,
  };
}

class ReportEmailError extends Error {}

function runLinks(): { runUrl?: string } {
  if (process.env.REPORT_WEB_URL) return { runUrl: process.env.REPORT_WEB_URL };
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (GITHUB_REPOSITORY && GITHUB_RUN_ID) {
    return { runUrl: `${GITHUB_SERVER_URL || 'https://github.com'}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` };
  }
  return {};
}

// ---------------------------------------------------------------------------
// HTML building blocks (inline styles only: email clients ignore <style>)
// ---------------------------------------------------------------------------

const COLORS = {
  pass: '#15803d',
  fail: '#dc2626',
  flaky: '#7e22ce',
  skip: '#d97706',
  muted: '#64748b',
  navy: '#0b1b54',
};

function kpiCell(label: string, value: string | number, sub: string, color: string, bg: string, border: string): string {
  return `
          <td style="background-color: ${bg}; border: 1px solid ${border}; border-radius: 8px; padding: 12px 6px; text-align: center;">
            <div style="font-size: 10px; font-weight: 700; color: ${color}; text-transform: uppercase; letter-spacing: 0.5px;">${label}</div>
            <div style="font-size: 20px; font-weight: 800; color: ${color}; margin-top: 3px;">${value}</div>
            <div style="font-size: 10px; color: ${COLORS.muted}; margin-top: 2px;">${sub}</div>
          </td>`;
}

function countCell(n: number, color: string): string {
  return n > 0 ? `<span style="color: ${color}; font-weight: 700;">● ${n}</span>` : '0';
}

function sectionTitle(title: string, color: string = COLORS.navy): string {
  return `
      <h3 style="color: ${color}; font-size: 16px; margin: 0 0 8px 0; font-weight: bold;">${escapeHtml(title)}</h3>
      <div style="height: 2px; background-color: ${color}; margin-bottom: 14px;"></div>`;
}

function renderModuleTable(run: ReportRun, totals: StatusCounts, overallRate: number, runTime: string): string {
  const rows = summariseModules(run.cases)
    .map((m) => {
      const rateColor = m.passRate >= 90 ? COLORS.pass : m.passRate >= 70 ? COLORS.skip : COLORS.fail;
      return `
        <tr style="border-bottom: 1px solid #e5e7eb; font-size: 13px;">
          <td style="padding: 9px 12px; color: #1f2937; font-weight: 500;">${escapeHtml(m.module.name)}</td>
          <td style="padding: 9px 12px; text-align: center;">${m.total}</td>
          <td style="padding: 9px 12px; text-align: center;">${countCell(m.passed, COLORS.pass)}</td>
          <td style="padding: 9px 12px; text-align: center;">${countCell(m.failed, COLORS.fail)}</td>
          <td style="padding: 9px 12px; text-align: center;">${countCell(m.flaky, COLORS.flaky)}</td>
          <td style="padding: 9px 12px; text-align: center;">${countCell(m.skipped, COLORS.skip)}</td>
          <td style="padding: 9px 12px; text-align: center; color: ${rateColor}; font-weight: 600;">${m.passRate}%</td>
          <td style="padding: 9px 12px; text-align: center; color: #4b5563;">${formatDuration(m.durationMs)}</td>
        </tr>`;
    })
    .join('');
  const th = (label: string, align = 'center') => `<th style="padding: 9px 12px; text-align: ${align};">${label}</th>`;
  return `
    <div style="margin-bottom: 25px;">
      ${sectionTitle('Module-wise Results')}
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb;">
        <thead>
          <tr style="background-color: ${COLORS.navy}; color: #ffffff; font-size: 12px;">
            ${th('Module', 'left')}${th('Total')}${th('Passed')}${th('Failed')}${th('Flaky')}${th('Skipped')}${th('Pass Rate')}${th('Duration')}
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr style="background-color: #f3f4f6; border-top: 2px solid ${COLORS.navy}; font-size: 13px; font-weight: bold;">
            <td style="padding: 10px 12px;">TOTAL</td>
            <td style="padding: 10px 12px; text-align: center;">${totals.total}</td>
            <td style="padding: 10px 12px; text-align: center; color: ${COLORS.pass};">${totals.passed}</td>
            <td style="padding: 10px 12px; text-align: center; color: ${totals.failed ? COLORS.fail : COLORS.muted};">${totals.failed}</td>
            <td style="padding: 10px 12px; text-align: center; color: ${totals.flaky ? COLORS.flaky : COLORS.muted};">${totals.flaky}</td>
            <td style="padding: 10px 12px; text-align: center; color: ${COLORS.skip};">${totals.skipped}</td>
            <td style="padding: 10px 12px; text-align: center; color: ${overallRate >= 90 ? COLORS.pass : COLORS.fail};">${overallRate}%</td>
            <td style="padding: 10px 12px; text-align: center;">${runTime}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

function failureRow(c: ReportCase, accent: string, label: string, reason: string): string {
  const defect = c.knownDefects.length
    ? `<div style="margin-top: 6px; font-size: 11px; color: ${COLORS.flaky}; font-weight: 600;">🐞 Known defect: ${escapeHtml(c.knownDefects.join('; '))}</div>`
    : '';
  const technical = c.error
    ? `<details style="margin-top: 8px; font-size: 11px;">
              <summary style="color: ${accent}; cursor: pointer; font-weight: 600;">Technical details</summary>
              <pre style="margin: 6px 0 0 0; padding: 8px 10px; background-color: #1e293b; color: #fca5a5; border-radius: 4px; font-family: Consolas, 'Courier New', monospace; font-size: 11px; line-height: 1.4; white-space: pre-wrap; word-break: break-all;">${escapeHtml(c.error.split('\n').slice(0, 12).join('\n'))}</pre>
            </details>`
    : '';
  return `
        <tr style="border-bottom: 1px solid #e5e7eb; font-size: 12px; vertical-align: top;">
          <td style="padding: 10px; width: 16%;">
            <div style="color: ${accent}; font-weight: bold; font-family: Consolas, 'Courier New', monospace; font-size: 12px;">${escapeHtml(c.tcId)}</div>
            <div style="font-size: 11px; color: #4b5563; margin-top: 4px;">${escapeHtml(c.module.shortName)}</div>
          </td>
          <td style="padding: 10px; width: 30%;">
            <div style="font-weight: 700; color: #111827;">${escapeHtml(c.description)}</div>
            ${c.expectedResult ? `<div style="margin-top: 6px; color: #166534;"><strong>Expected:</strong> ${escapeHtml(c.expectedResult)}</div>` : ''}
          </td>
          <td style="padding: 10px; width: 54%;">
            <div style="color: #111827;"><strong style="color: ${accent};">${label}:</strong> ${escapeHtml(reason)}</div>
            ${defect}
            ${technical}
          </td>
        </tr>`;
}

function caseTable(title: string, accent: string, intro: string, rows: string): string {
  return `
    <div style="margin-top: 30px;">
      ${sectionTitle(title, accent)}
      <p style="margin: 0 0 10px 0; font-size: 13px; color: #4b5563;">${intro}</p>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb;">
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderFailed(cases: ReportCase[]): string {
  const failed = cases.filter((c) => c.status === 'failed');
  if (!failed.length) return '';
  return caseTable(
    `Failed Tests (${failed.length})`,
    COLORS.fail,
    'Plain-English reason first; expand "Technical details" for the raw Playwright error.',
    failed.map((c) => failureRow(c, COLORS.fail, 'Why it failed', c.failureReason || c.actualResult)).join(''),
  );
}

function renderFlaky(cases: ReportCase[]): string {
  const flaky = cases.filter((c) => c.status === 'flaky');
  if (!flaky.length) return '';
  return caseTable(
    `Flaky Tests (${flaky.length})`,
    COLORS.flaky,
    'These tests failed at first and passed on retry. They count as passed, but the first failure is worth a look.',
    flaky
      .map((c) => failureRow(c, COLORS.flaky, `First failure (${c.attempts} attempts)`, c.failureReason || ''))
      .join(''),
  );
}

function renderKnownDefects(run: ReportRun): string {
  const defects = knownDefects(run.cases);
  if (!defects.length) return '';
  const rows = defects
    .map(
      (d) => `
        <tr style="border-bottom: 1px solid #e5e7eb; font-size: 12px; vertical-align: top;">
          <td style="padding: 8px 10px; font-family: Consolas, 'Courier New', monospace; color: ${COLORS.flaky}; font-weight: bold; white-space: nowrap;">${escapeHtml(d.tcId)}</td>
          <td style="padding: 8px 10px; color: #111827;">${escapeHtml(d.title)}</td>
          <td style="padding: 8px 10px; color: #374151;">${escapeHtml(d.description)}</td>
          <td style="padding: 8px 10px; white-space: nowrap;">${escapeHtml(d.status.toUpperCase())}</td>
        </tr>`,
    )
    .join('');
  return caseTable(
    `Known Application Defects (${defects.length})`,
    COLORS.flaky,
    'Tests annotated as covering a known, reported app defect.',
    rows,
  );
}

function renderSkipped(cases: ReportCase[]): string {
  const skipped = cases.filter((c) => c.status === 'skipped');
  if (!skipped.length) return '';
  const rows = skipped
    .slice(0, MAX_SKIPPED_ROWS)
    .map(
      (c) => `
        <tr style="border-bottom: 1px solid #f3f4f6; font-size: 12px; vertical-align: top;">
          <td style="padding: 6px 10px; font-family: Consolas, 'Courier New', monospace; color: ${COLORS.skip}; white-space: nowrap;">${escapeHtml(c.tcId)}</td>
          <td style="padding: 6px 10px; color: #111827;">${escapeHtml(c.description)}</td>
          <td style="padding: 6px 10px; color: #4b5563;">${escapeHtml(c.skipReason || '')}</td>
        </tr>`,
    )
    .join('');
  const more =
    skipped.length > MAX_SKIPPED_ROWS
      ? `<tr><td colspan="3" style="padding: 6px 10px; font-size: 12px; color: ${COLORS.muted};">… and ${skipped.length - MAX_SKIPPED_ROWS} more (see the HTML report).</td></tr>`
      : '';
  return caseTable(`Skipped Tests (${skipped.length})`, COLORS.skip, 'Tests that did not run, with the reason.', rows + more);
}

export function buildEmailHtml(run: ReportRun, opts: { pdfFileName?: string } = {}): { html: string; subject: string } {
  const totals = countStatuses(run.cases);
  const rate = passRate(totals);
  const runTime = formatDuration(run.durationMs || totals.durationMs);
  const { date, time, zone, dateShort } = formatRunTime(run.startTime);
  const targetUrl = process.env.BASE_URL || 'https://riverstream-qa.azurewebsites.net/';
  const { runUrl } = runLinks();
  const suiteStatus = totals.failed > 0 || run.globalErrors.length > 0 ? 'FAILED' : 'PASSED';

  const kpis = [
    kpiCell('Total', totals.total, 'Executed', '#0f172a', '#f8fafc', '#e2e8f0'),
    kpiCell('Passed', totals.passed, 'First attempt', COLORS.pass, '#f0fdf4', '#bbf7d0'),
    kpiCell('Failed', totals.failed, totals.failed ? 'Review' : 'None', totals.failed ? COLORS.fail : COLORS.muted, totals.failed ? '#fef2f2' : '#f8fafc', totals.failed ? '#fecaca' : '#e2e8f0'),
    kpiCell('Flaky', totals.flaky, 'Passed on retry', totals.flaky ? COLORS.flaky : COLORS.muted, totals.flaky ? '#faf5ff' : '#f8fafc', totals.flaky ? '#e9d5ff' : '#e2e8f0'),
    kpiCell('Skipped', totals.skipped, 'Not run', COLORS.skip, '#fffbeb', '#fde68a'),
    kpiCell('Pass Rate', `${rate}%`, runTime, rate >= 90 ? COLORS.pass : COLORS.fail, rate >= 90 ? '#f0fdf4' : '#fef2f2', rate >= 90 ? '#bbf7d0' : '#fecaca'),
  ].join('');

  const globalErrors = run.globalErrors.length
    ? `<div style="margin-bottom: 20px; padding: 10px 14px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; font-size: 12px; color: #991b1b;">
        <strong>Run-level errors:</strong><pre style="white-space: pre-wrap; margin: 6px 0 0 0;">${escapeHtml(run.globalErrors.join('\n\n').slice(0, 2000))}</pre></div>`
    : '';

  const pdfNotice = opts.pdfFileName
    ? `<div style="margin-bottom: 24px; padding: 10px 14px; background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; font-size: 12px; color: #1e40af;">
        📎 <strong>PDF report attached:</strong> <code>${escapeHtml(opts.pdfFileName)}</code>, with expected vs. actual results for every test.
      </div>`
    : '';

  const linkBlock = runUrl
    ? `<a href="${escapeHtml(runUrl)}" target="_blank" style="display: inline-block; background-color: #16a34a; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: bold; padding: 9px 18px; border-radius: 4px;">View run &amp; artifacts &rarr;</a>
        <p style="margin: 10px 0 0 0; font-size: 12px; color: #4b5563;">Download the <strong>playwright-execution-artifacts</strong> zip from the run page and open <code>playwright-report/index.html</code> for screenshots, videos and traces. Reports are not published publicly.</p>`
    : `<p style="margin: 0; font-size: 12px; color: #4b5563;">Local run: open <code>playwright-report/index.html</code> on the machine that ran the tests.</p>`;

  const row = (label: string, value: string) =>
    `<tr><td style="padding: 4px 0; width: 140px; font-weight: 600; color: #111827;">${label}</td><td style="padding: 4px 0; color: #374151;">${value}</td></tr>`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>River Stream Automation Suite Execution Summary</title>
</head>
<body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; color: #111827;">
  <div style="max-width: 900px; margin: 0 auto; background: #ffffff; padding: 28px 32px; border-radius: 8px; border: 1px solid #e5e7eb;">
    <p style="margin: 0 0 12px 0; font-size: 14px;">Hi Team,</p>
    <p style="margin: 0 0 20px 0; font-size: 14px; color: #374151; line-height: 1.5;">
      Here is the execution summary of the <strong>River Stream Automation Suite</strong> run started on <strong>${escapeHtml(date)}</strong> at <strong>${escapeHtml(`${time} ${zone}`)}</strong> against <strong>QA</strong>.
      Overall status: <strong style="color: ${suiteStatus === 'PASSED' ? COLORS.pass : COLORS.fail};">${suiteStatus}</strong>${totals.flaky ? ` <span style="color: ${COLORS.flaky};">(${totals.flaky} flaky)</span>` : ''}.
    </p>

    <table style="width: 100%; border-collapse: separate; border-spacing: 5px 0; table-layout: fixed; margin-bottom: 22px;"><tr>${kpis}</tr></table>

    ${globalErrors}
    ${pdfNotice}

    <div style="margin-bottom: 26px;">
      ${sectionTitle('Executive Summary')}
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        ${row('Target', `<a href="${escapeHtml(targetUrl)}" style="color: #2563eb;">${escapeHtml(targetUrl)}</a>`)}
        ${row('Environment', 'QA - Riverstone Org')}
        ${row('Status', `<strong style="color: ${suiteStatus === 'PASSED' ? COLORS.pass : COLORS.fail};">${suiteStatus}</strong>`)}
        ${row('Results', `${totals.total} total · <span style="color: ${COLORS.pass};">${totals.passed} passed</span> · <span style="color: ${COLORS.fail};">${totals.failed} failed</span> · <span style="color: ${COLORS.flaky};">${totals.flaky} flaky</span> · <span style="color: ${COLORS.skip};">${totals.skipped} skipped</span>`)}
        ${row('Pass Rate', `${rate}% (passed + flaky, of all tests)`)}
        ${row('Execution Time', runTime)}
        ${row('Modules', String(summariseModules(run.cases).length))}
      </table>
    </div>

    ${renderModuleTable(run, totals, rate, runTime)}
    ${renderFailed(run.cases)}
    ${renderKnownDefects(run)}
    ${renderFlaky(run.cases)}
    ${renderSkipped(run.cases)}

    <div style="margin-top: 32px; background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 14px 18px; border-radius: 6px;">
      <div style="font-size: 14px; font-weight: bold; color: #166534; margin-bottom: 8px;">Full report, screenshots &amp; traces</div>
      ${linkBlock}
    </div>

    <div style="margin-top: 28px; font-size: 13px; color: #4b5563; line-height: 1.5;">
      Thanks,<br><strong style="color: #111827;">RiverStream QA Test Team</strong>
    </div>
  </div>
</body>
</html>
`;

  // Subject format kept as agreed: "River Stream Automation Suite Test Run— DD-MMM-YYYY HH:MM:SS AM TZ"
  const subject = `River Stream Automation Suite Test Run— ${dateShort} ${time}`;
  return { html, subject };
}

const DEFAULT_RECIPIENTS = 'babukumar@riverstonetech.com,rajkamal@riverstonetech.com,divya.d@riverstonetech.com';

function resolveRecipients(cli?: string): string[] {
  const raw = cli ?? process.env.REPORT_RECIPIENTS ?? DEFAULT_RECIPIENTS;
  return raw
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && !e.startsWith('<'));
}

/** Makes sure playwright-report/index.html belongs to this run before turning it into the PDF. */
function ensureHtmlReportMatches(run: ReportRun): void {
  let current = false;
  if (fs.existsSync(DEFAULT_REPORT_PATH)) {
    const head = fs.readFileSync(DEFAULT_REPORT_PATH, 'utf-8').slice(0, 4000);
    current = head.includes(`name="rs-run-start" content="${escapeHtml(run.startTime)}"`);
  }
  if (!current) {
    console.log('[Info] playwright-report/index.html is missing or from another run; rebuilding it from summary.json.');
    renderElegantReport(run, DEFAULT_REPORT_PATH);
  }
}

async function buildPdf(run: ReportRun, fileName: string): Promise<string | undefined> {
  try {
    ensureHtmlReportMatches(run);
    await generatePdfReport(DEFAULT_REPORT_PATH, PDF_PATH);
    console.log(`[Info] PDF attachment ready: ${fileName}`);
    return PDF_PATH;
  } catch (err) {
    console.warn(`[Warning] PDF report could not be generated, sending without it: ${errorMessage(err)}`);
    return undefined;
  }
}

export async function generateAndSendReport(argv: string[] = process.argv.slice(2)): Promise<void> {
  const opts = parseArgs(argv);
  const run = loadRunFromSummary(opts.summaryPath);
  const totals = countStatuses(run.cases);
  console.log(
    `[Info] Results from run started ${run.startTime}: ${totals.total} tests, ${totals.passed} passed, ` +
      `${totals.failed} failed, ${totals.flaky} flaky, ${totals.skipped} skipped.`,
  );

  if (totals.total === 0) {
    throw new ReportEmailError(
      `Cannot send report email: 0 test cases found in ${opts.summaryPath}.\n` +
        `Make sure the test suite has executed (run 'npm run test:main:email' or 'npm run test:main') so results are recorded before sending the report.`,
    );
  }

  const { dateShort } = formatRunTime(run.startTime);
  const pdfFileName = `RiverStream_QA_Execution_Report_${dateShort}.pdf`;
  const pdfPath = opts.noPdf ? undefined : await buildPdf(run, pdfFileName);
  const { html, subject } = buildEmailHtml(run, { pdfFileName: pdfPath ? pdfFileName : undefined });

  const outDir = path.dirname(opts.summaryPath);
  fs.mkdirSync(outDir, { recursive: true });
  const localCopy = path.join(outDir, 'email-report.html');
  fs.writeFileSync(localCopy, html, 'utf-8');
  console.log(`[Info] Email HTML saved to ${localCopy} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);

  const recipients = resolveRecipients(opts.recipients);
  const { runUrl } = runLinks();

  if (opts.dryRun) {
    console.log('[Info] --dry-run: not sending.');
    console.log(`[Info] Subject:    ${subject}`);
    console.log(`[Info] Recipients: ${recipients.length ? recipients.join(', ') : '(none configured: set REPORT_RECIPIENTS)'}`);
    console.log(`[Info] Run link:   ${runUrl || '(none: REPORT_WEB_URL / GITHUB_RUN_ID not set)'}`);
    console.log(`[Info] Attachment: ${pdfPath ? `${pdfFileName} (${(fs.statSync(pdfPath).size / 1024).toFixed(1)} KB)` : '(none)'}`);
    return;
  }

  if (recipients.length === 0) {
    throw new ReportEmailError('No recipients: set REPORT_RECIPIENTS in .env / CI secrets or pass --recipients=a@x.com,b@y.com.');
  }
  const senderEmail = process.env.SENDER_EMAIL;
  const senderPassword = (process.env.SENDER_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!senderEmail || !senderPassword) {
    throw new ReportEmailError('SENDER_EMAIL and SENDER_APP_PASSWORD must be set to send the report email.');
  }

  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user: senderEmail, pass: senderPassword },
  });

  console.log(`[Info] Sending report to ${recipients.join(', ')}...`);
  try {
    const info = await transporter.sendMail({
      from: `"RiverStream QA Automation" <${senderEmail}>`,
      to: recipients,
      subject,
      html,
      attachments: pdfPath ? [{ filename: pdfFileName, path: pdfPath, contentType: 'application/pdf' }] : [],
    });
    console.log(`[Success] Email sent (message id ${info.messageId}).`);
  } catch (err) {
    throw new ReportEmailError(`Sending the report email failed: ${errorMessage(err)}`);
  }
}

if (require.main === module) {
  generateAndSendReport().catch((err) => {
    console.error(`[Error] ${errorMessage(err)}`);
    process.exit(1);
  });
}
