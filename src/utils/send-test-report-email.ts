import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface TestResult {
  status: string;
  duration: number;
  errors: Array<{ message?: string; stack?: string }>;
}

interface SpecItem {
  id: string;
  title: string;
  file: string;
  ok: boolean;
  tests: Array<{
    results: TestResult[];
    expectedStatus: string;
    status: string;
  }>;
}

interface ModuleSummary {
  name: string;
  file: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  durationMs: number;
}

interface FailedTestDetail {
  tcId: string;
  module: string;
  testTitle: string;
  steps: string;
  expectedResult: string;
  actualResult: string;
  failureReason: string;
}

// Load master test case catalog
const catalogPath = path.resolve(__dirname, '../test-data/test-catalog-metadata.json');
let testCatalog: Record<string, any> = {};
if (fs.existsSync(catalogPath)) {
  try {
    testCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  } catch (err) {
    // ignore
  }
}

// Helper to formulate clear, non-technical plain English explanation of failure
function getPlainEnglishFailure(tcId: string, rawError: string, expectedText: string): string {
  const lower = (rawError || '').toLowerCase();

  if (lower.includes('beforeall') && lower.includes('timeout')) {
    return 'Setup Timed Out: Inbound mail service / SMTP connection setup did not complete within the allotted timeout (45-90s limit).';
  }
  if (lower.includes('hook timeout') || lower.includes('beforeeach')) {
    return 'Setup Hook Timed Out: The test initialization hook took longer than expected and exceeded the timeout threshold.';
  }
  if (lower.includes('tobetruthy') && (lower.includes('visibleprojectnames') || lower.includes('searchproject') || tcId.includes('RECON'))) {
    return 'Project Not Found: The newly created project was not displayed or visible in the PO-ACK Reconciliation projects table after creation.';
  }
  if (lower.includes('tocontain') && (tcId.includes('RECON_020') || lower.includes('project'))) {
    return 'Sorting Verification Failed: The newly created project did not appear at the top of the project list table.';
  }
  if (lower.includes('tobetruthy') || lower.includes('received: false')) {
    return 'Assertion Failed: The expected UI component, project record, or confirmation state was not met (evaluated to false).';
  }
  if (lower.includes('tocontain')) {
    return 'Content Mismatch: The expected text, project name, or data was not found in the target UI element or table row.';
  }
  if (lower.includes('tobevisible') || lower.includes('waiting for locator')) {
    return 'Element Not Visible: The expected UI component, button, or modal dialog was not rendered on screen within the timeout.';
  }
  if (lower.includes('tobedisabled') || lower.includes('tobeenabled')) {
    return 'State Mismatch: Interactive control (button/input) was not in the expected enabled or disabled state.';
  }
  if (lower.includes('tohavetext') || lower.includes('tohavevalue')) {
    return 'Value Mismatch: The displayed field value or label did not match the expected value.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'Execution Timeout: The application or server took longer to respond than the configured waiting threshold.';
  }
  if (lower.includes('500') || lower.includes('internal server error')) {
    return 'Backend Server Error: The server returned an HTTP 500 error while processing the request.';
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized')) {
    return 'Authentication Error: Operation was blocked due to expired session or insufficient permissions.';
  }

  return 'Verification Failed: System outcome did not match acceptance criteria during execution.';
}

