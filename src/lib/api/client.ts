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
  CompaniesFacets,
} from "../leads/collect-types";
import type {
  CollectedPerson,
  PeopleCollectJob,
  PeopleSeedInput,
  PeopleFacets,
} from "../leads/people-types";
import type {
  CollectedJob,
  JobCollectJob,
  JobSource,
  JobSourceCoverage,
} from "../leads/job-collect-types";

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

/** Reset the credit wallet to unused (remaining = allocation) and clear the ledger. */
export async function resetCredits(): Promise<CreditBalance> {
  const { data } = await apiPost<CreditBalance>("/api/v1/credits/reset", {});
  return data;
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
  rotating?: { enabled: boolean; endpoint?: string };
}

export async function setProxyConfig(cfg: ProxyConfigInput): Promise<ProxyConfig> {
  const res = await fetch("/api/v1/proxies", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Save failed", res.status);
  return json.data as ProxyConfig;
}

export async function testProxies(opts?: { id?: string; all?: boolean; onProgress?: (p: import("@/lib/leads/collect-types").ProxyTestProgress) => void }): Promise<ProxyConfig> {
  const all = opts?.all ?? !opts?.id;
  const { data: started } = await apiPost<ProxyConfig>("/api/v1/proxies/test", opts?.id ? { id: opts.id, all } : { all });
  if (!all || !started.testProgress?.running) return started;

  let cfg = started;
  if (started.testProgress) opts?.onProgress?.(started.testProgress);
  while (cfg.testProgress?.running) {
    await new Promise((r) => setTimeout(r, 1200));
    cfg = await apiGet<ProxyConfig>("/api/v1/proxies/test/status");
    if (cfg.testProgress) opts?.onProgress?.(cfg.testProgress);
  }
  return cfg;
}

export async function getProxyTestStatus(): Promise<ProxyConfig> {
  return apiGet<ProxyConfig>("/api/v1/proxies/test/status");
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

export async function retryFailedCollect(id: string): Promise<{ reset: number; started: boolean }> {
  const res = await fetch(`/api/v1/leads/collect/${id}/retry-failed`, { method: "POST" });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Retry failed", res.status);
  return json.data;
}

export interface VerifyEmailsResult { verified: number; valid: number; found?: number; provider: "reacher" | "mock" | "mixed" | "none" }
/** Verify collected contact emails via the backend. `all` re-checks every email. */
export async function verifyCollectedEmails(id: string, all = false): Promise<VerifyEmailsResult> {
  const { data } = await apiPost<VerifyEmailsResult>(`/api/v1/leads/collect/${id}/verify-emails${all ? "?all=1" : ""}`, {});
  return data;
}

export interface LlmVerifyResult { configured: boolean; checked: number; skipped: number; verified: number; mismatch: number; uncertain: number; corrected?: number; cleared?: number; tokens: number }
/** Company "AI verify": audit fields (checked/…) + knowledge-fill failed/not-found rows (targeted/filled/notFound). */
export interface LlmCompanyResult extends LlmVerifyResult { targeted: number; filled: number; notFound: number }
/** LLM (DeepSeek) audit + knowledge-fill of collected companies. `all` re-runs every row. */
export async function llmVerifyCompanies(id: string, all = false): Promise<LlmCompanyResult> {
  const { data } = await apiPost<LlmCompanyResult>(`/api/v1/leads/collect/${id}/llm-verify${all ? "?all=1" : ""}`, {});
  return data;
}

export interface CollectCompaniesQuery {
  page?: number; pageSize?: number; search?: string;
  company?: string[]; locations?: string[]; employees?: string[]; technologies?: string[];
  status?: string[]; has?: string[]; email?: string[]; industries?: string[];
}
export interface CollectCompaniesPage { companies: CollectedCompany[]; total: number; page: number; pageSize: number; facets: CompaniesFacets }

export async function getCollectedCompanies(id: string, query: CollectCompaniesQuery = {}): Promise<CollectCompaniesPage> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.company?.length) params.set("company", query.company.join(","));
  if (query.locations?.length) params.set("locations", query.locations.join(","));
  if (query.employees?.length) params.set("employees", query.employees.join(","));
  if (query.industries?.length) params.set("industries", query.industries.join(","));
  if (query.technologies?.length) params.set("technologies", query.technologies.join(","));
  if (query.status?.length) params.set("status", query.status.join(","));
  if (query.has?.length) params.set("has", query.has.join(","));
  if (query.email?.length) params.set("email", query.email.join(","));
  return apiGet<CollectCompaniesPage>(`/api/v1/leads/collect/${id}/companies?${params.toString()}`);
}

