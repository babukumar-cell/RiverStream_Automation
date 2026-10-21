import fs from 'fs';
import path from 'path';

/**
 * Interface definitions for Playwright JSON Report
 */
interface PlaywrightResult {
  workerIndex: number;
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  duration: number;
  errors: Array<{ message?: string; stack?: string }>;
  stdout: any[];
  stderr: any[];
  retry: number;
  startTime: string;
  attachments?: Array<{ name: string; contentType: string; path?: string; body?: string }>;
  steps?: Array<{
    title: string;
    duration: number;
    error?: { message?: string };
    steps?: any[];
  }>;
}

interface PlaywrightSpec {
  id: string;
  title: string;
  file: string;
  line: number;
  column: number;
  ok: boolean;
  tags: string[];
  tests: Array<{
    timeout: number;
    expectedStatus: string;
    status: string;
    results: PlaywrightResult[];
  }>;
}

interface MediaItem {
  name: string;
  type: 'image' | 'video';
  src: string;
}

interface ProcessedTestCase {
  id: string;
  tcId: string;
  title: string;
  moduleKey: string;
  moduleName: string;
  file: string;
  line: number;
  status: 'passed' | 'failed' | 'skipped' | 'flaky';
  durationMs: number;
  error?: string;
  errorStack?: string;
  description: string;
  plainSteps: string;
  testData: string;
  expectedResult: string;
  actualResult: string;
  steps: Array<{ title: string; durationMs: number; ok: boolean }>;
  media: MediaItem[];
}

interface ModuleInfo {
  key: string;
  name: string;
  shortName: string;
  icon: string;
  order: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  durationMs: number;
}

// Escape HTML special characters for attributes and text
function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Load master test case catalog
const catalogPath = path.resolve(__dirname, '../test-data/test-catalog-metadata.json');
let testCatalog: Record<string, any> = {};
if (fs.existsSync(catalogPath)) {
  try {
    testCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
    console.log(`[ElegantReport] Loaded ${Object.keys(testCatalog).length} test cases from catalog metadata.`);
  } catch (err: any) {
    console.warn('[ElegantReport] Could not load test catalog metadata:', err.message);
  }
}

// Format test steps cleanly into HTML list
function formatPlainStepsHtml(rawSteps: string): string {
  if (!rawSteps || !rawSteps.trim()) {
    return '<p class="plain-step-fallback">1. Execute test workflow and verify application response.</p>';
  }
  const lines = rawSteps
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  let html = '<ol class="plain-steps-list">';
  for (const line of lines) {
    const cleanText = line.replace(/^(?:\d+[\.\)]|\-|\*|•)\s*/, '').trim();
    if (cleanText) {
      html += `<li><span class="step-text">${escapeHtml(cleanText)}</span></li>`;
    }
  }
  html += '</ol>';
  return html;
}

// Categorize raw technical error into clear, non-technical plain English
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

// Formulate plain English actual result
function formulateActualResult(
  status: 'passed' | 'failed' | 'skipped' | 'flaky',
  tcId: string,
  errorReason: string | undefined,
  expectedResult: string
): string {
  if (status === 'passed') {
    return 'All verification checkpoints passed successfully. The application interface and backend state behaved exactly as expected.';
  }
  if (status === 'flaky') {
    return 'Passed on retry: The test encountered an initial transient delay, but succeeded on retry.';
  }
  if (status === 'skipped') {
    return 'Test execution skipped: Preconditions or target document types were not enabled for this test iteration.';
  }
  return getPlainEnglishFailure(tcId, errorReason || '', expectedResult);
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

  // 4. Intelligent fallback based on title
  const pureTitle = title.replace(/^TC[_-]?[A-Za-z0-9_ -]+?:\s*/i, '').trim();
  return {
    description: pureTitle,
    steps: `1. Authenticate to RiverStream application with valid credentials.\n2. Navigate to target module/screen.\n3. Execute test verification actions for: ${pureTitle}.\n4. Verify application behavior and state.`,
    testData: 'Standard RiverStream environment configuration and user credentials',
    expectedResult: `System should successfully verify and complete: ${pureTitle}, without throwing errors.`,
  };
}

// Module mapping helper
function resolveModuleInfo(filePath: string, title: string): { key: string; name: string; shortName: string; icon: string; order: number } {
  const norm = (filePath + ' ' + title).replace(/\\/g, '/').toLowerCase();
  
  if (norm.includes('auth') || norm.includes('sign-in') || norm.includes('login')) {
    return { key: 'mod_01', name: 'Module 01: Authentication & Session', shortName: 'Authentication', icon: '🔐', order: 1 };
  }
  if (norm.includes('left-side') || norm.includes('navigation') || norm.includes('dashboard')) {
    return { key: 'mod_02', name: 'Module 02: Dashboard & Navigation', shortName: 'Navigation', icon: '🧭', order: 2 };
  }
  if (norm.includes('upload') || norm.includes('dropzone') || norm.includes('sif')) {
    return { key: 'mod_03', name: 'Module 03: Document Upload & Processing', shortName: 'Upload & SIF', icon: '📤', order: 3 };
  }
  if (norm.includes('documents') && !norm.includes('po-ack')) {
    return { key: 'mod_04', name: 'Module 04: Documents Management', shortName: 'Documents', icon: '📑', order: 4 };
  }
  if (norm.includes('po-ack-recon') || norm.includes('recon')) {
    return { key: 'mod_05', name: 'Module 05: PO-ACK Reconciliation', shortName: 'PO-ACK Recon', icon: '⚖️', order: 5 };
  }
  if (norm.includes('review')) {
    return { key: 'mod_06', name: 'Module 06: Document Review & Verification', shortName: 'Doc Review', icon: '🔍', order: 6 };
  }
  if (norm.includes('settings') || norm.includes('organization') || norm.includes('tenant')) {
    return { key: 'mod_07', name: 'Module 07: Settings & Tenant Configuration', shortName: 'Settings', icon: '⚙️', order: 7 };
  }
  if (norm.includes('email') || norm.includes('riverstone-email')) {
    return { key: 'mod_08', name: 'Module 08: Riverstone Email Order Ingestion', shortName: 'Email Flow', icon: '✉️', order: 8 };
  }

  return { key: 'mod_00', name: 'General Test Suite', shortName: 'General', icon: '📁', order: 99 };
}

