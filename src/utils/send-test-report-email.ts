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

function runLinks(): { runUrl?: string; reportWebUrl: string } {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  const githubRepo = GITHUB_REPOSITORY || 'babukumar-cell/RiverStream_Automation';
  const repoOwner = githubRepo.split('/')[0] || 'babukumar-cell';
  const repoName = githubRepo.split('/')[1] || 'RiverStream_Automation';

  const defaultPagesUrl = `https://${repoOwner}.github.io/${repoName}/`;
  const reportWebUrl = process.env.REPORT_WEB_URL || defaultPagesUrl;
  const runUrl = GITHUB_REPOSITORY && GITHUB_RUN_ID
    ? `${GITHUB_SERVER_URL || 'https://github.com'}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
    : `https://github.com/${githubRepo}/actions`;

  return { runUrl, reportWebUrl };
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
            ${th('Module', 'left')}${th('Total')}${th('Passed')}${th('Failed')}${th('Pass Rate')}${th('Duration')}
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr style="background-color: #f3f4f6; border-top: 2px solid ${COLORS.navy}; font-size: 13px; font-weight: bold;">
            <td style="padding: 10px 12px;">TOTAL</td>
            <td style="padding: 10px 12px; text-align: center;">${totals.total}</td>
            <td style="padding: 10px 12px; text-align: center; color: ${COLORS.pass};">${totals.passed}</td>
            <td style="padding: 10px 12px; text-align: center; color: ${totals.failed ? COLORS.fail : COLORS.muted};">${totals.failed}</td>
            <td style="padding: 10px 12px; text-align: center; color: ${overallRate >= 90 ? COLORS.pass : COLORS.fail};">${overallRate}%</td>
            <td style="padding: 10px 12px; text-align: center;">${runTime}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

function failureRow(c: ReportCase, accent: string, label: string, reason: string): string {
  const locationInfo = c.file
    ? `<div style="margin-top: 5px; font-family: Consolas, 'Courier New', monospace; font-size: 11px; color: #64748b;">📍 ${escapeHtml(c.file)}:${c.line}</div>`
    : '';

  const cleanWhy = reason || c.actualResult || 'Action timed out or assertion failed.';

  const technical = c.error
    ? `<details style="margin-top: 8px; font-size: 11px;">
        <summary style="color: ${accent}; cursor: pointer; font-weight: 600;">Show Technical Trace</summary>
        <pre style="margin: 6px 0 0 0; padding: 8px 10px; background-color: #0f172a; color: #fca5a5; border-radius: 4px; font-family: Consolas, 'Courier New', monospace; font-size: 11px; line-height: 1.4; white-space: pre-wrap; word-break: break-all;">${escapeHtml(c.error.split('\n').slice(0, 10).join('\n'))}</pre>
      </details>`
    : '';

  return `
        <tr style="border-bottom: 1px solid #e5e7eb; font-size: 12px; vertical-align: top;">
          <td style="padding: 12px; width: 22%; background-color: #fafaf9;">
            <div style="color: ${accent}; font-weight: 800; font-family: Consolas, 'Courier New', monospace; font-size: 13px;">${escapeHtml(c.tcId)}</div>
            <div style="font-size: 11px; font-weight: 600; color: #4b5563; margin-top: 3px;">${escapeHtml(c.module.name)}</div>
            ${locationInfo}
          </td>
          <td style="padding: 12px; width: 38%;">
            <div style="font-weight: 700; color: #111827; margin-bottom: 6px;">${escapeHtml(c.description)}</div>
            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 4px; padding: 6px 10px; color: #166534; font-size: 11px; line-height: 1.4;">
              <strong>🟢 Expected:</strong> ${escapeHtml(c.expectedResult || 'Should execute successfully without errors or timeouts.')}
            </div>
          </td>
          <td style="padding: 12px; width: 40%;">
            <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; padding: 6px 10px; color: #991b1b; font-size: 12px; line-height: 1.4;">
              <strong>🔴 ${label}:</strong> ${escapeHtml(cleanWhy)}
            </div>
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

function renderFailed(cases: ReportCase[], reportWebUrl: string): string {
  const failed = cases.filter((c) => c.status === 'failed');
  if (!failed.length) return '';

  const maxToShow = 3;
  const displayedCases = failed.slice(0, maxToShow);
  const remainingCount = failed.length - maxToShow;

  const rows = displayedCases
    .map((c) => failureRow(c, COLORS.fail, 'Issue Encountered', c.failureReason || c.actualResult))
    .join('');

  const moreNotice =
    remainingCount > 0
      ? `
    <div style="margin-top: 14px; background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 14px 18px; text-align: center;">
      <p style="margin: 0 0 10px 0; font-size: 13px; color: #9f1239; font-weight: 700;">
        Showing top 3 of ${failed.length} failed tests. ${remainingCount} additional failure(s) omitted to keep email concise.
      </p>
      <div style="margin-top: 8px;">
        <a href="${escapeHtml(reportWebUrl)}" target="_blank" style="display: inline-block; background-color: #e11d48; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 700; padding: 9px 20px; border-radius: 6px; box-shadow: 0 2px 4px rgba(225,29,72,0.2);">
          🔍 View All ${failed.length} Failures in Interactive Report &rarr;
        </a>
      </div>
      <p style="margin: 8px 0 0 0; font-size: 11px; color: #64748b;">
        Detailed expected vs. actual outcomes for all ${failed.length} tests are also documented in the attached executive PDF.
      </p>
    </div>`
      : '';

  return `
    <div style="margin-top: 30px;">
      ${sectionTitle(`Failed Tests (${failed.length})`, COLORS.fail)}
      <p style="margin: 0 0 10px 0; font-size: 13px; color: #4b5563;">
        Plain-English failure analysis with expected vs. actual outcomes:
      </p>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb;">
        <tbody>${rows}</tbody>
      </table>
      ${moreNotice}
    </div>`;
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

export function buildEmailHtml(run: ReportRun, opts: { pdfFileName?: string; htmlFileName?: string } = {}): { html: string; subject: string } {
  const totals = countStatuses(run.cases);
  const rate = passRate(totals);
  const runTime = formatDuration(run.durationMs || totals.durationMs);
  const { date, time, zone, dateShort } = formatRunTime(run.startTime);
  const targetUrl = process.env.BASE_URL || 'https://riverstream-qa.azurewebsites.net/';
  const { runUrl, reportWebUrl } = runLinks();
  const suiteStatus = totals.failed > 0 || run.globalErrors.length > 0 ? 'FAILED' : 'PASSED';

  const kpis = [
    kpiCell('Total', totals.total, 'Executed', '#0f172a', '#f8fafc', '#e2e8f0'),
    kpiCell('Passed', totals.passed, 'Success', COLORS.pass, '#f0fdf4', '#bbf7d0'),
    kpiCell('Failed', totals.failed, totals.failed ? 'Review' : 'None', totals.failed ? COLORS.fail : COLORS.muted, totals.failed ? '#fef2f2' : '#f8fafc', totals.failed ? '#fecaca' : '#e2e8f0'),
    kpiCell('Pass Rate', `${rate}%`, runTime, rate >= 90 ? COLORS.pass : COLORS.fail, rate >= 90 ? '#f0fdf4' : '#fef2f2', rate >= 90 ? '#bbf7d0' : '#fecaca'),
  ].join('');

  const globalErrors = run.globalErrors.length
    ? `<div style="margin-bottom: 20px; padding: 10px 14px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; font-size: 12px; color: #991b1b;">
        <strong>Run-level errors:</strong><pre style="white-space: pre-wrap; margin: 6px 0 0 0;">${escapeHtml(run.globalErrors.join('\n\n').slice(0, 2000))}</pre></div>`
    : '';

  const attachmentsNotice = (opts.pdfFileName || opts.htmlFileName)
    ? `<div style="margin-bottom: 24px; padding: 12px 16px; background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; font-size: 12px; color: #1e40af; line-height: 1.5;">
        📎 <strong>Attachments Included with this Email:</strong>
        <ul style="margin: 4px 0 0 0; padding-left: 20px;">
          ${opts.pdfFileName ? `<li><strong>Executive PDF Report:</strong> <code>${escapeHtml(opts.pdfFileName)}</code> (printable summary with expected vs actual results)</li>` : ''}
          ${opts.htmlFileName ? `<li><strong>Interactive HTML Report:</strong> <code>${escapeHtml(opts.htmlFileName)}</code> (save or double-click to view cards &amp; filters offline)</li>` : ''}
        </ul>
      </div>`
    : '';

  const row = (label: string, value: string) =>
    `<tr><td style="padding: 4px 0; width: 140px; font-weight: 600; color: #111827;">${label}</td><td style="padding: 4px 0; color: #374151;">${value}</td></tr>`;

  const suiteTitle = process.env.SUITE_NAME || 'River Stream Automation Suite';

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(suiteTitle)} Execution Summary</title>
</head>
<body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; color: #111827;">
  <div style="max-width: 900px; margin: 0 auto; background: #ffffff; padding: 28px 32px; border-radius: 8px; border: 1px solid #e5e7eb;">
    <p style="margin: 0 0 12px 0; font-size: 14px;">Hi Team,</p>
    <p style="margin: 0 0 20px 0; font-size: 14px; color: #374151; line-height: 1.5;">
      Here is the execution summary of the <strong>${escapeHtml(suiteTitle)}</strong> run started on <strong>${escapeHtml(date)}</strong> at <strong>${escapeHtml(`${time} ${zone}`)}</strong> against <strong>QA</strong>.
      Overall status: <strong style="color: ${suiteStatus === 'PASSED' ? COLORS.pass : COLORS.fail};">${suiteStatus}</strong>.
    </p>

    <table style="width: 100%; border-collapse: separate; border-spacing: 5px 0; table-layout: fixed; margin-bottom: 22px;"><tr>${kpis}</tr></table>

    <!-- Direct HTML Playwright Interactive Report Button -->
    <div style="margin: 22px 0 24px 0; background-color: #f0fdf4; border: 1.5px solid #86efac; padding: 18px 22px; border-radius: 8px; text-align: center;">
      <div style="font-size: 15px; font-weight: 800; color: #166534; margin-bottom: 6px;">
        📊 Colorful Interactive Test Dashboard
      </div>
      <p style="margin: 0 0 14px 0; font-size: 13px; color: #15803d; line-height: 1.5;">
        Open the live test report in your browser to inspect test cards, filter results, and view step-by-step screenshots &amp; recordings:
      </p>
      <a href="${escapeHtml(reportWebUrl)}" target="_blank" style="display: inline-block; background-color: #16a34a; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; padding: 11px 26px; border-radius: 6px; box-shadow: 0 2px 6px rgba(22,163,74,0.3);">
        🚀 Open Full HTML Report in Chrome &rarr;
      </a>
      <div style="margin-top: 10px; font-size: 11px; color: #475569;">
        Live Report URL: <a href="${escapeHtml(reportWebUrl)}" target="_blank" style="color: #2563eb; text-decoration: underline;">${escapeHtml(reportWebUrl)}</a>
      </div>
    </div>

    ${globalErrors}
    ${attachmentsNotice}

    <div style="margin-bottom: 26px;">
      ${sectionTitle('Executive Summary')}
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        ${row('Target', `<a href="${escapeHtml(targetUrl)}" style="color: #2563eb;">${escapeHtml(targetUrl)}</a>`)}
        ${row('Environment', 'QA - Riverstone Org')}
        ${row('Status', `<strong style="color: ${suiteStatus === 'PASSED' ? COLORS.pass : COLORS.fail};">${suiteStatus}</strong>`)}
        ${row('Results', `${totals.total} total · <span style="color: ${COLORS.pass};">${totals.passed} passed</span> · <span style="color: ${totals.failed ? COLORS.fail : COLORS.muted};">${totals.failed} failed</span>`)}
        ${row('Pass Rate', `${rate}%`)}
        ${row('Execution Time', runTime)}
        ${row('Modules', String(summariseModules(run.cases).length))}
      </table>
    </div>

    ${renderModuleTable(run, totals, rate, runTime)}
    ${renderFailed(run.cases, reportWebUrl)}

    <div style="margin-top: 32px; background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px 20px; border-radius: 6px;">
      <div style="font-size: 14px; font-weight: bold; color: #0f172a; margin-bottom: 6px;">Interactive Report &amp; Pipeline Artifacts</div>
      <div style="margin-bottom: 10px;">
        <a href="${escapeHtml(reportWebUrl)}" target="_blank" style="display: inline-block; background-color: #16a34a; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 700; padding: 8px 18px; border-radius: 4px;">Open Live HTML Report &rarr;</a>
      </div>
      ${runUrl ? `<p style="margin: 0; font-size: 12px; color: #64748b;">CI/CD Run Details: <a href="${escapeHtml(runUrl)}" target="_blank" style="color: #2563eb; text-decoration: underline;">Open GitHub Actions Execution #${escapeHtml(process.env.GITHUB_RUN_ID || '')}</a></p>` : '<p style="margin: 0; font-size: 12px; color: #64748b;">Local run: double-click the attached HTML report to inspect test cards, filters, and screenshots offline.</p>'}
    </div>

    <div style="margin-top: 28px; font-size: 13px; color: #4b5563; line-height: 1.5;">
      Thanks,<br><strong style="color: #111827;">RiverStream QA Test Team</strong>
    </div>
  </div>
</body>
</html>
`;

  // Subject format kept as agreed: "<Suite Name> Test Run— DD-MMM-YYYY HH:MM:SS AM TZ"
  const subject = `${suiteTitle} Test Run— ${dateShort} ${time}`;
  return { html, subject };
}

const DEFAULT_RECIPIENTS = 'babukumar@riverstonetech.com';

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

async function buildPdf(run: ReportRun, targetPdfPath: string, fileName: string): Promise<string | undefined> {
  try {
    ensureHtmlReportMatches(run);
    await generatePdfReport(DEFAULT_REPORT_PATH, targetPdfPath);
    console.log(`[Info] PDF attachment ready: ${fileName}`);
    return targetPdfPath;
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
  const suiteTitle = process.env.SUITE_NAME || 'River Stream Automation Suite';
  const suiteTag = suiteTitle.replace(/[^a-zA-Z0-9]/g, '_');
  const pdfFileName = `${suiteTag}_${dateShort}.pdf`;
  const htmlFileName = `${suiteTag}_${dateShort}.html`;
  const targetPdfPath = path.resolve(process.cwd(), `test-results/${pdfFileName}`);
  const pdfPath = opts.noPdf ? undefined : await buildPdf(run, targetPdfPath, pdfFileName);
  const htmlAttachmentPath = DEFAULT_REPORT_PATH;
  const hasHtml = fs.existsSync(htmlAttachmentPath);

  const { html, subject } = buildEmailHtml(run, {
    pdfFileName: pdfPath ? pdfFileName : undefined,
    htmlFileName: hasHtml ? htmlFileName : undefined,
  });

  const outDir = path.dirname(opts.summaryPath);
  fs.mkdirSync(outDir, { recursive: true });
  const localCopy = path.join(outDir, 'email-report.html');
  fs.writeFileSync(localCopy, html, 'utf-8');
  console.log(`[Info] Email HTML saved to ${localCopy} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);

  const recipients = resolveRecipients(opts.recipients);
  const { runUrl, reportWebUrl } = runLinks();

  if (opts.dryRun) {
    console.log('[Info] --dry-run: not sending.');
    console.log(`[Info] Subject:    ${subject}`);
    console.log(`[Info] Recipients: ${recipients.length ? recipients.join(', ') : '(none configured: set REPORT_RECIPIENTS)'}`);
    console.log(`[Info] Report Web: ${reportWebUrl}`);
    console.log(`[Info] Run link:   ${runUrl || '(none)'}`);
    const attachList = [];
    if (pdfPath) attachList.push(`${pdfFileName} (${(fs.statSync(pdfPath).size / 1024).toFixed(1)} KB)`);
    if (hasHtml) attachList.push(`${htmlFileName} (${(fs.statSync(htmlAttachmentPath).size / 1024).toFixed(1)} KB)`);
    console.log(`[Info] Attachments: ${attachList.length ? attachList.join(', ') : '(none)'}`);
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

  const attachments = [];
  if (pdfPath) {
    attachments.push({ filename: pdfFileName, path: pdfPath, contentType: 'application/pdf' });
  }
  if (hasHtml) {
    attachments.push({ filename: htmlFileName, path: htmlAttachmentPath, contentType: 'text/html' });
  }

  console.log(`[Info] Sending report to ${recipients.join(', ')}...`);
  try {
    const info = await transporter.sendMail({
      from: `"RiverStream QA Automation" <${senderEmail}>`,
      to: recipients,
      subject,
      html,
      attachments,
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
