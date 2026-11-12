import { Page, Locator, Response, expect } from '@playwright/test';
import { BasePage } from './base.page';

/** One recon project as returned by POST /api/listReconProjects */
export interface ReconProject {
  _id: string;
  projectName: string;
  location?: string;
  createdAt: string;
  orgId?: string;
  organizationName: string;
}

/** One recon document as returned by POST /api/listReconDocuments */
export interface ReconDocument {
  _id: string;
  fileName: string;
  po_number: string;
  version_count: number;
  status: string;
  createdDate: string;
  updatedDate: string;
  /** Set on the dashboard card lists (listReconDocumentsByCategory) */
  projectName?: string;
  organizationName?: string;
}

export interface ReconDocumentsPage {
  request: { projectId: string; startIndex: number; search_text: string | null; [k: string]: unknown };
  documents: ReconDocument[];
  availableStatuses: string[];
  projectName: string;
  hasMore: boolean;
}

/** Status filter buttons on a project's document list (shown only for statuses the project contains). */
export type ReconStatusLabel = 'Awaiting ACK' | 'Pending Review' | 'Matched' | 'Medium' | 'Critical' | 'Minor' | 'Failed';

/**
 * PO-ACK Recon: projects list (/po-ack-recon), a project's document list (/po-ack-recon/<projectId>),
 * the Upload Documents modal and the recon review page (/po-ack-recon/review/<docId>).
 */
export class PoAckReconPage extends BasePage {
  // ---- Projects list
  readonly pageTitle: Locator;
  readonly projectsHeader: Locator;
  readonly searchInput: Locator;
  readonly newProjectButton: Locator;
  readonly table: Locator;
  readonly tableHeaders: Locator;
  readonly rows: Locator;
  readonly noProjectsMessage: Locator;

  // ---- New Project modal
  readonly dialog: Locator;
  readonly dialogTitle: Locator;
  readonly projectNameInput: Locator;
  readonly projectDescriptionInput: Locator;
  readonly projectLocationInput: Locator;
  readonly createProjectButton: Locator;
  readonly cancelProjectButton: Locator;
  readonly closeDialogButton: Locator;

  // ---- Breadcrumbs
  readonly breadcrumbs: Locator;
  readonly breadcrumbReconLink: Locator;

  // ---- Project document list
  readonly docSearchInput: Locator;
  readonly uploadDocsButton: Locator;

  // ---- Upload Documents modal
  readonly uploadModal: Locator;
  readonly uploadFileInputs: Locator;
  readonly addAnotherAckButton: Locator;
  readonly cancelUploadButton: Locator;
  readonly uploadFilesButton: Locator;
  readonly closeUploadModalButton: Locator;

  // ---- Review page
  readonly showPdfsButton: Locator;
  readonly hidePdfsButton: Locator;
  readonly completeButton: Locator;
  readonly discrepancySummary: Locator;
  readonly emailPreviewButton: Locator;
  readonly severitySelector: Locator;
  readonly ackSelector: Locator;
  readonly poDataCard: Locator;
  readonly ackDataCard: Locator;
  readonly sourceDocuments: Locator;
  readonly previewModal: Locator;