// Extract standard Test Case ID from title
function extractTcId(title: string): string {
  const match = title.match(/^(TC[_-]?[A-Za-z0-9_ -]+?)(?::|\s-)/i);
  if (match) return match[1].trim();
  const secondary = title.match(/\b(TC[_-]?[A-Za-z0-9_]+)\b/i);
  if (secondary) return secondary[1].trim();
  return 'TC_CASE';
}

// Format duration in ms
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = (ms / 1000).toFixed(1);
  if (parseFloat(sec) < 60) return `${sec}s`;
  const mins = Math.floor(parseFloat(sec) / 60);
  const remSec = Math.round(parseFloat(sec) % 60);
  return `${mins}m ${remSec}s`;
}

// Recursively traverse Playwright suites
function collectPlaywrightSpecs(suite: any, list: PlaywrightSpec[] = []): PlaywrightSpec[] {
  if (!suite) return list;
  if (Array.isArray(suite.specs)) {
    for (const spec of suite.specs) {
      list.push({
        ...spec,
        file: spec.file || suite.file || '',
      });
    }
  }
  if (Array.isArray(suite.suites)) {
    for (const sub of suite.suites) {
      collectPlaywrightSpecs(sub, list);
    }
  }
  return list;
}

// Inlines local file as Base64 data URL
function readFileAsBase64(filePath: string, mimeType: string): string {
  try {
    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    }
  } catch (err) {
    // ignore
  }
  return '';
}

/**
 * Main report generator
 */