// Lookup catalog metadata with fuzzy matching and title fallback
function lookupCatalog(tcId: string, title: string): {
  description: string;
  steps: string;
  testData: string;
  expectedResult: string;
} {
  // 1. Direct match
  if (testCatalog[tcId]) {
    const entry = testCatalog[tcId];
    return {
      description: entry.description || title,
      steps: entry.steps || '',
      testData: entry.testData || '',
      expectedResult: entry.expectedResult || '',
    };
  }

  // 2. Normalized match (dashes, spaces, underscores)
  const normId = tcId.replace(/[- ]/g, '_').toUpperCase();
  for (const [k, v] of Object.entries(testCatalog)) {
    const kNorm = k.replace(/[- ]/g, '_').toUpperCase();
    if (kNorm === normId || kNorm.replace(/_/g, '') === normId.replace(/_/g, '')) {
      return {
        description: v.description || title,
        steps: v.steps || '',
        testData: v.testData || '',
        expectedResult: v.expectedResult || '',
      };
    }
  }

  // 3. Match by description/title text
  const cleanTitle = title.replace(/^TC[_-]?[A-Za-z0-9_ -]+?:\s*/i, '').trim().toLowerCase();
  for (const [k, v] of Object.entries(testCatalog)) {
    if (v.description && v.description.toLowerCase().trim() === cleanTitle) {
      return {
        description: v.description,
        steps: v.steps || '',
        testData: v.testData || '',
        expectedResult: v.expectedResult || '',
      };
    }
  }

  // 4. Fallback based on title
  const pureTitle = title.replace(/^TC[_-]?[A-Za-z0-9_ -]+?:\s*/i, '').trim();
  return {
    description: pureTitle,
    steps: `1. Authenticate to RiverStream application.\n2. Navigate to target module.\n3. Execute test verification actions for: ${pureTitle}.\n4. Verify application behavior.`,
    testData: 'Standard test environment data',
    expectedResult: `System should successfully complete and verify: ${pureTitle}.`,
  };
}

// Map spec file path to human-readable module name
function getModuleName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('auth')) return 'Authentication & Session';
  if (normalized.includes('left-side')) return 'Dashboard & Navigation';
  if (normalized.includes('upload')) return 'Document Upload & Processing';
  if (normalized.includes('documents')) return 'Documents Management';
  if (normalized.includes('po-ack-recon')) return 'PO-ACK Reconciliation';
  if (normalized.includes('review')) return 'Document Review & Verification';
  if (normalized.includes('settings')) return 'Settings & Tenant Configuration';
  if (normalized.includes('email')) return 'Email Order Ingestion & ERP Sync';
  
  // Fallback: extract base filename
  const base = path.basename(filePath, path.extname(filePath));
  return base.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Format duration in ms to "Xm Ys" or "Xs"
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

// Clean ANSI escape sequences from strings
function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

// Extract TC ID from title (e.g. "TC_001: ...", "TC_File Upload_001: ...")
function extractTcId(title: string): string {
  const match = title.match(/^(TC[_-]?[A-Za-z0-9_ -]+?)(?::|\s-)/i);
  if (match) {
    return match[1].trim();
  }
  // Try finding any TC_xxx anywhere in the title
  const secondary = title.match(/\b(TC[_-]?[A-Za-z0-9_]+)\b/i);
  if (secondary) {
    return secondary[1].trim();
  }
  return 'TC_FAIL';
}

// Recursively traverse Playwright test suites to gather specs
function collectSpecs(suite: any, specsList: SpecItem[] = []): SpecItem[] {
  if (!suite) return specsList;

  if (Array.isArray(suite.specs)) {
    for (const spec of suite.specs) {
      specsList.push({
        ...spec,
        file: spec.file || suite.file || '',
      });
    }
  }

  if (Array.isArray(suite.suites)) {
    for (const childSuite of suite.suites) {
      // Propagate file path if not present in child
      if (!childSuite.file && suite.file) {
        childSuite.file = suite.file;
      }
      collectSpecs(childSuite, specsList);
    }
  }

  return specsList;
}

