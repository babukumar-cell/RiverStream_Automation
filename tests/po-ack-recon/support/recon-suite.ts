import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, Locator, TestInfo } from '@playwright/test';
import { PoAckReconPage, ReconDocument } from '../../../src/pages/po-ack-recon.page';
import { uniqueName } from '../../../src/test-data/qa-data';

/*
 * Data the suite creates for itself, once per test run (shared by all tests of the run, and by retries):
 *   - one project (created by TC_RECON_030),
 *   - three uploads into it: a PO + ACK pair, a PO without ACK, and a PO with two ACKs.
 * Tests that change data (edit, Complete) only touch these documents, never the reference projects.
 */

export const CRI_DIR = path.resolve(__dirname, '../../../Test Cases/PO ACK files/CRI Files');

export const UPLOADS = {
  /** Matching PO + ACK: Pending Review, review page, edits, Complete */
  pair: { po: 'SIT-53758-113541-DIRO.pdf', acks: ['53758-113541-SIT-ACKS.pdf'], poNumber: '53758-113541' },
  /** PO without ACK: Awaiting ACK, "ACK yet to add" */
  poOnly: { po: 'KI-55294-113650-DIRO.pdf', acks: [] as string[], poNumber: '55294-113650' },
  /** PO with two ACK files: "2 versions", ACK dropdown */
  multi: { po: 'DURSEA-53758-113547-DIRO.pdf', acks: ['53758-113547-DURSEA-ACKS.pdf', '53758-113541-SIT-ACKS.pdf'], poNumber: '53758-113547' },
  /** PO + ACK pair that the dashboard test TC_RECON_013 marks as reviewed (Complete) */
  review: { po: 'KWALU-53758-113545-DIRO.pdf', acks: ['53758-113545-KWALU-ACKS.pdf'], poNumber: '53758-113545' },
  /** PO + ACK pair uploaded by the dashboard test TC_RECON_014 (POs / ACKs counts) */
  counts: { po: 'SPATAB-53758-113546-DIRO.pdf', acks: ['53758-113546-SPATAB-ACKS.pdf'], poNumber: '53758-113546' },
} as const;
export type UploadKey = keyof typeof UPLOADS;

/** Recon processing usually takes 1-3 minutes per upload. */
export const PROCESSING_TIMEOUT_MS = 8 * 60_000;

interface SuiteState {
  projectName?: string;
  projectId?: string;
  uploaded: Partial<Record<UploadKey, { at: string; files: string[] }>>;
}

const stateFile = () => path.join(os.tmpdir(), `riverstream-recon-suite-${process.env.RS_RUN_ID ?? process.ppid}.json`);

export function readState(): SuiteState {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as SuiteState;
  } catch {
    return { uploaded: {} };
  }
}

function writeState(update: (s: SuiteState) => void): SuiteState {
  const s = readState();
  update(s);
  fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2));
  return s;
}

export function newProjectName(): string {
  return uniqueName('Recon');
}

export function recordProject(name: string, id: string): void {
  writeState((s) => {
    // Upload records belong to a project: a new suite project starts without uploads
    if (s.projectId && s.projectId !== id) s.uploaded = {};
    s.projectName = name;
    s.projectId = id;
  });
}

/** The suite's project for this run (created here if TC_RECON_030 has not run yet). */
export async function ensureProject(recon: PoAckReconPage): Promise<{ name: string; id: string }> {
  const s = readState();
  if (s.projectId && s.projectName) return { name: s.projectName, id: s.projectId };
  await recon.navigate();
  const name = newProjectName();
  const id = await recon.createProject(name, 'Miami, FL', 'Created by the automated PO-ACK Recon suite');
  recordProject(name, id);
  return { name, id };
}

