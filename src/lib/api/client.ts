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
  EmailList,
  EmailRecord,
  FinderResult,
  Integration,
  TeamMember,
  VerificationResult,
  Webhook,
  WebhookDelivery,
} from "../types";
import { verifyEmailSync, statusBucket } from "../mock/verification-engine";
import { seededRandom } from "../utils";

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

export async function findEmailsByPerson(input: {
  firstName: string;
  lastName: string;
  domain: string;
}): Promise<FinderResult[]> {
  await sleep(900);
  const { firstName, lastName, domain } = input;
  const f = firstName.trim().toLowerCase();
  const l = lastName.trim().toLowerCase();
  const d = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const patterns: { email: string; pattern: string; confidence: number }[] = [
    { email: `${f}.${l}@${d}`, pattern: "{first}.{last}", confidence: 94 },
    { email: `${f[0]}${l}@${d}`, pattern: "{f}{last}", confidence: 82 },
    { email: `${f}@${d}`, pattern: "{first}", confidence: 63 },
    { email: `${f}_${l}@${d}`, pattern: "{first}_{last}", confidence: 48 },
  ];
  return patterns.map((p, i) => {
    const res = verifyEmailSync(p.email);
    return {
      id: `pf_${i}`,
      email: p.email,
      confidence: p.confidence,
      pattern: p.pattern,
      source: "pattern match",
      name: `${firstName} ${lastName}`,
      domain: d,
      status: res.status,
    };
  });
}

export async function findEmailsByDomain(domainInput: string): Promise<FinderResult[]> {
  await sleep(1000);
  const d = domainInput.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const names = [
    ["John", "Smith"], ["Sarah", "Lee"], ["David", "Wong"], ["Emily", "Brown"],
    ["Michael", "Chen"], ["Laura", "Davis"], ["James", "Wilson"], ["Anna", "Patel"],
  ];
  return names.map(([first, last], i) => {
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@${d}`;
    const conf = 96 - i * 4;
    const res = verifyEmailSync(email);
    return {
      id: `df_${i}`,
      email,
      confidence: conf,
      pattern: "{first}.{last}",
      source: "web + pattern match",
      name: `${first} ${last}`,
      jobTitle: FINDER_TITLES[Math.floor(seededRandom(email) * FINDER_TITLES.length)],
      domain: d,
      status: res.status,
    };
  });
}

export async function getFinderSearches() {
  await sleep(200);
  return MOCK_FINDER_SEARCHES;
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
