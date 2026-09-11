/**
 * Client for the crawler-service LinkedIn guest endpoints:
 *   POST /linkedin/jobs/search  — discover one query's cards
 *   POST /linkedin/enrich       — one job's detail + (opt-in) company info
 * Talks to the same crawler-service base as the other tabs. Throws only on
 * transport error; a walled query resolves with `blocked: true`.
 */
import "server-only";
import type { LinkedInDatePosted, LinkedInJobType } from "@/lib/leads/linkedin-jobs-types";

const BASE = process.env.CRAWLER_SERVICE_URL ?? "http://localhost:8090";
const TIMEOUT_MS = Number(process.env.CRAWLER_LINKEDIN_TIMEOUT_MS ?? 180_000);

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
  error?: string;
}

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
  found: boolean;
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

export async function searchLinkedInViaCrawler(query: {
  keywords: string;
  location: string;
  datePosted: LinkedInDatePosted;
  jobType: LinkedInJobType;
  maxPages: number;
}): Promise<SearchResponse> {
  return post<SearchResponse>("/linkedin/jobs/search", query);
}

export async function enrichLinkedInViaCrawler(input: {
  jobId: string;
  companyRef: string;
  withCompany: boolean;
}): Promise<{ detail: LinkedInJobDetail; company: LinkedInCompanyInfo }> {
  return post<{ detail: LinkedInJobDetail; company: LinkedInCompanyInfo }>("/linkedin/enrich", input);
}
