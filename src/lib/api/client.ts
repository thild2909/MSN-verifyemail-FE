/**
 * App data client — the ONLY place the UI reads data from.
 *
 * LIVE (server-backed): verification (`/api/v1/verify`), lists, list records,
 * bulk verification jobs, deep scan, and credits are all handled by the
 * Next.js server backend (`src/server/*` + `/api/v1/*` route handlers),
 * which delegates actual email checking to the Rust `check-if-email-exists`
 * engine. Finder/analytics/api-keys/integrations/team remain seed data.
 */
import { sleep } from "../utils";
import {
  MOCK_API_KEYS,
  MOCK_WEBHOOKS,
  MOCK_WEBHOOK_DELIVERIES,
  MOCK_INTEGRATIONS,
  MOCK_TEAM,
  MOCK_DOMAIN_STATS,
  MOCK_FINDER_SEARCHES,
  buildAnalytics,
} from "../mock/data";
import type {
  AnalyticsPoint,
  ApiKey,
  CreditBalance,
  CreditTransaction,
  DomainStat,
  BulkFinderResponse,
  EmailList,
  EmailRecord,
  EnrichmentTable,
  EnrichRow,
  EnrichColumnKind,
  EnrichRecordType,
  FinderOutcome,
  FinderResult,
  Integration,
  TeamMember,
  VerificationResult,
  Webhook,
  WebhookDelivery,
} from "../types";
import { statusBucket } from "../mock/verification-engine";
import { seededRandom } from "../utils";
import { cleanDomain } from "../finder/patterns";
import type {
  ProxyConfig,
  ProxyType,
  RotationStrategy,
  CompanyCollectJob,
  CollectedCompany,
} from "../leads/collect-types";

/* --------------------------- Verification -------------------------- */

export interface VerifyResponse {
  result: VerificationResult;
  provider: "reacher" | "mock";
  warning?: string;
}

/** Live verification through the backend proxy. Throws on API errors. */
export async function verifyEmail(email: string): Promise<VerifyResponse> {
  const res = await fetch("/api/v1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error?.message ?? "Verification failed.");
  }
  return { result: json.data, provider: json.provider, warning: json.warning };
}

/** Backward-compatible wrapper used across the app. */
export async function verifySingleEmail(
  email: string,
  _opts?: { deepScan?: boolean },
): Promise<VerificationResult> {
  return (await verifyEmail(email)).result;
}

/** Is the verification backend reachable? Used for the live status badge. */
export async function getBackendHealth(): Promise<{ online: boolean; url: string }> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    return await res.json();
  } catch {
    return { online: false, url: "" };
  }
}

/* ------------------------- server-backed API ----------------------- */

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Request failed", res.status, json.error);
  return json.data as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<{ data: T; raw: any }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Request failed", res.status, json.error);
  return { data: json.data as T, raw: json };
}

/* ------------------------------ Lists ------------------------------ */

export async function getLists(): Promise<EmailList[]> {
  return apiGet<EmailList[]>("/api/v1/lists");
}