export async function generateAndSendReport(): Promise<void> {
  const summaryJsonPath = path.resolve(process.cwd(), 'test-results/summary.json');

  if (!fs.existsSync(summaryJsonPath)) {
    console.error(`[Error] Summary report file not found at: ${summaryJsonPath}`);
    console.error('Make sure Playwright has run with the json reporter configured.');
    process.exit(1);
  }

  const rawData = fs.readFileSync(summaryJsonPath, 'utf-8');
  let reportData: any;
  try {
    reportData = JSON.parse(rawData);
  } catch (err: any) {
    console.error(`[Error] Failed to parse summary.json: ${err.message}`);
    process.exit(1);
  }

  // Collect all specs
  const allSpecs: SpecItem[] = [];
  if (Array.isArray(reportData.suites)) {
    for (const rootSuite of reportData.suites) {
      collectSpecs(rootSuite, allSpecs);
    }
  }

  // Group by module
  const moduleMap = new Map<string, { moduleName: string; file: string; specs: SpecItem[] }>();

  for (const spec of allSpecs) {
    const modName = getModuleName(spec.file);
    if (!moduleMap.has(modName)) {
      moduleMap.set(modName, { moduleName: modName, file: spec.file, specs: [] });
    }
    moduleMap.get(modName)!.specs.push(spec);
  }

  const moduleSummaries: ModuleSummary[] = [];
  const failedTests: FailedTestDetail[] = [];

  let overallTotal = 0;
  let overallPassed = 0;
  let overallFailed = 0;
  let overallSkipped = 0;
  let overallDurationMs = 0;

  for (const [modName, modData] of moduleMap.entries()) {
    let modPassed = 0;
    let modFailed = 0;
    let modSkipped = 0;
    let modDuration = 0;

    for (const spec of modData.specs) {
      const results = spec.tests?.[0]?.results || [];
      const latestResult = results[results.length - 1];

      let isPassed = false;
      let isSkipped = false;
      let isFailed = false;

      if (latestResult) {
        modDuration += latestResult.duration || 0;
        if (latestResult.status === 'passed') {
          isPassed = true;
        } else if (latestResult.status === 'skipped') {
          isSkipped = true;
        } else {
          isFailed = true;
        }
      } else {
        if (spec.ok) isPassed = true;
        else isFailed = true;
      }

      if (isPassed) {
        modPassed++;
      } else if (isSkipped) {
        modSkipped++;
      } else {
        modFailed++;

        // Collect failure details
        const errors = latestResult?.errors || [];
        let reason = 'Test failed without explicit error message';
        if (errors.length > 0) {
          const rawMessage = errors[0].message || errors[0].stack || '';
          reason = stripAnsi(rawMessage).trim();
          // Keep first 10 lines of error for email readability
          const lines = reason.split('\n');
          if (lines.length > 10) {
            reason = lines.slice(0, 10).join('\n') + '\n... (truncated)';
          }
        }

        const tcId = extractTcId(spec.title);
        const catEntry = lookupCatalog(tcId, spec.title);
        const actualResult = getPlainEnglishFailure(tcId, reason, catEntry.expectedResult);

        failedTests.push({
          tcId,
          module: modName,
          testTitle: catEntry.description || spec.title,
          steps: catEntry.steps,
          expectedResult: catEntry.expectedResult,
          actualResult,
          failureReason: reason,
        });
      }
    }

    const modTotal = modPassed + modFailed + modSkipped;
    const passRate = modTotal > 0 ? Math.round((modPassed / modTotal) * 100) : 0;

    moduleSummaries.push({
      name: modName,
      file: modData.file,
      total: modTotal,
      passed: modPassed,
      failed: modFailed,
      skipped: modSkipped,
      passRate,
      durationMs: modDuration,
    });

    overallTotal += modTotal;
    overallPassed += modPassed;
    overallFailed += modFailed;
    overallSkipped += modSkipped;
    overallDurationMs += modDuration;
  }

  // Use top-level duration from report stats if available
  const reportDurationMs = reportData.stats?.duration || overallDurationMs;
  const overallPassRate = overallTotal > 0 ? Math.round((overallPassed / overallTotal) * 100) : 0;

  // Determine suite status: Only PASSED or FAILED (no UNSTABLE as requested)
  const isAllPassed = overallFailed === 0;
  const suiteStatus = isAllPassed ? 'PASSED' : 'FAILED';
  const statusColor = isAllPassed ? '#2e7d32' : '#d32f2f';

  // Date and Time formatting
  const today = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(today.getDate()).padStart(2, '0');
  const month = months[today.getMonth()];
  const year = today.getFullYear();
  const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
  const dateFormatted = `${day}-${month}-${year}`; // e.g. 17-Oct-2026

  // 12-hour format with AM/PM (e.g. 11:03:10 PM IST)
  const timeFormatted = today.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: process.env.TIMEZONE || 'Asia/Kolkata',
  });

  const targetUrl = process.env.BASE_URL || 'https://riverstream-qa.azurewebsites.net/';
  const environment = 'QA - Riverstone Org';
  const executionTimeStr = formatDuration(reportDurationMs);
  const specFilesCount = `${moduleSummaries.length} modules`;

  // Build Module Rows HTML
  let moduleRowsHtml = '';
  for (const mod of moduleSummaries) {
    const passRateColor = mod.passRate >= 90 ? '#2e7d32' : mod.passRate >= 70 ? '#f59e0b' : '#d32f2f';
    const passedCell = mod.passed > 0 
      ? `<span style="color: #2e7d32; font-weight: 600;">● ${mod.passed}</span>` 
      : '0';
    const failedCell = mod.failed > 0 
      ? `<span style="color: #d32f2f; font-weight: bold;">● ${mod.failed}</span>` 
      : '0';
    const skippedCell = mod.skipped > 0 
      ? `<span style="color: #f59e0b; font-weight: 600;">● ${mod.skipped}</span>` 
      : '0';

    moduleRowsHtml += `
      <tr style="border-bottom: 1px solid #e5e7eb; font-size: 13px;">
        <td style="padding: 10px 14px; color: #1f2937; font-weight: 500;">${mod.name}</td>
        <td style="padding: 10px 14px; text-align: center; color: #374151;">${mod.total}</td>
        <td style="padding: 10px 14px; text-align: center;">${passedCell}</td>
        <td style="padding: 10px 14px; text-align: center;">${failedCell}</td>
        <td style="padding: 10px 14px; text-align: center;">${skippedCell}</td>
        <td style="padding: 10px 14px; text-align: center; color: ${passRateColor}; font-weight: 600;">${mod.passRate}%</td>
        <td style="padding: 10px 14px; text-align: center; color: #4b5563;">${formatDuration(mod.durationMs)}</td>
      </tr>
    `;
  }

  // Failed Tests Table HTML (Conditional)
  let failedTestsSectionHtml = '';
  if (failedTests.length > 0) {
    let failedRowsHtml = '';
    for (const ft of failedTests) {
      failedRowsHtml += `
        <tr style="border-bottom: 2px solid #fee2e2; font-size: 12px; vertical-align: top;">
          <td style="padding: 12px 10px; width: 14%;">
            <div style="color: #b91c1c; font-weight: bold; font-family: 'Consolas', 'Courier New', monospace; font-size: 13px;">${ft.tcId}</div>
            <div style="font-size: 11px; color: #4b5563; margin-top: 4px; font-weight: 600;">${ft.module}</div>
          </td>
          <td style="padding: 12px 10px; width: 28%;">
            <div style="font-weight: 700; color: #111827; margin-bottom: 6px; font-size: 13px;">${escapeHtml(ft.testTitle)}</div>
            <div style="font-size: 11px; color: #4b5563; background: #f9fafb; padding: 6px 8px; border-radius: 4px; border: 1px solid #e5e7eb; white-space: pre-wrap; line-height: 1.4;">
              <strong style="color: #1f2937;">Steps Executed:</strong><br>${escapeHtml(ft.steps)}
            </div>
          </td>
          <td style="padding: 12px 10px; width: 28%;">
            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px 12px; color: #166534; font-size: 12px; line-height: 1.45;">
              <strong style="color: #15803d; font-size: 12px; display: block; margin-bottom: 4px;">🟢 Expected Result:</strong>
              ${escapeHtml(ft.expectedResult)}
            </div>
          </td>
          <td style="padding: 12px 10px; width: 30%;">
            <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 10px 12px; color: #991b1b; font-size: 12px; line-height: 1.45;">
              <strong style="color: #b91c1c; font-size: 12px; display: block; margin-bottom: 4px;">🔴 Actual Result (Why it Failed):</strong>
              ${escapeHtml(ft.actualResult)}
            </div>
            <details style="margin-top: 8px; font-size: 11px;">
              <summary style="color: #b91c1c; cursor: pointer; font-weight: 600;">View Technical Diagnostics / Stack</summary>
              <pre style="margin: 6px 0 0 0; padding: 8px 10px; background-color: #1e293b; color: #fca5a5; border-radius: 4px; font-family: 'Consolas', 'Courier New', monospace; font-size: 11px; line-height: 1.4; white-space: pre-wrap; word-break: break-all;">${escapeHtml(ft.failureReason)}</pre>
            </details>
          </td>
        </tr>
      `;
    }

    failedTestsSectionHtml = `
      <div style="margin-top: 35px;">
        <h3 style="color: #b91c1c; font-size: 16px; margin: 0 0 8px 0; font-weight: bold;">
          Failed Tests Diagnostic Summary (${failedTests.length})
        </h3>
        <p style="margin: 0 0 12px 0; font-size: 13px; color: #4b5563;">
          Below is the plain English breakdown of expected vs. actual outcomes for all failed test cases:
        </p>
        <div style="height: 2px; background-color: #b91c1c; margin-bottom: 15px;"></div>
        
        <table style="width: 100%; border-collapse: collapse; background-color: #ffffff; border: 1px solid #fecaca; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <thead>
            <tr style="background-color: #b91c1c; color: #ffffff; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
              <th style="padding: 10px 12px; text-align: left; width: 14%;">TC ID / Module</th>
              <th style="padding: 10px 12px; text-align: left; width: 28%;">Test Steps Executed</th>
              <th style="padding: 10px 12px; text-align: left; width: 28%;">Expected Result</th>
              <th style="padding: 10px 12px; text-align: left; width: 30%;">Actual Result & Root Cause</th>
            </tr>
          </thead>
          <tbody>
            ${failedRowsHtml}
          </tbody>
        </table>
      </div>
    `;
  }

  // CI/CD Run and Report Web links
  const githubServerUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const githubRepo = process.env.GITHUB_REPOSITORY || 'babukumar-cell/RiverStream_Automation';
  const githubRunId = process.env.GITHUB_RUN_ID || '';
  const runUrl = githubRepo && githubRunId 
    ? `${githubServerUrl}/${githubRepo}/actions/runs/${githubRunId}` 
    : 'https://github.com/babukumar-cell/RiverStream_Automation/actions';

  const reportWebUrl = process.env.REPORT_WEB_URL || 
    (githubRepo ? `https://${githubRepo.split('/')[0]}.github.io/${githubRepo.split('/')[1]}/` : 'https://babukumar-cell.github.io/RiverStream_Automation/');

  // Compose Full Email HTML
  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>River Stream Automation Suite Execution Summary</title>