/* ------------------------------- people ---------------------------------- */

export async function getPeopleJobs(): Promise<PeopleCollectJob[]> {
  return apiGet<PeopleCollectJob[]>("/api/v1/leads/people");
}

export async function getPeopleJob(id: string): Promise<PeopleCollectJob | null> {
  try {
    return await apiGet<PeopleCollectJob>(`/api/v1/leads/people/${id}`);
  } catch (err) {
    // A deleted / unknown job 404s. Return null (NOT undefined) — React Query
    // rejects an undefined queryFn result ("Query data cannot be undefined").
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export type CreatePeopleInput =
  | { name: string; seeds: PeopleSeedInput[] }
  | { name: string; fromCompanyJob: string; companyIds?: string[]; allMatching?: boolean; search?: string; filter?: string };

export async function createPeopleJob(input: CreatePeopleInput): Promise<{ job: PeopleCollectJob; truncated: number }> {
  const { data, raw } = await apiPost<PeopleCollectJob>("/api/v1/leads/people", input);
  return { job: data, truncated: raw.truncated ?? 0 };
}

export async function deletePeopleJob(id: string): Promise<void> {
  const res = await fetch(`/api/v1/leads/people/${id}`, { method: "DELETE" });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Delete failed", res.status);
}

/**
 * Find & verify a people job's emails. Default is incremental: saved verdicts
 * (including Not found) are kept; only unchecked people are looked up.
 * Pass `{ keep: false }` to wipe caches + prior results and re-search everyone.
 */
export async function verifyPeopleEmails(id: string, opts: { keep?: boolean } = {}): Promise<VerifyEmailsResult> {
  const q = opts.keep === false ? "?fresh=1" : "?keep=1";
  const { data } = await apiPost<VerifyEmailsResult>(`/api/v1/leads/people/${id}/verify-emails${q}`, {});
  return data;
}

/** Per-row "Access email": find + verify a SINGLE person's email on demand. */
export interface SinglePersonVerifyResult {
  ok: boolean;
  status: "valid" | "invalid" | "risky" | "unknown" | "disposable" | "catch_all" | "role" | "not_found" | null;
  email: string | null;
  found: boolean;
  valid: boolean;
  provider: "reacher" | "mock" | "none";
}
export async function verifyPersonEmail(jobId: string, personId: string): Promise<SinglePersonVerifyResult> {
  const { data } = await apiPost<SinglePersonVerifyResult>(`/api/v1/leads/people/${jobId}/verify-email`, { personId });
  return data;
}

/** "Retry failed" (People tab): re-crawl coverage-gap companies (0 people found). */
export async function retryPeopleGaps(jobId: string): Promise<{ reset: number; started: boolean }> {
  const { data } = await apiPost<{ reset: number; started: boolean }>(`/api/v1/leads/people/${jobId}/retry-gaps`, {});
  return data;
}

/** People "AI verify": audit weak-signal people (checked/…) + exec-fill the
 *  coverage-gap companies (gapCompanies/proposed/filled/dropped). */
export interface LlmPeopleResult extends LlmVerifyResult { gapCompanies: number; proposed: number; filled: number; dropped: number }
/** LLM (DeepSeek) founder↔company cross-check + exec-fill. `all` re-runs every row. */
export async function llmVerifyPeople(id: string, all = false): Promise<LlmPeopleResult> {
  const { data } = await apiPost<LlmPeopleResult>(`/api/v1/leads/people/${id}/llm-verify${all ? "?all=1" : ""}`, {});
  return data;
}

export interface CollectPeopleQuery {
  page?: number; pageSize?: number; search?: string;
  email?: string[]; titles?: string[]; seniority?: string[]; linkedin?: boolean; funded?: boolean;
  companies?: string[]; locations?: string[]; employees?: string[]; industries?: string[]; minScore?: number;
  sort?: string;
}
export interface CollectPeoplePage {
  people: CollectedPerson[];
  total: number;
  page: number;
  pageSize: number;
  facets: PeopleFacets;
  verifyingPersonIds?: string[];
}

export async function getCollectedPeople(id: string, query: CollectPeopleQuery = {}): Promise<CollectPeoplePage> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.email?.length) params.set("email", query.email.join(","));
  if (query.titles?.length) params.set("titles", query.titles.join(","));
  if (query.seniority?.length) params.set("seniority", query.seniority.join(","));
  if (query.linkedin) params.set("linkedin", "1");
  if (query.funded) params.set("funded", "1");
  if (query.companies?.length) params.set("companies", query.companies.join(","));
  if (query.locations?.length) params.set("locations", query.locations.join(","));
  if (query.employees?.length) params.set("employees", query.employees.join(","));
  if (query.industries?.length) params.set("industries", query.industries.join(","));
  if (query.minScore) params.set("minScore", String(query.minScore));
  if (query.sort) params.set("sort", query.sort);
  return apiGet<CollectPeoplePage>(`/api/v1/leads/people/${id}/people?${params.toString()}`);
}