export async function getList(id: string): Promise<EmailList | undefined> {
  try {
    return await apiGet<EmailList>(`/api/v1/lists/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}

export interface RecordsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string; // "all" | bucket | specific status
}

export interface RecordsPage {
  records: EmailRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getListRecords(listId: string, query: RecordsQuery = {}): Promise<RecordsPage> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.status) params.set("status", query.status);
  return apiGet<RecordsPage>(`/api/v1/lists/${listId}/records?${params.toString()}`);
}

export interface CreateListContact {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  custom?: Record<string, string>;
}

export interface CreateListInput {
  name: string;
  fileName: string;
  columns: string[];
  emailColumn: string;
  contacts: CreateListContact[];
}

/** Create a list on the server; it kicks off a background verification job. */
export async function createList(input: CreateListInput): Promise<{ list: EmailList; truncated: number }> {
  const { data, raw } = await apiPost<EmailList>("/api/v1/lists", input);
  return { list: data, truncated: raw.truncated ?? 0 };
}

/** Deep scan one record on the server (re-verifies + charges credits). */
export async function deepScanRecord(record: EmailRecord): Promise<VerificationResult> {
  const { data } = await apiPost<VerificationResult>(
    `/api/v1/lists/${record.listId}/deep-scan`,
    { recordId: record.id },
  );
  return data;
}

export async function deleteList(id: string): Promise<void> {
  const res = await fetch(`/api/v1/lists/${id}`, { method: "DELETE" });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Delete failed", res.status);
}

export async function renameList(id: string, name: string): Promise<EmailList> {
  const res = await fetch(`/api/v1/lists/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Rename failed", res.status);
  return json.data as EmailList;
}

/** Re-queue a list for verification on the server (charges credits). */
export async function reprocessList(id: string): Promise<EmailList> {
  const { data } = await apiPost<EmailList>(`/api/v1/lists/${id}/reprocess`, {});
  return data;
}

/** URL for the server-generated export (download via an anchor). */
export function listExportUrl(id: string, format: "csv" | "xlsx", filter = "all"): string {
  return `/api/v1/lists/${id}/export?${new URLSearchParams({ format, filter }).toString()}`;
}

export interface BulkCounts {
  valid: number;
  invalid: number;
  risky: number;
  unknown: number;
}
export interface BulkProgress {
  done: number;
  total: number;
  counts: BulkCounts;
}

/**
 * Verify many emails through the live proxy with a bounded worker pool,
 * reporting progress + running counts after each result. Real SMTP checks
 * are slow, so callers should cap the batch size for interactive use.
 */
export async function verifyEmailsBulk(
  emails: string[],
  opts: { concurrency?: number; onProgress?: (p: BulkProgress) => void; signal?: AbortSignal } = {},
): Promise<VerificationResult[]> {
  const { concurrency = 5, onProgress, signal } = opts;
  const results: VerificationResult[] = new Array(emails.length);
  const counts: BulkCounts = { valid: 0, invalid: 0, risky: 0, unknown: 0 };
  let done = 0;
  let next = 0;

  async function worker() {
    while (next < emails.length) {
      if (signal?.aborted) return;
      const i = next++;
      try {
        const { result } = await verifyEmail(emails[i]);
        results[i] = result;
        counts[statusBucket(result.status)]++;
      } catch {
        counts.unknown++;
      }
      done++;
      onProgress?.({ done, total: emails.length, counts: { ...counts } });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, emails.length) }, () => worker()),
  );
  return results;
}

/* ------------------------------ Credits ---------------------------- */

export async function getCredits(): Promise<CreditBalance> {
  return apiGet<CreditBalance>("/api/v1/credits");
}

export async function getTransactions(): Promise<CreditTransaction[]> {
  return apiGet<CreditTransaction[]>("/api/v1/credits/transactions");
}

/* ------------------------------ Finder ----------------------------- */

const FINDER_TITLES = ["CEO", "CTO", "COO", "VP Sales", "Head of Marketing", "Engineering Lead"];

/**
 * Find one person's email through the server-side finder pipeline (a single
 * request): the server generates candidates, verifies them with early-exit, and
 * uses a per-domain fact cache so repeat lookups on the same company are nearly
 * free. Returns the single winning address plus how the answer was reached.
 */
export async function findPersonEmail(input: {
  firstName: string;
  lastName: string;
  domain: string;
}): Promise<FinderOutcome> {
  const { data } = await apiPost<FinderOutcome>("/api/v1/finder", input);
  return data;
}

/**
 * Find emails for many people in one request (bulk finder). The server runs the
 * finder for each person with a shared domain + per-email cache, so people at
 * the same company cost far fewer backend calls. Returns per-person outcomes
 * plus resource-savings stats.
 */
export async function findEmailsBulk(
  people: { firstName: string; lastName: string; domain: string }[],
): Promise<BulkFinderResponse> {
  const { data } = await apiPost<BulkFinderResponse>("/api/v1/finder/bulk", { people });
  return data;
}