  constructor(page: Page) {
    super(page);

    this.pageTitle = page.getByRole('heading', { level: 1, name: 'PO-ACK Recon' });
    this.projectsHeader = page.getByRole('heading', { name: 'Projects', exact: true });
    this.searchInput = page.getByPlaceholder('Search projects...');
    this.newProjectButton = page.getByRole('button', { name: 'New Project' });
    this.table = page.locator('main table').first();
    this.tableHeaders = this.table.locator('thead th');
    this.rows = this.table.locator('tbody tr');
    this.noProjectsMessage = page.getByText('No PO-ACK Recon projects found.');

    this.dialog = page.getByRole('dialog');
    this.dialogTitle = this.dialog.getByRole('heading').first();
    this.projectNameInput = this.dialog.getByPlaceholder('Enter project name...');
    this.projectDescriptionInput = this.dialog.getByPlaceholder('Enter description...');
    this.projectLocationInput = this.dialog.getByPlaceholder('Enter location...');
    this.createProjectButton = this.dialog.getByRole('button', { name: 'Create', exact: true });
    this.cancelProjectButton = this.dialog.getByRole('button', { name: 'Cancel', exact: true });
    this.closeDialogButton = this.dialog.getByRole('button', { name: 'Close', exact: true });

    this.breadcrumbs = page.locator('[data-slot="breadcrumb-list"]');
    this.breadcrumbReconLink = this.breadcrumbs.getByRole('button', { name: 'PO-ACK Recon', exact: true })
      .or(this.breadcrumbs.getByRole('link', { name: 'PO-ACK Recon', exact: true }));

    this.docSearchInput = page.getByPlaceholder(/Search PO number/i);
    this.uploadDocsButton = page.getByRole('button', { name: /Upload Documents/ }).first();

    this.uploadModal = page.getByRole('dialog').filter({ hasText: 'Upload Documents' });
    this.uploadFileInputs = this.uploadModal.locator('input[type="file"]');
    this.addAnotherAckButton = this.uploadModal.getByRole('button', { name: /Add another file/ });
    this.cancelUploadButton = this.uploadModal.getByRole('button', { name: 'Cancel', exact: true });
    this.uploadFilesButton = this.uploadModal.getByRole('button', { name: 'Upload Files', exact: true });
    this.closeUploadModalButton = this.uploadModal.getByRole('button', { name: 'Close', exact: true });

    this.showPdfsButton = page.getByRole('button', { name: 'Show PDFs' });
    this.hidePdfsButton = page.getByRole('button', { name: 'Hide PDFs' });
    this.completeButton = page.getByRole('button', { name: 'Complete', exact: true });
    this.discrepancySummary = page.getByText(/\d+ discrepanc(y|ies) against PO/);
    this.emailPreviewButton = page.getByRole('button', { name: /Email Preview/ });
    this.severitySelector = page.getByRole('button', { name: 'Select discrepancies by severity' });
    this.ackSelector = page.getByRole('button', { name: 'Select ACK' }).first();
    this.poDataCard = page.locator('main div').filter({ has: page.getByText('PO Data', { exact: true }) }).filter({ has: page.getByText('Header & Address Fields') }).last();
    this.ackDataCard = page.locator('main div').filter({ has: page.getByText(/^ACK \d+ Data$/) }).filter({ has: page.getByText('Header & Address Fields') }).last();
    this.sourceDocuments = page.getByText(/^source documents$/i);
    this.previewModal = page.locator('div.fixed.inset-0').filter({ hasText: 'Preview Selected Fields' });
  }

  // =========================================================================
  // API responses
  // =========================================================================

  static isProjectsList = (r: Response) => r.url().includes('/api/listReconProjects') && r.request().method() === 'POST';
  static isDocumentsList = (r: Response) => r.url().includes('/api/listReconDocuments') && r.request().method() === 'POST';

  async waitForProjectsResponse(predicate: (req: { search_text: string | null; startIndex: number }) => boolean = () => true): Promise<ReconProject[]> {
    const r = await this.page.waitForResponse((res) => PoAckReconPage.isProjectsList(res) && predicate(res.request().postDataJSON() ?? {}), { timeout: 30000 });
    expect(r.status(), 'listReconProjects HTTP status').toBe(200);
    return (await r.json()).projects.entities as ReconProject[];
  }