/** Unique copies of the CRI sample files (RiverStream rejects a file name it has already received). */
export function uniqueCopies(key: UploadKey, testInfo: TestInfo): { po: string; acks: string[] } {
  const copy = (file: string, label: string) => {
    const target = testInfo.outputPath(`${uniqueName(label)}_${file}`);
    fs.copyFileSync(path.join(CRI_DIR, file), target);
    return target;
  };
  const u = UPLOADS[key];
  return { po: copy(u.po, 'PO'), acks: u.acks.map((a, i) => copy(a, `ACK${i + 1}`)) };
}

export function isUploaded(key: UploadKey): boolean {
  return !!readState().uploaded[key];
}

export function recordUpload(key: UploadKey, files: string[]): void {
  writeState((s) => {
    s.uploaded[key] = { at: new Date().toISOString(), files: files.map((f) => path.basename(f)) };
  });
}

/** Forgets an upload so the next ensureUploaded() uploads a fresh copy (e.g. after the document was completed). */
export function forgetUpload(key: UploadKey): void {
  writeState((s) => {
    delete s.uploaded[key];
  });
}

/** Uploads `key` into the suite project unless this run already did (used by tests that only need the data). */
export async function ensureUploaded(recon: PoAckReconPage, key: UploadKey, testInfo: TestInfo): Promise<void> {
  const { id } = await ensureProject(recon);
  if (isUploaded(key)) return;
  await recon.openProjectById(id);
  const files = uniqueCopies(key, testInfo);
  await recon.openUploadModal();
  await recon.attachFiles(files.po, files.acks);
  const response = await recon.submitUpload();
  expect(response.status(), 'recon upload accepted').toBeLessThan(300);
  recordUpload(key, [files.po, ...files.acks]);
}

/**
 * Reloads the suite project until the uploaded document `key` has finished processing, then returns its row
 * (and API record). `done` decides when processing is finished, from the UI status text.
 */
export async function waitForProcessed(
  recon: PoAckReconPage,
  key: UploadKey,
  // With ACK files, "Awaiting ACK" is only a stage while the ACK is still being processed
  done: (status: string) => boolean = (s) => !!s && !(UPLOADS[key].acks.length ? /^(Processing|Awaiting ACK)$/i : /^Processing$/i).test(s),
): Promise<{ row: Locator; doc: ReconDocument; status: string }> {
  const { id } = await ensureProject(recon);
  const poNumber = UPLOADS[key].poNumber;
  // The project can hold several copies of the same PO (re-uploads), so find this run's copy by its unique file name
  const uploadedPo = readState().uploaded[key]?.files[0];
  let doc: ReconDocument | undefined;
  let row: Locator = recon.docRow(poNumber).first();
  let status = '';
  await expect(async () => {
    const list = await recon.openProjectById(id);
    const index = list.documents.findIndex((d) =>
      uploadedPo ? d.fileName === uploadedPo : d.po_number.startsWith(poNumber) || d.fileName.includes(UPLOADS[key].po),
    );
    expect(index, `${uploadedPo ?? poNumber} is listed in the suite project`).toBeGreaterThanOrEqual(0);
    doc = list.documents[index];
    // Rows are rendered in the order of the API list
    row = recon.rows.nth(index);
    await expect(row).toContainText(doc.po_number.trim());
    status = (await recon.statusCell(row).innerText()).trim();
    expect(done(status), `${poNumber} finished processing (status "${status}")`).toBe(true);
  }).toPass({ timeout: PROCESSING_TIMEOUT_MS, intervals: [10_000, 15_000, 20_000] });
  return { row, doc: doc!, status };
}

/** Opens the review page of the suite's uploaded document `key` (uploading and waiting as needed). */
export async function openSuiteReview(recon: PoAckReconPage, key: UploadKey, testInfo: TestInfo): Promise<void> {
  await ensureUploaded(recon, key, testInfo);
  const { row } = await waitForProcessed(recon, key);
  await recon.openReview(row);
}

/** Reference projects that already hold documents in various statuses (read-only use). */
export const REFERENCE_PROJECTS = ['AUTO_ReconExplore_202610211911', 'ABC Manufacturing', 'Tech_Soluton', 'CKNS Enterprise'];