/* ----------------------------- saved lead lists -------------------------- */

/**
 * Saved lead lists — the persisted side of Find Leads "Save" / "Add to list".
 * These proxy through the Next.js server to BE-service's PostgreSQL, replacing
 * the old localStorage-only store. An item carries a full snapshot (`data`) of
 * the collected person/company plus extracted display columns.
 */
export type LeadKind = "person" | "company";

export interface LeadListSummary {
  total: number;
  people: number;
  companies: number;
}
export interface LeadList {
  id: string;
  name: string;
  isSaved: boolean;
  summary: LeadListSummary;
  createdAt: string;
  updatedAt: string;
}
export interface LeadItem {
  id: string;
  listId: string;
  kind: LeadKind;
  refId: string;
  jobId: string | null;
  name: string | null;
  company: string | null;
  title: string | null;
  email: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}
/** One row to persist — `data` is the full crawler object. */
export interface NewLeadItem {
  kind: LeadKind;
  refId: string;
  jobId?: string | null;
  name?: string | null;
  company?: string | null;
  title?: string | null;
  email?: string | null;
  data: Record<string, unknown>;
}

export async function getLeadLists(): Promise<LeadList[]> {
  return apiGet<LeadList[]>("/api/v1/leads/lists");
}

export async function createLeadList(name: string): Promise<LeadList> {
  const { data } = await apiPost<LeadList>("/api/v1/leads/lists", { name });
  return data;
}

