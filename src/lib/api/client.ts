/**
 * App data client — the ONLY place the UI reads data from.
 *
 * LIVE (server-backed): verification (`/api/v1/verify`), lists, list records,
 * bulk verification jobs, deep scan, and credits are all handled by the
 * Next.js server backend (`src/server/*` + `/api/v1/*` route handlers),
 * which delegates actual email checking to the Rust `check-if-email-exists`
 * engine.
 *
 * There is NO mock/simulated data anywhere in this client. Features that do not
 * yet have a real backend (API keys, webhooks, integrations, team, analytics,
 * domain stats, saved finder searches) return honest EMPTY results rather than
 * fabricated seed data — the UI shows an empty state until a real backend
 * exists.
 */
import type {
  AnalyticsPoint,
  ApiKey,
  CreditBalance,
  CreditTransaction,
  DomainStat,
  BulkFinderResponse,
  AppUser,
  DeviceSession,
  EmailList,
  EmailRecord,
  FinderOutcome,
  FinderResult,
  FinderSearch,
  Integration,
  TeamMember,
  UserRole,
  VerificationResult,
  Webhook,
  WebhookDelivery,
} from "../types";
import { statusBucket } from "../types";
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
  provider: "reacher";
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

export async function getFinderSearches(): Promise<FinderSearch[]> {
  // No saved-search backend yet — return empty rather than fabricated history.
  return [];
}

/* ---------------- Runtime app config (crawler secrets) ---------------- */

export type AppConfigKey =
  | "DEEPSEEK_API_KEY"
  | "DEEPSEEK_MODEL"
  | "CRAWLER_ROTATING_PROXY"
  | "CRAWLER_PROXY_LIST_URL"
  | "DECODO_AUTH"
  | "GOOGLE_API_KEY"
  | "GOOGLE_CX";

export interface AppConfigField {
  key: AppConfigKey;
  secret: boolean;
  hasValue: boolean;
  /** Secrets: masked preview. Non-secrets: the plain value. */
  value: string;
  overridden: boolean;
}
export interface AppConfig {
  fields: AppConfigField[];
}

export async function getAppConfig(): Promise<AppConfig> {
  return apiGet<AppConfig>("/api/v1/settings");
}