export function generateElegantReport(
  summaryJsonPath: string = path.resolve(process.cwd(), 'test-results/summary.json'),
  outputHtmlPath: string = path.resolve(process.cwd(), 'playwright-report/index.html')
): void {
  console.log('[ElegantReport] Initiating Dark & Colorful Report Generation...');

  let rawSpecs: PlaywrightSpec[] = [];

  if (fs.existsSync(summaryJsonPath)) {
    try {
      const jsonContent = fs.readFileSync(summaryJsonPath, 'utf-8');
      const parsed = JSON.parse(jsonContent);
      rawSpecs = collectPlaywrightSpecs(parsed);
      console.log(`[ElegantReport] Found ${rawSpecs.length} specs in ${summaryJsonPath}`);
    } catch (e: any) {
      console.warn(`[ElegantReport] Could not parse ${summaryJsonPath}:`, e.message);
    }
  }

  // Ensure media directory in report output
  const outputDir = path.dirname(outputHtmlPath);
  const mediaDir = path.join(outputDir, 'media');
  if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
  }

  const processedCases: ProcessedTestCase[] = [];
  const moduleMap: Map<string, ModuleInfo> = new Map();

  for (let idx = 0; idx < rawSpecs.length; idx++) {
    const spec = rawSpecs[idx];
    const modInfo = resolveModuleInfo(spec.file, spec.title);
    if (!moduleMap.has(modInfo.key)) {
      moduleMap.set(modInfo.key, {
        key: modInfo.key,
        name: modInfo.name,
        shortName: modInfo.shortName,
        icon: modInfo.icon,
        order: modInfo.order,
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        flaky: 0,
        durationMs: 0,
      });
    }
    const currentMod = moduleMap.get(modInfo.key)!;

    const testItem = spec.tests?.[0];
    const results = testItem?.results || [];
    const latestResult = results[results.length - 1];

    let status: 'passed' | 'failed' | 'skipped' | 'flaky' = 'passed';
    if (!latestResult || latestResult.status === 'skipped') {
      status = 'skipped';
    } else if (latestResult.status === 'passed') {
      status = results.length > 1 ? 'flaky' : 'passed';
    } else {
      status = 'failed';
    }

    const durationMs = latestResult?.duration || 0;
    currentMod.total++;
    currentMod.durationMs += durationMs;
    if (status === 'passed') currentMod.passed++;
    else if (status === 'failed') currentMod.failed++;
    else if (status === 'skipped') currentMod.skipped++;
    else if (status === 'flaky') currentMod.flaky++;

    let errorReason: string | undefined;
    let errorStack: string | undefined;
    if (latestResult?.errors && latestResult.errors.length > 0) {
      const err = latestResult.errors[0];
      errorReason = (err.message || '').replace(/\u001b\[[0-9;]*m/g, '').trim();
      errorStack = (err.stack || err.message || '').replace(/\u001b\[[0-9;]*m/g, '').trim();
    }

    // Media (Screenshots & Videos)
    const media: MediaItem[] = [];
    if (latestResult?.attachments) {
      for (const att of latestResult.attachments) {
        if (!att.path || !fs.existsSync(att.path)) continue;

        const isImage = (att.contentType && att.contentType.startsWith('image/')) || att.path.endsWith('.png') || att.path.endsWith('.jpg');
        const isVideo = (att.contentType && att.contentType.startsWith('video/')) || att.path.endsWith('.webm') || att.path.endsWith('.mp4');

        if (isImage) {
          const b64 = readFileAsBase64(att.path, att.contentType || 'image/png');
          if (b64) {
            media.push({
              name: att.name || 'Screenshot',
              type: 'image',
              src: b64,
            });
          }
        } else if (isVideo) {
          // Copy video to report media folder for seamless browser playback
          const videoName = `vid_${idx}_${path.basename(att.path)}`;
          const destPath = path.join(mediaDir, videoName);
          try {
            fs.copyFileSync(att.path, destPath);
            media.push({
              name: att.name || 'Video Recording',
              type: 'video',
              src: `media/${videoName}`,
            });
          } catch (e) {
            // ignore
          }
        }
      }
    }

    // Extracted steps or mock sequential steps
    const steps: Array<{ title: string; durationMs: number; ok: boolean }> = [];
    if (latestResult?.steps && latestResult.steps.length > 0) {
      for (const st of latestResult.steps) {
        steps.push({
          title: st.title,
          durationMs: st.duration || 0,
          ok: !st.error,
        });
      }
    } else {
      steps.push({ title: 'Before Hooks & Browser Setup', durationMs: Math.min(200, durationMs), ok: true });
      steps.push({ title: `Execute: ${spec.title}`, durationMs: Math.max(0, durationMs - 250), ok: status === 'passed' });
      steps.push({ title: 'After Hooks & Teardown', durationMs: 50, ok: true });
    }

    const extractedTcId = extractTcId(spec.title);
    const catData = lookupCatalog(extractedTcId, spec.title);
    const actualResult = formulateActualResult(status, extractedTcId, errorReason, catData.expectedResult);

    processedCases.push({
      id: `case_${idx}`,
      tcId: extractedTcId,
      title: spec.title,
      moduleKey: modInfo.key,
      moduleName: modInfo.name,
      file: spec.file,
      line: spec.line || 1,
      status,
      durationMs,
      error: errorReason,
      errorStack,
      description: catData.description,
      plainSteps: catData.steps,
      testData: catData.testData,
      expectedResult: catData.expectedResult,
      actualResult,
      steps,
      media,
    });
  }

  // Ensure all 8 canonical modules exist in navigation
  const canonicalModules = [
    { key: 'mod_01', name: 'Module 01: Authentication & Session', shortName: 'Authentication', icon: '🔐', order: 1 },
    { key: 'mod_02', name: 'Module 02: Dashboard & Navigation', shortName: 'Navigation', icon: '🧭', order: 2 },
    { key: 'mod_03', name: 'Module 03: Document Upload & Processing', shortName: 'Upload & SIF', icon: '📤', order: 3 },
    { key: 'mod_04', name: 'Module 04: Documents Management', shortName: 'Documents', icon: '📑', order: 4 },
    { key: 'mod_05', name: 'Module 05: PO-ACK Reconciliation', shortName: 'PO-ACK Recon', icon: '⚖️', order: 5 },
    { key: 'mod_06', name: 'Module 06: Document Review & Verification', shortName: 'Doc Review', icon: '🔍', order: 6 },
    { key: 'mod_07', name: 'Module 07: Settings & Tenant Configuration', shortName: 'Settings', icon: '⚙️', order: 7 },
    { key: 'mod_08', name: 'Module 08: Riverstone Email Order Ingestion', shortName: 'Email Flow', icon: '✉️', order: 8 },
  ];

  for (const cm of canonicalModules) {
    if (!moduleMap.has(cm.key)) {
      moduleMap.set(cm.key, {
        ...cm,
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        flaky: 0,
        durationMs: 0,
      });
    }
  }

  const sortedModules = Array.from(moduleMap.values()).sort((a, b) => a.order - b.order);

  const totalTests = processedCases.length;
  const passedTests = processedCases.filter(c => c.status === 'passed').length;
  const failedTests = processedCases.filter(c => c.status === 'failed').length;
  const skippedTests = processedCases.filter(c => c.status === 'skipped').length;
  const totalDurationMs = processedCases.reduce((acc, c) => acc + c.durationMs, 0);
  const passRate = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 100;

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  const htmlReport = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RiverStream QA Automation — Executive Test Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-base: #07090e;
      --bg-sidebar: #0b0f19;
      --bg-surface: #111827;
      --bg-card: rgba(17, 24, 39, 0.85);
      --bg-elevated: #1e293b;
      --border-subtle: rgba(255, 255, 255, 0.08);
      --border-active: rgba(99, 102, 241, 0.4);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      
      /* Vibrant Status Colors */
      --color-pass: #10b981;
      --color-pass-glow: rgba(16, 185, 129, 0.25);
      --color-fail: #ef4444;
      --color-fail-glow: rgba(239, 68, 68, 0.3);
      --color-skip: #f59e0b;
      --color-skip-glow: rgba(245, 158, 11, 0.25);
      --color-brand: #6366f1;
      --color-cyan: #06b6d4;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      background-color: var(--bg-base);
      color: var(--text-main);
      display: flex;
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: var(--bg-base); }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #475569; }

    /* Left Sidebar */
    aside.sidebar {
      width: 300px;
      background: var(--bg-sidebar);
      border-right: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      position: fixed;
      top: 0;
      bottom: 0;
      left: 0;
      z-index: 50;
      user-select: none;
    }

    .brand-header {
      padding: 24px 20px 18px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-logo {
      width: 38px;
      height: 38px;
      background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);
    }
    .brand-text h1 {
      font-size: 15px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .brand-text p {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
    }
    .live-pulse {
      display: inline-block;
      width: 7px;
      height: 7px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 8px #10b981;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
      70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }

    .sidebar-search {
      padding: 16px 20px 12px;
    }
    .search-input-wrapper {
      position: relative;
    }
    .search-input-wrapper input {
      width: 100%;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 9px 12px 9px 34px;
      color: #fff;
      font-size: 13px;
      outline: none;
      transition: all 0.2s ease;
    }
    .search-input-wrapper input:focus {
      border-color: var(--color-brand);
      background: rgba(255, 255, 255, 0.07);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
    }
    .search-icon {
      position: absolute;
      left: 11px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-dim);
      font-size: 14px;
    }

    .sidebar-menu {
      flex: 1;
      overflow-y: auto;
      padding: 10px 14px;
    }
    .menu-category {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-dim);
      padding: 12px 10px 6px;
    }

    .nav-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      margin-bottom: 4px;
      border-radius: 8px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.18s ease;
      border: 1px solid transparent;
    }
    .nav-item:hover {
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
    }
    .nav-item.active {
      background: linear-gradient(90deg, rgba(99, 102, 241, 0.2) 0%, rgba(6, 182, 212, 0.1) 100%);
      color: #fff;
      border-color: rgba(99, 102, 241, 0.4);
      box-shadow: inset 3px 0 0 #6366f1;
    }
    .nav-item-left {
      display: flex;
      align-items: center;
      gap: 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .nav-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.06);
    }
    .nav-badge.fail {
      background: rgba(239, 68, 68, 0.2);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.35);
    }
    .nav-badge.pass {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .sidebar-footer {
      padding: 14px 18px;
      border-top: 1px solid var(--border-subtle);
      font-size: 11px;
      color: var(--text-dim);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* Main Container */
    main.main-content {
      margin-left: 300px;
      flex: 1;
      padding: 30px 40px 60px;
      max-width: 1500px;
    }

    /* Top Navigation Bar */
    .top-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 28px;
      flex-wrap: wrap;
      gap: 16px;
    }
    .header-titles h2 {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #fff;
    }
    .header-titles p {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    /* Filter Pills */
    .filter-pills {
      display: flex;
      gap: 8px;
      background: var(--bg-surface);
      padding: 4px;
      border-radius: 10px;
      border: 1px solid var(--border-subtle);
    }
    .pill-btn {
      padding: 7px 14px;
      font-size: 13px;
      font-weight: 700;
      border-radius: 7px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
    }
    .pill-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.05); }
    .pill-btn.active[data-filter="all"] {
      background: var(--color-brand);
      color: #fff;
      box-shadow: 0 2px 10px rgba(99, 102, 241, 0.35);
    }
    .pill-btn.active[data-filter="passed"] {
      background: var(--color-pass);
      color: #fff;
      box-shadow: 0 2px 10px var(--color-pass-glow);
    }
    .pill-btn.active[data-filter="failed"] {
      background: var(--color-fail);
      color: #fff;
      box-shadow: 0 2px 10px var(--color-fail-glow);
    }
    .pill-btn.active[data-filter="skipped"] {
      background: var(--color-skip);
      color: #fff;
      box-shadow: 0 2px 10px var(--color-skip-glow);
    }

    /* Executive KPI Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 18px;
      margin-bottom: 26px;
    }
    .kpi-card {
      background: var(--bg-card);
      border-radius: 14px;
      padding: 22px;
      border: 1px solid var(--border-subtle);
      position: relative;
      overflow: hidden;
      backdrop-filter: blur(12px);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .kpi-card:hover {
      transform: translateY(-3px);
      border-color: rgba(255, 255, 255, 0.22);
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.4);
    }
    .kpi-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
    }
    .kpi-card.total::before { background: linear-gradient(90deg, #6366f1, #06b6d4); }
    .kpi-card.passed::before { background: #10b981; }
    .kpi-card.failed::before { background: #ef4444; }
    .kpi-card.rate::before { background: linear-gradient(90deg, #10b981, #06b6d4); }

    .kpi-title {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .kpi-value-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-top: 10px;
    }
    .kpi-number {
      font-size: 34px;
      font-weight: 800;
      letter-spacing: -0.03em;
    }
    .kpi-card.total .kpi-number { color: #f8fafc; }
    .kpi-card.passed .kpi-number { color: #34d399; text-shadow: 0 0 16px rgba(16, 185, 129, 0.4); }
    .kpi-card.failed .kpi-number { color: #f87171; text-shadow: 0 0 16px rgba(239, 68, 68, 0.4); }
    .kpi-card.rate .kpi-number { color: #38bdf8; }

    .kpi-subtext {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 6px;
    }

    /* Multi-segment Split Progress Bar */
    .split-bar-container {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 18px 22px;
      margin-bottom: 26px;
    }
    .split-bar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 12px;
    }
    .multi-progress {
      height: 12px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 9999px;
      display: flex;
      overflow: hidden;
      gap: 2px;
    }
    .prog-segment {
      height: 100%;
      transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .prog-segment.pass { background: #10b981; box-shadow: 0 0 8px #10b981; }
    .prog-segment.fail { background: #ef4444; box-shadow: 0 0 8px #ef4444; }
    .prog-segment.skip { background: #f59e0b; }
    .split-legend {
      display: flex;
      gap: 20px;
      margin-top: 12px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }
    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .legend-dot.pass { background: #10b981; }
    .legend-dot.fail { background: #ef4444; }
    .legend-dot.skip { background: #f59e0b; }

    /* Test Cases Table / List */
    .test-list-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .test-list-title {
      font-size: 17px;
      font-weight: 800;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .active-filter-badge {
      font-size: 12px;
      padding: 3px 10px;
      border-radius: 9999px;
      background: rgba(99, 102, 241, 0.2);
      color: #a5b4fc;
      border: 1px solid rgba(99, 102, 241, 0.4);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .clear-filter-btn {
      background: none;
      border: none;
      color: #f87171;
      cursor: pointer;
      font-weight: bold;
      font-size: 14px;
    }
    .action-controls {
      display: flex;
      gap: 8px;
    }
    .mini-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      color: var(--text-muted);
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .mini-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }

    .test-cards-wrapper {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .test-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      overflow: hidden;
      transition: all 0.2s ease;
    }
    .test-card:hover {
      border-color: rgba(255, 255, 255, 0.16);
      background: rgba(23, 32, 54, 0.9);
    }
    .test-card-summary {
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      gap: 16px;
      user-select: none;
    }
    .test-card-left {
      display: flex;
      align-items: center;
      gap: 14px;
      flex: 1;
      overflow: hidden;
    }
    .status-badge {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 4px 10px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }
    .status-badge.passed {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .status-badge.failed {
      background: rgba(239, 68, 68, 0.18);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.4);
    }
    .status-badge.skipped {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .tc-id {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 700;
      color: #a5b4fc;
      white-space: nowrap;
    }
    .tc-title {
      font-size: 14px;
      font-weight: 600;
      color: #f1f5f9;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .test-card-right {
      display: flex;
      align-items: center;
      gap: 14px;
      white-space: nowrap;
    }
    .media-indicator {
      font-size: 13px;
      color: var(--color-cyan);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .mod-tag {
      font-size: 11px;
      padding: 3px 8px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 6px;
      color: var(--text-dim);
    }
    .duration-tag {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: var(--text-muted);
    }
    .chevron {
      color: var(--text-dim);
      transition: transform 0.25s ease;
      font-size: 13px;
      display: inline-block;
    }
    .test-card.open .chevron {
      transform: rotate(180deg);
    }

    /* Test Card Details Accordion */
    .test-card-details {
      display: none;
      padding: 20px 22px 24px;
      border-top: 1px solid var(--border-subtle);
      background: rgba(10, 15, 26, 0.7);
    }
    .test-card.open .test-card-details {
      display: block;
    }

    .details-grid {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* Test Case Objective Bar */
    .tc-objective-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
    }
    .tc-objective-title {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 250px;
    }
    .tc-badge-id {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      font-weight: 700;
      padding: 3px 8px;
      background: rgba(99, 102, 241, 0.2);
      border: 1px solid rgba(99, 102, 241, 0.4);
      color: #a5b4fc;
      border-radius: 4px;
    }
    .tc-desc-text {
      font-size: 14px;
      font-weight: 600;
      color: #f1f5f9;
      line-height: 1.4;
    }
    .tc-data-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      padding: 5px 10px;
      background: rgba(6, 182, 212, 0.1);
      border: 1px solid rgba(6, 182, 212, 0.3);
      border-radius: 6px;
      color: #a5f3fc;
      max-width: 100%;
      word-break: break-all;
    }
    .tc-data-label {
      font-weight: 800;
      letter-spacing: 0.05em;
      color: #38bdf8;
    }
    .tc-data-val {
      font-family: 'JetBrains Mono', monospace;
      color: #e0f2fe;
    }

    /* Expected vs. Actual Results Comparison Grid */
    .results-comparison-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 14px;
    }
    .result-card {
      border-radius: 10px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .result-card.expected-box {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(5, 150, 105, 0.04) 100%);
      border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .result-card.actual-box.passed {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(5, 150, 105, 0.04) 100%);
      border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .result-card.actual-box.failed {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(185, 28, 28, 0.06) 100%);
      border: 1px solid rgba(239, 68, 68, 0.45);
    }
    .result-card.actual-box.skipped {
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.35);
    }
    .result-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .result-card.expected-box .result-label {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #34d399;
    }
    .result-card.actual-box.passed .result-label {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #34d399;
    }
    .result-card.actual-box.failed .result-label {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #f87171;
    }
    .result-card.actual-box.skipped .result-label {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #fbbf24;
    }
    .result-card-body {
      font-size: 13px;
      line-height: 1.5;
      color: #e2e8f0;
      font-weight: 500;
    }
    .result-card.actual-box.failed .result-card-body {
      color: #fecaca;
      font-weight: 600;
    }

    /* Plain English Steps List */
    .plain-steps-box {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 14px 16px;
    }
    .plain-steps-box h4 {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .plain-steps-list {
      margin: 0;
      padding-left: 20px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .plain-steps-list li {
      font-size: 13px;
      color: #cbd5e1;
      line-height: 1.45;
    }
    .plain-steps-list li::marker {
      color: #818cf8;
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace;
    }
    .plain-step-fallback {
      font-size: 13px;
      color: var(--text-muted);
      margin: 0;
    }

    /* Developer Diagnostics Collapsible Details */
    .dev-diagnostics-details {
      margin-top: 4px;
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.6);
      overflow: hidden;
    }
    .dev-diagnostics-summary {
      padding: 10px 14px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
      color: #f87171;
      background: rgba(239, 68, 68, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
      transition: background 0.2s ease;
    }
    .dev-diagnostics-summary:hover {
      background: rgba(239, 68, 68, 0.14);
    }
    .dev-summary-hint {
      font-size: 11px;
      font-weight: 500;
      color: #fca5a5;
      opacity: 0.8;
    }
    .failure-box {
      padding: 14px 16px;
      background: rgba(0, 0, 0, 0.3);
    }
    .failure-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      font-weight: 700;
      color: #fca5a5;
      margin-bottom: 8px;
    }
    .copy-btn {
      background: rgba(239, 68, 68, 0.2);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #fca5a5;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .copy-btn:hover { background: rgba(239, 68, 68, 0.35); }
    .error-stack {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #fca5a5;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.5;
      max-height: 250px;
      overflow-y: auto;
      margin: 0;
    }

    /* Playwright Step Timings Collapsible Details */
    .pw-steps-details {
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.4);
      overflow: hidden;
    }
    .pw-steps-summary {
      padding: 9px 14px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      background: rgba(255, 255, 255, 0.02);
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
    }
    .pw-steps-summary:hover {
      background: rgba(255, 255, 255, 0.05);
      color: #fff;
    }
    .steps-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 10px 14px;
      margin: 0;
    }
    .step-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 4px;
      font-size: 12px;
    }
    .step-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .step-icon { font-size: 12px; }
    .step-icon.ok { color: #10b981; }
    .step-icon.fail { color: #ef4444; }
    .step-dur {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--text-dim);
    }

    /* Screenshots & Media */
    .media-box {
      margin-top: 14px;
    }
    .media-box h4 {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
      margin-bottom: 10px;
    }
    .media-container {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .media-thumb {
      max-width: 320px;
      max-height: 200px;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
      cursor: pointer;
      transition: transform 0.2s ease, border-color 0.2s ease;
    }
    .media-thumb:hover {
      transform: scale(1.02);
      border-color: var(--color-cyan);
    }
    .video-player {
      max-width: 480px;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
      background: #000;
    }

    /* Lightbox Modal */
    .lightbox-modal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.9);
      backdrop-filter: blur(8px);
      z-index: 100;
      align-items: center;
      justify-content: center;
      padding: 30px;
    }
    .lightbox-modal.open { display: flex; }
    .lightbox-content {
      max-width: 95%;
      max-height: 95%;
      border-radius: 10px;
      border: 1px solid var(--border-subtle);
      box-shadow: 0 0 40px rgba(0,0,0,0.8);
    }
    .lightbox-close {
      position: absolute;
      top: 24px;
      right: 28px;
      font-size: 32px;
      color: #fff;
      cursor: pointer;
      user-select: none;
    }

    /* Empty state */
    .empty-state {
      text-align: center;
      padding: 50px 20px;
      color: var(--text-dim);
      background: var(--bg-card);
      border-radius: 12px;
      border: 1px dashed var(--border-subtle);
    }

    /* Responsive */
    @media (max-width: 1024px) {
      aside.sidebar { transform: translateX(-100%); transition: transform 0.3s ease; }
      aside.sidebar.mobile-open { transform: translateX(0); }
      main.main-content { margin-left: 0; padding: 20px; }
    }
  </style>
</head>
<body>

  <!-- Left Sidebar Navigation Menu -->
  <aside class="sidebar">
    <div class="brand-header">
      <div class="brand-logo">🌊</div>
      <div class="brand-text">
        <h1>RiverStream QA <span class="live-pulse"></span></h1>
        <p>Enterprise Automation Suite</p>
      </div>
    </div>

    <div class="sidebar-search">
      <div class="search-input-wrapper">
        <span class="search-icon">🔍</span>
        <input type="text" id="sidebarSearch" placeholder="Search test cases, ID, errors...">
      </div>
    </div>

    <div class="sidebar-menu">
      <div class="menu-category">Views</div>
      <div class="nav-item active" data-nav="overview">
        <div class="nav-item-left">
          <span>📊</span>
          <span>Executive Overview</span>
        </div>
        <span class="nav-badge pass">${passedTests}/${totalTests}</span>
      </div>

      <div class="nav-item" data-nav="failures">
        <div class="nav-item-left">
          <span>🚨</span>
          <span>Failures Hub</span>
        </div>
        <span class="nav-badge ${failedTests > 0 ? 'fail' : 'pass'}">${failedTests}</span>
      </div>

      <div class="nav-item" data-nav="gallery">
        <div class="nav-item-left">
          <span>📸</span>
          <span>Evidence Gallery</span>
        </div>
      </div>

      <div class="menu-category">Modules (Clickable Navigation)</div>
      ${sortedModules.map(m => `
        <div class="nav-item" data-nav="module" data-module-key="${m.key}">
          <div class="nav-item-left">
            <span>${m.icon}</span>
            <span title="${escapeHtml(m.name)}">${escapeHtml(m.shortName)}</span>
          </div>
          <span class="nav-badge ${m.failed > 0 ? 'fail' : 'pass'}">${m.passed}/${m.total}</span>
        </div>
      `).join('')}
    </div>

    <div class="sidebar-footer">
      <span>QA — Riverstone Org</span>
      <span>${timeStr}</span>
    </div>
  </aside>

  <!-- Main Content Area -->
  <main class="main-content">
    
    <!-- Top Header -->
    <header class="top-header">
      <div class="header-titles">
        <h2 id="viewHeading">Execution Dashboard</h2>
        <p id="viewSubheading">Automated regression run executed on <strong>${dateStr}</strong> at <strong>${timeStr}</strong> against RiverStream QA</p>
      </div>

      <div class="header-actions">
        <!-- Colorful Status Split Pills -->
        <div class="filter-pills">
          <button class="pill-btn active" data-filter="all">
            All (${totalTests})
          </button>
          <button class="pill-btn" data-filter="passed">
            ● Passed (${passedTests})
          </button>
          <button class="pill-btn" data-filter="failed">
            ● Failed (${failedTests})
          </button>
          <button class="pill-btn" data-filter="skipped">
            ● Skipped (${skippedTests})
          </button>
        </div>
      </div>
    </header>

    <!-- Executive KPI Grid (Split metrics, fully clickable!) -->
    <section class="kpi-grid">
      <div class="kpi-card total" data-filter="all" title="Click to view all test cases">
        <div class="kpi-title">
          <span>Total Tests Executed</span>
          <span>⚡</span>
        </div>
        <div class="kpi-value-row">
          <span class="kpi-number">${totalTests}</span>
        </div>
        <div class="kpi-subtext">Across ${sortedModules.length} core test modules · Click to view all</div>
      </div>

      <div class="kpi-card passed" data-filter="passed" title="Click to filter passed cases">
        <div class="kpi-title">
          <span>Passed Cases</span>
          <span style="color: #10b981; font-size: 16px;">✓</span>
        </div>
        <div class="kpi-value-row">
          <span class="kpi-number">${passedTests}</span>
        </div>
        <div class="kpi-subtext">${passRate}% overall success rate · Click to filter</div>
      </div>

      <div class="kpi-card failed" data-filter="failed" title="Click to filter failed cases">
        <div class="kpi-title">
          <span>Failed Cases</span>
          <span style="color: #ef4444; font-size: 16px;">✗</span>
        </div>
        <div class="kpi-value-row">
          <span class="kpi-number">${failedTests}</span>
        </div>
        <div class="kpi-subtext">${failedTests === 0 ? 'Zero regression defects' : 'Needs immediate QA review · Click to filter'}</div>
      </div>

      <div class="kpi-card rate" data-filter="all" title="Total Execution Duration">
        <div class="kpi-title">
          <span>Pass Rate & Duration</span>
          <span>⏱️</span>
        </div>
        <div class="kpi-value-row">
          <span class="kpi-number">${passRate}%</span>
        </div>
        <div class="kpi-subtext">Total time: ${formatDuration(totalDurationMs)}</div>
      </div>
    </section>

    <!-- Multi-Segment Split Progress Bar -->
    <section class="split-bar-container">
      <div class="split-bar-header">
        <span>Execution Status Split</span>
        <span>${passedTests} Passed · ${failedTests} Failed · ${skippedTests} Skipped</span>
      </div>
      <div class="multi-progress">
        <div class="prog-segment pass" style="width: ${totalTests > 0 ? (passedTests / totalTests) * 100 : 100}%;" title="Passed: ${passedTests}"></div>
        <div class="prog-segment fail" style="width: ${totalTests > 0 ? (failedTests / totalTests) * 100 : 0}%;" title="Failed: ${failedTests}"></div>
        <div class="prog-segment skip" style="width: ${totalTests > 0 ? (skippedTests / totalTests) * 100 : 0}%;" title="Skipped: ${skippedTests}"></div>
      </div>
      <div class="split-legend">
        <div class="legend-item" data-filter="passed"><span class="legend-dot pass"></span> Passed (${passedTests})</div>
        <div class="legend-item" data-filter="failed"><span class="legend-dot fail"></span> Failed (${failedTests})</div>
        <div class="legend-item" data-filter="skipped"><span class="legend-dot skip"></span> Skipped (${skippedTests})</div>
      </div>
    </section>

    <!-- Test List Section -->
    <section class="test-list-section" id="testListSection">
      <div class="test-list-header">
        <div class="test-list-title">
          <span id="testListHeading">All Test Cases</span>
          <span class="count-indicator" id="testCountIndicator">(${totalTests} items)</span>
          <span id="activeFilterBadgeContainer"></span>
        </div>
        <div class="action-controls">
          <button class="mini-btn" id="expandAllBtn">Expand All</button>
          <button class="mini-btn" id="collapseAllBtn">Collapse All</button>
        </div>
      </div>

      <div class="test-cards-wrapper" id="testCardsWrapper">
        ${processedCases.map(tc => `
          <div class="test-card" data-id="${escapeHtml(tc.id)}" data-status="${escapeHtml(tc.status)}" data-module="${escapeHtml(tc.moduleKey)}" data-title="${escapeHtml(tc.title.toLowerCase())} ${escapeHtml(tc.tcId.toLowerCase())}">
            <div class="test-card-summary">
              <div class="test-card-left">
                <span class="status-badge ${escapeHtml(tc.status)}">
                  ${tc.status === 'passed' ? '✓ PASS' : tc.status === 'failed' ? '✗ FAIL' : '● SKIP'}
                </span>
                <span class="tc-id">${escapeHtml(tc.tcId)}</span>
                <span class="tc-title" title="${escapeHtml(tc.title)}">${escapeHtml(tc.title)}</span>
              </div>
              <div class="test-card-right">
                ${tc.media.length > 0 ? `<span class="media-indicator" title="${tc.media.length} media attached">📸 ${tc.media.length}</span>` : ''}
                <span class="mod-tag">${escapeHtml(tc.moduleName.split(':')[0])}</span>
                <span class="duration-tag">${formatDuration(tc.durationMs)}</span>
                <span class="chevron">▼</span>
              </div>
            </div>

            <div class="test-card-details">
              <div class="details-grid">
                
                <!-- 1. Executive Objective & Test Data Bar -->
                <div class="tc-objective-bar">
                  <div class="tc-objective-title">
                    <span class="tc-badge-id">${escapeHtml(tc.tcId)}</span>
                    <span class="tc-desc-text">${escapeHtml(tc.description || tc.title)}</span>
                  </div>
                  ${tc.testData && tc.testData !== '-' ? `
                    <div class="tc-data-badge" title="Input test parameters">
                      <span class="tc-data-label">DATA:</span>
                      <span class="tc-data-val">${escapeHtml(tc.testData)}</span>
                    </div>
                  ` : ''}
                </div>

                <!-- 2. The Core Expected vs. Actual Results (Plain English) -->
                <div class="results-comparison-grid">
                  <!-- Expected Result Card -->
                  <div class="result-card expected-box">
                    <div class="result-card-header">
                      <span class="result-icon">🟢</span>
                      <span class="result-label">Expected Result (Acceptance Criteria)</span>
                    </div>
                    <div class="result-card-body">
                      ${escapeHtml(tc.expectedResult || 'System should execute the workflow successfully and verify expected UI state without errors.')}
                    </div>
                  </div>

                  <!-- Actual Result Card -->
                  <div class="result-card actual-box ${escapeHtml(tc.status)}">
                    <div class="result-card-header">
                      <span class="result-icon">${tc.status === 'passed' ? '🟢' : tc.status === 'failed' ? '🔴' : '●'}</span>
                      <span class="result-label">Actual Result (${tc.status === 'passed' ? 'Verified Success' : tc.status === 'failed' ? 'Why it Failed' : 'Execution Skipped'})</span>
                    </div>
                    <div class="result-card-body">
                      ${escapeHtml(tc.actualResult)}
                    </div>
                  </div>
                </div>

                <!-- 3. Plain English Test Execution Steps -->
                <div class="plain-steps-box">
                  <h4>📋 Test Steps Executed (Plain English Walkthrough)</h4>
                  ${formatPlainStepsHtml(tc.plainSteps)}
                </div>

                <!-- 4. Developer Technical Diagnostics (Collapsible if error exists) -->
                ${tc.error ? `
                  <details class="dev-diagnostics-details">
                    <summary class="dev-diagnostics-summary">
                      <span>🛠️ View Technical Stack Trace & Playwright Diagnostic</span>
                      <span class="dev-summary-hint">For Engineers & Developers</span>
                    </summary>
                    <div class="failure-box">
                      <div class="failure-header">
                        <span>Playwright Failure Stack:</span>
                        <button class="copy-btn">Copy Stack</button>
                      </div>
                      <pre class="error-stack">${escapeHtml(tc.errorStack || tc.error)}</pre>
                    </div>
                  </details>
                ` : ''}

                <!-- 5. Internal Step & Hook Timings (Collapsible) -->
                <details class="pw-steps-details">
                  <summary class="pw-steps-summary">
                    <span>⏱️ View Browser Action & Hook Timings (${tc.steps.length} checkpoints)</span>
                    <span style="font-size: 11px; color: var(--text-dim); font-family: 'JetBrains Mono', monospace;">${formatDuration(tc.durationMs)} total</span>
                  </summary>
                  <ul class="steps-list">
                    ${tc.steps.map(s => `
                      <li class="step-item">
                        <div class="step-left">
                          <span class="step-icon ${s.ok ? 'ok' : 'fail'}">${s.ok ? '✓' : '✗'}</span>
                          <span>${escapeHtml(s.title)}</span>
                        </div>
                        <span class="step-dur">${formatDuration(s.durationMs)}</span>
                      </li>
                    `).join('')}
                  </ul>
                </details>

                <!-- 6. Evidence & Media Attachments -->
                ${tc.media.length > 0 ? `
                  <div class="media-box">
                    <h4>📸 Evidence & Media Attachments (${tc.media.length})</h4>
                    <div class="media-container">
                      ${tc.media.map(m => m.type === 'image' ? `
                        <img src="${m.src}" alt="${escapeHtml(m.name)}" class="media-thumb" title="${escapeHtml(m.name)} (Click to zoom)">
                      ` : `
                        <video controls class="video-player">
                          <source src="${m.src}" type="video/webm">
                          Your browser does not support video playback.
                        </video>
                      `).join('')}
                    </div>
                  </div>
                ` : ''}

              </div>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="empty-state" id="emptyState" style="display: none;">
        <h3>No matching test cases found</h3>
        <p style="margin-top: 8px;">Try clearing search keywords or changing the status filter.</p>
      </div>
    </section>

  </main>

  <!-- Lightbox Modal -->
  <div class="lightbox-modal" id="lightbox">
    <span class="lightbox-close">&times;</span>
    <img src="" id="lightboxImg" class="lightbox-content">
  </div>

  <script>
    // State management
    let currentFilter = 'all';
    let currentModule = 'all';
    let searchQuery = '';

    // Filter refresh logic
    function refreshView() {
      const cards = document.querySelectorAll('.test-card');
      let visibleCount = 0;

      cards.forEach(card => {
        const cardStatus = card.getAttribute('data-status');
        const cardModule = card.getAttribute('data-module');
        const cardTitle = card.getAttribute('data-title') || '';

        const matchStatus = (currentFilter === 'all') || (cardStatus === currentFilter);
        const matchModule = (currentModule === 'all') || (cardModule === currentModule);
        const matchSearch = (!searchQuery) || (cardTitle.indexOf(searchQuery) !== -1);

        if (matchStatus && matchModule && matchSearch) {
          card.style.display = 'block';
          visibleCount++;
        } else {
          card.style.display = 'none';
        }
      });

      // Update count indicator
      const countEl = document.getElementById('testCountIndicator');
      if (countEl) {
        countEl.textContent = '(' + visibleCount + ' items displayed)';
      }

      // Empty state
      const emptyEl = document.getElementById('emptyState');
      if (emptyEl) {
        emptyEl.style.display = visibleCount === 0 ? 'block' : 'none';
      }

      // Active filter badge
      const badgeContainer = document.getElementById('activeFilterBadgeContainer');
      if (badgeContainer) {
        if (currentModule !== 'all') {
          const modItem = document.querySelector('.nav-item[data-module-key="' + currentModule + '"]');
          const modName = modItem ? modItem.querySelector('.nav-item-left span:last-child').textContent : currentModule;
          badgeContainer.innerHTML = '<span class="active-filter-badge">Filter: ' + modName + ' <button class="clear-filter-btn" title="Clear module filter">&times;</button></span>';
        } else {
          badgeContainer.innerHTML = '';
        }
      }
    }

    // Set status filter
    function setStatusFilter(status) {
      currentFilter = status;
      document.querySelectorAll('.filter-pills .pill-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === status);
      });
      refreshView();
    }

    // Set module filter
    function setModuleFilter(modKey) {
      currentModule = modKey;
      document.querySelectorAll('.sidebar .nav-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-module-key') === modKey);
      });

      const heading = document.getElementById('viewHeading');
      if (heading) {
        if (modKey === 'all') {
          heading.textContent = 'Execution Dashboard';
        } else {
          const modItem = document.querySelector('.nav-item[data-module-key="' + modKey + '"]');
          const name = modItem ? modItem.querySelector('.nav-item-left span:last-child').textContent : modKey;
          heading.textContent = 'Module: ' + name;
        }
      }

      refreshView();

      // Scroll smoothly to test list section
      const listSec = document.getElementById('testListSection');
      if (listSec) {
        listSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    // Event Delegation: Global Click Handlers
    document.addEventListener('click', function(e) {
      // 1. Toggle Test Card
      const summary = e.target.closest('.test-card-summary');
      if (summary) {
        const card = summary.closest('.test-card');
        if (card) {
          card.classList.toggle('open');
        }
        return;
      }

      // 2. Status Filter Pills
      const pillBtn = e.target.closest('.pill-btn');
      if (pillBtn) {
        const filter = pillBtn.getAttribute('data-filter');
        if (filter) setStatusFilter(filter);
        return;
      }

      // 3. KPI Cards Click to Filter
      const kpiCard = e.target.closest('.kpi-card');
      if (kpiCard) {
        const filter = kpiCard.getAttribute('data-filter');
        if (filter) setStatusFilter(filter);
        const listSec = document.getElementById('testListSection');
        if (listSec) listSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      // 4. Progress Legend Items Click to Filter
      const legendItem = e.target.closest('.legend-item');
      if (legendItem) {
        const filter = legendItem.getAttribute('data-filter');
        if (filter) setStatusFilter(filter);
        return;
      }

      // 5. Sidebar Navigation Items
      const navItem = e.target.closest('.sidebar .nav-item');
      if (navItem) {
        const nav = navItem.getAttribute('data-nav');
        if (nav === 'overview') {
          currentModule = 'all';
          setStatusFilter('all');
          document.querySelectorAll('.sidebar .nav-item').forEach(el => el.classList.remove('active'));
          navItem.classList.add('active');
          document.getElementById('viewHeading').textContent = 'Execution Dashboard';
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (nav === 'failures') {
          currentModule = 'all';
          setStatusFilter('failed');
          document.querySelectorAll('.sidebar .nav-item').forEach(el => el.classList.remove('active'));
          navItem.classList.add('active');
          document.getElementById('viewHeading').textContent = 'Failures Hub';
          const listSec = document.getElementById('testListSection');
          if (listSec) listSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (nav === 'gallery') {
          currentModule = 'all';
          setStatusFilter('all');
          document.querySelectorAll('.sidebar .nav-item').forEach(el => el.classList.remove('active'));
          navItem.classList.add('active');
          document.getElementById('viewHeading').textContent = 'Evidence & Screenshots Gallery';

          // Show & expand all cards that have media
          document.querySelectorAll('.test-card').forEach(card => {
            const hasMedia = card.querySelector('.media-thumb, .video-player');
            if (hasMedia) {
              card.classList.add('open');
              card.style.display = 'block';
            } else {
              card.style.display = 'none';
            }
          });
          const listSec = document.getElementById('testListSection');
          if (listSec) listSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        } else if (nav === 'module') {
          const modKey = navItem.getAttribute('data-module-key');
          if (modKey) setModuleFilter(modKey);
        }
        return;
      }

      // 6. Clear Module Filter Button
      const clearBtn = e.target.closest('.clear-filter-btn');
      if (clearBtn) {
        setModuleFilter('all');
        return;
      }

      // 7. Copy Stack Trace Button
      const copyBtn = e.target.closest('.copy-btn');
      if (copyBtn) {
        const stackPre = copyBtn.closest('.failure-box').querySelector('.error-stack');
        if (stackPre) {
          navigator.clipboard.writeText(stackPre.textContent || '');
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy Stack'; }, 1500);
        }
        return;
      }

      // 8. Image Lightbox Click
      const thumb = e.target.closest('.media-thumb');
      if (thumb) {
        const lb = document.getElementById('lightbox');
        const img = document.getElementById('lightboxImg');
        if (lb && img) {
          img.src = thumb.src;
          lb.classList.add('open');
        }
        return;
      }

      // 9. Close Lightbox Click
      if (e.target.id === 'lightbox' || e.target.classList.contains('lightbox-close')) {
        const lb = document.getElementById('lightbox');
        if (lb) lb.classList.remove('open');
      }
    });

    // Expand All / Collapse All buttons
    const expandAllBtn = document.getElementById('expandAllBtn');
    if (expandAllBtn) {
      expandAllBtn.addEventListener('click', function() {
        document.querySelectorAll('.test-card').forEach(c => {
          if (c.style.display !== 'none') c.classList.add('open');
        });
      });
    }

    const collapseAllBtn = document.getElementById('collapseAllBtn');
    if (collapseAllBtn) {
      collapseAllBtn.addEventListener('click', function() {
        document.querySelectorAll('.test-card').forEach(c => c.classList.remove('open'));
      });
    }

    // Search Input Event
    const searchInput = document.getElementById('sidebarSearch');
    if (searchInput) {
      searchInput.addEventListener('input', function(e) {
        searchQuery = (e.target.value || '').toLowerCase().trim();
        refreshView();
      });
    }

    // Keyboard Shortcuts
    window.addEventListener('keydown', function(e) {
      if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        if (searchInput) searchInput.focus();
      } else if (e.key === 'Escape') {
        const lb = document.getElementById('lightbox');
        if (lb) lb.classList.remove('open');
      }
    });

    // Initial render
    refreshView();
  </script>
</body>
</html>
`;

  fs.writeFileSync(outputHtmlPath, htmlReport, 'utf-8');
  console.log(`[ElegantReport] Report successfully generated at: ${outputHtmlPath} (${(htmlReport.length / 1024).toFixed(1)} KB)`);

  const copyPath = path.resolve(process.cwd(), 'test-results/elegant-report.html');
  try {
    fs.writeFileSync(copyPath, htmlReport, 'utf-8');
  } catch (e) {
    // ignore
  }
}

// Auto-run if executed directly
if (require.main === module) {
  generateElegantReport();
}