/**
 * Discover likely contacts at a company, resolving each through the same
 * server finder pipeline as the single/bulk finders (shared domain + email
 * cache, early-exit, confidence threshold). Each row carries its own verdict
 * `state`, so the UI reports verified / unverified / not-found identically.
 */
export async function findEmailsByDomain(domainInput: string): Promise<FinderResult[]> {
  const d = cleanDomain(domainInput);
  const roster: [string, string][] = [
    ["John", "Smith"], ["Sarah", "Lee"], ["David", "Wong"], ["Emily", "Brown"],
    ["Michael", "Chen"], ["Laura", "Davis"], ["James", "Wilson"], ["Anna", "Patel"],
  ];

  const { results } = await findEmailsBulk(roster.map(([firstName, lastName]) => ({ firstName, lastName, domain: d })));

  return results.map((r, i) => ({
    ...r.outcome.result,
    id: `df_${i}`,
    name: `${roster[i][0]} ${roster[i][1]}`,
    jobTitle: FINDER_TITLES[Math.floor(seededRandom(r.outcome.result.email) * FINDER_TITLES.length)],
    state: r.outcome.state,
  }));
}

export async function getFinderSearches() {
  await sleep(200);
  return MOCK_FINDER_SEARCHES;
}

/* --------------------- Enrichment tables (Clay-style) -------------------- */

export async function getEnrichTables(): Promise<EnrichmentTable[]> {
  return apiGet<EnrichmentTable[]>("/api/v1/enrich");
}

export async function getEnrichTable(id: string): Promise<EnrichmentTable | undefined> {
  try {
    return await apiGet<EnrichmentTable>(`/api/v1/enrich/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}

export interface CreateEnrichInput {
  name: string;
  fileName: string;
  recordType: EnrichRecordType;
  importedColumns: string[];
  identityColumns: string[];
  rows: Record<string, string>[];
  columns: EnrichColumnKind[];
}

/** Create an enrichment table; it kicks off the background enrichment run. */
export async function createEnrichTable(input: CreateEnrichInput): Promise<{ table: EnrichmentTable; truncated: number }> {
  const { data, raw } = await apiPost<EnrichmentTable>("/api/v1/enrich", input);
  return { table: data, truncated: raw.truncated ?? 0 };
}

export interface RowsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  filter?: string; // "all" | "has_email" | "no_email" | "enriched" | "pending"
}

export interface RowsPage {
  rows: EnrichRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getEnrichRows(id: string, query: RowsQuery = {}): Promise<RowsPage> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.filter) params.set("filter", query.filter);
  return apiGet<RowsPage>(`/api/v1/enrich/${id}/rows?${params.toString()}`);
}

export async function addEnrichColumn(id: string, kind: EnrichColumnKind): Promise<EnrichmentTable> {
  const { data } = await apiPost<EnrichmentTable>(`/api/v1/enrich/${id}/columns`, { kind });
  return data;
}

export async function removeEnrichColumn(id: string, colId: string): Promise<EnrichmentTable> {
  const res = await fetch(`/api/v1/enrich/${id}/columns?colId=${encodeURIComponent(colId)}`, { method: "DELETE" });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Remove failed", res.status);
  return json.data as EnrichmentTable;
}

export async function renameEnrichTable(id: string, name: string): Promise<EnrichmentTable> {
  const res = await fetch(`/api/v1/enrich/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
  });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Rename failed", res.status);
  return json.data as EnrichmentTable;
}

export async function deleteEnrichTable(id: string): Promise<void> {
  const res = await fetch(`/api/v1/enrich/${id}`, { method: "DELETE" });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Delete failed", res.status);
}

export async function runEnrichTable(id: string): Promise<EnrichmentTable> {
  const { data } = await apiPost<EnrichmentTable>(`/api/v1/enrich/${id}/run`, {});
  return data;
}

/** URL for the server-generated export (download via an anchor). */
export function enrichExportUrl(id: string, format: "csv" | "xlsx"): string {
  return `/api/v1/enrich/${id}/export?${new URLSearchParams({ format }).toString()}`;
}