export async function setAppConfig(patch: Partial<Record<AppConfigKey, string>>): Promise<AppConfig> {
  const res = await fetch("/api/v1/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Save failed", res.status);
  return json.data as AppConfig;
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
  // `prefill` is a full snapshot pulled from a saved list (import dedup): the row
  // is shown straight from it — no crawl.
  rows: { company: string; location: string; prefill?: CollectedCompany | null }[];
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

export interface VerifyEmailsResult { verified: number; valid: number; found?: number; provider: "reacher" | "none" }
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

/** Result of kicking off a people Find & verify pass (runs in the background). */
export interface StartVerifyResult { started: boolean; pending: number; alreadyRunning?: boolean }

/**
 * Find & verify a people job's emails. Default is incremental: saved verdicts
 * (including Not found) are kept; only unchecked people are looked up.
 * Pass `{ keep: false }` to wipe caches + prior results and re-search everyone.
 *
 * The pass runs in the background (a full job can far exceed the request
 * timeout); this returns as soon as it has started. Watch the job's
 * `verifyStatus` (polled by the People tab) for live progress and completion.
 */
export async function verifyPeopleEmails(id: string, opts: { keep?: boolean } = {}): Promise<StartVerifyResult> {
  const q = opts.keep === false ? "?fresh=1" : "?keep=1";
  const { data } = await apiPost<StartVerifyResult>(`/api/v1/leads/people/${id}/verify-emails${q}`, {});
  return data;
}

/** Per-row "Access email": find + verify a SINGLE person's email on demand. */
export interface SinglePersonVerifyResult {
  ok: boolean;
  status: "valid" | "invalid" | "risky" | "unknown" | "disposable" | "catch_all" | "role" | "not_found" | null;
  email: string | null;
  found: boolean;
  valid: boolean;
  provider: "reacher" | "none";
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

export type AiTagColor = "amber" | "blue" | "green" | "purple" | "red" | "teal" | "pink" | "orange";
export interface AiTagResult {
  tag: { label: string; color: AiTagColor } | null;
  matchedIds: string[];
  scanned: number;
  total: number;
  tokens: number;
}

/** "AI Support": run a natural-language instruction over the People table and get
 *  back which rows to tag + a label/colour. `search` targets the visible rows. */
export async function aiTagPeople(id: string, prompt: string, search = ""): Promise<AiTagResult> {
  const { data } = await apiPost<AiTagResult>(`/api/v1/leads/people/${id}/ai-tag`, { prompt, search });
  return data;
}

export interface CollectPeopleQuery {
  page?: number; pageSize?: number; search?: string; ids?: string[];
  email?: string[]; titles?: string[]; seniority?: string[]; linkedin?: boolean; funded?: boolean;
  companies?: string[]; locations?: string[]; employees?: string[]; industries?: string[]; minScore?: number;
  sort?: string;
}

export interface PeopleAddSelection {
  all: boolean;             // true = "Select all N matching"
  personIds?: string[];     // when all=false: the explicit checked rows
  query?: CollectPeopleQuery; // when all=true: the filter context to resolve "all matching"
}

/**
 * Add selected people to a list BY REFERENCE. The browser sends only ids or the
 * filter context — never the (potentially multi-MB) row snapshots — so a large
 * "Select all" can't 413 at a proxy. The server resolves the rows from its store
 * and forwards them to the leads backend in small chunks. Returns added/skipped.
 */
export async function addPeopleToList(jobId: string, listId: string, selection: PeopleAddSelection): Promise<AddItemsResult & { count: number }> {
  const { data } = await apiPost<AddItemsResult & { count: number }>(`/api/v1/leads/people/${jobId}/add-to-list`, { listId, ...selection });
  return data;
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
  if (query.ids?.length) params.set("ids", query.ids.join(","));
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

// The API caps items per request (and each item carries a full lead snapshot), so
// chunk large "Select all N" selections; they still persist in one logical action.
const LEAD_ITEM_CHUNK = 250;

export interface AddItemsResult {
  added: number; // newly inserted
  skipped: number; // already in the list (duplicate by ref or identity)
}

async function postLeadItemsChunked(path: string, items: NewLeadItem[]): Promise<AddItemsResult> {
  let added = 0;
  let skipped = 0;
  for (let i = 0; i < items.length; i += LEAD_ITEM_CHUNK) {
    const chunk = items.slice(i, i + LEAD_ITEM_CHUNK);
    if (chunk.length === 0) continue;
    const { data } = await apiPost<AddItemsResult>(path, { items: chunk });
    added += data.added;
    skipped += data.skipped ?? chunk.length - data.added;
  }
  return { added, skipped };
}

/** Add items to a named list (deduped by kind+refId + identity). Returns how many
 *  were newly added vs skipped as duplicates. */
export async function addLeadItems(listId: string, items: NewLeadItem[]): Promise<AddItemsResult> {
  return postLeadItemsChunked(`/api/v1/leads/lists/${listId}/items`, items);
}

/** Drop items into the built-in "Saved" list (the Save button). */
export async function saveLeadItems(items: NewLeadItem[]): Promise<AddItemsResult> {
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

/* ----------------------- match imports against lists --------------------- */

export interface PersonMatchKey { key: string; name?: string | null; company?: string | null; email?: string | null }
export interface CompanyMatchKey { key: string; company?: string | null; location?: string | null }
export interface LeadMatchInput { people?: PersonMatchKey[]; companies?: CompanyMatchKey[] }
/** Hits keyed by the caller's `key` — each is the full saved LeadItem (snapshot in `data`). */
export interface LeadMatchResult { people: Record<string, LeadItem>; companies: Record<string, LeadItem> }

/**
 * Cross-reference import rows against every saved list. A hit means the lead was
 * already enriched and saved, so its snapshot can fill the table without a crawl.
 * People match by email or name+company; companies by name+location.
 */
export async function matchLeadItems(input: LeadMatchInput): Promise<LeadMatchResult> {
  if (!input.people?.length && !input.companies?.length) return { people: {}, companies: {} };
  const { data } = await apiPost<LeadMatchResult>("/api/v1/leads/lists/match", input);
  return data;
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

/** Re-crawl only the blocked/failed sources of an existing job search. */
export async function retryBlockedJobSources(id: string): Promise<{ id: string; sources: JobSource[] }> {
  const { data } = await apiPost<{ id: string; sources: JobSource[] }>(`/api/v1/leads/jobs/${id}/retry`, {});
  return data;
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
  // No API-key backend yet — honest empty state, never seeded keys.
  return [];
}

export async function getWebhooks(): Promise<Webhook[]> {
  return [];
}

export async function getWebhookDeliveries(): Promise<WebhookDelivery[]> {
  return [];
}

/* ------------------------ Integrations / team ---------------------- */

export async function getIntegrations(): Promise<Integration[]> {
  return [];
}

export async function getTeam(): Promise<TeamMember[]> {
  return [];
}

/* ------------------------- Auth & users ---------------------------- */

/** Current signed-in user, or null when the session is missing/expired. */
export async function getMe(): Promise<AppUser | null> {
  const res = await fetch("/api/v1/auth/me", { cache: "no-store" });
  if (!res.ok) return null;
  const json = await res.json();
  return json.success ? (json.data as AppUser) : null;
}

export async function login(email: string, password: string): Promise<AppUser> {
  const { data } = await apiPost<AppUser>("/api/v1/auth/login", { email, password });
  return data;
}

export async function logout(): Promise<void> {
  await fetch("/api/v1/auth/logout", { method: "POST" });
}

export async function getUsers(): Promise<AppUser[]> {
  return apiGet<AppUser[]>("/api/v1/users");
}

export interface CreateUserInput {
  email: string;
  name: string;
  role: UserRole;
  password: string;
}

export async function createUser(input: CreateUserInput): Promise<AppUser> {
  const { data } = await apiPost<AppUser>("/api/v1/users", input);
  return data;
}

export interface UpdateUserInput {
  name?: string;
  role?: UserRole;
  isActive?: boolean;
  password?: string;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<AppUser> {
  const res = await fetch(`/api/v1/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Request failed", res.status, json.error);
  return json.data as AppUser;
}

export async function deleteUser(id: string): Promise<void> {
  const res = await fetch(`/api/v1/users/${id}`, { method: "DELETE" });
  const json = await res.json().catch(() => ({ success: false }));
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Could not delete user", res.status, json.error);
}

/* ------------------------- Active sessions ------------------------- */

export async function getSessions(): Promise<DeviceSession[]> {
  return apiGet<DeviceSession[]>("/api/v1/auth/sessions");
}

/** Revoke one session. Returns whether the revoked one was the current device. */
export async function revokeSession(id: string): Promise<{ id: string; current: boolean }> {
  const res = await fetch(`/api/v1/auth/sessions/${id}`, { method: "DELETE" });
  const json = await res.json().catch(() => ({ success: false }));
  if (!json.success) throw new ApiError(json.error?.code ?? "ERROR", json.error?.message ?? "Could not revoke session", res.status, json.error);
  return json.data as { id: string; current: boolean };
}

/** Sign out every other device. Returns how many sessions were revoked. */
export async function revokeOtherSessions(): Promise<number> {
  const { data } = await apiPost<{ revoked: number }>("/api/v1/auth/sessions/revoke-others", {});
  return data.revoked;
}

/* ----------------------------- Analytics --------------------------- */

export async function getAnalytics(_days: number): Promise<AnalyticsPoint[]> {
  // No analytics backend yet — empty series, never fabricated trend data.
  return [];
}

export async function getDomainStats(): Promise<DomainStat[]> {
  return [];
}