</head>
<body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; color: #111827;">

  <div style="max-width: 850px; margin: 0 auto; background: #ffffff; padding: 28px 32px; border-radius: 8px; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
    
    <!-- Greeting -->
    <p style="margin: 0 0 12px 0; font-size: 14px; color: #1f2937;">Hi Team,</p>
    <p style="margin: 0 0 24px 0; font-size: 14px; color: #374151; line-height: 1.5;">
      Please find the execution summary for the <strong>River Stream Automation Suite</strong> run on <strong>${dateStr}</strong> against <strong>QA</strong> environment.
    </p>

    <!-- Executive Summary Section -->
    <div style="margin-bottom: 30px;">
      <h3 style="color: #0b1b54; font-size: 16px; margin: 0 0 8px 0; font-weight: bold;">Executive Summary</h3>
      <div style="height: 2px; background-color: #0b1b54; margin-bottom: 16px;"></div>

      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr>
          <td style="padding: 5px 0; width: 140px; font-weight: 600; color: #111827;">Target</td>
          <td style="padding: 5px 0; color: #2563eb;">
            <a href="${targetUrl}" target="_blank" style="color: #2563eb; text-decoration: underline;">${targetUrl}</a>
          </td>
        </tr>
        <tr>
          <td style="padding: 5px 0; font-weight: 600; color: #111827;">Environment</td>
          <td style="padding: 5px 0; color: #374151;">${environment}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; font-weight: 600; color: #111827;">Total Tests</td>
          <td style="padding: 5px 0; color: #111827; font-weight: 600;">${overallTotal}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; font-weight: 600; color: #111827;">Passed</td>
          <td style="padding: 5px 0; color: #2e7d32; font-weight: bold;">
            ${overallPassed} <span style="display: inline-block; background-color: #2e7d32; color: #ffffff; border-radius: 3px; padding: 1px 4px; font-size: 11px;">&#10003;</span>
          </td>
        </tr>
        <tr>
          <td style="padding: 5px 0; font-weight: 600; color: #111827;">Failed</td>
          <td style="padding: 5px 0; color: ${overallFailed > 0 ? '#d32f2f' : '#6b7280'}; font-weight: bold;">
            ${overallFailed} ${overallFailed > 0 ? '<span style="display: inline-block; background-color: #d32f2f; color: #ffffff; border-radius: 3px; padding: 1px 4px; font-size: 11px;">&#10007;</span>' : ''}
          </td>
        </tr>
        <tr>
          <td style="padding: 5px 0; font-weight: 600; color: #111827;">Skipped</td>
          <td style="padding: 5px 0; color: #f59e0b; font-weight: 600;">${overallSkipped}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; font-weight: 600; color: #111827;">Pass Rate</td>
          <td style="padding: 5px 0; color: ${overallPassRate >= 90 ? '#2e7d32' : '#d32f2f'}; font-weight: bold; font-size: 14px;">${overallPassRate}%</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; font-weight: 600; color: #111827;">Execution Time</td>
          <td style="padding: 5px 0; color: #374151;">${executionTimeStr}</td>
        </tr>
        <tr>
          <td style="padding: 5px 0; font-weight: 600; color: #111827;">Spec Files</td>
          <td style="padding: 5px 0; color: #374151;">${specFilesCount}</td>
        </tr>
      </table>
    </div>

    <!-- Module-wise Results Section -->
    <div style="margin-bottom: 25px;">
      <h3 style="color: #0b1b54; font-size: 16px; margin: 0 0 8px 0; font-weight: bold;">Module-wise Results</h3>
      <div style="height: 2px; background-color: #0b1b54; margin-bottom: 16px;"></div>

      <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb;">
        <thead>
          <tr style="background-color: #0b1b54; color: #ffffff; font-size: 13px;">
            <th style="padding: 10px 14px; text-align: left;">Module</th>
            <th style="padding: 10px 14px; text-align: center;">Total</th>
            <th style="padding: 10px 14px; text-align: center;">Passed &#128994;</th>
            <th style="padding: 10px 14px; text-align: center;">Failed &#128308;</th>
            <th style="padding: 10px 14px; text-align: center;">Skipped &#128993;</th>
            <th style="padding: 10px 14px; text-align: center;">Pass Rate</th>
            <th style="padding: 10px 14px; text-align: center;">Duration</th>
          </tr>
        </thead>
        <tbody>
          ${moduleRowsHtml}
          <!-- Total Summary Row -->
          <tr style="background-color: #f3f4f6; border-top: 2px solid #0b1b54; font-size: 13px; font-weight: bold;">
            <td style="padding: 11px 14px; color: #111827;">TOTAL</td>
            <td style="padding: 11px 14px; text-align: center; color: #111827;">${overallTotal}</td>
            <td style="padding: 11px 14px; text-align: center; color: #2e7d32;">${overallPassed}</td>
            <td style="padding: 11px 14px; text-align: center; color: ${overallFailed > 0 ? '#d32f2f' : '#6b7280'};">${overallFailed}</td>
            <td style="padding: 11px 14px; text-align: center; color: #f59e0b;">${overallSkipped}</td>
            <td style="padding: 11px 14px; text-align: center; color: ${overallPassRate >= 90 ? '#2e7d32' : '#d32f2f'};">${overallPassRate}%</td>
            <td style="padding: 11px 14px; text-align: center; color: #374151;">${executionTimeStr}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Failed Tests Section (Rendered conditionally) -->
    ${failedTestsSectionHtml}

    <!-- Reports Section -->
    <div style="margin-top: 35px; padding-top: 15px;">
      <h3 style="color: #0b1b54; font-size: 15px; margin: 0 0 8px 0; font-weight: bold;">Interactive Reports & Screenshots</h3>
      <div style="height: 1px; background-color: #0b1b54; margin-bottom: 14px;"></div>

      <!-- Direct HTML Report Button -->
      <div style="margin-bottom: 18px; background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 14px 18px; border-radius: 6px;">
        <span style="font-size: 14px; font-weight: bold; color: #166534;">&#128202; Interactive Playwright HTML Report:</span><br>
        <p style="margin: 6px 0 10px 0; font-size: 13px; color: #15803d; line-height: 1.5;">
          Click the button below to view the interactive test dashboard in Chrome with step-by-step screenshots, locator highlights, and video recordings:
        </p>
        <a href="${reportWebUrl}" target="_blank" style="display: inline-block; background-color: #16a34a; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: bold; padding: 9px 18px; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
          Open Full HTML Report in Chrome &rarr;
        </a>
      </div>

      <p style="margin: 0 0 6px 0; font-size: 12px; color: #6b7280;">
        &#128193; CI/CD Pipeline Artifacts: <a href="${runUrl}" target="_blank" style="color: #2563eb; text-decoration: underline;">View GitHub Actions Execution Run</a>
      </p>
    </div>

    <!-- Sign-off -->
    <div style="margin-top: 30px; font-size: 13px; color: #4b5563; line-height: 1.5;">
      Thanks,<br>
      <strong style="color: #111827;">RiverStream QA Test Team</strong>
    </div>

  </div>