  async waitForDocumentsResponse(predicate: (req: ReconDocumentsPage['request']) => boolean = () => true): Promise<ReconDocumentsPage> {
    // Read the body inside the predicate: when the page re-requests the list, the first response body is discarded
    let body: { documents: any } | undefined;
    const r = await this.page.waitForResponse(
      async (res) => {
        if (!PoAckReconPage.isDocumentsList(res) || !predicate(res.request().postDataJSON() ?? {})) return false;
        try {
          body = await res.json();
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 30000 },
    );
    expect(r.status(), 'listReconDocuments HTTP status').toBe(200);
    const d = body!.documents;
    return { request: r.request().postDataJSON(), documents: d.entities, availableStatuses: d.availableStatuses ?? [], projectName: d.projectName, hasMore: d.hasMore };
  }

  // =========================================================================
  // Projects list
  // =========================================================================

  /** Opens /po-ack-recon and returns the first page of projects. */
  async navigate(): Promise<ReconProject[]> {
    const list = this.waitForProjectsResponse((req) => !req.search_text && req.startIndex === 0);
    await this.navigateTo('/po-ack-recon');
    const projects = await list;
    await this.waitForProjectsPageLoaded();
    return projects;
  }

  /** Projects page fully loaded: the project rows and every card count (cards show "..." while loading). */
  async waitForProjectsPageLoaded(): Promise<void> {
    await this.waitForTableLoaded();
    for (const key of RECON_CARDS) await expect(this.cardCount(key)).toHaveText(/^\d[\d,]*$/, { timeout: 60000 });
  }

  async waitForTableLoaded(): Promise<void> {
    await this.waitForLoaded(30000);
    await expect(this.rows.first()).toBeVisible({ timeout: 30000 });
  }

  /** Types in the project search box and returns the projects the app fetched for it. */
  async searchProject(query: string): Promise<ReconProject[]> {
    const list = this.waitForProjectsResponse((req) => (req.search_text ?? '') === query);
    await this.searchInput.fill(query);
    const projects = await list;
    await this.waitForTableLoaded();
    return projects;
  }

  /** Project-name cell of each rendered row (first line of the first cell). */
  async visibleProjectNames(): Promise<string[]> {
    if (await this.noProjectsMessage.isVisible()) return [];
    return this.rows.evaluateAll((rows) => rows.map((r) => ((r as HTMLTableRowElement).cells[0]?.innerText || '').split('\n')[0].trim()));
  }

  projectRow(name: string): Locator {
    return this.rows.filter({ has: this.page.locator('td').first().getByText(name, { exact: true }) });
  }

  /** Opens a project from the list (searching for it first) and returns its first page of documents. */
  async openProject(name: string): Promise<ReconDocumentsPage> {
    if ((await this.projectRow(name).count()) === 0) await this.searchProject(name);
    const docs = this.waitForDocumentsResponse((req) => req.startIndex === 0 && !req.search_text);
    await this.projectRow(name).first().click();
    await expect(this.page).toHaveURL(/\/po-ack-recon\/[A-Za-z0-9]+$/);
    const result = await docs;
    await this.waitForLoaded(30000);
    return result;
  }

  async openNewProjectModal(): Promise<void> {
    await this.newProjectButton.click();
    await expect(this.dialog).toBeVisible();
  }

  /** Creates a project through the modal; the app then opens the new project. Returns the new project's id. */
  async createProject(name: string, location?: string, description?: string): Promise<string> {
    await this.openNewProjectModal();
    await this.projectNameInput.fill(name);
    if (description) await this.projectDescriptionInput.fill(description);
    if (location) await this.projectLocationInput.fill(location);
    await this.createProjectButton.click();
    await expect(this.dialog).toBeHidden({ timeout: 30000 });
    await expect(this.page).toHaveURL(/\/po-ack-recon\/[A-Za-z0-9]+$/, { timeout: 30000 });
    return this.page.url().split('/').pop()!;
  }

  // =========================================================================
  // Project document list
  // =========================================================================

  /** Opens a project's document list directly by id. */
  async openProjectById(projectId: string): Promise<ReconDocumentsPage> {
    for (let attempt = 1; ; attempt++) {
      try {
        const docs = this.waitForDocumentsResponse((req) => req.projectId === projectId && req.startIndex === 0);
        await this.navigateTo(`/po-ack-recon/${projectId}`);
        const result = await docs;
        await this.waitForLoaded(30000);
        return result;
      } catch (err) {
        // The page can re-request the list while loading, which discards the first response body; load again once.
        if (attempt >= 2) throw err;
      }
    }
  }

  statusFilterButton(label: ReconStatusLabel | 'All'): Locator {
    const name = label === 'Minor' ? /^(Minor|Low)$/ : new RegExp(`^${label}$`);
    return this.page.locator('main').getByRole('button', { name });
  }

  /** Clicks a status filter and returns the documents the app fetched for it. */
  async applyStatusFilter(label: ReconStatusLabel | 'All'): Promise<ReconDocumentsPage> {
    const docs = this.waitForDocumentsResponse((req) => req.startIndex === 0);
    await this.statusFilterButton(label).click();
    const result = await docs;
    await this.waitForLoaded(30000);
    return result;
  }

  /** Row of a document by its PO number. */
  docRow(poNumber: string): Locator {
    return this.rows.filter({ hasText: poNumber });
  }

  /** Status cell (4th column) of a document row. */
  statusCell(row: Locator): Locator {
    return row.locator('td').nth(3);
  }

  /** Status shown for every rendered document row. */
  async visibleStatuses(): Promise<string[]> {
    return this.rows.evaluateAll((rows) =>
      rows.filter((r) => (r as HTMLTableRowElement).cells.length > 3).map((r) => ((r as HTMLTableRowElement).cells[3].innerText || '').trim()),
    );
  }

  async openReview(row: Locator): Promise<void> {
    await row.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(this.page).toHaveURL(/\/po-ack-recon\/review\//);
    await this.waitForReviewLoaded();
  }

  // =========================================================================
  // Upload Documents modal
  // =========================================================================

  async openUploadModal(): Promise<void> {
    await this.uploadDocsButton.click();
    await expect(this.uploadModal).toBeVisible();
  }

  /** Attaches the PO (input 0) and/or ACK files (inputs 1..n; extra ACK dropzones are added as needed). */
  async attachFiles(po?: string, acks: string[] = []): Promise<void> {
    if (po) await this.uploadFileInputs.first().setInputFiles(po);
    for (const [i, ack] of acks.entries()) {
      if ((await this.uploadFileInputs.count()) < i + 2) {
        const before = await this.uploadFileInputs.count();
        await this.addAnotherAckButton.click();
        await expect(this.uploadFileInputs).toHaveCount(before + 1);
      }
      await this.uploadFileInputs.nth(i + 1).setInputFiles(ack);
    }
  }

  /** Clicks Upload Files and waits for the upload request and the modal to close. */
  async submitUpload(): Promise<Response> {
    const upload = this.page.waitForResponse((r) => r.request().method() === 'POST' && /upload/i.test(r.url()), { timeout: 120000 });
    await this.uploadFilesButton.click();
    const response = await upload;
    await expect(this.uploadModal).toBeHidden({ timeout: 60000 });
    return response;
  }

  // =========================================================================
  // Review page
  // =========================================================================

  async waitForReviewLoaded(): Promise<void> {
    await expect(this.page.getByText('PO Data', { exact: true })).toBeVisible({ timeout: 45000 });
    await this.waitForLoaded(30000);
  }

  /** Header/address field box in the PO or ACK card, by its label (e.g. "Po Number", "City"). */
  field(card: Locator, label: string): Locator {
    return card.locator('div.group, div').filter({ has: this.page.locator('p', { hasText: new RegExp(`^${label}$`) }) }).last();
  }

  /** Value text of a header/address field. */
  fieldValue(card: Locator, label: string): Locator {
    return this.field(card, label).locator('p').nth(1);
  }

  /** Discrepancy fields (yellow) on the ACK side. */
  get discrepancyFields(): Locator {
    return this.page.locator('main div.bg-amber-50');
  }

  /** Flag (select-for-email) button of a discrepancy header field, e.g. "Select City". */
  fieldFlag(label: string): Locator {
    return this.page.getByRole('button', { name: `Select ${label}`, exact: true });
  }

  /** Count shown on the Email Preview button (number of selected discrepancy fields). */
  async selectedCount(): Promise<number> {
    const text = (await this.emailPreviewButton.innerText()).replace(/\D+/g, ' ').trim();
    return text ? parseInt(text.split(' ').pop()!, 10) : 0;
  }

  /** Severity checkbox in the open severity selector ("All", "Critical", "Medium", "Low"). */
  severityOption(name: 'All' | 'Critical' | 'Medium' | 'Low'): Locator {
    return this.page.locator('label').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).getByRole('checkbox');
  }

  // =========================================================================
  // Dashboard metrics (cards above the projects list) and Organization filter
  // =========================================================================

  /** Organization filter (combobox next to "Organization:"). */
  get orgFilter(): Locator {
    return this.page.getByText('Organization:', { exact: true }).locator('xpath=..').getByRole('combobox');
  }

  /** Option in the open Organization filter ("All Organizations", "Corpdesign", "Riverstonetech"). */
  orgOption(name: string): Locator {
    return this.page.getByRole('option', { name, exact: true });
  }

  /** The five metric cards (role=tab inside the "Reconciliation status" tablist). */
  get cardList(): Locator {
    return this.page.getByRole('tablist', { name: 'Reconciliation status' });
  }

  card(key: ReconCard): Locator {
    return this.page.locator(`#recon-tab-${key}`);
  }

  /** Title, count and caption of a card. */
  cardTitle(key: ReconCard): Locator {
    return this.card(key).locator('span span').nth(0);
  }

  cardCount(key: ReconCard): Locator {
    return this.card(key).locator('span span').nth(1);
  }

  cardCaption(key: ReconCard): Locator {
    return this.card(key).locator('span span').nth(2);
  }

  /** Heading of the list under the cards ("Projects", "Discrepancy Critical", ...). */
  get listHeading(): Locator {
    return this.page.getByRole('tabpanel').getByRole('heading', { level: 2 });
  }

  get noCategoryDocsMessage(): Locator {
    return this.page.getByText('No PO acknowledgement documents found.');
  }

  get noMoreDocsMessage(): Locator {
    return this.page.getByText('No more documents to load');
  }

  /** Status cell of a row in a card's document list (5th column). */
  categoryStatusCell(row: Locator): Locator {
    return row.locator('td').nth(4);
  }

  static isSummary = (r: Response) => r.url().includes('/api/getReconSummary') && r.request().method() === 'POST';
  static isCategoryList = (r: Response) => r.url().includes('/api/listReconDocumentsByCategory') && r.request().method() === 'POST';

  private apiBase?: string;
  private apiHeaders?: Record<string, string>;

  /** Waits for the app's getReconSummary call (for `org`, null = All Organizations) and remembers its auth for API checks. */
  async waitForSummary(org: string | null = null): Promise<ReconSummary> {
    const r = await this.page.waitForResponse(
      (res) => PoAckReconPage.isSummary(res) && (res.request().postDataJSON()?.organizationName ?? null) === org,
      { timeout: 30000 },
    );
    expect(r.status(), 'getReconSummary HTTP status').toBe(200);
    const headers = await r.request().allHeaders();
    this.apiHeaders = Object.fromEntries(
      Object.entries(headers).filter(([k]) => /^(authorization|content-type|x-[\w-]+)$/i.test(k)),
    );
    this.apiBase = r.url().replace(/getReconSummary.*$/, '');
    return (await r.json()).summary as ReconSummary;
  }

  /** Opens the PO-ACK Recon dashboard (optionally with ?tab= / ?org=) and returns the card counts the app loaded. */
  async openDashboard(opts: { tab?: Exclude<ReconCard, 'projects'>; org?: string } = {}): Promise<ReconSummary> {
    const query = new URLSearchParams();
    if (opts.tab) query.set('tab', opts.tab);
    if (opts.org) query.set('org', opts.org);
    const summary = this.waitForSummary(opts.org ?? null);
    const qs = query.toString();
    await this.navigateTo(`/po-ack-recon${qs ? `?${qs}` : ''}`);
    const result = await summary;
    await expect(this.cardList).toBeVisible({ timeout: 30000 });
    await this.waitForLoaded(30000);
    return result;
  }

  /** Clicks a card; returns the first page of documents (or projects, for Total Projects) the app fetched. */
  async selectCard(key: ReconCard): Promise<ReconDocument[] | ReconProject[]> {
    if (key === 'projects') {
      // The projects list is loaded with the page and not fetched again when the card is clicked
      await this.card(key).click();
      await this.waitForTableLoaded();
      const org = new URL(this.page.url()).searchParams.get('org');
      return (await this.api<{ projects: { entities: ReconProject[] } }>('listReconProjects', { startIndex: 0, search_text: null, organizationName: org })).projects.entities;
    }
    const list = this.page.waitForResponse(
      (r) => PoAckReconPage.isCategoryList(r) && r.request().postDataJSON()?.category === key && r.request().postDataJSON()?.startIndex === 0,
      { timeout: 30000 },
    );
    await this.card(key).click();
    const r = await list;
    expect(r.status(), `list for the ${key} card`).toBe(200);
    const json = await r.json();
    await this.waitForLoaded(30000);
    return json.documents.entities;
  }

  /** Scrolls a card's document list until every page is loaded ("No more documents to load"). */
  async loadAllCategoryRows(): Promise<void> {
    if (await this.noCategoryDocsMessage.isVisible()) return;
    await expect(async () => {
      await this.rows.last().scrollIntoViewIfNeeded();
      await expect(this.noMoreDocsMessage).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 90000 });
  }

  /** Picks an organization in the filter and returns the card counts the app loaded for it. */
  async selectOrganization(name: string, orgName: string | null): Promise<ReconSummary> {
    await this.orgFilter.click();
    await expect(this.orgOption(name)).toBeVisible();
    const summary = this.waitForSummary(orgName);
    await this.orgOption(name).click();
    const result = await summary;
    await this.waitForLoaded(30000);
    return result;
  }

  /** Current card counts as numbers. */
  async cardCounts(): Promise<Record<ReconCard, number>> {
    const out = {} as Record<ReconCard, number>;
    for (const key of RECON_CARDS) out[key] = parseInt((await this.cardCount(key).innerText()).replace(/\D/g, ''), 10);
    return out;
  }

  // ---- Direct API reads (same auth as the page) used to check the cards independently of the UI

  private async api<T>(endpoint: string, data: unknown): Promise<T> {
    expect(this.apiBase, 'dashboard opened before API checks').toBeTruthy();
    const r = await this.page.request.post(this.apiBase + endpoint, { headers: this.apiHeaders, data });
    expect(r.status(), `${endpoint} HTTP status`).toBe(200);
    return (await r.json()) as T;
  }

  async apiSummary(org: string | null = null): Promise<ReconSummary> {
    return (await this.api<{ summary: ReconSummary }>('getReconSummary', { organizationName: org })).summary;
  }

  /** Every project (all pages) for an organization (null = all). */
  async apiAllProjects(org: string | null = null): Promise<ReconProject[]> {
    const all: ReconProject[] = [];
    for (let i = 0; ; i += 10) {
      const p = (await this.api<{ projects: { entities: ReconProject[]; hasMore: boolean } }>('listReconProjects', { startIndex: i, search_text: null, organizationName: org })).projects;
      all.push(...p.entities);
      if (!p.hasMore || p.entities.length === 0) return all;
    }
  }

  /** Every document (all pages) of a card's category for an organization (null = all). */
  async apiCategoryDocs(category: Exclude<ReconCard, 'projects'>, org: string | null = null): Promise<ReconDocument[]> {
    const all: ReconDocument[] = [];
    for (let i = 0; ; i += 10) {
      const d = (await this.api<{ documents: { entities: ReconDocument[]; hasMore: boolean } }>('listReconDocumentsByCategory', { category, startIndex: i, search_text: null, organizationName: org })).documents;
      all.push(...d.entities);
      if (!d.hasMore || d.entities.length === 0) return all;
    }
  }

  /** Every document (all pages) of one project. */
  async apiProjectDocs(projectId: string): Promise<ReconDocument[]> {
    const all: ReconDocument[] = [];
    for (let i = 0; ; i += 10) {
      const d = (await this.api<{ documents: { entities: ReconDocument[]; hasMore: boolean } }>('listReconDocuments', { projectId, startIndex: i, search_text: null })).documents;
      all.push(...d.entities);
      if (!d.hasMore || d.entities.length === 0) return all;
    }
  }

  /** POs (documents) and ACKs (sum of ACK versions) over all documents of the given projects. */
  async apiDocumentTotals(projects: ReconProject[]): Promise<{ pos: number; acks: number }> {
    let pos = 0;
    let acks = 0;
    for (let i = 0; i < projects.length; i += 8) {
      const batch = await Promise.all(projects.slice(i, i + 8).map((p) => this.apiProjectDocs(p._id)));
      for (const docs of batch) {
        pos += docs.length;
        acks += docs.reduce((n, d) => n + (d.version_count || 0), 0);
      }
    }
    return { pos, acks };
  }
}

/** Dashboard cards, by the id suffix of their tab (#recon-tab-<key>) and the ?tab= value they set. */
export type ReconCard = 'projects' | 'critical' | 'reviewed' | 'processing' | 'pending';
export const RECON_CARDS: ReconCard[] = ['projects', 'critical', 'reviewed', 'processing', 'pending'];

/** POST /api/getReconSummary */
export interface ReconSummary {
  totalPOs: number;
  totalAcks: number;
  critical: number;
  reviewed: number;
  processing: number;
  pending: number;
  totalProjects: number;
}
