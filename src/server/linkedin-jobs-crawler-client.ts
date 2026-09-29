/**
 * Client for the crawler-service LinkedIn guest endpoints:
 *   POST /linkedin/jobs/count   — LinkedIn's reported total for a query
 *   POST /linkedin/jobs/search  — walk one query/slice's cards (≤ 1,000)
 *   POST /linkedin/enrich       — one job's detail + (opt-in) company info
 * Talks to the same crawler-service base as the other tabs. Throws only on
 * transport error; a walled query resolves with `blocked: true`.
 */
import "server-only";
import type { LinkedInDatePosted, LinkedInJobType } from "@/lib/leads/linkedin-jobs-types";

const BASE = process.env.CRAWLER_SERVICE_URL ?? "http://localhost:8090";
const TIMEOUT_MS = Number(process.env.CRAWLER_LINKEDIN_TIMEOUT_MS ?? 180_000);
// Per-row enrich (one job detail + maybe one company page) — a hung call must not
// stall the whole Qualify pass for minutes.
const ENRICH_TIMEOUT_MS = Number(process.env.CRAWLER_LINKEDIN_ENRICH_TIMEOUT_MS ?? 60_000);

/** One discovered card (BE `LinkedInRawJob`), before FE normalization. */
export interface LinkedInRawJob {
  linkedinJobId: string;
  jobUrl: string;
  title: string;
  company: string;
  companyLinkedinUrl: string | null;
  location: string | null;
  postedAt: string | null;
  postedText: string | null;
}

interface SearchResponse {
  jobs: LinkedInRawJob[];
  pages: number;
  blocked: boolean;
  provider: string;
  missedPages?: number;
  exhausted?: boolean;
  error?: string;
}

export interface LinkedInCount { count: number | null; capped: boolean; text: string | null; }

export interface LinkedInJobDetail {
  linkedinJobId: string;
  description: string | null;
  applicants: number | null;
  employmentType: string | null;
  seniority: string | null;
  jobFunction: string | null;
  industries: string[];
  companyLinkedinUrl: string | null;
  found: boolean;
}
export interface LinkedInCompanyInfo {
  employeeRange: string | null;
  employeeMin: number | null;
  industry: string | null;
  website: string | null;
  companyType?: string | null;
  affiliates?: string[];
  found: boolean;
  /** real 404 (vs. blocked on every IP) — only then is a miss worth caching */
  notFound?: boolean;
}

/** One hiring company for the DeepSeek revenue / corporate-group lookup. */
export interface CompanySignalSeed {
  id: string; name: string; location?: string | null; website?: string | null;
  linkedin?: string | null; industry?: string | null; employees?: string | null;
}
export interface CompanySignal { id: string; found: boolean; confidence: number; revenueBand: string | null; parentGroup: string | null; }

export interface BackingSeed { id: string; name: string; domain?: string | null; location?: string | null; industry?: string | null }
export interface BackingResult { id: string; parentGroup: string | null; relation: string | null; evidence: string | null; source: string | null; searched: boolean }

/** Corporate owner/backer from LIVE web evidence (free SERP + DeepSeek, citation-checked). */
export async function companyBackingViaCrawler(records: BackingSeed[]): Promise<{ configured: boolean; results: BackingResult[] }> {
  return post<{ configured: boolean; results: BackingResult[] }>("/llm/company-backing", { records }, 170_000);
}

/** One company page only (size band, industry, type, affiliates). */
export async function companyViaCrawler(ref: string): Promise<LinkedInCompanyInfo> {
  return post<LinkedInCompanyInfo>("/linkedin/company", { ref }, ENRICH_TIMEOUT_MS);
}

/** Revenue band + corporate parent from DeepSeek knowledge (configured:false when no key). */
export async function companySignalsViaCrawler(records: CompanySignalSeed[]): Promise<{ configured: boolean; signals: CompanySignal[] }> {
  return post<{ configured: boolean; signals: CompanySignal[] }>("/llm/company-signals", { records }, 180_000);
}

async function post<T>(path: string, body: unknown, timeoutMs = TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`crawler-service ${path} responded ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface LinkedInSliceQuery {
  keywords: string;
  location: string;
  datePosted: LinkedInDatePosted;
  /** exact f_TPR window in seconds; overrides datePosted */
  tprSeconds?: number;
  jobType: LinkedInJobType;
}

export async function searchLinkedInViaCrawler(query: LinkedInSliceQuery & { maxPages: number; start?: number }): Promise<SearchResponse> {
  return post<SearchResponse>("/linkedin/jobs/search", query);
}

export async function countLinkedInViaCrawler(query: LinkedInSliceQuery): Promise<LinkedInCount> {
  return post<LinkedInCount>("/linkedin/jobs/count", query, 60_000);
}

export async function enrichLinkedInViaCrawler(input: {
  jobId: string;
  companyRef: string;
  withCompany: boolean;
}): Promise<{ detail: LinkedInJobDetail; company: LinkedInCompanyInfo }> {
  return post<{ detail: LinkedInJobDetail; company: LinkedInCompanyInfo }>("/linkedin/enrich", input, ENRICH_TIMEOUT_MS);
}