</body>
</html>
  `;

  // Always save a local copy of the HTML report
  const localReportDir = path.resolve(process.cwd(), 'test-results');
  if (!fs.existsSync(localReportDir)) {
    fs.mkdirSync(localReportDir, { recursive: true });
  }
  const localReportPath = path.join(localReportDir, 'email-report.html');
  fs.writeFileSync(localReportPath, emailHtml, 'utf-8');
  console.log(`[Info] Generated email report saved to: ${localReportPath}`);

  // Subject line: "River Stream Automation Suite Test Run— [DD-MMM-YYYY] [TIME]"
  const emailSubject = `River Stream Automation Suite Test Run\u2014 ${dateFormatted} ${timeFormatted}`;

  // Recipients
  let rawRecipients = process.env.REPORT_RECIPIENTS || process.env.SENDER_EMAIL || 'riverstreamautomation@gmail.com';
  const recipientsArg = process.argv.find((arg) => arg.startsWith('--recipients='));
  if (recipientsArg) {
    rawRecipients = recipientsArg.split('=')[1];
  }
  const recipients = rawRecipients.split(',').map((e) => e.trim()).filter((e) => e.length > 0);

  // Check dry-run
  if (process.argv.includes('--dry-run')) {
    console.log('[Info] --dry-run flag detected. Skipping actual email dispatch.');
    console.log(`[Info] Subject would be: "${emailSubject}"`);
    console.log(`[Info] Recipients: ${recipients.join(', ')}`);
    return;
  }

  // Setup Nodemailer transport
  const senderEmail = process.env.SENDER_EMAIL;
  const senderPassword = process.env.SENDER_APP_PASSWORD;

  if (!senderEmail || !senderPassword) {
    console.warn('[Warning] SENDER_EMAIL or SENDER_APP_PASSWORD is not configured in .env. Skipping email dispatch.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: parseInt(process.env.SMTP_PORT || '465', 10) === 465,
    auth: {
      user: senderEmail,
      pass: senderPassword,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  console.log(`[Info] Dispatching test execution report to: ${recipients.join(', ')}...`);

  try {
    const info = await transporter.sendMail({
      from: `"RiverStream QA Automation" <${senderEmail}>`,
      to: recipients,
      subject: emailSubject,
      html: emailHtml,
    });
    console.log(`[Success] Email successfully sent! Message ID: ${info.messageId}`);
  } catch (err: any) {
    console.error(`[Error] Failed to send email report: ${err.message}`);
    // Do not fail the CI job completely if email fails, but log the error
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Execute if run directly
if (require.main === module) {
  generateAndSendReport().catch((err) => {
    console.error('[Fatal Error]', err);
    process.exit(1);
  });
}