export async function renameLeadList(id: string, name: string): Promise<LeadList> {
  const res = await fetch(`/api/v1/leads/lists/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Rename failed", res.status);
  return json.data as LeadList;
}

export async function deleteLeadList(id: string): Promise<void> {
  const res = await fetch(`/api/v1/leads/lists/${id}`, { method: "DELETE" });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Delete failed", res.status);
}

export interface LeadItemsQuery {
  kind?: string; // "all" | "person" | "company"
  search?: string;
  page?: number;
  pageSize?: number;
}
export interface LeadItemsPage {
  items: LeadItem[];
  total: number;
  page: number;
  pageSize: number;
}
export async function getLeadItems(listId: string, query: LeadItemsQuery = {}): Promise<LeadItemsPage> {
  const params = new URLSearchParams();
  if (query.kind && query.kind !== "all") params.set("kind", query.kind);
  if (query.search) params.set("search", query.search);
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  return apiGet<LeadItemsPage>(`/api/v1/leads/lists/${listId}/items?${params.toString()}`);
}

// The API caps items per request; chunk large "Select all N" selections so they
// still persist in one logical action.
const LEAD_ITEM_CHUNK = 500;

async function postLeadItemsChunked(path: string, items: NewLeadItem[]): Promise<{ added: number }> {
  let added = 0;
  for (let i = 0; i < items.length; i += LEAD_ITEM_CHUNK) {
    const chunk = items.slice(i, i + LEAD_ITEM_CHUNK);
    if (chunk.length === 0) continue;
    const { data } = await apiPost<{ added: number }>(path, { items: chunk });
    added += data.added;
  }
  return { added };
}

/** Add items to a named list (deduped by kind+refId). Returns how many were new. */
export async function addLeadItems(listId: string, items: NewLeadItem[]): Promise<{ added: number }> {
  return postLeadItemsChunked(`/api/v1/leads/lists/${listId}/items`, items);
}

/** Drop items into the built-in "Saved" list (the Save button). */
export async function saveLeadItems(items: NewLeadItem[]): Promise<{ added: number }> {
  return postLeadItemsChunked("/api/v1/leads/saved/items", items);
}

export async function removeLeadItems(listId: string, ids: string[]): Promise<{ removed: number }> {
  let removed = 0;
  for (let i = 0; i < ids.length; i += 5000) {
    const chunk = ids.slice(i, i + 5000);
    if (chunk.length === 0) continue;
    const res = await fetch(`/api/v1/leads/lists/${listId}/items`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: chunk }),
    });
    const json = await res.json();
    if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Remove failed", res.status);
    removed += (json.data as { removed: number }).removed;
  }
  return { removed };
}

/* -------------------------------- jobs ----------------------------------- */

export async function getJobSearches(): Promise<JobCollectJob[]> {
  return apiGet<JobCollectJob[]>("/api/v1/leads/jobs");
}

export async function getJobSearch(id: string): Promise<(JobCollectJob & { coverage: JobSourceCoverage[] }) | undefined> {
  try {
    return await apiGet<JobCollectJob & { coverage: JobSourceCoverage[] }>(`/api/v1/leads/jobs/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}

export interface CreateJobSearchInput {
  name: string;
  sources: JobSource[];
  keywords: string;
  location?: string;
  maxPages?: number;
}
export async function createJobSearch(input: CreateJobSearchInput): Promise<JobCollectJob> {
  const { data } = await apiPost<JobCollectJob>("/api/v1/leads/jobs", input);
  return data;
}

export async function deleteJobSearch(id: string): Promise<void> {
  const res = await fetch(`/api/v1/leads/jobs/${id}`, { method: "DELETE" });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Delete failed", res.status);
}

export interface CrawledJobsQuery {
  page?: number; pageSize?: number; search?: string;
  sources?: string[]; companies?: string[]; locations?: string[]; workModes?: string[]; postedWithinDays?: number;
}
export interface CrawledJobsPage {
  jobs: CollectedJob[]; total: number; page: number; pageSize: number;
  facets: { sources: Record<string, number>; workModes: Record<string, number>; companies: { name: string; count: number }[] };
}
export async function getCrawledJobs(id: string, query: CrawledJobsQuery = {}): Promise<CrawledJobsPage> {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.sources?.length) params.set("sources", query.sources.join(","));
  if (query.companies?.length) params.set("companies", query.companies.join(","));
  if (query.locations?.length) params.set("locations", query.locations.join(","));
  if (query.workModes?.length) params.set("workModes", query.workModes.join(","));
  if (query.postedWithinDays) params.set("postedWithinDays", String(query.postedWithinDays));
  return apiGet<CrawledJobsPage>(`/api/v1/leads/jobs/${id}/results?${params.toString()}`);
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
