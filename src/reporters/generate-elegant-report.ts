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
  steps: Array<{ title: string; durationMs: number; ok: boolean }>;
  screenshots: Array<{ name: string; base64: string; contentType: string }>;
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

// Module mapping helper
function resolveModuleInfo(filePath: string, title: string): { key: string; name: string; shortName: string; icon: string; order: number } {
  const norm = (filePath + ' ' + title).replace(/\\/g, '/').toLowerCase();
  
  if (norm.includes('auth') || norm.includes('sign-in') || norm.includes('login')) {
    return { key: 'mod_01', name: 'Module 01: Authentication & Session', shortName: 'Authentication', icon: 'shield-check', order: 1 };
  }
  if (norm.includes('left-side') || norm.includes('navigation') || norm.includes('dashboard')) {
    return { key: 'mod_02', name: 'Module 02: Dashboard & Navigation', shortName: 'Navigation', icon: 'compass', order: 2 };
  }
  if (norm.includes('upload') || norm.includes('dropzone') || norm.includes('sif')) {
    return { key: 'mod_03', name: 'Module 03: Document Upload & Processing', shortName: 'Upload & SIF', icon: 'cloud-arrow-up', order: 3 };
  }
  if (norm.includes('documents') && !norm.includes('po-ack')) {
    return { key: 'mod_04', name: 'Module 04: Documents Management', shortName: 'Documents', icon: 'folder-open', order: 4 };
  }
  if (norm.includes('po-ack-recon') || norm.includes('recon')) {
    return { key: 'mod_05', name: 'Module 05: PO-ACK Reconciliation', shortName: 'PO-ACK Recon', icon: 'scale', order: 5 };
  }
  if (norm.includes('review')) {
    return { key: 'mod_06', name: 'Module 06: Document Review & Verification', shortName: 'Doc Review', icon: 'file-search', order: 6 };
  }
  if (norm.includes('settings') || norm.includes('organization') || norm.includes('tenant')) {
    return { key: 'mod_07', name: 'Module 07: Settings & Tenant Configuration', shortName: 'Settings', icon: 'sliders-horizontal', order: 7 };
  }
  if (norm.includes('email') || norm.includes('riverstone-email')) {
    return { key: 'mod_08', name: 'Module 08: Riverstone Email Order Ingestion', shortName: 'Email Flow', icon: 'mail-check', order: 8 };
  }

  return { key: 'mod_00', name: 'General Test Suite', shortName: 'General', icon: 'check-circle-2', order: 99 };
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

// Inlines local image as Base64 data URL
function readImageAsBase64(imgPath: string): string {
  try {
    if (fs.existsSync(imgPath)) {
      const buffer = fs.readFileSync(imgPath);
      return `data:image/png;base64,${buffer.toString('base64')}`;
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
  let reportStats: any = {};

  if (fs.existsSync(summaryJsonPath)) {
    try {
      const jsonContent = fs.readFileSync(summaryJsonPath, 'utf-8');
      const parsed = JSON.parse(jsonContent);
      reportStats = parsed.stats || {};
      rawSpecs = collectPlaywrightSpecs(parsed);
      console.log(`[ElegantReport] Found ${rawSpecs.length} specs in ${summaryJsonPath}`);
    } catch (e: any) {
      console.warn(`[ElegantReport] Could not parse ${summaryJsonPath}:`, e.message);
    }
  }

  const processedCases: ProcessedTestCase[] = [];
  const moduleMap: Map<string, ModuleInfo> = new Map();

  for (const spec of rawSpecs) {
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

    // Screenshots
    const screenshots: Array<{ name: string; base64: string; contentType: string }> = [];
    if (latestResult?.attachments) {
      for (const att of latestResult.attachments) {
        if (att.contentType && att.contentType.startsWith('image/') && att.path) {
          const b64 = readImageAsBase64(att.path);
          if (b64) {
            screenshots.push({
              name: att.name || 'Screenshot',
              base64: b64,
              contentType: att.contentType,
            });
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
      steps.push({ title: 'Before Hooks & Browser Context Init', durationMs: Math.min(250, durationMs), ok: true });
      steps.push({ title: `Execute: ${spec.title}`, durationMs: Math.max(0, durationMs - 300), ok: status === 'passed' });
      steps.push({ title: 'After Hooks & Screenshot Teardown', durationMs: 50, ok: true });
    }

    processedCases.push({
      id: spec.id || `tc_${processedCases.length + 1}`,
      tcId: extractTcId(spec.title),
      title: spec.title,
      moduleKey: modInfo.key,
      moduleName: modInfo.name,
      file: spec.file,
      line: spec.line || 1,
      status,
      durationMs,
      error: errorReason,
      errorStack,
      steps,
      screenshots,
    });
  }

  // Ensure all 8 canonical modules exist in navigation
  const canonicalModules = [
    { key: 'mod_01', name: 'Module 01: Authentication & Session', shortName: 'Authentication', icon: 'shield-check', order: 1 },
    { key: 'mod_02', name: 'Module 02: Dashboard & Navigation', shortName: 'Navigation', icon: 'compass', order: 2 },
    { key: 'mod_03', name: 'Module 03: Document Upload & Processing', shortName: 'Upload & SIF', icon: 'cloud-arrow-up', order: 3 },
    { key: 'mod_04', name: 'Module 04: Documents Management', shortName: 'Documents', icon: 'folder-open', order: 4 },
    { key: 'mod_05', name: 'Module 05: PO-ACK Reconciliation', shortName: 'PO-ACK Recon', icon: 'scale', order: 5 },
    { key: 'mod_06', name: 'Module 06: Document Review & Verification', shortName: 'Doc Review', icon: 'file-search', order: 6 },
    { key: 'mod_07', name: 'Module 07: Settings & Tenant Configuration', shortName: 'Settings', icon: 'sliders-horizontal', order: 7 },
    { key: 'mod_08', name: 'Module 08: Riverstone Email Order Ingestion', shortName: 'Email Flow', icon: 'mail-check', order: 8 },
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
  const flakyTests = processedCases.filter(c => c.status === 'flaky').length;
  const totalDurationMs = processedCases.reduce((acc, c) => acc + c.durationMs, 0);
  const passRate = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 100;

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  const htmlReport = `<!DOCTYPE html>
<html lang="en" class="dark">
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
      --color-flaky: #ec4899;
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
      background: rgba(255, 255, 255, 0.04);
      color: #fff;
    }
    .nav-item.active {
      background: linear-gradient(90deg, rgba(99, 102, 241, 0.16) 0%, rgba(6, 182, 212, 0.08) 100%);
      color: #fff;
      border-color: rgba(99, 102, 241, 0.35);
      box-shadow: inset 2px 0 0 #6366f1;
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
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .nav-badge.pass {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.25);
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
      gap: 10px;
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
    .pill-btn:hover { color: #fff; }
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
      transition: transform 0.2s ease, border-color 0.2s ease;
    }
    .kpi-card:hover {
      transform: translateY(-2px);
      border-color: rgba(255, 255, 255, 0.16);
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
      margin-bottom: 14px;
    }
    .test-list-title {
      font-size: 16px;
      font-weight: 800;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .count-indicator {
      font-size: 12px;
      color: var(--text-muted);
      font-weight: 500;
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
      gap: 16px;
      white-space: nowrap;
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
      font-size: 16px;
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
      display: grid;
      grid-template-columns: 1fr;
      gap: 18px;
    }

    /* Failure Callout */
    .failure-box {
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 8px;
      padding: 16px;
    }
    .failure-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      font-weight: 700;
      color: #f87171;
      margin-bottom: 8px;
    }
    .copy-btn {
      background: rgba(239, 68, 68, 0.2);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #fca5a5;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 4px;
      cursor: pointer;
    }
    .copy-btn:hover { background: rgba(239, 68, 68, 0.3); }
    .error-stack {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #fca5a5;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.5;
      max-height: 250px;
      overflow-y: auto;
    }

    /* Steps List */
    .steps-box h4 {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
      margin-bottom: 10px;
    }
    .steps-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .step-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 6px;
      font-size: 13px;
    }
    .step-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .step-icon { font-size: 13px; }
    .step-icon.ok { color: #10b981; }
    .step-icon.fail { color: #ef4444; }
    .step-dur {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--text-dim);
    }

    /* Screenshots View */
    .screenshots-box {
      margin-top: 14px;
    }
    .screenshots-box h4 {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-dim);
      margin-bottom: 10px;
    }
    .screenshot-thumb-container {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
    }
    .screenshot-thumb {
      max-width: 320px;
      max-height: 200px;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
      cursor: pointer;
      transition: transform 0.2s ease, border-color 0.2s ease;
    }
    .screenshot-thumb:hover {
      transform: scale(1.02);
      border-color: var(--color-cyan);
    }

    /* Lightbox Modal */
    .lightbox-modal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.88);
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
        <input type="text" id="sidebarSearch" placeholder="Search test cases, ID, errors..." oninput="onSearchChange(this.value)">
      </div>
    </div>

    <div class="sidebar-menu">
      <div class="menu-category">Views</div>
      <div class="nav-item active" data-nav="overview" onclick="navigateView('overview')">
        <div class="nav-item-left">
          <span>📊</span>
          <span>Executive Overview</span>
        </div>
        <span class="nav-badge pass">${passedTests}/${totalTests}</span>
      </div>

      <div class="nav-item" data-nav="failures" onclick="navigateView('failures')">
        <div class="nav-item-left">
          <span>🚨</span>
          <span>Failures Hub</span>
        </div>
        <span class="nav-badge ${failedTests > 0 ? 'fail' : 'pass'}">${failedTests}</span>
      </div>

      <div class="nav-item" data-nav="gallery" onclick="navigateView('gallery')">
        <div class="nav-item-left">
          <span>📸</span>
          <span>Evidence Gallery</span>
        </div>
      </div>

      <div class="menu-category">Modules (Clickable Navigation)</div>
      ${sortedModules.map(m => `
        <div class="nav-item" data-nav="module_${m.key}" onclick="filterByModule('${m.key}')">
          <div class="nav-item-left">
            <span>📁</span>
            <span title="${m.name}">${m.shortName}</span>
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
        <p>Automated regression run executed on <strong>${dateStr}</strong> at <strong>${timeStr}</strong> against RiverStream QA</p>
      </div>

      <div class="header-actions">
        <!-- Colorful Status Split Pills -->
        <div class="filter-pills">
          <button class="pill-btn active" data-filter="all" onclick="applyStatusFilter('all')">
            All (${totalTests})
          </button>
          <button class="pill-btn" data-filter="passed" onclick="applyStatusFilter('passed')">
            ● Passed (${passedTests})
          </button>
          <button class="pill-btn" data-filter="failed" onclick="applyStatusFilter('failed')">
            ● Failed (${failedTests})
          </button>
          <button class="pill-btn" data-filter="skipped" onclick="applyStatusFilter('skipped')">
            ● Skipped (${skippedTests})
          </button>
        </div>
      </div>
    </header>

    <!-- Executive KPI Grid (Split metrics) -->
    <section class="kpi-grid">
      <div class="kpi-card total">
        <div class="kpi-title">Total Tests Executed</div>
        <div class="kpi-value-row">
          <span class="kpi-number">${totalTests}</span>
          <span>⚡</span>
        </div>
        <div class="kpi-subtext">Across ${sortedModules.length} core test modules</div>
      </div>

      <div class="kpi-card passed">
        <div class="kpi-title">Passed Cases</div>
        <div class="kpi-value-row">
          <span class="kpi-number">${passedTests}</span>
          <span style="color: #10b981; font-size: 20px;">✓</span>
        </div>
        <div class="kpi-subtext">${passRate}% overall success rate</div>
      </div>

      <div class="kpi-card failed">
        <div class="kpi-title">Failed Cases</div>
        <div class="kpi-value-row">
          <span class="kpi-number">${failedTests}</span>
          <span style="color: #ef4444; font-size: 20px;">✗</span>
        </div>
        <div class="kpi-subtext">${failedTests === 0 ? 'Zero regression defects' : 'Needs immediate QA review'}</div>
      </div>

      <div class="kpi-card rate">
        <div class="kpi-title">Pass Rate & Duration</div>
        <div class="kpi-value-row">
          <span class="kpi-number">${passRate}%</span>
          <span>⏱️</span>
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
        <div class="legend-item"><span class="legend-dot pass"></span> Passed (${passedTests})</div>
        <div class="legend-item"><span class="legend-dot fail"></span> Failed (${failedTests})</div>
        <div class="legend-item"><span class="legend-dot skip"></span> Skipped (${skippedTests})</div>
      </div>
    </section>

    <!-- Test List Section -->
    <section class="test-list-section">
      <div class="test-list-header">
        <div class="test-list-title">
          <span id="testListHeading">All Test Cases</span>
          <span class="count-indicator" id="testCountIndicator">(${totalTests} items)</span>
        </div>
      </div>

      <div class="test-cards-wrapper" id="testCardsWrapper">
        ${processedCases.map(tc => `
          <div class="test-card" data-id="${tc.id}" data-status="${tc.status}" data-module="${tc.moduleKey}" data-title="${tc.title.toLowerCase()} ${tc.tcId.toLowerCase()}">
            <div class="test-card-summary" onclick="toggleCard('${tc.id}')">
              <div class="test-card-left">
                <span class="status-badge ${tc.status}">
                  ${tc.status === 'passed' ? '✓ PASS' : tc.status === 'failed' ? '✗ FAIL' : '● SKIP'}
                </span>
                <span class="tc-id">${tc.tcId}</span>
                <span class="tc-title" title="${tc.title}">${tc.title}</span>
              </div>
              <div class="test-card-right">
                <span class="mod-tag">${tc.moduleName.split(':')[0]}</span>
                <span class="duration-tag">${formatDuration(tc.durationMs)}</span>
                <span class="chevron">▼</span>
              </div>
            </div>

            <div class="test-card-details">
              <div class="details-grid">
                ${tc.error ? `
                  <div class="failure-box">
                    <div class="failure-header">
                      <span>Assertion / Error Diagnostic:</span>
                      <button class="copy-btn" onclick="navigator.clipboard.writeText('${tc.errorStack ? tc.errorStack.replace(/'/g, "\\'") : ''}')">Copy Stack</button>
                    </div>
                    <pre class="error-stack">${tc.errorStack || tc.error}</pre>
                  </div>
                ` : ''}

                <div class="steps-box">
                  <h4>Test Step Sequence</h4>
                  <ul class="steps-list">
                    ${tc.steps.map(s => `
                      <li class="step-item">
                        <div class="step-left">
                          <span class="step-icon ${s.ok ? 'ok' : 'fail'}">${s.ok ? '✓' : '✗'}</span>
                          <span>${s.title}</span>
                        </div>
                        <span class="step-dur">${formatDuration(s.durationMs)}</span>
                      </li>
                    `).join('')}
                  </ul>
                </div>

                ${tc.screenshots.length > 0 ? `
                  <div class="screenshots-box">
                    <h4>Attached Screenshots (${tc.screenshots.length})</h4>
                    <div class="screenshot-thumb-container">
                      ${tc.screenshots.map(sc => `
                        <img src="${sc.base64}" alt="${sc.name}" class="screenshot-thumb" onclick="openLightbox('${sc.base64}')" title="${sc.name}">
                      `).join('')}
                    </div>
                  </div>
                ` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </section>

  </main>

  <!-- Lightbox Modal -->
  <div class="lightbox-modal" id="lightbox" onclick="closeLightbox()">
    <span class="lightbox-close" onclick="closeLightbox()">&times;</span>
    <img src="" id="lightboxImg" class="lightbox-content" onclick="event.stopPropagation()">
  </div>

  <script>
    let currentFilter = 'all';
    let currentModule = 'all';
    let searchQuery = '';

    function toggleCard(cardId) {
      const card = document.querySelector(\`.test-card[data-id="\${cardId}"]\`);
      if (card) {
        card.classList.toggle('open');
      }
    }

    function applyStatusFilter(status) {
      currentFilter = status;
      document.querySelectorAll('.filter-pills .pill-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === status);
      });
      refreshFilteredList();
    }

    function filterByModule(moduleKey) {
      currentModule = moduleKey;
      document.querySelectorAll('.sidebar .nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.nav === 'module_' + moduleKey);
      });
      document.getElementById('viewHeading').innerText = 'Module Filter: ' + moduleKey.toUpperCase();
      refreshFilteredList();
    }

    function navigateView(viewName) {
      document.querySelectorAll('.sidebar .nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.nav === viewName);
      });

      if (viewName === 'overview') {
        currentModule = 'all';
        currentFilter = 'all';
        applyStatusFilter('all');
        document.getElementById('viewHeading').innerText = 'Execution Dashboard';
      } else if (viewName === 'failures') {
        currentModule = 'all';
        applyStatusFilter('failed');
        document.getElementById('viewHeading').innerText = 'Failures Hub';
      } else if (viewName === 'gallery') {
        currentModule = 'all';
        document.getElementById('viewHeading').innerText = 'Evidence & Screenshots Gallery';
        // Expand all cards that have screenshots
        document.querySelectorAll('.test-card').forEach(card => {
          const hasImg = card.querySelector('.screenshot-thumb');
          if (hasImg) {
            card.classList.add('open');
            card.style.display = 'block';
          } else {
            card.style.display = 'none';
          }
        });
        return;
      }
      refreshFilteredList();
    }

    function onSearchChange(val) {
      searchQuery = (val || '').toLowerCase().trim();
      refreshFilteredList();
    }

    function refreshFilteredList() {
      const cards = document.querySelectorAll('.test-card');
      let visibleCount = 0;

      cards.forEach(card => {
        const cardStatus = card.dataset.status;
        const cardModule = card.dataset.module;
        const cardTitle = card.dataset.title;

        const matchStatus = (currentFilter === 'all') || (cardStatus === currentFilter);
        const matchModule = (currentModule === 'all') || (cardModule === currentModule);
        const matchSearch = (!searchQuery) || (cardTitle.includes(searchQuery));

        if (matchStatus && matchModule && matchSearch) {
          card.style.display = 'block';
          visibleCount++;
        } else {
          card.style.display = 'none';
        }
      });

      const indicator = document.getElementById('testCountIndicator');
      if (indicator) {
        indicator.innerText = \`(\${visibleCount} items displayed)\`;
      }
    }

    function openLightbox(src) {
      const lb = document.getElementById('lightbox');
      const img = document.getElementById('lightboxImg');
      img.src = src;
      lb.classList.add('open');
    }

    function closeLightbox() {
      document.getElementById('lightbox').classList.remove('open');
    }

    // Keyboard shortcut '/' to search
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== document.getElementById('sidebarSearch')) {
        e.preventDefault();
        document.getElementById('sidebarSearch').focus();
      } else if (e.key === 'Escape') {
        closeLightbox();
      }
    });
  </script>
</body>
</html>
`;

  // Write report to playwright-report/index.html
  const outputDir = path.dirname(outputHtmlPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputHtmlPath, htmlReport, 'utf-8');
  console.log(`[ElegantReport] Report successfully generated at: ${outputHtmlPath} (${(htmlReport.length / 1024).toFixed(1)} KB)`);

  // Also write a copy to test-results/elegant-report.html
  const copyPath = path.resolve(process.cwd(), 'test-results/elegant-report.html');
  try {
    fs.writeFileSync(copyPath, htmlReport, 'utf-8');
    console.log(`[ElegantReport] Secondary copy saved to: ${copyPath}`);
  } catch (e) {
    // ignore
  }
}

// Auto-run if executed directly
if (require.main === module) {
  generateElegantReport();
}