/** Loop-closer: create a Verification List from a table's discovered emails. */
export async function pushEnrichToVerification(id: string): Promise<{ listId: string; count: number }> {
  const { data } = await apiPost<{ listId: string; count: number }>(`/api/v1/enrich/${id}/push-to-verification`, {});
  return data;
}

/* ---------------- Company collection + proxy config ---------------- */

export async function getProxyConfig(): Promise<ProxyConfig> {
  return apiGet<ProxyConfig>("/api/v1/proxies");
}

export interface ProxyEntryInput {
  id?: string;
  label: string;
  host: string;
  port: number;
  type: ProxyType;
  username?: string;
  password?: string;
  country?: string;
  enabled: boolean;
}
export interface ProxyConfigInput {
  enabled: boolean;
  rotation: RotationStrategy;
  concurrency: number;
  delayMs: number;
  backoffMs: number;
  maxRetries: number;
  proxies: ProxyEntryInput[];
}

export async function setProxyConfig(cfg: ProxyConfigInput): Promise<ProxyConfig> {
  const res = await fetch("/api/v1/proxies", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Save failed", res.status);
  return json.data as ProxyConfig;
}

export async function testProxies(id?: string): Promise<ProxyConfig> {
  const { data } = await apiPost<ProxyConfig>("/api/v1/proxies/test", id ? { id } : {});
  return data;
}

export async function getCollectJobs(): Promise<CompanyCollectJob[]> {
  return apiGet<CompanyCollectJob[]>("/api/v1/leads/collect");
}

export async function getCollectJob(id: string): Promise<CompanyCollectJob | undefined> {
  try {
    return await apiGet<CompanyCollectJob>(`/api/v1/leads/collect/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}

export interface CreateCollectInput {
  name: string;
  fileName: string;
  rows: { company: string; location: string }[];
}
export async function createCollectJob(input: CreateCollectInput): Promise<{ job: CompanyCollectJob; truncated: number }> {
  const { data, raw } = await apiPost<CompanyCollectJob>("/api/v1/leads/collect", input);
  return { job: data, truncated: raw.truncated ?? 0 };
}

export async function deleteCollectJob(id: string): Promise<void> {
  const res = await fetch(`/api/v1/leads/collect/${id}`, { method: "DELETE" });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Delete failed", res.status);
}

export interface CollectCompaniesQuery { page?: number; pageSize?: number; search?: string; filter?: string }
export interface CollectCompaniesPage { companies: CollectedCompany[]; total: number; page: number; pageSize: number }

export async function getCollectedCompanies(id: string, query: CollectCompaniesQuery = {}): Promise<CollectCompaniesPage> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.filter) params.set("filter", query.filter);
  return apiGet<CollectCompaniesPage>(`/api/v1/leads/collect/${id}/companies?${params.toString()}`);
}

/* --------------------------- API / webhooks ------------------------ */

export async function getApiKeys(): Promise<ApiKey[]> {
  await sleep(200);
  return MOCK_API_KEYS;
}

export async function getWebhooks(): Promise<Webhook[]> {
  await sleep(200);
  return MOCK_WEBHOOKS;
}

export async function getWebhookDeliveries(): Promise<WebhookDelivery[]> {
  await sleep(200);
  return MOCK_WEBHOOK_DELIVERIES;
}

/* ------------------------ Integrations / team ---------------------- */

export async function getIntegrations(): Promise<Integration[]> {
  await sleep(200);
  return MOCK_INTEGRATIONS;
}

export async function getTeam(): Promise<TeamMember[]> {
  await sleep(200);
  return MOCK_TEAM;
}

/* ----------------------------- Analytics --------------------------- */

export async function getAnalytics(days: number): Promise<AnalyticsPoint[]> {
  await sleep(300);
  return buildAnalytics(days);
}

export async function getDomainStats(): Promise<DomainStat[]> {
  await sleep(200);
  return MOCK_DOMAIN_STATS;
}
